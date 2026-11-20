"""Generate SYNTHETIC processed data for end-to-end tests (never real course content)."""

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ingestion"))
sys.path.insert(0, str(ROOT / "tests" / "ingestion"))

from synapse_ingest.cli import run_pipeline_main  # noqa: E402
from synthetic import build_course_archive  # noqa: E402

target = ROOT / "tests" / "e2e" / ".fixture-data"
with tempfile.TemporaryDirectory() as tmp:
    archive = build_course_archive(Path(tmp) / "Computer-fundamentals-and-networking-2026-Nov-20_13-12-51-555")
    sys.exit(run_pipeline_main(["--archive", str(archive), "--data-dir", str(target)]))
