#!/usr/bin/env python3
"""Stage C — slide-aware PowerPoint extraction.

Run from the project root, e.g.:  .venv/bin/python scripts/extract_presentations.py --help
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ingestion"))

from synapse_ingest.cli import extract_presentations_main  # noqa: E402

if __name__ == "__main__":
    sys.exit(extract_presentations_main())
