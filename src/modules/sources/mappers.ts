import {
  CoverageSchema,
  OverviewMetaSchema,
  StatsSchema,
  type LocalCoverage,
  type LocalOverviewMeta,
  type LocalStats,
} from "./local-schemas";
import type { Coverage, ProcessingStatus, Subject, SubjectStats } from "./types";

/** The pipeline writes snake_case JSON; both repositories map it here. */
export function mapStats(raw: unknown): SubjectStats {
  const stats: LocalStats = StatsSchema.parse(raw ?? {});
  return {
    documents: stats.documents,
    contentUnits: stats.content_units,
    chunks: stats.chunks,
    slides: stats.slides,
    pages: stats.pages,
    sections: stats.sections,
    words: stats.words,
    byStatus: stats.by_status,
    byType: stats.by_type,
  };
}

export const EMPTY_STATS: SubjectStats = {
  documents: 0,
  contentUnits: 0,
  chunks: 0,
  slides: 0,
  pages: 0,
  sections: 0,
  words: 0,
  byStatus: {},
  byType: {},
};

export function mapCoverage(raw: unknown): Coverage {
  const coverage: LocalCoverage = CoverageSchema.parse(raw ?? {});
  return {
    weeks: coverage.weeks.map((row) => ({
      weekId: row.week_id,
      ordinal: row.ordinal,
      label: row.label,
      lectureMaterial: row.lecture_material,
      lectureMaterialConfirmed: row.lecture_material_confirmed,
      lectureMaterialFailed: row.lecture_material_failed,
      textbookReferenceInOverview: row.textbook_reference_in_overview,
      documentCount: row.document_count,
      missingMaterial: row.missing_material,
      needsVerification: row.needs_verification,
    })),
    weeksWithLectureMaterial: coverage.weeks_with_lecture_material,
    weeksWithoutMaterial: coverage.weeks_without_material,
    lectureDocumentsNotInOverview: coverage.lecture_documents_not_in_overview.map((d) => ({
      documentId: d.document_id,
      filename: d.filename,
      documentType: d.document_type,
    })),
    unresolvedOverviewLinks: coverage.unresolved_overview_links,
    failedDocuments: coverage.failed_documents,
    partialDocuments: coverage.partial_documents,
    textbookIdentified: coverage.textbook_identified,
  };
}

export function mapOverview(raw: unknown): Subject["overview"] {
  const overview: LocalOverviewMeta = OverviewMetaSchema.parse(raw ?? {});
  return {
    sourceFile: overview.source_file,
    title: overview.title,
    parserStrategy: overview.parser_strategy,
    warnings: overview.warnings,
    otherSections: overview.other_sections.map((s) => ({ label: s.label, labelKind: s.label_kind, topics: s.topics })),
  };
}

export function overallStatus(statuses: ProcessingStatus[]): ProcessingStatus {
  if (statuses.length === 0) return "failed";
  if (statuses.every((s) => s === "completed")) return "completed";
  if (statuses.every((s) => s === "failed")) return "failed";
  return "partially_processed";
}
