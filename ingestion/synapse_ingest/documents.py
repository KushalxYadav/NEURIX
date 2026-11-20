"""Stage D — textbook and document extraction (PDF, DOCX, EPUB, HTML, text).

PDF pages keep two numbers: ``page_number`` (1-based physical position in the
file) and ``page_label`` (the printed label defined in the PDF, e.g. "xii" or
"45"), plus a ``detected_printed_page`` read from the running header/footer
when the PDF defines no labels. DOCX and EPUB have no fixed pagination, so
their locations are paragraph/section based and page numbers are never
invented.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any

from bs4 import BeautifulSoup

from . import EXTRACTOR_VERSION, SCHEMA_VERSION
from .annotate import annotate_text, formula_density
from .common import SourceDocument, run_document_stage, unique_documents
from .config import Paths
from .convert import convert_with_libreoffice
from .overview import linearize
from .status import Status, StatusTracker
from .util import normalize_whitespace, read_json, single_line, utc_now_iso, word_count

LOG = logging.getLogger("synapse_ingest.documents")

DOCUMENT_CATEGORIES = {"pdf_document", "word_document", "word_legacy", "ebook", "web_page", "text_document"}
BULLET_START_RE = re.compile(r"^\s*(?:[•●▪◦‣\-–*]|\d{1,3}[.)]|[a-z][.)]|\([a-z0-9]{1,3}\))\s")
PAGE_NUMBER_RE = re.compile(r"^\s*(?:page\s+)?(\d{1,4}|[ivxlcdm]{1,7})\s*$", re.I)
CHAPTER_HEAD_RE = re.compile(r"^\s*(chapter|unit|part|module)\s+(\d{1,3}|[ivxlcdm]{1,6})\b[\s.:\-–]*(.*)$", re.I)
PAGE_SENTINEL_RE = re.compile(r"\u27e6page:([^\u27e7]*)\u27e7")
NUMBERED_HEAD_RE = re.compile(r"^\s*(\d{1,2}(?:\.\d{1,2}){0,3})\s+([A-Z][^\n]{2,100})$")


# --------------------------------------------------------------------------
# PDF
# --------------------------------------------------------------------------
def _join_lines(lines: list[str]) -> str:
    """Join wrapped lines into prose, keeping bullets on their own line."""
    out = ""
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if not out:
            out = line
        elif BULLET_START_RE.match(line):
            out += "\n" + line
        elif out.endswith("-") and line[:1].islower():
            out = out[:-1] + line  # de-hyphenate "exam-\nple"
        else:
            out += " " + line
    return out


def _margin_key(text: str) -> str:
    return re.sub(r"\d+", "#", text.strip().lower())


def _outline_paths(toc: list[list[Any]], page_count: int) -> tuple[list[dict[str, Any]], list[list[str]]]:
    outline = []
    for level, title, page in toc:
        if not isinstance(page, int) or page < 1 or page > page_count:
            continue
        outline.append({"level": int(level), "title": single_line(str(title)), "page_number": page})
    paths: list[list[str]] = []
    current: list[str] = []
    pointer = 0
    for page in range(1, page_count + 1):
        while pointer < len(outline) and outline[pointer]["page_number"] <= page:
            entry = outline[pointer]
            current = current[: entry["level"] - 1] + [entry["title"]]
            pointer += 1
        paths.append(list(current))
    return outline, paths


def _chapters_from_outline(outline: list[dict[str, Any]], page_count: int) -> tuple[list[dict[str, Any]], int]:
    if not outline:
        return [], 0
    levels = sorted({e["level"] for e in outline})
    chapter_level = levels[0]
    for level in levels:
        titled = [e for e in outline if e["level"] == level and re.search(r"(chapter|^\d+[\s.])", e["title"], re.I)]
        if len(titled) >= 2:
            chapter_level = level
            break
    entries = [e for e in outline if e["level"] == chapter_level]
    chapters = []
    for position, entry in enumerate(entries):
        next_start = next(
            (e["page_number"] for e in outline if e["level"] <= chapter_level and e["page_number"] > entry["page_number"]),
            page_count + 1,
        )
        if position + 1 < len(entries):
            next_start = min(next_start, entries[position + 1]["page_number"])
        chapters.append(
            {
                "index": position + 1,
                "title": entry["title"],
                "page_start": entry["page_number"],
                "page_end": max(entry["page_number"], next_start - 1),
                "source": "pdf_outline",
                "confidence": "high",
            }
        )
    return chapters, chapter_level


def _chapters_from_headings(pages: list[dict[str, Any]], page_count: int) -> list[dict[str, Any]]:
    starts = []
    for page in pages:
        for heading in page["headings"]:
            match = CHAPTER_HEAD_RE.match(heading["text"])
            if match:
                starts.append({"title": heading["text"], "page_start": page["page_number"]})
                break
    chapters = []
    for position, start in enumerate(starts):
        end = starts[position + 1]["page_start"] - 1 if position + 1 < len(starts) else page_count
        chapters.append(
            {
                "index": position + 1,
                "title": start["title"],
                "page_start": start["page_start"],
                "page_end": max(start["page_start"], end),
                "source": "detected_heading",
                "confidence": "medium",
            }
        )
    return chapters


def extract_pdf(path: Path) -> dict[str, Any]:
    import pymupdf

    warnings: list[str] = []
    with pymupdf.open(path) as doc:
        if doc.needs_pass:
            raise ValueError("PDF is password protected; remove the password and re-run")
        page_count = doc.page_count
        metadata = {k: v for k, v in (doc.metadata or {}).items() if v}
        toc = doc.get_toc(simple=True)

        raw_pages: list[dict[str, Any]] = []
        size_weights: Counter[float] = Counter()
        margin_counts: Counter[str] = Counter()
        for index in range(page_count):
            page = doc[index]
            rect = page.rect
            height = rect.height or 1
            data = page.get_text("dict", sort=True)
            lines: list[dict[str, Any]] = []
            for block in data.get("blocks", []):
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    spans = [s for s in line.get("spans", []) if s.get("text", "").strip()]
                    if not spans:
                        continue
                    text = "".join(s["text"] for s in line["spans"]).strip()
                    size = max(round(s["size"] * 2) / 2 for s in spans)
                    bold = all(bool(s.get("flags", 0) & 16) or "bold" in s.get("font", "").lower() for s in spans)
                    for span in spans:
                        size_weights[round(span["size"] * 2) / 2] += len(span["text"])
                    y0, y1 = line["bbox"][1], line["bbox"][3]
                    zone = "top" if y1 <= height * 0.08 else ("bottom" if y0 >= height * 0.92 else "body")
                    lines.append({"text": text, "size": size, "bold": bold, "block": block.get("number", 0), "zone": zone})
            for key in {_margin_key(l["text"]) for l in lines if l["zone"] != "body"}:
                margin_counts[key] += 1
            image_area = 0.0
            try:
                for info in page.get_image_info():
                    x0, y0, x1, y1 = info["bbox"]
                    image_area += max(0.0, x1 - x0) * max(0.0, y1 - y0)
            except Exception:
                image_area = 0.0
            label = None
            try:
                label = page.get_label() or None
            except Exception:
                label = None
            raw_pages.append(
                {
                    "page_number": index + 1,
                    "page_label": label,
                    "lines": lines,
                    "image_area_ratio": round(min(1.0, image_area / max(1.0, rect.width * rect.height)), 3),
                    "orientation": "landscape" if rect.width > rect.height else "portrait",
                }
            )

    body_size = size_weights.most_common(1)[0][0] if size_weights else 10.0
    repeat_threshold = max(3, int(page_count * 0.3)) if page_count >= 6 else page_count + 1
    repeated = {key for key, count in margin_counts.items() if count >= repeat_threshold}

    pages: list[dict[str, Any]] = []
    for raw in raw_pages:
        printed = None
        kept: list[dict[str, Any]] = []
        for line in raw["lines"]:
            if line["zone"] != "body":
                number = PAGE_NUMBER_RE.match(line["text"])
                if number:
                    printed = printed or number.group(1)
                    continue
                if _margin_key(line["text"]) in repeated:
                    continue
            kept.append(line)
        headings = []
        for line in kept:
            text = line["text"]
            if not (3 <= len(text) <= 120) or not re.search(r"[A-Za-z]", text):
                continue
            larger = line["size"] >= body_size * 1.15 and line["size"] >= body_size + 1
            numbered = bool(NUMBERED_HEAD_RE.match(text) or CHAPTER_HEAD_RE.match(text)) and (line["bold"] or larger)
            if larger or numbered:
                headings.append({"text": text, "size": line["size"], "bold": line["bold"]})
        paragraphs: list[str] = []
        current_block, buffer = None, []
        for line in kept:
            if line["block"] != current_block and buffer:
                paragraphs.append(_join_lines(buffer))
                buffer = []
            current_block = line["block"]
            buffer.append(line["text"])
        if buffer:
            paragraphs.append(_join_lines(buffer))
        text = normalize_whitespace("\n\n".join(p for p in paragraphs if p))
        char_count = len(text.replace(" ", "").replace("\n", ""))
        needs_ocr = char_count < 30 and raw["image_area_ratio"] >= 0.4
        pages.append(
            {
                "unit_type": "page",
                "page_number": raw["page_number"],
                "page_label": raw["page_label"],
                "detected_printed_page": printed,
                "orientation": raw["orientation"],
                "text": text,
                "char_count": char_count,
                "word_count": word_count(text),
                "headings": headings,
                "image_area_ratio": raw["image_area_ratio"],
                "needs_ocr": needs_ocr,
                "blank": char_count < 30 and not needs_ocr,
                "formula_density": formula_density(text),
                "annotations": annotate_text(text),
            }
        )

    outline, outline_paths = _outline_paths(toc, page_count)
    chapters, chapter_level = _chapters_from_outline(outline, page_count)
    if not chapters:
        chapters = _chapters_from_headings(pages, page_count)
        if chapters:
            warnings.append("No PDF outline; chapters were detected from headings (verify).")
        else:
            warnings.append("No PDF outline and no chapter headings detected; chapter mapping unavailable.")
    for page in pages:
        page["heading_path"] = outline_paths[page["page_number"] - 1] if outline else []
        chapter = next((c for c in chapters if c["page_start"] <= page["page_number"] <= c["page_end"]), None)
        page["chapter"] = {"index": chapter["index"], "title": chapter["title"]} if chapter else None

    ocr_pages = [p["page_number"] for p in pages if p["needs_ocr"]]
    ratio = len(ocr_pages) / page_count if page_count else 0
    if ratio >= 0.3:
        ocr_status = "required"
    elif ocr_pages:
        ocr_status = "recommended"
    else:
        ocr_status = "not_needed"
    landscape = sum(1 for p in pages if p["orientation"] == "landscape")
    return {
        "format": "pdf",
        "metadata": metadata,
        "title": metadata.get("title"),
        "title_source": "pdf_metadata" if metadata.get("title") else None,
        "page_count": page_count,
        "page_labels_defined": any(p["page_label"] for p in pages),
        "printed_page_numbers_detected": sum(1 for p in pages if p["detected_printed_page"]),
        "landscape_ratio": round(landscape / page_count, 2) if page_count else 0,
        "body_font_size": body_size,
        "removed_running_lines": sorted(repeated)[:50],
        "outline": outline,
        "chapter_level": chapter_level,
        "chapters": chapters,
        "units": pages,
        "quality": {
            "text_pages": sum(1 for p in pages if p["char_count"] >= 30),
            "blank_pages": [p["page_number"] for p in pages if p["blank"]],
            "ocr_pages": ocr_pages,
            "ocr_status": ocr_status,
        },
        "warnings": warnings,
    }


def ocr_pdf(path: Path, out_dir: Path, timeout: int = 1800) -> Path:
    """Optional OCR fallback using OCRmyPDF (only when explicitly requested)."""
    tool = shutil.which("ocrmypdf")
    if not tool:
        raise RuntimeError("OCR requested but 'ocrmypdf' is not installed (pip install ocrmypdf + tesseract).")
    out_dir.mkdir(parents=True, exist_ok=True)
    output = out_dir / f"{path.stem}.ocr.pdf"
    completed = subprocess.run(
        [tool, "--skip-text", "--output-type", "pdf", str(path), str(output)],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if completed.returncode not in (0, 6) or not output.exists():  # 6 = already has text
        raise RuntimeError(f"OCR failed: {(completed.stderr or '').strip()[-300:]}")
    return output


# --------------------------------------------------------------------------
# DOCX
# --------------------------------------------------------------------------
def extract_docx(path: Path) -> dict[str, Any]:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    document = Document(str(path))
    items: list[dict[str, Any]] = []
    body = document.element.body
    for child in body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            paragraph = Paragraph(child, document)
            text = normalize_whitespace(paragraph.text)
            style = (paragraph.style.name if paragraph.style is not None else "") or ""
            level = None
            if style.lower() == "title":
                level = 0
            elif match := re.match(r"heading\s*(\d)", style, re.I):
                level = int(match.group(1))
            items.append({"kind": "paragraph", "text": text, "heading_level": level})
        elif tag == "tbl":
            table = Table(child, document)
            rows = [" | ".join(normalize_whitespace(c.text) for c in row.cells) for row in table.rows]
            items.append({"kind": "table", "text": "\n".join(rows), "heading_level": None})

    sections: list[dict[str, Any]] = []
    path_stack: list[str] = []
    current: dict[str, Any] | None = None
    for position, item in enumerate(items, start=1):
        level = item["heading_level"]
        if level is not None and item["text"]:
            if level > 0:
                path_stack = path_stack[: level - 1] + [item["text"]]
            current = {
                "title": item["text"],
                "heading_path": list(path_stack) or [item["text"]],
                "paragraph_start": position,
                "paragraph_end": position,
                "parts": [],
            }
            sections.append(current)
            continue
        if not item["text"]:
            continue
        if current is None:
            current = {"title": None, "heading_path": [], "paragraph_start": position, "paragraph_end": position, "parts": []}
            sections.append(current)
        current["parts"].append(item["text"])
        current["paragraph_end"] = position

    units = []
    for number, section in enumerate(sections, start=1):
        text = normalize_whitespace("\n\n".join(section["parts"]))
        units.append(
            {
                "unit_type": "section",
                "section_number": number,
                "title": section["title"],
                "heading_path": section["heading_path"],
                "location": {"paragraph_start": section["paragraph_start"], "paragraph_end": section["paragraph_end"]},
                "page_number": None,
                "page_label": None,
                "text": text,
                "word_count": word_count(text),
                "formula_density": formula_density(text),
                "annotations": annotate_text(text),
            }
        )
    core = document.core_properties
    chapters = [
        {"index": i + 1, "title": u["title"], "section_number": u["section_number"], "source": "docx_heading", "confidence": "high"}
        for i, u in enumerate(u for u in units if u["title"] and len(u["heading_path"]) == 1)
    ]
    return {
        "format": "docx",
        "metadata": {"title": core.title or None, "author": core.author or None},
        "title": core.title or None,
        "title_source": "document_properties" if core.title else None,
        "page_count": None,
        "chapters": chapters,
        "units": units,
        "warnings": ["DOCX has no fixed page numbers; locations are paragraph-based."],
    }


# --------------------------------------------------------------------------
# EPUB / HTML / text
# --------------------------------------------------------------------------
def _sections_from_html(html: bytes | str, *, base_location: dict[str, Any]) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "lxml")
    page_label = None
    # EPUB page-break markers are usually empty inline elements, which the
    # lineariser would drop. Replace them with an inline sentinel instead.
    for marker in soup.find_all(attrs={"epub:type": "pagebreak"}) + soup.find_all(attrs={"role": "doc-pagebreak"}):
        label = marker.get("title") or marker.get("aria-label") or marker.get_text(" ").strip()
        marker.replace_with(f" \u27e6page:{label}\u27e7 " if label else " ")
    blocks = linearize(soup)
    sections: list[dict[str, Any]] = []
    path_stack: list[str] = []
    current: dict[str, Any] | None = None
    for block in blocks:
        markers = PAGE_SENTINEL_RE.findall(block.text)
        if markers:
            page_label = markers[-1]
            block.text = single_line(PAGE_SENTINEL_RE.sub(" ", block.text))
        if block.heading_level:
            level = block.heading_level
            path_stack = path_stack[: level - 1] + [block.text]
            current = {"title": block.text, "heading_path": list(path_stack), "parts": [], "page_label": page_label}
            sections.append(current)
            continue
        if current is None:
            current = {"title": None, "heading_path": [], "parts": [], "page_label": page_label}
            sections.append(current)
        if block.text:
            current["parts"].append(block.text)
    out = []
    for section in sections:
        text = normalize_whitespace("\n\n".join(section["parts"]))
        if not text and not section["title"]:
            continue
        out.append({**section, "text": text, "location": dict(base_location)})
    return out


def extract_epub(path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(path) as archive:
        container = BeautifulSoup(archive.read("META-INF/container.xml"), "xml")
        rootfile = container.find("rootfile")
        if rootfile is None:
            raise ValueError("EPUB container.xml has no rootfile")
        opf_path = rootfile["full-path"]
        opf = BeautifulSoup(archive.read(opf_path), "xml")
        base = str(PurePosixPath(opf_path).parent)
        manifest = {item["id"]: item["href"] for item in opf.find_all("item")}
        title_tag = opf.find("dc:title") or opf.find("title")
        creator = opf.find("dc:creator") or opf.find("creator")
        units = []
        number = 0
        for spine_index, itemref in enumerate(opf.find_all("itemref"), start=1):
            href = manifest.get(itemref.get("idref", ""))
            if not href:
                continue
            member = str(PurePosixPath(base) / href) if base not in {"", "."} else href
            try:
                html = archive.read(member)
            except KeyError:
                continue
            for section in _sections_from_html(html, base_location={"spine_index": spine_index, "href": href}):
                number += 1
                units.append(
                    {
                        "unit_type": "section",
                        "section_number": number,
                        "title": section["title"],
                        "heading_path": section["heading_path"],
                        "location": section["location"],
                        "page_number": None,
                        "page_label": section["page_label"],
                        "text": section["text"],
                        "word_count": word_count(section["text"]),
                        "formula_density": formula_density(section["text"]),
                        "annotations": annotate_text(section["text"]),
                    }
                )
    chapters = [
        {"index": i + 1, "title": u["title"], "section_number": u["section_number"], "source": "epub_heading", "confidence": "medium"}
        for i, u in enumerate(u for u in units if u["title"] and len(u["heading_path"]) == 1)
    ]
    title = single_line(title_tag.get_text()) if title_tag else None
    has_pages = any(u["page_label"] for u in units)
    return {
        "format": "epub",
        "metadata": {"title": title, "author": single_line(creator.get_text()) if creator else None},
        "title": title,
        "title_source": "epub_metadata" if title else None,
        "page_count": None,
        "chapters": chapters,
        "units": units,
        "warnings": [] if has_pages else ["EPUB has no page-break markers; locations are section-based."],
    }


def extract_html_document(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    title_tag = BeautifulSoup(raw, "lxml").find("title")
    units = []
    for number, section in enumerate(_sections_from_html(raw, base_location={}), start=1):
        units.append(
            {
                "unit_type": "section",
                "section_number": number,
                "title": section["title"],
                "heading_path": section["heading_path"],
                "location": {"section_number": number},
                "page_number": None,
                "page_label": None,
                "text": section["text"],
                "word_count": word_count(section["text"]),
                "formula_density": formula_density(section["text"]),
                "annotations": annotate_text(section["text"]),
            }
        )
    title = single_line(title_tag.get_text()) if title_tag else None
    return {"format": "html", "metadata": {}, "title": title, "title_source": "html_title" if title else None,
            "page_count": None, "chapters": [], "units": units, "warnings": []}


def extract_text_document(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="replace")
    sections: list[dict[str, Any]] = []
    current = {"title": None, "parts": []}
    for line in text.splitlines():
        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading and path.suffix.lower() == ".md":
            current = {"title": heading.group(2).strip(), "parts": []}
            sections.append(current)
        else:
            if not sections:
                sections.append(current)
            current["parts"].append(line)
    units = []
    for number, section in enumerate(sections, start=1):
        body = normalize_whitespace("\n".join(section["parts"]))
        if not body and not section["title"]:
            continue
        units.append(
            {
                "unit_type": "section",
                "section_number": number,
                "title": section["title"],
                "heading_path": [section["title"]] if section["title"] else [],
                "location": {"section_number": number},
                "page_number": None,
                "page_label": None,
                "text": body,
                "word_count": word_count(body),
                "formula_density": formula_density(body),
                "annotations": annotate_text(body),
            }
        )
    return {"format": "text", "metadata": {}, "title": None, "title_source": None, "page_count": None,
            "chapters": [], "units": units, "warnings": []}


# --------------------------------------------------------------------------
# Stage runner
# --------------------------------------------------------------------------
def extract_document(document: SourceDocument, paths: Paths, *, ocr: bool = False) -> dict[str, Any]:
    source = document.extracted_path
    converted_from = None
    pre_warnings: list[str] = []
    if document.category == "word_legacy":
        source = convert_with_libreoffice(source, paths.data / "converted" / document.short_key, "docx")
        converted_from = document.filename
        pre_warnings.append(f"converted from {document.extension} with LibreOffice")

    if document.category == "pdf_document":
        result = extract_pdf(source)
        if ocr and result["quality"]["ocr_pages"]:
            ocr_copy = ocr_pdf(source, paths.data / "converted" / document.short_key)
            result = extract_pdf(ocr_copy)
            pre_warnings.append("text extracted from an OCR copy (OCRmyPDF); verify scanned pages")
    elif document.category in {"word_document", "word_legacy"}:
        result = extract_docx(source)
    elif document.category == "ebook":
        result = extract_epub(source)
    elif document.category == "web_page":
        result = extract_html_document(source)
    elif document.category == "text_document":
        result = extract_text_document(source)
    else:  # pragma: no cover - guarded by DOCUMENT_CATEGORIES
        raise ValueError(f"unsupported category {document.category}")

    warnings = pre_warnings + result.pop("warnings", [])
    units = result["units"]
    total_words = sum(u.get("word_count", 0) for u in units)
    status = Status.COMPLETED
    details: dict[str, Any] = {}
    if total_words == 0:
        status = Status.PARTIAL
        warnings.append("no extractable text found (scanned document? OCR may be required)")
    quality = result.get("quality")
    if quality and quality["ocr_pages"]:
        pages = quality["ocr_pages"]
        details["ocr_pages"] = pages
        ratio = len(pages) / max(1, result.get("page_count") or 1)
        message = f"{len(pages)} page(s) look scanned (image only) and need OCR: {pages[:20]}" + (
            "…" if len(pages) > 20 else ""
        )
        warnings.append(message)
        if len(pages) >= 3 and ratio >= 0.05:
            status = Status.PARTIAL

    role = document.document_role or "supporting_document"
    if document.category == "pdf_document" and role == "supporting_document" and result.get("landscape_ratio", 0) >= 0.6:
        role = "lecture_slides_pdf"
    return {
        "schema_version": SCHEMA_VERSION,
        "extractor_version": EXTRACTOR_VERSION,
        "processed_at": utc_now_iso(),
        "doc_key": document.doc_key,
        "source_file": document.filename,
        "source_path": document.primary_path,
        "source_paths": document.paths,
        "document_role": role,
        "converted_from": converted_from,
        "word_count": total_words,
        **result,
        "status": status.value,
        "status_details": details,
        "warnings": warnings,
    }


def run_documents_stage(
    paths: Paths,
    *,
    force: bool = False,
    retries: int = 1,
    ocr: bool = False,
    textbook_only: bool = False,
    only: set[str] | None = None,
) -> list[dict[str, Any]]:
    inventory = read_json(paths.inventory)
    tracker = StatusTracker(paths.status)
    documents = unique_documents(inventory, paths, DOCUMENT_CATEGORIES)
    # The Weekly Overview is parsed by Stage B, not as a generic web page.
    overview = inventory["weekly_overview"]["selected"]
    documents = [d for d in documents if overview not in d.paths]
    if textbook_only:
        documents = [d for d in documents if d.document_role == "textbook"]
    return run_document_stage(
        stage="extract",
        documents=documents,
        tracker=tracker,
        output_dir=paths.documents_dir,
        extract=lambda document: extract_document(document, paths, ocr=ocr),
        force=force,
        retries=retries,
        only=only,
    )
