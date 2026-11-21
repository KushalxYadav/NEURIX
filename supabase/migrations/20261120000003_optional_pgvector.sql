-- =============================================================================
-- OPTIONAL vector layer (pgvector) for hybrid retrieval.
--
-- Claude is the generation provider; it does not produce embeddings. Vectors
-- come from a separate, provider-independent embeddings service (e.g. Voyage
-- AI, 1024 dimensions). If pgvector is not available this migration only logs
-- a notice and SYNAPSE keeps using full-text search.
--
-- Changing to a model with a different dimension requires a new migration
-- that alters chunk_embeddings.embedding and rebuilds the index.
-- =============================================================================

do $migration$
begin
  if not exists (select 1 from pg_available_extensions where name = 'vector') then
    raise notice 'pgvector is not available: vector search disabled, full-text search remains active.';
    return;
  end if;

  create schema if not exists extensions;
  create extension if not exists vector with schema extensions;

  execute $sql$
    create table if not exists public.chunk_embeddings (
      chunk_id     uuid primary key,
      subject_id   uuid not null references public.subjects (id) on delete cascade,
      provider     text not null,
      model        text not null,
      dimensions   integer not null check (dimensions = 1024),
      embedding    extensions.vector(1024) not null,
      content_hash text not null,
      created_at   timestamptz not null default now(),
      foreign key (chunk_id) references public.document_chunks (id) on delete cascade
    )
  $sql$;
  execute 'create index if not exists chunk_embeddings_subject_idx on public.chunk_embeddings (subject_id)';
  execute 'create index if not exists chunk_embeddings_hnsw_idx on public.chunk_embeddings
           using hnsw (embedding extensions.vector_cosine_ops)';
  execute 'alter table public.chunk_embeddings enable row level security';
  execute 'drop policy if exists chunk_embeddings_select on public.chunk_embeddings';
  execute 'create policy chunk_embeddings_select on public.chunk_embeddings for select to authenticated
           using (public.owns_subject(subject_id))';
  execute 'revoke all on public.chunk_embeddings from anon';
  execute 'grant select on public.chunk_embeddings to authenticated';
  execute 'grant all on public.chunk_embeddings to service_role';

  -- Hybrid retrieval: reciprocal-rank fusion of full-text and vector results.
  execute $sql$
    create or replace function public.search_document_chunks_hybrid(
      p_subject_id      uuid,
      p_query           text,
      p_query_embedding extensions.vector(1024),
      p_limit           integer default 8,
      p_document_ids    uuid[] default null,
      p_week_ordinal    integer default null
    )
    returns table (
      id uuid, document_id uuid, chunk_index integer, content text, citation text, heading text,
      unit_type public.unit_type, slide_number integer, page_number integer, page_label text,
      chapter_title text, week_ordinals integer[], original_filename text,
      document_type public.document_type, fts_rank integer, vector_rank integer, score double precision
    )
    language sql stable security invoker set search_path = public, extensions as $fn$
      with fts as (
        select s.id, row_number() over (order by s.rank desc)::integer as r
        from public.search_document_chunks(p_subject_id, p_query, 40, p_document_ids, p_week_ordinal) s
      ),
      vec as (
        select e.chunk_id as id, row_number() over (order by e.embedding <=> p_query_embedding)::integer as r
        from public.chunk_embeddings e
        join public.document_chunks c on c.id = e.chunk_id
        where e.subject_id = p_subject_id
          and (p_document_ids is null or c.document_id = any (p_document_ids))
          and (p_week_ordinal is null or p_week_ordinal = any (c.week_ordinals))
        order by e.embedding <=> p_query_embedding
        limit 40
      ),
      fused as (
        select coalesce(f.id, v.id) as id, f.r as fr, v.r as vr,
               coalesce(1.0 / (60 + f.r), 0) + coalesce(1.0 / (60 + v.r), 0) as score
        from fts f full outer join vec v on f.id = v.id
      )
      select c.id, c.document_id, c.chunk_index, c.content, c.citation, c.heading, c.unit_type,
             c.slide_number, c.page_number, c.page_label, c.chapter_title, c.week_ordinals,
             d.original_filename, d.document_type, fused.fr, fused.vr, fused.score
      from fused
      join public.document_chunks c on c.id = fused.id
      join public.documents d on d.id = c.document_id
      order by fused.score desc, c.document_id, c.chunk_index
      limit least(greatest(coalesce(p_limit, 8), 1), 50)
    $fn$
  $sql$;
  execute 'revoke execute on function public.search_document_chunks_hybrid(uuid, text, extensions.vector, integer, uuid[], integer) from public, anon';
  execute 'grant execute on function public.search_document_chunks_hybrid(uuid, text, extensions.vector, integer, uuid[], integer) to authenticated, service_role';
end;
$migration$;
