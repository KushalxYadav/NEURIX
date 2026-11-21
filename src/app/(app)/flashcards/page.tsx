import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { DataErrorPanel } from "@/components/common/data-error";
import { PageHeader } from "@/components/common/page-header";
import { Stat } from "@/components/common/stat";
import { FlashcardDeck, type CardView } from "@/components/learning/flashcard-deck";
import { LearningUnavailable } from "@/components/learning/states";
import { Skeleton } from "@/components/ui/skeleton";
import { attempt } from "@/lib/server/load";
import { cn } from "@/lib/utils/cn";
import { isDue } from "@/modules/learning/state";
import { loadLearning } from "@/modules/learning/overview";

export const metadata: Metadata = { title: "Flashcards" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<Skeleton className="h-[480px] rounded-[var(--radius-card)]" />}>
      <Flashcards searchParams={searchParams} />
    </Suspense>
  );
}

async function Flashcards({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const query = await searchParams;
  const loaded = await attempt(loadLearning);
  if (!loaded.ok) return <DataErrorPanel error={loaded.error} />;
  if (loaded.value.kind !== "ready") return <LearningUnavailable load={loaded.value} title="Flashcards" />;
  const { curriculum, bank, state, store, today } = loaded.value.overview;
  const label = new Map(curriculum.sessions.map((s) => [s.key, `${s.label} · ${s.title}`]));
  const deck = typeof query.deck === "string" ? query.deck : "due";

  // Cards are the course's own key terms and short answered questions — nothing generated.
  const all: CardView[] = [
    ...bank.terms.map((t) => ({ id: t.id, front: t.term, back: t.definition, citation: t.citation, session: t.sessionKeys[0] ? (label.get(t.sessionKeys[0]) ?? null) : null, kind: "term" as const })),
    ...bank.questions
      .filter((q) => q.answer && q.answer.length <= 600 && q.question.length <= 300)
      .map((q) => ({ id: q.id, front: q.question, back: q.answer!, citation: q.answerCitation ?? q.questionCitation, session: q.sessionKeys[0] ? (label.get(q.sessionKeys[0]) ?? null) : null, kind: "question" as const })),
  ];
  const due = all.filter((c) => isDue(state.cards[c.id], today));
  const fresh = all.filter((c) => !state.cards[c.id]);
  const learned = all.filter((c) => (state.cards[c.id]?.intervalDays ?? 0) >= 7);
  const cards = deck === "terms" ? all.filter((c) => c.kind === "term") : deck === "all" ? all : due;
  // New cards after reviews, capped so a session stays short.
  const sessionCards = [...cards].sort((a, b) => Number(!state.cards[a.id]) - Number(!state.cards[b.id])).slice(0, 25);

  const decks = [
    { key: "due", label: `Due today (${due.length})` },
    { key: "terms", label: `Key terms (${bank.terms.length})` },
    { key: "all", label: `All cards (${all.length})` },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Flashcards"
        title="Active recall, spaced out"
        description="Cards are your course’s own key terms and short answered questions. Recall, flip, grade — SYNAPSE schedules the next review (shorter for ‘Again’, longer for ‘Easy’)."
      />
      <div className="glass mb-6 grid grid-cols-3 gap-5 rounded-[var(--radius-card)] p-5">
        <Stat label="Due today" value={String(due.length)} hint={`${fresh.length} never reviewed`} />
        <Stat label="Learned" value={String(learned.length)} hint="interval ≥ 7 days" />
        <Stat label="Deck" value={String(all.length)} hint="from your course" />
      </div>
      <nav aria-label="Deck" className="mb-5 flex flex-wrap gap-2">
        {decks.map((d) => (
          <Link key={d.key} href={`/flashcards?deck=${d.key}`} className={cn("rounded-full border px-3 py-1.5 text-[12.5px]", deck === d.key ? "border-primary/40 bg-primary-soft text-primary" : "border-border-strong text-muted hover:text-foreground")}>
            {d.label}
          </Link>
        ))}
      </nav>
      <div className="mx-auto max-w-2xl">
        <FlashcardDeck key={deck} cards={sessionCards} canSave={store.available} saveHint={store.available ? undefined : store.reason} />
      </div>
    </div>
  );
}
