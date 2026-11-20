"""Stage E — unified source index, content units, chunks and coverage report.

Combines the inventory (A), Weekly Overview (B), presentations (C) and
documents (D) into one standardised structure. Every content unit and chunk
carries: unique ID, subject key, document ID, original filename, document
type, week association (with its evidence), chapter association, slide/page
number, text, content hash, extraction status and processing timestamp.

Association evidence levels (mirrored in the database):
- ``source_confirmed`` — stated by the uploaded material (an overview link,
  a PDF outline entry)
- ``unverified``       — inferred heuristically (e.g. "Week 3" in a filename)
"""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from pathlib import PurePosixPath
from typing import Any

from . import EXTRACTOR_VERSION, SCHEMA_VERSION
from .archive import CONTENT_CATEGORIES
from .chunking import DEFAULT_CONFIG, ChunkConfig, chunk_text
from .config import Paths
from .status import Status, StatusTracker
from .util import (
    estimate_tokens,
    human_bytes,
    read_json,
    sha256_text,
    slugify,
    stable_id,
    utc_now_iso,
    word_count,
    write_json_atomic,
    write_jsonl_atomic,
    write_text_atomic,
)

LOG = logging.getLogger("synapse_ingest.index")

WEEK_IN_PATH_RE = re.compile(r"(?:^|[^a-z])(?:week|wk)[\s_\-.]*0*(\d{1,2})(?!\d)", re.I)
ARCHIVE_STAMP_RE = re.compile(r"[-_ ]?\d{4}-[A-Za-z]{3}-\d{1,2}_\d{2}-\d{2}-\d{2}(?:-\d+)?$")
NON_DOCUMENT_REASONS = {
    "image": "image asset (no text extraction; referenced from pages/slides)",
    "web_asset": "web asset used by HTML pages (styles, scripts, fonts)",
    "media": "audio/video is not transcribed in this version",
    "nested_archive": "nested archive not expanded; extract it and add its files",
    "spreadsheet": "spreadsheets are not extracted in this version",
    "other": "unrecognised file type",
}


def derive_subject_name(inventory: dict[str, Any], overview: dict[str, Any] | None) -> tuple[str, str]:
    if overview:
        for key in ("title", "heading_title"):
            value = (overview.get(key) or "").strip()
            value = re.sub(r"^(course|subject)\s*:\s*", "", value, flags=re.I)
            if value and value.lower() not in {"index", "home", "course"}:
                return value, f"overview_{key}"
    stem = PurePosixPath(inventory["archive"]["filename"]).stem
    stem = ARCHIVE_STAMP_RE.sub("", stem)
    name = re.sub(r"[-_]+", " ", stem).strip()
    return (name[:1].upper() + name[1:]) if name else "Untitled subject", "archive_filename"


def _citation_slide(filename: str, slide: int, title: str | None) -> str:
    return f"{filename}, slide {slide}" + (f" — {title}" if title else "")


def _citation_page(filename: str, page_number: int, label: str | None, printed: str | None) -> str:
    if label and label != str(page_number):
        return f"{filename}, p. {label} (PDF page {page_number})"
    if label:
        return f"{filename}, p. {label}"
    if printed and printed != str(page_number):
        return f"{filename}, PDF page {page_number} (printed page {printed})"
    return f"{filename}, PDF page {page_number}"


def _citation_section(filename: str, unit: dict[str, Any]) -> str:
    path = " › ".join(unit.get("heading_path") or ([unit["title"]] if unit.get("title") else []))
    location = unit.get("location") or {}
    if "paragraph_start" in location:
        where = f"paragraphs {location['paragraph_start']}–{location['paragraph_end']}"
    else:
        where = f"section {unit.get('section_number')}"
    page = f", p. {unit['page_label']}" if unit.get("page_label") else ""
    return f"{filename}, {path or where}{page}"


def build_source_index(
    paths: Paths,
    *,
    subject_name: str | None = None,
    subject_slug: str | None = None,
    chunk_config: ChunkConfig = DEFAULT_CONFIG,
) -> dict[str, Any]:
    inventory = read_json(paths.inventory)
    overview = read_json(paths.weekly_overview) if paths.weekly_overview.exists() else None
    tracker = StatusTracker(paths.status)
    processed_at = utc_now_iso()

    if subject_name:
        name, name_source = subject_name, "manual"
    else:
        name, name_source = derive_subject_name(inventory, overview)
    slug = subject_slug or slugify(name)

    extractions: dict[str, dict[str, Any]] = {}
    for folder in (paths.presentations_dir, paths.documents_dir):
        for path in sorted(folder.glob("*.json")):
            data = read_json(path)
            extractions[data["doc_key"]] = data

    # ---------------------------------------------------------------- weeks
    weeks: list[dict[str, Any]] = []
    week_by_number: dict[int, dict[str, Any]] = {}
    for week in (overview or {}).get("weeks", []):
        record = {
            "id": stable_id("week", slug, str(week["ordinal"])),
            "key": week["id"],
            "ordinal": week["ordinal"],
            "label": week["label"],
            "label_kind": week["label_kind"],
            "week_number": week["week_number"],
            "week_number_source": week["week_number_source"],
            "date_range": week["date_range"],
            "topics": week["topics"],
            "learning_objectives": week["learning_objectives"],
            "references": week["references"],
            "resources": week["resources"],
            "items": week["items"],
            "origin": "source_confirmed",
            "document_ids": [],
        }
        weeks.append(record)
        if week["week_number"] is not None and week["week_number"] not in week_by_number:
            week_by_number[week["week_number"]] = record

    # ------------------------------------------------------------ documents
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in inventory["entries"]:
        if entry["status"] == "extracted" and entry.get("sha256"):
            groups[entry["sha256"]].append(entry)

    overview_path = inventory["weekly_overview"]["selected"]
    documents: list[dict[str, Any]] = []
    doc_by_path: dict[str, dict[str, Any]] = {}
    for sha, entries in sorted(groups.items(), key=lambda kv: kv[1][0]["path"]):
        primary = next((e for e in entries if not e.get("duplicate_of")), entries[0])
        is_overview = overview_path in {e["path"] for e in entries}
        if not is_overview and primary["category"] not in CONTENT_CATEGORIES:
            continue
        extraction = extractions.get(sha)
        if is_overview:
            document_type = "weekly_overview"
        elif extraction:
            document_type = extraction.get("document_role") or primary.get("document_role") or "supporting_document"
        else:
            document_type = primary.get("document_role") or "supporting_document"
        status = tracker.overall_status(sha)
        stage_records = tracker.data["documents"].get(sha, {}).get("stages", {})
        errors = [r.get("error") for r in stage_records.values() if r.get("error")]
        warnings = [w for r in stage_records.values() for w in r.get("warnings", [])]
        document = {
            "id": stable_id("document", slug, sha),
            "doc_key": sha,
            "original_filename": primary["filename"],
            "source_path": primary["path"],
            "archive_paths": sorted(e["path"] for e in entries),
            "document_type": document_type,
            "category": primary["category"],
            "format": (extraction or {}).get("format") or primary["extension"].lstrip("."),
            "mime_signature": primary.get("signature"),
            "size_bytes": primary["size_bytes"],
            "title": (extraction or {}).get("title"),
            "title_source": (extraction or {}).get("title_source"),
            "page_count": (extraction or {}).get("page_count"),
            "slide_count": (extraction or {}).get("slide_count"),
            "word_count": (extraction or {}).get("word_count"),
            "chapters": (extraction or {}).get("chapters", []),
            "converted_from": (extraction or {}).get("converted_from"),
            "quality": (extraction or {}).get("quality"),
            "processing_status": status,
            "errors": errors,
            "warnings": warnings,
            "extractor_version": (extraction or {}).get("extractor_version", EXTRACTOR_VERSION),
            "processed_at": (extraction or {}).get("processed_at"),
            "week_associations": [],
        }
        documents.append(document)
        for entry in entries:
            doc_by_path[entry["path"]] = document

    # ------------------------------------------------- week ↔ document links
    def associate(document: dict[str, Any], week: dict[str, Any], source: str, verification: str, evidence: str) -> None:
        if any(a["week_ordinal"] == week["ordinal"] and a["source"] == source for a in document["week_associations"]):
            return
        document["week_associations"].append(
            {
                "week_id": week["id"],
                "week_ordinal": week["ordinal"],
                "source": source,
                "verification": verification,
                "evidence": evidence,
            }
        )
        if document["id"] not in week["document_ids"]:
            week["document_ids"].append(document["id"])

    for week in weeks:
        for resource in week["resources"]:
            targets: list[str] = []
            if resource["kind"] == "internal":
                targets = [resource["resolved_path"]]
            elif resource["kind"] == "folder":
                targets = resource.get("files", [])
            for target in targets:
                document = doc_by_path.get(target)
                if document and document["document_type"] != "weekly_overview":
                    associate(document, week, "overview_link", "source_confirmed", f"linked from overview: {resource['text']!r}")
                    resource["document_id"] = document["id"]

    for document in documents:
        if document["document_type"] in {"weekly_overview", "textbook"}:
            continue
        for archive_path in document["archive_paths"]:
            for match in WEEK_IN_PATH_RE.finditer(archive_path):
                week = week_by_number.get(int(match.group(1)))
                if week and not any(a["week_ordinal"] == week["ordinal"] for a in document["week_associations"]):
                    associate(document, week, "filename_pattern", "unverified", f"'{match.group(0).strip()}' in {archive_path}")

    # -------------------------------------------------------- units + chunks
    units: list[dict[str, Any]] = []
    chunks: list[dict[str, Any]] = []
    for document in documents:
        extraction = extractions.get(document["doc_key"])
        if not extraction:
            continue
        week_ordinals = sorted({a["week_ordinal"] for a in document["week_associations"]})
        filename = document["original_filename"]
        base = {
            "subject_key": slug,
            "document_id": document["id"],
            "doc_key": document["doc_key"],
            "original_filename": filename,
            "source_path": document["source_path"],
            "document_type": document["document_type"],
            "week_ordinals": week_ordinals,
            "extraction_status": extraction.get("status", Status.COMPLETED.value),
            "processed_at": extraction.get("processed_at") or processed_at,
        }
        chunk_index = 0
        raw_units: list[dict[str, Any]] = []
        if "slides" in extraction:
            for slide in extraction["slides"]:
                text = slide.get("text", "")
                raw_units.append(
                    {
                        "unit_type": "slide",
                        "unit_number": slide["slide_number"],
                        "slide_number": slide["slide_number"],
                        "title": slide.get("title"),
                        "display_title": slide.get("display_title"),
                        "heading_path": [],
                        "chapter": None,
                        "text": text,
                        "notes": slide.get("notes", ""),
                        "flags": {
                            "hidden": slide.get("hidden", False),
                            "images_available": slide.get("images_available", False),
                            "has_content_images": slide.get("has_content_images", False),
                            "has_table": slide.get("has_table", False),
                            "has_chart": slide.get("has_chart", False),
                            "has_diagram": slide.get("has_diagram", False),
                            "has_equation": slide.get("has_equation", False),
                            "formula_heavy": slide.get("formula_heavy", False),
                            "extraction_error": bool(slide.get("extraction_error")),
                        },
                        "annotations": slide.get("annotations", {}),
                        "citation": _citation_slide(filename, slide["slide_number"], slide.get("display_title")),
                    }
                )
        else:
            for unit in extraction.get("units", []):
                if unit["unit_type"] == "page":
                    citation = _citation_page(
                        filename, unit["page_number"], unit.get("page_label"), unit.get("detected_printed_page")
                    )
                    number = unit["page_number"]
                    title = (unit.get("headings") or [{}])[0].get("text")
                else:
                    citation = _citation_section(filename, unit)
                    number = unit["section_number"]
                    title = unit.get("title")
                raw_units.append(
                    {
                        "unit_type": unit["unit_type"],
                        "unit_number": number,
                        "page_number": unit.get("page_number"),
                        "page_label": unit.get("page_label"),
                        "detected_printed_page": unit.get("detected_printed_page"),
                        "location": unit.get("location"),
                        "title": title,
                        "display_title": title,
                        "heading_path": unit.get("heading_path") or [],
                        "chapter": unit.get("chapter"),
                        "text": unit.get("text", ""),
                        "notes": "",
                        "flags": {
                            "needs_ocr": unit.get("needs_ocr", False),
                            "blank": unit.get("blank", False),
                            "formula_heavy": (unit.get("formula_density") or 0) >= 0.3,
                        },
                        "annotations": unit.get("annotations", {}),
                        "citation": citation,
                    }
                )

        for raw in raw_units:
            full_text = "\n\n".join(p for p in [raw.get("title") or "", raw["text"]] if p).strip()
            unit_id = stable_id("unit", document["id"], raw["unit_type"], str(raw["unit_number"]))
            unit = {
                "id": unit_id,
                **base,
                **raw,
                "content_hash": sha256_text(full_text + "\n" + raw.get("notes", "")),
                "word_count": word_count(full_text) + word_count(raw.get("notes", "")),
            }
            units.append(unit)
            if raw["unit_type"] == "slide":
                body = raw["text"]
                if raw.get("notes"):
                    body = f"{body}\n\nSpeaker notes: {raw['notes']}" if body else f"Speaker notes: {raw['notes']}"
                pieces = chunk_text(body, chunk_config) if word_count(body) > chunk_config.hard_max_words else [body]
            else:
                pieces = chunk_text(raw["text"], chunk_config)
            heading = raw.get("display_title") or (raw["heading_path"][-1] if raw["heading_path"] else None)
            for piece_index, piece in enumerate(p for p in pieces if p.strip() or raw.get("title")):
                content = piece.strip()
                if raw["unit_type"] == "slide" and raw.get("title") and piece_index == 0:
                    content = f"{raw['title']}\n\n{content}".strip()
                if not content:
                    continue
                chunks.append(
                    {
                        "id": stable_id("chunk", document["id"], str(chunk_index)),
                        **base,
                        "unit_id": unit_id,
                        "chunk_index": chunk_index,
                        "unit_type": raw["unit_type"],
                        "slide_number": raw.get("slide_number"),
                        "page_number": raw.get("page_number"),
                        "page_label": raw.get("page_label"),
                        "section_number": raw["unit_number"] if raw["unit_type"] == "section" else None,
                        "heading": heading,
                        "heading_path": raw["heading_path"],
                        "chapter_title": (raw.get("chapter") or {}).get("title"),
                        "content": content,
                        "content_hash": sha256_text(content),
                        "word_count": word_count(content),
                        "token_estimate": estimate_tokens(content),
                        "low_information": word_count(content) < 8,
                        "citation": raw["citation"],
                    }
                )
                chunk_index += 1
        document["unit_count"] = len(raw_units)
        document["chunk_count"] = chunk_index

    # ------------------------------------------------------------ all files
    files = []
    for entry in inventory["entries"]:
        document = doc_by_path.get(entry["path"])
        if entry["status"] == "rejected":
            state, reason = "rejected", "; ".join(entry["notes"])
        elif entry["status"] == "skipped":
            state, reason = "skipped", "; ".join(entry["notes"])
        elif entry["status"] == "failed":
            state, reason = "failed", "; ".join(entry["notes"])
        elif document:
            state = document["processing_status"] if document["document_type"] != "weekly_overview" else (
                tracker.overall_status(document["doc_key"])
            )
            if entry.get("duplicate_of"):
                reason = "duplicate of " + entry["duplicate_of"]
            elif document["errors"]:
                reason = "; ".join(document["errors"])
            else:
                reason = None
        else:
            state, reason = "not_applicable", NON_DOCUMENT_REASONS.get(entry["category"], "not a study document")
        files.append(
            {
                "path": entry["path"],
                "filename": entry["filename"],
                "category": entry["category"],
                "extension": entry["extension"],
                "size_bytes": entry["size_bytes"],
                "sha256": entry.get("sha256"),
                "document_id": document["id"] if document else None,
                "processing_status": state,
                "reason": reason,
            }
        )

    coverage = build_coverage(weeks, documents, overview, inventory)
    stats = {
        "documents": len(documents),
        "content_units": len(units),
        "chunks": len(chunks),
        "slides": sum(1 for u in units if u["unit_type"] == "slide"),
        "pages": sum(1 for u in units if u["unit_type"] == "page"),
        "sections": sum(1 for u in units if u["unit_type"] == "section"),
        "words": sum(u["word_count"] for u in units),
        "by_status": dict(sorted(_count(d["processing_status"] for d in documents).items())),
        "by_type": dict(sorted(_count(d["document_type"] for d in documents).items())),
    }
    index = {
        "schema_version": SCHEMA_VERSION,
        "extractor_version": EXTRACTOR_VERSION,
        "generated_at": processed_at,
        "subject": {
            "key": slug,
            "name": name,
            "name_source": name_source,
            "archive_filename": inventory["archive"]["filename"],
            "archive_sha256": inventory["archive"]["sha256"],
        },
        "weekly_overview": {
            "source_file": (overview or {}).get("source_file"),
            "title": (overview or {}).get("title"),
            "parser_strategy": (overview or {}).get("parser_strategy"),
            "warnings": (overview or {}).get("warnings", []),
            "other_sections": [
                {"label": s["label"], "label_kind": s["label_kind"], "topics": s["topics"], "resources": s["resources"]}
                for s in (overview or {}).get("other_sections", [])
            ],
        },
        "textbook": inventory["textbook"],
        "stats": stats,
        "coverage": coverage,
        "weeks": weeks,
        "documents": documents,
        "files": files,
    }
    write_json_atomic(paths.source_index, index)
    write_jsonl_atomic(paths.content_units, units)
    write_jsonl_atomic(paths.chunks, chunks)
    write_text_atomic(paths.reports / "processing_report.md", render_processing_report(index))
    LOG.info(
        "Source index: %d documents, %d units, %d chunks, %d weeks",
        len(documents),
        len(units),
        len(chunks),
        len(weeks),
    )
    return index


def _count(values: Any) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for value in values:
        counts[value] += 1
    return dict(counts)


def build_coverage(
    weeks: list[dict[str, Any]],
    documents: list[dict[str, Any]],
    overview: dict[str, Any] | None,
    inventory: dict[str, Any],
) -> dict[str, Any]:
    lecture_types = {"presentation", "lecture_slides_pdf"}
    usable_states = {Status.COMPLETED.value, Status.PARTIAL.value}
    week_rows = []
    for week in weeks:
        linked = [d for d in documents if d["id"] in week["document_ids"]]
        usable = [d for d in linked if d["processing_status"] in usable_states]
        confirmed = [
            d for d in usable if any(a["week_ordinal"] == week["ordinal"] and a["verification"] == "source_confirmed" for a in d["week_associations"])
        ]
        has_refs = bool(week["references"])
        week_rows.append(
            {
                "week_id": week["id"],
                "ordinal": week["ordinal"],
                "label": week["label"],
                "overview_reference": True,
                # Only usable (processed) files count as available material.
                "lecture_material": any(d["document_type"] in lecture_types for d in usable),
                "lecture_material_confirmed": any(d["document_type"] in lecture_types for d in confirmed),
                "lecture_material_failed": any(
                    d["document_type"] in lecture_types and d["processing_status"] == Status.FAILED.value for d in linked
                ),
                "textbook_reference_in_overview": has_refs,
                "document_count": len(linked),
                "missing_material": not usable,
                "needs_verification": any(
                    a["verification"] != "source_confirmed"
                    for d in linked
                    for a in d["week_associations"]
                    if a["week_ordinal"] == week["ordinal"]
                ),
            }
        )
    unlinked = [
        {"document_id": d["id"], "filename": d["original_filename"], "document_type": d["document_type"]}
        for d in documents
        if d["document_type"] in lecture_types and not d["week_associations"]
    ]
    return {
        "weeks": week_rows,
        "weeks_with_lecture_material": sum(1 for row in week_rows if row["lecture_material"]),
        "weeks_without_material": [row["label"] for row in week_rows if row["missing_material"]],
        "lecture_documents_not_in_overview": unlinked,
        "unresolved_overview_links": (overview or {}).get("unresolved_links", []),
        "failed_documents": [d["original_filename"] for d in documents if d["processing_status"] == Status.FAILED.value],
        "partial_documents": [d["original_filename"] for d in documents if d["processing_status"] == Status.PARTIAL.value],
        "textbook_identified": bool(inventory["textbook"]["selected"]),
    }


def render_processing_report(index: dict[str, Any]) -> str:
    subject = index["subject"]
    stats = index["stats"]
    coverage = index["coverage"]
    lines = [
        "# Source processing report",
        "",
        f"Generated: {index['generated_at']} · extractor {index['extractor_version']}",
        "",
        f"**Subject:** {subject['name']} _(name from {subject['name_source']})_",
        "",
        f"- Documents: {stats['documents']} · content units: {stats['content_units']} "
        f"(slides {stats['slides']}, pages {stats['pages']}, sections {stats['sections']}) · chunks: {stats['chunks']}",
        f"- Words extracted: {stats['words']:,}",
        f"- Teaching sections from the Weekly Overview: {len(index['weeks'])} "
        f"({coverage['weeks_with_lecture_material']} with lecture material)",
        f"- Textbook: {index['textbook']['selected'] or 'not identified'}",
        "",
        "## Documents",
        "",
        "| File | Type | Size | Status | Slides/Pages | Chunks | Weeks | Notes |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for document in index["documents"]:
        count = document.get("slide_count") or document.get("page_count") or "—"
        weeks = ", ".join(
            f"{a['week_ordinal']}{'' if a['verification'] == 'source_confirmed' else '?'}" for a in document["week_associations"]
        ) or "—"
        notes = "; ".join((document["errors"] + document["warnings"])[:3]).replace("\n", " ")
        lines.append(
            f"| `{document['original_filename']}` | {document['document_type']} | {human_bytes(document['size_bytes'])} | "
            f"**{document['processing_status']}** | {count} | {document.get('chunk_count', 0)} | {weeks} | {notes} |"
        )
    lines += ["", "_Week numbers followed by `?` are unverified (inferred from filenames)._", "", "## Coverage", ""]
    if coverage["weeks_without_material"]:
        lines.append("- Weeks without any linked material: " + "; ".join(coverage["weeks_without_material"]))
    if coverage["lecture_documents_not_in_overview"]:
        lines.append(
            "- Lecture files not linked from the overview: "
            + ", ".join(f"`{d['filename']}`" for d in coverage["lecture_documents_not_in_overview"])
        )
    if coverage["unresolved_overview_links"]:
        lines.append(f"- Unresolved overview links: {len(coverage['unresolved_overview_links'])}")
        for link in coverage["unresolved_overview_links"][:20]:
            lines.append(f"  - `{link['href']}` — {link.get('reason')}")
    if coverage["failed_documents"]:
        lines.append("- **Failed:** " + ", ".join(f"`{f}`" for f in coverage["failed_documents"]))
    if coverage["partial_documents"]:
        lines.append("- Partially processed: " + ", ".join(f"`{f}`" for f in coverage["partial_documents"]))
    not_processed = [f for f in index["files"] if f["processing_status"] in {"rejected", "failed"}]
    if not_processed:
        lines += ["", "## Files not processed", ""]
        lines += [f"- `{f['path']}` — {f['processing_status']}: {f['reason']}" for f in not_processed]
    return "\n".join(lines) + "\n"
