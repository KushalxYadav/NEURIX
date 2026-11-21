# DEVELOPMENT_STATUS.md

Last updated: 2026-11-21 · Branch: `claude/brave-euler-8e6szp` · Environment: local Mac (local mode)

| Milestone | Scope | Status |
|---|---|---|
| 1 | Repository audit | ✅ Done |
| 2 | Archive discovery and ingestion | ✅ Done — real archive processed (46 documents, 3,267 chunks); Petzold OCR'd |
| 3 | Curriculum mapping | ✅ Done — 20 sessions, dates, overview weeks, 37 resolved book citations, 23 recorded discrepancies (`SOURCE_AUDIT.md`) |
| 4 | App foundation: dashboard, timeline, Learning Room | ✅ Done (local mode) |
| 5 | AI Tutor: grounded retrieval with citations | ✅ Retrieval done and tested · ⚠ Claude answers implemented and unit-tested with a fake client, **not yet run against the live API (no key)** |
| 6 | Practice, flashcards, notes | ✅ Done (local mode) |
| 7 | Planner and analytics | ✅ Done (local mode) |
| 8 | Testing and deployment readiness | ◐ Full test suite run locally; deployment needs Supabase-mode learning state (below) |

## What works today (local mode, no credentials)

- **Ingestion** (`npm run ingest`, ~10 s cached): Stage A archive safety + inventory → **A2 LMS export** (`viewer/course-data.js`, parsed as JSON, never executed) → B Weekly Overview (the LMS front page) → C/D extraction (PDF slides cited by slide number, OCR via OCRmyPDF when asked) → E index + chunks → **F curriculum** (sessions, dates, weeks by date only, further-reading → page ranges, assessments, discrepancies) → **G questions** (72 course questions, 67 with official answers, 12 review questions, 55 key terms).
- **Dashboard**: next class from the dated schedule, last class taught, upcoming assessments (conflicting sources flagged), today's generated tasks, learning evidence and weak topics.
- **Weekly Overview**: the 16-week plan plus, per week, the sessions actually taught in it (placed by printed dates); plan-vs-delivery banner; week pages list taught sessions and topics planned there but taught elsewhere.
- **Learning Room**: every session with its driving question (from slide 1), learning objectives (from the reading), schedule summary, slide-by-slide/page-by-page material with citations, key terms, course checkpoint questions with the official answers, cited further reading linked to the exact book pages, clearly-labelled heuristic textbook suggestions, session tutor, personal notes, mapping evidence.
- **AI Tutor**: BM25 retrieval over all course chunks (course material ranked above books, focused-session boost, per-document diversity); without a key it shows the passages with citations; with a key Claude answers **only** from the retrieved passages, sections are labelled "From your course" / "AI supplementary", and any citation not retrieved is dropped.
- **Practice Arena**: smart set (unanswered/missed first), per module, per session, practice sets & Quiz 1; answer → reveal official answer → self-grade.
- **Flashcards**: course key terms + short answered questions, SM-2-style scheduling.
- **Notes**: per-session or general; create/edit/delete.
- **Study Planner**: 7-day plan from dated classes ("read before class"), recent classes not consolidated, weak sessions, assessment prep, undated catch-up, due flashcards — each task says why.
- **Progress**: mastery per session (latest attempt per question; reading never counts), accuracy, streak, weak topics, performance by question source.
- **Learning state** is stored in `data/learning/state.json` (git-ignored, never deployed), written atomically through an in-process lock.

## Tests (run 2026-11-21)

- `pytest tests/ingestion` — 53 passed, 1 skipped (LibreOffice not installed), incl. 18 new tests for the LMS reader, date fixes, curriculum mapping and question extraction (synthetic data only).
- `vitest` — 39 passed, incl. 12 new: curriculum contract, schedule, assessments/conflicts, mastery, flashcard scheduling, streak, planner, BM25, tutor citation filtering (fake AI client).
- `pytest tests/db` — 10 passed, 1 skipped (pgvector not installed) on a throwaway PostgreSQL 17 cluster: migrations, RLS, full-text search, loader.
- Playwright — 14 passed (7 flows × desktop + Pixel 7), incl. a new test that learning pages refuse to invent sessions when the material has none.
- ESLint and `tsc` clean (ESLint now ignores `data/`, `source-material/` and fixtures — it was linting the archive's bundled JS).
- Manual browser checks on the real archive: dashboard, timeline, Learning Room index + session, checkpoint attempt persisted, tutor search, planner, flashcards, mobile width (no horizontal scroll).

## Not done / known limitations

| Item | Why / what is needed |
|---|---|
| Live Claude answers | No `ANTHROPIC_API_KEY` on this machine. Set it in `.env.local` (server only). The provider, prompts and citation filtering are tested with a fake client only. |
| Generated lessons ("beginner / detailed / exam" write-ups per topic) | Need the API key; today the tutor offers these as one-click prompts grounded in the session. No AI text is pre-generated or stored. |
| Supabase mode for curriculum + learning state | `curriculum.json`/`questions.json` are not loaded into Postgres yet, and the learning store is local-only. In Supabase mode the learning pages say so instead of pretending. Next: extend `db_loader.py` (sessions → `topics`, questions → `questions`), implement a Supabase `LearningStore` over `attempts`, `notes`, `flashcard_reviews`, `topic_mastery`. |
| Module 1 session dates S3–S10 | Not printed in the material → not placed in weeks (shown as "undated"). |
| Class 8 reading (DOCX) answer key | Its answers are in a layout the extractor does not parse; questions show "no published answer". |
| Diagrams / images | Image-only slides are flagged; no image descriptions are generated (would need a vision model). |
| `Thinking Log 2/3` | Deliberately not OCR'd or indexed (likely other students' work). |
| "Today" | Server date in UTC (IST users see the date change at 05:30). |
| Tutor rate limiting | None (single local user). Add per-user limits before any public deployment with an API key. |
| DB tests on macOS | Homebrew PostgreSQL needs `LC_ALL`; the test harness now sets it. The pgvector test is skipped unless pgvector is installed. |

## Credentials needed later

| Variable | Enables |
|---|---|
| `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`, default `claude-opus-5-5`) | Written tutor answers and lesson explanations |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_URL` | Accounts, cloud persistence, deployment (after the Supabase learning store above) |
| `VOYAGE_API_KEY` (optional) | Hybrid semantic retrieval in Supabase mode |

Note: a Claude Code subscription does not include Anthropic API usage; the API key is billed separately.
