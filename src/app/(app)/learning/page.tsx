import { ArrowRight, BookOpenText, CalendarDays, FileText, Presentation } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { DataErrorPanel } from "@/components/common/data-error";
import { PageHeader } from "@/components/common/page-header";
import { LearningUnavailable } from "@/components/learning/states";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { attempt } from "@/lib/server/load";
import { formatIsoDate, pluralize } from "@/lib/utils/format";
import { sessionHref, upcomingSessions } from "@/modules/curriculum/schedule";
import { loadLearning } from "@/modules/learning/overview";

export const metadata: Metadata = { title: "Learning Room" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-[560px] rounded-[var(--radius-card)]" />}>
      <LearningIndex />
    </Suspense>
  );
}

const STATUS_TONE = { studied: "success", in_progress: "info", not_started: "neutral" } as const;
const STATUS_LABEL = { studied: "Studied", in_progress: "In progress", not_started: "Not started" } as const;

async function LearningIndex() {
  await connection();
  const loaded = await attempt(loadLearning);
  if (!loaded.ok) return <DataErrorPanel error={loaded.error} />;
  if (loaded.value.kind !== "ready") return <LearningUnavailable load={loaded.value} title="Learning Room" />;
  const { curriculum, state, mastery, today } = loaded.value.overview;
  const next = upcomingSessions(curriculum.sessions, today, 1)[0];
  const studied = curriculum.sessions.filter((s) => state.sessions[s.key]?.status === "studied").length;

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Learning Room"
        title={curriculum.course.title ?? "Learning Room"}
        description={
          curriculum.course.drivingQuestion ? (
            <>
              The course asks one question: <span className="text-foreground">“{curriculum.course.drivingQuestion}”</span> Work through it one session at a time — each built from your
              teacher’s slides and readings.
            </>
          ) : (
            "Work through the course one session at a time, built from your teacher’s slides and readings."
          )
        }
        actions={
          next ? (
            <Link href={sessionHref(next)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary-strong px-4 text-sm font-medium text-white hover:bg-primary">
              Next class: {next.label} <ArrowRight aria-hidden className="size-4" />
            </Link>
          ) : undefined
        }
      />

      <div className="glass mb-6 rounded-[var(--radius-card)] p-5">
        <div className="mb-2 flex justify-between text-[13px]">
          <span className="text-muted">Sessions you marked as studied</span>
          <span className="tabular-nums text-foreground">
            {studied}/{curriculum.sessions.length}
          </span>
        </div>
        <ProgressBar value={curriculum.sessions.length ? (studied / curriculum.sessions.length) * 100 : 0} label="Sessions studied" tone="success" />
      </div>

      {curriculum.modules.map((module) => {
        const sessions = curriculum.sessions.filter((s) => s.module === module.number);
        if (!sessions.length) return null;
        return (
          <section key={module.number} className="mb-8" aria-labelledby={`module-${module.number}`}>
            <h2 id={`module-${module.number}`} className="mb-3 flex items-baseline gap-2 text-[15px] font-semibold text-foreground">
              <span className="text-primary">Module {module.number}</span>
              {module.title && <span>{module.title}</span>}
              <span className="text-[12.5px] font-normal text-subtle">· {pluralize(sessions.length, sessions[0].numbering === "class" ? "class" : "session", sessions[0].numbering === "class" ? "classes" : "sessions")}</span>
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sessions.map((session) => {
                const status = state.sessions[session.key]?.status ?? "not_started";
                const m = mastery.get(session.key);
                const slides = session.documents.filter((d) => d.role === "slides").length;
                const readings = session.documents.filter((d) => d.role === "reading").length;
                const isNext = next?.key === session.key;
                return (
                  <li key={session.key}>
                    <Link
                      href={sessionHref(session)}
                      className="glass group flex h-full flex-col rounded-[var(--radius-card)] p-4 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span className="font-mono text-[12px] text-subtle">{session.label}</span>
                        {isNext && <Badge tone="violet">Next</Badge>}
                        <Badge tone={STATUS_TONE[status]} className="ml-auto">
                          {STATUS_LABEL[status]}
                        </Badge>
                      </div>
                      <div className="text-[15px] font-semibold leading-snug text-foreground group-hover:text-primary">{session.title}</div>
                      {session.subtitle && <div className="mt-0.5 text-[12.5px] text-muted">{session.subtitle}</div>}
                      {session.drivingQuestion && !session.subtitle && <div className="mt-1 line-clamp-2 text-[12.5px] italic text-muted">{session.drivingQuestion}</div>}
                      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-[12px] text-subtle">
                        {session.date ? (
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays aria-hidden className="size-3.5" /> {formatIsoDate(session.date, { weekday: "short", day: "numeric", month: "short" })}
                          </span>
                        ) : (
                          <span>Date not stated</span>
                        )}
                        {slides > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Presentation aria-hidden className="size-3.5" /> {slides}
                          </span>
                        )}
                        {readings > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <FileText aria-hidden className="size-3.5" /> {readings}
                          </span>
                        )}
                        {m && m.total > 0 && <span className="ml-auto tabular-nums">{m.score == null ? `${m.total} questions` : `${m.score}% · ${m.attempted}/${m.total}`}</span>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <p className="flex items-center gap-1.5 text-[12.5px] text-subtle">
        <BookOpenText aria-hidden className="size-3.5" /> Mastery comes only from questions you answer — opening a session never raises it.
      </p>
    </div>
  );
}
