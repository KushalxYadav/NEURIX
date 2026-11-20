"""Source-aware chunking for retrieval.

Rules:
- A chunk never crosses a slide or page boundary, so every chunk cites one
  exact slide or page.
- Paragraphs are packed greedily up to ``max_words``; a paragraph is only split
  (by sentence) when it alone exceeds ``hard_max_words``.
- "Lead-in" paragraphs (headings, ``Definition:``, lines ending in ``:``,
  formulas) are never left dangling at the end of a chunk; they move to the
  next chunk with the text they introduce.
- A trailing fragment smaller than ``min_words`` is merged into the previous
  chunk when the result stays within ``hard_max_words``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .annotate import is_formula_line, sentences
from .util import word_count


@dataclass(frozen=True)
class ChunkConfig:
    target_words: int = 220
    max_words: int = 360
    min_words: int = 40
    hard_max_words: int = 560


DEFAULT_CONFIG = ChunkConfig()
LEAD_IN_RE = re.compile(r"^(definition|example|formula|theorem|note|key point|important)s?\b", re.I)


def is_lead_in(paragraph: str) -> bool:
    words = word_count(paragraph)
    stripped = paragraph.strip()
    if not stripped:
        return False
    if words <= 25 and (stripped.endswith(":") or LEAD_IN_RE.match(stripped)):
        return True
    if words <= 10 and not re.search(r"[.!?]$", stripped):
        return True  # heading-like
    lines = [line for line in stripped.splitlines() if line.strip()]
    return bool(lines) and words <= 40 and all(is_formula_line(line) for line in lines)


def split_paragraphs(text: str, config: ChunkConfig = DEFAULT_CONFIG) -> list[str]:
    paragraphs: list[str] = []
    for paragraph in re.split(r"\n\s*\n", text or ""):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if word_count(paragraph) <= config.hard_max_words:
            paragraphs.append(paragraph)
            continue
        buffer: list[str] = []
        for sentence in sentences(paragraph) or [paragraph]:
            if buffer and word_count(" ".join(buffer + [sentence])) > config.max_words:
                paragraphs.append(" ".join(buffer))
                buffer = []
            if word_count(sentence) > config.hard_max_words:  # pathological: no sentence breaks
                words = sentence.split()
                for start in range(0, len(words), config.max_words):
                    paragraphs.append(" ".join(words[start : start + config.max_words]))
                continue
            buffer.append(sentence)
        if buffer:
            paragraphs.append(" ".join(buffer))
    return paragraphs


def chunk_text(text: str, config: ChunkConfig = DEFAULT_CONFIG) -> list[str]:
    paragraphs = split_paragraphs(text, config)
    chunks: list[str] = []
    buffer: list[str] = []
    buffer_words = 0

    def flush() -> None:
        nonlocal buffer, buffer_words
        if buffer:
            chunks.append("\n\n".join(buffer))
        buffer, buffer_words = [], 0

    for paragraph in paragraphs:
        words = word_count(paragraph)
        if buffer and buffer_words + words > config.max_words and buffer_words >= config.min_words:
            carry = []
            while len(buffer) > 1 and is_lead_in(buffer[-1]):
                carry.insert(0, buffer.pop())
            flush()
            buffer, buffer_words = carry, sum(word_count(p) for p in carry)
        buffer.append(paragraph)
        buffer_words += words
        if buffer_words >= config.target_words and not is_lead_in(paragraph):
            flush()
    flush()

    if len(chunks) >= 2 and word_count(chunks[-1]) < config.min_words:
        merged = chunks[-2] + "\n\n" + chunks[-1]
        if word_count(merged) <= config.hard_max_words:
            chunks[-2:] = [merged]
    return chunks
