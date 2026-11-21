import { z } from "zod";

/**
 * Zod schemas for the files written by the Python pipeline
 * (`data/processed/source_index.json`, `content_units.jsonl`).
 * Unknown keys are ignored so newer pipeline versions stay readable.
 */
const nullableString = z.string().nullable().optional().transform((v) => v ?? null);
const nullableNumber = z.number().nullable().optional().transform((v) => v ?? null);

export const ProcessingStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "partially_processed",
  "failed",
  "skipped",
]);

const TopicSchema = z.object({ text: z.string(), origin: z.string() });

const DateRangeSchema = z
  .object({
    raw: nullableString,
    start_date: nullableString,
    end_date: nullableString,
    year_source: nullableString,
  })
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const LocalWeekSchema = z.object({
  id: z.string(),
  ordinal: z.number().int(),
  label: z.string(),
  label_kind: z.string(),
  week_number: nullableNumber,
  week_number_source: nullableString,
  date_range: DateRangeSchema,
  topics: z.array(TopicSchema).default([]),
  learning_objectives: z.array(z.string()).default([]),
  references: z
    .array(
      z.object({
        kind: z.string(),
        text: z.string(),
        page_start: nullableNumber,
        page_end: nullableNumber,
      }),
    )
    .default([]),
  resources: z
    .array(
      z.object({
        text: z.string().default(""),
        href: z.string().default(""),
        kind: z.string(),
        resolved_path: nullableString,
        target: nullableString,
        document_id: nullableString,
        reason: nullableString,
      }),
    )
    .default([]),
  document_ids: z.array(z.string()).default([]),
});

const AssociationSchema = z.object({
  week_id: z.string(),
  week_ordinal: z.number().int(),
  source: z.string(),
  verification: z.string(),
  evidence: nullableString,
});

export const LocalDocumentSchema = z.object({
  id: z.string(),
  original_filename: z.string(),
  source_path: z.string(),
  archive_paths: z.array(z.string()).default([]),
  document_type: z.enum(["weekly_overview", "presentation", "textbook", "lecture_slides_pdf", "supporting_document"]),
  format: nullableString,
  size_bytes: nullableNumber,
  title: nullableString,
  page_count: nullableNumber,
  slide_count: nullableNumber,
  word_count: nullableNumber,
  unit_count: z.number().optional().default(0),
  chunk_count: z.number().optional().default(0),
  processing_status: ProcessingStatusSchema,
  errors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  converted_from: nullableString,
  processed_at: nullableString,
  week_associations: z.array(AssociationSchema).default([]),
  chapters: z
    .array(
      z.object({
        index: z.number(),
        title: z.string().nullable().transform((v) => v ?? "Untitled"),
        page_start: nullableNumber,
        page_end: nullableNumber,
        source: z.string(),
      }),
    )
    .default([]),
  quality: z
    .object({ ocr_pages: z.array(z.number()).default([]) })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export const CoverageSchema = z.object({
  weeks: z
    .array(
      z.object({
        week_id: z.string(),
        ordinal: z.number(),
        label: z.string(),
        lecture_material: z.boolean(),
        lecture_material_confirmed: z.boolean(),
        lecture_material_failed: z.boolean().default(false),
        textbook_reference_in_overview: z.boolean(),
        document_count: z.number(),
        missing_material: z.boolean(),
        needs_verification: z.boolean(),
      }),
    )
    .default([]),
  weeks_with_lecture_material: z.number().default(0),
  weeks_without_material: z.array(z.string()).default([]),
  lecture_documents_not_in_overview: z
    .array(z.object({ document_id: z.string(), filename: z.string(), document_type: z.string() }))
    .default([]),
  unresolved_overview_links: z
    .array(z.object({ text: z.string().default(""), href: z.string().default(""), reason: nullableString }))
    .default([]),
  failed_documents: z.array(z.string()).default([]),
  partial_documents: z.array(z.string()).default([]),
  textbook_identified: z.boolean().default(false),
});

export const StatsSchema = z.object({
  documents: z.number(),
  content_units: z.number(),
  chunks: z.number(),
  slides: z.number(),
  pages: z.number(),
  sections: z.number(),
  words: z.number(),
  by_status: z.record(z.string(), z.number()).default({}),
  by_type: z.record(z.string(), z.number()).default({}),
});

export const FileSchema = z.object({
  path: z.string(),
  filename: z.string(),
  category: z.string(),
  extension: nullableString,
  size_bytes: nullableNumber,
  document_id: nullableString,
  processing_status: z.string(),
  reason: nullableString,
});

export const OverviewMetaSchema = z.object({
  source_file: nullableString,
  title: nullableString,
  parser_strategy: z
    .object({ name: z.string(), detail: z.string(), score: z.number() })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  warnings: z.array(z.string()).default([]),
  other_sections: z
    .array(z.object({ label: z.string(), label_kind: z.string(), topics: z.array(TopicSchema).default([]) }))
    .default([]),
});

export const LocalIndexSchema = z.object({
  schema_version: z.number(),
  generated_at: z.string(),
  subject: z.object({
    key: z.string(),
    name: z.string(),
    name_source: nullableString,
    archive_filename: nullableString,
  }),
  weekly_overview: OverviewMetaSchema,
  textbook: z.object({ selected: nullableString, selection_reason: nullableString }),
  stats: StatsSchema,
  coverage: CoverageSchema,
  weeks: z.array(LocalWeekSchema),
  documents: z.array(LocalDocumentSchema),
  files: z.array(FileSchema),
});



export const LocalUnitSchema = z.object({
  id: z.string(),
  document_id: z.string(),
  unit_type: z.enum(["slide", "page", "section"]),
  unit_number: z.number().int(),
  slide_number: nullableNumber,
  page_number: nullableNumber,
  page_label: nullableString,
  detected_printed_page: nullableString,
  title: nullableString,
  display_title: nullableString,
  heading_path: z.array(z.string()).default([]),
  chapter: z
    .object({ title: z.string() })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  text: z.string().default(""),
  notes: z.string().default(""),
  flags: z.record(z.string(), z.boolean()).default({}),
  citation: z.string(),
  word_count: z.number().default(0),
});

export type LocalIndex = z.infer<typeof LocalIndexSchema>;
export type LocalCoverage = z.infer<typeof CoverageSchema>;
export type LocalStats = z.infer<typeof StatsSchema>;
export type LocalOverviewMeta = z.infer<typeof OverviewMetaSchema>;
export type LocalUnit = z.infer<typeof LocalUnitSchema>;
