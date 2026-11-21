"""Curriculum mapping (Stage F, run inside Stage E).

Builds the teaching structure of a subject from evidence printed in the
material itself, and records the evidence for every link:

* **Sessions** — one per taught class. Numbers come from the material:
  "SESSION 7" / "S1 · Mon 31 Aug" on a title slide, "Module 2 · Class 3",
  ``CSD104_S9_…`` in a filename or LMS title, "Reading 5 of 10" in a reading.
* **Dates** — read from title slides, reading headers and schedule tables.
  When sources disagree the majority wins, ties go to the published schedule,
  and the disagreement is kept as a discrepancy.
* **Plan weeks** — a session is placed in a Weekly Overview week *only* by
  date (the session's date falls in that week's calendar week). LMS module
  labels such as "Week 7" are recorded but never used to place a session:
  they are teaching-week counters that need not match calendar weeks.
* **Textbook references** — "Further reading" passages in slides and readings
  ("Petzold — Ch. 12", "Kurose and Ross, Section 2.2.5", "the chapter “An
  Assemblage of Memory”") are cited verbatim and resolved to page ranges via
  the book's PDF outline, or via OCR running headers (marked unverified).
* **Suggestions** — keyword-overlap matches (plan week ↔ session, session ↔
  textbook section) are labelled ``heuristic`` and never presented as
  course-confirmed.

Nothing here calls an AI service. Every inference names its basis.
"""

from __future__ import annotations

import difflib
import logging
import math
import posixpath
import re
from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import Any

from bs4 import BeautifulSoup

LOG = logging.getLogger("synapse_ingest.curriculum")

MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
WEEKDAY = r"(Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)[a-z]*\.?"
MONTH = r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?"
DATE_RE = re.compile(rf"\b{WEEKDAY},?\s+(\d{{1,2}})\s+{MONTH}(?:,?\s+(20\d\d))?", re.I)
DAY_MONTH_YEAR_RE = re.compile(rf"\b(\d{{1,2}})\s+{MONTH}\s+(20\d\d)\b", re.I)

MODULE_RE = re.compile(r"\bMODULE\s*(\d)\b", re.I)
MODULE_FILE_RE = re.compile(r"(?:^|[_\-\s])(?:Module|M)(\d)(?=[_\-\s]|$)", re.I)
CLASS_RE = re.compile(r"\bClass\s*(\d{1,2})\b(?!\s*(?:to|-|–)\s*\d)", re.I)
CLASS_FILE_RE = re.compile(r"(?:^|_)C(\d{1,2})(?=_|$)")
READING_N_RE = re.compile(r"\bReading\s*(\d{1,2})\s*(?:of\s*\d+|:)", re.I)
READING_FILE_RE = re.compile(r"Reading_(\d{1,2})(?=_)", re.I)
SESSION_TEXT_RE = re.compile(r"(?<!WEEK\d·)(?<!WEEK\d\d·)\bSESSION\s*(\d{1,2})\b", re.I)
WEEK_SESSION_RE = re.compile(r"\bWEEK\s*(\d{1,2})\s*·\s*SESSION\s*(\d{1,2})\b", re.I)
S_LABEL_RE = re.compile(r"(?:^|[_\s·])S(\d{1,2})(?=[_\s·:]|$)")
S_MULTI_RE = re.compile(r"(?:^|_)((?:S\d{1,2}){2,})(?=_)")
W_S_FILE_RE = re.compile(r"(?:^|_)W(\d{1,2})S(\d)(?=_)")

ROLE_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("student_work", re.compile(r"thinking\s*log", re.I)),
    ("assessment", re.compile(r"quiz|class\s*test|classtest|question\s*paper|answer\s*key|answerkey|\bexam\b", re.I)),
    ("schedule", re.compile(r"schedule", re.I)),
    ("practice", re.compile(r"worksheet|practice", re.I)),
    ("activity", re.compile(r"activity", re.I)),
    ("reading", re.compile(r"reading|_chapter\b|chapter[_\s-]|reading\s+companion", re.I)),
]
HOW_RE = re.compile(
    r"^(live(, with practice)?|lab|assessment|take-home|open session|read in advance,?|discussed in class|bring your laptop\.?)$",
    re.I,
)
FURTHER_RE = re.compile(r"further\s*reading|go\s*deeper|chapters\s+behind|read these to go", re.I)
CHAPTER_REF_RE = re.compile(
    r"\b(?:Ch(?:apters?)?)\.?\s*(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?((?:\s*(?:,|and|&|\+)\s*(?:Ch\.?\s*)?\d{1,2}\b)*)",
    re.I,
)
SECTION_REF_RE = re.compile(r"\bSections?\s+(\d+(?:\.\d+)+)", re.I)
QUOTED_RE = re.compile(r"[“\"]([^”\"\n]{3,70})[”\"]")
NUMBER_WORDS = {
    w: i
    for i, w in enumerate(
        "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
        "seventeen eighteen nineteen twenty".split()
    )
}
STOP = set(
    "the a an and or of to in on for with by from at as is are be this that these those it its into how what why "
    "when which who your you we our can do does not no one two all each more most than then there their them also "
    "csd 104 csd-104 session class module reading slides chapter pdf part week weeks using use used page".split()
)


# ----------------------------------------------------------------- helpers
def despace(text: str) -> str:
    """Collapse letter-spaced headings ("S E S S I O N 1 0" → "SESSION10")."""
    return re.sub(r"\b(?:[A-Za-z0-9] ){2,}[A-Za-z0-9]\b", lambda m: m.group(0).replace(" ", ""), text)


def tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z][a-z0-9/\-]{2,}", text.lower()) if t not in STOP]


def stem_of(path: str) -> str:
    return posixpath.splitext(posixpath.basename(path))[0]


def resolve_year(day: int, month: int, explicit: str | None, anchor: date | None) -> tuple[date | None, str]:
    if explicit:
        try:
            return date(int(explicit), month, day), "explicit"
        except ValueError:
            return None, "invalid"
    if not anchor:
        return None, "no_year"
    try:
        candidate = date(anchor.year, month, day)
    except ValueError:
        return None, "invalid"
    if candidate > anchor + timedelta(days=120):
        candidate = date(anchor.year - 1, month, day)
    return candidate, "archive_date"


def find_dates(text: str, anchor: date | None) -> list[dict[str, Any]]:
    found = []
    for match in DATE_RE.finditer(text):
        _, day, month, year = match.groups()
        value, basis = resolve_year(int(day), MONTHS[month[:3].lower()], year, anchor)
        if value:
            found.append({"date": value.isoformat(), "raw": match.group(0), "year_basis": basis})
    for match in DAY_MONTH_YEAR_RE.finditer(text):
        day, month, year = match.groups()
        value, basis = resolve_year(int(day), MONTHS[month[:3].lower()], year, anchor)
        if value and not any(f["date"] == value.isoformat() for f in found):
            found.append({"date": value.isoformat(), "raw": match.group(0), "year_basis": basis})
    return found


def clean_title(name: str) -> str:
    stem = re.sub(r"\.(pdf|pptx?|docx?)$", "", name, flags=re.I)
    stem = re.sub(r"\s*\(\d+\)$|-\d$", "", stem)
    stem = re.sub(r"^(CSD-?104_?)", "", stem, flags=re.I)
    stem = re.sub(r"(?:^|_)(?:Module\d|M\d|S\d{1,2}(?:S\d{1,2})*|W\d+S\d|C\d+|Session[A-Z]|Reading_\d+)(?=_|$)", "_", stem, flags=re.I)
    stem = re.sub(r"(?:^|_)(Slides\d*|Chapter|Main_Deck|Reading|v\d+|Students)(?=_|$)", "_", stem, flags=re.I)
    stem = stem.replace("I:O", "I/O").replace("_", " ")
    stem = re.sub(r"(?<=[a-z])(?=[A-Z][a-z])", " ", stem)
    return re.sub(r"\s+", " ", stem).strip(" -·")


def first_text(extraction: dict[str, Any] | None, count: int = 1) -> str:
    if not extraction:
        return ""
    units = extraction.get("slides") or extraction.get("units") or []
    return "\n".join((u.get("text") or "") for u in units[:count])


def all_units(extraction: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not extraction:
        return []
    out = []
    for unit in extraction.get("slides") or []:
        out.append({"number": unit["slide_number"], "kind": "slide", "text": unit.get("text") or ""})
    for unit in extraction.get("units") or []:
        number = unit.get("page_number") or unit.get("section_number")
        out.append({"number": number, "kind": unit.get("unit_type", "page"), "text": unit.get("text") or ""})
    return out


OBJECTIVES_RE = re.compile(r"(?i)(what you will learn[^\n]*|learning (?:objectives|outcomes)[^\n]*|by the end of this (?:session|reading|class)[^\n]*)\n")


def learning_objectives(text: str) -> list[str]:
    """Bulleted objectives under a 'What you will learn' heading (verbatim)."""
    match = OBJECTIVES_RE.search(text)
    if not match:
        return []
    rest = text[match.end():].lstrip()
    block = re.split(r"\n\s*\n(?=\s*(?:\d+\.\d|[A-Z][^\n•]{0,80}\n))", rest, maxsplit=1)[0]
    items = [re.sub(r"\s+", " ", i).strip(" ;.") for i in re.split(r"[•▪●]", block)]
    return [i[0].upper() + i[1:] for i in items if 8 <= len(i) <= 300][:10]


def driving_question(text: str) -> str | None:
    flat = re.sub(r"\s+", " ", despace(text))
    # Start at an interrogative word so title-slide banners ("MODULE 1 · THE MACHINE") are not included.
    pattern = r"\b((?:How|Why|What|When|Where|Which|Who|Can|Could|Does|Do|Is|Are|Should|Would|Will)\b[^?.!·|]{6,140}\?)"
    for match in re.finditer(pattern, flat):
        candidate = match.group(1).strip()
        if len(candidate.split()) >= 3 and not candidate.isupper():
            return candidate
    return None


# --------------------------------------------------------------- sessions
def classify_role(document: dict[str, Any], lms_titles: list[str], in_books: bool) -> str:
    if in_books:
        return "book"
    haystack = " ".join([document["original_filename"], document.get("title") or "", *lms_titles])
    for role, pattern in ROLE_RULES:
        if pattern.search(haystack):
            return role
    if document["document_type"] in {"lecture_slides_pdf", "presentation"}:
        return "slides"
    if document["document_type"] == "textbook":
        return "book"
    return "supporting"


def document_markers(document: dict[str, Any], extraction: dict[str, Any] | None, lms_titles: list[str], anchor: date | None) -> dict[str, Any]:
    page1 = despace(first_text(extraction))[:900]
    names = [document["original_filename"], *(stem_of(p) for p in document["archive_paths"]), *lms_titles]
    if document.get("title"):
        names.append(document["title"])
    markers: dict[str, Any] = {"evidence": [], "conflicts": []}

    modules = {int(m) for m in MODULE_RE.findall(page1)}
    module_basis = "title page text" if modules else None
    if not modules:
        modules = {int(m) for n in names for m in MODULE_FILE_RE.findall(stem_of(n))}
        module_basis = "filename/LMS title" if modules else None
    if len(modules) == 1:
        markers["module"] = modules.pop()
        markers["evidence"].append(f"module {markers['module']} from {module_basis}")

    classes = {int(c) for c in CLASS_RE.findall(page1[:300])} if re.search(r"module\s*2|network", page1, re.I) else set()
    reading_numbers = {int(n) for n in READING_N_RE.findall(page1[:400])} | {
        int(n) for name in names for n in READING_FILE_RE.findall(name)
    }
    file_classes = {int(c) for name in names for c in CLASS_FILE_RE.findall(stem_of(name))}
    if classes:
        markers["class"] = min(classes) if len(classes) > 1 else next(iter(classes))
        markers["evidence"].append(f"'Class {markers['class']}' on page 1")
    elif file_classes and len(file_classes) == 1:
        markers["class"] = next(iter(file_classes))
        markers["evidence"].append(f"'C{markers['class']}' in filename/title")
    if reading_numbers:
        number = min(reading_numbers)
        markers["reading_number"] = number
        if "class" not in markers and markers.get("module", 2) == 2:
            markers["class"] = number
            markers["evidence"].append(f"reading {number} (readings are numbered by class)")
        elif markers.get("class") and markers["class"] != number:
            markers["conflicts"].append(f"reading number {number} differs from class {markers['class']}")

    session_text = {int(s) for s in SESSION_TEXT_RE.findall(page1)}
    week_session = WEEK_SESSION_RE.search(page1)
    if week_session:
        markers["week_label"] = {"week": int(week_session.group(1)), "session_in_week": int(week_session.group(2))}
        session_text.discard(int(week_session.group(2)))
    s_text = {int(s) for s in S_LABEL_RE.findall(page1[:200])}
    s_names = {int(s) for name in names for s in S_LABEL_RE.findall(stem_of(name))}
    multi: set[tuple[int, ...]] = set()
    for name in [*lms_titles, document.get("title") or "", document["original_filename"]]:
        found = {tuple(int(x) for x in re.findall(r"\d+", m)) for m in S_MULTI_RE.findall(stem_of(name))}
        if found:
            multi = found  # the LMS title students see wins over metadata and filename
            others = {
                tuple(int(x) for x in re.findall(r"\d+", m))
                for other in names
                for m in S_MULTI_RE.findall(stem_of(other))
            } - found
            if others:
                markers["conflicts"].append(f"session range in '{name}' differs from other names {sorted(others)}")
            break
    w_s = [tuple(int(x) for x in m) for name in names for m in W_S_FILE_RE.findall(stem_of(name))]
    if w_s:
        markers["filename_week_labels"] = sorted(set(w_s))
    candidates = Counter()
    for value in session_text:
        candidates[value] += 2
    for value in s_text:
        candidates[value] += 2
    for value in s_names:
        candidates[value] += 1
    if multi:
        largest = max(multi, key=len)
        markers["covers_sessions"] = sorted(set(n for group in multi for n in group))
        markers["evidence"].append(f"covers sessions {markers['covers_sessions']} (from name)")
    elif candidates:
        best = candidates.most_common()
        markers["session"] = best[0][0]
        markers["evidence"].append(f"session {best[0][0]} from " + ("title page" if best[0][1] >= 2 else "filename/LMS title"))
        if len(best) > 1:
            markers["conflicts"].append(f"other session labels seen: {[b[0] for b in best[1:]]}")
    markers["dates"] = find_dates(page1[:500], anchor)
    markers["driving_question"] = driving_question(first_text(extraction)[:700])
    markers["objectives"] = learning_objectives(first_text(extraction, 2)[:4000])
    return markers


ROW_LABEL_RE = re.compile(r"^((?:Class|Quiz|Practical|Recap|Lab|Exam|Test|Holiday)(?:\s+(?:\d{1,2}|test|due))*)\b\s*(.*)$")
TRAILING_HOW_RE = re.compile(r"\s*(read in advance, discussed in class|open session|assessment|take-home|live(, with practice)?|lab)\.?$", re.I)


def parse_schedule(text: str, anchor: date | None) -> list[dict[str, Any]]:
    """Rows of a class-calendar table extracted as text.

    Handles both layouts PDF text extraction produces: one cell per line, or
    one row per line ("Mon 16 Nov Class 1 Physical layer: …").
    """
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    row_date = re.compile(rf"^{WEEKDAY}\s+(\d{{1,2}})\s+{MONTH}\b\s*(.*)$", re.I)
    rows: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    orphan: list[str] = []
    in_calendar = not re.search(r"class calendar", text, re.I)
    for line in lines:
        if re.search(r"class calendar", line, re.I):
            in_calendar = True
            continue
        if not in_calendar:
            continue
        if re.match(r"^(shaded rows|assessments$|csd-104\s*·)", line, re.I):
            break
        match = row_date.match(line)
        if match:
            if current:
                rows.append(current)
            _, day, month, rest = match.groups()
            value, basis = resolve_year(int(day), MONTHS[month[:3].lower()], None, anchor)
            current = {"date": value.isoformat() if value else None, "raw_date": line[: match.start(4)].strip(), "year_basis": basis, "label": None, "cover": [], "how": []}
            if rest:
                label_match = ROW_LABEL_RE.match(rest)
                if label_match:
                    current["label"], body = label_match.group(1), label_match.group(2)
                else:
                    current["label"], body = rest.split(" ", 1)[0], rest.split(" ", 1)[1] if " " in rest else ""
                how = TRAILING_HOW_RE.search(body)
                if how:
                    current["how"].append(how.group(1))
                    body = body[: how.start()]
                if body:
                    current["cover"].append(body)
                elif orphan:
                    current["cover"].append(TRAILING_HOW_RE.sub("", " ".join(orphan)))
            orphan = []
            continue
        if HOW_RE.match(line) or re.match(r"^date\s+class", line, re.I):
            continue
        if current and current["label"] is None:
            current["label"] = line
        elif current and current["label"] and not current["cover"] and line.lower() in {"due", "issued"}:
            current["label"] += f" {line}"
        elif current and current["cover"] == [] and current["label"]:
            current["cover"].append(line)
        else:
            orphan.append(line)
    if current:
        rows.append(current)
    for row in rows:
        row["cover"] = " ".join(row["cover"]).strip()
        row["how"] = " ".join(row["how"]).strip()
        class_match = re.match(r"^Class\s+(\d{1,2})$", row["label"] or "", re.I)
        row["class"] = int(class_match.group(1)) if class_match else None
        row["kind"] = "class" if row["class"] else ("assessment" if re.search(r"quiz|test|practical|exam", row["label"] or "", re.I) else "other")
    return [r for r in rows if r["label"]]


WHEN = r"(Every class|Issued \w{3} \d{1,2} \w{3}, due \w{3} \d{1,2} \w{3}|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w* \d{1,2} \w{3})"


def parse_marks_table(text: str) -> list[dict[str, Any]]:
    """Component / marks / when rows from an assessment table extracted as text."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    rows = []
    row_re = re.compile(rf"^(.{{3,60}}?)\s+(\d{{1,3}}(?:\.\d)?)\s+{WHEN}\s*(.*)$")
    for i, line in enumerate(lines):
        if m := row_re.match(line):
            rows.append({"component": m.group(1), "marks": float(m.group(2)), "when": m.group(3), "notes": m.group(4) or None})
            continue
        if i + 1 < len(lines) and re.fullmatch(r"\d{1,3}(?:\.\d)?", lines[i + 1]) and not re.fullmatch(r"[\d.]+", line) and len(line) < 60 and line.lower() not in {"marks", "component"}:
            when = lines[i + 2] if i + 2 < len(lines) and re.match(WHEN, lines[i + 2]) else None
            rows.append({"component": line, "marks": float(lines[i + 1]), "when": when, "notes": None})
    return rows


def parse_html_assessments(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html or "", "lxml")
    rows = []
    for table in soup.find_all("table"):
        header = [c.get_text(" ", strip=True).lower() for c in (table.find("tr") or soup.new_tag("tr")).find_all(["th", "td"])]
        if not any("component" in h for h in header):
            continue
        for tr in table.find_all("tr")[1:]:
            cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
            if len(cells) >= 2 and cells[0] and cells[0].lower() != "total":
                rows.append({"component": cells[0], "weight": cells[1], "notes": cells[2] if len(cells) > 2 else ""})
    return rows


def assessment_key(name: str) -> str:
    text = name.lower()
    for pattern, key in [
        (r"practical\s*1|\bp1\b", "practical-1"),
        (r"practical\s*2|\bp2\b|wireshark", "practical-2"),
        (r"practical\s*3|\bp3\b|packet tracer", "practical-3"),
        (r"quiz\s*1", "quiz-1"),
        (r"quiz\s*2", "quiz-2"),
        (r"end.?sem", "end-semester-exam"),
        (r"thinking log", "thinking-log"),
    ]:
        if re.search(pattern, text):
            return key
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


# ---------------------------------------------------------- textbooks
def book_terms(document: dict[str, Any], extraction: dict[str, Any] | None, lms_titles: list[str]) -> set[str]:
    text = " ".join([document["original_filename"], document.get("title") or "", *lms_titles])
    words = {w for w in re.findall(r"[A-Za-z][a-z]{3,}", text) if w.lower() not in STOP}
    meta = (extraction or {}).get("metadata") or {}
    if meta.get("author"):
        words |= set(re.findall(r"[A-Za-z][a-z]{3,}", meta["author"]))
    generic = {"Computer", "Computers", "Computing", "Hardware", "Software", "Edition", "Pearson", "Approach", "Language", "Systems", "Building", "Modern", "Principles", "Simple", "Ideas", "Make", "Work", "Hidden", "compressed", "Networking", "First", "Elements"}
    return {w for w in words if w not in generic}


def book_chapters(extraction: dict[str, Any] | None) -> tuple[list[dict[str, Any]], str]:
    """Chapters and sections with page ranges; from the outline or OCR headers."""
    if not extraction:
        return [], "none"
    page_count = extraction.get("page_count") or 0
    outline = extraction.get("outline") or []
    entries: list[dict[str, Any]] = []
    if outline:
        for item in outline:
            title = item["title"].strip()
            number = None
            if m := re.match(r"^(?:Chapter\s+)?(\d+(?:\.\d+)*)[.\s-]", title + " "):
                number = m.group(1)
            entries.append({"level": item["level"], "title": title, "number": number, "page_start": item["page_number"], "source": "pdf_outline"})
        basis = "pdf_outline"
    else:
        # OCR'd books: chapter starts from "Chapter <Word>" running headers.
        seen: dict[int, dict[str, Any]] = {}
        for unit in extraction.get("units") or []:
            head = unit.get("text", "")[:260]
            m = re.search(r"\bChapter\s+([A-Z][a-z]+(?:-[A-Za-z]+)?)\b", head)
            if not m or len(re.findall(r"\bChapter\s+[A-Z][a-z]+", unit.get("text", "")[:1200])) > 2:
                continue  # no chapter header, or a table-of-contents page
            word = m.group(1).lower()
            value = NUMBER_WORDS.get(word)
            if value is None and "-" in word:
                a, b = word.split("-", 1)
                value = NUMBER_WORDS.get(a, 0) + NUMBER_WORDS.get(b, 0) if a in NUMBER_WORDS else None
            if value is None or value in seen:
                continue
            after = head[m.end():].strip().splitlines()
            title = next((l.strip() for l in after if len(l.strip()) > 3 and not re.match(r"^[a-z]", l.strip())), "")
            seen[value] = {"level": 1, "title": f"{value}. {title}".strip(), "number": str(value), "page_start": unit["page_number"], "source": "ocr_running_header"}
        entries = [seen[k] for k in sorted(seen)]
        basis = "ocr_running_header" if entries else "none"
    for i, entry in enumerate(entries):
        nxt = next((e["page_start"] for e in entries[i + 1 :] if e["level"] <= entry["level"]), None)
        entry["page_end"] = (nxt - 1) if nxt and nxt > entry["page_start"] else (nxt or page_count or entry["page_start"])
    return entries, basis


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", re.sub(r"^\s*(chapter\s+)?\d+(\.\d+)*[.\s-]*", "", text.lower())).strip()


def resolve_reference(ref: dict[str, Any], chapters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for number in ref.get("chapters", []):
        hit = next((c for c in chapters if c["level"] == 1 and c["number"] == str(number)), None)
        if hit:
            out.append({**hit, "matched_by": f"chapter {number}"})
    for section in ref.get("sections", []):
        hit = next((c for c in chapters if c["number"] == section), None)
        if hit:
            out.append({**hit, "matched_by": f"section {section}"})
    for title in ref.get("titles", []):
        target = _norm(title)
        best, score = None, 0.0
        for chapter in chapters:
            candidate = _norm(chapter["title"])
            ratio = difflib.SequenceMatcher(None, target, candidate).ratio()
            if chapter["source"] == "ocr_running_header" and len(candidate) >= 8 and target.startswith(candidate):
                ratio = max(ratio, 0.85)  # OCR kept only the first line of a wrapped title
            if ratio > score:
                best, score = chapter, ratio
        if best and score >= 0.8 and not any(o["title"] == best["title"] for o in out):
            out.append({**best, "matched_by": f"title “{title}” ({score:.2f})"})
    return out


def extract_further_reading(units: list[dict[str, Any]], books: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    refs = []
    for unit in units:
        text = unit["text"]
        if not FURTHER_RE.search(despace(text)) and not any(re.search(rf"\b{t}\b", text) for b in books.values() for t in b["surnames"]):
            continue
        marker = FURTHER_RE.search(despace(text))
        scope = text if not marker else text
        mentions = []
        for key, book in books.items():
            for term in book["surnames"]:
                for m in re.finditer(rf"\b{re.escape(term)}\b", scope):
                    mentions.append((m.start(), key))
        mentions.sort()
        if not mentions:
            continue
        # Keep only further-reading style passages: chapters/sections/quotes nearby.
        for i, (start, key) in enumerate(mentions):
            end = next((s for s, k in mentions[i + 1 :] if k != key), min(len(scope), start + 450))
            segment = scope[start:end]
            chapters: list[int] = []
            for m in CHAPTER_REF_RE.finditer(segment):
                first = int(m.group(1))
                last = int(m.group(2)) if m.group(2) else first
                chapters.extend(range(first, last + 1))
                chapters.extend(int(n) for n in re.findall(r"\d{1,2}", m.group(3) or ""))
            sections = SECTION_REF_RE.findall(segment)
            titles = [t for t in QUOTED_RE.findall(segment) if not re.match(r"^\d", t)]
            if not (chapters or sections or titles):
                continue
            excerpt = re.sub(r"\s+", " ", segment).strip()[:220]
            existing = next((r for r in refs if r["book_key"] == key and r["unit_number"] == unit["number"]), None)
            if existing:
                existing["chapters"] = sorted(set(existing["chapters"]) | set(chapters))
                existing["sections"] = sorted(set(existing["sections"]) | set(sections))
                existing["titles"] = list(dict.fromkeys(existing["titles"] + titles))
                continue
            refs.append(
                {
                    "book_key": key,
                    "unit_kind": unit["kind"],
                    "unit_number": unit["number"],
                    "chapters": sorted(set(chapters)),
                    "sections": sorted(set(sections)),
                    "titles": titles,
                    "excerpt": excerpt,
                }
            )
    return refs


# ---------------------------------------------------------- TF-IDF
class Tfidf:
    def __init__(self, docs: dict[str, str]):
        self.tf = {k: Counter(tokens(v)) for k, v in docs.items()}
        df = Counter(t for c in self.tf.values() for t in c)
        n = max(1, len(docs))
        self.idf = {t: math.log((1 + n) / (1 + d)) + 1 for t, d in df.items()}
        self.norm = {k: math.sqrt(sum((c * self.idf[t]) ** 2 for t, c in tf.items())) or 1.0 for k, tf in self.tf.items()}

    def query(self, text: str, top: int = 3) -> list[tuple[str, float]]:
        q = Counter(tokens(text))
        qn = math.sqrt(sum((c * self.idf.get(t, 0)) ** 2 for t, c in q.items())) or 1.0
        scores = []
        for key, tf in self.tf.items():
            dot = sum(c * self.idf.get(t, 0) * tf.get(t, 0) * self.idf.get(t, 0) for t, c in q.items())
            if dot:
                scores.append((key, dot / (qn * self.norm[key])))
        return sorted(scores, key=lambda s: -s[1])[:top]


# ------------------------------------------------------------- main entry
def build_curriculum(
    *,
    slug: str,
    documents: list[dict[str, Any]],
    extractions: dict[str, dict[str, Any]],
    weeks: list[dict[str, Any]],
    lms_export: dict[str, Any] | None,
    anchor: date | None,
) -> dict[str, Any]:
    discrepancies: list[dict[str, Any]] = []
    doc_by_path = {p: d for d in documents for p in d["archive_paths"]}

    # LMS placements (source-confirmed: the course shell lists the file there)
    placements: dict[str, list[dict[str, Any]]] = defaultdict(list)
    lms_units = []
    for module in (lms_export or {}).get("modules", []):
        unit_docs = []
        for item in module["items"]:
            document = doc_by_path.get(item.get("resolved_path") or "")
            if not document:
                continue
            placements[document["id"]].append({"module": module["name"], "position": module["position"], "item_title": item["title"], "kind": module["kind"]})
            unit_docs.append({"document_id": document["id"], "item_title": item["title"], "filename": document["original_filename"]})
            if item["title"] and posixpath.basename(item.get("resolved_path") or "") != item["title"] and clean_title(item["title"]) != clean_title(document["original_filename"]):
                discrepancies.append(
                    {
                        "kind": "lms_title_differs_from_file",
                        "severity": "info",
                        "detail": f"LMS lists '{item['title']}' but the file is '{document['original_filename']}'",
                        "sources": [lms_export["source_file"], document["source_path"]],
                    }
                )
        lms_units.append({"name": module["name"], "position": module["position"], "kind": module["kind"], "label_week_numbers": module["label_week_numbers"], "documents": unit_docs})

    # Per-document markers and roles
    info: dict[str, dict[str, Any]] = {}
    for document in documents:
        if document["document_type"] == "weekly_overview":
            continue
        extraction = extractions.get(document["doc_key"])
        lms_titles = [p["item_title"] for p in placements.get(document["id"], []) if p["item_title"]]
        in_books = any(p["kind"] == "books" for p in placements.get(document["id"], []))
        role = classify_role(document, lms_titles, in_books)
        markers = document_markers(document, extraction, lms_titles, anchor) if role not in {"book", "student_work"} else {"evidence": [], "conflicts": [], "dates": []}
        info[document["id"]] = {"document": document, "role": role, "markers": markers, "lms": placements.get(document["id"], [])}
        for wl in markers.get("filename_week_labels", []):
            label = markers.get("week_label")
            if label and label["week"] != wl[0]:
                discrepancies.append(
                    {
                        "kind": "week_label_conflict",
                        "severity": "warning",
                        "detail": f"{document['original_filename']}: title slide says 'Week {label['week']} · Session {label['session_in_week']}' but its name/metadata says 'W{wl[0]}S{wl[1]}'",
                        "sources": [document["source_path"]],
                    }
                )

    # Module inference for documents without a module marker (same LMS unit)
    for entry in info.values():
        m = entry["markers"]
        if "module" in m or not ({"session", "class", "covers_sessions"} & m.keys()):
            continue
        siblings = [
            info[d["document_id"]]["markers"].get("module")
            for unit in lms_units
            if any(d["document_id"] == entry["document"]["id"] for d in unit["documents"])
            for d in unit["documents"]
            if d["document_id"] in info
        ]
        siblings = [s for s in siblings if s]
        if siblings:
            m["module"] = Counter(siblings).most_common(1)[0][0]
            m["evidence"].append(f"module {m['module']} inferred from other files in the same LMS module")
        elif "session" in m:
            known = sorted(
                {(e["markers"].get("module"), e["markers"].get("session")) for e in info.values() if e["markers"].get("module") and e["markers"].get("session")}
            )
            same = [mod for mod, s in known if s is not None and abs(s - m["session"]) <= 2]
            if same:
                m["module"] = Counter(same).most_common(1)[0][0]
                m["evidence"].append(f"module {m['module']} inferred from neighbouring session numbers")

    # Schedule documents (Module-level calendars)
    schedule_rows: list[dict[str, Any]] = []
    marks_rows: list[dict[str, Any]] = []
    for entry in info.values():
        if entry["role"] != "schedule":
            continue
        extraction = extractions.get(entry["document"]["doc_key"])
        units = all_units(extraction)
        full = "\n".join(u["text"] for u in units)
        raw_text = "\n".join((u.get("text") or "") for u in (extraction or {}).get("units", []))
        module = entry["markers"].get("module")
        for row in parse_schedule(raw_text or full, anchor):
            row.update({"module": module, "source_document_id": entry["document"]["id"], "source_file": entry["document"]["original_filename"]})
            schedule_rows.append(row)
        for row in parse_marks_table(raw_text or full):
            row.update({"module": module, "source_file": entry["document"]["original_filename"]})
            marks_rows.append(row)

    # Sessions
    sessions: dict[tuple[int | None, str, int], dict[str, Any]] = {}

    def session_for(module: int | None, kind: str, number: int) -> dict[str, Any]:
        key = (module, kind, number)
        if key not in sessions:
            prefix = f"M{module}" if module else "M?"
            label = f"Class {number}" if kind == "class" else f"Session {number}"
            sessions[key] = {
                "key": f"{prefix}-{'C' if kind == 'class' else 'S'}{number:02d}",
                "module": module,
                "numbering": kind,
                "number": number,
                "label": label,
                "documents": [],
                "date_evidence": [],
                "lms_units": [],
                "further_reading": [],
                "discrepancies": [],
            }
        return sessions[key]

    for entry in info.values():
        m = entry["markers"]
        targets: list[tuple[int | None, str, int]] = []
        if "class" in m:
            targets = [(m.get("module", 2), "class", m["class"])]
        elif "session" in m and m.get("module") == 2:
            m["evidence"].append("Module 2 is taught in numbered classes; this file carries only a running 'S' number, so it is kept as a module resource")
        elif "session" in m:
            targets = [(m.get("module"), "session", m["session"])]
        elif "covers_sessions" in m:
            targets = [(m.get("module"), "session", n) for n in m["covers_sessions"]]
        for module, kind, number in targets:
            session = session_for(module, kind, number)
            session["documents"].append(
                {
                    "document_id": entry["document"]["id"],
                    "filename": entry["document"]["original_filename"],
                    "role": entry["role"],
                    "shared": len(targets) > 1,
                    "evidence": m["evidence"],
                    "verification": "source_confirmed" if any("page 1" in e or "title page" in e for e in m["evidence"]) else "unverified",
                }
            )
            for placement in entry["lms"] if len(targets) == 1 else []:
                if placement["module"] not in session["lms_units"]:
                    session["lms_units"].append(placement["module"])
            if len(targets) == 1:
                for found in m.get("dates", []):
                    session["date_evidence"].append({**found, "source": entry["document"]["original_filename"], "kind": entry["role"]})
            if m.get("objectives") and len(targets) == 1 and not session.get("objectives"):
                session["objectives"] = m["objectives"]
                session["objectives_source"] = f"{entry['document']['original_filename']}, page 1"
            if m.get("driving_question") and entry["role"] in {"slides", "reading"} and len(targets) == 1:
                # Slides win over readings; a reading fills in when there are no slides.
                if not session.get("driving_question") or (entry["role"] == "slides" and session.get("driving_question_role") != "slides"):
                    session["driving_question"] = m["driving_question"]
                    session["driving_question_role"] = entry["role"]
                    unit = "slide" if entry["role"] == "slides" else "page"
                    session["driving_question_source"] = f"{entry['document']['original_filename']}, {unit} 1"
            for conflict in m["conflicts"]:
                session["discrepancies"].append(f"{entry['document']['original_filename']}: {conflict}")

    for row in schedule_rows:
        if row["class"]:
            session = session_for(row["module"] or 2, "class", row["class"])
            session["date_evidence"].append({"date": row["date"], "raw": row["raw_date"], "year_basis": row["year_basis"], "source": row["source_file"], "kind": "schedule"})
            session["schedule_cover"] = row["cover"]
            session["schedule_how"] = row["how"]

    # Unnumbered slides/readings: same LMS module + shared title words (unverified)
    attached = {d["document_id"] for sess in sessions.values() for d in sess["documents"]}
    for entry in info.values():
        m = entry["markers"]
        if entry["role"] not in {"slides", "reading"} or entry["document"]["id"] in attached or not entry["lms"]:
            continue
        if {"session", "class", "covers_sessions"} & m.keys():
            continue
        units = {p["module"] for p in entry["lms"]}
        name = entry["lms"][0]["item_title"] or entry["document"]["original_filename"]
        mine = set(tokens(clean_title(name)))
        best, best_overlap = None, set()
        for sess in sessions.values():
            if not set(sess["lms_units"]) & units:
                continue
            words = set()
            for d in sess["documents"]:
                if not d["shared"]:
                    words |= set(tokens(clean_title(d["filename"])))
            overlap = mine & words
            if len(overlap) > len(best_overlap):
                best, best_overlap = sess, overlap
        if best:
            best["documents"].append(
                {
                    "document_id": entry["document"]["id"],
                    "filename": entry["document"]["original_filename"],
                    "role": entry["role"],
                    "shared": False,
                    "evidence": [f"no session number; same LMS module ({', '.join(sorted(units))}) as {best['label']} and shared title words: {', '.join(sorted(best_overlap))}"],
                    "verification": "unverified",
                }
            )
            if m.get("driving_question") and entry["role"] == "slides" and not best.get("driving_question"):
                best["driving_question"] = m["driving_question"]
                best["driving_question_source"] = f"{entry['document']['original_filename']}, slide 1"

    # Choose dates, titles, plan weeks
    plan_weeks = [w for w in weeks if (w.get("date_range") or {}).get("start_date")]

    def plan_week_for(day: str) -> tuple[dict[str, Any] | None, str]:
        value = date.fromisoformat(day)
        for week in plan_weeks:
            if date.fromisoformat(week["date_range"]["start_date"]) <= value <= date.fromisoformat(week["date_range"]["end_date"] or week["date_range"]["start_date"]):
                return week, "session date falls within this week's dates in the Weekly Overview"
        for week in plan_weeks:
            start = date.fromisoformat(week["date_range"]["start_date"])
            monday = start - timedelta(days=start.weekday())
            if monday <= value <= monday + timedelta(days=6):
                return week, "session date falls in the same calendar week (Mon–Sun) as this Weekly Overview week"
        return None, ""

    week_index = Tfidf({w["id"]: " ".join(t["text"] for t in w.get("topics", [])) for w in weeks})
    all_tokens = Counter(t for e in info.values() for t in tokens(e["document"]["original_filename"] + " " + (e["document"].get("title") or "")))

    out_sessions = []
    for session in sorted(sessions.values(), key=lambda s: (s["module"] or 99, s["numbering"] != "session", s["number"])):
        votes = Counter(e["date"] for e in session["date_evidence"] if e.get("date"))
        chosen = None
        if votes:
            ranked = votes.most_common()
            top = [d for d, c in ranked if c == ranked[0][1]]
            scheduled = [e["date"] for e in session["date_evidence"] if e["kind"] == "schedule" and e["date"] in top]
            chosen = scheduled[0] if scheduled else sorted(top)[0]
            if len(votes) > 1:
                detail = "; ".join(f"{e['source']} says {e['raw']}" for e in session["date_evidence"])
                session["discrepancies"].append(f"conflicting dates — {detail}; using {chosen}")
                discrepancies.append({"kind": "session_date_conflict", "severity": "warning", "detail": f"{session['label']} (Module {session['module']}): {detail}. Chosen: {chosen} (majority; ties go to the schedule).", "sources": sorted({e['source'] for e in session['date_evidence']})})
        session["date"] = chosen
        agreeing = sorted({e["source"] for e in session["date_evidence"] if e.get("date") == chosen})
        session["date_basis"] = None if not chosen else ("stated in " + ", ".join(agreeing))
        session["date_sources"] = agreeing

        # Subtitle: a reading's own title ("Reading 5: Addresses with a Shape").
        for doc in session["documents"]:
            document = info[doc["document_id"]]["document"]
            if doc["role"] == "reading" and not doc["shared"] and re.search(r"Reading\s*\d+:", document.get("title") or ""):
                session["subtitle"] = document["title"].split(":", 1)[1].strip()
                session["subtitle_source"] = f"title of {document['original_filename']}"
                break
        # Title: cleaned name of the session's slides, else its reading.
        title, title_source = None, None
        for role in ("slides", "reading", "activity", "practice"):
            for doc in session["documents"]:
                if doc["role"] != role or doc["shared"]:
                    continue
                document = info[doc["document_id"]]["document"]
                lms = info[doc["document_id"]]["lms"]
                if role == "reading" and document.get("title") and re.search(r"Reading\s*\d+:", document["title"]):
                    session["subtitle"] = document["title"].split(":", 1)[1].strip()
                    session["subtitle_source"] = f"title of {document['original_filename']}"
                if role in {"slides", "reading"} and not title:
                    base = lms[0]["item_title"] if lms and lms[0]["item_title"] else document["original_filename"]
                    cleaned = clean_title(base)
                    # Correct obvious misspellings using other names for the same session
                    words = []
                    for word in cleaned.split():
                        if all_tokens[word.lower()] <= 1 and len(word) > 4:
                            close = difflib.get_close_matches(word.lower(), [t for t, c in all_tokens.items() if c > 1], n=1, cutoff=0.8)
                            if close:
                                session["discrepancies"].append(f"'{word}' in '{base}' looks like a misspelling of '{close[0]}'")
                                word = close[0].capitalize()
                        words.append(word)
                    title, title_source = " ".join(words), f"cleaned name of '{base}'"
            if title:
                break
        if not title and session.get("schedule_cover"):
            title, title_source = session["schedule_cover"].split(",")[0].split(":")[0].strip(), "schedule row"
        session["title"] = title or session["label"]
        session["title_source"] = title_source or "label"

        if chosen:
            week, week_basis = plan_week_for(chosen)
            if week:
                session["plan_week"] = {
                    "week_id": week["id"],
                    "ordinal": week["ordinal"],
                    "label": week["label"],
                    "basis": week_basis,
                    "verification": "source_confirmed",
                }
            else:
                session["plan_week"] = None
                session["discrepancies"].append(f"dated {chosen}, which is outside every week listed in the Weekly Overview")
        else:
            session["plan_week"] = None

        query = " ".join(
            [session["title"], session.get("schedule_cover") or "", session.get("driving_question") or ""]
            + [first_text(extractions.get(info[d["document_id"]]["document"]["doc_key"]), 2)[:600] for d in session["documents"] if d["role"] in {"slides", "reading"}]
        )
        matches = week_index.query(query, top=2)
        if matches:
            best = next(w for w in weeks if w["id"] == matches[0][0])
            session["planned_topic_match"] = {
                "week_id": best["id"],
                "ordinal": best["ordinal"],
                "label": best["label"],
                "score": round(matches[0][1], 3),
                "verification": "heuristic",
                "basis": "keyword overlap between the session's material and the overview's planned topics",
            }
            if session["plan_week"] and best["id"] != session["plan_week"]["week_id"] and matches[0][1] >= 0.12:
                detail = (
                    f"{session['label']} '{session['title']}' was delivered on {chosen} ({session['plan_week']['label']}), "
                    f"but the Weekly Overview plans this topic in {best['label']}"
                )
                session["discrepancies"].append(detail)
                discrepancies.append({"kind": "plan_vs_delivery", "severity": "warning", "detail": detail, "sources": ["Weekly Overview (HomePage)", *[d["filename"] for d in session["documents"][:2]]]})
        out_sessions.append(session)

    # Duplicate session-number labels across modules / filenames
    for entry in info.values():
        names = [entry["document"]["original_filename"], *(p["item_title"] or "" for p in entry["lms"])]
        m = entry["markers"]
        if m.get("class") and m.get("module") == 2:
            s_labels = {int(s) for n in names for s in S_LABEL_RE.findall(stem_of(n))}
            if s_labels:
                discrepancies.append(
                    {
                        "kind": "numbering_scheme",
                        "severity": "info",
                        "detail": f"{entry['document']['original_filename']} is Module 2 Class {m['class']} on its title page; its name uses 'S{sorted(s_labels)[0]}' (a running session count). Class numbering is used.",
                        "sources": [entry["document"]["source_path"]],
                    }
                )

    # Textbooks
    books: dict[str, dict[str, Any]] = {}
    for entry in info.values():
        if entry["role"] != "book":
            continue
        document = entry["document"]
        extraction = extractions.get(document["doc_key"])
        terms = book_terms(document, extraction, [p["item_title"] for p in entry["lms"]])
        surnames = sorted(t for t in terms if t[0].isupper() and t.lower() not in {"code", "pattern", "stone", "edition", "network"})
        chapters, basis = book_chapters(extraction)
        cited = Counter()
        for other in info.values():
            if other["role"] in {"slides", "reading"}:
                text = first_text(extractions.get(other["document"]["doc_key"]), 60)
                for name in surnames:
                    cited[name] += len(re.findall(rf"\b{re.escape(name)}\b", text))
        lead = cited.most_common(1)[0][0] if cited and cited.most_common(1)[0][1] else (surnames[0] if surnames else document["original_filename"])
        key = re.sub(r"[^a-z0-9]+", "-", lead.lower())
        books[key] = {
            "key": key,
            "document_id": document["id"],
            "filename": document["original_filename"],
            "title": document.get("title") or clean_title(document["original_filename"]),
            "surnames": surnames,
            "chapter_basis": basis,
            "chapters": chapters,
            "lms_listed": bool(entry["lms"]),
        }
    # A reference to "Nisan & Schocken" must find the book whose filename lacks the authors.
    known_aliases = {"nisan": ["Nisan", "Schocken"], "schocken": ["Nisan", "Schocken"]}
    for book in books.values():
        if re.search(r"elements of computing", book["title"], re.I):
            book["surnames"] = sorted(set(book["surnames"]) | {"Nisan", "Schocken"})
            book["surname_basis"] = "authors of 'The Elements of Computing Systems' are named in the slides as Nisan & Schocken"
        book["surnames"] = [s for s in book["surnames"] if s not in {"Code", "Computing"}]
    _ = known_aliases

    for session in out_sessions:
        for doc in session["documents"]:
            if doc["role"] not in {"slides", "reading"}:
                continue
            extraction = extractions.get(info[doc["document_id"]]["document"]["doc_key"])
            for ref in extract_further_reading(all_units(extraction), books):
                book = books[ref["book_key"]]
                resolved = resolve_reference(ref, book["chapters"])
                session["further_reading"].append(
                    {
                        "book_key": book["key"],
                        "book_document_id": book["document_id"],
                        "book_title": book["title"],
                        "cited_in": doc["filename"],
                        "cited_at": f"{'slide' if doc['role'] == 'slides' else 'page'} {ref['unit_number']}",
                        "chapters": ref["chapters"],
                        "sections": ref["sections"],
                        "titles": ref["titles"],
                        "excerpt": ref["excerpt"],
                        "verification": "source_confirmed",
                        "resolved": [
                            {
                                "title": r["title"],
                                "page_start": r["page_start"],
                                "page_end": r["page_end"],
                                "matched_by": r["matched_by"],
                                "page_basis": r["source"],
                                "verification": "source_confirmed" if r["source"] == "pdf_outline" else "unverified",
                            }
                            for r in resolved
                        ],
                    }
                )
                if (ref["chapters"] or ref["sections"]) and not resolved:
                    session["discrepancies"].append(f"{doc['filename']} cites {book['title']} {ref['chapters'] or ref['sections']} but no matching chapter was found in the book's outline")

    # Heuristic textbook suggestions for sessions (clearly labelled)
    section_docs: dict[str, str] = {}
    section_meta: dict[str, dict[str, Any]] = {}
    for book in books.values():
        extraction = extractions.get(next(e["document"]["doc_key"] for e in info.values() if e["document"]["id"] == book["document_id"]))
        pages = {u["page_number"]: u.get("text", "") for u in (extraction or {}).get("units", []) if u.get("page_number")}
        leaves = [c for c in book["chapters"] if c["number"] and (c["level"] >= 2 or book["chapter_basis"] != "pdf_outline")]
        for chapter in leaves:
            if chapter["page_end"] - chapter["page_start"] > 60:
                continue
            key = f"{book['key']}::{chapter['title']}"
            section_docs[key] = chapter["title"] + " " + " ".join(pages.get(p, "") for p in range(chapter["page_start"], chapter["page_end"] + 1))[:20000]
            section_meta[key] = {"book_key": book["key"], "book_title": book["title"], "book_document_id": book["document_id"], **{k: chapter[k] for k in ("title", "page_start", "page_end")}}
    if section_docs:
        index = Tfidf(section_docs)
        for session in out_sessions:
            text = " ".join(
                [session["title"] * 3, session.get("schedule_cover") or ""]
                + [" ".join(u["text"] for u in all_units(extractions.get(info[d["document_id"]]["document"]["doc_key"])))[:8000] for d in session["documents"] if d["role"] in {"slides", "reading"}]
            )
            session["suggested_textbook_sections"] = [
                {**section_meta[k], "score": round(s, 3), "verification": "heuristic", "basis": "keyword similarity between the session's material and the book section"}
                for k, s in index.query(text, top=3)
                if s >= 0.08
            ]

    # Assessments
    front = next((p for p in (lms_export or {}).get("pages", []) if p.get("front_page")), None)
    plan_components = parse_html_assessments(front["html"]) if front else []
    events: list[dict[str, Any]] = []
    for row in schedule_rows:
        if row["kind"] == "assessment" or re.search(r"recap", row["label"] or "", re.I):
            events.append({"key": assessment_key(row["label"]), "title": row["label"], "date": row["date"], "detail": row["cover"], "how": row["how"], "source": row["source_file"], "source_kind": "module_schedule"})
    for week in weeks:
        for topic in week.get("topics", []):
            for m in re.finditer(r"((?:Practical\s*\d|In-class Exam\s*\d)[^;()]*?)\s*\((\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*([^)]*)\)", topic["text"]):
                value, basis = resolve_year(int(m.group(2)), MONTHS[m.group(3).lower()], None, anchor)
                events.append({"key": assessment_key(m.group(1)), "title": m.group(1).strip(" :"), "date": value.isoformat() if value else None, "detail": (m.group(4) or "").strip(" ,"), "how": None, "source": f"Weekly Overview — {week['label']}", "source_kind": "weekly_overview"})
    for component in plan_components:
        for m in re.finditer(r"(P\d)\s*\((\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\)", component["notes"]):
            key = assessment_key(m.group(1))
            if any(e["key"] == key and e["source_kind"] == "weekly_overview" for e in events):
                continue
            value, _ = resolve_year(int(m.group(2)), MONTHS[m.group(3).lower()], None, anchor)
            events.append({"key": key, "title": f"Practical {m.group(1)[1:]}", "date": value.isoformat() if value else None, "detail": None, "how": None, "source": "Weekly Overview — Assessment Criteria", "source_kind": "weekly_overview"})
        approx = re.search(r"~\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)", component["notes"])
        if approx and not re.search(r"P\d\s*\(", component["notes"]):
            value, _ = resolve_year(int(approx.group(1)), MONTHS[approx.group(2).lower()], None, anchor)
            events.append({"key": assessment_key(component["component"]), "title": component["component"], "date": value.isoformat() if value else None, "detail": f"approximate ({component['weight']})", "how": None, "source": "Weekly Overview — Assessment Criteria", "source_kind": "weekly_overview"})
    for assignment in (lms_export or {}).get("assignments", []):
        when = assignment.get("due_at") or assignment.get("unlock_at")
        events.append({"key": assessment_key(assignment["title"] or ""), "title": assignment["title"], "date": when[:10] if when else None, "detail": f"{assignment.get('points_possible') or 0:g} points · {'due' if assignment.get('due_at') else 'opened'} in LMS", "how": assignment.get("submission_types"), "source": "LMS assignments", "source_kind": "lms"})
    # Deduplicate identical events from different weekly-overview passages
    unique: dict[tuple[Any, ...], dict[str, Any]] = {}
    for event in events:
        unique.setdefault((event["key"], event["date"], event["source_kind"]), event)
    events = sorted(unique.values(), key=lambda e: (e["date"] or "9999", e["title"] or ""))
    by_key: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        by_key[event["key"]].append(event)
    for key, group in by_key.items():
        dates = {e["date"] for e in group if e["date"] and e["source_kind"] != "lms"}
        kinds = {e["source_kind"] for e in group}
        if len(dates) > 1 and len(kinds) > 1:
            detail = "; ".join(f"{e['source']}: {e['date']}" for e in group if e["source_kind"] != "lms")
            for e in group:
                e["conflict"] = detail
            discrepancies.append({"kind": "assessment_date_conflict", "severity": "warning", "detail": f"{group[0]['title']}: {detail}", "sources": sorted({e['source'] for e in group})})
    # An overview-only assessment on a day the newer schedule fills with a class.
    for event in events:
        if event["source_kind"] != "weekly_overview" or not event["date"] or event.get("conflict"):
            continue
        same_day = [r for r in schedule_rows if r["date"] == event["date"] and r["kind"] == "class"]
        if same_day and not any(e["key"] == event["key"] and e["source_kind"] == "module_schedule" for e in events):
            row = same_day[0]
            detail = f"{row['source_file']} lists {row['label']} ({row['cover'][:60]}) on {event['date']}, not this assessment"
            event["conflict"] = detail
            discrepancies.append({"kind": "assessment_not_in_schedule", "severity": "warning", "detail": f"{event['title']}: {detail}", "sources": [event["source"], row["source_file"]]})
    for row in marks_rows:
        match = next((c for c in plan_components if assessment_key(c["component"]) == assessment_key(row["component"])), None)
        if match:
            row["weekly_overview_weight"] = match["weight"]

    # Module titles from the overview's own text ("Module 1 — The Machine")
    module_titles: dict[int, dict[str, Any]] = {}
    for week in weeks:
        for topic in week.get("topics", []):
            if m := re.search(r"Module\s+(\d)\s*[—–-]\s*(The\s+\w+)", topic["text"]):
                module_titles.setdefault(int(m.group(1)), {"number": int(m.group(1)), "title": m.group(2), "first_plan_week": week["label"], "source": "Weekly Overview"})
    modules = []
    for number in sorted({s["module"] for s in out_sessions if s["module"]} | set(module_titles)):
        mine = [s for s in out_sessions if s["module"] == number]
        modules.append({**module_titles.get(number, {"number": number, "title": None, "source": None}), "session_keys": [s["key"] for s in mine], "dated_sessions": sum(1 for s in mine if s["date"])})

    # Module-level resources (practice sets, tests) that are not tied to one session
    module_resources = []
    linked = {d["document_id"] for s in out_sessions for d in s["documents"]}
    for entry in info.values():
        if entry["document"]["id"] in linked or entry["role"] in {"book"}:
            continue
        module_resources.append(
            {
                "document_id": entry["document"]["id"],
                "filename": entry["document"]["original_filename"],
                "role": entry["role"],
                "module": entry["markers"].get("module"),
                "lms_units": [p["module"] for p in entry["lms"]],
                "dates": entry["markers"].get("dates", []),
                "note": "excluded from tutoring: may contain other students' work" if entry["role"] == "student_work" else None,
            }
        )

    for book in books.values():
        if not book["lms_listed"]:
            continue
        if front and not any(s.lower() in front["text"].lower() for s in book["surnames"]):
            discrepancies.append({"kind": "book_not_in_course_plan", "severity": "info", "detail": f"'{book['title']}' is in the LMS 'Course Books' module but is not listed under Course Materials on the course home page", "sources": [book["filename"]]})

    associations = []
    for session in out_sessions:
        if not session.get("plan_week"):
            continue
        for doc in session["documents"]:
            if doc["shared"]:
                continue
            associations.append(
                {
                    "document_id": doc["document_id"],
                    "week_id": session["plan_week"]["week_id"],
                    "evidence": f"{session['label']} (Module {session['module']}) dated {session['date']} — {session['date_basis']}",
                }
            )

    return {
        "subject_key": slug,
        "modules": modules,
        "sessions": out_sessions,
        "lms_units": lms_units,
        "module_resources": module_resources,
        "books": [{k: v for k, v in b.items() if k != "chapters"} | {"chapter_count": len([c for c in b["chapters"] if c["level"] == 1])} for b in books.values()],
        "book_chapters": {b["key"]: [c for c in b["chapters"] if c["level"] <= 2] for b in books.values()},
        "assessments": {"events": events, "components": plan_components, "module_marks": marks_rows},
        "schedule": schedule_rows,
        "discrepancies": discrepancies,
        "week_associations": associations,
    }


def render_curriculum_report(curriculum: dict[str, Any]) -> str:
    lines = ["# Curriculum mapping report", "", "Every link below names its evidence. `heuristic` = keyword similarity, never course-confirmed.", ""]
    for module in curriculum["modules"]:
        lines += [f"## Module {module['number']}: {module.get('title') or '(title not stated)'}", ""]
        for key in module["session_keys"]:
            s = next(x for x in curriculum["sessions"] if x["key"] == key)
            week = s["plan_week"]["label"] if s.get("plan_week") else "— (no dated evidence)"
            lines.append(f"### {s['label']} — {s['title']}")
            lines.append(f"- Date: {s['date'] or 'not stated'}" + (f" ({s['date_basis']})" if s["date"] else ""))
            lines.append(f"- Overview week (by date): {week}")
            if s.get("planned_topic_match"):
                p = s["planned_topic_match"]
                lines.append(f"- Planned-topic match (heuristic): {p['label']} (score {p['score']})")
            lines.append(f"- LMS module(s): {', '.join(s['lms_units']) or '— (not placed in an LMS module)'}")
            for d in s["documents"]:
                lines.append(f"  - {d['role']}: `{d['filename']}` — {'; '.join(d['evidence'])} [{d['verification']}]")
            for r in s["further_reading"]:
                pages = ", ".join(f"{x['title']} pp. {x['page_start']}–{x['page_end']} [{x['verification']}]" for x in r["resolved"]) or "not resolved"
                lines.append(f"  - further reading ({r['cited_in']}, {r['cited_at']}): {r['book_title']} → {pages}")
            for sug in s.get("suggested_textbook_sections", []):
                lines.append(f"  - suggested (heuristic): {sug['book_title']} — {sug['title']} pp. {sug['page_start']}–{sug['page_end']} ({sug['score']})")
            for d in s["discrepancies"]:
                lines.append(f"  - ⚠ {d}")
            lines.append("")
    lines += ["## Assessments (all sources)", "", "| Date | Assessment | Detail | Source | Conflict |", "|---|---|---|---|---|"]
    for e in curriculum["assessments"]["events"]:
        lines.append(f"| {e['date'] or '—'} | {e['title']} | {e.get('detail') or ''} | {e['source']} | {e.get('conflict') or ''} |")
    lines += ["", "## Discrepancies", ""]
    for d in curriculum["discrepancies"]:
        lines.append(f"- **{d['kind']}** ({d['severity']}): {d['detail']}")
    lines += ["", "## Module-level resources (not tied to one session)", ""]
    for r in curriculum["module_resources"]:
        lines.append(f"- {r['role']}: `{r['filename']}` — LMS: {', '.join(r['lms_units']) or '—'}" + (f" — {r['note']}" if r.get("note") else ""))
    return "\n".join(lines) + "\n"
