-- =============================================================================
-- SYNAPSE core schema (multi-subject, owner-scoped, RLS everywhere)
--
-- Ownership model
--   * A subject belongs to one user (subjects.owner_id). Study material is
--     private: every source table is readable only by the subject owner.
--   * Source tables (documents, units, chunks, files) are written by the
--     ingestion worker with the service role; students can read them.
--   * Curriculum tables (weeks, units, topics, mappings) can also be corrected
--     and confirmed by the owner ("verification_status").
--   * Learning-state tables carry user_id and are only visible to that user.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- enums
create type public.processing_status as enum
  ('pending', 'processing', 'completed', 'partially_processed', 'failed', 'skipped');
create type public.document_type as enum
  ('weekly_overview', 'presentation', 'textbook', 'lecture_slides_pdf', 'supporting_document');
create type public.content_origin as enum
  ('source_confirmed', 'ai_supplementary', 'unverified', 'user_created');
create type public.verification_status as enum ('unverified', 'confirmed', 'rejected');
create type public.association_source as enum
  ('overview_link', 'filename_pattern', 'pdf_outline', 'ai_inferred', 'manual');
create type public.unit_type as enum ('slide', 'page', 'section');
create type public.learning_mode as enum
  ('start_from_zero', 'detailed', 'visual', 'exam_prep', 'quick_revision');
create type public.question_type as enum
  ('mcq', 'multi_select', 'fill_blank', 'short_answer', 'long_answer', 'numerical');
create type public.difficulty_level as enum ('easy', 'medium', 'hard', 'mixed');
create type public.flashcard_rating as enum ('again', 'difficult', 'good', 'easy');
create type public.chat_role as enum ('user', 'assistant');
create type public.study_activity as enum
  ('lesson', 'tutor', 'practice', 'flashcards', 'notes', 'revision', 'mock_exam');
create type public.study_task_status as enum
  ('pending', 'in_progress', 'completed', 'skipped', 'rescheduled');

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  display_name         text check (char_length(display_name) <= 120),
  active_subject_id    uuid,
  daily_study_minutes  integer check (daily_study_minutes between 0 and 1440),
  knowledge_level      text check (knowledge_level in ('none', 'beginner', 'intermediate', 'advanced')),
  preferred_study_time text check (preferred_study_time in ('morning', 'afternoon', 'evening', 'night', 'flexible')),
  timezone             text check (char_length(timezone) <= 64),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------- subjects
create table public.subjects (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null references auth.users (id) on delete cascade,
  slug                    text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name                    text not null check (char_length(name) between 1 and 200),
  name_source             text,
  description             text,
  source_archive_filename text,
  source_archive_sha256   text check (source_archive_sha256 ~ '^[0-9a-f]{64}$'),
  ingestion_status        public.processing_status not null default 'pending',
  ingested_at             timestamptz,
  overview_meta           jsonb not null default '{}'::jsonb,
  coverage                jsonb not null default '{}'::jsonb,
  stats                   jsonb not null default '{}'::jsonb,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (owner_id, slug)
);
create index subjects_owner_idx on public.subjects (owner_id);

alter table public.profiles
  add constraint profiles_active_subject_fk
  foreign key (active_subject_id) references public.subjects (id) on delete set null;

create or replace function public.owns_subject(p_subject_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subjects s
    where s.id = p_subject_id and s.owner_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------- exams
create table public.exams (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  subject_id  uuid not null references public.subjects (id) on delete cascade,
  title       text not null default 'End-semester examination' check (char_length(title) <= 200),
  exam_date   date not null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, subject_id)
);
create index exams_user_subject_idx on public.exams (user_id, subject_id, exam_date);

-- ---------------------------------------------------------------- source material
create table public.documents (
  id                uuid primary key default gen_random_uuid(),
  subject_id        uuid not null references public.subjects (id) on delete cascade,
  source_sha256     text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  original_filename text not null,
  source_path       text not null,
  archive_paths     text[] not null default '{}',
  document_type     public.document_type not null,
  format            text,
  size_bytes        bigint check (size_bytes >= 0),
  title             text,
  title_source      text,
  page_count        integer check (page_count >= 0),
  slide_count       integer check (slide_count >= 0),
  word_count        integer check (word_count >= 0),
  unit_count        integer not null default 0 check (unit_count >= 0),
  chunk_count       integer not null default 0 check (chunk_count >= 0),
  chapters          jsonb not null default '[]'::jsonb,
  quality           jsonb,
  processing_status public.processing_status not null default 'pending',
  errors            text[] not null default '{}',
  warnings          text[] not null default '{}',
  converted_from    text,
  extractor_version text,
  storage_path      text,
  processed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (subject_id, source_sha256),
  unique (id, subject_id)
);
create index documents_subject_type_idx on public.documents (subject_id, document_type);

create table public.source_files (
  id                uuid primary key default gen_random_uuid(),
  subject_id        uuid not null references public.subjects (id) on delete cascade,
  document_id       uuid,
  path              text not null,
  filename          text not null,
  category          text not null,
  extension         text,
  size_bytes        bigint check (size_bytes >= 0),
  sha256            text,
  processing_status text not null check (processing_status in
                    ('pending', 'processing', 'completed', 'partially_processed', 'failed',
                     'skipped', 'rejected', 'not_applicable')),
  reason            text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (subject_id, path),
  foreign key (document_id, subject_id) references public.documents (id, subject_id) on delete set null (document_id)
);
create index source_files_subject_idx on public.source_files (subject_id);

create table public.ingestion_jobs (
  id           uuid primary key default gen_random_uuid(),
  subject_id   uuid not null references public.subjects (id) on delete cascade,
  document_id  uuid,
  requested_by uuid references auth.users (id) on delete set null,
  job_type     text not null check (job_type in ('full_ingestion', 'reprocess_document')),
  status       public.processing_status not null default 'pending',
  attempts     integer not null default 0 check (attempts >= 0),
  last_error   text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  foreign key (document_id, subject_id) references public.documents (id, subject_id) on delete cascade
);
create index ingestion_jobs_subject_idx on public.ingestion_jobs (subject_id, status);

-- One row per slide / page / section: the Source Library viewer reads these.
create table public.document_units (
  id                    uuid primary key default gen_random_uuid(),
  subject_id            uuid not null references public.subjects (id) on delete cascade,
  document_id           uuid not null,
  unit_type             public.unit_type not null,
  unit_number           integer not null check (unit_number >= 1),
  slide_number          integer check (slide_number >= 1),
  page_number           integer check (page_number >= 1),
  page_label            text,
  detected_printed_page text,
  title                 text,
  heading_path          text[] not null default '{}',
  chapter_title         text,
  week_ordinals         integer[] not null default '{}',
  text                  text not null default '',
  notes                 text not null default '',
  flags                 jsonb not null default '{}'::jsonb,
  annotations           jsonb not null default '{}'::jsonb,
  citation              text not null,
  content_hash          text not null,
  word_count            integer not null default 0,
  extraction_status     public.processing_status not null,
  processed_at          timestamptz,
  created_at            timestamptz not null default now(),
  unique (document_id, unit_type, unit_number),
  unique (id, subject_id),
  foreign key (document_id, subject_id) references public.documents (id, subject_id) on delete cascade,
  check ((unit_type <> 'slide' or slide_number is not null) and (unit_type <> 'page' or page_number is not null))
);
create index document_units_subject_idx on public.document_units (subject_id, document_id, unit_number);

create table public.document_chunks (
  id             uuid primary key default gen_random_uuid(),
  subject_id     uuid not null references public.subjects (id) on delete cascade,
  document_id    uuid not null,
  unit_id        uuid,
  chunk_index    integer not null check (chunk_index >= 0),
  unit_type      public.unit_type not null,
  slide_number   integer,
  page_number    integer,
  page_label     text,
  section_number integer,
  heading        text,
  heading_path   text[] not null default '{}',
  chapter_title  text,
  week_ordinals  integer[] not null default '{}',
  content        text not null check (char_length(content) > 0),
  content_hash   text not null,
  citation       text not null,
  word_count     integer,
  token_estimate integer,
  low_information boolean not null default false,
  search_vector  tsvector generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(heading, '') || ' ' || coalesce(chapter_title, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, content), 'B')
  ) stored,
  created_at     timestamptz not null default now(),
  unique (document_id, chunk_index),
  foreign key (document_id, subject_id) references public.documents (id, subject_id) on delete cascade,
  foreign key (unit_id, subject_id) references public.document_units (id, subject_id) on delete cascade,
  check ((unit_type <> 'slide' or slide_number is not null) and (unit_type <> 'page' or page_number is not null))
);
create index document_chunks_search_idx on public.document_chunks using gin (search_vector);
create index document_chunks_subject_idx on public.document_chunks (subject_id, document_id);
create index document_chunks_weeks_idx on public.document_chunks using gin (week_ordinals);

-- ---------------------------------------------------------------- curriculum
create table public.weeks (
  id                  uuid primary key default gen_random_uuid(),
  subject_id          uuid not null references public.subjects (id) on delete cascade,
  ordinal             integer not null check (ordinal >= 1),
  week_number         integer check (week_number >= 0),
  week_number_source  text check (week_number_source in ('explicit', 'inferred_from_order')),
  label               text not null,
  label_kind          text not null,
  start_date          date,
  end_date            date,
  date_raw            text,
  date_year_source    text,
  topics              jsonb not null default '[]'::jsonb,
  learning_objectives jsonb not null default '[]'::jsonb,
  source_references   jsonb not null default '[]'::jsonb,
  items               jsonb not null default '[]'::jsonb,
  resources           jsonb not null default '[]'::jsonb,
  origin              public.content_origin not null default 'source_confirmed',
  verification_status public.verification_status not null default 'unverified',
  source_document_id  uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (subject_id, ordinal),
  unique (id, subject_id),
  foreign key (source_document_id, subject_id) references public.documents (id, subject_id) on delete set null (source_document_id),
  check (start_date is null or end_date is null or end_date >= start_date)
);

create table public.week_documents (
  week_id             uuid not null,
  document_id         uuid not null,
  subject_id          uuid not null references public.subjects (id) on delete cascade,
  association_source  public.association_source not null,
  origin              public.content_origin not null,
  verification_status public.verification_status not null default 'unverified',
  evidence            text,
  created_at          timestamptz not null default now(),
  primary key (week_id, document_id, association_source),
  foreign key (week_id, subject_id) references public.weeks (id, subject_id) on delete cascade,
  foreign key (document_id, subject_id) references public.documents (id, subject_id) on delete cascade
);
create index week_documents_subject_idx on public.week_documents (subject_id);

create table public.units (
  id                  uuid primary key default gen_random_uuid(),
  subject_id          uuid not null references public.subjects (id) on delete cascade,
  ordinal             integer not null check (ordinal >= 1),
  title               text not null check (char_length(title) between 1 and 300),
  description         text,
  origin              public.content_origin not null,
  verification_status public.verification_status not null default 'unverified',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (subject_id, ordinal),
  unique (id, subject_id)
);

create table public.topics (
  id                  uuid primary key default gen_random_uuid(),
  subject_id          uuid not null references public.subjects (id) on delete cascade,
  unit_id             uuid,
  week_id             uuid,
  parent_topic_id     uuid,
  ordinal             integer not null default 0,
  title               text not null check (char_length(title) between 1 and 300),
  slug                text,
  summary             text,
  importance          text check (importance in ('core', 'supporting', 'optional')),
  estimated_minutes   integer check (estimated_minutes > 0),
  origin              public.content_origin not null,
  verification_status public.verification_status not null default 'unverified',
  created_by          text not null default 'pipeline' check (created_by in ('pipeline', 'ai', 'user')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, subject_id),
  foreign key (unit_id, subject_id) references public.units (id, subject_id) on delete set null (unit_id),
  foreign key (week_id, subject_id) references public.weeks (id, subject_id) on delete set null (week_id),
  foreign key (parent_topic_id, subject_id) references public.topics (id, subject_id) on delete cascade,
  check (parent_topic_id is null or parent_topic_id <> id)
);
create index topics_subject_week_idx on public.topics (subject_id, week_id, ordinal);
create index topics_unit_idx on public.topics (unit_id);

create table public.topic_prerequisites (
  topic_id             uuid not null,
  prerequisite_id      uuid not null,
  subject_id           uuid not null references public.subjects (id) on delete cascade,
  origin               public.content_origin not null,
  verification_status  public.verification_status not null default 'unverified',
  created_at           timestamptz not null default now(),
  primary key (topic_id, prerequisite_id),
  foreign key (topic_id, subject_id) references public.topics (id, subject_id) on delete cascade,
  foreign key (prerequisite_id, subject_id) references public.topics (id, subject_id) on delete cascade,
  check (topic_id <> prerequisite_id)
);

create table public.topic_sources (
  id                  uuid primary key default gen_random_uuid(),
  topic_id            uuid not null,
  subject_id          uuid not null references public.subjects (id) on delete cascade,
  document_id         uuid not null,
  unit_id             uuid,
  slide_number        integer,
  page_start          integer,
  page_end            integer,
  association_source  public.association_source not null,
  origin              public.content_origin not null,
  verification_status public.verification_status not null default 'unverified',
  confidence          numeric(3, 2) check (confidence between 0 and 1),
  note                text,
  created_at          timestamptz not null default now(),
  foreign key (topic_id, subject_id) references public.topics (id, subject_id) on delete cascade,
  foreign key (document_id, subject_id) references public.documents (id, subject_id) on delete cascade,
  foreign key (unit_id, subject_id) references public.document_units (id, subject_id) on delete set null (unit_id),
  check (page_start is null or page_end is null or page_end >= page_start)
);
create index topic_sources_topic_idx on public.topic_sources (topic_id);
create index topic_sources_document_idx on public.topic_sources (document_id);

-- ---------------------------------------------------------------- learning
create table public.lessons (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  subject_id   uuid not null references public.subjects (id) on delete cascade,
  topic_id     uuid not null,
  mode         public.learning_mode not null,
  status       text not null default 'in_progress' check (status in ('in_progress', 'completed', 'abandoned')),
  model_id     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (topic_id, subject_id) references public.topics (id, subject_id) on delete cascade
);
create index lessons_user_topic_idx on public.lessons (user_id, topic_id);

create table public.lesson_sections (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.lessons (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  ordinal      integer not null check (ordinal >= 1),
  kind         text not null check (kind in ('explanation', 'example', 'diagram', 'checkpoint', 'summary', 'exam_answer', 'revision')),
  title        text,
  content      jsonb not null default '{}'::jsonb,
  citations    jsonb not null default '[]'::jsonb,
  origin       public.content_origin not null,
  checkpoint   jsonb,
  response     jsonb,
  evaluation   jsonb,
  is_correct   boolean,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (lesson_id, ordinal)
);

create table public.notes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  subject_id    uuid not null references public.subjects (id) on delete cascade,
  topic_id      uuid,
  title         text not null check (char_length(title) between 1 and 300),
  content_md    text not null default '',
  source_refs   jsonb not null default '[]'::jsonb,
  origin        public.content_origin not null default 'user_created',
  is_bookmarked boolean not null default false,
  search_vector tsvector generated always as (
    to_tsvector('english'::regconfig, title || ' ' || content_md)
  ) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (topic_id, subject_id) references public.topics (id, subject_id) on delete set null (topic_id)
);
create index notes_user_subject_idx on public.notes (user_id, subject_id, updated_at desc);
create index notes_search_idx on public.notes using gin (search_vector);

create table public.chat_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  topic_id   uuid,
  week_id    uuid,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (topic_id, subject_id) references public.topics (id, subject_id) on delete set null (topic_id),
  foreign key (week_id, subject_id) references public.weeks (id, subject_id) on delete set null (week_id)
);
create index chat_sessions_user_idx on public.chat_sessions (user_id, updated_at desc);

create table public.chat_messages (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.chat_sessions (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          public.chat_role not null,
  content       text not null,
  citations     jsonb not null default '[]'::jsonb,
  model_id      text,
  input_tokens  integer,
  output_tokens integer,
  created_at    timestamptz not null default now()
);
create index chat_messages_session_idx on public.chat_messages (session_id, created_at);

-- ---------------------------------------------------------------- assessment
create table public.quizzes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  subject_id     uuid not null references public.subjects (id) on delete cascade,
  topic_id       uuid,
  title          text not null,
  difficulty     public.difficulty_level not null default 'mixed',
  kind           text not null default 'practice' check (kind in ('practice', 'mock_exam')),
  created_at     timestamptz not null default now(),
  foreign key (topic_id, subject_id) references public.topics (id, subject_id) on delete set null (topic_id)
);
create index quizzes_user_idx on public.quizzes (user_id, created_at desc);

create table public.questions (
  id             uuid primary key default gen_random_uuid(),
  quiz_id        uuid not null references public.quizzes (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  topic_id       uuid references public.topics (id) on delete set null,
  ordinal        integer not null check (ordinal >= 1),
  type           public.question_type not null,
  prompt         text not null,
  options        jsonb,
  answer         jsonb not null,
  explanation    text,
  misconceptions jsonb not null default '[]'::jsonb,
  source_refs    jsonb not null default '[]'::jsonb,
  origin         public.content_origin not null,
  difficulty     public.difficulty_level not null,
  created_at     timestamptz not null default now(),
  unique (quiz_id, ordinal)
);

create table public.attempts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  quiz_id            uuid not null references public.quizzes (id) on delete cascade,
  question_id        uuid not null references public.questions (id) on delete cascade,
  response           jsonb not null,
  is_correct         boolean,
  score              numeric(5, 2) check (score between 0 and 100),
  feedback           jsonb,
  time_spent_seconds integer check (time_spent_seconds >= 0),
  created_at         timestamptz not null default now()
);
create index attempts_user_idx on public.attempts (user_id, created_at desc);

-- ---------------------------------------------------------------- revision
create table public.flashcards (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  subject_id       uuid not null references public.subjects (id) on delete cascade,
  topic_id         uuid,
  kind             text not null check (kind in ('definition', 'concept', 'formula', 'fact', 'question')),
  front            text not null,
  back             text not null,
  source_refs      jsonb not null default '[]'::jsonb,
  origin           public.content_origin not null,
  ease             numeric(4, 2) not null default 2.50 check (ease >= 1.30),
  interval_days    integer not null default 0 check (interval_days >= 0),
  repetitions      integer not null default 0 check (repetitions >= 0),
  lapses           integer not null default 0 check (lapses >= 0),
  due_at           timestamptz not null default now(),
  last_reviewed_at timestamptz,
  is_difficult     boolean not null default false,
  suspended        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (topic_id, subject_id) references public.topics (id, subject_id) on delete set null (topic_id)
);
create index flashcards_due_idx on public.flashcards (user_id, subject_id, due_at) where not suspended;

create table public.flashcard_reviews (
  id                     uuid primary key default gen_random_uuid(),
  flashcard_id           uuid not null references public.flashcards (id) on delete cascade,
  user_id                uuid not null references auth.users (id) on delete cascade,
  rating                 public.flashcard_rating not null,
  previous_interval_days integer,
  new_interval_days      integer,
  previous_ease          numeric(4, 2),
  new_ease               numeric(4, 2),
  reviewed_at            timestamptz not null default now()
);
create index flashcard_reviews_card_idx on public.flashcard_reviews (flashcard_id, reviewed_at desc);

-- ---------------------------------------------------------------- progress & planning
create table public.topic_mastery (
  user_id             uuid not null references auth.users (id) on delete cascade,
  topic_id            uuid not null,
  subject_id          uuid not null references public.subjects (id) on delete cascade,
  lessons_completed   integer not null default 0 check (lessons_completed >= 0),
  checkpoints_correct integer not null default 0 check (checkpoints_correct >= 0),
  checkpoints_total   integer not null default 0 check (checkpoints_total >= checkpoints_correct),
  quiz_correct        integer not null default 0 check (quiz_correct >= 0),
  quiz_total          integer not null default 0 check (quiz_total >= quiz_correct),
  revision_count      integer not null default 0 check (revision_count >= 0),
  time_spent_seconds  integer not null default 0 check (time_spent_seconds >= 0),
  -- Estimated mastery combines all evidence; verified mastery uses assessments only.
  estimated_mastery   numeric(5, 2) check (estimated_mastery between 0 and 100),
  verified_mastery    numeric(5, 2) check (verified_mastery between 0 and 100),
  evidence            jsonb not null default '{}'::jsonb,
  last_activity_at    timestamptz,
  updated_at          timestamptz not null default now(),
  primary key (user_id, topic_id),
  foreign key (topic_id, subject_id) references public.topics (id, subject_id) on delete cascade
);

create table public.study_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  subject_id       uuid not null references public.subjects (id) on delete cascade,
  topic_id         uuid,
  activity         public.study_activity not null,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_seconds integer check (duration_seconds >= 0),
  created_at       timestamptz not null default now(),
  foreign key (topic_id, subject_id) references public.topics (id, subject_id) on delete set null (topic_id),
  check (ended_at is null or ended_at >= started_at)
);
create index study_sessions_user_idx on public.study_sessions (user_id, started_at desc);

create table public.study_tasks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  subject_id        uuid not null references public.subjects (id) on delete cascade,
  exam_id           uuid,
  topic_id          uuid,
  scheduled_date    date not null,
  task_type         public.study_activity not null,
  title             text not null,
  description       text,
  estimated_minutes integer check (estimated_minutes > 0),
  priority          integer not null default 0,
  priority_reason   text,
  status            public.study_task_status not null default 'pending',
  origin            text not null default 'planner' check (origin in ('planner', 'user')),
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (exam_id, subject_id) references public.exams (id, subject_id) on delete set null (exam_id),
  foreign key (topic_id, subject_id) references public.topics (id, subject_id) on delete set null (topic_id)
);
create index study_tasks_user_date_idx on public.study_tasks (user_id, subject_id, scheduled_date);

create table public.ai_usage_events (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users (id) on delete set null,
  subject_id        uuid references public.subjects (id) on delete set null,
  agent             text not null,
  model_id          text,
  input_tokens      integer,
  output_tokens     integer,
  cache_read_tokens integer,
  latency_ms        integer,
  status            text not null check (status in ('ok', 'error', 'refusal')),
  error_code        text,
  created_at        timestamptz not null default now()
);
create index ai_usage_events_user_idx on public.ai_usage_events (user_id, created_at desc);

-- ---------------------------------------------------------------- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'subjects', 'exams', 'documents', 'source_files', 'weeks', 'units', 'topics',
    'lessons', 'notes', 'chat_sessions', 'flashcards', 'study_tasks'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------- new users get a profile
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)), 120))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles            enable row level security;
alter table public.subjects            enable row level security;
alter table public.exams               enable row level security;
alter table public.documents           enable row level security;
alter table public.source_files        enable row level security;
alter table public.ingestion_jobs      enable row level security;
alter table public.document_units      enable row level security;
alter table public.document_chunks     enable row level security;
alter table public.weeks               enable row level security;
alter table public.week_documents      enable row level security;
alter table public.units               enable row level security;
alter table public.topics              enable row level security;
alter table public.topic_prerequisites enable row level security;
alter table public.topic_sources       enable row level security;
alter table public.lessons             enable row level security;
alter table public.lesson_sections     enable row level security;
alter table public.notes               enable row level security;
alter table public.chat_sessions       enable row level security;
alter table public.chat_messages       enable row level security;
alter table public.quizzes             enable row level security;
alter table public.questions           enable row level security;
alter table public.attempts            enable row level security;
alter table public.flashcards          enable row level security;
alter table public.flashcard_reviews   enable row level security;
alter table public.topic_mastery       enable row level security;
alter table public.study_sessions      enable row level security;
alter table public.study_tasks         enable row level security;
alter table public.ai_usage_events     enable row level security;

-- profiles: own row only
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and (active_subject_id is null or public.owns_subject(active_subject_id)));

-- subjects: owner only
create policy subjects_all on public.subjects for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- source material: owner can read; the ingestion worker writes with the service role
create policy documents_select on public.documents for select to authenticated
  using (public.owns_subject(subject_id));
create policy source_files_select on public.source_files for select to authenticated
  using (public.owns_subject(subject_id));
create policy document_units_select on public.document_units for select to authenticated
  using (public.owns_subject(subject_id));
create policy document_chunks_select on public.document_chunks for select to authenticated
  using (public.owns_subject(subject_id));

-- reprocessing requests: owner can create and read their own subject's jobs
create policy ingestion_jobs_select on public.ingestion_jobs for select to authenticated
  using (public.owns_subject(subject_id));
create policy ingestion_jobs_insert on public.ingestion_jobs for insert to authenticated
  with check (
    public.owns_subject(subject_id)
    and requested_by = (select auth.uid())
    and status = 'pending'
    and attempts = 0
    and (document_id is null or exists (
      select 1 from public.documents d where d.id = document_id and d.subject_id = ingestion_jobs.subject_id))
  );

-- curriculum: owner can read, correct and confirm
create policy weeks_all on public.weeks for all to authenticated
  using (public.owns_subject(subject_id)) with check (public.owns_subject(subject_id));
create policy week_documents_all on public.week_documents for all to authenticated
  using (public.owns_subject(subject_id)) with check (public.owns_subject(subject_id));
create policy units_all on public.units for all to authenticated
  using (public.owns_subject(subject_id)) with check (public.owns_subject(subject_id));
create policy topics_all on public.topics for all to authenticated
  using (public.owns_subject(subject_id)) with check (public.owns_subject(subject_id));
create policy topic_prerequisites_all on public.topic_prerequisites for all to authenticated
  using (public.owns_subject(subject_id)) with check (public.owns_subject(subject_id));
create policy topic_sources_all on public.topic_sources for all to authenticated
  using (public.owns_subject(subject_id)) with check (public.owns_subject(subject_id));

-- learning state: the owning user only (and only inside subjects they own)
create policy exams_all on public.exams for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_subject(subject_id));
create policy lessons_all on public.lessons for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_subject(subject_id));
create policy lesson_sections_all on public.lesson_sections for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.lessons l where l.id = lesson_id and l.user_id = (select auth.uid())));
create policy notes_all on public.notes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_subject(subject_id));
create policy chat_sessions_all on public.chat_sessions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_subject(subject_id));
create policy chat_messages_all on public.chat_messages for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.chat_sessions s where s.id = session_id and s.user_id = (select auth.uid())));
create policy quizzes_all on public.quizzes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_subject(subject_id));
create policy questions_all on public.questions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.quizzes q where q.id = quiz_id and q.user_id = (select auth.uid())));
create policy attempts_all on public.attempts for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.questions q where q.id = question_id and q.quiz_id = attempts.quiz_id and q.user_id = (select auth.uid())));
create policy flashcards_all on public.flashcards for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_subject(subject_id));
create policy flashcard_reviews_all on public.flashcard_reviews for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.flashcards f where f.id = flashcard_id and f.user_id = (select auth.uid())));
create policy topic_mastery_all on public.topic_mastery for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_subject(subject_id));
create policy study_sessions_all on public.study_sessions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_subject(subject_id));
create policy study_tasks_all on public.study_tasks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_subject(subject_id));
create policy ai_usage_events_select on public.ai_usage_events for select to authenticated
  using (user_id = (select auth.uid()));
create policy ai_usage_events_insert on public.ai_usage_events for insert to authenticated
  with check (user_id = (select auth.uid()) and (subject_id is null or public.owns_subject(subject_id)));

-- ---------------------------------------------------------------- privileges
-- Nothing is reachable without signing in. RLS decides what signed-in users see.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

revoke execute on function public.owns_subject(uuid) from public, anon;
grant execute on function public.owns_subject(uuid) to authenticated, service_role;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
