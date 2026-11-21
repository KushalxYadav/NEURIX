"""Schema, Row Level Security, retrieval and loader tests on real PostgreSQL."""

from __future__ import annotations

import uuid
from pathlib import Path

import psycopg
import pytest
from conftest import as_user, create_user


def _subject(conn: psycopg.Connection, owner: str, slug: str = "networks") -> str:
    return str(
        conn.execute(
            "insert into public.subjects (owner_id, slug, name) values (%s, %s, %s) returning id",
            (owner, slug, slug.title()),
        ).fetchone()[0]
    )


def _document(conn: psycopg.Connection, subject: str, sha: str = "a" * 64) -> str:
    return str(
        conn.execute(
            """insert into public.documents (subject_id, source_sha256, original_filename, source_path, document_type)
               values (%s, %s, 'lecture.pptx', 'Week 1/lecture.pptx', 'presentation') returning id""",
            (subject, sha),
        ).fetchone()[0]
    )


def _chunk(conn: psycopg.Connection, subject: str, document: str, index: int, content: str, slide: int = 1) -> None:
    conn.execute(
        """insert into public.document_chunks
           (subject_id, document_id, chunk_index, unit_type, slide_number, content, content_hash, citation)
           values (%s, %s, %s, 'slide', %s, %s, md5(%s), %s)""",
        (subject, document, index, slide, content, content, f"lecture.pptx, slide {slide}"),
    )


def test_profile_created_for_new_user(conn: psycopg.Connection) -> None:
    user = create_user(conn, f"{uuid.uuid4()}@example.test")
    row = conn.execute("select display_name from public.profiles where id = %s", (user,)).fetchone()
    assert row is not None


def test_subject_content_is_private_to_owner(conn: psycopg.Connection) -> None:
    alice = create_user(conn, f"alice-{uuid.uuid4()}@example.test")
    bob = create_user(conn, f"bob-{uuid.uuid4()}@example.test")
    subject = _subject(conn, alice)
    document = _document(conn, subject)
    _chunk(conn, subject, document, 0, "The OSI model has seven layers.")

    with as_user(conn, alice):
        assert conn.execute("select count(*) from public.documents").fetchone()[0] == 1
        assert conn.execute("select count(*) from public.document_chunks").fetchone()[0] == 1
    with as_user(conn, bob):
        assert conn.execute("select count(*) from public.subjects").fetchone()[0] == 0
        assert conn.execute("select count(*) from public.documents").fetchone()[0] == 0
        assert conn.execute("select count(*) from public.document_chunks").fetchone()[0] == 0


def test_anonymous_users_have_no_access(conn: psycopg.Connection) -> None:
    with as_user(conn, None):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("select * from public.documents")
    conn.rollback()


def test_students_cannot_write_source_material(conn: psycopg.Connection) -> None:
    alice = create_user(conn, f"alice-{uuid.uuid4()}@example.test")
    subject = _subject(conn, alice)
    with as_user(conn, alice):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                """insert into public.documents (subject_id, source_sha256, original_filename, source_path, document_type)
                   values (%s, %s, 'x.pdf', 'x.pdf', 'textbook')""",
                (subject, "b" * 64),
            )
    conn.rollback()


def test_owner_can_correct_curriculum_but_not_in_foreign_subjects(conn: psycopg.Connection) -> None:
    alice = create_user(conn, f"alice-{uuid.uuid4()}@example.test")
    bob = create_user(conn, f"bob-{uuid.uuid4()}@example.test")
    alice_subject = _subject(conn, alice)
    bob_subject = _subject(conn, bob, "other")
    with as_user(conn, alice):
        conn.execute(
            "insert into public.weeks (subject_id, ordinal, label, label_kind) values (%s, 1, 'Week 1', 'week')",
            (alice_subject,),
        )
        conn.execute("update public.weeks set verification_status = 'confirmed' where subject_id = %s", (alice_subject,))
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "insert into public.weeks (subject_id, ordinal, label, label_kind) values (%s, 1, 'Week 1', 'week')",
                (bob_subject,),
            )
    conn.rollback()


def test_cross_subject_references_are_rejected(conn: psycopg.Connection) -> None:
    alice = create_user(conn, f"alice-{uuid.uuid4()}@example.test")
    first, second = _subject(conn, alice, "first"), _subject(conn, alice, "second")
    foreign_document = _document(conn, second)
    topic = conn.execute(
        "insert into public.topics (subject_id, title, origin) values (%s, 'OSI', 'source_confirmed') returning id",
        (first,),
    ).fetchone()[0]
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        conn.execute(
            """insert into public.topic_sources (topic_id, subject_id, document_id, association_source, origin)
               values (%s, %s, %s, 'manual', 'user_created')""",
            (topic, first, foreign_document),
        )
    conn.rollback()


def test_learning_state_is_per_user(conn: psycopg.Connection) -> None:
    alice = create_user(conn, f"alice-{uuid.uuid4()}@example.test")
    bob = create_user(conn, f"bob-{uuid.uuid4()}@example.test")
    subject = _subject(conn, alice)
    with as_user(conn, alice):
        conn.execute(
            "insert into public.notes (user_id, subject_id, title, content_md) values (%s, %s, 'Routing', 'Notes')",
            (alice, subject),
        )
        conn.execute(
            "insert into public.exams (user_id, subject_id, exam_date) values (%s, %s, '2026-12-10')", (alice, subject)
        )
    with as_user(conn, bob):
        assert conn.execute("select count(*) from public.notes").fetchone()[0] == 0
        assert conn.execute("select count(*) from public.exams").fetchone()[0] == 0
        # Bob cannot write a note into Alice's subject, even with his own user_id
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "insert into public.notes (user_id, subject_id, title) values (%s, %s, 'sneaky')", (bob, subject)
            )
    conn.rollback()


def test_reprocess_request_rules(conn: psycopg.Connection) -> None:
    alice = create_user(conn, f"alice-{uuid.uuid4()}@example.test")
    subject = _subject(conn, alice)
    document = _document(conn, subject)
    with as_user(conn, alice):
        conn.execute(
            "insert into public.ingestion_jobs (subject_id, document_id, requested_by, job_type) values (%s, %s, %s, 'reprocess_document')",
            (subject, document, alice),
        )
        with pytest.raises(psycopg.errors.InsufficientPrivilege):  # cannot mark its own job completed
            conn.execute(
                "insert into public.ingestion_jobs (subject_id, requested_by, job_type, status) values (%s, %s, 'full_ingestion', 'completed')",
                (subject, alice),
            )
    conn.rollback()


def test_fulltext_search_ranks_and_respects_rls(conn: psycopg.Connection) -> None:
    alice = create_user(conn, f"alice-{uuid.uuid4()}@example.test")
    bob = create_user(conn, f"bob-{uuid.uuid4()}@example.test")
    subject = _subject(conn, alice)
    document = _document(conn, subject)
    _chunk(conn, subject, document, 0, "The OSI reference model divides networking into seven layers.", 1)
    _chunk(conn, subject, document, 1, "IP addressing and subnetting split a network into smaller networks.", 2)
    _chunk(conn, subject, document, 2, "Agenda", 3)
    query = "select citation, rank from public.search_document_chunks(%s, %s)"
    with as_user(conn, alice):
        rows = conn.execute(query, (subject, "Explain the OSI model from zero")).fetchall()
        assert rows[0][0] == "lecture.pptx, slide 1"
        rows = conn.execute(query, (subject, "what is subnetting?")).fetchall()
        assert [r[0] for r in rows] == ["lecture.pptx, slide 2"]
        assert conn.execute(query, (subject, "the and of")).fetchall() == []  # only stop words
    with as_user(conn, bob):
        assert conn.execute(query, (subject, "OSI model")).fetchall() == []
    conn.rollback()


def test_hybrid_search_when_pgvector_is_available(conn: psycopg.Connection) -> None:
    has_vector = conn.execute("select to_regclass('public.chunk_embeddings') is not null").fetchone()[0]
    if not has_vector:
        pytest.skip("pgvector not installed; full-text search only")
    alice = create_user(conn, f"alice-{uuid.uuid4()}@example.test")
    subject = _subject(conn, alice)
    document = _document(conn, subject)
    _chunk(conn, subject, document, 0, "Routing tables decide the next hop.", 1)
    _chunk(conn, subject, document, 1, "Switches forward frames inside a LAN.", 2)
    chunks = conn.execute("select id, chunk_index from public.document_chunks where document_id = %s order by chunk_index", (document,)).fetchall()
    for chunk_id, index in chunks:
        vector = "[" + ",".join("1" if i == index else "0" for i in range(1024)) + "]"
        conn.execute(
            """insert into public.chunk_embeddings (chunk_id, subject_id, provider, model, dimensions, embedding, content_hash)
               values (%s, %s, 'test', 'test', 1024, %s::extensions.vector, 'h')""",
            (chunk_id, subject, vector),
        )
    query_vector = "[" + ",".join("1" if i == 1 else "0" for i in range(1024)) + "]"
    with as_user(conn, alice):
        rows = conn.execute(
            "select citation, fts_rank, vector_rank from public.search_document_chunks_hybrid(%s, %s, %s::extensions.vector)",
            (subject, "zzzz-nothing-matches", query_vector),
        ).fetchall()
        assert rows[0][0] == "lecture.pptx, slide 2"  # found by vector similarity alone
        assert rows[0][1] is None and rows[0][2] == 1
    conn.rollback()


def test_loader_imports_pipeline_output_idempotently(database_url: str, tmp_path: Path) -> None:
    from synapse_ingest.cli import run_pipeline_main
    from synapse_ingest.config import Paths
    from synapse_ingest.db_loader import load_into_database
    from synthetic import build_course_archive

    archive = build_course_archive(tmp_path / "course.zip")
    assert run_pipeline_main(["--archive", str(archive), "--data-dir", str(tmp_path / "data")]) == 0
    paths = Paths.resolve(tmp_path / "data")
    with psycopg.connect(database_url, autocommit=True) as admin:
        email = f"loader-{uuid.uuid4()}@example.test"
        owner = str(admin.execute("insert into auth.users (email) values (%s) returning id", (email,)).fetchone()[0])

    first = load_into_database(paths, database_url, owner_email=email)
    second = load_into_database(paths, database_url, owner_id=owner)
    assert first == second
    assert first["documents"] == 7 and first["weeks"] == 3

    with psycopg.connect(database_url) as conn:
        with as_user(conn, owner):
            counts = conn.execute(
                """select (select count(*) from public.documents), (select count(*) from public.document_chunks),
                          (select count(*) from public.weeks), (select count(*) from public.source_files),
                          (select count(*) from public.week_documents where verification_status = 'confirmed')"""
            ).fetchone()
            assert counts == (7, first["chunks"], 3, 11, 3)
            failed = conn.execute(
                "select processing_status, errors[1] from public.documents where original_filename = 'old_lecture.ppt'"
            ).fetchone()
            assert failed[0] == "failed" and "convert" in failed[1].lower()
            hit = conn.execute(
                "select citation from public.search_document_chunks(%s, 'fixture throughput window size', 3)",
                (first["subject_id"],),
            ).fetchone()
            assert hit[0].startswith(("Lecture01_intro.pptx, slide 4", "Fixture_Networking_Textbook.pdf"))
            active = conn.execute("select active_subject_id from public.profiles where id = %s", (owner,)).fetchone()[0]
            assert str(active) == first["subject_id"]
