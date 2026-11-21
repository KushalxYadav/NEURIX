import "server-only";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { getDataMode } from "@/lib/config/env";
import { localDataDir } from "@/modules/sources";
import { SourceDataError } from "@/modules/sources/types";

import { CurriculumSchema, QuestionBankSchema, type Curriculum, type QuestionBank } from "./schemas";

const HINT = "Run `.venv/bin/python scripts/run_pipeline.py` to (re)generate data/processed/.";

type Cached<T> = { mtimeMs: number; value: T };
const cache = new Map<string, Cached<unknown>>();

async function loadJson<T>(file: string, parse: (raw: unknown) => T): Promise<T | null> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
  const hit = cache.get(file) as Cached<T> | undefined;
  if (hit?.mtimeMs === mtimeMs) return hit.value;
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new SourceDataError(`Could not read ${path.basename(file)}: ${(error as Error).message}`, HINT);
  }
  const value = parse(raw);
  cache.set(file, { mtimeMs, value });
  return value;
}

function processed(name: string) {
  return path.join(/*turbopackIgnore: true*/ localDataDir(), "processed", name);
}

export interface CurriculumAvailability {
  curriculum: Curriculum | null;
  /** Why the curriculum is missing, for an honest empty state. */
  reason: "ok" | "not_generated" | "not_in_this_mode";
}

/**
 * The curriculum for a subject. It is produced locally by the pipeline; in
 * Supabase mode it is not loaded into the database yet, and this says so
 * instead of pretending.
 */
export async function getCurriculum(subjectKey: string): Promise<CurriculumAvailability> {
  if (getDataMode() !== "local") return { curriculum: null, reason: "not_in_this_mode" };
  const curriculum = await loadJson(processed("curriculum.json"), (raw) => {
    const parsed = CurriculumSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new SourceDataError(`curriculum.json is incompatible (${issue?.path.join(".")}: ${issue?.message}).`, HINT);
    }
    return parsed.data;
  });
  if (!curriculum || curriculum.subjectKey !== subjectKey) return { curriculum: null, reason: "not_generated" };
  return { curriculum, reason: "ok" };
}

const EMPTY_BANK: QuestionBank = { questions: [], terms: [] };

export async function getQuestionBank(): Promise<QuestionBank> {
  if (getDataMode() !== "local") return EMPTY_BANK;
  const bank = await loadJson(processed("questions.json"), (raw) => {
    const parsed = QuestionBankSchema.safeParse(raw);
    if (!parsed.success) throw new SourceDataError("questions.json is incompatible.", HINT);
    return parsed.data;
  });
  return bank ?? EMPTY_BANK;
}

export type { AssessmentEvent, Curriculum, Discrepancy, KeyTerm, PracticeQuestion, QuestionBank, Session } from "./schemas";
