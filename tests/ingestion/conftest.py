from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ingestion"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from synapse_ingest.config import Paths  # noqa: E402
from synthetic import build_course_archive  # noqa: E402


@pytest.fixture(scope="session")
def course_archive(tmp_path_factory: pytest.TempPathFactory) -> Path:
    # No .zip extension on purpose: archives are detected by signature.
    return build_course_archive(tmp_path_factory.mktemp("archive") / "Computer-fundamentals-and-networking-2026-Nov-20_13-12-51-555")


@pytest.fixture(scope="session")
def pipeline_run(course_archive: Path, tmp_path_factory: pytest.TempPathFactory) -> Paths:
    """Run the full pipeline once on the synthetic archive (shared by tests)."""
    from synapse_ingest.cli import run_pipeline_main

    data_dir = tmp_path_factory.mktemp("data")
    code = run_pipeline_main(["--archive", str(course_archive), "--data-dir", str(data_dir)])
    assert code == 0
    return Paths.resolve(data_dir)
