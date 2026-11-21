import type { DocumentSummary, Subject, Week } from "./types";

export type CurrentWeek =
  | { status: "in_week"; week: Week }
  | { status: "between_weeks"; previous: Week; next: Week }
  | { status: "before_start"; next: Week; daysUntilStart: number }
  | { status: "after_end"; last: Week }
  | { status: "no_dates" };

function toUtc(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Locate today in the teaching timeline using only dates found in the
 * Weekly Overview. Weeks without dates are ignored; if no week has dates the
 * current week is unknown (never guessed).
 */
export function findCurrentWeek(weeks: Week[], todayIso: string): CurrentWeek {
  const dated = weeks
    .filter((w) => w.dateRange?.startDate)
    .map((w) => ({
      week: w,
      start: toUtc(w.dateRange!.startDate!),
      end: toUtc(w.dateRange!.endDate ?? w.dateRange!.startDate!),
    }))
    .sort((a, b) => a.start - b.start);
  if (dated.length === 0) return { status: "no_dates" };
  const today = toUtc(todayIso);
  const inWeek = dated.find((d) => today >= d.start && today <= d.end);
  if (inWeek) return { status: "in_week", week: inWeek.week };
  if (today < dated[0].start) {
    return { status: "before_start", next: dated[0].week, daysUntilStart: Math.round((dated[0].start - today) / 86_400_000) };
  }
  const last = dated[dated.length - 1];
  if (today > last.end) return { status: "after_end", last: last.week };
  const nextIndex = dated.findIndex((d) => d.start > today);
  return { status: "between_weeks", previous: dated[nextIndex - 1].week, next: dated[nextIndex].week };
}

export interface CoverageSummary {
  totalDocuments: number;
  usableDocuments: number;
  failedDocuments: number;
  totalWeeks: number;
  weeksWithLectureMaterial: number;
  weeksNeedingVerification: number;
  lectureDecks: number;
  textbookPages: number;
  /** Share of overview weeks with at least one linked lecture source (0–100). */
  lectureCoveragePercent: number;
}

/** Source coverage (what material exists) — never a measure of learning. */
export function summarizeCoverage(subject: Subject, documents: DocumentSummary[]): CoverageSummary {
  const content = documents.filter((d) => d.documentType !== "weekly_overview");
  const usable = content.filter((d) => d.processingStatus === "completed" || d.processingStatus === "partially_processed");
  const totalWeeks = subject.coverage.weeks.length;
  const withMaterial = subject.coverage.weeks.filter((w) => w.lectureMaterial).length;
  const textbook = documents.find((d) => d.documentType === "textbook");
  return {
    totalDocuments: content.length,
    usableDocuments: usable.length,
    failedDocuments: content.filter((d) => d.processingStatus === "failed").length,
    totalWeeks,
    weeksWithLectureMaterial: withMaterial,
    weeksNeedingVerification: subject.coverage.weeks.filter((w) => w.needsVerification).length,
    lectureDecks: content.filter((d) => d.documentType === "presentation" || d.documentType === "lecture_slides_pdf").length,
    textbookPages: textbook?.pageCount ?? 0,
    lectureCoveragePercent: totalWeeks === 0 ? 0 : Math.round((withMaterial / totalWeeks) * 100),
  };
}

export function weekDisplayName(week: Pick<Week, "weekNumber" | "ordinal" | "label" | "labelKind">): string {
  if (week.labelKind === "week") return week.label;
  if (week.weekNumber != null) return `Week ${week.weekNumber}`;
  return week.label;
}

export const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  weekly_overview: "Weekly overview",
  presentation: "Lecture slides",
  lecture_slides_pdf: "Lecture slides (PDF)",
  textbook: "Textbook",
  supporting_document: "Supporting document",
};
