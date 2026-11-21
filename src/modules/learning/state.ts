import { z } from "zod";

/**
 * Learning state: what the student did (not what they opened). Shared by the
 * local file store and, later, the Supabase tables (topic_mastery, attempts,
 * notes, flashcard_reviews, study_tasks). Pure functions only.
 */
export const SessionStatus = z.enum(["not_started", "in_progress", "studied"]);
export const AttemptResult = z.enum(["correct", "partial", "incorrect"]);

export const LearningStateSchema = z.object({
  version: z.literal(1).default(1),
  sessions: z
    .record(z.string(), z.object({ status: SessionStatus, updatedAt: z.string() }))
    .default({}),
  attempts: z
    .array(
      z.object({
        id: z.string(),
        questionId: z.string(),
        sessionKeys: z.array(z.string()).default([]),
        result: AttemptResult,
        at: z.string(),
      }),
    )
    .default([]),
  notes: z
    .array(
      z.object({
        id: z.string(),
        sessionKey: z.string().nullable(),
        title: z.string(),
        body: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    )
    .default([]),
  cards: z
    .record(
      z.string(),
      z.object({
        ease: z.number(),
        intervalDays: z.number(),
        due: z.string(),
        reps: z.number(),
        lapses: z.number(),
        lastReviewed: z.string(),
      }),
    )
    .default({}),
  studyLog: z
    .array(z.object({ date: z.string(), kind: z.string(), ref: z.string(), detail: z.string().optional() }))
    .default([]),
});

export type LearningState = z.infer<typeof LearningStateSchema>;
export type Attempt = LearningState["attempts"][number];
export type Note = LearningState["notes"][number];
export type CardState = LearningState["cards"][string];
export type Grade = "again" | "hard" | "good" | "easy";

export function emptyState(): LearningState {
  return LearningStateSchema.parse({});
}

const SCORE: Record<z.infer<typeof AttemptResult>, number> = { correct: 1, partial: 0.5, incorrect: 0 };

export interface Mastery {
  /** 0–100 from the latest attempt on each answered question; null if none answered. */
  score: number | null;
  attempted: number;
  total: number;
  attempts: number;
}

/**
 * Mastery for each session from the latest attempt per question. Opening
 * material never raises it; only answered checkpoints and quizzes do.
 */
export function masteryBySession(
  state: LearningState,
  questionsBySession: Map<string, string[]>,
): Map<string, Mastery> {
  const latest = new Map<string, Attempt>();
  for (const attempt of state.attempts) {
    const prev = latest.get(attempt.questionId);
    if (!prev || prev.at <= attempt.at) latest.set(attempt.questionId, attempt);
  }
  const out = new Map<string, Mastery>();
  for (const [sessionKey, questionIds] of questionsBySession) {
    const answered = questionIds.map((id) => latest.get(id)).filter((a): a is Attempt => Boolean(a));
    const attempts = state.attempts.filter((a) => questionIds.includes(a.questionId)).length;
    out.set(sessionKey, {
      score: answered.length ? Math.round((answered.reduce((sum, a) => sum + SCORE[a.result], 0) / answered.length) * 100) : null,
      attempted: answered.length,
      total: questionIds.length,
      attempts,
    });
  }
  return out;
}

/** Weak = at least two answered questions and under 60%. */
export function weakSessions(mastery: Map<string, Mastery>): string[] {
  return [...mastery.entries()]
    .filter(([, m]) => m.score != null && m.attempted >= 2 && m.score < 60)
    .sort((a, b) => (a[1].score ?? 0) - (b[1].score ?? 0))
    .map(([key]) => key);
}

/** SM-2 style scheduling, simplified to four grades. */
export function scheduleCard(previous: CardState | undefined, grade: Grade, today: string): CardState {
  const base: CardState = previous ?? { ease: 2.5, intervalDays: 0, due: today, reps: 0, lapses: 0, lastReviewed: today };
  let { ease, intervalDays, reps, lapses } = base;
  if (grade === "again") {
    lapses += 1;
    reps = 0;
    intervalDays = 1;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    reps += 1;
    const factor = grade === "hard" ? 1.2 : grade === "easy" ? ease * 1.3 : ease;
    intervalDays = reps === 1 ? (grade === "easy" ? 3 : 1) : reps === 2 ? (grade === "hard" ? 3 : 6) : Math.round(Math.max(1, intervalDays) * factor);
    ease = Math.max(1.3, ease + (grade === "hard" ? -0.15 : grade === "easy" ? 0.15 : 0));
  }
  return { ease: Number(ease.toFixed(2)), intervalDays, due: shiftDate(today, intervalDays), reps, lapses, lastReviewed: today };
}

export function isDue(card: CardState | undefined, today: string): boolean {
  return !card || card.due <= today;
}

export function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Consecutive days (ending today or yesterday) with any study activity. */
export function studyStreak(state: LearningState, today: string): number {
  const days = new Set(state.studyLog.map((e) => e.date));
  let streak = 0;
  let cursor = days.has(today) ? today : shiftDate(today, -1);
  while (days.has(cursor)) {
    streak += 1;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}
