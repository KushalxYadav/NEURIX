import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LocalIndexSchema, LocalUnitSchema } from "@/modules/sources/local-schemas";
import { LocalSourceRepository } from "@/modules/sources/local-repository";
import { SourceDataError } from "@/modules/sources/types";

const FIXTURE = path.resolve(__dirname, "../e2e/.fixture-data/processed");

function minimalIndex(name: string) {
  return {
    schema_version: 1,
    generated_at: "2026-11-20T10:00:00+00:00",
    subject: { key: "test-subject", name, name_source: "manual", archive_filename: "archive.zip" },
    weekly_overview: { source_file: "index.html", title: name, parser_strategy: null, warnings: [], other_sections: [] },
    textbook: { selected: null, selection_reason: null },
    stats: { documents: 1, content_units: 2, chunks: 2, slides: 2, pages: 0, sections: 0, words: 10, by_status: { completed: 1 }, by_type: {} },
    coverage: {},
    weeks: [
      {
        id: "week-1", ordinal: 1, label: "Week 1: Intro", label_kind: "week", week_number: 1, week_number_source: "explicit",
        date_range: null, topics: [{ text: "Intro", origin: "overview_text" }], learning_objectives: [], references: [],
        resources: [], document_ids: ["doc-1"],
      },
    ],
    documents: [
      {
        id: "doc-1", original_filename: "deck.pptx", source_path: "Week 1/deck.pptx", archive_paths: ["Week 1/deck.pptx"],
        document_type: "presentation", format: "pptx", size_bytes: 100, title: null, page_count: null, slide_count: 2,
        word_count: 10, unit_count: 2, chunk_count: 2, processing_status: "completed", errors: [], warnings: [],
        converted_from: null, processed_at: null,
        week_associations: [{ week_id: "week-1", week_ordinal: 1, source: "overview_link", verification: "source_confirmed", evidence: "linked" }],
        chapters: [], quality: null,
      },
    ],
    files: [],
  };
}

async function writeData(index: unknown, units: unknown[] = []) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-local-"));
  await mkdir(path.join(dir, "processed"));
  await writeFile(path.join(dir, "processed", "source_index.json"), JSON.stringify(index));
  await writeFile(path.join(dir, "processed", "content_units.jsonl"), units.map((u) => JSON.stringify(u)).join("\n"));
  return dir;
}

const unit = (n: number) => ({
  id: `u${n}`, document_id: "doc-1", unit_type: "slide", unit_number: n, slide_number: n, title: `Slide ${n}`,
  text: `text ${n}`, notes: "", flags: {}, citation: `deck.pptx, slide ${n}`, word_count: 2, heading_path: [],
});

describe("LocalSourceRepository", () => {
  it("returns null when nothing has been processed", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-empty-"));
    expect(await new LocalSourceRepository(dir).getActiveSubject()).toBeNull();
  });

  it("maps the pipeline index into the domain model", async () => {
    const repo = new LocalSourceRepository(await writeData(minimalIndex("Networks"), [unit(2), unit(1)]));
    const subject = await repo.getActiveSubject();
    expect(subject).toMatchObject({ id: "test-subject", name: "Networks", ingestionStatus: "completed" });
    const [document] = await repo.listDocuments("test-subject");
    expect(document.weekAssociations[0]).toMatchObject({ weekOrdinal: 1, evidence: "source_confirmed" });
    const page = await repo.listDocumentUnits("test-subject", "doc-1", { offset: 0, limit: 1 });
    expect(page.total).toBe(2);
    expect(page.items[0]).toMatchObject({ slideNumber: 1, citation: "deck.pptx, slide 1" });
    expect(await repo.listWeeks("other-subject")).toEqual([]);
  });

  it("re-reads the index when the pipeline rewrites it", async () => {
    const dir = await writeData(minimalIndex("First"));
    const repo = new LocalSourceRepository(dir);
    expect((await repo.getActiveSubject())?.name).toBe("First");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(path.join(dir, "processed", "source_index.json"), JSON.stringify(minimalIndex("Second")));
    expect((await repo.getActiveSubject())?.name).toBe("Second");
  });

  it("reports incompatible data instead of rendering partial content", async () => {
    const broken = { ...minimalIndex("x"), documents: [{ id: 1 }] };
    const repo = new LocalSourceRepository(await writeData(broken));
    await expect(repo.getActiveSubject()).rejects.toBeInstanceOf(SourceDataError);
  });
});

describe.runIf(existsSync(FIXTURE))("contract with the Python pipeline output", () => {
  it("validates source_index.json and every content unit", async () => {
    const index = JSON.parse(await readFile(path.join(FIXTURE, "source_index.json"), "utf8"));
    expect(() => LocalIndexSchema.parse(index)).not.toThrow();
    const lines = (await readFile(path.join(FIXTURE, "content_units.jsonl"), "utf8")).split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) LocalUnitSchema.parse(JSON.parse(line));
  });
});
