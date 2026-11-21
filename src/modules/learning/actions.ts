"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { getSubjectContext } from "@/lib/server/context";
import { getCurriculum, getQuestionBank } from "@/modules/curriculum";
import { askTutor, type TutorAnswer, type TutorLevel } from "@/modules/tutor/service";

import { AttemptResult, SessionStatus, scheduleCard, type Grade } from "./state";
import { newId, storeAvailability, updateState } from "./store";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function knownSessionKeys(): Promise<Set<string>> {
  const { subject } = await getSubjectContext();
  if (!subject) return new Set();
  const { curriculum } = await getCurriculum(subject.id);
  return new Set(curriculum?.sessions.map((s) => s.key) ?? []);
}

async function guard(): Promise<ActionResult | null> {
  const availability = storeAvailability();
  return availability.available ? null : { ok: false, error: availability.reason };
}

export async function setSessionStatus(sessionKey: string, status: string): Promise<ActionResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  const parsed = SessionStatus.safeParse(status);
  if (!parsed.success || !(await knownSessionKeys()).has(sessionKey)) return { ok: false, error: "Unknown session." };
  await updateState((state) => {
    state.sessions[sessionKey] = { status: parsed.data, updatedAt: new Date().toISOString() };
    state.studyLog.push({ date: today(), kind: "session_status", ref: sessionKey, detail: parsed.data });
  });
  refresh();
  return { ok: true };
}

export async function recordAttempt(questionId: string, result: string): Promise<ActionResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  const parsed = AttemptResult.safeParse(result);
  // The question (and its sessions) come from the pipeline's bank, never from the client.
  const question = (await getQuestionBank()).questions.find((q) => q.id === questionId);
  if (!parsed.success || !question) return { ok: false, error: "Unknown question." };
  await updateState((state) => {
    state.attempts.push({ id: newId(), questionId, sessionKeys: question.sessionKeys, result: parsed.data, at: new Date().toISOString() });
    state.studyLog.push({ date: today(), kind: "attempt", ref: questionId, detail: parsed.data });
    for (const key of question.sessionKeys) {
      if (!state.sessions[key] || state.sessions[key].status === "not_started") {
        state.sessions[key] = { status: "in_progress", updatedAt: new Date().toISOString() };
      }
    }
  });
  refresh();
  return { ok: true };
}

const GradeSchema = z.enum(["again", "hard", "good", "easy"]);

export async function reviewCard(cardId: string, grade: string): Promise<ActionResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  const parsed = GradeSchema.safeParse(grade);
  const bank = await getQuestionBank();
  const exists = bank.terms.some((t) => t.id === cardId) || bank.questions.some((q) => q.id === cardId && q.answer);
  if (!parsed.success || !exists) return { ok: false, error: "Unknown card." };
  await updateState((state) => {
    state.cards[cardId] = scheduleCard(state.cards[cardId], parsed.data as Grade, today());
    state.studyLog.push({ date: today(), kind: "flashcard", ref: cardId, detail: parsed.data });
  });
  refresh();
  return { ok: true };
}

const NoteInput = z.object({
  id: z.string().uuid().optional(),
  sessionKey: z.string().max(40).nullable(),
  title: z.string().trim().min(1, "Give the note a title.").max(160),
  body: z.string().trim().min(1, "Write something first.").max(20000),
});

export interface NoteFormState extends ActionResult {
  savedAt?: string;
}

export async function saveNote(_: NoteFormState, formData: FormData): Promise<NoteFormState> {
  const blocked = await guard();
  if (blocked) return blocked;
  const parsed = NoteInput.safeParse({
    id: formData.get("id") || undefined,
    sessionKey: formData.get("sessionKey") || null,
    title: formData.get("title") ?? "",
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const { id, sessionKey, title, body } = parsed.data;
  if (sessionKey && !(await knownSessionKeys()).has(sessionKey)) return { ok: false, error: "Unknown session." };
  const now = new Date().toISOString();
  const saved = await updateState((state) => {
    const existing = id ? state.notes.find((n) => n.id === id) : undefined;
    if (id && !existing) return false;
    if (existing) Object.assign(existing, { title, body, sessionKey, updatedAt: now });
    else state.notes.push({ id: newId(), sessionKey, title, body, createdAt: now, updatedAt: now });
    state.studyLog.push({ date: today(), kind: "note", ref: sessionKey ?? "general" });
    return true;
  });
  if (!saved) return { ok: false, error: "That note no longer exists." };
  refresh();
  return { ok: true, savedAt: now };
}

export async function deleteNote(id: string): Promise<ActionResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Unknown note." };
  await updateState((state) => {
    state.notes = state.notes.filter((n) => n.id !== id);
  });
  refresh();
  return { ok: true };
}

const TutorInput = z.object({
  question: z.string().trim().min(3, "Ask a question.").max(1500),
  level: z.enum(["beginner", "university", "exam"]),
  sessionKey: z.string().max(40).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(12)
    .default([]),
});

export async function askTutorAction(input: unknown): Promise<{ ok: true; answer: TutorAnswer } | { ok: false; error: string }> {
  const parsed = TutorInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid question." };
  const { subject } = await getSubjectContext();
  if (!subject) return { ok: false, error: "No subject has been processed yet." };
  const sessionKeys = parsed.data.sessionKey && (await knownSessionKeys()).has(parsed.data.sessionKey) ? [parsed.data.sessionKey] : [];
  const answer = await askTutor({
    subjectKey: subject.id,
    question: parsed.data.question,
    level: parsed.data.level as TutorLevel,
    sessionKeys,
    history: parsed.data.history,
  });
  if (storeAvailability().available) {
    await updateState((state) => {
      state.studyLog.push({ date: today(), kind: "tutor", ref: sessionKeys[0] ?? "general" });
    });
  }
  return { ok: true, answer };
}
