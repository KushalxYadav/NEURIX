"""Stage B: the weekly overview parser must adapt to unknown HTML structures."""

from __future__ import annotations

from synapse_ingest.config import Paths
from synapse_ingest.overview import classify_label, parse_date_range, parse_overview
from synapse_ingest.util import read_json


def test_lms_export_structure(pipeline_run: Paths) -> None:
    overview = read_json(pipeline_run.weekly_overview)
    assert overview["parser_strategy"]["name"] == "containers"
    labels = [w["label"] for w in overview["weeks"]]
    assert labels == ["4 August - 10 August", "11 August - 17 August", "18 August - 24 August"]
    first = overview["weeks"][0]
    assert first["week_number"] == 1 and first["week_number_source"] == "inferred_from_order"
    assert first["date_range"]["start_date"] == "2026-08-04"
    assert first["date_range"]["year_source"] == "archive_filename"
    assert first["learning_objectives"] == ["Describe the fixture layer model", "Explain fixture addressing basics"]
    assert {"kind": "chapter", "text": "Chapter 1", "value": "1"} in first["references"]
    assert any(r["kind"] == "pages" and r["page_start"] == 1 and r["page_end"] == 12 for r in first["references"])
    topics = [t["text"] for t in first["topics"]]
    assert "Introduction to fixture layer models" in topics
    assert "Learning objectives:" not in topics
    assert first["resources"][0]["resolved_path"] == "Week 1/Lecture01_intro.pptx"
    assert first["lectures"][0]["title"] == "Lecture 1 – Fixture Layers"

    general = [s for s in overview["other_sections"] if s["label"] == "General"]
    assert general and general[0]["label_kind"] == "other"
    assert overview["external_links"][0]["domain"] == "example.org"
    assert overview["unresolved_links"][0]["href"] == "missing/handout.pdf"


def test_heading_based_overview() -> None:
    html = """<html><body><h1>Course</h1>
    <h2>Week 1: Introduction</h2><p>Data and signals</p><ul><li>Analog vs digital</li></ul>
    <h2>Week 2: Transmission media</h2><p>Guided media</p>
    <h3>Lecture 3</h3><p>Not a new week</p>
    <h2>Week 3: Switching</h2><p>Circuit switching</p></body></html>"""
    result = parse_overview(html)
    assert result["parser_strategy"]["name"] == "headings"
    assert [w["week_number"] for w in result["weeks"]] == [1, 2, 3]
    assert result["weeks"][0]["week_number_source"] == "explicit"
    assert "Analog vs digital" in [t["text"] for t in result["weeks"][0]["topics"]]
    # h3 "Lecture 3" stays inside week 2 instead of splitting the sequence
    assert "Not a new week" in [t["text"] for t in result["weeks"][1]["topics"]]


def test_table_based_overview() -> None:
    html = """<table><tr><th>Week</th><th>Dates</th><th>Topic</th><th>Reading</th></tr>
    <tr><td>1</td><td>01/09/2026 - 05/09/2026</td><td>Number systems</td><td>Ch. 1</td></tr>
    <tr><td>Week 2</td><td>08/09/2026 - 12/09/2026</td><td>Boolean logic</td><td>Chapter 2, pp. 30-45</td></tr>
    <tr><td>Week 3</td><td></td><td>Computer organisation</td><td></td></tr></table>"""
    result = parse_overview(html)
    assert result["parser_strategy"]["name"] == "tables"
    weeks = result["weeks"]
    # Header "Week" + bare cell "1" is composed into the label "Week 1" (and recorded as such)
    assert [(w["label"], w["week_number"]) for w in weeks] == [("Week 1", 1), ("Week 2", 2), ("Week 3", 3)]
    assert weeks[0]["fields"]["_label_composed_from"] == "table header + cell"
    assert weeks[0]["date_range"]["start_date"] == "2026-09-01"  # from the "Dates" column
    assert weeks[0]["date_range"]["year_source"] == "explicit"
    assert weeks[2]["date_range"] is None  # empty cell: no date invented
    assert weeks[1]["fields"]["Topic"] == "Boolean logic"
    assert any(r["kind"] == "pages" and r["page_start"] == 30 for r in weeks[1]["references"])


def test_paragraph_label_fallback_and_numbers_in_words() -> None:
    html = """<div><p><b>Week One - Basics</b></p><p>Bits and bytes</p>
    <p><b>Week Two - Logic gates</b></p><p>AND, OR, NOT</p></div>"""
    result = parse_overview(html)
    assert [w["week_number"] for w in result["weeks"]] == [1, 2]


def test_unstructured_html_warns_instead_of_inventing_weeks() -> None:
    result = parse_overview("<html><body><p>Hello</p><p>No schedule here</p></body></html>")
    assert result["weeks"] == []
    assert any("No week-like structure" in w for w in result["warnings"])


def test_date_range_formats() -> None:
    assert parse_date_range("4 August - 10 August")["end"] == {"day": 10, "month": 8, "year": None}
    assert parse_date_range("Aug 4 – Aug 10, 2026")["start"]["year"] == 2026
    assert parse_date_range("4 - 10 Aug")["start"] == {"day": 4, "month": 8, "year": None}
    assert parse_date_range("2026-08-04 to 2026-08-10")["end"]["day"] == 10
    numeric = parse_date_range("03/08/2026 - 09/08/2026")
    assert numeric["numeric_order"] == "day_first_assumed" and numeric["start"]["month"] == 8
    assert parse_date_range("No dates here") is None


def test_year_rollover_across_december() -> None:
    html = """<h3>22 December - 28 December</h3><p>a</p><h3>29 December - 4 January</h3><p>b</p>
    <h3>5 January - 11 January</h3><p>c</p><p>Term 2025</p>"""
    result = parse_overview(html)
    dates = [(w["date_range"]["start_date"], w["date_range"]["end_date"]) for w in result["weeks"]]
    assert dates == [("2025-12-22", "2025-12-28"), ("2025-12-29", "2026-01-04"), ("2026-01-05", "2026-01-11")]
    assert result["weeks"][0]["date_range"]["year_source"] == "overview_text"


def test_classify_label() -> None:
    assert classify_label("Week 12: Revision") == ("week", 12)
    assert classify_label("Topic 3 - Networks") == ("topic", 3)
    assert classify_label("1 Sep - 7 Sep") == ("date_range", None)
    assert classify_label("Assessment information") == ("other", None)
