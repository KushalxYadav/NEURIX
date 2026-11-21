import "server-only";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { getDataMode } from "@/lib/config/env";
import { getCurriculum } from "@/modules/curriculum";
import { localDataDir } from "@/modules/sources";

import { Bm25Index, type Hit, type RetrievalDoc } from "./bm25";

let cached: { mtimeMs: number; index: Bm25Index } | null = null;

/**
 * Local retrieval index over `data/processed/chunks.jsonl`. Rebuilt only when
 * the pipeline rewrites the file. Low-information chunks and excluded
 * student work never enter the index.
 */
async function loadIndex(subjectKey: string): Promise<Bm25Index | null> {
  if (getDataMode() !== "local") return null;
  const file = path.join(/*turbopackIgnore: true*/ localDataDir(), "processed", "chunks.jsonl");
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
  if (cached?.mtimeMs === mtimeMs) return cached.index;

  const { curriculum } = await getCurriculum(subjectKey);
  const sessionsByDoc = new Map<string, string[]>();
  const excluded = new Set<string>();
  for (const session of curriculum?.sessions ?? []) {
    for (const doc of session.documents) sessionsByDoc.set(doc.documentId, [...(sessionsByDoc.get(doc.documentId) ?? []), session.key]);
  }
  for (const resource of curriculum?.moduleResources ?? []) if (resource.role === "student_work") excluded.add(resource.documentId);

  const docs: RetrievalDoc[] = [];
  for (const line of (await readFile(file, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as {
      id: string;
      document_id: string;
      original_filename: string;
      document_type: string;
      content: string;
      citation?: string;
      low_information?: boolean;
    };
    if (row.low_information || excluded.has(row.document_id) || !row.content?.trim()) continue;
    docs.push({
      id: row.id,
      documentId: row.document_id,
      filename: row.original_filename,
      citation: row.citation ?? row.original_filename,
      content: row.content,
      tier: row.document_type === "textbook" ? 2 : 1,
      sessionKeys: sessionsByDoc.get(row.document_id) ?? [],
    });
  }
  const index = new Bm25Index(docs);
  cached = { mtimeMs, index };
  return index;
}

export async function retrieve(
  subjectKey: string,
  query: string,
  options: { limit?: number; sessionKeys?: string[] } = {},
): Promise<Hit[]> {
  const index = await loadIndex(subjectKey);
  return index ? index.search(query, options) : [];
}

export type { Hit, RetrievalDoc } from "./bm25";
