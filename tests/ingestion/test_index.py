"""Stage E: unified index, chunk traceability, associations, resumability."""

from __future__ import annotations

from pathlib import Path

from synapse_ingest.chunking import ChunkConfig, chunk_text, is_lead_in
from synapse_ingest.config import Paths
from synapse_ingest.util import read_json, read_jsonl

REQUIRED_UNIT_FIELDS = {
    "id", "subject_key", "document_id", "original_filename", "document_type", "week_ordinals",
    "chapter", "unit_type", "unit_number", "text", "content_hash", "extraction_status", "processed_at",
}  # fmt: skip


def test_subject_and_stats(pipeline_run: Paths) -> None:
    index = read_json(pipeline_run.source_index)
    assert index["subject"]["name"] == "Fixture Networks 101"
    assert index["subject"]["name_source"] == "overview_title"
    assert index["subject"]["key"] == "fixture-networks-101"
    assert index["stats"]["slides"] == 6
    assert index["stats"]["pages"] == 45
    assert index["stats"]["by_status"] == {"completed": 6, "failed": 1}


def test_every_unit_is_traceable(pipeline_run: Paths) -> None:
    units = read_jsonl(pipeline_run.content_units)
    for unit in units:
        assert REQUIRED_UNIT_FIELDS <= unit.keys(), unit.keys()
        assert len(unit["content_hash"]) == 64
        if unit["unit_type"] == "slide":
            assert unit["slide_number"] >= 1
        if unit["unit_type"] == "page":
            assert unit["page_number"] >= 1
    page = next(u for u in units if u["unit_type"] == "page" and u["page_number"] == 21)
    assert page["chapter"]["title"] == "Chapter 2 Fixture Transport"
    assert page["citation"] == "Fixture_Networking_Textbook.pdf, p. 18 (PDF page 21)"


def test_chunks_cite_single_slide_or_page(pipeline_run: Paths) -> None:
    chunks = read_jsonl(pipeline_run.chunks)
    units = {u["id"]: u for u in read_jsonl(pipeline_run.content_units)}
    assert chunks
    for chunk in chunks:
        unit = units[chunk["unit_id"]]
        assert chunk["document_id"] == unit["document_id"]
        assert chunk["citation"] == unit["citation"]
        if chunk["unit_type"] == "page":
            assert chunk["page_number"] == unit["page_number"]
        if chunk["unit_type"] == "slide":
            assert chunk["slide_number"] == unit["slide_number"]
    slide_two = next(c for c in chunks if c["original_filename"] == "Lecture01_intro.pptx" and c["slide_number"] == 2)
    assert slide_two["content"].startswith("The Fixture Model")
    assert "Speaker notes: Speaker note" in slide_two["content"]
    # per-document chunk indexes are contiguous
    by_doc: dict[str, list[int]] = {}
    for chunk in chunks:
        by_doc.setdefault(chunk["document_id"], []).append(chunk["chunk_index"])
    for indexes in by_doc.values():
        assert indexes == list(range(len(indexes)))


def test_week_associations_carry_evidence(pipeline_run: Paths) -> None:
    index = read_json(pipeline_run.source_index)
    docs = {d["original_filename"]: d for d in index["documents"]}
    intro = docs["Lecture01_intro.pptx"]["week_associations"]
    assert [(a["week_ordinal"], a["source"], a["verification"]) for a in intro] == [(1, "overview_link", "source_confirmed")]
    extra = docs["Week_3_extra.pptx"]["week_associations"]
    assert [(a["week_ordinal"], a["source"], a["verification"]) for a in extra] == [(3, "filename_pattern", "unverified")]
    assert docs["Fixture_Networking_Textbook.pdf"]["week_associations"] == []
    coverage = {row["ordinal"]: row for row in index["coverage"]["weeks"]}
    assert coverage[1]["lecture_material_confirmed"] is True
    assert coverage[3]["needs_verification"] is True
    # Week 2's only lecture file failed to convert: linked, but not usable material
    assert coverage[2]["lecture_material"] is False
    assert coverage[2]["lecture_material_failed"] is True
    assert coverage[2]["missing_material"] is True
    assert coverage[1]["textbook_reference_in_overview"] is True


def test_all_files_are_listed_with_a_status(pipeline_run: Paths) -> None:
    index = read_json(pipeline_run.source_index)
    files = {f["path"]: f for f in index["files"]}
    inventory = read_json(pipeline_run.inventory)
    assert set(files) == {e["path"] for e in inventory["entries"]}
    assert files["Week 2/old_lecture.ppt"]["processing_status"] == "failed"
    assert "convert" in files["Week 2/old_lecture.ppt"]["reason"].lower()
    assert files["images/logo.png"]["processing_status"] == "not_applicable"
    assert files[".DS_Store"]["processing_status"] == "skipped"
    assert files["Week 1/copy_of_intro.pptx"]["reason"] == "duplicate of Week 1/Lecture01_intro.pptx"


def test_ids_are_deterministic_and_rerun_is_cached(pipeline_run: Paths, course_archive: Path) -> None:
    from synapse_ingest.cli import run_pipeline_main

    before = [c["id"] for c in read_jsonl(pipeline_run.chunks)]
    assert run_pipeline_main(["--archive", str(course_archive), "--data-dir", str(pipeline_run.data)]) == 0
    after = [c["id"] for c in read_jsonl(pipeline_run.chunks)]
    assert before == after
    status = read_json(pipeline_run.status)
    intro = next(d for d in status["documents"].values() if d["source_paths"][0] == "Week 1/Lecture01_intro.pptx")
    assert intro["stages"]["extract"]["attempts"] == 1  # second run used the cached extraction


def test_chunker_keeps_lead_ins_with_their_content() -> None:
    config = ChunkConfig(target_words=30, max_words=40, min_words=5, hard_max_words=80)
    body = " ".join(["word"] * 28) + "."
    text = f"{body}\n\nDefinition:\n\nA subnet is a logical subdivision of an IP network used to organise hosts."
    chunks = chunk_text(text, config)
    assert chunks[-1].startswith("Definition:")
    assert "A subnet is" in chunks[-1]
    assert is_lead_in("Throughput = Window size / RTT")


def test_chunker_splits_oversized_paragraphs_by_sentence() -> None:
    config = ChunkConfig(target_words=50, max_words=60, min_words=10, hard_max_words=80)
    sentence = "Routers forward packets between networks using routing tables. "
    chunks = chunk_text(sentence * 30, config)
    assert len(chunks) > 3
    assert all(len(c.split()) <= 80 for c in chunks)
    assert all(c.rstrip().endswith(".") for c in chunks)


def test_only_reprocesses_the_requested_document(pipeline_run: Paths, course_archive: Path) -> None:
    from synapse_ingest.cli import run_pipeline_main

    target = "Week 3/notes.docx"
    assert run_pipeline_main(
        ["--archive", str(course_archive), "--data-dir", str(pipeline_run.data), "--only", target]
    ) == 0
    status = read_json(pipeline_run.status)["documents"]
    notes = next(d for d in status.values() if d["source_paths"] == [target])
    intro = next(d for d in status.values() if d["source_paths"][0] == "Week 1/Lecture01_intro.pptx")
    assert notes["stages"]["extract"]["attempts"] >= 2
    assert intro["stages"]["extract"]["attempts"] == 1
    assert run_pipeline_main(
        ["--archive", str(course_archive), "--data-dir", str(pipeline_run.data), "--only", "nope.pdf"]
    ) == 2
