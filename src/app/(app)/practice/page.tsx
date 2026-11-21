import { Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { DataErrorPanel } from "@/components/common/data-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Stat } from "@/components/common/stat";
import { QuestionCard, type QuestionView } from "@/components/learning/question-card";
import { LearningUnavailable } from "@/components/learning/states";
import { Skeleton } from "@/components/ui/skeleton";
import { attempt } from "@/lib/server/load";
import { cn } from "@/lib/utils/cn";
import type { PracticeQuestion } from "@/modules/curriculum";
import { loadLearning } from "@/modules/learning/overview";

export const metadata: Metadata = { title: "Practice Arena" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<Skeleton className="h-[560px] rounded-[var(--radius-card)]" />}>
      <Practice searchParams={searchParams} />
    </Suspense>
  );
}

const SET_SIZE = 10;

async function Practice({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const query = await searchParams;
  const loaded = await attempt(loadLearning);
  if (!loaded.ok) return <DataErrorPanel error={loaded.error} />;
  if (loaded.value.kind !== "ready") return <LearningUnavailable load={loaded.value} title="Practice Arena" />;
  const { curriculum, bank, state, store } = loaded.value.overview;

  const scope = typeof query.scope === "string" ? query.scope : "smart";
  const latest = new Map<string, NonNullable<QuestionView["lastResult"]>>();
  for (const a of state.attempts) latest.set(a.questionId, a.result);
  const sessionLabel = new Map(curriculum.sessions.map((s) => [s.key, `${s.label} · ${s.title}`]));

  let pool: PracticeQuestion[] = bank.questions;
  let heading = "Smart set";
  let description = "Unanswered and missed questions first, across the whole course.";
  if (scope.startsWith("M") && curriculum.sessions.some((s) => s.key === scope)) {
    pool = bank.questions.filter((q) => q.sessionKeys.includes(scope));
    heading = sessionLabel.get(scope) ?? scope;
    description = "Every question your course provides for this session.";
  } else if (scope.startsWith("module-")) {
    const moduleNumber = Number(scope.slice(7));
    pool = bank.questions.filter((q) => q.module === moduleNumber || q.sessionKeys.some((k) => curriculum.sessions.find((s) => s.key === k)?.module === moduleNumber));
    heading = `Module ${moduleNumber} — all questions`;
    description = "Session checkpoints plus module-wide practice sets and quizzes.";
  } else if (scope === "sets") {
    pool = bank.questions.filter((q) => q.sessionKeys.length === 0);
    heading = "Practice sets & past quiz";
    description = "Module practice questions and the Quiz 1 paper, with the official answer keys.";
  }

  const rank = (q: PracticeQuestion) => {
    const r = latest.get(q.id);
    return r == null ? 0 : r === "incorrect" ? 1 : r === "partial" ? 2 : 3;
  };
  const ordered = scope === "smart" ? [...pool].sort((a, b) => rank(a) - rank(b)).slice(0, SET_SIZE) : pool;
  const answered = bank.questions.filter((q) => latest.has(q.id));
  const correct = answered.filter((q) => latest.get(q.id) === "correct").length;
  const withAnswers = bank.questions.filter((q) => q.answer).length;

  const scopes = [
    { key: "smart", label: "Smart set" },
    ...curriculum.modules.map((m) => ({ key: `module-${m.number}`, label: `Module ${m.number}` })),
    { key: "sets", label: "Practice sets & quiz" },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Practice Arena"
        title="Practise with your course’s own questions"
        description="Every question and answer comes verbatim from your readings, worksheets and Quiz 1 — with the file and page. Answer first, reveal, then grade yourself honestly."
      />
      <div className="glass mb-6 grid grid-cols-2 gap-5 rounded-[var(--radius-card)] p-5 sm:grid-cols-4">
        <Stat label="Questions" value={String(bank.questions.length)} hint={`${withAnswers} with official answers`} />
        <Stat label="Answered" value={String(answered.length)} hint="at least once" />
        <Stat label="Latest correct" value={answered.length ? `${Math.round((correct / answered.length) * 100)}%` : "—"} hint="of answered questions" />
        <Stat label="Attempts" value={String(state.attempts.length)} hint="all time" />
      </div>

      <nav aria-label="Question scope" className="mb-3 flex flex-wrap gap-2">
        {scopes.map((s) => (
          <Link
            key={s.key}
            href={`/practice?scope=${s.key}`}
            className={cn("rounded-full border px-3 py-1.5 text-[12.5px]", scope === s.key ? "border-primary/40 bg-primary-soft text-primary" : "border-border-strong text-muted hover:text-foreground")}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      <details className="mb-6">
        <summary className="cursor-pointer text-[12.5px] text-muted">By session…</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {curriculum.sessions
            .filter((s) => bank.questions.some((q) => q.sessionKeys.includes(s.key)))
            .map((s) => (
              <Link
                key={s.key}
                href={`/practice?scope=${s.key}`}
                className={cn("rounded-full border px-3 py-1 text-[12px]", scope === s.key ? "border-primary/40 bg-primary-soft text-primary" : "border-border text-muted hover:text-foreground")}
              >
                {s.label} · {s.title}
              </Link>
            ))}
        </div>
      </details>

      <h2 className="text-[16px] font-semibold text-foreground">{heading}</h2>
      <p className="mb-4 text-[12.5px] text-muted">{description}</p>
      {ordered.length === 0 ? (
        <EmptyState icon={Target} title="No questions here">
          Your course material has no numbered questions for this scope.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {ordered.map((q, i) => (
            <div key={q.id}>
              {q.sessionKeys[0] && <div className="mb-1 text-[11.5px] text-subtle">{sessionLabel.get(q.sessionKeys[0])}</div>}
              <QuestionCard question={{ ...q, lastResult: latest.get(q.id) ?? null }} index={i + 1} canSave={store.available} saveHint={store.available ? undefined : store.reason} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
