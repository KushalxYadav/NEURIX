# data/ — private pipeline output

Everything in this folder except this README is git-ignored. The ingestion
pipeline writes here:

- `extracted/` — files safely extracted from your archive
- `converted/` — LibreOffice / OCR copies of legacy or scanned files
- `processed/` — inventory, weekly overview, per-document extractions, the
  unified source index, content units and RAG chunks
- `reports/` — human-readable inventory, overview and processing reports

These contain your private study material. Do not commit or upload them.
