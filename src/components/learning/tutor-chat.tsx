"use client";

import { BookMarked, Loader2, SendHorizontal, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { askTutorAction } from "@/modules/learning/actions";
import type { TutorAnswer } from "@/modules/tutor/service";

import { Verbatim } from "./question-card";

type Turn = { role: "user"; text: string } | { role: "assistant"; answer: TutorAnswer; question: string };

const LEVELS = [
  { value: "beginner", label: "Beginner" },
  { value: "university", label: "University" },
  { value: "exam", label: "Exam focus" },
] as const;

export function TutorChat({
  aiEnabled,
  sessions,
  initialSession,
  suggestions,
}: {
  aiEnabled: boolean;
  sessions: { key: string; label: string }[];
  initialSession?: string;
  suggestions: string[];
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [level, setLevel] = useState<(typeof LEVELS)[number]["value"]>("beginner");
  const [sessionKey, setSessionKey] = useState(initialSession ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3 || pending) return;
    const history = turns.map((t) => (t.role === "user" ? { role: "user" as const, content: t.text } : { role: "assistant" as const, content: t.answer.answer ?? "(passages only)" }));
    setTurns((prev) => [...prev, { role: "user", text: trimmed }]);
    setQuestion("");
    setError(null);
    start(async () => {
      const result = await askTutorAction({ question: trimmed, level, sessionKey: sessionKey || undefined, history });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTurns((prev) => [...prev, { role: "assistant", answer: result.answer, question: trimmed }]);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="glass flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] p-3">
        <div role="radiogroup" aria-label="Explanation level" className="inline-flex rounded-xl border border-border-strong bg-surface p-1">
          {LEVELS.map((l) => (
            <button
              key={l.value}
              type="button"
              role="radio"
              aria-checked={level === l.value}
              onClick={() => setLevel(l.value)}
              className={cn("h-8 rounded-lg px-3 text-[12.5px] font-medium", level === l.value ? "bg-primary-soft text-primary" : "text-muted hover:text-foreground")}
            >
              {l.label}
            </button>
          ))}
        </div>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px] text-muted">
          Focus
          <select
            value={sessionKey}
            onChange={(e) => setSessionKey(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-xl border border-border-strong bg-surface px-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Whole course</option>
            {sessions.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <Badge tone={aiEnabled ? "violet" : "neutral"}>{aiEnabled ? <><Sparkles aria-hidden /> Claude on</> : "Search only (no API key)"}</Badge>
      </div>

      {turns.length === 0 && (
        <div className="glass rounded-[var(--radius-card)] p-5">
          <p className="text-[13.5px] text-muted">
            Ask anything about the course. Every answer is built from your slides, readings and textbooks, with the exact file and slide/page.
            {!aiEnabled && " Without an API key the tutor shows the matching passages instead of writing an explanation."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-border-strong bg-surface px-3 py-1.5 text-[12.5px] text-muted hover:border-primary/40 hover:text-foreground">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <ol className="flex flex-col gap-4" aria-live="polite">
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <li key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary-soft px-4 py-2.5 text-[14px] text-foreground">
              {turn.text}
            </li>
          ) : (
            <li key={i}>
              <AnswerView answer={turn.answer} />
            </li>
          ),
        )}
        {pending && (
          <li className="flex items-center gap-2 text-[13px] text-muted">
            <Loader2 aria-hidden className="size-4 animate-spin" /> Searching your course material…
          </li>
        )}
      </ol>
      <div ref={endRef} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="glass sticky bottom-3 flex items-end gap-2 rounded-[var(--radius-card)] p-2"
      >
        <label className="sr-only" htmlFor="tutor-question">
          Your question
        </label>
        <textarea
          id="tutor-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(question);
            }
          }}
          rows={1}
          maxLength={1500}
          placeholder="e.g. Why does a switch need ARP?"
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-[14px] text-foreground placeholder:text-subtle focus:outline-none"
        />
        <Button type="submit" size="icon" disabled={pending || question.trim().length < 3} aria-label="Ask">
          <SendHorizontal aria-hidden />
        </Button>
      </form>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}

function AnswerView({ answer }: { answer: TutorAnswer }) {
  return (
    <div className="glass rounded-[var(--radius-card)] p-5">
      {answer.notice && <p className="mb-3 text-[13px] text-muted">{answer.notice}</p>}
      {answer.sections.length > 0 && (
        <div className="mb-4 flex flex-col gap-3">
          {answer.sections.map((section, i) => (
            <div key={i} className={cn("rounded-xl border p-3.5", section.kind === "source" ? "border-success/20 bg-success-soft/30" : "border-primary/20 bg-primary-soft/40")}>
              <div className="mb-1.5">
                {section.kind === "source" ? (
                  <Badge tone="success">
                    <ShieldCheck aria-hidden /> From your course
                  </Badge>
                ) : (
                  <Badge tone="violet">
                    <Sparkles aria-hidden /> AI supplementary — not from your material
                  </Badge>
                )}
              </div>
              <Verbatim text={section.text} className="text-[14px] leading-relaxed text-foreground" />
              {section.citations.length > 0 && <p className="mt-2 text-[12px] text-subtle">{section.citations.join(" · ")}</p>}
            </div>
          ))}
        </div>
      )}
      {answer.passages.length > 0 && (
        <details open={answer.mode === "retrieval_only"}>
          <summary className="cursor-pointer text-[12.5px] font-medium text-muted">
            <BookMarked aria-hidden className="mr-1 inline size-3.5" /> {answer.passages.length} source passages
          </summary>
          <ul className="mt-3 flex flex-col gap-2.5">
            {answer.passages.map((p) => (
              <li key={p.id} className="rounded-xl border border-border bg-surface p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Link href={`/sources/${p.documentId}`} className="text-[12.5px] font-medium text-primary hover:underline">
                    {p.citation}
                  </Link>
                  <Badge tone={p.tier === "course" ? "success" : "info"}>{p.tier === "course" ? "Course material" : "Textbook"}</Badge>
                </div>
                <p className="text-[13px] leading-relaxed text-muted">{p.excerpt}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
