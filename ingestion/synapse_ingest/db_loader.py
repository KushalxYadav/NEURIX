"""Load the processed source index into Supabase / PostgreSQL.

Runs with a privileged connection (the ingestion worker role), inside a
single transaction: either the whole subject is updated or nothing changes.

IDs are deterministic per owner (uuid5 of owner + local ID), so re-loading
the same archive updates rows in place, keeps URLs stable and preserves
dependent rows (e.g. embeddings); rows that disappeared are deleted.
"""

from __future__ import annotations

import logging
from typing import Any

from .config import Paths
from .util import read_json, read_jsonl, stable_id, utc_now_iso

LOG = logging.getLogger("synapse_ingest.db")

STATUS_MAP = {"completed", "partially_processed", "failed", "pending", "processing", "skipped"}


def _db_id(owner_id: str, local_id: str) -> str:
    return stable_id("db", owner_id, local_id)


def _subject_status(index: dict[str, Any]) -> str:
    statuses = {d["processing_status"] for d in index["documents"]}
    if not statuses:
        return "failed"
    if statuses <= {"completed"}:
        return "completed"
    if statuses <= {"failed"}:
        return "failed"
    return "partially_processed"


def load_into_database(
    paths: Paths,
    database_url: str,
    *,
    owner_id: str | None = None,
    owner_email: str | None = None,
) -> dict[str, int]:
    import psycopg
    from psycopg.types.json import Jsonb

    index = read_json(paths.source_index)
    units = read_jsonl(paths.content_units)
    chunks = read_jsonl(paths.chunks)
    subject_info = index["subject"]

    with psycopg.connect(database_url, autocommit=False) as conn:
        with conn.cursor() as cur:
            if owner_email:
                cur.execute("select id from auth.users where lower(email) = lower(%s)", (owner_email,))
                row = cur.fetchone()
                if not row:
                    raise LookupError(f"No auth.users account with email {owner_email!r}; sign up in the app first.")
                owner_id = str(row[0])
            else:
                cur.execute("select id from auth.users where id = %s", (owner_id,))
                if not cur.fetchone():
                    raise LookupError(f"No auth.users account with id {owner_id!r}.")
            assert owner_id
            ident = lambda local: _db_id(owner_id, local)  # noqa: E731

            subject_id = ident(f"subject:{subject_info['key']}")
            overview_meta = index["weekly_overview"]
            cur.execute(
                """
                insert into public.subjects as s
                  (id, owner_id, slug, name, name_source, source_archive_filename, source_archive_sha256,
                   ingestion_status, ingested_at, overview_meta, coverage, stats)
                values (%s, %s, %s, %s, %s, %s, %s, %s, now(), %s, %s, %s)
                on conflict (owner_id, slug) do update set
                  name = excluded.name, name_source = excluded.name_source,
                  source_archive_filename = excluded.source_archive_filename,
                  source_archive_sha256 = excluded.source_archive_sha256,
                  ingestion_status = excluded.ingestion_status, ingested_at = now(),
                  overview_meta = excluded.overview_meta, coverage = excluded.coverage, stats = excluded.stats
                returning id
                """,
                (
                    subject_id,
                    owner_id,
                    subject_info["key"],
                    subject_info["name"],
                    subject_info["name_source"],
                    subject_info["archive_filename"],
                    subject_info["archive_sha256"],
                    _subject_status(index),
                    Jsonb({**overview_meta, "textbook": index["textbook"], "generated_at": index["generated_at"]}),
                    Jsonb(index["coverage"]),
                    Jsonb(index["stats"]),
                ),
            )
            subject_id = str(cur.fetchone()[0])

            # -------------------------------------------------- documents
            doc_ids: dict[str, str] = {}
            overview_doc_id = None
            for document in index["documents"]:
                db_doc = ident(document["id"])
                doc_ids[document["id"]] = db_doc
                if document["document_type"] == "weekly_overview":
                    overview_doc_id = db_doc
                status = document["processing_status"] if document["processing_status"] in STATUS_MAP else "pending"
                cur.execute(
                    """
                    insert into public.documents
                      (id, subject_id, source_sha256, original_filename, source_path, archive_paths, document_type,
                       format, size_bytes, title, title_source, page_count, slide_count, word_count, unit_count,
                       chunk_count, chapters, quality, processing_status, errors, warnings, converted_from,
                       extractor_version, processed_at)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict (id) do update set
                      original_filename = excluded.original_filename, source_path = excluded.source_path,
                      archive_paths = excluded.archive_paths, document_type = excluded.document_type,
                      format = excluded.format, size_bytes = excluded.size_bytes, title = excluded.title,
                      title_source = excluded.title_source, page_count = excluded.page_count,
                      slide_count = excluded.slide_count, word_count = excluded.word_count,
                      unit_count = excluded.unit_count, chunk_count = excluded.chunk_count,
                      chapters = excluded.chapters, quality = excluded.quality,
                      processing_status = excluded.processing_status, errors = excluded.errors,
                      warnings = excluded.warnings, converted_from = excluded.converted_from,
                      extractor_version = excluded.extractor_version, processed_at = excluded.processed_at
                    """,
                    (
                        db_doc,
                        subject_id,
                        document["doc_key"],
                        document["original_filename"],
                        document["source_path"],
                        document["archive_paths"],
                        document["document_type"],
                        document["format"],
                        document["size_bytes"],
                        document["title"],
                        document["title_source"],
                        document["page_count"],
                        document["slide_count"],
                        document["word_count"],
                        document.get("unit_count", 0),
                        document.get("chunk_count", 0),
                        Jsonb(document["chapters"]),
                        Jsonb(document["quality"]) if document["quality"] is not None else None,
                        status,
                        document["errors"],
                        document["warnings"],
                        document["converted_from"],
                        document["extractor_version"],
                        document["processed_at"],
                    ),
                )
            cur.execute(
                "delete from public.documents where subject_id = %s and not (id = any(%s::uuid[]))",
                (subject_id, list(doc_ids.values())),
            )

            # -------------------------------------------------- all files
            cur.execute("delete from public.source_files where subject_id = %s", (subject_id,))
            cur.executemany(
                """
                insert into public.source_files
                  (subject_id, document_id, path, filename, category, extension, size_bytes, sha256,
                   processing_status, reason)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                [
                    (
                        subject_id,
                        doc_ids.get(f["document_id"]) if f["document_id"] else None,
                        f["path"],
                        f["filename"],
                        f["category"],
                        f["extension"],
                        f["size_bytes"],
                        f["sha256"],
                        f["processing_status"],
                        f["reason"],
                    )
                    for f in index["files"]
                ],
            )

            # -------------------------------------------------- units
            unit_ids: dict[str, str] = {}
            unit_rows = []
            for unit in units:
                db_unit = ident(unit["id"])
                unit_ids[unit["id"]] = db_unit
                unit_rows.append(
                    (
                        db_unit,
                        subject_id,
                        doc_ids[unit["document_id"]],
                        unit["unit_type"],
                        unit["unit_number"],
                        unit.get("slide_number"),
                        unit.get("page_number"),
                        unit.get("page_label"),
                        unit.get("detected_printed_page"),
                        unit.get("display_title") or unit.get("title"),
                        unit.get("heading_path") or [],
                        (unit.get("chapter") or {}).get("title"),
                        unit.get("week_ordinals") or [],
                        unit.get("text") or "",
                        unit.get("notes") or "",
                        Jsonb(unit.get("flags") or {}),
                        Jsonb(unit.get("annotations") or {}),
                        unit["citation"],
                        unit["content_hash"],
                        unit["word_count"],
                        unit["extraction_status"] if unit["extraction_status"] in STATUS_MAP else "completed",
                        unit.get("processed_at"),
                    )
                )
            cur.executemany(
                """
                insert into public.document_units
                  (id, subject_id, document_id, unit_type, unit_number, slide_number, page_number, page_label,
                   detected_printed_page, title, heading_path, chapter_title, week_ordinals, text, notes, flags,
                   annotations, citation, content_hash, word_count, extraction_status, processed_at)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (id) do update set
                  title = excluded.title, heading_path = excluded.heading_path,
                  chapter_title = excluded.chapter_title, week_ordinals = excluded.week_ordinals,
                  text = excluded.text, notes = excluded.notes, flags = excluded.flags,
                  annotations = excluded.annotations, citation = excluded.citation,
                  content_hash = excluded.content_hash, word_count = excluded.word_count,
                  extraction_status = excluded.extraction_status, processed_at = excluded.processed_at,
                  page_label = excluded.page_label, detected_printed_page = excluded.detected_printed_page
                """,
                unit_rows,
            )
            cur.execute(
                "delete from public.document_units where subject_id = %s and not (id = any(%s::uuid[]))",
                (subject_id, list(unit_ids.values())),
            )

            # -------------------------------------------------- chunks
            chunk_ids = []
            chunk_rows = []
            for chunk in chunks:
                db_chunk = ident(chunk["id"])
                chunk_ids.append(db_chunk)
                chunk_rows.append(
                    (
                        db_chunk,
                        subject_id,
                        doc_ids[chunk["document_id"]],
                        unit_ids.get(chunk["unit_id"]),
                        chunk["chunk_index"],
                        chunk["unit_type"],
                        chunk.get("slide_number"),
                        chunk.get("page_number"),
                        chunk.get("page_label"),
                        chunk.get("section_number"),
                        chunk.get("heading"),
                        chunk.get("heading_path") or [],
                        chunk.get("chapter_title"),
                        chunk.get("week_ordinals") or [],
                        chunk["content"],
                        chunk["content_hash"],
                        chunk["citation"],
                        chunk.get("word_count"),
                        chunk.get("token_estimate"),
                        chunk.get("low_information", False),
                    )
                )
            # chunk_index is unique per document; clear stale rows first so indexes can shift.
            cur.execute(
                "delete from public.document_chunks where subject_id = %s and not (id = any(%s::uuid[]))",
                (subject_id, chunk_ids),
            )
            cur.executemany(
                """
                insert into public.document_chunks
                  (id, subject_id, document_id, unit_id, chunk_index, unit_type, slide_number, page_number,
                   page_label, section_number, heading, heading_path, chapter_title, week_ordinals, content,
                   content_hash, citation, word_count, token_estimate, low_information)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (id) do update set
                  unit_id = excluded.unit_id, heading = excluded.heading, heading_path = excluded.heading_path,
                  chapter_title = excluded.chapter_title, week_ordinals = excluded.week_ordinals,
                  content = excluded.content, content_hash = excluded.content_hash, citation = excluded.citation,
                  word_count = excluded.word_count, token_estimate = excluded.token_estimate,
                  low_information = excluded.low_information, page_label = excluded.page_label
                """,
                chunk_rows,
            )

            # -------------------------------------------------- weeks
            week_ids: dict[str, str] = {}
            for week in index["weeks"]:
                db_week = ident(week["id"])
                week_ids[week["id"]] = db_week
                rng = week.get("date_range") or {}
                cur.execute(
                    """
                    insert into public.weeks
                      (id, subject_id, ordinal, week_number, week_number_source, label, label_kind, start_date,
                       end_date, date_raw, date_year_source, topics, learning_objectives, source_references, items,
                       resources, origin, source_document_id)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'source_confirmed',%s)
                    on conflict (id) do update set
                      week_number = excluded.week_number, week_number_source = excluded.week_number_source,
                      label = excluded.label, label_kind = excluded.label_kind, start_date = excluded.start_date,
                      end_date = excluded.end_date, date_raw = excluded.date_raw,
                      date_year_source = excluded.date_year_source, topics = excluded.topics,
                      learning_objectives = excluded.learning_objectives,
                      source_references = excluded.source_references, items = excluded.items,
                      resources = excluded.resources, source_document_id = excluded.source_document_id,
                      -- a changed label invalidates an earlier manual confirmation
                      verification_status = case when public.weeks.label = excluded.label
                                                 then public.weeks.verification_status else 'unverified' end
                    """,
                    (
                        db_week,
                        subject_id,
                        week["ordinal"],
                        week["week_number"],
                        week["week_number_source"],
                        week["label"],
                        week["label_kind"],
                        rng.get("start_date"),
                        rng.get("end_date"),
                        rng.get("raw"),
                        rng.get("year_source"),
                        Jsonb(week["topics"]),
                        Jsonb(week["learning_objectives"]),
                        Jsonb(week["references"]),
                        Jsonb(week["items"]),
                        Jsonb(
                            [
                                {**r, "document_id": doc_ids.get(r["document_id"]) if r.get("document_id") else None}
                                for r in week["resources"]
                            ]
                        ),
                        overview_doc_id,
                    ),
                )
            cur.execute(
                "delete from public.weeks where subject_id = %s and not (id = any(%s::uuid[]))",
                (subject_id, list(week_ids.values())),
            )

            cur.execute(
                "delete from public.week_documents where subject_id = %s and association_source in ('overview_link', 'filename_pattern')",
                (subject_id,),
            )
            links = []
            for document in index["documents"]:
                for association in document["week_associations"]:
                    links.append(
                        (
                            week_ids[association["week_id"]],
                            doc_ids[document["id"]],
                            subject_id,
                            association["source"],
                            "source_confirmed" if association["verification"] == "source_confirmed" else "unverified",
                            "confirmed" if association["verification"] == "source_confirmed" else "unverified",
                            association["evidence"],
                        )
                    )
            cur.executemany(
                """
                insert into public.week_documents
                  (week_id, document_id, subject_id, association_source, origin, verification_status, evidence)
                values (%s,%s,%s,%s,%s,%s,%s)
                on conflict do nothing
                """,
                links,
            )

            cur.execute(
                "update public.profiles set active_subject_id = %s where id = %s and active_subject_id is null",
                (subject_id, owner_id),
            )
        conn.commit()

    summary = {
        "documents": len(doc_ids),
        "units": len(unit_ids),
        "chunks": len(chunk_ids),
        "weeks": len(week_ids),
        "week_links": len(links),
    }
    LOG.info("Loaded subject %s for owner %s at %s: %s", subject_info["key"], owner_id, utc_now_iso(), summary)
    return {"subject_id": subject_id, **summary}  # type: ignore[dict-item]
