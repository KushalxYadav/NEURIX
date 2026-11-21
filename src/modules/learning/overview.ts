import "server-only";

import { cache } from "react";

import { getSubjectContext } from "@/lib/server/context";
import { getCurriculum, getQuestionBank, type Curriculum, type QuestionBank } from "@/modules/curriculum";

import { masteryBySession, weakSessions, type LearningState, type Mastery } from "./state";
import { readState, storeAvailability, type StoreAvailability } from "./store";

export interface LearningOverview {
  subjectId: string;
  subjectName: string;
  curriculum: Curriculum;
  bank: QuestionBank;
  state: LearningState;
  mastery: Map<string, Mastery>;
  weak: string[];
  questionsBySession: Map<string, string[]>;
  store: StoreAvailability;
  today: string;
}

export type LearningLoad =
  | { kind: "ready"; overview: LearningOverview }
  | { kind: "no_subject"; mode: "local" | "supabase" }
  | { kind: "no_curriculum"; reason: "not_generated" | "not_in_this_mode" | "no_sessions" };

/** Everything the learning pages need, once per request. */
export const loadLearning = cache(async (): Promise<LearningLoad> => {
  const { repo, subject } = await getSubjectContext();
  if (!subject) return { kind: "no_subject", mode: repo.mode };
  const { curriculum, reason } = await getCurriculum(subject.id);
  if (!curriculum) return { kind: "no_curriculum", reason: reason === "ok" ? "not_generated" : reason };
  if (curriculum.sessions.length === 0) return { kind: "no_curriculum", reason: "no_sessions" };
  const [bank, state] = await Promise.all([getQuestionBank(), readState()]);
  const questionsBySession = new Map<string, string[]>();
  for (const session of curriculum.sessions) questionsBySession.set(session.key, []);
  for (const question of bank.questions) {
    for (const key of question.sessionKeys) questionsBySession.get(key)?.push(question.id);
  }
  const mastery = masteryBySession(state, questionsBySession);
  return {
    kind: "ready",
    overview: {
      subjectId: subject.id,
      subjectName: subject.name,
      curriculum,
      bank,
      state,
      mastery,
      weak: weakSessions(mastery),
      questionsBySession,
      store: storeAvailability(),
      today: new Date().toISOString().slice(0, 10),
    },
  };
});

/** Questions for a module that are not tied to one session (practice sets, quizzes). */
export function moduleQuestions(bank: QuestionBank, module: number | null) {
  return bank.questions.filter((q) => q.sessionKeys.length === 0 && (module == null || q.module === module || q.module == null));
}
