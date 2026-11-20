# DEVELOPMENT_STATUS.md

Last updated: 2026-11-20 · Branch: `claude/brave-euler-8e6szp`

| Phase | Scope | Status |
|---|---|---|
| 0 | Repository & source audit | ✅ Done — archive **not available** in the build environment (`SOURCE_AUDIT.md`) |
| 1 | Web foundation, design system, auth, multi-subject schema | ✅ Done (Supabase-mode flows untested against a live project) |
| 2 | Local source ingestion (Stages A–E) | ✅ Done — verified on a synthetic archive; **awaits the real archive** |
| 3 | Curriculum intelligence | ⏳ Next — needs the real archive's output |
| 4 | AI teaching system (provider ✅, retrieval SQL ✅, agents/UI ⏳) | Foundations in place |
| 5–7 | Practice & revision, exam preparation, quality & deployment | Not started (schema ready) |

## Phase 0 — Repository and source audit

- **Implemented:** full search for the archive (repo, remote branches, whole
  container, upload mounts, Remote Control); `SOURCE_AUDIT.md`; `.gitignore`
  and `.vercelignore` rules that keep archives and extracted material out of
  Git and deployments.
- **Finding:** the repository contained only `README.md`; the ZIP was not
  present anywhere reachable. No content was invented.
- **Required from you:** run the pipeline locally on the archive (command in
  `SOURCE_AUDIT.md §7`).

## Phase 1 — Web foundation

**Implemented**
- Next.js 16 App Router + TypeScript, Cache Components with partial
  prerendering (static shell, streamed data), `proxy.ts` session gate.
- Design system: dark-first tokens, glass surfaces, a reserved colour language
  for evidence levels (source confirmed / AI supplementary / unverified) and
  processing states; Geist typography; Motion for the active-nav indicator;
  reduced-motion support; skip link; labelled mobile drawer (Radix Dialog).
- Navigation for all 12 sections, responsive from phone to desktop.
- Data layer: one domain model, two repositories — **local** (validated
  `data/processed/` files, hot-reloads after re-ingestion) and **Supabase**
  (RLS-scoped queries). Zod validation at every boundary.
- Auth: Supabase email/password sign-up/sign-in/sign-out, email-confirmation
  callback, open-redirect-safe `next` parameter, per-request `getClaims()`
  verification in a Data Access Layer.
- Pages with real data: **Dashboard** (subject overview, exam countdown,
  current week from overview dates, source coverage, learning evidence, today's
  tasks, weak topics, recent activity), **Weekly Overview** + week detail,
  **Subject Curriculum** (sequence, textbook chapters, coverage report),
  **Source Library** + slide/page viewer with citations and per-document
  reprocess commands, **Settings** (exam & study preferences saved via server
  action; configuration status without secrets).
- Learning Room, AI Tutor, Notes, Practice, Flashcards, Planner and Progress
  show what each module will do and a **live readiness check** — no mock data.
- AI foundation: server-only Claude provider (`src/lib/ai`) with configurable
  model/effort, Zod-validated structured outputs (validated twice), server-side
  refusal fallback, typed retryable errors, content-free usage logging; shared
  source-grounding prompt; provider-independent embeddings interface (Voyage).
- Database (`supabase/migrations`): all 20 requested tables plus
  `source_files`, `document_units`, `week_documents`, `topic_prerequisites`,
  `flashcard_reviews`, `ingestion_jobs`, `ai_usage_events`; UUIDs, timestamps,
  constraints, indexes, composite same-subject foreign keys, RLS on every
  table, profile trigger, full-text search function, optional pgvector hybrid
  search (RRF).

**Tested**
- `npm run build` (all 23 routes), ESLint, `tsc` clean.
- Vitest (27): formatting, timeline/current-week, coverage, local repository
  (mapping, reload, invalid data), **Python↔TypeScript contract** on real
  pipeline output, Claude provider with a fake SDK client, error mapping,
  embeddings client, prompt rendering, data-mode resolution, auth gate.
- Playwright (12 = 6 flows × desktop + Pixel 7): every nav section, timeline →
  week → slides with citations, failure reporting, textbook paging with page
  labels, local-mode auth notice, health endpoint, not-found state; zero console errors.
- pytest `tests/db` (11) on a real PostgreSQL 16 + pgvector cluster: migrations
  apply, profile trigger, owner-only access, anonymous lockout, read-only
  source tables, curriculum corrections only in own subject, cross-subject FK
  rejection, per-user learning state, reprocess-request rules, full-text
  ranking + RLS, hybrid vector search, idempotent loader.

**Not yet verified (needs credentials)**
- Sign-up/sign-in, the Supabase repository's PostgREST queries and the
  Settings server action against a live Supabase project.
- Real Claude calls (no API key in this environment; provider tested with a
  fake client).

## Phase 2 — Local source ingestion

**Implemented** (`ingestion/synapse_ingest`, `scripts/*.py`)
- A: archive discovery (extension-less ZIPs), inventory with SHA-256,
  categories, signatures, duplicates; rejection of traversal, absolute paths,
  symlinks, encrypted entries, zip bombs; streamed extraction with byte limits;
  CRC-verified reuse; overview and textbook selection with recorded reasons.
- B: structure-agnostic Weekly Overview parser (tables, containers, headings,
  labels), verbatim topics, objectives, chapter/page references, resolved
  links, date ranges with year provenance and rollover, explicit vs inferred
  week numbers, warnings instead of invention.
- C: slide-aware PPTX extraction (titles, bullet levels, tables, groups,
  SmartArt, charts, OMML equations, notes, hidden slides, image metadata with
  decorative-logo detection, formula detection); legacy conversion via
  LibreOffice or an explicit failure with instructions.
- D: PDF (physical page + printed label + detected printed page, outline
  chapters and heading paths, header/footer removal, OCR detection, optional
  OCRmyPDF), DOCX, EPUB (page-break markers), HTML and text.
- E: unified index; content units and chunks carrying ID, subject, document,
  filename, type, week association with evidence, chapter, slide/page,
  content hash, extraction status and timestamp; source-aware chunking;
  coverage report; every archive file listed with a status and reason.
- Status tracking (pending → processing → completed / partially processed /
  failed / skipped), resumable runs, retries, `--only` per-document
  reprocessing; Markdown reports; idempotent Postgres loader.

**Tested** — pytest `tests/ingestion` (34) on a generated synthetic archive
plus malicious archives: safety containment, inventory, duplicates, all
overview layouts, date parsing, PPTX details, real `.ppt` → `.pptx`
conversion, broken legacy file reported as failed, PDF page labels/chapters/
OCR flags, DOCX/EPUB locations, chunk traceability, evidence levels,
deterministic IDs, caching and `--only`.

**Remaining** — run on the real archive and adjust to anything its structure
reveals (the overview parser reports which strategy matched and why).

## Next milestone (Phase 3) — what it needs

1. The pipeline output from the real archive (reports in `data/reports/`).
2. `ANTHROPIC_API_KEY` for the Curriculum Agent.
3. Decision: Supabase project for persistence (recommended before Phase 4,
   which stores lessons, chat history and progress).

## Credentials and decisions needed from you

| Item | Needed for |
|---|---|
| Run `scripts/run_pipeline.py` on the archive locally | Every content feature |
| Supabase project URL + publishable key; DB URL for the loader | Accounts, saved progress, Phases 4–6 |
| `ANTHROPIC_API_KEY` | Curriculum Agent, Learning Room, Tutor, Notes, Practice |
| Optional: Voyage AI key | Hybrid (semantic) retrieval; full-text works without it |
| Optional: LibreOffice / OCRmyPDF on the ingestion machine | Legacy `.ppt` and scanned pages |
| Deployment target (Vercel + Supabase as planned) | Phase 7 |

## Known limitations

- Topics on the timeline are verbatim overview lines; structured topics,
  prerequisites and lesson links arrive with the Curriculum Agent (Phase 3).
- Matches between overview "Chapter N" references and textbook chapters are
  numeric and shown as *unverified*.
- "Today" uses the server's UTC date; per-user timezones come with the planner.
- Cloud ingestion (Storage upload → worker) is designed (`ingestion_jobs`,
  `documents.storage_path`) but not built; ingestion is local in v1.
