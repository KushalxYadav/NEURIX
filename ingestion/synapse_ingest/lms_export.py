"""LMS offline-export reader (Canvas-style ``viewer/course-data.js``).

Some course archives are an LMS "offline viewer": ``index.html`` is an empty
shell that loads ``viewer/course-data.js``, which assigns one JSON object to
``window.COURSE_DATA``. That object holds the real course structure:

* ``modules`` — the ordered module list students see (e.g. "Week 3"), each
  with attachments that point at files under ``viewer/files/``;
* ``pages`` — wiki pages; the ``frontPage`` usually carries the course plan
  (weekly learning plan, outcomes, assessment criteria);
* ``assignments`` — graded items with unlock/due dates and points.

The file is parsed as data with :func:`json.JSONDecoder.raw_decode` — it is
never executed. Attachment paths are resolved against the overview's folder
and matched to the inventory; anything that escapes the archive or cannot be
found is reported, never guessed.
"""

from __future__ import annotations

import json
import logging
import posixpath
import re
from typing import Any
from urllib.parse import unquote, urlsplit

from bs4 import BeautifulSoup

from . import EXTRACTOR_VERSION, SCHEMA_VERSION
from .config import Paths
from .util import normalize_whitespace, read_json, utc_now_iso, write_json_atomic

LOG = logging.getLogger("synapse_ingest.lms_export")

ASSIGNMENT_RE = re.compile(r"window\.COURSE_DATA\s*=\s*", re.S)
SCRIPT_SRC_RE = re.compile(r"<script[^>]+src=[\"']([^\"']+)[\"']", re.I)
BOOK_MODULE_RE = re.compile(r"\b(course\s*books?|text\s*books?|books|required\s+readings?)\b", re.I)
WEEK_MODULE_RE = re.compile(r"\bweeks?\s*(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\b", re.I)


class LmsExportError(ValueError):
    """The candidate file is not a readable LMS export."""


def parse_course_data(text: str) -> dict[str, Any]:
    """Return the ``window.COURSE_DATA`` object without executing JavaScript."""
    match = ASSIGNMENT_RE.search(text)
    if not match:
        raise LmsExportError("no 'window.COURSE_DATA =' assignment found")
    start = text.find("{", match.end())
    if start < 0:
        raise LmsExportError("COURSE_DATA is not an object literal")
    try:
        data, _ = json.JSONDecoder().raw_decode(text, start)
    except json.JSONDecodeError as exc:  # not plain JSON (e.g. real JS) — refuse rather than eval
        raise LmsExportError(f"COURSE_DATA is not valid JSON: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("modules"), list):
        raise LmsExportError("COURSE_DATA has no 'modules' list")
    return data


def find_export_entry(inventory: dict[str, Any], paths: Paths) -> dict[str, Any] | None:
    """Locate the course-data script referenced by the selected overview shell."""
    overview_path = inventory.get("weekly_overview", {}).get("selected")
    entries = {e["path"]: e for e in inventory["entries"] if e.get("status") == "extracted"}
    candidates: list[str] = []
    if overview_path and overview_path in entries:
        html = (paths.data / entries[overview_path]["extracted_path"]).read_text("utf-8", errors="replace")
        base = posixpath.dirname(overview_path)
        for src in SCRIPT_SRC_RE.findall(html):
            target = posixpath.normpath(posixpath.join(base, unquote(urlsplit(src).path)))
            if not target.startswith("../") and target in entries:
                candidates.append(target)
    candidates += [p for p in entries if p.endswith("course-data.js") and p not in candidates]
    for path in candidates:
        try:
            text = (paths.data / entries[path]["extracted_path"]).read_text("utf-8", errors="replace")
        except OSError:
            continue
        if ASSIGNMENT_RE.search(text):
            return entries[path]
    return None


def _resolve(content: str | None, base_dir: str, by_path: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if not content:
        return {"kind": "none"}
    parsed = urlsplit(content)
    if parsed.scheme in {"http", "https"}:
        return {"kind": "external", "url": content}
    target = posixpath.normpath(posixpath.join(base_dir, unquote(parsed.path)))
    if target == ".." or target.startswith("../"):
        return {"kind": "unresolved", "reason": "path escapes the archive", "target": target}
    entry = by_path.get(target)
    if not entry:
        return {"kind": "unresolved", "reason": "file not found in archive", "target": target}
    return {"kind": "internal", "resolved_path": entry["path"], "sha256": entry.get("sha256")}


def _html_text(html: str | None) -> str:
    if not html:
        return ""
    return normalize_whitespace(BeautifulSoup(html, "lxml").get_text("\n"))


def module_kind(name: str) -> tuple[str, list[int]]:
    """Classify an LMS module name: ('books'|'week'|'other', [week numbers])."""
    if BOOK_MODULE_RE.search(name):
        return "books", []
    match = WEEK_MODULE_RE.search(name)
    if match:
        first = int(match.group(1))
        last = int(match.group(2)) if match.group(2) else first
        return "week", list(range(first, last + 1)) if last >= first else [first]
    return "other", []


def build_export(raw: dict[str, Any], *, export_path: str, overview_path: str | None, inventory: dict[str, Any]) -> dict[str, Any]:
    base_dir = posixpath.dirname(overview_path or export_path.rsplit("/viewer/", 1)[0] + "/index.html")
    by_path = {e["path"]: e for e in inventory["entries"]}
    warnings: list[str] = []

    modules = []
    for position, module in enumerate(raw.get("modules", []), start=1):
        kind, numbers = module_kind(module.get("name") or "")
        items = []
        for item_position, item in enumerate(module.get("items") or [], start=1):
            resolved = _resolve(item.get("content"), base_dir, by_path)
            if resolved["kind"] == "unresolved":
                warnings.append(f"Module '{module.get('name')}': item '{item.get('title')}' — {resolved['reason']}")
            items.append(
                {
                    "lms_id": item.get("id"),
                    "position": item_position,
                    "title": item.get("title"),
                    "type": item.get("type"),
                    "indent": item.get("indent", 0),
                    "content": item.get("content"),
                    **resolved,
                }
            )
        modules.append(
            {
                "lms_id": module.get("id"),
                "position": position,
                "name": module.get("name"),
                "kind": kind,
                "label_week_numbers": numbers,
                "status": module.get("status"),
                "unlock_date": module.get("unlockDate"),
                "items": items,
            }
        )

    pages = []
    for page in raw.get("pages") or []:
        pages.append(
            {
                "title": page.get("title"),
                "front_page": bool(page.get("frontPage")),
                "html": page.get("content") or "",
                "text": _html_text(page.get("content")),
            }
        )

    assignments = []
    for assignment in raw.get("assignments") or []:
        assignments.append(
            {
                "title": assignment.get("title"),
                "graded": assignment.get("graded"),
                "points_possible": assignment.get("pointsPossible"),
                "submission_types": assignment.get("submissionTypes"),
                "unlock_at": assignment.get("unlockAt"),
                "due_at": assignment.get("dueAt"),
                "lock_at": assignment.get("lockAt"),
                "description": _html_text(assignment.get("content")),
            }
        )

    linked = {i["resolved_path"] for m in modules for i in m["items"] if i.get("kind") == "internal"}
    unlinked = sorted(
        e["path"]
        for e in inventory["entries"]
        if e.get("status") == "extracted"
        and e["category"] not in {"web_asset", "image", "os_metadata"}
        and "/viewer/files/" in e["path"]
        and e["path"] not in linked
        and not e.get("duplicate_of")
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "extractor_version": EXTRACTOR_VERSION,
        "generated_at": utc_now_iso(),
        "source_file": export_path,
        "format": "lms_offline_viewer",
        "title": raw.get("title"),
        "language": raw.get("language"),
        "last_download": raw.get("lastDownload"),
        "modules": modules,
        "pages": pages,
        "front_page": next((p["title"] for p in pages if p["front_page"]), None),
        "assignments": assignments,
        "quizzes": raw.get("quizzes") or [],
        "files_not_in_modules": unlinked,
        "warnings": warnings,
    }


def run_lms_export_stage(paths: Paths) -> dict[str, Any] | None:
    """Write ``processed/lms_export.json`` when the archive is an LMS export."""
    inventory = read_json(paths.inventory)
    entry = find_export_entry(inventory, paths)
    target = paths.processed / "lms_export.json"
    if not entry:
        if target.exists():
            target.unlink()
        return None
    text = (paths.data / entry["extracted_path"]).read_text("utf-8", errors="replace")
    try:
        raw = parse_course_data(text)
    except LmsExportError as exc:
        LOG.warning("LMS export %s not readable: %s", entry["path"], exc)
        return None
    result = build_export(
        raw, export_path=entry["path"], overview_path=inventory["weekly_overview"].get("selected"), inventory=inventory
    )
    result["source_sha256"] = entry.get("sha256")
    write_json_atomic(target, result)
    LOG.info(
        "LMS export: %d modules, %d pages, %d assignments, %d files outside modules",
        len(result["modules"]),
        len(result["pages"]),
        len(result["assignments"]),
        len(result["files_not_in_modules"]),
    )
    return result
