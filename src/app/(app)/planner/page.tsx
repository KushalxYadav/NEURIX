import { AlertTriangle, CalendarCheck2, CheckCircle2, Circle, Clock3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { DataErrorPanel } from "@/components/common/data-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { LearningUnavailable } from "@/components/learning/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { attempt } from "@/lib/server/load";
import { formatIsoDate } from "@/lib/utils/format";
import { upcomingAssessments } from "@/modules/curriculum/schedule";
import { buildPlan, type PlanTask } from "@/modules/learning/planner";
import { loadLearning } from "@/modules/learning/overview";
import { isDue } from "@/modules/learning/state";

export const metadata: Metadata = { title: "Study Planner" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-[480px] rounded-[var(--radius-card)]" />}>
      <Planner />
    </Suspense>
  );
}

const KIND: Record<PlanTask["kind"], { label: string; tone: "violet" | "info" | "warning" | "danger" | "success" | "neutral" }> = {
  assessment: { label: "Assessment", tone: "danger" },
  prepare: { label: "Before class", tone: "violet" },
  review: { label: "Review", tone: "info" },
  practice: { label: "Practice", tone: "warning" },
  catch_up: { label: "Catch up", tone: "neutral" },
  flashcards: { label: "Flashcards", tone: "success" },
};

async function Planner() {
  await connection();
  const loaded = await attempt(loadLearning);
  if (!loaded.ok) return <DataErrorPanel error={loaded.error} />;
  if (loaded.value.kind !== "ready") return <LearningUnavailable load={loaded.value} title="Study Planner" />;
  const { curriculum, bank, state, mastery, weak, today } = loaded.value.overview;
  const assessments = upcomingAssessments(curriculum.assessments, today, 30);
  const cardIds = [...bank.terms.map((t) => t.id), ...bank.questions.filter((q) => q.answer && q.answer.length <= 600 && q.question.length <= 300).map((q) => q.id)];
  const dueCards = cardIds.filter((id) => isDue(state.cards[id], today)).length;
  const plan = buildPlan({ today, sessions: curriculum.sessions, assessments, state, mastery, weak, dueCards: Math.min(dueCards, 25) });
  const byDay = new Map<string, PlanTask[]>();
  for (const task of plan) byDay.set(task.date, [...(byDay.get(task.date) ?? []), task]);

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Study Planner"
        title="Your next seven days"
        description="Built from the dated class schedule, your assessments, what you have studied and what you got wrong. Each task says why it is there."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          {plan.length === 0 && (
            <EmptyState icon={CalendarCheck2} title="Nothing scheduled">
              No dated classes or assessments in the next week, and nothing overdue.
            </EmptyState>
          )}
          {[...byDay.entries()].map(([day, tasks]) => (
            <section key={day} aria-labelledby={`day-${day}`}>
              <h2 id={`day-${day}`} className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-muted">
                {day === today ? "Today" : formatIsoDate(day, { weekday: "long", day: "numeric", month: "short" })}
                <span className="ml-2 font-normal normal-case tracking-normal text-subtle">~{tasks.reduce((sum, t) => sum + t.minutes, 0)} min</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <Link href={task.href} className="glass flex items-start gap-3 rounded-2xl p-3.5 hover:border-primary/40">
                      {task.done ? <CheckCircle2 aria-label="Done" className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle aria-label="To do" className="mt-0.5 size-4 shrink-0 text-subtle" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={task.done ? "text-[14px] text-muted line-through" : "text-[14px] font-medium text-foreground"}>{task.title}</span>
                          <Badge tone={KIND[task.kind].tone}>{KIND[task.kind].label}</Badge>
                        </div>
                        <p className="mt-0.5 text-[12.5px] text-muted">{task.why}</p>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-subtle">
                        <Clock3 aria-hidden className="size-3.5" /> {task.minutes}m
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <Card className="self-start">
          <CardHeader>
            <div>
              <CardTitle>Coming up</CardTitle>
              <CardDescription>Next 30 days, latest published schedule first.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {assessments.length === 0 && <li className="text-[13px] text-muted">No dated assessments in the next 30 days.</li>}
              {assessments.map((a) => (
                <li key={a.key} className="rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13.5px] font-medium text-foreground">{a.title}</span>
                    <span className="text-[12.5px] tabular-nums text-muted">{a.date && formatIsoDate(a.date, { day: "numeric", month: "short" })}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-subtle">{a.events[0].source}</p>
                  {a.conflict && (
                    <p className="mt-1.5 flex gap-1.5 text-[12px] text-warning">
                      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      {a.events.length > 1
                        ? `Other source: ${a.events
                            .slice(1)
                            .map((e) => `${e.date} (${e.source})`)
                            .join("; ")}`
                        : a.events[0].conflict}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
