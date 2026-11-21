import { CalendarX2, ChevronRight, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { getCurriculum, type Session } from "@/modules/curriculum";
import { Suspense } from "react";

import { DataErrorPanel } from "@/components/common/data-error";
import { EmptyState } from "@/components/common/empty-state";
import { NoSourcesState } from "@/components/common/no-sources";
import { PageHeader } from "@/components/common/page-header";
import { EvidenceBadge } from "@/components/common/status";
import { WeekCoverageChips } from "@/components/curriculum/week-coverage";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getSubjectContext } from "@/lib/server/context";
import { attempt } from "@/lib/server/load";
import { formatDateRange, pluralize } from "@/lib/utils/format";
import { weekDisplayName } from "@/modules/sources/timeline";

export const metadata: Metadata = { title: "Weekly Overview" };

export default function WeeklyOverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Weekly Overview"
        title="Teaching timeline"
        description="The week-by-week sequence exactly as your course’s overview page lists it, with the lecture files and textbook references found for each week."
      />
      <Suspense fallback={<TimelineSkeleton />}>
        <Timeline />
      </Suspense>
    </>
  );
}

async function Timeline() {
  const loaded = await attempt(async () => {
    const context = await getSubjectContext();
    const weeks = context.subject ? await context.repo.listWeeks(context.subject.id) : [];
    const curriculum = context.subject ? (await getCurriculum(context.subject.id)).curriculum : null;
    return { ...context, weeks, curriculum };
  });
  if (!loaded.ok) return <DataErrorPanel error={loaded.error} />;
  const { subject, repo, weeks, curriculum } = loaded.value;
  const delivered = new Map<string, Session[]>();
  for (const session of curriculum?.sessions ?? []) {
    if (session.planWeek) delivered.set(session.planWeek.weekId, [...(delivered.get(session.planWeek.weekId) ?? []), session]);
  }
  const shifted = curriculum?.discrepancies.filter((d) => d.kind === "plan_vs_delivery").length ?? 0;
  if (!subject) return <NoSourcesState mode={repo.mode} />;
  if (weeks.length === 0) {
    return (
      <EmptyState icon={CalendarX2} title="No weekly structure found">
        <p>
          {subject.overview.sourceFile
            ? `SYNAPSE could not find week-like sections in ${subject.overview.sourceFile}. It will not invent a timeline.`
            : "The archive has no index.html Weekly Overview, so there is no teaching sequence to show."}
        </p>
        {subject.overview.warnings.map((warning) => (
          <p key={warning} className="mt-2 text-warning">{warning}</p>
        ))}
      </EmptyState>
    );
  }
  const coverage = new Map(subject.coverage.weeks.map((row) => [row.weekId, row]));
  const otherSections = subject.overview.otherSections.filter((s) => s.labelKind !== "preamble" || s.topics.length > 0);
  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <EvidenceBadge evidence="source_confirmed" />
        <span>
          {pluralize(weeks.length, "teaching section")} parsed from{" "}
          <code className="font-mono text-foreground">{subject.overview.sourceFile}</code>
          {subject.overview.parserStrategy && <> ({subject.overview.parserStrategy.detail})</>}
        </span>
      </div>
      {shifted > 0 && (
        <div className="mb-5 flex gap-2 rounded-xl border border-warning/25 bg-warning-soft px-3 py-2 text-[13px] text-warning">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            This is the course plan. The dated slides, readings and Module 2 schedule show {shifted} sessions taught in a different week than planned. Each week below lists what was
            actually taught in it (placed by date only); sessions without a printed date are not placed.
          </span>
        </div>
      )}
      {subject.overview.warnings.length > 0 && (
        <div className="mb-5 flex gap-2 rounded-xl border border-warning/25 bg-warning-soft px-3 py-2 text-[13px] text-warning">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <ul>{subject.overview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      <ol className="relative flex flex-col gap-3 before:absolute before:inset-y-3 before:left-[19px] before:w-px before:bg-border-strong sm:before:left-[23px]">
        {weeks.map((week) => {
          const dates = formatDateRange(week.dateRange?.startDate, week.dateRange?.endDate);
          const displayName = weekDisplayName(week);
          return (
            <li key={week.id} className="relative pl-12 sm:pl-14">
              <span
                aria-hidden
                className="absolute left-0 top-4 flex size-10 items-center justify-center rounded-full border border-border-strong bg-surface-solid text-[13px] font-semibold tabular-nums text-foreground sm:size-12"
              >
                {week.weekNumber ?? week.ordinal}
              </span>
              <Link
                href={`/weekly-overview/${week.id}`}
                className="group glass block rounded-[var(--radius-card)] p-4 transition-colors hover:border-border-strong sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold text-foreground">{displayName}</h2>
                    {displayName !== week.label && <div className="text-[13px] text-muted">{week.label}</div>}
                    {dates && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-subtle">
                        {dates}
                        {week.dateRange?.yearSource && week.dateRange.yearSource !== "explicit" && (
                          <Badge tone="neutral" title={`The overview omits the year; inferred from ${week.dateRange.yearSource.replaceAll("_", " ")}`}>
                            year inferred
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                  <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" />
                </div>
                {week.topics.length > 0 && (
                  <ul className="mt-3 grid gap-1 text-[13.5px] text-muted sm:grid-cols-2">
                    {week.topics.slice(0, 6).map((topic, i) => (
                      <li key={i} className="line-clamp-2 before:mr-2 before:text-primary before:content-['•']">{topic.text}</li>
                    ))}
                  </ul>
                )}
                {week.topics.length > 6 && <div className="mt-1 text-[12.5px] text-subtle">+{week.topics.length - 6} more</div>}
                {(delivered.get(week.id)?.length ?? 0) > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-[12px] text-subtle">Taught (by date):</span>
                    {delivered.get(week.id)!.map((s) => (
                      <Badge key={s.key} tone="success">
                        {s.label} · {s.title}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="mt-4">
                  <WeekCoverageChips row={coverage.get(week.id)} />
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
      {otherSections.length > 0 && (
        <Card className="mt-8 p-5">
          <h2 className="text-[15px] font-semibold">Other sections in the overview</h2>
          <p className="mt-1 text-[13px] text-muted">Listed in the overview but not part of the week sequence.</p>
          <ul className="mt-3 flex flex-col gap-3">
            {otherSections.map((section, i) => (
              <li key={i}>
                <div className="text-[13.5px] font-medium">{section.label}</div>
                {section.topics.length > 0 && (
                  <div className="mt-0.5 text-[13px] text-muted">{section.topics.map((t) => t.text).join(" · ")}</div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading timeline" className="flex flex-col gap-3">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="ml-12 h-36 rounded-[var(--radius-card)] sm:ml-14" />
      ))}
    </div>
  );
}
