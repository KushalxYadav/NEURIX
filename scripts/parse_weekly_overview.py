#!/usr/bin/env python3
"""Stage B — parse the Weekly Overview (index.html).

Run from the project root, e.g.:  .venv/bin/python scripts/parse_weekly_overview.py --help
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ingestion"))

from synapse_ingest.cli import parse_overview_main  # noqa: E402

if __name__ == "__main__":
    sys.exit(parse_overview_main())
