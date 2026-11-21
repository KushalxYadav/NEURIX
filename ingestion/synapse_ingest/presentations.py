"""Stage C — slide-aware PowerPoint extraction.

Each slide keeps its original number, title, text blocks in authored order
(with bullet levels), tables, SmartArt text, chart titles, equation text,
speaker notes and image metadata. Legacy ``.ppt`` files are converted with
LibreOffice when it is installed; otherwise they are reported as failed with
the exact conversion command — never skipped silently.
"""

from __future__ import annotations

import logging
from collections import Counter
from pathlib import Path
from typing import Any

from lxml import etree

from . import EXTRACTOR_VERSION, SCHEMA_VERSION
from .annotate import annotate_text, formula_density
from .common import SourceDocument, run_document_stage, unique_documents
from .config import Paths
from .convert import CONVERSION_HELP, ConversionError, convert_with_libreoffice  # noqa: F401
from .status import Status, StatusTracker
from .util import normalize_whitespace, read_json, utc_now_iso, word_count

LOG = logging.getLogger("synapse_ingest.presentations")

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
    "dgm": "http://schemas.openxmlformats.org/drawingml/2006/diagram",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
LEGACY_CONVERSION_HELP = CONVERSION_HELP.format(target="pptx")


def convert_legacy_presentation(source: Path, out_dir: Path, timeout: int = 300) -> Path:
    return convert_with_libreoffice(source, out_dir, "pptx", timeout=timeout)


# --------------------------------------------------------------------------
# Shape walking
# --------------------------------------------------------------------------
def _paragraphs(text_frame: Any) -> list[dict[str, Any]]:
    paragraphs = []
    for paragraph in text_frame.paragraphs:
        text = normalize_whitespace("".join(run.text for run in paragraph.runs) or paragraph.text or "")
        if text:
            paragraphs.append({"text": text, "level": int(paragraph.level or 0)})
    return paragraphs


def _smartart_text(slide: Any, element: Any) -> list[str]:
    texts: list[str] = []
    for rel_ids in element.iter(f"{{{NS['dgm']}}}relIds"):
        rid = rel_ids.get(f"{{{NS['r']}}}dm")
        if not rid:
            continue
        try:
            part = slide.part.related_part(rid)
            root = etree.fromstring(part.blob)
        except Exception:  # malformed diagram part: report as missing text, not a crash
            continue
        for node in root.iter(f"{{{NS['dgm']}}}pt"):
            value = "".join(t.text or "" for t in node.iter(f"{{{NS['a']}}}t")).strip()
            if value:
                texts.append(value)
    return texts


def _walk(shapes: Any, slide: Any, slide_area: float, out: dict[str, Any], depth: int = 0) -> None:
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    for shape in shapes:
        try:
            shape_type = shape.shape_type
        except NotImplementedError:
            shape_type = None
        name = getattr(shape, "name", "")
        if shape_type == MSO_SHAPE_TYPE.GROUP:
            _walk(shape.shapes, slide, slide_area, out, depth + 1)
            continue
        if getattr(shape, "is_placeholder", False) and shape == getattr(slide.shapes, "title", None):
            continue  # title handled separately
        if getattr(shape, "has_text_frame", False) and shape.has_text_frame:
            paragraphs = _paragraphs(shape.text_frame)
            if paragraphs:
                out["blocks"].append({"kind": "text", "shape": name, "paragraphs": paragraphs})
        if getattr(shape, "has_table", False) and shape.has_table:
            rows = []
            for row in shape.table.rows:
                rows.append([normalize_whitespace(cell.text) for cell in row.cells])
            if any(any(cell for cell in row) for row in rows):
                out["blocks"].append({"kind": "table", "shape": name, "rows": rows})
            out["has_table"] = True
        if getattr(shape, "has_chart", False) and shape.has_chart:
            out["has_chart"] = True
            chart = shape.chart
            title = None
            try:
                if chart.has_title and chart.chart_title.has_text_frame:
                    title = normalize_whitespace(chart.chart_title.text_frame.text)
            except Exception:
                title = None
            out["blocks"].append({"kind": "chart", "shape": name, "title": title})
        element = shape._element
        diagram_text = _smartart_text(slide, element)
        if diagram_text:
            out["has_diagram"] = True
            out["blocks"].append({"kind": "smartart", "shape": name, "items": diagram_text})
        elif next(element.iter(f"{{{NS['dgm']}}}relIds"), None) is not None:
            out["has_diagram"] = True
        image = None
        if shape_type == MSO_SHAPE_TYPE.PICTURE or hasattr(shape, "image"):
            try:
                image = shape.image
            except (AttributeError, ValueError, KeyError):
                image = None
        if image is not None:
            try:
                area = (shape.width or 0) * (shape.height or 0)
            except Exception:
                area = 0
            try:
                pixel_size = image.size
            except Exception:
                pixel_size = (None, None)
            out["images"].append(
                {
                    "shape": name,
                    "content_type": image.content_type,
                    "sha1": image.sha1,
                    "width_px": pixel_size[0],
                    "height_px": pixel_size[1],
                    "area_ratio": round(area / slide_area, 3) if slide_area else None,
                }
            )
        if shape_type == MSO_SHAPE_TYPE.MEDIA:
            out["has_media"] = True


def _equations(slide: Any) -> list[str]:
    equations = []
    for omath in slide._element.iter(f"{{{NS['m']}}}oMath"):
        text = "".join(t.text or "" for t in omath.iter(f"{{{NS['m']}}}t")).strip()
        if text:
            equations.append(text)
    return equations


def extract_slide(slide: Any, number: int, slide_area: float) -> dict[str, Any]:
    out: dict[str, Any] = {
        "blocks": [],
        "images": [],
        "has_table": False,
        "has_chart": False,
        "has_diagram": False,
        "has_media": False,
    }
    title = None
    title_shape = slide.shapes.title
    if title_shape is not None and title_shape.has_text_frame:
        title = normalize_whitespace(title_shape.text_frame.text) or None
    _walk(slide.shapes, slide, slide_area, out)
    equations = _equations(slide)
    if equations:
        out["blocks"].append({"kind": "equation", "items": equations})

    lines: list[str] = []
    for block in out["blocks"]:
        if block["kind"] == "text":
            lines += ["  " * p["level"] + p["text"] for p in block["paragraphs"]]
        elif block["kind"] == "table":
            lines += [" | ".join(row) for row in block["rows"]]
        elif block["kind"] in {"smartart", "equation"}:
            lines += block["items"]
        elif block["kind"] == "chart" and block.get("title"):
            lines.append(f"[Chart] {block['title']}")
    body = normalize_whitespace("\n".join(lines))

    notes = ""
    if slide.has_notes_slide:
        frame = slide.notes_slide.notes_text_frame
        if frame is not None:
            notes = normalize_whitespace(frame.text)

    first_line = body.splitlines()[0] if body else None
    analysable = "\n".join(filter(None, [title, body]))
    density = formula_density(analysable)
    return {
        "slide_number": number,
        "hidden": slide._element.get("show") == "0",
        "layout": slide.slide_layout.name if slide.slide_layout is not None else None,
        "title": title,
        "display_title": title or (first_line[:120] if first_line else None),
        "title_source": "title_placeholder" if title else ("first_text_line" if first_line else None),
        "blocks": out["blocks"],
        "text": body,
        "notes": notes,
        "images_available": bool(out["images"]),
        "images": out["images"],
        "has_table": out["has_table"],
        "has_chart": out["has_chart"],
        "has_diagram": out["has_diagram"],
        "has_equation": bool(equations),
        "has_media": out["has_media"],
        "formula_density": density,
        "formula_heavy": bool(equations) or density >= 0.3,
        "word_count": word_count(analysable) + word_count(notes),
        "annotations": annotate_text(analysable),
    }


def extract_presentation_file(path: Path) -> dict[str, Any]:
    from pptx import Presentation

    presentation = Presentation(str(path))
    slide_area = float((presentation.slide_width or 0) * (presentation.slide_height or 0))
    slides, warnings = [], []
    for number, slide in enumerate(presentation.slides, start=1):
        try:
            slides.append(extract_slide(slide, number, slide_area))
        except Exception as exc:  # keep the slide in sequence, flagged as failed
            warnings.append(f"slide {number}: extraction error {type(exc).__name__}: {exc}")
            slides.append({"slide_number": number, "extraction_error": str(exc), "text": "", "notes": ""})

    usage = Counter(image["sha1"] for s in slides for image in s.get("images", []))
    for slide in slides:
        for image in slide.get("images", []):
            image["likely_decorative"] = len(slides) >= 3 and usage[image["sha1"]] >= max(3, len(slides) * 0.5)
        slide["has_content_images"] = any(not i["likely_decorative"] for i in slide.get("images", []))

    core = presentation.core_properties
    properties = {
        "title": core.title or None,
        "author": core.author or None,
        "subject": core.subject or None,
        "created": core.created.isoformat() if core.created else None,
        "modified": core.modified.isoformat() if core.modified else None,
    }
    return {"slides": slides, "warnings": warnings, "core_properties": properties}


def extract_presentation(document: SourceDocument, paths: Paths) -> dict[str, Any]:
    source = document.extracted_path
    converted_from = None
    warnings: list[str] = []
    if document.category == "presentation_legacy":
        out_dir = paths.data / "converted" / document.short_key
        source = convert_legacy_presentation(document.extracted_path, out_dir)
        converted_from = document.filename
        warnings.append(f"converted from legacy format {document.extension} with LibreOffice")
    extracted = extract_presentation_file(source)
    slides = extracted["slides"]
    warnings += extracted["warnings"]
    total_words = sum(s.get("word_count", 0) for s in slides)
    failed_slides = [s["slide_number"] for s in slides if s.get("extraction_error")]
    image_only = [s["slide_number"] for s in slides if not s.get("text") and not s.get("title") and s.get("images")]
    status = Status.COMPLETED
    if not slides:
        status = Status.PARTIAL
        warnings.append("presentation has no slides")
    elif total_words == 0:
        status = Status.PARTIAL
        warnings.append("no extractable text (slides may be images only; OCR would be required)")
    elif failed_slides:
        status = Status.PARTIAL
    if image_only:
        warnings.append(f"slides with images but no text: {image_only}")
    first_title = next((s.get("title") for s in slides if s.get("title")), None)
    return {
        "schema_version": SCHEMA_VERSION,
        "extractor_version": EXTRACTOR_VERSION,
        "processed_at": utc_now_iso(),
        "doc_key": document.doc_key,
        "source_file": document.filename,
        "source_path": document.primary_path,
        "source_paths": document.paths,
        "document_role": "presentation",
        "format": "pptx",
        "converted_from": converted_from,
        "title": extracted["core_properties"]["title"] or first_title,
        "title_source": "document_properties" if extracted["core_properties"]["title"] else (
            "first_slide_title" if first_title else None
        ),
        "core_properties": extracted["core_properties"],
        "slide_count": len(slides),
        "word_count": total_words,
        "slides": slides,
        "status": status.value,
        "status_details": {"failed_slides": failed_slides, "image_only_slides": image_only},
        "warnings": warnings,
    }


def run_presentations_stage(
    paths: Paths, *, force: bool = False, retries: int = 1, convert_legacy: bool = True, only: set[str] | None = None
) -> list[dict[str, Any]]:
    inventory = read_json(paths.inventory)
    tracker = StatusTracker(paths.status)
    categories = {"presentation"} | ({"presentation_legacy"} if convert_legacy else set())
    documents = unique_documents(inventory, paths, categories)
    if not convert_legacy:
        for legacy in unique_documents(inventory, paths, {"presentation_legacy"}):
            tracker.register(legacy.doc_key, source_paths=legacy.paths, sha256=legacy.doc_key, category=legacy.category)
            tracker.finish(
                legacy.doc_key, "extract", Status.FAILED, error="legacy format; conversion disabled. " + LEGACY_CONVERSION_HELP
            )
    return run_document_stage(
        stage="extract",
        documents=documents,
        tracker=tracker,
        output_dir=paths.presentations_dir,
        extract=lambda document: extract_presentation(document, paths),
        force=force,
        retries=retries,
        only=only,
    )
