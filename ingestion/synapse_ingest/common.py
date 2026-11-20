"""Helpers shared by the extraction stages."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, TypeVar

from .config import Paths
from .status import Status, StatusTracker

LOG = logging.getLogger("synapse_ingest")
T = TypeVar("T")


@dataclass
class SourceDocument:
    """One unique document (identical files under several paths are merged)."""

    doc_key: str  # SHA-256 of the file content
    primary_path: str
    paths: list[str]
    filename: str
    extension: str
    category: str
    document_role: str | None
    extracted_path: Path
    size_bytes: int

    @property
    def short_key(self) -> str:
        return self.doc_key[:16]


def unique_documents(inventory: dict[str, Any], paths: Paths, categories: set[str]) -> list[SourceDocument]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for entry in inventory["entries"]:
        if entry["status"] != "extracted" or not entry.get("sha256") or entry["category"] not in categories:
            continue
        groups.setdefault(entry["sha256"], []).append(entry)
    documents = []
    for sha, entries in groups.items():
        primary = next((e for e in entries if not e.get("duplicate_of")), entries[0])
        documents.append(
            SourceDocument(
                doc_key=sha,
                primary_path=primary["path"],
                paths=sorted(e["path"] for e in entries),
                filename=primary["filename"],
                extension=primary["extension"],
                category=primary["category"],
                document_role=primary.get("document_role"),
                extracted_path=paths.data / primary["extracted_path"],
                size_bytes=primary["size_bytes"],
            )
        )
    return sorted(documents, key=lambda d: d.primary_path)


def with_retries(func: Callable[[], T], retries: int, label: str) -> T:
    """Retry transient failures (I/O, external converters) with backoff."""
    attempt = 0
    while True:
        attempt += 1
        try:
            return func()
        except (OSError, TimeoutError) as exc:
            if attempt > retries:
                raise
            delay = min(8.0, 0.5 * 2 ** (attempt - 1))
            LOG.warning("%s: attempt %d failed (%s); retrying in %.1fs", label, attempt, exc, delay)
            time.sleep(delay)


def run_document_stage(
    *,
    stage: str,
    documents: list[SourceDocument],
    tracker: StatusTracker,
    output_dir: Path,
    extract: Callable[[SourceDocument], dict[str, Any]],
    force: bool,
    retries: int,
    only: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Run ``extract`` for each document with status tracking and resumability.

    ``only`` limits the run to documents with one of the given archive paths and
    forces their re-extraction (per-document reprocessing).
    """
    summaries: list[dict[str, Any]] = []
    if only:
        documents = [d for d in documents if only.intersection(d.paths)]
        force = True
    for document in documents:
        output = output_dir / f"{document.short_key}.json"
        tracker.register(
            document.doc_key, source_paths=document.paths, sha256=document.doc_key, category=document.category
        )
        if not force and tracker.is_up_to_date(document.doc_key, stage, document.doc_key, output):
            LOG.info("[%s] %s — up to date, skipped", stage, document.primary_path)
            record = tracker.stage(document.doc_key, stage) or {}
            summaries.append({"path": document.primary_path, "status": record.get("status"), "cached": True})
            continue
        LOG.info("[%s] %s", stage, document.primary_path)
        tracker.start(document.doc_key, stage, document.doc_key)
        try:
            result = with_retries(lambda: extract(document), retries, document.primary_path)
        except Exception as exc:  # every failure is recorded, never silently dropped
            LOG.error("[%s] %s failed: %s", stage, document.primary_path, exc)
            tracker.finish(document.doc_key, stage, Status.FAILED, error=f"{type(exc).__name__}: {exc}")
            summaries.append({"path": document.primary_path, "status": Status.FAILED.value, "error": str(exc)})
            continue
        status = Status(result.get("status", Status.COMPLETED.value))
        from .util import write_json_atomic  # local import keeps module import light

        write_json_atomic(output, result)
        tracker.finish(
            document.doc_key,
            stage,
            status,
            output=str(output.relative_to(output_dir.parent.parent)),
            warnings=result.get("warnings", []),
            details=result.get("status_details", {}),
        )
        summaries.append({"path": document.primary_path, "status": status.value, "cached": False})
    return summaries
