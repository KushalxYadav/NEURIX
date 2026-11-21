export type ProcessingStatus =
  | "pending"
  | "processing"
  | "completed"
  | "partially_processed"
  | "failed"
  | "skipped";
export type FileStatus = ProcessingStatus | "rejected" | "not_applicable";
export type DocumentType =
  | "weekly_overview"
  | "presentation"
  | "textbook"
  | "lecture_slides_pdf"
  | "supporting_document";
/** Evidence level for any association shown to the student. */
export type Evidence = "source_confirmed" | "unverified";
export type VerificationStatus = "unverified" | "confirmed" | "rejected";

export interface WeekAssociation {
  weekId: string;
  weekOrdinal: number;
  source: string;
  evidence: Evidence;
  note: string | null;
}

export interface Chapter {
  index: number;
  title: string;
  pageStart: number | null;
  pageEnd: number | null;
  source: string;
}

export interface DocumentSummary {
  id: string;
  originalFilename: string;
  sourcePath: string;
  archivePaths: string[];
  documentType: DocumentType;
  format: string | null;
  sizeBytes: number | null;
  title: string | null;
  pageCount: number | null;
  slideCount: number | null;
  wordCount: number | null;
  unitCount: number;
  chunkCount: number;
  processingStatus: ProcessingStatus;
  errors: string[];
  warnings: string[];
  convertedFrom: string | null;
  processedAt: string | null;
  weekAssociations: WeekAssociation[];
  chapters: Chapter[];
  ocrPages: number[];
}

export interface WeekTopic {
  text: string;
  origin: string;
}

export interface WeekReference {
  kind: string;
  text: string;
  pageStart: number | null;
  pageEnd: number | null;
}

export interface WeekResource {
  text: string;
  href: string;
  kind: string;
  resolvedPath: string | null;
  documentId: string | null;
  reason: string | null;
}

export interface DateRange {
  raw: string | null;
  startDate: string | null;
  endDate: string | null;
  yearSource: string | null;
}

export interface Week {
  id: string;
  ordinal: number;
  weekNumber: number | null;
  weekNumberSource: string | null;
  label: string;
  labelKind: string;
  dateRange: DateRange | null;
  topics: WeekTopic[];
  learningObjectives: string[];
  references: WeekReference[];
  resources: WeekResource[];
  documentIds: string[];
  verificationStatus: VerificationStatus;
}

export interface CoverageWeekRow {
  weekId: string;
  ordinal: number;
  label: string;
  lectureMaterial: boolean;
  lectureMaterialConfirmed: boolean;
  /** A lecture file is linked to this week but could not be processed. */
  lectureMaterialFailed: boolean;
  textbookReferenceInOverview: boolean;
  documentCount: number;
  missingMaterial: boolean;
  needsVerification: boolean;
}

export interface Coverage {
  weeks: CoverageWeekRow[];
  weeksWithLectureMaterial: number;
  weeksWithoutMaterial: string[];
  lectureDocumentsNotInOverview: { documentId: string; filename: string; documentType: string }[];
  unresolvedOverviewLinks: { text: string; href: string; reason: string | null }[];
  failedDocuments: string[];
  partialDocuments: string[];
  textbookIdentified: boolean;
}

export interface SubjectStats {
  documents: number;
  contentUnits: number;
  chunks: number;
  slides: number;
  pages: number;
  sections: number;
  words: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
}

export interface OtherSection {
  label: string;
  labelKind: string;
  topics: WeekTopic[];
}

export interface Subject {
  id: string;
  key: string;
  name: string;
  nameSource: string | null;
  archiveFilename: string | null;
  ingestionStatus: ProcessingStatus;
  processedAt: string | null;
  stats: SubjectStats;
  coverage: Coverage;
  overview: {
    sourceFile: string | null;
    title: string | null;
    parserStrategy: { name: string; detail: string; score: number } | null;
    warnings: string[];
    otherSections: OtherSection[];
  };
  textbook: { selected: string | null; selectionReason: string | null };
}

export interface SourceFile {
  path: string;
  filename: string;
  category: string;
  extension: string | null;
  sizeBytes: number | null;
  documentId: string | null;
  processingStatus: FileStatus;
  reason: string | null;
}

export interface DocumentUnit {
  id: string;
  unitType: "slide" | "page" | "section";
  unitNumber: number;
  slideNumber: number | null;
  pageNumber: number | null;
  pageLabel: string | null;
  detectedPrintedPage: string | null;
  title: string | null;
  headingPath: string[];
  chapterTitle: string | null;
  text: string;
  notes: string;
  flags: Record<string, boolean>;
  citation: string;
  wordCount: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface SourceRepository {
  readonly mode: "local" | "supabase";
  getActiveSubject(): Promise<Subject | null>;
  listWeeks(subjectId: string): Promise<Week[]>;
  getWeek(subjectId: string, weekId: string): Promise<Week | null>;
  listDocuments(subjectId: string): Promise<DocumentSummary[]>;
  getDocument(subjectId: string, documentId: string): Promise<DocumentSummary | null>;
  listDocumentUnits(
    subjectId: string,
    documentId: string,
    range: { offset: number; limit: number },
  ): Promise<Page<DocumentUnit>>;
  listFiles(subjectId: string): Promise<SourceFile[]>;
}

export class SourceDataError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = "SourceDataError";
  }
}
