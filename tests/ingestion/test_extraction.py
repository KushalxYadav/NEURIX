"""Stages C and D: slide- and page-accurate extraction."""

from __future__ import annotations

import io
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest
from synapse_ingest.annotate import annotate_text, is_formula_line
from synapse_ingest.archive import inspect_archive
from synapse_ingest.config import Paths
from synapse_ingest.presentations import run_presentations_stage
from synapse_ingest.status import StatusTracker
from synapse_ingest.util import read_json
from synthetic import build_extra_pptx


def _load(folder: Path, source_file: str) -> dict:
    for path in folder.glob("*.json"):
        data = read_json(path)
        if data["source_file"] == source_file:
            return data
    raise AssertionError(f"{source_file} not extracted")


def test_presentation_slides_keep_order_titles_notes(pipeline_run: Paths) -> None:
    deck = _load(pipeline_run.presentations_dir, "Lecture01_intro.pptx")
    assert deck["status"] == "completed"
    assert deck["slide_count"] == 5
    assert [s["slide_number"] for s in deck["slides"]] == [1, 2, 3, 4, 5]
    assert deck["slides"][0]["title"] == "Fixture Layers"
    second = deck["slides"][1]
    assert second["notes"] == "Speaker note: emphasise that this is synthetic."
    levels = [p["level"] for p in second["blocks"][0]["paragraphs"]]
    assert levels == [0, 1, 1]
    assert second["annotations"]["definitions"][0]["term"] == "A fixture protocol"
    table = deck["slides"][2]
    assert table["has_table"] and "Fixture link | Fixture frame" in table["text"]
    fourth = deck["slides"][3]
    assert "Throughput = Window size / Round trip time" in fourth["text"]  # text inside a group shape
    assert fourth["formula_heavy"] or fourth["annotations"]["formulas"]
    assert fourth["has_content_images"] is True
    # The logo repeated on 4 of 5 slides is flagged as decorative
    assert all(i["likely_decorative"] for i in deck["slides"][0]["images"])
    untitled = deck["slides"][4]
    assert untitled["title"] is None
    assert untitled["title_source"] == "first_text_line"


def test_duplicate_presentation_processed_once(pipeline_run: Paths) -> None:
    decks = [read_json(p) for p in pipeline_run.presentations_dir.glob("*.json")]
    intro = [d for d in decks if d["source_file"] == "Lecture01_intro.pptx"]
    assert len(intro) == 1
    assert intro[0]["source_paths"] == ["Week 1/Lecture01_intro.pptx", "Week 1/copy_of_intro.pptx"]


def test_broken_legacy_file_is_reported_failed_not_skipped(pipeline_run: Paths) -> None:
    inventory = read_json(pipeline_run.inventory)
    sha = next(e["sha256"] for e in inventory["entries"] if e["path"] == "Week 2/old_lecture.ppt")
    record = StatusTracker(pipeline_run.status).stage(sha, "extract")
    assert record["status"] == "failed"
    assert "convert" in record["error"].lower()


@pytest.mark.skipif(not shutil.which("soffice"), reason="LibreOffice not installed")
def test_real_legacy_ppt_is_converted_and_extracted(tmp_path: Path) -> None:
    pptx = tmp_path / "deck.pptx"
    pptx.write_bytes(build_extra_pptx())
    subprocess.run(
        ["soffice", f"-env:UserInstallation=file://{tmp_path / 'lo'}", "--headless", "--convert-to", "ppt", "--outdir", str(tmp_path), str(pptx)],
        check=True,
        capture_output=True,
        timeout=180,
    )
    archive = tmp_path / "legacy.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("index.html", "<h2>Week 1</h2><a href='deck.ppt'>Deck</a><h2>Week 2</h2>")
        zf.write(tmp_path / "deck.ppt", "deck.ppt")
    paths = Paths.resolve(tmp_path / "data")
    inspect_archive(archive, paths)
    results = run_presentations_stage(paths)
    assert results[0]["status"] == "completed"
    deck = read_json(next(paths.presentations_dir.glob("*.json")))
    assert deck["converted_from"] == "deck.ppt"
    assert deck["slides"][0]["title"] == "Extra Fixture Topic"


def test_textbook_pages_labels_and_chapters(pipeline_run: Paths) -> None:
    book = _load(pipeline_run.documents_dir, "Fixture_Networking_Textbook.pdf")
    assert book["document_role"] == "textbook"
    assert book["page_count"] == 45
    assert book["page_labels_defined"] is True
    pages = book["units"]
    assert [(p["page_number"], p["page_label"]) for p in pages[:5]] == [(1, "i"), (2, "ii"), (3, "iii"), (4, "1"), (5, "2")]
    assert pages[4]["detected_printed_page"] == "2"
    chapters = book["chapters"]
    assert [(c["title"], c["page_start"], c["page_end"]) for c in chapters] == [
        ("Chapter 1 Fixture Layers", 4, 19),
        ("Chapter 2 Fixture Transport", 20, 34),
        ("Chapter 3 Fixture Applications", 35, 45),
    ]
    assert pages[20]["chapter"]["title"] == "Chapter 2 Fixture Transport"
    assert pages[24]["heading_path"] == ["Chapter 2 Fixture Transport", "2.2 Datagram fixtures"]
    # Running header removed from body text, real content kept
    assert "Fixture Networking Textbook" not in pages[10]["text"]
    assert "page 11 of the synthetic test fixture textbook" in pages[10]["text"]
    annotations = pages[10]["annotations"]
    assert annotations["figures"][0]["label"] == "Figure 1.2"
    assert annotations["formulas"][0]["text"] == "Throughput = Window size / Round trip time"
    assert annotations["examples"]
    # Scanned page flagged for OCR, document still usable
    assert pages[43]["needs_ocr"] is True
    assert book["quality"]["ocr_pages"] == [44]
    assert book["status"] == "completed"
    assert any("OCR" in w for w in book["warnings"])


def test_docx_sections_have_no_invented_pages(pipeline_run: Paths) -> None:
    notes = _load(pipeline_run.documents_dir, "notes.docx")
    assert [u["title"] for u in notes["units"]] == ["Transport Notes", "Ports"]
    assert all(u["page_number"] is None for u in notes["units"])
    assert notes["units"][1]["heading_path"] == ["Transport Notes", "Ports"]
    assert "8080 | Fixture web" in notes["units"][1]["text"]


def test_epub_sections_and_page_markers(tmp_path: Path) -> None:
    from synapse_ingest.documents import extract_epub

    epub = tmp_path / "book.epub"
    with zipfile.ZipFile(epub, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr(
            "META-INF/container.xml",
            '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
        )
        zf.writestr(
            "OEBPS/content.opf",
            '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Fixture EPUB</dc:title></metadata>'
            '<manifest><item id="c1" href="c1.xhtml"/></manifest><spine><itemref idref="c1"/></spine></package>',
        )
        zf.writestr(
            "OEBPS/c1.xhtml",
            '<html><body><h1>Chapter 1 Basics</h1><span role="doc-pagebreak" title="17"></span>'
            "<p>Packets are units of data.</p><h2>1.1 Details</h2><p>More text.</p></body></html>",
        )
    result = extract_epub(epub)
    assert result["title"] == "Fixture EPUB"
    assert [u["title"] for u in result["units"]] == ["Chapter 1 Basics", "1.1 Details"]
    assert result["units"][1]["page_label"] == "17"


def test_annotation_heuristics() -> None:
    assert is_formula_line("Bandwidth-delay product = Bandwidth × RTT")
    assert is_formula_line("2^n - 2 = 62")
    assert not is_formula_line("The protocol is simple and easy to configure.")
    found = annotate_text("Latency refers to the time it takes for a packet to travel.\nExample: a ping round trip.")
    assert found["definitions"][0]["term"] == "Latency"
    assert found["examples"][0]["text"].startswith("Example")


def test_status_file_tracks_every_document(pipeline_run: Paths) -> None:
    tracker = StatusTracker(pipeline_run.status)
    statuses = {doc["source_paths"][0]: tracker.overall_status(key) for key, doc in tracker.data["documents"].items()}
    assert statuses["Week 2/old_lecture.ppt"] == "failed"
    assert statuses["Week 1/Lecture01_intro.pptx"] == "completed"
    assert statuses["index.html"] == "completed"
    assert io  # keep import used for clarity of fixtures
