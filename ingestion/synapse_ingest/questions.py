"""Stage G: practice questions, answer keys and key terms from course material.

Course-authored readings, worksheets and quizzes already contain numbered
questions ("Q1 · Numerical · 2 marks", "Q3 [Entry]"), answer keys ("A1 …",
"Part B. Answer key", a separate "…AnswerKey.pdf") and glossary boxes
("Key term: MAC address"). This stage turns them into structured, cited
items. Nothing is generated: question and answer text are verbatim, every
item keeps its file and page, and a question without a published answer is
marked ``answer: null`` (open / self-assessed).
"""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from typing import Any

from .config import Paths
from .util import read_json, read_jsonl, sha256_text, utc_now_iso, write_json_atomic

LOG = logging.getLogger("synapse_ingest.questions")

PAGE_MARK = "\u0000p{}\u0000"
PAGE_RE = re.compile(r"\u0000p(\d+)\u0000")
Q_RE = re.compile(r"(?m)^[ \t]*(?:Q|Question\s+)(\d{1,2})(?=[\s·.:\[\]])[ \t]*[.:]?")
A_RE = re.compile(r"(?m)^[ \t]*A(\d{1,2})(?=\s)")
ANSWER_HEAD_RE = re.compile(r"(?mi)^[ \t]*(?:part\s+[a-z][.:]\s*)?(?:answer key|answers?\b|worked (?:answers|solutions))")
REVIEW_HEAD_RE = re.compile(r"(?mi)^[ \t]*(review questions|check your understanding|questions to think about)\b")
STOP_HEAD_RE = re.compile(r"(?mi)^[ \t]*(further reading|go deeper|answers?\b|answer key|next session|key terms?\b)")
SECTION_END_RE = re.compile(r"(?mi)^[ \t]*(review questions|check your understanding|further reading|go deeper|next session|key terms?\b)")
KEY_TERM_RE = re.compile(r"(?m)^[ \t]*Key term:\s*(.+?)\s*$")
META_RE = re.compile(r"^\s*(?:·\s*)?(?P<kind>Numerical|Concept|Conceptual|Application|Scenario|Design)?\s*·?\s*(?P<marks>\d+(?:\.\d)?)?\s*marks?\b", re.I)
LEVEL_RE = re.compile(r"^\s*\[(Entry|Core|Stretch|Easy|Medium|Hard|Challenge)\]", re.I)
MARKS_RE = re.compile(r"[\[(]\s*(\d+(?:\.\d)?)\s*marks?\s*[\])]", re.I)
FOOTER_RE = re.compile(r"(?m)^.*(?:Rishihood University\s*·\s*Page\s*\d+|Page \d+ of \d+).*$")
SKIP_ROLES = {"book", "student_work", "schedule"}


def _join(units: list[dict[str, Any]]) -> str:
    return "".join(PAGE_MARK.format(u["unit_number"]) + "\n" + (u.get("text") or "") + "\n" for u in units)


def _page_at(text: str, position: int) -> int | None:
    pages = [int(m.group(1)) for m in PAGE_RE.finditer(text, 0, position + 1)]
    return pages[-1] if pages else None


def _clean(text: str) -> str:
    text = PAGE_RE.sub(" ", text)
    text = FOOTER_RE.sub("", text)
    return re.sub(r"[ \t]+", " ", re.sub(r"\n{3,}", "\n\n", text)).strip()


def _blocks(text: str, pattern: re.Pattern[str], start: int, end: int) -> list[tuple[int, int, int]]:
    hits = [(m.start(), m.end(), int(m.group(1))) for m in pattern.finditer(text, start, end)]
    out = []
    for i, (s, body_start, number) in enumerate(hits):
        stop = hits[i + 1][0] if i + 1 < len(hits) else end
        out.append((s, body_start, number, stop))  # type: ignore[arg-type]
    return out  # type: ignore[return-value]


def _meta(body: str) -> tuple[dict[str, Any], str]:
    meta: dict[str, Any] = {}
    if m := LEVEL_RE.match(body):
        meta["level"] = m.group(1).capitalize()
        body = body[m.end():]
    if m := META_RE.match(body):
        if m.group("kind"):
            meta["kind"] = m.group("kind").capitalize()
        if m.group("marks"):
            meta["marks"] = float(m.group("marks"))
        body = body[m.end():]
    if "marks" not in meta and (m := MARKS_RE.search(body[:400])):
        meta["marks"] = float(m.group(1))
    return meta, body


def extract_from_text(text: str) -> dict[str, Any]:
    """Questions, answers and key terms from one document's joined text."""
    first_q = Q_RE.search(text)
    answer_start = None
    if first_q:
        for head in ANSWER_HEAD_RE.finditer(text, first_q.end()):
            answer_start = head.start()
            break
    question_end = answer_start if answer_start is not None else len(text)

    questions: dict[int, dict[str, Any]] = {}
    for start, body_start, number, stop in _blocks(text, Q_RE, 0, question_end):
        meta, body = _meta(text[body_start:stop])
        body = _clean(body)
        if len(body) < 8 or number in questions:
            continue
        questions[number] = {"number": number, "text": body, "page": _page_at(text, start), **meta}

    answers: dict[int, dict[str, Any]] = {}
    if answer_start is not None:
        pattern = A_RE if A_RE.search(text, answer_start) else Q_RE
        for start, body_start, number, stop in _blocks(text, pattern, answer_start, len(text)):
            _, body = _meta(text[body_start:stop])
            if section := SECTION_END_RE.search(body):
                body = body[: section.start()]  # the last answer ends at the next section
            body = _clean(MARKS_RE.sub("", body, count=1) if MARKS_RE.match(body.strip()) else body)
            if body and number not in answers:
                answers[number] = {"text": body, "page": _page_at(text, start)}

    review: list[dict[str, Any]] = []
    for head in REVIEW_HEAD_RE.finditer(text):
        stop = STOP_HEAD_RE.search(text, head.end())
        block = text[head.end() : stop.start() if stop else len(text)]
        for item in re.split(r"(?m)^[ \t]*[•\-–]\s+", block)[1:]:
            item = _clean(item)
            if 15 <= len(item) <= 600:
                review.append({"text": item, "page": _page_at(text, head.start())})

    terms: list[dict[str, Any]] = []
    for m in KEY_TERM_RE.finditer(text):
        rest = text[m.end():]
        paragraph = re.split(r"\n\s*\n", rest.lstrip("\n"), maxsplit=1)[0]
        definition = _clean(paragraph)
        if 10 <= len(definition) <= 700:
            terms.append({"term": m.group(1).strip(), "definition": definition, "page": _page_at(text, m.start())})
    return {"questions": questions, "answers": answers, "review": review, "terms": terms}


def _pair_key(filename: str) -> str | None:
    """'CSD104_Quiz1_AnswerKey.pdf' and 'CSD104_Quiz1_Question Paper.pdf' → 'csd104_quiz1'."""
    stem = re.sub(r"\.\w+$", "", filename).lower()
    m = re.match(r"(.+?)[_\s-]*(answer\s*key|answerkey|question\s*paper|student\s*paper|questions?)\b", stem)
    return m.group(1).rstrip("_- ") if m else None


def run_questions_stage(paths: Paths) -> dict[str, Any]:
    index = read_json(paths.source_index)
    curriculum_path = paths.processed / "curriculum.json"
    curriculum = read_json(curriculum_path) if curriculum_path.exists() else {"sessions": [], "module_resources": []}
    roles: dict[str, str] = {}
    modules: dict[str, int | None] = {}
    for session in curriculum["sessions"]:
        for doc in session["documents"]:
            roles[doc["document_id"]] = doc["role"]
            modules[doc["document_id"]] = session["module"]
    for resource in curriculum.get("module_resources", []):
        roles[resource["document_id"]] = resource["role"]
        modules.setdefault(resource["document_id"], resource.get("module"))
    for book in curriculum.get("books", []):
        roles[book["document_id"]] = "book"

    units_by_doc: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for unit in read_jsonl(paths.content_units):
        units_by_doc[unit["document_id"]].append(unit)

    documents = {d["id"]: d for d in index["documents"]}
    extracted: dict[str, dict[str, Any]] = {}
    for doc_id, units in units_by_doc.items():
        document = documents.get(doc_id)
        if not document or document["document_type"] in {"textbook", "weekly_overview"} or roles.get(doc_id) in SKIP_ROLES:
            continue
        units.sort(key=lambda u: u["unit_number"])
        extracted[doc_id] = extract_from_text(_join(units))

    # Answer keys that live in a separate file (e.g. Quiz paper + AnswerKey)
    by_pair: dict[str, dict[str, str]] = defaultdict(dict)
    for doc_id in extracted:
        name = documents[doc_id]["original_filename"]
        if key := _pair_key(name):
            by_pair[key]["answers" if re.search(r"answer", name, re.I) else "questions"] = doc_id

    items: list[dict[str, Any]] = []
    answer_only: list[dict[str, Any]] = []

    def citation(doc_id: str, page: int | None) -> str:
        document = documents[doc_id]
        if document.get("format") == "docx":
            unit = "section"
        elif roles.get(doc_id) == "slides" or (document["document_type"] == "lecture_slides_pdf" and roles.get(doc_id) not in {"practice", "reading", "assessment"}):
            unit = "slide"
        else:
            unit = "page"
        return f"{document['original_filename']}, {unit} {page}" if page else document["original_filename"]

    paired_answer_docs = {p["answers"] for p in by_pair.values() if "answers" in p and "questions" in p}
    for doc_id, data in extracted.items():
        if doc_id in paired_answer_docs:
            continue
        document = documents[doc_id]
        external = None
        if key := _pair_key(document["original_filename"]):
            pair = by_pair.get(key, {})
            if pair.get("questions") == doc_id and "answers" in pair:
                external = pair["answers"]
        answers = extracted[external]["questions"] if external else data["answers"]
        answer_doc = external or doc_id
        if re.search(r"answer\s*key|answerkey", document["original_filename"], re.I) and not external:
            # An answer key without its question paper: worked answers only.
            count = len(data["questions"]) or len(data["answers"])
            answer_only.append({"document_id": doc_id, "filename": document["original_filename"], "count": count})
            continue
        for number, question in sorted(data["questions"].items()):
            answer = answers.get(number)
            items.append(
                {
                    "id": sha256_text(f"{doc_id}:q:{number}")[:16],
                    "kind": "practice",
                    "number": number,
                    "question": question["text"],
                    "question_kind": question.get("kind"),
                    "level": question.get("level"),
                    "marks": question.get("marks"),
                    "answer": answer["text"] if answer else None,
                    "document_id": doc_id,
                    "filename": document["original_filename"],
                    "question_citation": citation(doc_id, question["page"]),
                    "answer_citation": citation(answer_doc, answer["page"]) if answer else None,
                    "session_keys": document.get("session_keys", []),
                    "module": modules.get(doc_id),
                    "role": roles.get(doc_id),
                    "verification": "source_confirmed",
                }
            )
        for position, review in enumerate(data["review"], start=1):
            items.append(
                {
                    "id": sha256_text(f"{doc_id}:r:{position}")[:16],
                    "kind": "review",
                    "number": position,
                    "question": review["text"],
                    "question_kind": "Open",
                    "level": None,
                    "marks": None,
                    "answer": None,
                    "document_id": doc_id,
                    "filename": document["original_filename"],
                    "question_citation": citation(doc_id, review["page"]),
                    "answer_citation": None,
                    "session_keys": document.get("session_keys", []),
                    "module": modules.get(doc_id),
                    "role": roles.get(doc_id),
                    "verification": "source_confirmed",
                }
            )

    terms: list[dict[str, Any]] = []
    for doc_id, data in extracted.items():
        document = documents[doc_id]
        for term in data["terms"]:
            terms.append(
                {
                    "id": sha256_text(f"{doc_id}:t:{term['term'].lower()}")[:16],
                    "term": term["term"],
                    "definition": term["definition"],
                    "document_id": doc_id,
                    "filename": document["original_filename"],
                    "citation": citation(doc_id, term["page"]),
                    "session_keys": document.get("session_keys", []),
                    "module": modules.get(doc_id),
                    "verification": "source_confirmed",
                }
            )

    result = {
        "generated_at": utc_now_iso(),
        "questions": items,
        "terms": terms,
        "answer_only_documents": answer_only,
        "stats": {
            "questions": sum(1 for i in items if i["kind"] == "practice"),
            "with_answers": sum(1 for i in items if i["answer"]),
            "review_questions": sum(1 for i in items if i["kind"] == "review"),
            "terms": len(terms),
        },
    }
    write_json_atomic(paths.processed / "questions.json", result)
    LOG.info("Questions: %s", result["stats"])
    return result
