#!/usr/bin/env python3
"""Load processed sources into Supabase / PostgreSQL.

Run from the project root, e.g.:  .venv/bin/python scripts/load_to_database.py --help
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ingestion"))

from synapse_ingest.cli import load_database_main  # noqa: E402

if __name__ == "__main__":
    sys.exit(load_database_main())
