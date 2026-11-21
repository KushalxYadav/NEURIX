# SOURCE_AUDIT.md — SYNAPSE source material audit

Audit date: 2026-11-21 · Subject: **CSD-104 Computer Fundamentals and Networking** (Semester 1, 2026–27)

> This file is committed to a **public** repository, so it records structure,
> counts, dates, filenames and decisions only — no course text. The complete,
> machine-generated audit lives in the git-ignored `data/reports/`
> (`inventory_report.md`, `weekly_overview_report.md`, `processing_report.md`,
> `curriculum_report.md`) and in `data/processed/curriculum.json`.

## 1. Summary

| Item | Result |
|---|---|
| Archive | `Computer-fundamentals-and-networking-2026-Nov-20_13-12-51-555.zip` — 97.9 MB, 54 entries, 105.3 MB uncompressed, 0 rejected entries |
| Location | found in `~/Downloads`; copied to `source-material/` (original untouched); extracted by the pipeline to `data/extracted/<archive-sha>/` |
| Archive type | **LMS offline-viewer export**, not a plain overview page (see §2) |
| Documents processed | 46 unique (4 duplicate groups collapsed): 17 slide decks (PDF), 20 readings/worksheets/tests, 4 books, 1 schedule, … |
| Content units / chunks | 2,256 units (2,246 PDF pages, 10 DOCX sections) · 3,267 retrieval chunks · 627,823 words |
| Status | 44 completed · 2 partially processed (scanned "Thinking Log" PDFs, deliberately not OCR'd — §6) |
| Curriculum | 2 modules with material · 10 Module 1 sessions · 10 Module 2 classes · 16 Weekly Overview weeks |
| Textbook citations | 37 "further reading" citations found in the course's own slides/readings, **all 37 resolved** to page ranges |
| Discrepancies recorded | 23 (§5) — both versions preserved, nothing silently overwritten |
| Fabricated content | **None.** Every week, session, date and page number comes from the archive; inferences are labelled. |

## 2. What the archive actually contains (differs from the expected layout)

The brief expected `index.html` (weekly overview) + PowerPoint presentations + one textbook.
The archive is instead an **LMS offline viewer**:

| Expected | Found |
|---|---|
| `index.html` = weekly overview | `index.html` is a 378-byte shell that loads `viewer/course-data.js` (a JSON object, `window.COURSE_DATA`). That object holds the LMS **modules** (Course Books, Week 1 - 2, Week 3 … Week 7), wiki **pages** (front page "HomePage" = course plan), and **assignments**. |
| PowerPoint files | **No `.ppt/.pptx` at all.** Every lecture deck is a **PDF export of slides** (landscape pages). Citations therefore read "file, slide N" (one PDF page per slide). |
| One textbook | **Four books** in the LMS "Course Books" module: Petzold *Code* (primary, Module 1 — a scanned PDF, OCR'd here), Kurose & Ross *Computer Networking* 8e (primary, Module 2), Hillis *The Pattern on the Stone* (optional), Nisan & Schocken *The Elements of Computing Systems* (in the LMS but not listed on the course page). |
| — | Course-authored **reading companions** per session (Module 1) and **ten readings** for Module 2, practice worksheets with answers, Quiz 1 paper + key, Module 1 class-test keys, a **Module 2 schedule (v2)** PDF. |

Files that are in the archive but not in any LMS module (kept, mapped by their own content): the ten Module 2 readings, the Module 2 schedule, the two Thinking Log PDFs, and four exact duplicates.

## 3. Pipeline changes made for this archive

| Change | Where |
|---|---|
| New **Stage A2**: reads `course-data.js` as JSON (never executed), resolves module items to archive files with traversal protection, writes `processed/lms_export.json` | `ingestion/synapse_ingest/lms_export.py` |
| Stage B: when `index.html` is a viewer shell, the LMS front page is parsed as the Weekly Overview (provenance recorded as `source_detail`) | `overview.py` |
| Dates: day lists ("19, 21 Oct"), single days ("30 Nov"); the schedule year is anchored to the archive download date so book citations ("Petzold (2000)") cannot set it | `overview.py` |
| New **curriculum mapping** (Stage F, inside E): sessions, dates, overview-week placement, further-reading resolution, assessments, discrepancies → `processed/curriculum.json`, `reports/curriculum_report.md` | `curriculum.py`, `index.py` |
| Books listed in the LMS "Course Books" module are typed `textbook` | `index.py` |
| Slide decks exported to PDF are cited by slide number | `index.py` |
| OCR (OCRmyPDF + Tesseract, installed via Homebrew) run on Petzold *Code* only; timeout raised to 1 h | `documents.py` |

Tests: `tests/ingestion/test_lms_curriculum.py` (16 tests, synthetic data only) plus the existing 35.

## 4. Source priority and how each link is labelled

| Priority | Source | Used for |
|---|---|---|
| 1 | **Weekly Overview** — LMS front page "Weekly Learning Plan" (16 weeks, dates, planned topics), outcomes K1–K3/S1–S3/AV1–AV3, assessment criteria | Course structure, planned timeline |
| 1b | **Module 2 schedule v2** (PDF) and dates printed on title slides/readings | What was actually delivered, and when |
| 2 | **Slide decks** and course-authored readings | Lecture content (teacher-delivered) |
| 3 | **Books** | Supplementary depth, only where the course cites them, plus clearly-labelled suggestions |

| Label in data/UI | Meaning |
|---|---|
| `source_confirmed` | Stated by the material: a session number on a title slide, a date on a title slide or in the schedule, a chapter cited in "Further reading", a page range from a PDF outline |
| `unverified` | Inferred: session number only in a filename, a deck attached by LMS module + shared title words, a Petzold page range from OCR running headers |
| `heuristic` | Keyword similarity (planned-topic match, suggested book sections) — never presented as course-confirmed |
| `ai_supplementary` | Reserved for Claude-generated explanations (none generated yet — no API key) |

**Placement rule:** a session is placed in a Weekly Overview week **only by date**. LMS module labels ("Week 3", "Week 7") are shown but never used for placement: the archive proves they are teaching-week counters, not calendar weeks (LMS "Week 7" holds Module 2 Classes 1–3, delivered 16–18 Nov = overview Week 12).

## 5. Discrepancies (both versions preserved)

| # | Kind | Detail |
|---|---|---|
| 1 | Plan vs delivery (11×) | The overview plan is roughly one week ahead of delivery in Module 1 (e.g. it plans logic gates in Week 2; the decks show S1–S2 binary/data representation on 31 Aug & 2 Sep, logic gates as "Week 3"). Module 2 was delivered **16 Nov – 7 Dec** (schedule v2 + dated readings) while the overview plans it for **5 Oct – 30 Nov**. |
| 2 | Session date | Class 2 (OSI): slide 1 says Wed 18 Nov; the reading and schedule say Tue 17 Nov → **17 Nov** used (majority). |
| 3 | Week label | Logic-gates deck: title slide "Week 3 · Session 1", PDF metadata "W2S1". |
| 4 | Assessment dates | Practical 2 (Wireshark): overview 24 Nov vs schedule v2 **6 Dec**. Practical 3 (Packet Tracer): overview 7 Dec vs schedule v2 issued 27 Nov, **due 5 Dec**. |
| 5 | Assessment scheme (noted, not auto-linked) | Overview: "In-class Exam 2, 25 Nov, 7.5 marks" and "Surprise quizzes, best 3 of 4"; schedule v2: "Module 2 class test, 4 Dec, 10 marks" and "Quiz 2, 27 Nov — best of Quiz 1 and Quiz 2". Overview "In-class Exam 1 ~13 Oct" vs LMS assignment "Class Test 1" (opened 14 Nov, 30 points). These may be the same assessments renamed — **unverified**. |
| 6 | Numbering | Module 2 files use a running "S11/S12/S13" count while title pages say "Class 1/2/3"; two files are both "S13". Class numbers from the title pages are used. |
| 7 | LMS titles ≠ filenames | 4 items (e.g. LMS "…S13_Data Link Layer.pdf" is file `CSD104_M2_C3_Slides.pdf`). Both names kept. |
| 8 | Books | *The Elements of Computing Systems* is in "Course Books" but not on the course page's reading list. |
| 9 | Spelling | `CSD104_S10_Opertaing System.pdf` — filename kept verbatim; display title corrected to "Operating System" with a note. |

**Which date does SYNAPSE show?** The timeline shows both. "Upcoming" and "current class" use the **most recent dated source** (schedule v2 and the dated readings), with the overview's date shown alongside whenever they differ.

## 6. Exclusions and privacy

- **Thinking Log 2/3** (scanned, 44 pages each, attached to graded LMS assignments): likely photographs of students' handwritten question cards. Not OCR'd and excluded from tutoring/retrieval; listed as `student_work`.
- **Quiz 1 results image** and the LMS logo: images, not indexed.
- The instructor's contact details are kept only in local data, not in committed files.
- `source-material/`, `data/`, `*.zip` and the archive name are git-ignored and excluded from deployment (`.vercelignore`).

## 7. Re-running

```bash
.venv/bin/python scripts/run_pipeline.py          # ~10 s, cached per document
.venv/bin/python scripts/run_pipeline.py --ocr --only "<archive path of a scanned PDF>"
```
