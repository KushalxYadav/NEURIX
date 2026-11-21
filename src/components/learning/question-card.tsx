"use client";

import { Eye, Loader2, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { recordAttempt } from "@/modules/learning/actions";

export interface QuestionView {
  id: string;
  kind: "practice" | "review";
  question: string;
  answer: string | null;
  questionCitation: string;
  answerCitation: string | null;
  marks: number | null;
  level: string | null;
  questionKind: string | null;
  lastResult?: "correct" | "partial" | "incorrect" | null;
}

const RESULT_LABEL = { correct: "Got it", partial: "Partly", incorrect: "Not yet" } as const;
const RESULT_TONE = { correct: "success", partial: "warning", incorrect: "danger" } as const;

/** Text with preserved line breaks; course text is rendered verbatim, never as HTML. */
export function Verbatim({ text, className }: { text: string; className?: string }) {
  return <div className={cn("whitespace-pre-line break-words", className)}>{text}</div>;
}

/**
 * Attempt → reveal the course's own answer → grade yourself. The attempt
 * (not the reading) is what updates mastery.
 */
export function QuestionCard({ question, index, canSave, saveHint }: { question: QuestionView; index?: number; canSave: boolean; saveHint?: string }) {
  const [draft, setDraft] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState<keyof typeof RESULT_LABEL | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function grade(result: keyof typeof RESULT_LABEL) {
    start(async () => {
      const outcome = await recordAttempt(question.id, result);
      if (outcome.ok) setGraded(result);
      else setError(outcome.error ?? "Could not save.");
    });
  }

  return (
    <article className="glass rounded-[var(--radius-card)] p-5">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        {index != null && <span className="font-mono text-[12px] text-subtle">Q{index}</span>}
        {question.questionKind && <Badge tone="info">{question.questionKind}</Badge>}
        {question.level && <Badge>{question.level}</Badge>}
        {question.marks != null && <Badge>{question.marks} {question.marks === 1 ? "mark" : "marks"}</Badge>}
        {question.lastResult && !graded && <Badge tone={RESULT_TONE[question.lastResult]}>Last: {RESULT_LABEL[question.lastResult]}</Badge>}
        <Badge tone="success" className="ml-auto" title={question.questionCitation}>
          <ShieldCheck aria-hidden /> From your course
        </Badge>
      </header>
      <Verbatim text={question.question} className="text-[14.5px] leading-relaxed text-foreground" />
      <p className="mt-2 text-[12px] text-subtle">{question.questionCitation}</p>

      <label className="mt-4 block">
        <span className="sr-only">Your answer</span>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Write your answer first — retrieval beats rereading."
          className="w-full resize-y rounded-xl border border-border-strong bg-surface px-3 py-2 text-[13.5px] text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>

      {!revealed ? (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setRevealed(true)}>
          <Eye aria-hidden /> {question.answer ? "Reveal the course answer" : "Check yourself"}
        </Button>
      ) : (
        <div className="mt-4 rounded-xl border border-success/20 bg-success-soft/40 p-4">
          {question.answer ? (
            <>
              <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wider text-success">Course answer</div>
              <Verbatim text={question.answer} className="text-[13.5px] leading-relaxed text-foreground" />
              {question.answerCitation && <p className="mt-2 text-[12px] text-subtle">{question.answerCitation}</p>}
            </>
          ) : (
            <p className="text-[13.5px] text-muted">
              Your course does not publish an answer to this question. Compare your answer with the session’s slides and reading, or ask the AI Tutor.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-muted">How did you do?</span>
            {(Object.keys(RESULT_LABEL) as (keyof typeof RESULT_LABEL)[]).map((key) => (
              <Button
                key={key}
                size="sm"
                variant={graded === key ? "primary" : "outline"}
                disabled={pending || !canSave}
                title={!canSave ? saveHint : undefined}
                onClick={() => grade(key)}
              >
                {pending && graded == null ? <Loader2 aria-hidden className="animate-spin" /> : null}
                {RESULT_LABEL[key]}
              </Button>
            ))}
            {graded && <span className="text-[12.5px] text-success">Saved — counts toward mastery.</span>}
          </div>
          {!canSave && saveHint && <p className="mt-2 text-[12px] text-subtle">{saveHint}</p>}
          {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
        </div>
      )}
    </article>
  );
}
