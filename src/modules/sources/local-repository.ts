import "server-only";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { LocalIndexSchema, LocalUnitSchema, type LocalIndex, type LocalUnit } from "./local-schemas";
import { mapCoverage, mapOverview, mapStats, overallStatus } from "./mappers";
import {
  SourceDataError,
  type DocumentSummary,
  type DocumentUnit,
  type FileStatus,
  type Page,
  type SourceFile,
  type SourceRepository,
  type Subject,
  type Week,
} from "./types";

const PIPELINE_HINT = "Run `.venv/bin/python scripts/run_pipeline.py` to (re)generate data/processed/.";

type Cached<T> = { mtimeMs: number; value: T };

/**
 * Read-only repository over the local pipeline output. Files are re-read only
 * when their modification time changes, so re-running the pipeline is picked
 * up without restarting the dev server.
 */
export class LocalSourceRepository implements SourceRepository {
  readonly mode = "local" as const;
  private indexCache: Cached<LocalIndex | null> | null = null;
  private unitsCache: Cached<Map<string, LocalUnit[]>> | null = null;

  constructor(private readonly dataDir: string) {}

  private get processedDir() {
    return path.join(/*turbopackIgnore: true*/ this.dataDir, "processed");
  }

  private async loadIndex(): Promise<LocalIndex | null> {
    const file = path.join(/*turbopackIgnore: true*/ this.processedDir, "source_index.json");
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(file)).mtimeMs;
    } catch {
      return null; // nothing processed yet
    }
    if (this.indexCache?.mtimeMs === mtimeMs) return this.indexCache.value;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      throw new SourceDataError(`Could not read ${file}: ${(error as Error).message}`, PIPELINE_HINT);
    }
    const parsed = LocalIndexSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new SourceDataError(
        `Processed source index is incompatible (${issue?.path.join(".")}: ${issue?.message}).`,
        PIPELINE_HINT,
      );
    }
    this.indexCache = { mtimeMs, value: parsed.data };
    return parsed.data;
  }

  private async loadUnits(): Promise<Map<string, LocalUnit[]>> {
    const file = path.join(/*turbopackIgnore: true*/ this.processedDir, "content_units.jsonl");
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(file)).mtimeMs;
    } catch {
      return new Map();
    }
    if (this.unitsCache?.mtimeMs === mtimeMs) return this.unitsCache.value;
    const byDocument = new Map<string, LocalUnit[]>();
    const text = await readFile(file, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const parsed = LocalUnitSchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new SourceDataError("content_units.jsonl contains an incompatible row.", PIPELINE_HINT);
      }
      const list = byDocument.get(parsed.data.document_id) ?? [];
      list.push(parsed.data);
      byDocument.set(parsed.data.document_id, list);
    }
    for (const list of byDocument.values()) list.sort((a, b) => a.unit_number - b.unit_number);
    this.unitsCache = { mtimeMs, value: byDocument };
    return byDocument;
  }

  private async indexFor(subjectId: string): Promise<LocalIndex | null> {
    const index = await this.loadIndex();
    return index && index.subject.key === subjectId ? index : null;
  }

  async getActiveSubject(): Promise<Subject | null> {
    const index = await this.loadIndex();
    return index ? toSubject(index) : null;
  }

  async listWeeks(subjectId: string): Promise<Week[]> {
    const index = await this.indexFor(subjectId);
    return index ? index.weeks.map(toWeek) : [];
  }

  async getWeek(subjectId: string, weekId: string): Promise<Week | null> {
    return (await this.listWeeks(subjectId)).find((week) => week.id === weekId) ?? null;
  }

  async listDocuments(subjectId: string): Promise<DocumentSummary[]> {
    const index = await this.indexFor(subjectId);
    return index ? index.documents.map(toDocument) : [];
  }

  async getDocument(subjectId: string, documentId: string): Promise<DocumentSummary | null> {
    return (await this.listDocuments(subjectId)).find((d) => d.id === documentId) ?? null;
  }

  async listDocumentUnits(
    subjectId: string,
    documentId: string,
    range: { offset: number; limit: number },
  ): Promise<Page<DocumentUnit>> {
    if (!(await this.indexFor(subjectId))) return { items: [], total: 0, ...range };
    const units = (await this.loadUnits()).get(documentId) ?? [];
    return {
      items: units.slice(range.offset, range.offset + range.limit).map(toUnit),
      total: units.length,
      ...range,
    };
  }

  async listFiles(subjectId: string): Promise<SourceFile[]> {
    const index = await this.indexFor(subjectId);
    if (!index) return [];
    return index.files.map((file) => ({
      path: file.path,
      filename: file.filename,
      category: file.category,
      extension: file.extension,
      sizeBytes: file.size_bytes,
      documentId: file.document_id,
      processingStatus: file.processing_status as FileStatus,
      reason: file.reason,
    }));
  }
}

function toSubject(index: LocalIndex): Subject {
  return {
    id: index.subject.key,
    key: index.subject.key,
    name: index.subject.name,
    nameSource: index.subject.name_source,
    archiveFilename: index.subject.archive_filename,
    ingestionStatus: overallStatus(index.documents.map((d) => d.processing_status)),
    processedAt: index.generated_at,
    stats: mapStats(index.stats),
    coverage: mapCoverage(index.coverage),
    overview: mapOverview(index.weekly_overview),
    textbook: { selected: index.textbook.selected, selectionReason: index.textbook.selection_reason },
  };
}

export function toWeek(week: LocalIndex["weeks"][number]): Week {
  return {
    id: week.id,
    ordinal: week.ordinal,
    weekNumber: week.week_number,
    weekNumberSource: week.week_number_source,
    label: week.label,
    labelKind: week.label_kind,
    dateRange: week.date_range
      ? {
          raw: week.date_range.raw,
          startDate: week.date_range.start_date,
          endDate: week.date_range.end_date,
          yearSource: week.date_range.year_source,
        }
      : null,
    topics: week.topics,
    learningObjectives: week.learning_objectives,
    references: week.references.map((r) => ({
      kind: r.kind,
      text: r.text,
      pageStart: r.page_start,
      pageEnd: r.page_end,
    })),
    resources: week.resources.map((r) => ({
      text: r.text,
      href: r.href,
      kind: r.kind,
      resolvedPath: r.resolved_path ?? r.target,
      documentId: r.document_id,
      reason: r.reason,
    })),
    documentIds: week.document_ids,
    verificationStatus: "unverified",
  };
}

export function toDocument(document: LocalIndex["documents"][number]): DocumentSummary {
  return {
    id: document.id,
    originalFilename: document.original_filename,
    sourcePath: document.source_path,
    archivePaths: document.archive_paths,
    documentType: document.document_type,
    format: document.format,
    sizeBytes: document.size_bytes,
    title: document.title,
    pageCount: document.page_count,
    slideCount: document.slide_count,
    wordCount: document.word_count,
    unitCount: document.unit_count,
    chunkCount: document.chunk_count,
    processingStatus: document.processing_status,
    errors: document.errors,
    warnings: document.warnings,
    convertedFrom: document.converted_from,
    processedAt: document.processed_at,
    weekAssociations: document.week_associations.map((a) => ({
      weekId: a.week_id,
      weekOrdinal: a.week_ordinal,
      source: a.source,
      evidence: a.verification === "source_confirmed" ? "source_confirmed" : "unverified",
      note: a.evidence,
    })),
    chapters: document.chapters.map((c) => ({
      index: c.index,
      title: c.title,
      pageStart: c.page_start,
      pageEnd: c.page_end,
      source: c.source,
    })),
    ocrPages: document.quality?.ocr_pages ?? [],
  };
}

export function toUnit(unit: LocalUnit): DocumentUnit {
  return {
    id: unit.id,
    unitType: unit.unit_type,
    unitNumber: unit.unit_number,
    slideNumber: unit.slide_number,
    pageNumber: unit.page_number,
    pageLabel: unit.page_label,
    detectedPrintedPage: unit.detected_printed_page,
    title: unit.display_title ?? unit.title,
    headingPath: unit.heading_path,
    chapterTitle: unit.chapter?.title ?? null,
    text: unit.text,
    notes: unit.notes,
    flags: unit.flags,
    citation: unit.citation,
    wordCount: unit.word_count,
  };
}
