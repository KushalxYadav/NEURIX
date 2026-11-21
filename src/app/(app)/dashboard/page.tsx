import {
  ArrowRight,
  CalendarClock,
  CalendarRange,
  CircleCheckBig,
  Clock3,
  FileStack,
  GraduationCap,
  History,
  Target,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { DataErrorPanel } from "@/components/common/data-error";
import { NoSourcesState } from "@/components/common/no-sources";
import { PageHeader } from "@/components/common/page-header";
import { Stat } from "@/components/common/stat";
import { StatusBadge } from "@/components/common/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { getSubjectContext } from "@/lib/server/context";
import { attempt } from "@/lib/server/load";
import { daysUntil, formatDateRange, formatIsoDate, formatNumber, formatTimestamp, pluralize } from "@/lib/utils/format";
import { CourseNow } from "@/components/dashboard/course-now";
import { getLearningActivity, type LearningActivity } from "@/modules/learning/activity";
import { loadLearning } from "@/modules/learning/overview";
import { findCurrentWeek, summarizeCoverage, weekDisplayName, type CurrentWeek } from "@/modules/sources/timeline";
import type { Week } from "@/modules/sources/types";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  await connection(); // "today" must be computed per request
  const loaded = await attempt(getSubjectContext);
  if (!loaded.ok) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <DataErrorPanel error={loaded.error} />
      </>
    );
  }
  const { viewer, repo, subject } = loaded.value;
  if (!subject) {
    return (
      <>
        <PageHeader eyebrow="Welcome to SYNAPSE" title="Let’s set up your subject" />
        <NoSourcesState mode={repo.mode} />
      </>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const [weeks, documents, activityResult, learningResult] = await Promise.all([
    repo.listWeeks(subject.id),
    repo.listDocuments(subject.id),
    viewer.kind === "user" ? attempt(() => getLearningActivity(viewer.id, subject.id, today)) : Promise.resolve(null),
    attempt(loadLearning),
  ]);
  // Local mode with a generated curriculum: real schedule, plan and progress replace account-only cards.
  const learning = learningResult.ok && learningResult.value.kind === "ready" && repo.mode === "local" ? learningResult.value.overview : null;
  const coverage = summarizeCoverage(subject, documents);
  const current = findCurrentWeek(weeks, today);
  const activity = activityResult?.ok ? activityResult.value : null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Dashboard"
        title={subject.name}
        description={
          <>
            Built from {pluralize(coverage.usableDocuments, "processed document")}
            {coverage.totalWeeks > 0 && <> and a weekly overview with {pluralize(coverage.totalWeeks, "teaching section")}</>}.{" "}
            Last processed {formatTimestamp(subject.processedAt)}.
          </>
        }
        actions={
          <Button asChild variant="secondary">
            <Link href="/weekly-overview">
              <CalendarRange aria-hidden /> Weekly timeline
            </Link>
          </Button>
        }
      />

      {learning && <CourseNow overview={learning} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Subject overview</CardTitle>
              <CardDescription>What SYNAPSE extracted from your archive.</CardDescription>
            </div>
            <StatusBadge status={subject.ingestionStatus} />
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat label="Lecture decks" value={formatNumber(coverage.lectureDecks)} hint={`${formatNumber(subject.stats.slides)} slides`} />
            <Stat
              label="Textbook"
              value={coverage.textbookPages ? `${formatNumber(coverage.textbookPages)} pp.` : "—"}
              hint={subject.textbook.selected ? "identified" : "not identified"}
            />
            <Stat label="Teaching weeks" value={formatNumber(coverage.totalWeeks)} hint="from the overview" />
            <Stat label="Searchable passages" value={formatNumber(subject.stats.chunks)} hint={`${formatNumber(subject.stats.words)} words`} />
          </CardContent>
        </Card>

        {!learning && <ExamCard mode={repo.mode} activity={activity} today={today} />}

        <CurrentWeekCard current={current} />

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Source coverage</CardTitle>
              <CardDescription>Material available per week — not a measure of learning.</CardDescription>
            </div>
            <FileStack aria-hidden className="size-4 text-subtle" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <div className="mb-1.5 flex justify-between text-[13px]">
                <span className="text-muted">Weeks with lecture material</span>
                <span className="tabular-nums text-foreground">
                  {coverage.weeksWithLectureMaterial}/{coverage.totalWeeks}
                </span>
              </div>
              <ProgressBar value={coverage.lectureCoveragePercent} label="Weeks with lecture material" tone="success" />
            </div>
            <div>
              <div className="mb-1.5 flex justify-between text-[13px]">
                <span className="text-muted">Documents processed</span>
                <span className="tabular-nums text-foreground">
                  {coverage.usableDocuments}/{coverage.totalDocuments}
                </span>
              </div>
              <ProgressBar
                value={coverage.totalDocuments ? (coverage.usableDocuments / coverage.totalDocuments) * 100 : 0}
                label="Documents processed"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {coverage.failedDocuments > 0 && <Badge tone="danger">{pluralize(coverage.failedDocuments, "file")} failed</Badge>}
              {coverage.weeksNeedingVerification > 0 && (
                <Badge tone="warning">
                  {pluralize(coverage.weeksNeedingVerification, "week")} {coverage.weeksNeedingVerification === 1 ? "needs" : "need"} verification
                </Badge>
              )}
              {coverage.failedDocuments === 0 && coverage.weeksNeedingVerification === 0 && (
                <Badge tone="success">No open source issues</Badge>
              )}
            </div>
            <Link href="/sources" className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline">
              Open Source Library <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </CardContent>
        </Card>

        {!learning && <LearningEvidenceCard mode={repo.mode} activity={activity} failed={activityResult?.ok === false} />}
        {!learning && (
          <>

        <ActivityList
          title="Today’s study tasks"
          icon={<CircleCheckBig aria-hidden className="size-4 text-subtle" />}
          empty={
            repo.mode === "local"
              ? "Study plans are saved to your account — available with Supabase."
              : "No tasks scheduled for today. The Study Planner will create daily tasks from your curriculum and exam date."
          }
          items={(activity?.todayTasks ?? []).map((t) => ({
            key: t.id,
            primary: t.title,
            secondary: `${t.taskType}${t.estimatedMinutes ? ` · ${t.estimatedMinutes} min` : ""}`,
          }))}
        />
        <ActivityList
          title="Weak topics"
          icon={<Target aria-hidden className="size-4 text-subtle" />}
          empty="Weak topics appear after you answer checkpoints and quizzes. SYNAPSE never infers them from reading alone."
          items={(activity?.weakTopics ?? []).map((t) => ({
            key: t.topicId,
            primary: t.topicTitle,
            secondary: `Verified score ${Math.round(t.verifiedMastery ?? 0)}%`,
          }))}
        />
        <ActivityList
          title="Recent activity"
          icon={<History aria-hidden className="size-4 text-subtle" />}
          empty={
            repo.mode === "local"
              ? "Activity history is stored in your account — available with Supabase."
              : "No study sessions recorded yet."
          }
          items={(activity?.recentSessions ?? []).map((s) => ({
            key: s.id,
            primary: s.topicTitle ?? s.activity,
            secondary: `${s.activity} · ${formatTimestamp(s.startedAt)}`,
          }))}
        />
          </>
        )}
      </div>
    </div>
  );
}

function ExamCard({ mode, activity, today }: { mode: "local" | "supabase"; activity: LearningActivity | null; today: string }) {
  const exam = activity?.exam;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Exam countdown</CardTitle>
          <CardDescription>{exam ? exam.title : "Set your exam date to plan revision."}</CardDescription>
        </div>
        <CalendarClock aria-hidden className="size-4 text-subtle" />
      </CardHeader>
      <CardContent>
        {exam ? (
          <div>
            <div className="text-4xl font-semibold tabular-nums">{daysUntil(exam.examDate, today)}</div>
            <div className="mt-1 text-[13px] text-muted">days until {formatIsoDate(exam.examDate, { year: "numeric" })}</div>
          </div>
        ) : mode === "supabase" ? (
          <Button asChild variant="secondary" size="sm">
            <Link href="/settings#exam">Add exam date</Link>
          </Button>
        ) : (
          <p className="text-[13px] text-muted">Exam dates are saved to your account and need Supabase.</p>
        )}
      </CardContent>
    </Card>
  );
}

function CurrentWeekCard({ current }: { current: CurrentWeek }) {
  let heading: ReactNode;
  let week: Week | null = null;
  switch (current.status) {
    case "in_week":
      heading = "This week";
      week = current.week;
      break;
    case "between_weeks":
      heading = "Up next";
      week = current.next;
      break;
    case "before_start":
      heading = `Starts in ${pluralize(current.daysUntilStart, "day")}`;
      week = current.next;
      break;
    case "after_end":
      heading = "Teaching weeks finished — revision time";
      week = current.last;
      break;
    default:
      heading = "Current week unknown";
  }
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Current week</CardTitle>
          <CardDescription>{heading}</CardDescription>
        </div>
        <Clock3 aria-hidden className="size-4 text-subtle" />
      </CardHeader>
      <CardContent>
        {week ? (
          <Link href={`/weekly-overview/${week.id}`} className="group block rounded-xl border border-border bg-surface p-3 hover:border-border-strong">
            <div className="text-[13px] font-medium text-foreground">{weekDisplayName(week)}</div>
            {week.dateRange?.startDate && (
              <div className="mt-0.5 text-[12px] text-muted">{formatDateRange(week.dateRange.startDate, week.dateRange.endDate)}</div>
            )}
            <ul className="mt-2 space-y-1 text-[12.5px] text-muted">
              {week.topics.slice(0, 3).map((topic, i) => (
                <li key={i} className="line-clamp-1">• {topic.text}</li>
              ))}
            </ul>
            <span className="mt-2 inline-flex items-center gap-1 text-[12.5px] text-primary">
              Open week <ArrowRight aria-hidden className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ) : (
          <p className="text-[13px] leading-relaxed text-muted">
            The weekly overview has no dates SYNAPSE could read, so it won’t guess where you are in the course.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function LearningEvidenceCard({ mode, activity, failed }: { mode: "local" | "supabase"; activity: LearningActivity | null; failed: boolean }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Learning evidence</CardTitle>
          <CardDescription>Mastery is measured from checkpoints and quizzes only.</CardDescription>
        </div>
        <GraduationCap aria-hidden className="size-4 text-subtle" />
      </CardHeader>
      <CardContent>
        {failed ? (
          <p className="text-[13px] text-danger">Learning activity could not be loaded right now.</p>
        ) : mode === "local" ? (
          <p className="text-[13px] leading-relaxed text-muted">Progress tracking needs an account (Supabase).</p>
        ) : (
          <>
            <div className="text-3xl font-semibold tabular-nums">{activity?.topicsWithEvidence ?? 0}</div>
            <div className="mt-1 text-[13px] text-muted">topics with recorded learning evidence</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityList({
  title,
  icon,
  empty,
  items,
}: {
  title: string;
  icon: ReactNode;
  empty: string;
  items: { key: string; primary: string; secondary: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-muted">{empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => (
              <li key={item.key} className="py-2 first:pt-0 last:pb-0">
                <div className="text-[13.5px] text-foreground">{item.primary}</div>
                <div className="text-[12px] text-subtle">{item.secondary}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-8 w-80 max-w-full" />
      <Skeleton className="mt-3 mb-8 h-4 w-[28rem] max-w-full" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-40 rounded-[var(--radius-card)] lg:col-span-2" />
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-40 rounded-[var(--radius-card)]" />
        ))}
      </div>
    </div>
  );
}
