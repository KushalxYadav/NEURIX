import { AlertTriangle, ArrowRight, CalendarClock, CircleCheckBig, GraduationCap, Lightbulb, Target } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { daysUntil, formatIsoDate } from "@/lib/utils/format";
import { lastSession, sessionHref, upcomingAssessments, upcomingSessions } from "@/modules/curriculum/schedule";
import type { LearningOverview } from "@/modules/learning/overview";
import { buildPlan } from "@/modules/learning/planner";
import { isDue } from "@/modules/learning/state";

/** Where the student is in the course today, from dated material and their own progress. */
export function CourseNow({ overview }: { overview: LearningOverview }) {
  const { curriculum, bank, state, mastery, weak, today } = overview;
  const next = upcomingSessions(curriculum.sessions, today, 2);
  const previous = lastSession(curriculum.sessions, today);
  const assessments = upcomingAssessments(curriculum.assessments, today, 30);
  const cardIds = [...bank.terms.map((t) => t.id), ...bank.questions.filter((q) => q.answer && q.answer.length <= 600 && q.question.length <= 300).map((q) => q.id)];
  const dueCards = cardIds.filter((id) => isDue(state.cards[id], today)).length;
  const plan = buildPlan({ today, sessions: curriculum.sessions, assessments, state, mastery, weak, dueCards: Math.min(dueCards, 25), days: 1 });
  const studied = curriculum.sessions.filter((s) => state.sessions[s.key]?.status === "studied").length;
  const scored = [...mastery.values()].filter((m) => m.score != null);
  const avg = scored.length ? Math.round(scored.reduce((sum, m) => sum + (m.score ?? 0), 0) / scored.length) : null;

  return (
    <div className="mb-4 grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <div>
            <CardTitle>Next class</CardTitle>
            <CardDescription>From the dated schedule and readings in your archive.</CardDescription>
          </div>
          <CalendarClock aria-hidden className="size-4 text-subtle" />
        </CardHeader>
        <CardContent>
          {next[0] ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
              <Link href={sessionHref(next[0])} className="group flex-1 rounded-2xl border border-primary/25 bg-primary-soft/40 p-4 hover:border-primary/50">
                <div className="flex items-center gap-2 text-[12px] text-primary">
                  <span className="font-mono">{next[0].label}</span>
                  <span>·</span>
                  <span>{formatIsoDate(next[0].date!, { weekday: "long", day: "numeric", month: "short" })}</span>
                  <Badge tone="violet" className="ml-auto">
                    {daysUntil(next[0].date!, today) === 0 ? "Today" : `in ${daysUntil(next[0].date!, today)} d`}
                  </Badge>
                </div>
                <div className="mt-1.5 text-[19px] font-semibold text-foreground group-hover:text-primary">{next[0].title}</div>
                {next[0].subtitle && <div className="text-[13px] text-muted">{next[0].subtitle}</div>}
                {next[0].scheduleCover && <p className="mt-2 line-clamp-2 text-[12.5px] text-muted">{next[0].scheduleCover}</p>}
                <span className="mt-3 inline-flex items-center gap-1 text-[12.5px] text-primary">
                  Prepare now <ArrowRight aria-hidden className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
              <div className="flex flex-col gap-2 sm:w-56">
                {next[1] && (
                  <Link href={sessionHref(next[1])} className="rounded-xl border border-border bg-surface p-3 hover:border-border-strong">
                    <div className="text-[11.5px] text-subtle">
                      Then · {formatIsoDate(next[1].date!, { weekday: "short", day: "numeric", month: "short" })}
                    </div>
                    <div className="text-[13px] font-medium text-foreground">
                      {next[1].label}: {next[1].title}
                    </div>
                  </Link>
                )}
                {previous && (
                  <Link href={sessionHref(previous)} className="rounded-xl border border-border bg-surface p-3 hover:border-border-strong">
                    <div className="text-[11.5px] text-subtle">
                      Last taught · {formatIsoDate(previous.date!, { weekday: "short", day: "numeric", month: "short" })}
                    </div>
                    <div className="text-[13px] font-medium text-foreground">
                      {previous.label}: {previous.title}
                    </div>
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-muted">No dated class after today in your material — revision time.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Upcoming assessments</CardTitle>
            <CardDescription>Next 30 days.</CardDescription>
          </div>
          <Target aria-hidden className="size-4 text-subtle" />
        </CardHeader>
        <CardContent>
          {assessments.length === 0 ? (
            <p className="text-[13px] text-muted">None dated in the next 30 days.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {assessments.slice(0, 4).map((a) => (
                <li key={a.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13.5px] text-foreground">{a.title}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-muted">
                      {formatIsoDate(a.date!, { day: "numeric", month: "short" })} · {daysUntil(a.date!, today)}d
                    </span>
                  </div>
                  {a.conflict && (
                    <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-warning" title={a.events.map((e) => e.conflict ?? `${e.source}: ${e.date}`).join("\n")}>
                      <AlertTriangle aria-hidden className="size-3" /> Sources disagree on the date
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Link href="/planner" className="mt-3 inline-flex items-center gap-1 text-[12.5px] text-primary hover:underline">
            Study plan <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <div>
            <CardTitle>Today’s study tasks</CardTitle>
            <CardDescription>Generated from your schedule and progress — each says why.</CardDescription>
          </div>
          <CircleCheckBig aria-hidden className="size-4 text-subtle" />
        </CardHeader>
        <CardContent>
          {plan.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing due today.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {plan.slice(0, 6).map((task) => (
                <li key={task.id}>
                  <Link href={task.href} className="block rounded-xl border border-border bg-surface p-3 hover:border-border-strong">
                    <div className={task.done ? "text-[13px] text-muted line-through" : "text-[13px] font-medium text-foreground"}>{task.title}</div>
                    <div className="mt-0.5 text-[12px] text-subtle">
                      {task.minutes} min · {task.why}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Learning evidence</CardTitle>
            <CardDescription>From answered questions only.</CardDescription>
          </div>
          <GraduationCap aria-hidden className="size-4 text-subtle" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <div className="mb-1.5 flex justify-between text-[13px]">
              <span className="text-muted">Sessions studied</span>
              <span className="tabular-nums text-foreground">
                {studied}/{curriculum.sessions.length}
              </span>
            </div>
            <ProgressBar value={curriculum.sessions.length ? (studied / curriculum.sessions.length) * 100 : 0} label="Sessions studied" tone="success" />
          </div>
          <div className="text-[13px] text-muted">
            Average mastery: <span className="text-foreground">{avg == null ? "— (answer a few questions)" : `${avg}% over ${scored.length} sessions`}</span>
          </div>
          {weak.length > 0 ? (
            <div>
              <div className="mb-1 text-[12px] text-subtle">Weak topics</div>
              <div className="flex flex-wrap gap-1.5">
                {weak.slice(0, 4).map((key) => {
                  const s = curriculum.sessions.find((x) => x.key === key)!;
                  return (
                    <Link key={key} href={`/practice?scope=${key}`}>
                      <Badge tone="danger">
                        {s.label}: {s.title} · {mastery.get(key)?.score}%
                      </Badge>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="flex gap-1.5 text-[12.5px] text-subtle">
              <Lightbulb aria-hidden className="mt-0.5 size-3.5 shrink-0" /> Weak topics appear after you answer checkpoint questions.
            </p>
          )}
          <Link href="/progress" className="inline-flex items-center gap-1 text-[12.5px] text-primary hover:underline">
            Full progress <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
