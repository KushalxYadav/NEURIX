-- =============================================================================
-- Full-text retrieval over source chunks (works without any embedding provider)
--
-- Natural-language questions ("explain the OSI model from zero") rarely match
-- with AND semantics, so the query is turned into an OR of its stemmed,
-- stop-word-free lexemes; ts_rank_cd still rewards chunks that match more
-- terms and closer together. SECURITY INVOKER: RLS on document_chunks applies,
-- so a user can only ever retrieve chunks from subjects they own.
-- =============================================================================

create or replace function public.build_search_query(p_query text) returns tsquery
language sql immutable parallel safe set search_path = '' as $$
  select case
    when count(*) = 0 then null
    else to_tsquery('simple'::regconfig, string_agg(quote_literal(lexeme) || ':*', ' | ' order by lexeme))
  end
  from (
    select distinct t.lexeme
    from unnest(to_tsvector('english'::regconfig, coalesce(p_query, ''))) as t
    where char_length(t.lexeme) > 1
  ) as terms;
$$;

create or replace function public.search_document_chunks(
  p_subject_id   uuid,
  p_query        text,
  p_limit        integer default 8,
  p_document_ids uuid[] default null,
  p_week_ordinal integer default null,
  p_unit_types   public.unit_type[] default null
)
returns table (
  id                uuid,
  document_id       uuid,
  chunk_index       integer,
  content           text,
  citation          text,
  heading           text,
  unit_type         public.unit_type,
  slide_number      integer,
  page_number       integer,
  page_label        text,
  chapter_title     text,
  week_ordinals     integer[],
  original_filename text,
  document_type     public.document_type,
  rank              real
)
language sql stable security invoker set search_path = '' as $$
  with q as (select public.build_search_query(p_query) as query)
  select
    c.id, c.document_id, c.chunk_index, c.content, c.citation, c.heading, c.unit_type,
    c.slide_number, c.page_number, c.page_label, c.chapter_title, c.week_ordinals,
    d.original_filename, d.document_type,
    (ts_rank_cd(c.search_vector, q.query, 32) * case when c.low_information then 0.3 else 1.0 end)::real as rank
  from q
  join public.document_chunks c on c.search_vector @@ q.query
  join public.documents d on d.id = c.document_id
  where q.query is not null
    and c.subject_id = p_subject_id
    and (p_document_ids is null or c.document_id = any (p_document_ids))
    and (p_week_ordinal is null or p_week_ordinal = any (c.week_ordinals))
    and (p_unit_types is null or c.unit_type = any (p_unit_types))
  order by rank desc, c.document_id, c.chunk_index
  limit least(greatest(coalesce(p_limit, 8), 1), 50);
$$;

revoke execute on function public.search_document_chunks(uuid, text, integer, uuid[], integer, public.unit_type[]) from public, anon;
grant execute on function public.search_document_chunks(uuid, text, integer, uuid[], integer, public.unit_type[]) to authenticated, service_role;
grant execute on function public.build_search_query(text) to authenticated, service_role;
