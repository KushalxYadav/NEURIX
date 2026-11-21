import "server-only";

import { z } from "zod";

import { AIError, getAIProvider } from "@/lib/ai";
import { SOURCE_GROUNDING_POLICY, renderSources } from "@/lib/ai/prompts/grounding";
import { aiConfig } from "@/lib/config/env";

import { retrieve, type Hit } from "./retrieval";

export type TutorLevel = "beginner" | "university" | "exam";

export interface TutorPassage {
  id: string;
  citation: string;
  filename: string;
  documentId: string;
  excerpt: string;
  tier: "course" | "textbook";
}

export interface TutorAnswer {
  mode: "ai" | "retrieval_only";
  /** Markdown-light text (paragraphs and "- " bullets); null in retrieval-only mode. */
  answer: string | null;
  /** Statements labelled by origin, so the UI can badge them. */
  sections: { kind: "source" | "supplementary"; text: string; citations: string[] }[];
  passages: TutorPassage[];
  usedOutsideMaterial: boolean;
  notice: string | null;
}

const LEVEL_GUIDE: Record<TutorLevel, string> = {
  beginner: "Explain for a first-year student with no background: short sentences, one everyday analogy, define every term before using it.",
  university: "Explain at university level: precise terminology, the mechanism step by step, and one worked example where it helps.",
  exam: "Explain for exam revision: the key points a marker would look for, a model short answer, and common mistakes. Never claim a question will appear in an exam.",
};

const AnswerSchema = z.object({
  sections: z
    .array(
      z.object({
        kind: z.enum(["source", "supplementary"]),
        text: z.string().min(1).max(2500),
        citations: z.array(z.string()).max(6),
      }),
    )
    .min(1)
    .max(8),
  used_outside_material: z.boolean(),
});

function toPassage(hit: Hit): TutorPassage {
  const text = hit.doc.content.replace(/\s+/g, " ").trim();
  return {
    id: hit.doc.id,
    citation: hit.doc.citation,
    filename: hit.doc.filename,
    documentId: hit.doc.documentId,
    excerpt: text.length > 420 ? `${text.slice(0, 420)}…` : text,
    tier: hit.doc.tier === 1 ? "course" : "textbook",
  };
}

/**
 * Answer a question from the course material. Retrieval always runs locally;
 * Claude is called only when configured, with the retrieved excerpts as the
 * only sources. Any citation Claude returns that was not retrieved is
 * dropped, so the UI can never show a fabricated citation.
 */
export async function askTutor(input: {
  subjectKey: string;
  question: string;
  level: TutorLevel;
  sessionKeys?: string[];
  history?: { role: "user" | "assistant"; content: string }[];
}): Promise<TutorAnswer> {
  const hits = await retrieve(input.subjectKey, input.question, { limit: 8, sessionKeys: input.sessionKeys });
  const passages = hits.map(toPassage);
  if (!aiConfig().configured) {
    return {
      mode: "retrieval_only",
      answer: null,
      sections: [],
      passages,
      usedOutsideMaterial: false,
      notice: passages.length
        ? "AI explanations are off (no ANTHROPIC_API_KEY on the server). These are the most relevant passages from your course material."
        : "No matching passage was found in your course material. Try different words, or name the topic (e.g. “subnet mask”).",
    };
  }
  if (!passages.length) {
    return {
      mode: "ai",
      answer: null,
      sections: [],
      passages,
      usedOutsideMaterial: false,
      notice: "No matching passage was found in your course material, so SYNAPSE did not generate an answer.",
    };
  }

  const allowed = new Set(passages.map((p) => p.citation));
  const system = `${SOURCE_GROUNDING_POLICY}

You are the AI Tutor. ${LEVEL_GUIDE[input.level]}
Return sections in teaching order. A "source" section restates what the provided excerpts say and must cite at least one citation exactly as given. A "supplementary" section is your own explanation beyond the excerpts (analogy, background); give it no citations. Set used_outside_material to true if any supplementary section adds facts not in the excerpts.
Keep the whole answer under 350 words. Use plain text; "- " for bullet lines.`;
  const history = (input.history ?? []).slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  try {
    const result = await getAIProvider().generateStructured({
      agent: "tutor",
      system,
      schema: AnswerSchema,
      maxTokens: 2000,
      messages: [
        ...history,
        { role: "user", content: `${renderSources(passages.map((p) => ({ citation: p.citation, content: hits.find((h) => h.doc.id === p.id)!.doc.content })))}\n\nStudent question: ${input.question}` },
      ],
    });
    const sections = result.data.sections.map((s) => ({
      kind: s.kind,
      text: s.text,
      citations: s.kind === "source" ? s.citations.filter((c) => allowed.has(c)) : [],
    }));
    // A "source" section whose citations were all invalid is not source-backed.
    for (const section of sections) if (section.kind === "source" && section.citations.length === 0) section.kind = "supplementary";
    return {
      mode: "ai",
      answer: sections.map((s) => s.text).join("\n\n"),
      sections,
      passages,
      usedOutsideMaterial: result.data.used_outside_material || sections.some((s) => s.kind === "supplementary"),
      notice: null,
    };
  } catch (error) {
    const message = error instanceof AIError ? error.message : "The AI service failed.";
    return { mode: "retrieval_only", answer: null, sections: [], passages, usedOutsideMaterial: false, notice: `${message} Showing the matching passages instead.` };
  }
}
