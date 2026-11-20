"""SYNAPSE local ingestion pipeline.

Stages:
  A  archive.py        archive inspection, safe extraction, file inventory
  B  overview.py       Weekly Overview (index.html) parsing
  C  presentations.py  slide-aware PowerPoint extraction
  D  documents.py      textbook / PDF / DOCX / EPUB / HTML / text extraction
  E  index.py          unified source index, content units and RAG chunks

Every output keeps its source reference (file, slide or page). Nothing is
inferred silently: inferred values carry an explicit ``*_source`` field.
"""

__version__ = "0.1.0"

# Bump when extraction output changes so cached results are re-extracted.
EXTRACTOR_VERSION = "2026.11.1"
SCHEMA_VERSION = 1
