import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { CurriculumSchema, QuestionBankSchema, type AssessmentEvent, type Session } from "@/modules/curriculum/schemas";
import { lastSession, sourceUnitHref, upcomingAssessments, upcomingSessions } from "@/modules/curriculum/schedule";
import { buildPlan } from "@/modules/learning/planner";
import { emptyState, isDue, masteryBySession, scheduleCard, studyStreak, weakSessions } from "@/modules/learning/state";
import { Bm25Index, stem, tokenize, type RetrievalDoc } from "@/modules/tutor/bm25";

const FIXTURE = path.resolve(__dirname, "../e2e/.fixture-data/processed");

function session(key: string, date: string | null, extra: Partial<Record<string, unknown>> = {}): Session {
  return CurriculumSchema.parse({
    subject_key: "s",
    sessions: [{ key, module: 2, numbering: "class", number: Number(key.slice(-2)), label: `Class ${key.slice(-2)}`, title: `Topic ${key}`, date, ...extra }],
  }).sessions[0];
}

function event(key: string, date: string, sourceKind: string, extra: Partial<AssessmentEvent> = {}): AssessmentEvent {
  return { key, title: key, date, detail: null, how: null, source: sourceKind, sourceKind, conflict: null, ...extra };
}

describe("curriculum contract (Python → TypeScript)", () => {
  it.runIf(existsSync(path.join(FIXTURE, "curriculum.json")))("parses the pipeline's curriculum.json and questions.json", () => {
    const curriculum = CurriculumSchema.parse(JSON.parse(readFileSync(path.join(FIXTURE, "curriculum.json"), "utf8")));
    expect(curriculum.subjectKey).toBeTruthy();
    expect(Array.isArray(curriculum.sessions)).toBe(true);
    const bank = QuestionBankSchema.parse(JSON.parse(readFileSync(path.join(FIXTURE, "questions.json"), "utf8")));
    expect(Array.isArray(bank.questions)).toBe(true);
  });

  it("maps snake case and keeps evidence labels", () => {
    const s = session("M2-C05", "2031-11-25", {
      plan_week: { week_id: "w13", ordinal: 13, label: "Week 13", basis: "date", verification: "source_confirmed" },
      documents: [{ document_id: "d", filename: "r.pdf", role: "reading", evidence: ["Class 5 on page 1"], verification: "source_confirmed" }],
      further_reading: [
        { book_key: "k", book_document_id: "b", book_title: "Book", cited_in: "r.pdf", cited_at: "page 6", resolved: [{ title: "2.2.5 Web Caching", page_start: 119, page_end: 123, verification: "source_confirmed" }] },
      ],
    });
    expect(s.planWeek).toEqual({ weekId: "w13", ordinal: 13, label: "Week 13", basis: "date", verification: "source_confirmed" });
    expect(s.documents[0].documentId).toBe("d");
    expect(s.furtherReading[0].resolved[0]).toMatchObject({ pageStart: 119, pageEnd: 123 });
  });
});

describe("schedule", () => {
  const sessions = [session("M2-C01", "2031-11-16"), session("M2-C02", "2031-11-17"), session("M2-C03", null), session("M2-C05", "2031-11-25")];

  it("finds the next and last dated sessions", () => {
    expect(upcomingSessions(sessions, "2031-11-21").map((s) => s.key)).toEqual(["M2-C05"]);
    expect(upcomingSessions(sessions, "2031-11-17", 2).map((s) => s.key)).toEqual(["M2-C02", "M2-C05"]);
    expect(lastSession(sessions, "2031-11-21")?.key).toBe("M2-C02");
  });

  it("groups assessments, prefers the module schedule and flags conflicts", () => {
    const groups = upcomingAssessments(
      [
        event("practical-2", "2031-11-24", "weekly_overview"),
        event("practical-2", "2031-12-06", "module_schedule"),
        event("quiz-2", "2031-11-27", "module_schedule"),
        event("class-test-1", "2031-11-22", "lms"),
        event("in-class-exam-2", "2031-11-25", "weekly_overview", { conflict: "schedule lists Class 5" }),
        event("old", "2031-10-01", "weekly_overview"),
      ],
      "2031-11-21",
    );
    expect(groups.map((g) => [g.key, g.date, g.conflict])).toEqual([
      ["in-class-exam-2", "2031-11-25", true],
      ["quiz-2", "2031-11-27", false],
      ["practical-2", "2031-12-06", true],
    ]);
  });

  it("links to a unit inside the paginated source viewer", () => {
    expect(sourceUnitHref("doc", 1)).toBe("/sources/doc?page=1#unit-1");
    expect(sourceUnitHref("doc", 25)).toBe("/sources/doc?page=3#unit-25");
  });
});

describe("learning state", () => {
  it("computes mastery from the latest attempt per question only", () => {
    const state = emptyState();
    state.attempts.push(
      { id: "1", questionId: "q1", sessionKeys: ["A"], result: "incorrect", at: "2031-11-01T10:00:00Z" },
      { id: "2", questionId: "q1", sessionKeys: ["A"], result: "correct", at: "2031-11-02T10:00:00Z" },
      { id: "3", questionId: "q2", sessionKeys: ["A"], result: "partial", at: "2031-11-02T10:00:00Z" },
      { id: "4", questionId: "q3", sessionKeys: ["B"], result: "incorrect", at: "2031-11-02T10:00:00Z" },
      { id: "5", questionId: "q4", sessionKeys: ["B"], result: "incorrect", at: "2031-11-02T10:00:00Z" },
    );
    const mastery = masteryBySession(state, new Map([["A", ["q1", "q2", "q5"]], ["B", ["q3", "q4"]], ["C", ["q9"]]]));
    expect(mastery.get("A")).toEqual({ score: 75, attempted: 2, total: 3, attempts: 3 });
    expect(mastery.get("C")?.score).toBeNull(); // nothing answered → no score, never 0%
    expect(weakSessions(mastery)).toEqual(["B"]);
  });

  it("schedules flashcards with growing intervals and resets on 'again'", () => {
    const first = scheduleCard(undefined, "good", "2031-11-21");
    expect(first).toMatchObject({ intervalDays: 1, due: "2031-11-22", reps: 1 });
    const second = scheduleCard(first, "good", "2031-11-22");
    expect(second.intervalDays).toBe(6);
    const third = scheduleCard(second, "good", "2031-11-28");
    expect(third.intervalDays).toBeGreaterThan(6);
    const lapse = scheduleCard(third, "again", "2031-12-10");
    expect(lapse).toMatchObject({ intervalDays: 1, reps: 0, lapses: 1 });
    expect(lapse.ease).toBeLessThan(third.ease);
    expect(isDue(undefined, "2031-11-21")).toBe(true);
    expect(isDue(first, "2031-11-21")).toBe(false);
  });

  it("counts a study streak ending today or yesterday", () => {
    const state = emptyState();
    for (const date of ["2031-11-18", "2031-11-19", "2031-11-20"]) state.studyLog.push({ date, kind: "attempt", ref: "q" });
    expect(studyStreak(state, "2031-11-21")).toBe(3);
    expect(studyStreak(state, "2031-11-23")).toBe(0);
  });
});

describe("planner", () => {
  it("plans reading before class, catch-up and assessment prep with reasons", () => {
    const withReading = { documents: [{ document_id: "r", filename: "r.pdf", role: "reading", evidence: [], verification: "source_confirmed" }] };
    const sessions = [session("M2-C04", "2031-11-19"), session("M2-C05", "2031-11-25", withReading), session("M2-C06", "2031-11-26", withReading)];
    const plan = buildPlan({
      today: "2031-11-21",
      sessions,
      assessments: [{ key: "quiz-2", title: "Quiz 2", date: "2031-11-27", events: [event("quiz-2", "2031-11-27", "module_schedule")], conflict: false }],
      state: emptyState(),
      mastery: new Map(),
      weak: [],
      dueCards: 0,
    });
    const prep = plan.find((t) => t.id === "prepare:M2-C05");
    expect(prep).toMatchObject({ date: "2031-11-24", kind: "prepare" });
    expect(prep?.why).toMatch(/read before class/);
    expect(plan.find((t) => t.id === "review:M2-C04")?.date).toBe("2031-11-21");
    expect(plan.find((t) => t.id === "assessment:quiz-2")?.date).toBe("2031-11-25");
    expect(plan.every((t) => t.why.length > 0)).toBe(true);
    expect([...plan].map((t) => t.date)).toEqual([...plan].map((t) => t.date).sort());
  });
});

describe("BM25 retrieval", () => {
  const doc = (id: string, content: string, tier: 1 | 2 = 1, sessionKeys: string[] = [], documentId = id): RetrievalDoc => ({
    id,
    documentId,
    filename: `${id}.pdf`,
    citation: `${id}.pdf, page 1`,
    content,
    tier,
    sessionKeys,
  });

  it("tokenizes and stems simply", () => {
    expect(tokenize("What are the Layers of 192.168.1.0/24?")).toEqual(["layer", "192.168.1.0/24"]);
    expect(stem("caches")).toBe("cach");
    expect(stem("switches")).toBe("switch");
  });

  it("ranks relevant passages, prefers course material and the focused session, and diversifies documents", () => {
    const index = new Bm25Index([
      doc("hub", "A hub repeats every frame to all ports. A switch learns MAC addresses."),
      doc("book", "A switch forwards frames using a switch table of MAC addresses.", 2),
      doc("cache", "A cache keeps recently used data close to the processor."),
      doc("s1", "switch switch learning table MAC", 1, ["M2-C04"], "same"),
      doc("s2", "switch MAC table flooding", 1, ["M2-C04"], "same"),
      doc("s3", "switch MAC frames", 1, ["M2-C04"], "same"),
      doc("s4", "switch MAC", 1, ["M2-C04"], "same"),
    ]);
    const hits = index.search("How does a switch learn MAC addresses?", { sessionKeys: ["M2-C04"], perDocument: 2 });
    expect(hits[0].doc.sessionKeys).toContain("M2-C04");
    expect(hits.filter((h) => h.doc.documentId === "same")).toHaveLength(2);
    expect(hits.some((h) => h.doc.id === "cache")).toBe(false);
    expect(index.search("the of and")).toEqual([]);
  });
});

describe("tutor grounding", () => {
  it("drops citations that were not retrieved and never calls the model without passages", async () => {
    vi.resetModules();
    const hit = { doc: doc2("c1", "Reading_04.pdf, page 2", "A switch learns MAC addresses from source addresses."), score: 3 };
    vi.doMock("@/modules/tutor/retrieval", () => ({ retrieve: vi.fn(async (_s: string, q: string) => (q.includes("nothing") ? [] : [hit])) }));
    vi.doMock("@/lib/config/env", () => ({ aiConfig: () => ({ configured: true, model: "test", effort: "low" }) }));
    const generateStructured = vi.fn(async () => ({
      data: {
        sections: [
          { kind: "source", text: "Switches learn from source MACs.", citations: ["Reading_04.pdf, page 2", "Invented.pdf, slide 99"] },
          { kind: "source", text: "Made-up claim.", citations: ["Invented.pdf, slide 1"] },
          { kind: "supplementary", text: "Like a post office learning addresses.", citations: ["Reading_04.pdf, page 2"] },
        ],
        used_outside_material: false,
      },
      model: "test",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
      latencyMs: 1,
    }));
    vi.doMock("@/lib/ai", () => ({ getAIProvider: () => ({ generateStructured }), AIError: class extends Error {} }));
    const { askTutor } = await import("@/modules/tutor/service");

    const answer = await askTutor({ subjectKey: "s", question: "How does a switch learn?", level: "beginner" });
    expect(answer.mode).toBe("ai");
    expect(answer.sections[0].citations).toEqual(["Reading_04.pdf, page 2"]);
    expect(answer.sections[1]).toMatchObject({ kind: "supplementary", citations: [] }); // invalid-only citations → not source-backed
    expect(answer.sections[2].citations).toEqual([]);
    expect(answer.usedOutsideMaterial).toBe(true);

    const none = await askTutor({ subjectKey: "s", question: "nothing matches", level: "beginner" });
    expect(none.answer).toBeNull();
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });
});

function doc2(id: string, citation: string, content: string): RetrievalDoc {
  return { id, documentId: id, filename: citation.split(",")[0], citation, content, tier: 1, sessionKeys: [] };
}
