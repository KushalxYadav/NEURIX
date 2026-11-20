"""Paths, limits and archive discovery.

Every location is configurable (CLI flag > environment variable > default) so
the same code runs locally and, later, inside a cloud worker.
"""

from __future__ import annotations

import os
import zipfile
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

ENV_ARCHIVE = "SYNAPSE_ARCHIVE_PATH"
ENV_DATA_DIR = "SYNAPSE_DATA_DIR"
# Name the user gave the subject archive (extension optional).
KNOWN_ARCHIVE_PREFIXES = ("Computer-fundamentals-and-networking",)


@dataclass(frozen=True)
class Paths:
    root: Path
    data: Path

    @classmethod
    def resolve(cls, data_dir: str | os.PathLike | None = None, root: Path | None = None) -> "Paths":
        root = (root or PROJECT_ROOT).resolve()
        raw = data_dir or os.environ.get(ENV_DATA_DIR)
        data = Path(raw).resolve() if raw else root / "data"
        return cls(root=root, data=data)

    @property
    def extracted(self) -> Path:
        return self.data / "extracted"

    @property
    def processed(self) -> Path:
        return self.data / "processed"

    @property
    def reports(self) -> Path:
        return self.data / "reports"

    @property
    def presentations_dir(self) -> Path:
        return self.processed / "presentations"

    @property
    def documents_dir(self) -> Path:
        return self.processed / "documents"

    @property
    def inventory(self) -> Path:
        return self.processed / "file_inventory.json"

    @property
    def weekly_overview(self) -> Path:
        return self.processed / "weekly_overview.json"

    @property
    def source_index(self) -> Path:
        return self.processed / "source_index.json"

    @property
    def content_units(self) -> Path:
        return self.processed / "content_units.jsonl"

    @property
    def chunks(self) -> Path:
        return self.processed / "chunks.jsonl"

    @property
    def status(self) -> Path:
        return self.processed / "processing_status.json"

    def ensure(self) -> None:
        for path in (self.extracted, self.processed, self.reports, self.presentations_dir, self.documents_dir):
            path.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class SafetyLimits:
    """Guards against zip bombs and runaway extraction."""

    max_entries: int = 20_000
    max_total_uncompressed: int = 4 * 1024**3  # 4 GiB
    max_entry_uncompressed: int = 1 * 1024**3  # 1 GiB
    max_compression_ratio: float = 200.0  # only checked for entries > ratio_min_size
    ratio_min_size: int = 1 * 1024**2
    max_path_length: int = 512


class ArchiveNotFoundError(FileNotFoundError):
    """Raised with a precise explanation of every location that was checked."""


def _is_zip(path: Path) -> bool:
    try:
        return path.is_file() and zipfile.is_zipfile(path)
    except OSError:
        return False


def discover_archive(explicit: str | os.PathLike | None, paths: Paths) -> Path:
    """Locate the subject archive without guessing silently.

    Order: explicit argument, $SYNAPSE_ARCHIVE_PATH, a single ZIP in
    ``source-material/``, then a ZIP in the project root whose name matches a
    known archive prefix or ends in ``.zip``. ZIPs are recognised by their
    signature, so a missing ``.zip`` extension is fine.
    """
    checked: list[str] = []

    for label, raw in (("--archive", explicit), (f"${ENV_ARCHIVE}", os.environ.get(ENV_ARCHIVE))):
        if raw:
            candidate = Path(raw).expanduser().resolve()
            checked.append(f"{label}: {candidate}")
            if _is_zip(candidate):
                return candidate
            raise ArchiveNotFoundError(
                f"{label} points to {candidate}, which "
                + ("is not a valid ZIP archive." if candidate.exists() else "does not exist.")
            )

    source_dir = paths.root / "source-material"
    checked.append(f"{source_dir}/ (any ZIP)")
    if source_dir.is_dir():
        zips = sorted(p for p in source_dir.iterdir() if _is_zip(p))
        if len(zips) == 1:
            return zips[0].resolve()
        if len(zips) > 1:
            names = ", ".join(p.name for p in zips)
            raise ArchiveNotFoundError(
                f"Multiple ZIP archives found in {source_dir}: {names}. Pass --archive to choose one."
            )

    checked.append(f"{paths.root}/ (ZIP named {KNOWN_ARCHIVE_PREFIXES[0]}* or *.zip)")
    root_candidates = sorted(
        p
        for p in paths.root.iterdir()
        if p.is_file()
        and (p.name.startswith(KNOWN_ARCHIVE_PREFIXES) or p.suffix.lower() == ".zip")
        and _is_zip(p)
    )
    if len(root_candidates) == 1:
        return root_candidates[0].resolve()
    if len(root_candidates) > 1:
        names = ", ".join(p.name for p in root_candidates)
        raise ArchiveNotFoundError(f"Multiple archives in project root: {names}. Pass --archive.")

    raise ArchiveNotFoundError(
        "Subject archive not found. Checked:\n  - "
        + "\n  - ".join(checked)
        + "\nPlace the ZIP in source-material/ or pass --archive /path/to/archive."
    )
