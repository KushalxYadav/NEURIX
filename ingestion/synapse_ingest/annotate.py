"""Lightweight, transparent text annotations.

These are *candidates* (hints for the curriculum/notes engines and the UI),
never authoritative facts. Each annotation keeps the verbatim source text.
"""

from __future__ import annotations

import re
from typing import Any

SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z(])")
DEFINITION_PATTERNS = [
    re.compile(r"^(?:definition\s*[:.\-]\s*)(?P<body>.+)$", re.I),
    re.compile(
        r"^(?P<term>[A-Z][A-Za-z0-9/\-()' ]{1,60}?)\s+(?:is|are)\s+(?:defined as|called|known as|referred to as|"
        r"termed)\s+(?P<body>.+)$"
    ),
    re.compile(r"^(?P<term>[A-Z][A-Za-z0-9/\-()' ]{1,60}?)\s+(?:refers to|means|denotes)\s+(?P<body>.+)$"),
    re.compile(r"^(?P<term>(?:An?|The)\s+[a-zA-Z0-9/\-() ]{1,50}?|[A-Z][A-Za-z0-9/\-()]{1,30}(?:\s[A-Za-z0-9/\-()]{1,20}){0,3})\s+(?:is|are)\s+(?:a|an)\s+(?P<body>.+)$"),
    re.compile(r"^(?P<term>[^:]{2,60}?)\s*[:–—-]\s+(?P<body>(?:a|an|the)\s.+)$", re.I),
]
EXAMPLE_RE = re.compile(r"^\s*(?:example|e\.g\.|for example|for instance|eg\.?)\b", re.I)
FIGURE_RE = re.compile(r"\b(Fig(?:ure)?\.?\s*\d+(?:[.\-]\d+)*)\s*[:.\-–]?\s*([^\n]{0,140})", re.I)
TABLE_REF_RE = re.compile(r"\b(Table\s*\d+(?:[.\-]\d+)*)\s*[:.\-–]?\s*([^\n]{0,140})")
STRONG_MATH = set("∑∏∫√≤≥≠≈±∞∂∆∇πθλμσΩαβγδεφω×÷→⇒⇔∈∉⊂⊆∪∩")
MATH_CHARS = set("=+−-*/^<>()[]{}%|") | STRONG_MATH
FORMULA_LINE_RE = re.compile(r"[A-Za-z][A-Za-z0-9_ ]{0,40}\s*=\s*[^=]")
# "Throughput = Window size / Round trip time": a named quantity defined by an
# expression with at least one operator or number on the right-hand side.
WORD_FORMULA_RE = re.compile(r"^\s*[A-Za-z][A-Za-z0-9_ ()\-]{0,40}?\s*=\s*(?P<rhs>[^=]{1,120})$")
RHS_OPERATOR_RE = re.compile(r"[/*+^×÷−]|\d|\b(?:log|sqrt|min|max)\b")


def sentences(text: str) -> list[str]:
    parts: list[str] = []
    for paragraph in re.split(r"\n+", text):
        paragraph = paragraph.strip()
        if paragraph:
            parts.extend(s.strip() for s in SENTENCE_SPLIT_RE.split(paragraph) if s.strip())
    return parts


def is_formula_line(line: str) -> bool:
    line = line.strip()
    if not line or len(line) > 220:
        return False
    if any(ch in STRONG_MATH for ch in line):
        return True
    word_formula = WORD_FORMULA_RE.match(line)
    if (
        word_formula
        and RHS_OPERATOR_RE.search(word_formula.group("rhs"))
        and not line.endswith(".")
        and len(line.split()) <= 16
    ):
        return True
    compact = line.replace(" ", "")
    math = sum(1 for ch in compact if ch in MATH_CHARS or ch.isdigit())
    ratio = math / max(1, len(compact))
    if "=" in line and ratio >= 0.5:
        return True  # e.g. "2^n - 2 = 62"
    if not FORMULA_LINE_RE.search(line):
        return False
    return ratio >= 0.15


def annotate_text(text: str, *, max_items: int = 25) -> dict[str, list[dict[str, Any]]]:
    definitions: list[dict[str, Any]] = []
    examples: list[dict[str, Any]] = []
    for sentence in sentences(text):
        if len(sentence) < 12 or len(sentence) > 400:
            continue
        if EXAMPLE_RE.match(sentence) and len(examples) < max_items:
            examples.append({"text": sentence})
            continue
        for pattern in DEFINITION_PATTERNS:
            match = pattern.match(sentence)
            if match and len(definitions) < max_items:
                term = (match.groupdict().get("term") or "").strip(" :-")
                definitions.append({"term": term or None, "text": sentence})
                break
    figures = [
        {"label": m.group(1).strip(), "caption": m.group(2).strip()}
        for m in FIGURE_RE.finditer(text)
    ][:max_items]
    tables = [{"label": m.group(1).strip(), "caption": m.group(2).strip()} for m in TABLE_REF_RE.finditer(text)][
        :max_items
    ]
    formulas = [{"text": line.strip()} for line in text.splitlines() if is_formula_line(line)][:max_items]
    return {
        "definitions": definitions,
        "examples": examples,
        "figures": figures,
        "tables": tables,
        "formulas": formulas,
    }


def formula_density(text: str) -> float:
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return 0.0
    return round(sum(1 for line in lines if is_formula_line(line)) / len(lines), 3)
