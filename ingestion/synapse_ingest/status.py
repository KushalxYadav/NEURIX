"""Per-document, per-stage processing status with resumability.

The tracker is persisted after every state change, so an interrupted run
leaves documents in ``processing`` and the next run re-processes exactly
those (plus anything whose content hash or extractor version changed).
"""

from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import Any

from . import EXTRACTOR_VERSION, SCHEMA_VERSION
from .util import read_json, utc_now_iso, write_json_atomic


class Status(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    PARTIAL = "partially_processed"
    FAILED = "failed"
    SKIPPED = "skipped"  # intentionally not processed (e.g. images), always with a reason


FINAL_OK = {Status.COMPLETED.value, Status.PARTIAL.value}


class StatusTracker:
    def __init__(self, path: Path):
        self.path = path
        if path.exists():
            self.data: dict[str, Any] = read_json(path)
        else:
            self.data = {"schema_version": SCHEMA_VERSION, "updated_at": None, "documents": {}}

    # -- queries -----------------------------------------------------------
    def entry(self, doc_key: str) -> dict[str, Any]:
        return self.data["documents"].setdefault(doc_key, {"stages": {}})

    def stage(self, doc_key: str, stage: str) -> dict[str, Any] | None:
        return self.data["documents"].get(doc_key, {}).get("stages", {}).get(stage)

    def is_up_to_date(self, doc_key: str, stage: str, sha256: str, output: Path | None = None) -> bool:
        record = self.stage(doc_key, stage)
        if not record or record.get("status") not in FINAL_OK:
            return False
        if record.get("sha256") != sha256 or record.get("extractor_version") != EXTRACTOR_VERSION:
            return False
        return output is None or output.exists()

    # -- transitions -------------------------------------------------------
    def register(self, doc_key: str, *, source_paths: list[str], sha256: str, category: str) -> None:
        entry = self.entry(doc_key)
        entry.update({"source_paths": source_paths, "sha256": sha256, "category": category})
        self.save()

    def start(self, doc_key: str, stage: str, sha256: str) -> None:
        record = self.entry(doc_key)["stages"].setdefault(stage, {"attempts": 0})
        record.update(
            {
                "status": Status.PROCESSING.value,
                "sha256": sha256,
                "extractor_version": EXTRACTOR_VERSION,
                "started_at": utc_now_iso(),
                "finished_at": None,
                "error": None,
            }
        )
        record["attempts"] = int(record.get("attempts", 0)) + 1
        self.save()

    def finish(
        self,
        doc_key: str,
        stage: str,
        status: Status,
        *,
        output: str | None = None,
        warnings: list[str] | None = None,
        error: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        record = self.entry(doc_key)["stages"].setdefault(stage, {"attempts": 0})
        record.update(
            {
                "status": status.value,
                "finished_at": utc_now_iso(),
                "output": output,
                "warnings": warnings or [],
                "error": error,
                "details": details or {},
                "extractor_version": record.get("extractor_version", EXTRACTOR_VERSION),
            }
        )
        self.save()

    def skip(self, doc_key: str, stage: str, reason: str) -> None:
        self.entry(doc_key)["stages"][stage] = {
            "status": Status.SKIPPED.value,
            "reason": reason,
            "finished_at": utc_now_iso(),
        }
        self.save()

    def save(self) -> None:
        self.data["updated_at"] = utc_now_iso()
        write_json_atomic(self.path, self.data)

    # -- summaries ---------------------------------------------------------
    def overall_status(self, doc_key: str) -> str:
        stages = self.data["documents"].get(doc_key, {}).get("stages", {})
        if not stages:
            return Status.PENDING.value
        values = {record.get("status") for record in stages.values()}
        for status in (Status.FAILED, Status.PROCESSING, Status.PARTIAL, Status.PENDING):
            if status.value in values:
                return status.value
        if values == {Status.SKIPPED.value}:
            return Status.SKIPPED.value
        return Status.COMPLETED.value
