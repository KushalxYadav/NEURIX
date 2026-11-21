#!/usr/bin/env python3
"""Stage A — inspect and safely extract the subject archive.

Run from the project root, e.g.:  .venv/bin/python scripts/inspect_archive.py --help
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ingestion"))

from synapse_ingest.cli import inspect_archive_main  # noqa: E402

if __name__ == "__main__":
    sys.exit(inspect_archive_main())
