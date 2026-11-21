"""Stage A — archive inspection, safe extraction and file inventory.

The original archive is opened read-only and never modified. Each entry is
validated before anything is written: absolute paths, ``..`` traversal,
symlinks, encrypted entries, oversize entries and suspicious compression
ratios are rejected and reported. Extraction streams bytes with hard limits
instead of trusting the sizes declared in the ZIP headers.
"""

from __future__ import annotations

import logging
import posixpath
import re
import stat
import zipfile
import zlib
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

from . import EXTRACTOR_VERSION, SCHEMA_VERSION
from .config import Paths, SafetyLimits
from .util import human_bytes, sha256_file, utc_now_iso, write_json_atomic, write_text_atomic

LOG = logging.getLogger("synapse_ingest.archive")

# --------------------------------------------------------------------------
# Classification
# --------------------------------------------------------------------------
SYSTEM_BASENAMES = {".ds_store", "thumbs.db", "desktop.ini", ".localized"}

CATEGORY_BY_EXTENSION: dict[str, str] = {
    ".pptx": "presentation",
    ".pptm": "presentation",
    ".ppsx": "presentation",
    ".potx": "presentation",
    ".ppt": "presentation_legacy",
    ".pps": "presentation_legacy",
    ".pot": "presentation_legacy",
    ".odp": "presentation_legacy",  # converted with LibreOffice, like .ppt
    ".pdf": "pdf_document",
    ".docx": "word_document",
    ".doc": "word_legacy",
    ".odt": "word_legacy",
    ".rtf": "word_legacy",
    ".epub": "ebook",
    ".html": "web_page",
    ".htm": "web_page",
    ".xhtml": "web_page",
    ".txt": "text_document",
    ".md": "text_document",
    ".csv": "text_document",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".gif": "image",
    ".svg": "image",
    ".webp": "image",
    ".bmp": "image",
    ".tif": "image",
    ".tiff": "image",
    ".ico": "web_asset",
    ".css": "web_asset",
    ".js": "web_asset",
    ".mjs": "web_asset",
    ".map": "web_asset",
    ".json": "web_asset",
    ".woff": "web_asset",
    ".woff2": "web_asset",
    ".ttf": "web_asset",
    ".otf": "web_asset",
    ".eot": "web_asset",
    ".mp4": "media",
    ".webm": "media",
    ".mov": "media",
    ".mp3": "media",
    ".wav": "media",
    ".m4a": "media",
    ".zip": "nested_archive",
    ".rar": "nested_archive",
    ".7z": "nested_archive",
    ".tar": "nested_archive",
    ".gz": "nested_archive",
    ".xlsx": "spreadsheet",
    ".xls": "spreadsheet",
    ".ods": "spreadsheet",
}

# Categories whose text the pipeline extracts (Stage C / D).
CONTENT_CATEGORIES = {
    "presentation",
    "presentation_legacy",
    "pdf_document",
    "word_document",
    "word_legacy",
    "ebook",
    "web_page",
    "text_document",
}

SIGNATURES: list[tuple[bytes, str]] = [
    (b"%PDF-", "pdf"),
    (b"PK\x03\x04", "zip_container"),  # pptx / docx / epub / xlsx / zip
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "ole2"),  # ppt / doc / xls
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpeg"),
    (b"GIF8", "gif"),
    (b"{\\rtf", "rtf"),
]

EXPECTED_SIGNATURE = {
    ".pdf": "pdf",
    ".pptx": "zip_container",
    ".pptm": "zip_container",
    ".ppsx": "zip_container",
    ".docx": "zip_container",
    ".epub": "zip_container",
    ".ppt": "ole2",
    ".doc": "ole2",
    ".png": "png",
    ".jpg": "jpeg",
    ".jpeg": "jpeg",
}

TEXTBOOK_NAME_RE = re.compile(r"(text\s*book|textbook|\bbook\b|edition|\bed\b|handbook|reference)", re.I)
LECTURE_NAME_RE = re.compile(r"(lecture|lect|\blec\b|slides?|\bweek\b|\bwk\b|unit|module|ppt|session|class)", re.I)


def classify(path: str) -> tuple[str, str]:
    """Return (category, extension) for an archive path."""
    pure = PurePosixPath(path)
    base = pure.name.lower()
    extension = pure.suffix.lower()
    if "__MACOSX" in pure.parts or base in SYSTEM_BASENAMES or base.startswith("._"):
        return "system_metadata", extension
    if base in {"index.html", "index.htm"}:
        return "weekly_overview_candidate", extension
    return CATEGORY_BY_EXTENSION.get(extension, "other"), extension


def sniff_signature(path: Path) -> str | None:
    try:
        with open(path, "rb") as handle:
            head = handle.read(16)
    except OSError:
        return None
    for magic, name in SIGNATURES:
        if head.startswith(magic):
            return name
    if head.lstrip().lower().startswith((b"<!doctype html", b"<html")):
        return "html"
    return None


# --------------------------------------------------------------------------
# Safety
# --------------------------------------------------------------------------
_DRIVE_RE = re.compile(r"^[A-Za-z]:")


def normalized_entry_path(name: str) -> str:
    return name.replace("\\", "/")


def entry_rejection_reasons(info: zipfile.ZipInfo, limits: SafetyLimits) -> list[str]:
    """Return why an entry must not be extracted (empty list = safe)."""
    reasons: list[str] = []
    name = normalized_entry_path(info.filename)
    if "\x00" in name:
        reasons.append("NUL byte in entry name")
    if name.startswith("/") or _DRIVE_RE.match(name):
        reasons.append("absolute path")
    if ".." in PurePosixPath(name).parts:
        reasons.append("path traversal ('..' component)")
    if len(name) > limits.max_path_length:
        reasons.append(f"path longer than {limits.max_path_length} characters")
    mode = (info.external_attr >> 16) & 0xFFFF
    if mode and stat.S_ISLNK(mode):
        reasons.append("symbolic link entry")
    if info.flag_bits & 0x1:
        reasons.append("encrypted entry (password-protected files are unsupported)")
    if info.file_size > limits.max_entry_uncompressed:
        reasons.append(f"uncompressed size {human_bytes(info.file_size)} exceeds per-file limit")
    if (
        info.file_size >= limits.ratio_min_size
        and info.compress_size > 0
        and info.file_size / info.compress_size > limits.max_compression_ratio
    ):
        reasons.append(
            f"suspicious compression ratio {info.file_size / info.compress_size:.0f}:1 (possible zip bomb)"
        )
    return reasons


class ExtractionLimitError(RuntimeError):
    pass


def _safe_destination(root: Path, entry_name: str) -> Path:
    relative = posixpath.normpath(normalized_entry_path(entry_name)).lstrip("/")
    destination = (root / relative).resolve()
    if not destination.is_relative_to(root.resolve()):
        raise ExtractionLimitError(f"entry escapes extraction root: {entry_name}")
    return destination


def _crc32_file(path: Path) -> int:
    value = 0
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            value = zlib.crc32(block, value)
    return value & 0xFFFFFFFF


def _stream_extract(zf: zipfile.ZipFile, info: zipfile.ZipInfo, destination: Path, budget: int) -> int:
    """Copy one entry with a hard byte budget; returns bytes written."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp = destination.with_name(destination.name + ".partial")
    written = 0
    limit = min(budget, info.file_size + 1024)  # never trust the header blindly
    try:
        with zf.open(info) as source, open(tmp, "wb") as target:
            while True:
                block = source.read(1 << 20)
                if not block:
                    break
                written += len(block)
                if written > limit:
                    raise ExtractionLimitError(
                        f"{info.filename}: decompressed data exceeded declared size/budget"
                    )
                target.write(block)
        tmp.replace(destination)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return written


# --------------------------------------------------------------------------
# Inventory
# --------------------------------------------------------------------------
@dataclass
class InventoryResult:
    inventory: dict[str, Any]
    extraction_root: Path
    issues: list[dict[str, str]] = field(default_factory=list)


def _pdf_probe(path: Path) -> dict[str, Any]:
    """Cheap PDF facts used for textbook identification."""
    try:
        import pymupdf
    except ImportError:  # pragma: no cover - dependency documented in requirements
        return {"probe_error": "pymupdf not installed"}
    try:
        with pymupdf.open(path) as doc:
            if doc.needs_pass:
                return {"probe_error": "PDF is password protected", "encrypted": True}
            page_count = doc.page_count
            landscape = 0
            sample = range(min(page_count, 20))
            for index in sample:
                rect = doc[index].rect
                if rect.width > rect.height:
                    landscape += 1
            toc = doc.get_toc(simple=True)
            return {
                "page_count": page_count,
                "outline_entries": len(toc),
                "landscape_ratio": round(landscape / max(1, len(sample)), 2),
                "pdf_title": (doc.metadata or {}).get("title") or None,
            }
    except Exception as exc:  # corrupt PDFs must be reported, not crash the inventory
        return {"probe_error": f"{type(exc).__name__}: {exc}"}


def _score_textbook(entry: dict[str, Any]) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    probe = entry.get("probe", {})
    name = PurePosixPath(entry["path"]).name
    pages = probe.get("page_count") or 0
    if entry["category"] == "ebook":
        score += 3
        reasons.append("EPUB e-book format (+3)")
    if pages >= 150:
        score += 3
        reasons.append(f"{pages} pages (+3)")
    elif pages >= 80:
        score += 2
        reasons.append(f"{pages} pages (+2)")
    elif pages >= 40:
        score += 1
        reasons.append(f"{pages} pages (+1)")
    if TEXTBOOK_NAME_RE.search(name):
        score += 2
        reasons.append("filename suggests a book (+2)")
    if (probe.get("outline_entries") or 0) >= 5:
        score += 1
        reasons.append("PDF outline with chapters (+1)")
    if (probe.get("landscape_ratio") or 0) >= 0.6:
        score -= 2
        reasons.append("mostly landscape pages, looks like exported slides (-2)")
    if LECTURE_NAME_RE.search(name):
        score -= 2
        reasons.append("filename suggests lecture material (-2)")
    return score, reasons


def inspect_archive(
    archive_path: Path,
    paths: Paths,
    *,
    limits: SafetyLimits | None = None,
    extract: bool = True,
    overview_override: str | None = None,
    textbook_override: str | None = None,
) -> InventoryResult:
    limits = limits or SafetyLimits()
    paths.ensure()
    archive_path = archive_path.resolve()
    LOG.info("Hashing archive %s", archive_path)
    archive_sha = sha256_file(archive_path)
    extraction_root = paths.extracted / archive_sha[:16]
    extraction_root.mkdir(parents=True, exist_ok=True)

    issues: list[dict[str, str]] = []
    entries: list[dict[str, Any]] = []
    total_written = 0

    with zipfile.ZipFile(archive_path) as zf:
        infos = zf.infolist()
        if len(infos) > limits.max_entries:
            raise ExtractionLimitError(f"archive has {len(infos)} entries; limit is {limits.max_entries}")
        declared_total = sum(i.file_size for i in infos)
        if declared_total > limits.max_total_uncompressed:
            raise ExtractionLimitError(
                f"archive declares {human_bytes(declared_total)} uncompressed; limit is "
                f"{human_bytes(limits.max_total_uncompressed)}"
            )

        for info in infos:
            name = normalized_entry_path(info.filename)
            if info.is_dir():
                continue
            category, extension = classify(name)
            entry: dict[str, Any] = {
                "path": name,
                "filename": PurePosixPath(name).name,
                "extension": extension,
                "category": category,
                "size_bytes": info.file_size,
                "compressed_bytes": info.compress_size,
                "crc32": f"{info.CRC:08x}",
                "modified": "%04d-%02d-%02dT%02d:%02d:%02d" % info.date_time,
                "status": "pending",
                "sha256": None,
                "extracted_path": None,
                "signature": None,
                "notes": [],
            }
            reasons = entry_rejection_reasons(info, limits)
            if reasons:
                entry["status"] = "rejected"
                entry["notes"].extend(reasons)
                issues.append({"severity": "error", "path": name, "message": "; ".join(reasons)})
                entries.append(entry)
                continue
            if category == "system_metadata":
                entry["status"] = "skipped"
                entry["notes"].append("operating-system metadata file; not course material")
                entries.append(entry)
                continue
            if not extract:
                entry["status"] = "not_extracted"
                entries.append(entry)
                continue

            destination = _safe_destination(extraction_root, name)
            try:
                if (
                    destination.exists()
                    and destination.stat().st_size == info.file_size
                    and _crc32_file(destination) == info.CRC
                ):
                    entry["status"] = "extracted"
                    entry["notes"].append("already extracted (CRC verified); reused")
                else:
                    budget = limits.max_total_uncompressed - total_written
                    total_written += _stream_extract(zf, info, destination, budget)
                    entry["status"] = "extracted"
            except (zipfile.BadZipFile, ExtractionLimitError, OSError, NotImplementedError) as exc:
                entry["status"] = "failed"
                entry["notes"].append(f"extraction failed: {exc}")
                issues.append({"severity": "error", "path": name, "message": f"extraction failed: {exc}"})
                entries.append(entry)
                continue

            entry["extracted_path"] = str(destination.relative_to(paths.data))
            entry["sha256"] = sha256_file(destination)
            entry["signature"] = sniff_signature(destination)
            expected = EXPECTED_SIGNATURE.get(extension)
            if expected and entry["signature"] and entry["signature"] != expected and info.file_size:
                entry["notes"].append(
                    f"file signature '{entry['signature']}' does not match extension '{extension}'"
                )
                issues.append(
                    {
                        "severity": "warning",
                        "path": name,
                        "message": f"extension {extension} but content looks like {entry['signature']}",
                    }
                )
            if category == "pdf_document":
                entry["probe"] = _pdf_probe(destination)
                if entry["probe"].get("probe_error"):
                    entry["notes"].append(f"PDF probe: {entry['probe']['probe_error']}")
            if info.file_size == 0:
                entry["notes"].append("empty file")
                issues.append({"severity": "warning", "path": name, "message": "empty file"})
            entries.append(entry)

    # ---- duplicates (identical content under different paths) -------------
    by_hash: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        if entry["sha256"] and entry["size_bytes"] > 0:
            by_hash[entry["sha256"]].append(entry)
    duplicates = []
    for sha, group in sorted(by_hash.items()):
        if len(group) < 2:
            continue
        group_sorted = sorted(group, key=lambda e: (len(PurePosixPath(e["path"]).parts), e["path"]))
        primary = group_sorted[0]["path"]
        for other in group_sorted[1:]:
            other["duplicate_of"] = primary
            other["notes"].append(f"identical content to {primary}")
        duplicates.append({"sha256": sha, "paths": [e["path"] for e in group_sorted], "primary": primary})

    # ---- weekly overview (index.html) -------------------------------------
    overview_candidates = [e for e in entries if e["category"] == "weekly_overview_candidate"]
    selected_overview = None
    overview_reason = None
    if overview_override:
        match = next((e for e in entries if e["path"] == overview_override), None)
        if not match:
            raise FileNotFoundError(f"--overview {overview_override!r} is not an entry of the archive")
        selected_overview, overview_reason = match["path"], "selected manually (--overview)"
    elif overview_candidates:
        usable = [e for e in overview_candidates if e["status"] == "extracted"]
        if usable:
            best = min(usable, key=lambda e: (len(PurePosixPath(e["path"]).parts), e["path"]))
            selected_overview = best["path"]
            overview_reason = (
                "only index.html in archive"
                if len(overview_candidates) == 1
                else f"shallowest of {len(overview_candidates)} index.html files"
            )
    for entry in overview_candidates:
        entry["category"] = "weekly_overview" if entry["path"] == selected_overview else "web_page"
    if not selected_overview:
        issues.append({"severity": "error", "path": "", "message": "no index.html (Weekly Overview) found"})

    # ---- textbook identification (heuristic, recorded with reasons) --------
    textbook_candidates = []
    for entry in entries:
        if entry["status"] != "extracted" or entry.get("duplicate_of"):
            continue
        if entry["category"] in {"pdf_document", "ebook", "word_document"}:
            score, reasons = _score_textbook(entry)
            textbook_candidates.append({"path": entry["path"], "score": score, "reasons": reasons})
    textbook_candidates.sort(key=lambda c: (-c["score"], c["path"]))
    selected_textbook = None
    textbook_reason = None
    if textbook_override:
        if not any(e["path"] == textbook_override for e in entries):
            raise FileNotFoundError(f"--textbook {textbook_override!r} is not an entry of the archive")
        selected_textbook, textbook_reason = textbook_override, "selected manually (--textbook)"
    elif textbook_candidates and textbook_candidates[0]["score"] >= 3:
        selected_textbook = textbook_candidates[0]["path"]
        textbook_reason = "highest heuristic score: " + ", ".join(textbook_candidates[0]["reasons"])
    else:
        issues.append(
            {
                "severity": "warning",
                "path": "",
                "message": "no document scored as a textbook; use --textbook to choose one if it exists",
            }
        )

    for entry in entries:
        entry["document_role"] = _document_role(entry, selected_overview, selected_textbook)

    by_category = Counter(e["category"] for e in entries)
    by_extension = Counter(e["extension"] or "(none)" for e in entries)
    by_status = Counter(e["status"] for e in entries)

    inventory = {
        "schema_version": SCHEMA_VERSION,
        "extractor_version": EXTRACTOR_VERSION,
        "generated_at": utc_now_iso(),
        "archive": {
            "filename": archive_path.name,
            "size_bytes": archive_path.stat().st_size,
            "sha256": archive_sha,
            "entry_count": len(entries),
        },
        "extraction_root": str(extraction_root.relative_to(paths.data)),
        "summary": {
            "total_uncompressed_bytes": sum(e["size_bytes"] for e in entries),
            "by_category": dict(sorted(by_category.items())),
            "by_extension": dict(sorted(by_extension.items())),
            "by_status": dict(sorted(by_status.items())),
            "duplicate_groups": len(duplicates),
            "rejected": by_status.get("rejected", 0),
        },
        "weekly_overview": {
            "selected": selected_overview,
            "selection_reason": overview_reason,
            "candidates": [e["path"] for e in overview_candidates],
        },
        "textbook": {
            "selected": selected_textbook,
            "selection_reason": textbook_reason,
            "candidates": textbook_candidates,
        },
        "duplicates": duplicates,
        "issues": issues,
        "entries": sorted(entries, key=lambda e: e["path"]),
    }
    write_json_atomic(paths.inventory, inventory)
    write_text_atomic(paths.reports / "inventory_report.md", render_inventory_report(inventory))
    LOG.info(
        "Inventory: %d entries, %d extracted, %d rejected, %d duplicate groups",
        len(entries),
        by_status.get("extracted", 0),
        by_status.get("rejected", 0),
        len(duplicates),
    )
    return InventoryResult(inventory=inventory, extraction_root=extraction_root, issues=issues)


def _document_role(entry: dict[str, Any], overview: str | None, textbook: str | None) -> str | None:
    path = entry["path"]
    if path == overview:
        return "weekly_overview"
    if path == textbook:
        return "textbook"
    category = entry["category"]
    if category in {"presentation", "presentation_legacy"}:
        return "presentation"
    if category == "pdf_document":
        probe = entry.get("probe", {})
        if (probe.get("landscape_ratio") or 0) >= 0.6 or LECTURE_NAME_RE.search(entry["filename"]):
            return "lecture_slides_pdf"
        return "supporting_document"
    if category in CONTENT_CATEGORIES:
        return "supporting_document"
    return None


def render_inventory_report(inventory: dict[str, Any]) -> str:
    archive = inventory["archive"]
    summary = inventory["summary"]
    lines = [
        "# Archive inventory report",
        "",
        f"Generated: {inventory['generated_at']}",
        "",
        f"- Archive: `{archive['filename']}` ({human_bytes(archive['size_bytes'])})",
        f"- SHA-256: `{archive['sha256']}`",
        f"- Entries: {archive['entry_count']} files, "
        f"{human_bytes(summary['total_uncompressed_bytes'])} uncompressed",
        f"- Weekly Overview: `{inventory['weekly_overview']['selected'] or 'NOT FOUND'}`"
        + (f" ({inventory['weekly_overview']['selection_reason']})" if inventory["weekly_overview"]["selected"] else ""),
        f"- Textbook: `{inventory['textbook']['selected'] or 'not identified'}`"
        + (f" — {inventory['textbook']['selection_reason']}" if inventory["textbook"]["selected"] else ""),
        "",
        "## Files by category",
        "",
        "| Category | Count |",
        "|---|---|",
    ]
    lines += [f"| {k} | {v} |" for k, v in summary["by_category"].items()]
    lines += ["", "## Files by extension", "", "| Extension | Count |", "|---|---|"]
    lines += [f"| {k} | {v} |" for k, v in summary["by_extension"].items()]
    lines += ["", "## Extraction status", "", "| Status | Count |", "|---|---|"]
    lines += [f"| {k} | {v} |" for k, v in summary["by_status"].items()]
    if inventory["issues"]:
        lines += ["", "## Issues", "", "| Severity | Path | Message |", "|---|---|---|"]
        lines += [f"| {i['severity']} | `{i['path']}` | {i['message']} |" for i in inventory["issues"]]
    if inventory["duplicates"]:
        lines += ["", "## Duplicate files (identical SHA-256)", ""]
        for group in inventory["duplicates"]:
            lines.append(f"- `{group['sha256'][:12]}…`: " + ", ".join(f"`{p}`" for p in group["paths"]))
    lines += ["", "## All entries", "", "| Path | Category | Size | Status | Notes |", "|---|---|---|---|---|"]
    for entry in inventory["entries"]:
        notes = "; ".join(entry["notes"])
        lines.append(
            f"| `{entry['path']}` | {entry['category']} | {human_bytes(entry['size_bytes'])} | "
            f"{entry['status']} | {notes} |"
        )
    return "\n".join(lines) + "\n"
