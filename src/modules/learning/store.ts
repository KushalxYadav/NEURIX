import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDataMode } from "@/lib/config/env";
import { localDataDir } from "@/modules/sources";

import { LearningStateSchema, emptyState, type LearningState } from "./state";

/**
 * Learning-state persistence.
 *
 * - **local mode**: one JSON file, `data/learning/state.json` (git-ignored,
 *   never deployed). Single user, this machine only. Writes are atomic
 *   (temp file + rename) and serialised through an in-process lock.
 * - **supabase mode**: not wired yet — the tables exist (attempts, notes,
 *   flashcard_reviews, topic_mastery, study_tasks) but the curriculum is not
 *   loaded into the database, so this reports "unavailable" instead of
 *   pretending to save.
 */
export type StoreAvailability = { available: true } | { available: false; reason: string };

export function storeAvailability(): StoreAvailability {
  return getDataMode() === "local"
    ? { available: true }
    : { available: false, reason: "Saving progress in Supabase mode is not implemented yet; run locally to track progress." };
}

function stateFile() {
  return path.join(/*turbopackIgnore: true*/ localDataDir(), "learning", "state.json");
}

export async function readState(): Promise<LearningState> {
  if (!storeAvailability().available) return emptyState();
  try {
    const raw = JSON.parse(await readFile(stateFile(), "utf8"));
    const parsed = LearningStateSchema.safeParse(raw);
    return parsed.success ? parsed.data : emptyState();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw error;
  }
}

let lock: Promise<unknown> = Promise.resolve();

/** Apply a mutation atomically. Mutations run one at a time. */
export async function updateState<T>(mutate: (state: LearningState) => T): Promise<T> {
  const availability = storeAvailability();
  if (!availability.available) throw new Error(availability.reason);
  const run = lock.then(async () => {
    const state = await readState();
    const result = mutate(state);
    const validated = LearningStateSchema.parse(state);
    const file = stateFile();
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(validated, null, 1), "utf8");
    await rename(temp, file);
    return result;
  });
  lock = run.catch(() => undefined);
  return run;
}

export function newId(): string {
  return randomUUID();
}
