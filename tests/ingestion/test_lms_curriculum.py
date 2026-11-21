"""LMS offline-export reader and curriculum mapping (synthetic data only)."""

from __future__ import annotations

import json
from datetime import date

import pytest

from synapse_ingest.curriculum import (
    book_chapters,
    build_curriculum,
    clean_title,
    despace,
    extract_further_reading,
    parse_marks_table,
    parse_schedule,
    resolve_reference,
)
from synapse_ingest.lms_export import LmsExportError, build_export, module_kind, parse_course_data
from synapse_ingest.overview import complete_years, is_viewer_shell, parse_date_range

ANCHOR = date(2031, 11, 20)


# ------------------------------------------------------------ LMS export
def test_course_data_is_parsed_as_data_not_executed():
    payload = {"title": "Synthetic Course", "modules": [{"id": 1, "name": "Week 1", "items": []}]}
    text = "/* header */\nwindow.COURSE_DATA = " + json.dumps(payload) + ";\n"
    assert parse_course_data(text)["title"] == "Synthetic Course"


@pytest.mark.parametrize(
    "text",
    [
        "var x = 1;",
        "window.COURSE_DATA = (function(){ return {modules: []} })();",
        "window.COURSE_DATA = {modules: [], title: 'single quotes are JS, not JSON'};",
        'window.COURSE_DATA = {"title": "no modules"};',
    ],
)
def test_non_json_or_incomplete_exports_are_refused(text):
    with pytest.raises(LmsExportError):
        parse_course_data(text)


def test_module_kinds():
    assert module_kind("Course Books") == ("books", [])
    assert module_kind("Week 1 - 2") == ("week", [1, 2])
    assert module_kind("Week 7") == ("week", [7])
    assert module_kind("Announcements") == ("other", [])


def _inventory(paths):
    return {"entries": [{"path": p, "status": "extracted", "category": "pdf", "sha256": p} for p in paths]}


def test_export_items_resolve_inside_the_archive_only():
    raw = {
        "title": "T",
        "modules": [
            {
                "id": 1,
                "name": "Week 3",
                "items": [
                    {"id": 1, "title": "Shown title.pdf", "type": "Attachment", "content": "viewer/files/real%20name.pdf"},
                    {"id": 2, "title": "Escape", "type": "Attachment", "content": "../../etc/passwd"},
                    {"id": 3, "title": "Missing", "type": "Attachment", "content": "viewer/files/missing.pdf"},
                ],
            }
        ],
        "pages": [{"title": "Home", "frontPage": True, "content": "<p>Hello</p>"}],
        "assignments": [{"title": "Quiz", "pointsPossible": 5, "unlockAt": "2031-09-01T12:00:00+05:30"}],
    }
    inventory = _inventory(["course/viewer/files/real name.pdf", "course/viewer/files/unlinked.pdf"])
    export = build_export(raw, export_path="course/viewer/course-data.js", overview_path="course/index.html", inventory=inventory)
    items = export["modules"][0]["items"]
    assert items[0]["kind"] == "internal" and items[0]["resolved_path"] == "course/viewer/files/real name.pdf"
    assert items[1]["kind"] == "unresolved" and "escapes" in items[1]["reason"]
    assert items[2]["kind"] == "unresolved"
    assert export["front_page"] == "Home"
    assert export["files_not_in_modules"] == ["course/viewer/files/unlinked.pdf"]
    assert len(export["warnings"]) == 2


def test_viewer_shell_detection():
    shell = '<html><body><div id="app"></div><script src="viewer/course-data.js"></script></body></html>'
    assert is_viewer_shell(shell)
    assert not is_viewer_shell("<html><body><h1>Week 1</h1><p>Real overview content here</p></body></html>")


# ------------------------------------------------------------ dates
def test_date_lists_and_single_days():
    listed = parse_date_range("Week 9 (19, 21 Oct)")
    assert (listed["start"]["day"], listed["end"]["day"], listed["days"]) == (19, 21, [19, 21])
    single = parse_date_range("Week 14 (30 Nov)")
    assert single["start"] == single["end"] == {"day": 30, "month": 11, "year": None}
    assert parse_date_range("A long sentence that mentions 30 Nov somewhere but is not a label at all, really") is None


def test_citation_years_do_not_set_the_schedule_year():
    weeks = [{"date_range": parse_date_range("Week 1 (24–25 Aug)")}]
    text = "Author, A. (1998). Some book. Other, B. (2000). Another. Semester 1, 2031–32"
    complete_years(weeks, text, ANCHOR)
    assert weeks[0]["date_range"]["start_date"] == "2031-08-24"


# ------------------------------------------------------------ helpers
def test_despace_and_clean_title():
    assert "SESSION10" in despace("S E S S I O N 1 0 · Module")
    assert clean_title("CSD104_S9_I:O Devices.pdf") == "I/O Devices"
    assert clean_title("CSD104_W3S1_LogicGates.pdf") == "Logic Gates"
    assert clean_title("CSD104_M2_Reading_09_Wireless_IoT_Security.pdf") == "Wireless IoT Security"


def test_schedule_rows_in_both_text_layouts():
    row_per_line = "\n".join(
        [
            "Class calendar",
            "Date Class What we cover How",
            "Live",
            "Mon 16 Nov Class 1 Signals and noise.",
            "Fri 20 Nov Quiz 2 MCQ quiz on Classes 1 to 6.",
            "Take-home task, due by midnight. Take-home",
            "Sat 21 Nov Practical 3 due",
            "Shaded rows are assessments.",
        ]
    )
    rows = parse_schedule(row_per_line, ANCHOR)
    assert [(r["date"], r["label"], r["class"]) for r in rows] == [
        ("2031-11-16", "Class 1", 1),
        ("2031-11-20", "Quiz 2", None),
        ("2031-11-21", "Practical 3 due", None),
    ]
    assert rows[2]["cover"].startswith("Take-home task")
    cell_per_line = "\n".join(["Class calendar", "Mon 16 Nov", "Class 1", "Signals and noise.", "Live", "Tue 17 Nov", "Class 2", "Layers."])
    assert [(r["label"], r["cover"]) for r in parse_schedule(cell_per_line, ANCHOR)] == [("Class 1", "Signals and noise."), ("Class 2", "Layers.")]


def test_marks_table():
    text = "Component Marks When Notes\nQuiz 2 5 Fri 27 Nov MCQ.\nPractical 3: Tracer 6 Issued Fri 27 Nov, due Sat 5 Dec"
    rows = parse_marks_table(text)
    assert rows[0] == {"component": "Quiz 2", "marks": 5.0, "when": "Fri 27 Nov", "notes": "MCQ."}
    assert rows[1]["when"] == "Issued Fri 27 Nov, due Sat 5 Dec"


def test_ocr_chapter_headers_skip_contents_pages_and_match_truncated_titles():
    extraction = {
        "page_count": 40,
        "units": [
            {"page_number": 3, "text": "Contents\nChapter One\nFirst\nChapter Two\nSecond\nChapter Three\nThird"},
            {"page_number": 5, "text": "Chapter One\nFirst Steps\nbody"},
            {"page_number": 6, "text": "Chapter One\nrunning header page"},
            {"page_number": 20, "text": "Chapter Two\nA Long Wrapped\ntitle continues here"},
        ],
    }
    chapters, basis = book_chapters(extraction)
    assert basis == "ocr_running_header"
    assert [(c["number"], c["page_start"], c["page_end"]) for c in chapters] == [("1", 5, 19), ("2", 20, 40)]
    hits = resolve_reference({"chapters": [], "sections": [], "titles": ["A Long Wrapped Title"]}, chapters)
    assert hits and hits[0]["number"] == "2"


def test_further_reading_is_cited_with_chapters_sections_and_titles():
    books = {"author": {"surnames": ["Author"]}, "writer": {"surnames": ["Writer"]}}
    units = [
        {"number": 9, "kind": "slide", "text": "F U R T H E R R E A D I N G\nAuthor — Book\nCh. 10 “Switches” + Ch. 11\nWriter, Other Book, Section 2.2.5"},
        {"number": 3, "kind": "slide", "text": "Author was born in a small town."},
    ]
    refs = extract_further_reading(units, books)
    by_book = {r["book_key"]: r for r in refs}
    assert by_book["author"]["chapters"] == [10, 11] and by_book["author"]["titles"] == ["Switches"]
    assert by_book["writer"]["sections"] == ["2.2.5"]
    assert all(r["unit_number"] == 9 for r in refs)


# ------------------------------------------------------------ build
def _doc(doc_id, name, doc_type="lecture_slides_pdf", title=None):
    return {"id": doc_id, "doc_key": doc_id, "original_filename": name, "archive_paths": [f"c/viewer/files/{name}"], "document_type": doc_type, "title": title, "source_path": f"c/viewer/files/{name}"}


def _week(ordinal, label, start, end, topic):
    return {"id": f"w{ordinal}", "ordinal": ordinal, "label": label, "date_range": {"start_date": start, "end_date": end}, "topics": [{"text": topic, "origin": "overview_text"}]}


def test_sessions_are_placed_by_date_never_by_lms_week_label():
    documents = [
        _doc("d1", "S1_Binary_Numbers.pdf"),
        _doc("d2", "S2_Logic_Gates.pdf"),
        _doc("d3", "S3_Adders.pdf"),
        _doc("d4", "Schedule.pdf", "supporting_document"),
    ]
    extractions = {
        "d1": {"units": [{"page_number": 1, "text": "MODULE 1 · S1 · Mon 1 Sep\nWhy do machines count in binary numbers?"}]},
        "d2": {"units": [{"page_number": 1, "text": "MODULE 1 · S2 · Wed 3 Sep\nlogic gates and switches"}]},
        "d3": {"units": [{"page_number": 1, "text": "S E S S I O N 3\nadders built from gates"}]},
        "d4": {"units": [{"page_number": 1, "text": "Module 1 schedule\nClass calendar\nMon 1 Sep Class 9 Something else"}]},
    }
    weeks = [
        _week(1, "Week 1 (25–26 Aug)", "2031-08-25", "2031-08-26", "Binary numbers and counting"),
        _week(2, "Week 2 (1–2 Sep)", "2031-09-01", "2031-09-02", "Logic gates and adders"),
        _week(5, "Week 5 (22–23 Sep)", "2031-09-22", "2031-09-23", "Memory"),
    ]
    lms = {
        "source_file": "c/viewer/course-data.js",
        "modules": [
            {"name": "Week 5", "position": 1, "kind": "week", "label_week_numbers": [5], "items": [{"title": "S3_Adders.pdf", "resolved_path": "c/viewer/files/S3_Adders.pdf"}]}
        ],
        "pages": [],
        "assignments": [],
    }
    result = build_curriculum(slug="t", documents=documents, extractions=extractions, weeks=weeks, lms_export=lms, anchor=ANCHOR)
    sessions = {s["key"]: s for s in result["sessions"] if s["numbering"] == "session"}
    assert sessions["M1-S01"]["plan_week"]["label"].startswith("Week 2")  # 1 Sep is within Week 2's dates
    assert sessions["M1-S02"]["plan_week"]["label"].startswith("Week 2")  # 3 Sep: same calendar week
    assert "calendar week" in sessions["M1-S02"]["plan_week"]["basis"]
    # S3 sits in the LMS module "Week 5" but has no date: it is NOT placed in Week 5.
    assert sessions["M1-S03"]["plan_week"] is None and sessions["M1-S03"]["lms_units"] == ["Week 5"]
    # Binary was planned for Week 1 but delivered in Week 2 → flagged.
    assert any(d["kind"] == "plan_vs_delivery" and "Week 1" in d["detail"] for d in result["discrepancies"])
    linked_weeks = {(a["document_id"], a["week_id"]) for a in result["week_associations"]}
    assert ("d1", "w2") in linked_weeks and not any(doc == "d3" for doc, _ in linked_weeks)


def test_conflicting_dates_use_the_majority_and_are_reported():
    documents = [_doc("a", "M2_Class2_Slides.pdf"), _doc("b", "M2_Reading_02_Layers.pdf", "supporting_document", "Reading 2: Layers")]
    extractions = {
        "a": {"units": [{"page_number": 1, "text": "Module 2 Class 2 network · Wed 18 Nov"}]},
        "b": {"units": [{"page_number": 1, "text": "Module 2 · the network · Reading 2 of 10 · Class 2 · Tuesday 17 November"}]},
    }
    schedule_doc = _doc("c", "Module2_Schedule.pdf", "supporting_document")
    extractions["c"] = {"units": [{"page_number": 1, "text": "Module 2\nClass calendar\nTue 17 Nov Class 2 Layers and models."}]}
    result = build_curriculum(slug="t", documents=[*documents, schedule_doc], extractions=extractions, weeks=[], lms_export=None, anchor=ANCHOR)
    session = next(s for s in result["sessions"] if s["key"] == "M2-C02")
    assert session["date"] == "2031-11-17"
    assert any(d["kind"] == "session_date_conflict" for d in result["discrepancies"])
    assert session["subtitle"] == "Layers"


# ------------------------------------------------------------ questions
def test_questions_answers_review_items_and_key_terms():
    from synapse_ingest.questions import PAGE_MARK, _pair_key, extract_from_text

    text = (
        PAGE_MARK.format(1)
        + "\nKey term: Frame\n\nThe unit of data at the link layer.\n\nPractice questions\n\n"
        + "Q1 [Entry] What is a frame?\n\nQ2 · Numerical · 3 marks Add 5 and 3 in binary.\n"
        + PAGE_MARK.format(2)
        + "\nAnswer key\n\nA1 A unit of data on one link.\n\nA2 101 + 011 = 1000.\n"
        + "\nReview Questions\n\n• Why does every frame carry a destination address?\n\nFurther Reading\n\nNothing."
    )
    out = extract_from_text(text)
    assert out["questions"][1]["level"] == "Entry" and out["questions"][1]["text"] == "What is a frame?"
    assert out["questions"][2]["kind"] == "Numerical" and out["questions"][2]["marks"] == 3.0
    assert out["answers"][2]["text"] == "101 + 011 = 1000." and out["answers"][2]["page"] == 2
    assert out["review"][0]["text"].startswith("Why does every frame")
    assert out["terms"] == [{"term": "Frame", "definition": "The unit of data at the link layer.", "page": 1}]
    assert _pair_key("CSD104_Quiz1_AnswerKey.pdf") == _pair_key("CSD104_Quiz1_Question Paper.pdf") == "csd104_quiz1"


def test_title_mentioning_answers_does_not_start_the_answer_section():
    from synapse_ingest.questions import extract_from_text

    text = "Practice: Questions and Worked Answers\n\nQ1 · Concept · 2 marks Explain caching.\n\nPart B. Answer key\n\nQ1 · 2 marks Because locality."
    out = extract_from_text(text)
    assert out["questions"][1]["text"] == "Explain caching."
    assert out["answers"][1]["text"] == "Because locality."
