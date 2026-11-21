#!/usr/bin/env python3
"""Run all ingestion stages (A–E) in order.

Run from the project root, e.g.:  .venv/bin/python scripts/run_pipeline.py --help
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ingestion"))

from synapse_ingest.cli import run_pipeline_main  # noqa: E402

if __name__ == "__main__":
    sys.exit(run_pipeline_main())
