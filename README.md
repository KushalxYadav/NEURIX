# SYNAPSE — Your Personal Learning OS

SYNAPSE turns a student's own course archive (weekly overview page, lecture
slides, textbook) into a private learning environment: a week-by-week
timeline, traceable source material, and — in later phases — AI teaching,
tutoring, practice, revision and exam planning grounded in that material.

> **Status:** Phases 0–2 are implemented and tested (source audit, web
> foundation, local ingestion pipeline, database). The real subject archive
> was not available in the build environment — see [`SOURCE_AUDIT.md`](SOURCE_AUDIT.md).
> Progress and next steps: [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md).

## Principles

- **Source accuracy first.** Every passage keeps its file and slide/page
  number. Week links carry their evidence: *source confirmed* (stated by your
  material), *unverified* (inferred, e.g. from a filename) or *AI
  supplementary*. Nothing is invented — missing data is shown as missing.
- **Private by default.** Study material never enters Git, the frontend
  bundle or an AI request as a whole. In Supabase mode every row is scoped to
  its owner by Row Level Security.
- **Honest progress.** Mastery comes only from checkpoints and quizzes, never
  from pages opened.

## Architecture

```
archive.zip ──► Python ingestion (local)            ──► data/processed/*.json ──► Next.js (local mode)
                A inspect & safely extract                         │
                B parse Weekly Overview (index.html)               └─► load_to_database.py ──► Supabase Postgres
                C slide-aware PPTX extraction                                                 (RLS, full-text search,
                D textbook / PDF / DOCX / EPUB                                                  optional pgvector)
                E unified index + RAG chunks                                                         │
                                                                    Next.js (Supabase mode) ◄────────┘
                                                                    └─ Claude via server-only provider
```

| Layer | Technology |
|---|---|
| Web | Next.js 16 (App Router, Cache Components, `proxy.ts`), React 19, TypeScript, Tailwind CSS 4, shadcn-style components on Radix, Motion |
| Data | Supabase Postgres + Auth, RLS on every table, full-text search, optional pgvector hybrid search |
| AI | Anthropic Claude through `src/lib/ai` (server-only, Zod-validated structured outputs, configurable model) |
| Ingestion | Python 3.11+: PyMuPDF, python-pptx, python-docx, BeautifulSoup/lxml, optional LibreOffice & OCRmyPDF |
| Tests | pytest (pipeline, schema, RLS), Vitest (unit + contract), Playwright (desktop + mobile e2e) |

## Quick start (local mode — no accounts needed)

```bash
npm install
python3 -m venv .venv && .venv/bin/pip install -r ingestion/requirements.txt
```

Place your archive in `source-material/` (or the project root), then:

```bash
npm run ingest
```

```bash
npm run dev
```

Open http://localhost:3000. Without Supabase variables the app runs in
**local mode**: a read-only view of `data/processed/` on your machine. Reports
are written to `data/reports/` (`processing_report.md`,
`inventory_report.md`, `weekly_overview_report.md`).

## Supabase mode (accounts and saved progress)

1. Create a Supabase project and apply the migrations in `supabase/migrations/`
   (`supabase link` then `supabase db push`, or run them in order in the SQL editor).
   The pgvector migration is optional and skips itself if the extension is unavailable.
2. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Start the app, create an account at `/signup` and confirm your email.
4. Load your processed material into your account:

   ```bash
   SUPABASE_DB_URL='postgresql://…' .venv/bin/python scripts/load_to_database.py --owner-email you@example.com
   ```

## Ingestion pipeline

See [`ingestion/README.md`](ingestion/README.md). Each stage can run on its own:

| Script | Stage | Output |
|---|---|---|
| `scripts/inspect_archive.py` | A — inventory, safety checks, extraction, duplicates | `data/processed/file_inventory.json` |
| `scripts/parse_weekly_overview.py` | B — weekly overview | `data/processed/weekly_overview.json` |
| `scripts/extract_presentations.py` | C — slides, notes, tables, SmartArt | `data/processed/presentations/*.json` |
| `scripts/extract_book.py` | D — textbook and documents with page labels | `data/processed/documents/*.json` |
| `scripts/build_source_index.py` | E — units, chunks, coverage | `source_index.json`, `content_units.jsonl`, `chunks.jsonl` |
| `scripts/run_pipeline.py` | A–E, resumable; `--only <path>` reprocesses one file | all of the above |
| `scripts/load_to_database.py` | load into Postgres (idempotent) | Supabase tables |

## Tests

```bash
npm run test:all
```

That runs lint, the type check, `pytest` (pipeline, migrations and RLS on a
throwaway PostgreSQL 16 cluster), Vitest, and Playwright on desktop and mobile.
End-to-end tests use **synthetic** fixture data produced by the real pipeline
from a generated test archive (`tests/ingestion/synthetic.py`) — never real
course content. Individual suites: `npm run test`, `npm run test:python`,
`npm run test:e2e`.

## Project structure

```
src/app/            routes: (app) shell pages, (auth) sign-in, api/, auth/callback, setup
src/components/     ui/ primitives, shell/ navigation, common/, curriculum/, sources/
src/lib/            config (env), supabase clients, auth (session/DAL), ai (provider, prompts), utils
src/modules/        sources (repositories, timeline/coverage logic), learning (activity)
src/proxy.ts        session refresh + sign-in gate (Next 16 replacement for middleware)
ingestion/          Python package synapse_ingest + requirements
scripts/            pipeline entry points
supabase/migrations schema, RLS, full-text search, optional pgvector
tests/              ingestion/, db/, unit/, e2e/
data/               private pipeline output (git-ignored)
source-material/    your archive (git-ignored)
```

## Security notes

- `source-material/`, `data/`, `*.zip` and the archive name are git-ignored
  and listed in `.vercelignore`; local-mode file reads are excluded from
  deployment tracing.
- API keys are server-only; `/api/health` and Settings report configuration
  status without values.
- RLS: subject material is readable only by its owner; students cannot write
  source tables (the ingestion worker uses a privileged connection);
  learning-state rows are per user; composite foreign keys prevent
  cross-subject references. All of this is covered by `tests/db`.
- Archive extraction rejects path traversal, absolute paths, symlinks,
  encrypted entries and zip-bomb ratios, and streams with byte limits.
