"""Stage B — Weekly Overview (index.html) parser.

The HTML structure is not known in advance, so the parser:

1. linearises the document into text *blocks* in reading order (each block
   keeps its own text, heading level and links), then
2. evaluates several segmentation strategies — tables, repeated section
   containers (e.g. LMS course exports), heading levels and week-prefixed
   paragraphs — scoring each by how many week-like section labels it finds,
3. keeps the best strategy, records why, and extracts per-section labels,
   dates, verbatim topic lines, learning objectives, chapter/page references
   and resource links resolved against the extracted archive.

Original wording is preserved verbatim. Inferred values (week numbers from
order, years for dates without a year) are always labelled as inferred.
"""

from __future__ import annotations

import logging
import posixpath
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import unquote, urlsplit

from bs4 import BeautifulSoup, NavigableString, Tag
from bs4.element import Comment

from . import EXTRACTOR_VERSION, SCHEMA_VERSION
from .config import Paths
from .status import Status, StatusTracker
from .util import (
    normalize_whitespace,
    read_json,
    sha256_file,
    single_line,
    utc_now_iso,
    write_json_atomic,
    write_text_atomic,
)

LOG = logging.getLogger("synapse_ingest.overview")

# --------------------------------------------------------------------------
# Patterns
# --------------------------------------------------------------------------
NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20,
}  # fmt: skip
_NUM = r"(\d{1,2}|" + "|".join(NUMBER_WORDS) + r")"
WEEK_RE = re.compile(r"\b(?:week|wk)\.?\s*[-:#]?\s*" + _NUM + r"\b", re.I)
SEQ_RE = re.compile(
    r"\b(topic|module|unit|lecture|session|lesson|chapter|section|class)\s*[-.:#]?\s*" + _NUM + r"\b", re.I
)
LABEL_START_RE = re.compile(
    r"^\s*(?:week|wk|topic|module|unit|lecture|session|lesson|class)\.?\s*[-:#]?\s*" + _NUM + r"\b", re.I
)
MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}  # fmt: skip
_MONTH = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
_ORD = r"(?:st|nd|rd|th)?"
_SEP = r"\s*(?:-|–|—|to|until|till|through)\s*"
DM = rf"(\d{{1,2}}){_ORD}\s+{_MONTH}(?:,?\s+(\d{{4}}))?"
MD = rf"{_MONTH}\s+(\d{{1,2}}){_ORD}(?:,?\s+(\d{{4}}))?"
RANGE_DM_DM = re.compile(rf"{DM}{_SEP}{DM}", re.I)
RANGE_MD_MD = re.compile(rf"{MD}{_SEP}{MD}", re.I)
RANGE_D_D_M = re.compile(rf"(\d{{1,2}}){_ORD}{_SEP}(\d{{1,2}}){_ORD}\s+{_MONTH}(?:,?\s+(\d{{4}}))?", re.I)
RANGE_M_D_D = re.compile(rf"{_MONTH}\s+(\d{{1,2}}){_ORD}{_SEP}(\d{{1,2}}){_ORD}(?:,?\s+(\d{{4}}))?", re.I)
# "19, 21 Oct" / "19 & 21 Oct": a list of class days in one month
LIST_D_M = re.compile(rf"\b(\d{{1,2}}){_ORD}((?:\s*(?:,|&|and)\s*\d{{1,2}}{_ORD})+)\s+{_MONTH}(?:,?\s+(\d{{4}}))?", re.I)
# a single day, only accepted inside a short label such as "Week 14 (30 Nov)"
SINGLE_DM = re.compile(rf"\b{DM}", re.I)
RANGE_ISO = re.compile(r"(\d{4})-(\d{2})-(\d{2})" + _SEP + r"(\d{4})-(\d{2})-(\d{2})")
RANGE_NUMERIC = re.compile(r"(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})" + _SEP + r"(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})")
ARCHIVE_DATE_RE = re.compile(r"(\d{4})-([A-Za-z]{3})-(\d{1,2})_")

CHAPTER_REF_RE = re.compile(r"\b(?:chapters?|chap\.?|ch\.)\s*(\d+(?:\.\d+)*(?:\s*(?:,|and|&|-|–|to)\s*\d+(?:\.\d+)*)*)", re.I)
PAGE_REF_RE = re.compile(r"\b(?:pages?|pp?\.)\s*(\d+)(?:\s*(?:-|–|to)\s*(\d+))?", re.I)
SECTION_REF_RE = re.compile(r"\bsections?\s+(\d+\.\d+(?:\.\d+)*)", re.I)
OBJECTIVE_HEAD_RE = re.compile(
    r"(learning\s+(objectives?|outcomes?)|objectives?|outcomes?|by the end of (this|the) (week|session|lecture|unit)|"
    r"you (will|should) be able to|students (will|should) be able to)",
    re.I,
)

BLOCK_TAGS = {
    "body", "p", "li", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "dt", "dd",
    "caption", "figcaption", "blockquote", "pre", "div", "section", "article", "header",
    "footer", "main", "aside", "nav", "ul", "ol", "dl", "table", "thead", "tbody", "tfoot",
    "tr", "address", "summary", "details", "figure", "form", "fieldset", "legend",
}  # fmt: skip
HEADING_CLASS_RE = re.compile(r"(sectionname|section-?title|week-?title|topic-?title|sectiontitle)", re.I)
CONTAINER_TOKEN_RE = re.compile(r"(?:^|[-_])(section|week|topic|module|unit)s?(?:$|[-_\d])", re.I)


# --------------------------------------------------------------------------
# Linearisation
# --------------------------------------------------------------------------
@dataclass
class Block:
    index: int
    tag: str
    text: str
    heading_level: int | None
    links: list[dict[str, str]]
    element: Tag = field(repr=False)
    emphasized: bool = False

    def to_json(self) -> dict[str, Any]:
        return {"index": self.index, "tag": self.tag, "text": self.text, "heading_level": self.heading_level}


def _heading_level(tag: Tag) -> int | None:
    if re.fullmatch(r"h[1-6]", tag.name or ""):
        return int(tag.name[1])
    if tag.get("role") == "heading":
        try:
            return int(tag.get("aria-level", 2))
        except (TypeError, ValueError):
            return 2
    classes = " ".join(tag.get("class", []))
    if classes and HEADING_CLASS_RE.search(classes):
        return 3
    return None


def _nearest_block(node: Any) -> Tag | None:
    parent = node.parent
    while parent is not None and getattr(parent, "name", None) not in BLOCK_TAGS:
        parent = parent.parent
    return parent


def linearize(soup: BeautifulSoup) -> list[Block]:
    """Return text blocks in document order, each with only its *own* text."""
    for junk in soup(["script", "style", "noscript", "template", "svg"]):
        junk.decompose()
    for comment in soup.find_all(string=lambda s: isinstance(s, Comment)):
        comment.extract()

    order: dict[int, int] = {}
    for position, element in enumerate(soup.find_all(True)):
        order[id(element)] = position

    texts: dict[int, list[str]] = {}
    owners: dict[int, Tag] = {}
    for string in soup.find_all(string=True):
        if not isinstance(string, NavigableString) or not string.strip():
            continue
        owner = _nearest_block(string)
        if owner is None:
            continue
        texts.setdefault(id(owner), []).append(str(string))
        owners[id(owner)] = owner

    links: dict[int, list[dict[str, str]]] = {}
    for anchor in soup.find_all("a", href=True):
        owner = _nearest_block(anchor)
        if owner is None:
            continue
        owners.setdefault(id(owner), owner)
        texts.setdefault(id(owner), [])
        links.setdefault(id(owner), []).append(
            {"text": single_line(anchor.get_text(" ")), "href": anchor["href"].strip()}
        )

    blocks: list[Block] = []
    for key in sorted(owners, key=lambda k: order.get(k, 0)):
        element = owners[key]
        text = single_line(" ".join(texts.get(key, [])))
        if not text and not links.get(key):
            continue
        children = [c for c in element.children if isinstance(c, Tag)]
        emphasized = (
            len(children) == 1
            and children[0].name in {"strong", "b"}
            and single_line(children[0].get_text(" ")) == text
        )
        blocks.append(
            Block(
                index=len(blocks),
                tag=element.name,
                text=text,
                heading_level=_heading_level(element),
                links=links.get(key, []),
                element=element,
                emphasized=emphasized,
            )
        )
    return blocks


# --------------------------------------------------------------------------
# Label analysis
# --------------------------------------------------------------------------
def _num(value: str) -> int:
    return int(value) if value.isdigit() else NUMBER_WORDS[value.lower()]


def _month(token: str) -> int:
    return MONTHS[token[:3].lower()]


def _part(day: str, month: int, year: str | None) -> dict[str, int | None]:
    return {"day": int(day), "month": month, "year": int(year) if year else None}


def parse_date_range(text: str) -> dict[str, Any] | None:
    """Parse common date-range label formats; returns None if absent."""
    if match := RANGE_ISO.search(text):
        y1, m1, d1, y2, m2, d2 = match.groups()
        return {"raw": match.group(0), "start": _part(d1, int(m1), y1), "end": _part(d2, int(m2), y2)}
    if match := RANGE_DM_DM.search(text):
        d1, m1, y1, d2, m2, y2 = match.groups()
        return {"raw": match.group(0), "start": _part(d1, _month(m1), y1 or y2), "end": _part(d2, _month(m2), y2)}
    if match := RANGE_MD_MD.search(text):
        m1, d1, y1, m2, d2, y2 = match.groups()
        return {"raw": match.group(0), "start": _part(d1, _month(m1), y1 or y2), "end": _part(d2, _month(m2), y2)}
    if match := RANGE_D_D_M.search(text):
        d1, d2, m, y = match.groups()
        return {"raw": match.group(0), "start": _part(d1, _month(m), y), "end": _part(d2, _month(m), y)}
    if match := RANGE_M_D_D.search(text):
        m, d1, d2, y = match.groups()
        return {"raw": match.group(0), "start": _part(d1, _month(m), y), "end": _part(d2, _month(m), y)}
    if match := RANGE_NUMERIC.search(text):
        a1, b1, y1, a2, b2, y2 = match.groups()
        first, second = int(a1), int(b1)
        # Day-first is assumed unless the values prove otherwise; recorded either way.
        if second > 12 and first <= 12:
            order, (d1, m1, d2, m2) = "month_first", (b1, a1, b2, a2)
        else:
            order, (d1, m1, d2, m2) = ("day_first" if first > 12 else "day_first_assumed"), (a1, b1, a2, b2)

        def year(value: str) -> str:
            return value if len(value) == 4 else f"20{value}"

        return {
            "raw": match.group(0),
            "start": _part(d1, int(m1), year(y1)),
            "end": _part(d2, int(m2), year(y2)),
            "numeric_order": order,
        }
    if match := LIST_D_M.search(text):
        first, rest, month, year = match.groups()
        days = [int(first)] + [int(d) for d in re.findall(r"\d{1,2}", rest)]
        return {
            "raw": match.group(0),
            "start": _part(str(min(days)), _month(month), year),
            "end": _part(str(max(days)), _month(month), year),
            "days": sorted(days),
        }
    if len(text) <= 60 and len(SINGLE_DM.findall(text)) == 1 and (match := SINGLE_DM.search(text)):
        day, month, year = match.groups()
        return {"raw": match.group(0), "start": _part(day, _month(month), year), "end": _part(day, _month(month), year)}
    return None


def classify_label(text: str) -> tuple[str, int | None]:
    """Return (label_kind, explicit_number) for a section label."""
    if match := WEEK_RE.search(text):
        return "week", _num(match.group(1))
    if match := SEQ_RE.search(text):
        return match.group(1).lower(), _num(match.group(2))
    if parse_date_range(text):
        return "date_range", None
    return "other", None


def is_week_like(text: str, anchored: bool = False) -> bool:
    if not text or len(text) > 160:
        return False
    if anchored:
        return bool(LABEL_START_RE.match(text)) or bool(parse_date_range(text[:60]))
    return classify_label(text)[0] != "other"


# --------------------------------------------------------------------------
# Segmentation strategies
# --------------------------------------------------------------------------
@dataclass
class RawSection:
    label: str
    label_block: int | None
    blocks: list[int]
    fields: dict[str, str] = field(default_factory=dict)


@dataclass
class StrategyResult:
    name: str
    score: int
    sections: list[RawSection]
    detail: str


def strategy_headings(blocks: list[Block]) -> StrategyResult:
    headings = [b for b in blocks if b.heading_level]
    best_level, best_score = None, 0
    for level in sorted({b.heading_level for b in headings if b.heading_level}):
        score = sum(1 for b in headings if b.heading_level == level and is_week_like(b.text))
        if score > best_score:
            best_level, best_score = level, score
    if best_level is None:
        return StrategyResult("headings", 0, [], "no week-like headings")
    starts = [b.index for b in headings if b.heading_level == best_level]
    boundaries = sorted({b.index for b in headings if b.heading_level <= best_level})
    sections = []
    for start in starts:
        end = next((i for i in boundaries if i > start), len(blocks))
        sections.append(RawSection(blocks[start].text, start, list(range(start + 1, end))))
    return StrategyResult("headings", best_score, sections, f"h{best_level}-level headings")


def _is_link_only(block: Block) -> bool:
    return bool(block.links) and block.text in {link["text"] for link in block.links}


def strategy_paragraph_labels(blocks: list[Block]) -> StrategyResult:
    # Lines that are only a link ("Lecture 1 – Intro") are resources, not labels.
    starts = [b.index for b in blocks if not _is_link_only(b) and is_week_like(b.text, anchored=True)]
    sections = []
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(blocks)
        sections.append(RawSection(blocks[start].text, start, list(range(start + 1, end))))
    return StrategyResult("paragraph_labels", len(starts), sections, "blocks starting with a week/topic label")


def strategy_containers(soup: BeautifulSoup, blocks: list[Block]) -> StrategyResult:
    groups: dict[tuple[str, str], list[Tag]] = {}
    for element in soup.find_all(True):
        tokens = list(element.get("class", [])) + ([element["id"]] if element.get("id") else [])
        for token in tokens:
            if match := CONTAINER_TOKEN_RE.search(str(token)):
                groups.setdefault((element.name, match.group(1).lower()), []).append(element)
                break
    best: StrategyResult = StrategyResult("containers", 0, [], "no section containers")
    block_of = {id(b.element): b for b in blocks}
    for (tag_name, token), elements in groups.items():
        members = {id(e) for e in elements}
        outermost = [e for e in elements if not any(id(p) in members for p in e.parents)]
        if len(outermost) < 2:
            continue
        sections, score = [], 0
        for container in outermost:
            inside = [block_of[id(container)].index] if id(container) in block_of else []
            inside += [block_of[id(d)].index for d in container.find_all(True) if id(d) in block_of]
            inside = sorted(set(inside))
            if not inside:
                continue
            label_idx = next((i for i in inside if blocks[i].heading_level), inside[0])
            label = blocks[label_idx].text
            if is_week_like(label):
                score += 1
            sections.append(RawSection(label, label_idx, [i for i in inside if i != label_idx]))
        if score > best.score:
            best = StrategyResult("containers", score, sections, f"<{tag_name}> elements with '{token}' class/id")
    return best


def strategy_tables(soup: BeautifulSoup, blocks: list[Block]) -> StrategyResult:
    block_of = {id(b.element): b for b in blocks}
    best = StrategyResult("tables", 0, [], "no schedule-like table")
    for table in soup.find_all("table"):
        rows = [r for r in table.find_all("tr") if r.find_parent("table") is table]
        if len(rows) < 2:
            continue
        header_cells = [single_line(c.get_text(" ")) for c in rows[0].find_all(["th", "td"])]
        has_header = bool(rows[0].find("th")) or any(
            re.search(r"\b(week|topic|date|lecture|session|content)\b", h, re.I) for h in header_cells
        )
        data_rows = rows[1:] if has_header else rows
        label_col = None
        if has_header:
            for i, header in enumerate(header_cells):
                if re.search(r"\b(week|wk|session|lecture|class|no\.?|#)\b", header, re.I):
                    label_col = i
                    break
        sections, score = [], 0
        for row in data_rows:
            cells = row.find_all(["td", "th"], recursive=False) or row.find_all(["td", "th"])
            if not cells:
                continue
            texts = [single_line(c.get_text(" ")) for c in cells]
            col = label_col if label_col is not None and label_col < len(cells) else 0
            label = texts[col]
            composed = False
            header = header_cells[col] if has_header and col < len(header_cells) else ""
            if re.fullmatch(_NUM, label.strip(), re.I) and re.search(r"\b(week|wk|topic|module|unit|lecture|session)\b", header, re.I):
                # Header "Week" + cell "3" → "Week 3" (both verbatim from the table).
                label, composed = f"{header.strip()} {label.strip()}", True
            if not is_week_like(label) and any(is_week_like(t) for t in texts):
                col = next(i for i, t in enumerate(texts) if is_week_like(t))
                label = texts[col]
            if is_week_like(label) or parse_date_range(" ".join(texts)):
                score += 1
            content_idx = []
            for i, cell in enumerate(cells):
                if i == col:
                    continue
                for element in [cell, *cell.find_all(True)]:
                    if id(element) in block_of:
                        content_idx.append(block_of[id(element)].index)
            label_block = block_of.get(id(cells[col]))
            fields = {}
            if has_header:
                for i, text in enumerate(texts):
                    if i < len(header_cells) and text:
                        fields[header_cells[i] or f"column_{i + 1}"] = text
            if composed:
                fields["_label_composed_from"] = "table header + cell"
            sections.append(
                RawSection(label, label_block.index if label_block else None, sorted(set(content_idx)), fields)
            )
        if score > best.score:
            best = StrategyResult("tables", score, sections, f"table with {len(data_rows)} rows")
    return best


# --------------------------------------------------------------------------
# Section building
# --------------------------------------------------------------------------
def resolve_link(
    href: str,
    base_dir: str,
    inventory_by_path: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    parsed = urlsplit(href)
    scheme = parsed.scheme.lower()
    if not href or (not parsed.path and parsed.fragment and not scheme):
        return {"kind": "anchor"}
    if scheme in {"http", "https"}:
        return {"kind": "external", "url": href, "domain": parsed.netloc}
    if scheme in {"mailto", "tel", "javascript", "data"}:
        return {"kind": "ignored", "reason": f"{scheme}: link"}
    if scheme:
        return {"kind": "unresolved", "reason": f"unsupported scheme '{scheme}'"}
    target = posixpath.normpath(posixpath.join(base_dir, unquote(parsed.path)))
    if target == ".." or target.startswith("../"):
        return {"kind": "unresolved", "reason": "link points outside the archive", "target": target}
    entry = inventory_by_path.get(target) or inventory_by_path.get(target.lower())
    if entry:
        return {
            "kind": "internal",
            "resolved_path": entry["path"],
            "exists": entry.get("status") == "extracted",
            "category": entry.get("category"),
            "document_role": entry.get("document_role"),
            "sha256": entry.get("sha256"),
        }
    folder_files = [p for p in inventory_by_path if p.startswith(target.rstrip("/") + "/") and p == p.strip()]
    if folder_files:
        return {"kind": "folder", "resolved_path": target, "files": sorted(set(folder_files))[:200]}
    return {"kind": "unresolved", "reason": "target file not found in archive", "target": target}


def _references(text: str) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    for match in CHAPTER_REF_RE.finditer(text):
        refs.append({"kind": "chapter", "text": match.group(0), "value": match.group(1)})
    for match in SECTION_REF_RE.finditer(text):
        refs.append({"kind": "section", "text": match.group(0), "value": match.group(1)})
    for match in PAGE_REF_RE.finditer(text):
        refs.append(
            {
                "kind": "pages",
                "text": match.group(0),
                "page_start": int(match.group(1)),
                "page_end": int(match.group(2)) if match.group(2) else int(match.group(1)),
            }
        )
    return refs


def build_section(
    raw: RawSection,
    blocks: list[Block],
    base_dir: str,
    inventory_by_path: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    label = raw.label
    kind, number = classify_label(label)
    date_range = parse_date_range(label)
    if date_range is None:  # table layouts keep dates in their own column
        for name, value in raw.fields.items():
            if re.search(r"date|period|duration", name, re.I) and (parsed := parse_date_range(value)):
                date_range = parsed
                break
    items: list[dict[str, Any]] = []
    objectives: list[str] = []
    resources: list[dict[str, Any]] = []
    external: list[dict[str, Any]] = []
    in_objectives = False
    text_parts = [label]

    candidate_blocks = list(raw.blocks)
    if raw.label_block is not None and blocks[raw.label_block].links:
        candidate_blocks = [raw.label_block, *candidate_blocks]

    for index in candidate_blocks:
        block = blocks[index]
        if index != raw.label_block:
            text_parts.append(block.text)
        is_heading = bool(block.heading_level) or block.emphasized
        if OBJECTIVE_HEAD_RE.search(block.text) and len(block.text) < 200:
            in_objectives = True
            tail = re.split(r":", block.text, maxsplit=1)
            if len(tail) == 2 and tail[1].strip():
                objectives.append(tail[1].strip())
            if index != raw.label_block:
                items.append({"type": "objectives_heading", "text": block.text, "tag": block.tag})
            continue
        if in_objectives and block.tag in {"li", "dd", "td"} and block.text:
            objectives.append(block.text)
            continue
        if is_heading or block.tag not in {"li", "dd"}:
            in_objectives = False

        link_texts = {link["text"] for link in block.links}
        for link in block.links:
            resolved = resolve_link(link["href"], base_dir, inventory_by_path)
            record = {"text": link["text"], "href": link["href"], **resolved}
            if resolved["kind"] == "external":
                external.append(record)
            elif resolved["kind"] in {"internal", "folder", "unresolved"}:
                resources.append(record)
        if index == raw.label_block or not block.text:
            continue
        if block.text in link_texts:
            continue  # the block is just a link; captured as a resource
        items.append({"type": "subheading" if is_heading else "text", "text": block.text, "tag": block.tag})

    for name, value in raw.fields.items():
        if name.startswith("_"):
            continue
        if value and value != label and not any(i["text"] == value for i in items):
            items.append({"type": "field", "field": name, "text": value, "tag": "td"})

    topics = [{"text": i["text"], "origin": "overview_text"} for i in items if i["type"] in {"text", "field"}]
    topics += [
        {"text": r["text"], "origin": "resource_link_title", "resolved_path": r.get("resolved_path")}
        for r in resources
        if r["text"]
    ]
    lectures = [
        {"title": r["text"], "resolved_path": r.get("resolved_path")}
        for r in resources
        if r.get("document_role") in {"presentation", "lecture_slides_pdf"}
    ]
    full_text = "\n".join(t for t in text_parts if t)
    return {
        "label": label,
        "label_kind": kind,
        "explicit_number": number,
        "date_range": date_range,
        "items": items,
        "topics": topics,
        "lectures": lectures,
        "learning_objectives": objectives,
        "references": _references(full_text),
        "resources": resources,
        "external_links": external,
        "text": full_text,
        "fields": raw.fields,
    }


# --------------------------------------------------------------------------
# Dates: complete missing years transparently
# --------------------------------------------------------------------------
def archive_anchor_date(archive_filename: str | None) -> date | None:
    if not archive_filename:
        return None
    match = ARCHIVE_DATE_RE.search(archive_filename)
    if not match:
        return None
    year, month, day = match.groups()
    try:
        return date(int(year), _month(month), int(day))
    except (KeyError, ValueError):
        return None


def complete_years(weeks: list[dict[str, Any]], document_text: str, anchor: date | None) -> None:
    explicit_years = [
        part["year"]
        for week in weeks
        if week["date_range"]
        for part in (week["date_range"]["start"], week["date_range"]["end"])
        if part.get("year")
    ]
    if explicit_years:
        base_year, source = explicit_years[0], "explicit_in_overview"
    else:
        years = re.findall(r"\b(20\d{2})\b", document_text)
        if anchor:
            # Citations ("Petzold (2000)") must not set the schedule year: only
            # years within a year of the archive's download date are credible.
            years = [y for y in years if abs(int(y) - anchor.year) <= 1]
        if years:
            base_year = int(max(set(years), key=years.count))
            source = "overview_text"
        elif anchor:
            base_year, source = anchor.year, "archive_filename"
        else:
            base_year, source = None, None

    first_dated = next((w for w in weeks if w["date_range"]), None)
    if first_dated and base_year and source == "archive_filename" and anchor:
        start = first_dated["date_range"]["start"]
        try:
            if date(base_year, start["month"], start["day"]) > date.fromordinal(anchor.toordinal() + 60):
                base_year -= 1  # schedule cannot start long after the archive was downloaded
        except ValueError:
            pass

    year = base_year
    previous_month = None
    for week in weeks:
        rng = week["date_range"]
        if not rng:
            continue
        explicit = bool(rng["start"].get("year"))
        for key in ("start", "end"):
            part = rng[key]
            if part.get("year"):
                year = part["year"]
            elif year is not None:
                if previous_month and part["month"] < previous_month - 6:
                    year += 1  # crossed a new year
                part["year"] = year
            previous_month = part["month"]
        rng["year_source"] = "explicit" if explicit else source
        try:
            rng["start_date"] = date(rng["start"]["year"], rng["start"]["month"], rng["start"]["day"]).isoformat()
            rng["end_date"] = date(rng["end"]["year"], rng["end"]["month"], rng["end"]["day"]).isoformat()
        except (TypeError, ValueError):
            rng["start_date"] = rng["end_date"] = None


# --------------------------------------------------------------------------
# Entry points
# --------------------------------------------------------------------------
def parse_overview(
    html: bytes | str,
    *,
    overview_path: str = "index.html",
    inventory_entries: list[dict[str, Any]] | None = None,
    archive_filename: str | None = None,
) -> dict[str, Any]:
    soup = BeautifulSoup(html, "lxml")
    title_tag = soup.find("title")
    title = single_line(title_tag.get_text(" ")) if title_tag else None
    h1 = soup.find("h1")
    heading_title = single_line(h1.get_text(" ")) if h1 else None
    document_text = normalize_whitespace(soup.get_text("\n"))

    blocks = linearize(soup)
    inventory_by_path: dict[str, dict[str, Any]] = {}
    for entry in inventory_entries or []:
        inventory_by_path[entry["path"]] = entry
        inventory_by_path.setdefault(entry["path"].lower(), entry)
    base_dir = posixpath.dirname(overview_path)

    strategies = [
        strategy_tables(soup, blocks),
        strategy_containers(soup, blocks),
        strategy_headings(blocks),
        strategy_paragraph_labels(blocks),
    ]
    # Structural strategies (tables, containers, headings) win whenever they find
    # at least two week-like labels; free-text labels are only a fallback,
    # because sub-items such as "Lecture 3" would otherwise split real weeks.
    priority = {"tables": 0, "containers": 1, "headings": 2, "paragraph_labels": 3}
    structural = [s for s in strategies if s.name != "paragraph_labels"]
    best_structural = max(structural, key=lambda s: (s.score, -priority[s.name]))
    paragraph = strategies[-1]
    chosen = best_structural if best_structural.score >= 2 or best_structural.score >= paragraph.score else paragraph
    warnings: list[str] = []
    if chosen.score < 2:
        heading_sections = [b for b in blocks if b.heading_level and b.heading_level > 1]
        if len(heading_sections) >= 2:
            level = min(b.heading_level for b in heading_sections if b.heading_level)
            starts = [b.index for b in heading_sections if b.heading_level == level]
            sections = []
            for position, start in enumerate(starts):
                end = starts[position + 1] if position + 1 < len(starts) else len(blocks)
                sections.append(RawSection(blocks[start].text, start, list(range(start + 1, end))))
            chosen = StrategyResult("heading_fallback", 0, sections, f"all h{level} headings (no week labels found)")
        else:
            chosen = StrategyResult(
                "whole_document", 0, [RawSection(title or "Overview", None, list(range(len(blocks))))], "no structure"
            )
        warnings.append(
            "No week-like structure was detected; sections were taken from "
            f"{chosen.detail}. Verify the timeline manually."
        )

    used = {i for s in chosen.sections for i in s.blocks} | {
        s.label_block for s in chosen.sections if s.label_block is not None
    }
    first_label = min((s.label_block for s in chosen.sections if s.label_block is not None), default=None)
    preamble_blocks = [b.index for b in blocks if first_label is not None and b.index < first_label and b.index not in used]

    built = [build_section(s, blocks, base_dir, inventory_by_path) for s in chosen.sections]
    if preamble_blocks:
        preamble = build_section(RawSection(title or "Course information", None, preamble_blocks), blocks, base_dir, inventory_by_path)
        preamble["label_kind"] = "preamble"
        built.insert(0, preamble)

    weeks = [s for s in built if s["label_kind"] not in {"other", "preamble"}]
    other_sections = [s for s in built if s["label_kind"] in {"other", "preamble"}]

    ordinal = 0
    for section in weeks:
        ordinal += 1
        section["ordinal"] = ordinal
        if section["label_kind"] == "week":
            section["week_number"], section["week_number_source"] = section["explicit_number"], "explicit"
        elif section["label_kind"] == "date_range":
            section["week_number"], section["week_number_source"] = ordinal, "inferred_from_order"
        else:
            section["week_number"], section["week_number_source"] = None, None
        section["id"] = f"week-{ordinal:02d}"
    for position, section in enumerate(other_sections, start=1):
        section["id"] = f"section-{position:02d}"

    complete_years(weeks, document_text, archive_anchor_date(archive_filename))

    numbers = [w["week_number"] for w in weeks if w["week_number_source"] == "explicit"]
    if len(numbers) != len(set(numbers)):
        warnings.append("Duplicate explicit week numbers found in the overview; check the source.")
    if numbers and numbers != sorted(numbers):
        warnings.append("Explicit week numbers are not in ascending order in the overview.")

    all_resources = [r for s in built for r in s["resources"]]
    unresolved = [r for r in all_resources if r["kind"] == "unresolved"]
    if unresolved:
        warnings.append(f"{len(unresolved)} link(s) in the overview could not be resolved to archive files.")

    return {
        "schema_version": SCHEMA_VERSION,
        "extractor_version": EXTRACTOR_VERSION,
        "generated_at": utc_now_iso(),
        "source_file": overview_path,
        "title": title,
        "heading_title": heading_title,
        "parser_strategy": {"name": chosen.name, "detail": chosen.detail, "score": chosen.score},
        "strategies_evaluated": [
            {"name": s.name, "score": s.score, "sections": len(s.sections), "detail": s.detail} for s in strategies
        ],
        "outline": [
            {"level": b.heading_level, "text": b.text} for b in blocks if b.heading_level
        ],
        "weeks": weeks,
        "other_sections": other_sections,
        "linked_files": sorted({r["resolved_path"] for r in all_resources if r["kind"] == "internal"}),
        "unresolved_links": unresolved,
        "external_links": [e for s in built for e in s["external_links"]],
        "block_count": len(blocks),
        "warnings": warnings,
    }


def is_viewer_shell(html: bytes | str) -> bool:
    """True for an index.html that only loads scripts (an LMS offline viewer)."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = normalize_whitespace(soup.get_text(" "))
    return len(text) < 40 and "course-data" in (html.decode("utf-8", "replace") if isinstance(html, bytes) else html)


def run_overview_stage(paths: Paths) -> dict[str, Any]:
    inventory = read_json(paths.inventory)
    selected = inventory["weekly_overview"]["selected"]
    if not selected:
        raise FileNotFoundError("The inventory has no Weekly Overview (index.html). Run inspect_archive first.")
    entry = next(e for e in inventory["entries"] if e["path"] == selected)
    html_path = paths.data / entry["extracted_path"]
    tracker = StatusTracker(paths.status)
    sha = entry["sha256"]
    tracker.register(sha, source_paths=[selected], sha256=sha, category="weekly_overview")
    tracker.start(sha, "overview", sha)
    html: bytes | str = html_path.read_bytes()
    lms_source: dict[str, Any] | None = None
    lms_path = paths.processed / "lms_export.json"
    if lms_path.exists() and is_viewer_shell(html):
        # An LMS offline viewer: index.html is an empty shell and the course
        # plan lives on the export's front page (see lms_export.py).
        export = read_json(lms_path)
        front = next((pg for pg in export.get("pages", []) if pg.get("front_page")), None)
        if front and front.get("html"):
            html = front["html"]
            lms_source = {"export_file": export["source_file"], "page_title": front.get("title")}
    try:
        result = parse_overview(
            html,
            overview_path=selected,
            inventory_entries=inventory["entries"],
            archive_filename=inventory["archive"]["filename"],
        )
    except Exception as exc:
        tracker.finish(sha, "overview", Status.FAILED, error=f"{type(exc).__name__}: {exc}")
        raise
    result["source_sha256"] = sha256_file(html_path)
    if lms_source:
        export = read_json(lms_path)
        result["title"] = result.get("title") or export.get("title")
        result["source_file"] = lms_source["export_file"]
        result["source_detail"] = (
            f"front page '{lms_source['page_title']}' of the LMS export loaded by {selected}"
        )
        result["shell_file"] = selected
    write_json_atomic(paths.weekly_overview, result)
    status = Status.COMPLETED if result["weeks"] and result["parser_strategy"]["score"] >= 2 else Status.PARTIAL
    tracker.finish(
        sha,
        "overview",
        status,
        output="processed/weekly_overview.json",
        warnings=result["warnings"],
        details={"strategy": result["parser_strategy"]["name"], "teaching_sections": len(result["weeks"])},
    )
    write_text_atomic(paths.reports / "weekly_overview_report.md", render_overview_report(result))
    LOG.info(
        "Weekly overview: strategy=%s, %d teaching sections, %d other sections, %d warnings",
        result["parser_strategy"]["name"],
        len(result["weeks"]),
        len(result["other_sections"]),
        len(result["warnings"]),
    )
    return result


def render_overview_report(result: dict[str, Any]) -> str:
    lines = [
        "# Weekly Overview extraction report",
        "",
        f"- Source: `{result['source_file']}`" + (f" — {result['source_detail']}" if result.get("source_detail") else ""),
        f"- Title: {result.get('title') or '(none)'}",
        f"- Parser strategy: **{result['parser_strategy']['name']}** — {result['parser_strategy']['detail']}",
        "",
        "| Strategy | Week-like labels | Sections |",
        "|---|---|---|",
    ]
    lines += [f"| {s['name']} | {s['score']} | {s['sections']} |" for s in result["strategies_evaluated"]]
    lines += ["", "## Teaching sequence", ""]
    for week in result["weeks"]:
        number = f"Week {week['week_number']}" if week["week_number"] else f"#{week['ordinal']}"
        source = f" ({week['week_number_source']})" if week.get("week_number_source") else ""
        dates = ""
        if week["date_range"] and week["date_range"].get("start_date"):
            dates = f" — {week['date_range']['start_date']} → {week['date_range']['end_date']}"
            if week["date_range"].get("year_source") not in (None, "explicit"):
                dates += f" (year inferred from {week['date_range']['year_source']})"
        lines.append(f"### {number}{source}: {week['label']}{dates}")
        for topic in week["topics"]:
            lines.append(f"- {topic['text']}  _({topic['origin']})_")
        if week["learning_objectives"]:
            lines.append("- Learning objectives: " + "; ".join(week["learning_objectives"]))
        for resource in week["resources"]:
            target = resource.get("resolved_path") or resource.get("target") or resource["href"]
            lines.append(f"  - resource: `{target}` [{resource['kind']}]")
        lines.append("")
    if result["other_sections"]:
        lines += ["## Other sections", ""]
        lines += [f"- {s['label']} ({s['label_kind']})" for s in result["other_sections"]]
    if result["warnings"]:
        lines += ["", "## Warnings", ""] + [f"- {w}" for w in result["warnings"]]
    return "\n".join(lines) + "\n"


def parse_overview_file(path: Path) -> dict[str, Any]:
    """Parse a standalone HTML file (debugging / tests)."""
    return parse_overview(path.read_bytes(), overview_path=PurePosixPath(path.name).as_posix())
