"use client";

import { RotateCcw, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reviewCard } from "@/modules/learning/actions";

import { Verbatim } from "./question-card";

export interface CardView {
  id: string;
  front: string;
  back: string;
  citation: string;
  session: string | null;
  kind: "term" | "question";
}

const GRADES = [
  { value: "again", label: "Again", hint: "<1 day" },
  { value: "hard", label: "Hard", hint: "soon" },
  { value: "good", label: "Good", hint: "later" },
  { value: "easy", label: "Easy", hint: "much later" },
] as const;

/** Active recall: think, flip, grade. Grades schedule the next review. */
export function FlashcardDeck({ cards, canSave, saveHint }: { cards: CardView[]; canSave: boolean; saveHint?: string }) {
  const [position, setPosition] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const card = cards[position];

  if (!card) {
    return (
      <div className="glass flex flex-col items-center rounded-[var(--radius-card)] px-6 py-14 text-center">
        <div className="text-base font-semibold text-foreground">Session complete</div>
        <p className="mt-2 text-[13.5px] text-muted">You reviewed {cards.length} {cards.length === 1 ? "card" : "cards"}. They come back when they are due.</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => { setPosition(0); setFlipped(false); }}>
          <RotateCcw aria-hidden /> Review again
        </Button>
      </div>
    );
  }

  function grade(value: string) {
    start(async () => {
      const result = canSave ? await reviewCard(card.id, value) : { ok: true };
      if (!result.ok) {
        setError("error" in result && result.error ? result.error : "Could not save.");
        return;
      }
      setError(null);
      setFlipped(false);
      setPosition((p) => p + 1);
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-[12.5px] text-muted">
        <span>
          Card {position + 1} of {cards.length}
        </span>
        {card.session && <span>{card.session}</span>}
      </div>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? "Show the front" : "Show the answer"}
        className="glass block min-h-[240px] w-full rounded-[var(--radius-card)] p-6 text-left transition-colors hover:border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="mb-3 flex items-center gap-2">
          <Badge tone={flipped ? "success" : "neutral"}>{flipped ? "Answer" : card.kind === "term" ? "Define" : "Question"}</Badge>
          {flipped && (
            <Badge tone="success">
              <ShieldCheck aria-hidden /> Course text
            </Badge>
          )}
        </div>
        <Verbatim text={flipped ? card.back : card.front} className={flipped ? "text-[14px] leading-relaxed text-foreground" : "text-[19px] font-medium leading-snug text-foreground"} />
        {flipped ? <p className="mt-4 text-[12px] text-subtle">{card.citation}</p> : <p className="mt-6 text-[12.5px] text-subtle">Recall it, then tap to flip.</p>}
      </button>
      {flipped && (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {GRADES.map((g) => (
            <Button key={g.value} variant={g.value === "good" ? "primary" : "outline"} disabled={pending} onClick={() => grade(g.value)} className="h-auto flex-col py-2">
              <span>{g.label}</span>
              <span className="text-[11px] font-normal opacity-70">{g.hint}</span>
            </Button>
          ))}
        </div>
      )}
      {!canSave && saveHint && <p className="mt-3 text-[12px] text-subtle">{saveHint}</p>}
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
