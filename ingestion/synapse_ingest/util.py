"""Small shared helpers: hashing, atomic JSON IO, text normalisation, IDs."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import tempfile
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

LOG = logging.getLogger("synapse_ingest")

# Stable namespace for deterministic IDs (uuid5). Never change it: database
# upserts and source references rely on IDs being reproducible across runs.
SYNAPSE_NAMESPACE = uuid.UUID("6f1c2a7e-3b0d-5e8f-9a41-2c7d8e5b9f10")


def setup_logging(verbose: bool = False) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sha256_file(path: Path, chunk_size: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            block = handle.read(chunk_size)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def stable_id(*parts: str) -> str:
    """Deterministic UUID derived from the given parts."""
    return str(uuid.uuid5(SYNAPSE_NAMESPACE, "\x1f".join(parts)))


def write_json_atomic(path: Path, payload: Any) -> None:
    """Write JSON via a temp file + rename so readers never see partial files."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=False)
            handle.write("\n")
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def write_jsonl_atomic(path: Path, rows: Iterable[dict]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    count = 0
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False))
                handle.write("\n")
                count += 1
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return count


def write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def read_json(path: Path) -> Any:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def read_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


_WS_RE = re.compile(r"[ \t\r\f\v  -​  　]+")
_MULTI_NL_RE = re.compile(r"\n{3,}")


def normalize_whitespace(text: str) -> str:
    """Collapse runs of spaces, keep paragraph breaks, strip edges."""
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text)
    lines = [_WS_RE.sub(" ", line).strip() for line in text.splitlines()]
    return _MULTI_NL_RE.sub("\n\n", "\n".join(lines)).strip()


def single_line(text: str) -> str:
    return _WS_RE.sub(" ", (text or "").replace("\n", " ")).strip()


def slugify(text: str, max_length: int = 64) -> str:
    value = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value[:max_length].strip("-") or "subject"


def word_count(text: str) -> int:
    return len(text.split()) if text else 0


def estimate_tokens(text: str) -> int:
    """Rough, provider-independent token estimate (≈ 4 chars/token)."""
    return max(1, round(len(text) / 4)) if text else 0


def human_bytes(size: int) -> str:
    value = float(size)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{size} B"
