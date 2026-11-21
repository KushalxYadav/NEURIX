import { describe, expect, it } from "vitest";

import { findCurrentWeek, summarizeCoverage, weekDisplayName } from "@/modules/sources/timeline";
import type { DocumentSummary, Subject, Week } from "@/modules/sources/types";

function week(ordinal: number, start: string | null, end: string | null, overrides: Partial<Week> = {}): Week {
  return {
    id: `w${ordinal}`,
    ordinal,
    weekNumber: ordinal,
    weekNumberSource: "inferred_from_order",
    label: `${ordinal} label`,
    labelKind: "date_range",
    dateRange: start ? { raw: null, startDate: start, endDate: end, yearSource: "explicit" } : null,
    topics: [],
    learningObjectives: [],
    references: [],
    resources: [],
    documentIds: [],
    verificationStatus: "unverified",
    ...overrides,
  };
}

const weeks = [week(1, "2026-08-04", "2026-08-10"), week(2, "2026-08-18", "2026-08-24")];

describe("findCurrentWeek", () => {
  it("finds the week containing today", () => {
    expect(findCurrentWeek(weeks, "2026-08-06")).toMatchObject({ status: "in_week", week: { id: "w1" } });
  });
  it("reports gaps, the start and the end honestly", () => {
    expect(findCurrentWeek(weeks, "2026-08-14")).toMatchObject({ status: "between_weeks", next: { id: "w2" } });
    expect(findCurrentWeek(weeks, "2026-07-31")).toMatchObject({ status: "before_start", daysUntilStart: 4 });
    expect(findCurrentWeek(weeks, "2026-11-20")).toMatchObject({ status: "after_end", last: { id: "w2" } });
  });
  it("never guesses without dates", () => {
    expect(findCurrentWeek([week(1, null, null)], "2026-08-06")).toEqual({ status: "no_dates" });
  });
});

describe("weekDisplayName", () => {
  it("prefers the verbatim label for explicit week labels", () => {
    expect(weekDisplayName(week(3, null, null, { labelKind: "week", label: "Week 3: Routing" }))).toBe("Week 3: Routing");
    expect(weekDisplayName(week(3, null, null))).toBe("Week 3");
    expect(weekDisplayName(week(3, null, null, { weekNumber: null, labelKind: "topic", label: "Topic 3" }))).toBe("Topic 3");
  });
});

describe("summarizeCoverage", () => {
  it("counts usable material, not linked-but-failed files", () => {
    const doc = (id: string, documentType: DocumentSummary["documentType"], processingStatus: DocumentSummary["processingStatus"], pageCount: number | null = null) =>
      ({ id, documentType, processingStatus, pageCount }) as DocumentSummary;
    const subject = {
      coverage: {
        weeks: [
          { lectureMaterial: true, needsVerification: false },
          { lectureMaterial: false, needsVerification: true },
        ],
      },
    } as unknown as Subject;
    const summary = summarizeCoverage(subject, [
      doc("o", "weekly_overview", "completed"),
      doc("a", "presentation", "completed"),
      doc("b", "presentation", "failed"),
      doc("t", "textbook", "partially_processed", 412),
    ]);
    expect(summary).toMatchObject({
      totalDocuments: 3,
      usableDocuments: 2,
      failedDocuments: 1,
      lectureDecks: 2,
      textbookPages: 412,
      totalWeeks: 2,
      weeksWithLectureMaterial: 1,
      weeksNeedingVerification: 1,
      lectureCoveragePercent: 50,
    });
  });
});
