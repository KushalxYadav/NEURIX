"""Spin up a throwaway PostgreSQL cluster, apply the Supabase stub + migrations.

Set SYNAPSE_TEST_DATABASE_URL to use an existing empty database instead
(e.g. `supabase start`). Tests are skipped when neither is available.
"""

from __future__ import annotations

import contextlib
import glob
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Iterator

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ingestion"))
sys.path.insert(0, str(ROOT / "tests" / "ingestion"))

psycopg = pytest.importorskip("psycopg")


def _pg_bin(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    candidates = sorted(glob.glob(f"/usr/lib/postgresql/*/bin/{name}"))
    return candidates[-1] if candidates else None


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _as_postgres(command: list[str]) -> list[str]:
    if os.geteuid() == 0:  # PostgreSQL refuses to run as root
        return ["runuser", "-u", "postgres", "--", *command]
    return command


# macOS: the postmaster aborts ("became multithreaded during startup") without a valid LC_ALL.
PG_ENV = {**os.environ, "LC_ALL": os.environ.get("LC_ALL") or "C"}


def apply_sql(url: str, path: Path) -> None:
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(path.read_text())


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    external = os.environ.get("SYNAPSE_TEST_DATABASE_URL")
    if external:
        yield external
        return
    initdb, pg_ctl = _pg_bin("initdb"), _pg_bin("pg_ctl")
    if not initdb or not pg_ctl:
        pytest.skip("PostgreSQL server binaries not available")
    workdir = Path(tempfile.mkdtemp(prefix="synapse-pg-"))
    data = workdir / "data"
    if os.geteuid() == 0:
        shutil.chown(workdir, "postgres", "postgres")
    port = _free_port()
    subprocess.run(_as_postgres([initdb, "-D", str(data), "-U", "postgres", "--auth=trust", "-E", "UTF8"]), check=True, capture_output=True, env=PG_ENV)
    subprocess.run(
        _as_postgres([pg_ctl, "-D", str(data), "-l", str(workdir / "log"), "-w", "-o", f"-p {port} -k {workdir} -c listen_addresses=127.0.0.1", "start"]),
        check=True,
        capture_output=True,
        env=PG_ENV,
    )
    admin = f"postgresql://postgres@127.0.0.1:{port}/postgres"
    for _ in range(50):
        try:
            with psycopg.connect(admin, autocommit=True) as conn:
                conn.execute("create database synapse_test")
            break
        except psycopg.OperationalError:
            time.sleep(0.1)
    url = f"postgresql://postgres@127.0.0.1:{port}/synapse_test"
    try:
        apply_sql(url, ROOT / "tests" / "db" / "supabase_stub.sql")
        for migration in sorted((ROOT / "supabase" / "migrations").glob("*.sql")):
            apply_sql(url, migration)
        yield url
    finally:
        subprocess.run(_as_postgres([pg_ctl, "-D", str(data), "-m", "immediate", "stop"]), capture_output=True, env=PG_ENV)
        shutil.rmtree(workdir, ignore_errors=True)


@pytest.fixture
def conn(database_url: str) -> Iterator["psycopg.Connection"]:
    with psycopg.connect(database_url) as connection:
        yield connection
        connection.rollback()


def create_user(conn: "psycopg.Connection", email: str) -> str:
    row = conn.execute("insert into auth.users (email) values (%s) returning id", (email,)).fetchone()
    return str(row[0])


@contextlib.contextmanager
def as_user(conn: "psycopg.Connection", user_id: str | None) -> Iterator["psycopg.Connection"]:
    """Run statements as an authenticated (or anonymous) API user with RLS."""
    claims = json.dumps({"sub": user_id, "role": "authenticated"}) if user_id else ""
    conn.execute("select set_config('request.jwt.claims', %s, false)", (claims,))
    conn.execute("set role " + ("authenticated" if user_id else "anon"))
    try:
        yield conn
    finally:
        if conn.info.transaction_status == psycopg.pq.TransactionStatus.INERROR:
            conn.rollback()  # an expected error aborted the transaction; rollback also reverts the role
        else:
            conn.execute("reset role")
            conn.execute("select set_config('request.jwt.claims', '', false)")
