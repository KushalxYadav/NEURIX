# SYNAPSE ingestion worker

Local, resumable pipeline that turns the subject archive into traceable,
source-referenced data. It runs where the archive lives; the archive is
opened read-only and never sent anywhere.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r ingestion/requirements.txt
```

Optional tools, detected automatically:

| Tool | Used for | Without it |
|---|---|---|
| LibreOffice (`soffice`) | converting legacy `.ppt`, `.pps`, `.odp`, `.doc`, `.odt`, `.rtf` | those files are marked **failed** with the exact conversion command |
| OCRmyPDF + Tesseract | `--ocr` for scanned PDF pages | scanned pages are flagged `needs_ocr`; the document is marked partially processed when they are significant |

## Running

```bash
.venv/bin/python scripts/run_pipeline.py
```

Archive discovery order: `--archive`, `$SYNAPSE_ARCHIVE_PATH`, the single ZIP
in `source-material/`, then a ZIP in the project root named
`Computer-fundamentals-and-networking*` or `*.zip`. ZIPs are recognised by
their signature, so the extension is optional.

Useful options (all stage scripts accept `--data-dir` and `-v`):

| Option | Effect |
|---|---|
| `--overview PATH` | choose the Weekly Overview HTML inside the archive |
| `--textbook PATH` | override the textbook heuristic |
| `--only PATH` (repeatable) | re-extract only these documents; everything else stays cached |
| `--force` | re-extract everything |
| `--ocr` | OCR PDFs with scanned pages (needs OCRmyPDF) |
| `--no-convert` | do not run LibreOffice for legacy files |
| `--subject-name/--subject-slug` | override the subject name taken from the overview title |

Debug the overview parser on any HTML file:

```bash
.venv/bin/python scripts/parse_weekly_overview.py --html path/to/index.html
```

## Stages and outputs (`data/`)

| Stage | Module | Output |
|---|---|---|
| A | `archive.py` | `processed/file_inventory.json`, `reports/inventory_report.md`, `extracted/<archive-sha>/…` |
| B | `overview.py` | `processed/weekly_overview.json`, `reports/weekly_overview_report.md` |
| C | `presentations.py` | `processed/presentations/<sha>.json` |
| D | `documents.py` | `processed/documents/<sha>.json` |
| E | `index.py`, `chunking.py` | `processed/source_index.json`, `content_units.jsonl`, `chunks.jsonl`, `reports/processing_report.md` |
| A2 | `lms_export.py` | `processed/lms_export.json` — only when `index.html` is an LMS offline-viewer shell loading `viewer/course-data.js` (parsed as JSON, never executed) |
| F | `curriculum.py` (run inside E) | `processed/curriculum.json`, `reports/curriculum_report.md` — sessions, dates, overview weeks (by date only), further reading → page ranges, assessments, discrepancies |
| G | `questions.py` | `processed/questions.json` — numbered course questions with their answer keys, review questions, key terms (verbatim, cited) |
| — | `status.py` | `processed/processing_status.json` (per document, per stage) |

### How unknown structure is handled

- **Weekly Overview.** The HTML is linearised into text blocks. Table, section-
  container (e.g. LMS course exports), heading-level and paragraph-label
  strategies are each scored by the number of week-like labels found ("Week 3",
  "Topic 2", "4 August – 10 August", …). Structural strategies win when they
  find at least two. The chosen strategy and all scores are recorded. If no
  week structure exists, a warning is emitted instead of invented weeks.
  Week numbers are `explicit` or `inferred_from_order`. Dates without a year
  record where the year came from (`explicit`, `overview_text`,
  `archive_filename`) and handle December→January rollover.
- **Links** are resolved relative to `index.html`, URL-decoded and matched
  against the inventory. Unresolved links are listed, never dropped.
- **Textbook** selection is a scored heuristic (page count, outline, filename,
  slide-like orientation). The reasons are stored in the inventory.
- **Page numbers.** PDF pages keep `page_number` (physical) and `page_label`
  (printed label defined in the PDF), plus a `detected_printed_page` read from
  running headers/footers. Repeated headers/footers are removed from the text.
  DOCX has no fixed pages, so locations are paragraph-based. EPUB pages are
  recorded only when page-break markers exist.

### Evidence levels

| Level | Meaning | Examples |
|---|---|---|
| `source_confirmed` | stated by the material | a lecture linked from the overview, a PDF outline chapter |
| `unverified` | inferred heuristically | "Week 3" in a filename, a chapter heading detected by font size |

### Status values

`pending`, `processing`, `completed`, `partially_processed`, `failed`,
`skipped`. Every file in the archive appears in `source_index.json → files`
with a status and reason, including images (`not_applicable`), OS metadata
(`skipped`) and unsafe entries (`rejected`).

Resumability: results are cached per document by SHA-256 and extractor
version. An interrupted run leaves documents in `processing`; the next run
re-extracts exactly those.

## Loading into Supabase

```bash
SUPABASE_DB_URL='postgresql://…' .venv/bin/python scripts/load_to_database.py --owner-email you@example.com
```

Runs in one transaction. IDs are deterministic per owner, so reloading updates
rows in place, keeps links stable and removes rows that disappeared.
