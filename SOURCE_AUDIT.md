# SOURCE_AUDIT.md — SYNAPSE source material audit

> Phase 0 audit. Re-run the ingestion pipeline (see `ingestion/README.md`)
> after the archive is available; it writes the detailed, machine-generated
> audit to `data/reports/` (git-ignored because it lists private files).

## 1. Audit summary

| Item | Status |
|---|---|
| Subject archive (`Computer-fundamentals-and-networking-2026-Nov-20_13-12-51-555`) | **NOT FOUND in the build environment** |
| `index.html` (Weekly Overview) | Not inspected — archive unavailable |
| Lecture presentations (PPT/PPTX) | Not inspected — archive unavailable |
| Textbook | Not inspected — archive unavailable |
| Fabricated content | **None.** No weeks, topics, filenames, slides or page numbers were invented. |

Audit date: 2026-11-20.

## 2. Where the archive was searched

The development session runs in an isolated cloud container with a fresh clone
of `KushalxYadav/NEURIX`. These locations were checked:

| Location | Result |
|---|---|
| Repository working tree (`/home/user/NEURIX`) | Only `README.md` (`# NEURIX`) — one commit, `Initial commit` |
| Remote branches (`git ls-remote origin`) | Only `main` at the initial commit |
| Whole container filesystem, by name (`*fundamentals*`, `*networking-2026*`, `subject-material*`) | No match |
| Whole container filesystem, any `*.zip` > 1 MB, and any file > 20 MB | Only toolchain binaries |
| Upload mounts (`/mnt/user-data/uploads`, `/mnt/attach`) | Empty |
| User's own computer via Remote Control | No computer or shared folder attached to the session |

**Conclusion:** the archive lives on the user's local machine (or another
location) and was never pushed or uploaded. Committing it is deliberately
prevented: `.gitignore` excludes `/source-material/`, `/*.zip`,
`/Computer-fundamentals-and-networking-*` and everything under `/data/`.

## 3. How to provide the archive

The ingestion pipeline is designed to run **locally**, where the archive is:

1. Place the archive at `source-material/` (any filename; a `.zip` extension is
   optional because ZIPs are detected by their file signature), **or** leave it
   in the project root, **or** pass `--archive /path/to/file`.
2. Run the pipeline (see `ingestion/README.md`):

   ```bash
   python3 -m venv .venv && .venv/bin/pip install -r ingestion/requirements.txt
   .venv/bin/python scripts/run_pipeline.py
   ```

3. Review `data/reports/processing_report.md` and `data/reports/inventory_report.md`.
4. Start the web app (`npm run dev`). Without Supabase it reads
   `data/processed/` directly in **local mode**; with Supabase, load the data
   with `scripts/load_to_database.py`.

To continue development in a cloud session instead, attach your computer's
project folder through Remote Control, or upload the archive to the session.
Do not commit the archive.

## 4. What the pipeline will determine (once the archive is present)

The following questions **cannot be answered yet** and will be answered from
the real files by the pipeline, never assumed:

- Archive entry list, formats, sizes, SHA-256 hashes and duplicates
  → `data/processed/file_inventory.json`
- The structure of `index.html`. The parser does not assume a layout; it
  evaluates table-, heading- and section-container strategies and records
  which one matched → `data/processed/weekly_overview.json`
- Which presentation files are `.pptx` (extractable) vs legacy `.ppt` (converted
  with LibreOffice when available, otherwise reported as *needs conversion*)
- The textbook's format (PDF / EPUB / DOCX), whether it has a PDF outline,
  printed page labels, and whether any pages are scanned (OCR required)
- Which lecture files the Weekly Overview links to (week association,
  *source confirmed*) vs associations guessed from filenames (*unverified*)

## 5. Known processing limitations (by design)

| Situation | Behaviour |
|---|---|
| Legacy `.ppt` | Auto-converted with `soffice --headless --convert-to pptx` when LibreOffice is installed; otherwise status `failed` with conversion instructions. Never silently skipped. |
| Scanned / image-only PDF pages | Detected (low text density + full-page images) and flagged `needs_ocr`; document marked `partially_processed`. OCR is optional and not run by default. |
| DOCX page numbers | DOCX has no fixed pagination. Locations are recorded as paragraph index + heading path; page numbers are never invented. |
| EPUB page numbers | Only recorded when the EPUB contains page-break markers. |
| Encrypted / password-protected entries | Reported as `rejected` (unsupported). |
| Unsafe archive entries (absolute paths, `..`, symlinks, zip-bomb ratios) | Rejected and listed in the inventory issues. |
| `__MACOSX/`, `.DS_Store`, `Thumbs.db` | Listed as `system_metadata`, skipped with a reason. |
| Textbook identification | Heuristic (page count, filename keywords, outline depth). Selection reason is recorded and can be overridden with `--textbook`. |

## 6. Implementation plan (see `DEVELOPMENT_STATUS.md` for live progress)

1. **Phase 0** — this audit. ✅
2. **Phase 1** — Next.js web foundation, design system, auth, multi-subject schema. ✅
3. **Phase 2** — local ingestion pipeline (Stages A–E), status tracking, reports. ✅
   Verified on a synthetic test archive only; **must be run on the real archive**.
4. **Phase 3** — curriculum reconstruction (Curriculum Agent) on the real data.
5. **Phases 4–7** — teaching, tutor, notes, practice, flashcards, planner, analytics, deployment.

Phases 3+ depend on the real archive. They will not be built on invented data.

## 7. Next action for the archive owner

Run on your machine, in the project folder:

```bash
python3 -m venv .venv && .venv/bin/pip install -r ingestion/requirements.txt
.venv/bin/python scripts/run_pipeline.py --archive /path/to/Computer-fundamentals-and-networking-2026-Nov-20_13-12-51-555
```

Then review `data/reports/*.md`. Share the reports' summaries (not the files)
if anything is marked failed, partial, unverified or missing, so the parser or
mappings can be adjusted against the real structure.
