"""Command-line entry points used by ``scripts/*.py``."""

from __future__ import annotations

import argparse
import logging
import sys
from typing import Callable

from .config import ArchiveNotFoundError, Paths, discover_archive
from .util import setup_logging

LOG = logging.getLogger("synapse_ingest")


def _common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--data-dir", help="data directory (default: ./data or $SYNAPSE_DATA_DIR)")
    parser.add_argument("-v", "--verbose", action="store_true")


def _run(main: Callable[[argparse.Namespace, Paths], int], parser: argparse.ArgumentParser, argv: list[str] | None) -> int:
    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    paths = Paths.resolve(args.data_dir)
    paths.ensure()
    try:
        return main(args, paths)
    except ArchiveNotFoundError as exc:
        LOG.error("%s", exc)
        return 2
    except FileNotFoundError as exc:
        LOG.error("%s", exc)
        return 2


# ---------------------------------------------------------------- Stage A
def inspect_archive_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Stage A: inspect and safely extract the subject archive.")
    _common(parser)
    parser.add_argument("--archive", help="path to the subject ZIP (default: auto-discover)")
    parser.add_argument("--overview", help="archive path of the Weekly Overview HTML (default: auto)")
    parser.add_argument("--textbook", help="archive path of the textbook (default: heuristic)")
    parser.add_argument("--no-extract", action="store_true", help="list entries only, do not extract")

    def main(args: argparse.Namespace, paths: Paths) -> int:
        from .archive import inspect_archive

        archive = discover_archive(args.archive, paths)
        LOG.info("Archive: %s", archive)
        result = inspect_archive(
            archive,
            paths,
            extract=not args.no_extract,
            overview_override=args.overview,
            textbook_override=args.textbook,
        )
        LOG.info("Wrote %s and %s", paths.inventory, paths.reports / "inventory_report.md")
        return 1 if any(i["severity"] == "error" for i in result.issues) and not result.inventory["entries"] else 0

    return _run(main, parser, argv)


# ---------------------------------------------------------------- Stage B
def parse_overview_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Stage B: parse the Weekly Overview (index.html).")
    _common(parser)
    parser.add_argument("--html", help="parse a standalone HTML file and print a summary (debugging)")

    def main(args: argparse.Namespace, paths: Paths) -> int:
        from .overview import parse_overview_file, run_overview_stage

        if args.html:
            import json
            from pathlib import Path

            result = parse_overview_file(Path(args.html))
            summary = {
                "strategy": result["parser_strategy"],
                "weeks": [(w["label"], w["week_number"], len(w["topics"]), len(w["resources"])) for w in result["weeks"]],
                "warnings": result["warnings"],
            }
            print(json.dumps(summary, indent=2, ensure_ascii=False))
            return 0
        run_overview_stage(paths)
        return 0

    return _run(main, parser, argv)


# ---------------------------------------------------------------- Stage C
def extract_presentations_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Stage C: slide-aware PowerPoint extraction.")
    _common(parser)
    parser.add_argument("--force", action="store_true", help="re-extract even if up to date")
    parser.add_argument("--retries", type=int, default=1)
    parser.add_argument("--no-convert", action="store_true", help="do not convert legacy .ppt with LibreOffice")

    def main(args: argparse.Namespace, paths: Paths) -> int:
        from .presentations import run_presentations_stage

        results = run_presentations_stage(paths, force=args.force, retries=args.retries, convert_legacy=not args.no_convert)
        failed = [r for r in results if r["status"] == "failed"]
        LOG.info("Presentations: %d processed, %d failed", len(results), len(failed))
        return 0

    return _run(main, parser, argv)


# ---------------------------------------------------------------- Stage D
def extract_book_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Stage D: extract the textbook and other documents.")
    _common(parser)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--retries", type=int, default=1)
    parser.add_argument("--ocr", action="store_true", help="run OCRmyPDF on PDFs with scanned pages (optional)")
    parser.add_argument("--textbook-only", action="store_true", help="only process the identified textbook")

    def main(args: argparse.Namespace, paths: Paths) -> int:
        from .documents import run_documents_stage

        results = run_documents_stage(
            paths, force=args.force, retries=args.retries, ocr=args.ocr, textbook_only=args.textbook_only
        )
        failed = [r for r in results if r["status"] == "failed"]
        LOG.info("Documents: %d processed, %d failed", len(results), len(failed))
        return 0

    return _run(main, parser, argv)


# ---------------------------------------------------------------- Stage E
def build_index_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Stage E: build the unified source index and RAG chunks.")
    _common(parser)
    parser.add_argument("--subject-name", help="override the subject name (default: from the overview title)")
    parser.add_argument("--subject-slug", help="override the subject slug")

    def main(args: argparse.Namespace, paths: Paths) -> int:
        from .index import build_source_index

        build_source_index(paths, subject_name=args.subject_name, subject_slug=args.subject_slug)
        LOG.info("Report: %s", paths.reports / "processing_report.md")
        return 0

    return _run(main, parser, argv)


# ---------------------------------------------------------------- all
def run_pipeline_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run ingestion stages A–E in order.")
    _common(parser)
    parser.add_argument("--archive")
    parser.add_argument("--overview")
    parser.add_argument("--textbook")
    parser.add_argument("--subject-name")
    parser.add_argument("--subject-slug")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--ocr", action="store_true")
    parser.add_argument("--no-convert", action="store_true")
    parser.add_argument("--retries", type=int, default=1)
    parser.add_argument(
        "--only",
        action="append",
        metavar="ARCHIVE_PATH",
        help="re-extract only this document (repeatable); everything else stays cached",
    )

    def main(args: argparse.Namespace, paths: Paths) -> int:
        from .archive import inspect_archive
        from .documents import run_documents_stage
        from .index import build_source_index
        from .overview import run_overview_stage
        from .presentations import run_presentations_stage

        archive = discover_archive(args.archive, paths)
        LOG.info("== Stage A: archive inspection (%s)", archive.name)
        inventory = inspect_archive(
            archive, paths, overview_override=args.overview, textbook_override=args.textbook
        ).inventory
        LOG.info("== Stage B: weekly overview")
        if inventory["weekly_overview"]["selected"]:
            run_overview_stage(paths)
        else:
            LOG.error("No index.html found — the weekly timeline cannot be built (other stages continue).")
            if paths.weekly_overview.exists():
                paths.weekly_overview.unlink()
        LOG.info("== Stage C: presentations")
        only = set(args.only) if args.only else None
        if only:
            known = {e["path"] for e in inventory["entries"]}
            unknown = sorted(only - known)
            if unknown:
                LOG.error("--only paths not found in the archive: %s", unknown)
                return 2
        run_presentations_stage(
            paths, force=args.force, retries=args.retries, convert_legacy=not args.no_convert, only=only
        )
        LOG.info("== Stage D: textbook and documents")
        run_documents_stage(paths, force=args.force, retries=args.retries, ocr=args.ocr, only=only)
        LOG.info("== Stage E: source index")
        index = build_source_index(paths, subject_name=args.subject_name, subject_slug=args.subject_slug)
        stats = index["stats"]
        print(
            f"\nSYNAPSE ingestion complete: {stats['documents']} documents, {stats['content_units']} units, "
            f"{stats['chunks']} chunks. Status: {stats['by_status']}\n"
            f"Reports: {paths.reports}/processing_report.md, inventory_report.md, weekly_overview_report.md"
        )
        return 0

    return _run(main, parser, argv)


def load_database_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Load processed sources into Supabase/PostgreSQL.")
    _common(parser)
    parser.add_argument("--database-url", help="Postgres URL (default: $SUPABASE_DB_URL or $DATABASE_URL)")
    owner = parser.add_mutually_exclusive_group(required=True)
    owner.add_argument("--owner-id", help="auth.users id that owns the subject")
    owner.add_argument("--owner-email", help="email of the auth.users account that owns the subject")

    def main(args: argparse.Namespace, paths: Paths) -> int:
        import os

        from .db_loader import load_into_database

        url = args.database_url or os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL")
        if not url:
            LOG.error("No database URL. Pass --database-url or set SUPABASE_DB_URL.")
            return 2
        summary = load_into_database(paths, url, owner_id=args.owner_id, owner_email=args.owner_email)
        LOG.info("Loaded: %s", summary)
        return 0

    return _run(main, parser, argv)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(run_pipeline_main())
