import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { EMPTY_STATS, mapCoverage, mapOverview, mapStats } from "./mappers";
import {
  SourceDataError,
  type Chapter,
  type DocumentSummary,
  type DocumentType,
  type DocumentUnit,
  type FileStatus,
  type Page,
  type ProcessingStatus,
  type SourceFile,
  type SourceRepository,
  type Subject,
  type Week,
  type WeekReference,
  type WeekResource,
  type WeekTopic,
} from "./types";

/* Row shapes returned by the queries below (see supabase/migrations). */
interface SubjectRow {
  id: string;
  slug: string;
  name: string;
  name_source: string | null;
  source_archive_filename: string | null;
  ingestion_status: ProcessingStatus;
  ingested_at: string | null;
  overview_meta: Record<string, unknown> | null;
  coverage: Record<string, unknown> | null;
  stats: Record<string, unknown> | null;
}

interface WeekRow {
  id: string;
  ordinal: number;
  week_number: number | null;
  week_number_source: string | null;
  label: string;
  label_kind: string;
  start_date: string | null;
  end_date: string | null;
  date_raw: string | null;
  date_year_source: string | null;
  topics: WeekTopic[] | null;
  learning_objectives: string[] | null;
  source_references: Array<{ kind: string; text: string; page_start?: number; page_end?: number }> | null;
  resources: Array<Record<string, unknown>> | null;
  verification_status: Week["verificationStatus"];
  week_documents: Array<{ document_id: string }> | null;
}

interface DocumentRow {
  id: string;
  original_filename: string;
  source_path: string;
  archive_paths: string[] | null;
  document_type: DocumentType;
  format: string | null;
  size_bytes: number | null;
  title: string | null;
  page_count: number | null;
  slide_count: number | null;
  word_count: number | null;
  unit_count: number | null;
  chunk_count: number | null;
  chapters: Array<{ index: number; title: string | null; page_start?: number; page_end?: number; source: string }> | null;
  quality: { ocr_pages?: number[] } | null;
  processing_status: ProcessingStatus;
  errors: string[] | null;
  warnings: string[] | null;
  converted_from: string | null;
  processed_at: string | null;
  week_documents: Array<{
    week_id: string;
    association_source: string;
    origin: string;
    evidence: string | null;
    weeks: { ordinal: number } | null;
  }> | null;
}

const DOCUMENT_SELECT =
  "*, week_documents(week_id, association_source, origin, evidence, weeks(ordinal))";

export class SupabaseSourceRepository implements SourceRepository {
  readonly mode = "supabase" as const;

  constructor(private readonly supabase: SupabaseClient) {}

  private fail(context: string, error: { message: string }): never {
    throw new SourceDataError(`Could not load ${context}: ${error.message}`);
  }

  async getActiveSubject(): Promise<Subject | null> {
    const { data: profile, error: profileError } = await this.supabase
      .from("profiles")
      .select("active_subject_id")
      .maybeSingle();
    if (profileError) this.fail("profile", profileError);
    let query = this.supabase.from("subjects").select("*").eq("is_active", true);
    query = profile?.active_subject_id
      ? query.eq("id", profile.active_subject_id)
      : query.order("created_at", { ascending: true }).limit(1);
    const { data, error } = await query.maybeSingle<SubjectRow>();
    if (error) this.fail("subject", error);
    if (!data) return null;
    const meta = (data.overview_meta ?? {}) as Record<string, unknown> & {
      textbook?: { selected?: string | null; selection_reason?: string | null };
    };
    const hasStats = data.stats && Object.keys(data.stats).length > 0;
    return {
      id: data.id,
      key: data.slug,
      name: data.name,
      nameSource: data.name_source,
      archiveFilename: data.source_archive_filename,
      ingestionStatus: data.ingestion_status,
      processedAt: data.ingested_at,
      stats: hasStats ? mapStats(data.stats) : EMPTY_STATS,
      coverage: mapCoverage(data.coverage ?? {}),
      overview: mapOverview(meta),
      textbook: { selected: meta.textbook?.selected ?? null, selectionReason: meta.textbook?.selection_reason ?? null },
    };
  }

  async listWeeks(subjectId: string): Promise<Week[]> {
    const { data, error } = await this.supabase
      .from("weeks")
      .select("*, week_documents(document_id)")
      .eq("subject_id", subjectId)
      .order("ordinal")
      .returns<WeekRow[]>();
    if (error) this.fail("weeks", error);
    return (data ?? []).map(toWeek);
  }

  async getWeek(subjectId: string, weekId: string): Promise<Week | null> {
    const { data, error } = await this.supabase
      .from("weeks")
      .select("*, week_documents(document_id)")
      .eq("subject_id", subjectId)
      .eq("id", weekId)
      .maybeSingle<WeekRow>();
    if (error) this.fail("week", error);
    return data ? toWeek(data) : null;
  }

  async listDocuments(subjectId: string): Promise<DocumentSummary[]> {
    const { data, error } = await this.supabase
      .from("documents")
      .select(DOCUMENT_SELECT)
      .eq("subject_id", subjectId)
      .order("source_path")
      .returns<DocumentRow[]>();
    if (error) this.fail("documents", error);
    return (data ?? []).map(toDocument);
  }

  async getDocument(subjectId: string, documentId: string): Promise<DocumentSummary | null> {
    const { data, error } = await this.supabase
      .from("documents")
      .select(DOCUMENT_SELECT)
      .eq("subject_id", subjectId)
      .eq("id", documentId)
      .maybeSingle<DocumentRow>();
    if (error) this.fail("document", error);
    return data ? toDocument(data) : null;
  }

  async listDocumentUnits(
    subjectId: string,
    documentId: string,
    range: { offset: number; limit: number },
  ): Promise<Page<DocumentUnit>> {
    const { data, error, count } = await this.supabase
      .from("document_units")
      .select(
        "id, unit_type, unit_number, slide_number, page_number, page_label, detected_printed_page, title, heading_path, chapter_title, text, notes, flags, citation, word_count",
        { count: "exact" },
      )
      .eq("subject_id", subjectId)
      .eq("document_id", documentId)
      .order("unit_number")
      .range(range.offset, range.offset + range.limit - 1);
    if (error) this.fail("document units", error);
    return {
      items: (data ?? []).map((row) => ({
        id: row.id,
        unitType: row.unit_type,
        unitNumber: row.unit_number,
        slideNumber: row.slide_number,
        pageNumber: row.page_number,
        pageLabel: row.page_label,
        detectedPrintedPage: row.detected_printed_page,
        title: row.title,
        headingPath: row.heading_path ?? [],
        chapterTitle: row.chapter_title,
        text: row.text ?? "",
        notes: row.notes ?? "",
        flags: (row.flags ?? {}) as Record<string, boolean>,
        citation: row.citation,
        wordCount: row.word_count ?? 0,
      })),
      total: count ?? 0,
      ...range,
    };
  }

  async listFiles(subjectId: string): Promise<SourceFile[]> {
    const { data, error } = await this.supabase
      .from("source_files")
      .select("path, filename, category, extension, size_bytes, document_id, processing_status, reason")
      .eq("subject_id", subjectId)
      .order("path");
    if (error) this.fail("files", error);
    return (data ?? []).map((row) => ({
      path: row.path,
      filename: row.filename,
      category: row.category,
      extension: row.extension,
      sizeBytes: row.size_bytes,
      documentId: row.document_id,
      processingStatus: row.processing_status as FileStatus,
      reason: row.reason,
    }));
  }
}

function toWeek(row: WeekRow): Week {
  const resources = (row.resources ?? []).map(
    (r): WeekResource => ({
      text: String(r.text ?? ""),
      href: String(r.href ?? ""),
      kind: String(r.kind ?? "unresolved"),
      resolvedPath: (r.resolved_path as string | undefined) ?? (r.target as string | undefined) ?? null,
      documentId: (r.document_id as string | undefined) ?? null,
      reason: (r.reason as string | undefined) ?? null,
    }),
  );
  return {
    id: row.id,
    ordinal: row.ordinal,
    weekNumber: row.week_number,
    weekNumberSource: row.week_number_source,
    label: row.label,
    labelKind: row.label_kind,
    dateRange:
      row.start_date || row.date_raw
        ? { raw: row.date_raw, startDate: row.start_date, endDate: row.end_date, yearSource: row.date_year_source }
        : null,
    topics: row.topics ?? [],
    learningObjectives: row.learning_objectives ?? [],
    references: (row.source_references ?? []).map(
      (r): WeekReference => ({ kind: r.kind, text: r.text, pageStart: r.page_start ?? null, pageEnd: r.page_end ?? null }),
    ),
    resources,
    documentIds: [...new Set((row.week_documents ?? []).map((w) => w.document_id))],
    verificationStatus: row.verification_status,
  };
}

function toDocument(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    sourcePath: row.source_path,
    archivePaths: row.archive_paths ?? [],
    documentType: row.document_type,
    format: row.format,
    sizeBytes: row.size_bytes,
    title: row.title,
    pageCount: row.page_count,
    slideCount: row.slide_count,
    wordCount: row.word_count,
    unitCount: row.unit_count ?? 0,
    chunkCount: row.chunk_count ?? 0,
    processingStatus: row.processing_status,
    errors: row.errors ?? [],
    warnings: row.warnings ?? [],
    convertedFrom: row.converted_from,
    processedAt: row.processed_at,
    weekAssociations: (row.week_documents ?? [])
      .map((w) => ({
        weekId: w.week_id,
        weekOrdinal: w.weeks?.ordinal ?? 0,
        source: w.association_source,
        evidence: (w.origin === "source_confirmed" ? "source_confirmed" : "unverified") as "source_confirmed" | "unverified",
        note: w.evidence,
      }))
      .sort((a, b) => a.weekOrdinal - b.weekOrdinal),
    chapters: (row.chapters ?? []).map(
      (c): Chapter => ({
        index: c.index,
        title: c.title ?? "Untitled",
        pageStart: c.page_start ?? null,
        pageEnd: c.page_end ?? null,
        source: c.source,
      }),
    ),
    ocrPages: row.quality?.ocr_pages ?? [],
  };
}
