"""Stage A: archive safety, inventory, duplicates and document identification."""

from __future__ import annotations

import os
import zipfile
from pathlib import Path

import pytest
from synapse_ingest.archive import classify, entry_rejection_reasons, inspect_archive
from synapse_ingest.config import ArchiveNotFoundError, Paths, SafetyLimits, discover_archive
from synapse_ingest.util import read_json
from synthetic import build_malicious_archive


def _entry(inventory: dict, path: str) -> dict:
    return next(e for e in inventory["entries"] if e["path"] == path)


def test_classify_paths() -> None:
    assert classify("index.html")[0] == "weekly_overview_candidate"
    assert classify("Week 1/a.PPTX") == ("presentation", ".pptx")
    assert classify("old.ppt")[0] == "presentation_legacy"
    assert classify("__MACOSX/._x.pdf")[0] == "system_metadata"
    assert classify("folder/.DS_Store")[0] == "system_metadata"
    assert classify("book.epub")[0] == "ebook"
    assert classify("weird.xyz")[0] == "other"


def test_rejection_reasons_cover_unsafe_entries() -> None:
    limits = SafetyLimits()
    cases = {
        "../evil.txt": "path traversal",
        "/abs.txt": "absolute path",
        "C:/x.txt": "absolute path",
    }
    for name, expected in cases.items():
        reasons = entry_rejection_reasons(zipfile.ZipInfo(name), limits)
        assert any(expected in r for r in reasons), (name, reasons)
    link = zipfile.ZipInfo("link")
    link.external_attr = 0o120777 << 16
    assert any("symbolic link" in r for r in entry_rejection_reasons(link, limits))
    bomb = zipfile.ZipInfo("bomb")
    bomb.file_size, bomb.compress_size = 50 * 1024**2, 1024
    assert any("compression ratio" in r for r in entry_rejection_reasons(bomb, limits))
    assert entry_rejection_reasons(zipfile.ZipInfo("Week 1/ok.pptx"), limits) == []


def test_malicious_archive_is_contained(tmp_path: Path) -> None:
    archive = build_malicious_archive(tmp_path / "evil.zip")
    paths = Paths.resolve(tmp_path / "data")
    result = inspect_archive(archive, paths)
    inventory = result.inventory
    statuses = {e["path"]: e["status"] for e in inventory["entries"]}
    for bad in ("../evil.txt", "/abs/evil.txt", "C:/windows/evil.txt", "link_to_etc", "secret.txt", "bomb.bin"):
        assert statuses[bad] == "rejected", bad
    assert statuses["safe/ok.txt"] == "extracted"
    assert inventory["summary"]["rejected"] == 6
    # Nothing escaped the extraction root.
    assert not (tmp_path / "evil.txt").exists()
    assert not (tmp_path / "data" / "evil.txt").exists()
    assert not Path("/abs/evil.txt").exists()
    extracted = [p for p in (paths.data / inventory["extraction_root"]).rglob("*") if p.is_file()]
    assert {p.name for p in extracted} == {"index.html", "ok.txt"}
    assert all(not p.is_symlink() for p in extracted)


def test_discovery_reports_every_checked_location(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SYNAPSE_ARCHIVE_PATH", raising=False)
    paths = Paths.resolve(tmp_path / "data", root=tmp_path)
    with pytest.raises(ArchiveNotFoundError) as error:
        discover_archive(None, paths)
    assert "source-material" in str(error.value)


def test_discovery_finds_extensionless_zip_in_source_material(tmp_path: Path, course_archive: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SYNAPSE_ARCHIVE_PATH", raising=False)
    (tmp_path / "source-material").mkdir()
    target = tmp_path / "source-material" / course_archive.name
    target.write_bytes(course_archive.read_bytes())
    (tmp_path / "source-material" / "notes.txt").write_text("not a zip")
    paths = Paths.resolve(tmp_path / "data", root=tmp_path)
    assert discover_archive(None, paths) == target.resolve()


def test_inventory_of_course_archive(pipeline_run: Paths, course_archive: Path) -> None:
    inventory = read_json(pipeline_run.inventory)
    assert inventory["archive"]["filename"] == course_archive.name
    assert inventory["weekly_overview"]["selected"] == "index.html"
    assert inventory["textbook"]["selected"] == "Textbook/Fixture_Networking_Textbook.pdf"
    assert inventory["textbook"]["selection_reason"]

    assert _entry(inventory, "__MACOSX/._index.html")["status"] == "skipped"
    assert _entry(inventory, ".DS_Store")["category"] == "system_metadata"
    assert _entry(inventory, "Week 2/old_lecture.ppt")["category"] == "presentation_legacy"
    assert _entry(inventory, "Week 2/old_lecture.ppt")["signature"] == "ole2"

    duplicate = _entry(inventory, "Week 1/copy_of_intro.pptx")
    assert duplicate["duplicate_of"] == "Week 1/Lecture01_intro.pptx"
    assert inventory["summary"]["duplicate_groups"] == 1

    for entry in inventory["entries"]:
        if entry["status"] == "extracted":
            assert len(entry["sha256"]) == 64
            assert (pipeline_run.data / entry["extracted_path"]).is_file()
    assert (pipeline_run.reports / "inventory_report.md").read_text().startswith("# Archive inventory report")


def test_original_archive_is_never_modified(course_archive: Path, pipeline_run: Paths) -> None:
    before = course_archive.stat()
    # Re-running inspection must not touch the archive.
    inspect_archive(course_archive, pipeline_run)
    after = course_archive.stat()
    assert (before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns)
    assert os.access(course_archive, os.R_OK)


def test_re_extraction_reuses_verified_files(course_archive: Path, tmp_path: Path) -> None:
    paths = Paths.resolve(tmp_path / "data")
    inspect_archive(course_archive, paths)
    second = inspect_archive(course_archive, paths).inventory
    reused = [e for e in second["entries"] if any("already extracted" in n for n in e["notes"])]
    assert len(reused) >= 8
