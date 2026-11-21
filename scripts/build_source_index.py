#!/usr/bin/env python3
"""Stage E — unified source index, content units and RAG chunks.

Run from the project root, e.g.:  .venv/bin/python scripts/build_source_index.py --help
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ingestion"))

from synapse_ingest.cli import build_index_main  # noqa: E402

if __name__ == "__main__":
    sys.exit(build_index_main())
