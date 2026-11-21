import type { Session } from "@/modules/curriculum/schemas";
import { addDays, type AssessmentGroup } from "@/modules/curriculum/schedule";

import type { LearningState, Mastery } from "./state";

/**
 * Study plan for the next days, derived (not stored) from the dated schedule,
 * the student's own progress and due flashcards. Every task says why it
 * exists. Pure function — unit-tested.
 */
export interface PlanTask {
  id: string;
  date: string;
  kind: "prepare" | "review" | "practice" | "flashcards" | "assessment" | "catch_up";
  title: string;
  why: string;
  href: string;
  minutes: number;
  done: boolean;
}

export interface PlanInput {
  today: string;
  sessions: Session[];
  assessments: AssessmentGroup[];
  state: LearningState;
  mastery: Map<string, Mastery>;
  weak: string[];
  dueCards: number;
  days?: number;
}

export function buildPlan({ today, sessions, assessments, state, mastery, weak, dueCards, days = 7 }: PlanInput): PlanTask[] {
  const tasks: PlanTask[] = [];
  const end = addDays(today, days - 1);
  const status = (key: string) => state.sessions[key]?.status ?? "not_started";
  const doneToday = new Set(state.studyLog.filter((e) => e.date === today).map((e) => `${e.kind}:${e.ref}`));
  const href = (key: string) => `/learning/${encodeURIComponent(key)}`;

  // 1. Prepare for upcoming classes: the reading comes before the class.
  for (const session of sessions) {
    if (!session.date || session.date < today || session.date > addDays(end, 1)) continue;
    const prepDay = session.date === today ? today : addDays(session.date, -1) < today ? today : addDays(session.date, -1);
    if (prepDay > end) continue;
    const hasReading = session.documents.some((d) => d.role === "reading");
    tasks.push({
      id: `prepare:${session.key}`,
      date: prepDay,
      kind: "prepare",
      title: `${hasReading ? "Read" : "Preview"} ${session.label}: ${session.title}`,
      why: `Class on ${session.date}${hasReading ? " — the schedule asks you to read before class" : ""}.`,
      href: href(session.key),
      minutes: hasReading ? 40 : 25,
      done: status(session.key) !== "not_started",
    });
  }

  // 2. Recently delivered sessions not yet consolidated (last 14 days).
  const recent = sessions.filter((s) => s.date && s.date < today && s.date >= addDays(today, -14) && status(s.key) !== "studied");
  recent.forEach((session, i) => {
    tasks.push({
      id: `review:${session.key}`,
      date: addDays(today, Math.min(i, days - 1)),
      kind: "review",
      title: `Consolidate ${session.label}: ${session.title}`,
      why: `Taught on ${session.date} and not marked as studied yet.`,
      href: href(session.key),
      minutes: 30,
      done: false,
    });
  });

  // 3. Weak sessions: redo what was missed.
  weak.slice(0, 3).forEach((key, i) => {
    const session = sessions.find((s) => s.key === key);
    const m = mastery.get(key);
    if (!session || !m) return;
    tasks.push({
      id: `practice:${key}`,
      date: addDays(today, i * 2),
      kind: "practice",
      title: `Redo missed questions — ${session.label}: ${session.title}`,
      why: `Mastery ${m.score}% from ${m.attempted} answered questions.`,
      href: `/practice?scope=${encodeURIComponent(key)}`,
      minutes: 20,
      done: doneToday.has(`attempt:${key}`),
    });
  });

  // 4. Assessments: practise in the days before each one.
  for (const group of assessments) {
    if (!group.date || group.date > addDays(end, 7)) continue;
    const day = group.date <= addDays(today, 1) ? today : addDays(group.date, -2) < today ? today : addDays(group.date, -2);
    if (day > end) continue;
    tasks.push({
      id: `assessment:${group.key}`,
      date: day,
      kind: "assessment",
      title: `Prepare for ${group.title} (${group.date})`,
      why: group.conflict ? "Sources give different dates — check with your teacher." : `From ${group.events[0].source}.`,
      href: "/practice?scope=smart",
      minutes: 45,
      done: false,
    });
  }

  // 5. Catch up on undated sessions never opened (one per day, oldest first).
  const lastDated = sessions.filter((s) => s.date && s.date < today).map((s) => s.module);
  const pastModules = new Set(lastDated);
  sessions
    .filter((s) => !s.date && pastModules.has(s.module) && status(s.key) === "not_started")
    .slice(0, days)
    .forEach((session, i) => {
      tasks.push({
        id: `catch_up:${session.key}`,
        date: addDays(today, i),
        kind: "catch_up",
        title: `Catch up: ${session.label} — ${session.title}`,
        why: "Already taught in this course and not started yet.",
        href: href(session.key),
        minutes: 30,
        done: false,
      });
    });

  // 6. Flashcards every day there are due cards.
  if (dueCards > 0) {
    tasks.push({
      id: "flashcards:today",
      date: today,
      kind: "flashcards",
      title: `Review ${dueCards} flashcard${dueCards === 1 ? "" : "s"}`,
      why: "Spaced repetition: due today.",
      href: "/flashcards",
      minutes: Math.min(20, Math.max(5, Math.round(dueCards / 3))),
      done: false,
    });
  }

  const order: Record<PlanTask["kind"], number> = { assessment: 0, prepare: 1, review: 2, practice: 3, catch_up: 4, flashcards: 5 };
  return tasks.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);
}
