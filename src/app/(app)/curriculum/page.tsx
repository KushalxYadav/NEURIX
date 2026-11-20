import { BookOpen, CalendarRange, CircleDashed, Link2Off, Presentation, Sparkles, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DataErrorPanel } from "@/components/common/data-error";
import { NoSourcesState } from "@/components/common/no-sources";
import { PageHeader } from "@/components/common/page-header";
import { EvidenceBadge } from "@/components/common/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { aiConfig } from "@/lib/config/env";
import { getSubjectContext } from "@/lib/server/context";
import { attempt } from "@/lib/server/load";
import { pluralize } from "@/lib/utils/format";
import { weekDisplayName } from "@/modules/sources/timeline";

export const metadata: Metadata = { title: "Subject Curriculum" };

export default function CurriculumPage() {
  return (
    <>
      <PageHeader
        eyebrow="Subject Curriculum"
        title="Course structure"
        description="What your sources say about the course — the teaching sequence, the textbook’s chapters, and where material is missing or needs your confirmation."
      />
      <Suspense fallback={<Skeleton className="h-[480px] rounded-[var(--radius-card)]" />}>
        <Curriculum />
      </Suspense>
    </>
  );
}

async function Curriculum() {
  const loaded = await attempt(async () => {
    const context = await getSubjectContext();
    if (!context.subject) return { ...context, weeks: [], documents: [] };
    const [weeks, documents] = await Promise.all([
      context.repo.listWeeks(context.subject.id),
      context.repo.listDocuments(context.subject.id),
    ]);
    return { ...context, weeks, documents };
  });
  if (!loaded.ok) return <DataErrorPanel error={loaded.error} />;
  const { subject, repo, weeks, documents } = loaded.value;
  if (!subject) return <NoSourcesState mode={repo.mode} />;

  const textbook = documents.find((d) => d.documentType === "textbook");
  const coverage = subject.coverage;
  const ai = aiConfig();
  const issues =
    coverage.weeksWithoutMaterial.length +
    coverage.lectureDocumentsNotInOverview.length +
    coverage.unresolvedOverviewLinks.length +
    coverage.failedDocuments.length;

  return (
    <div className="animate-fade-up flex flex-col gap-4">
      <Card className="border-primary/25">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles aria-hidden className="size-4 text-primary" /> AI curriculum reconstruction
            </CardTitle>
            <CardDescription>
              Phase 3: the Curriculum Agent will combine the overview (teaching order), your lecture slides (what was taught) and the
              textbook (depth) into units, topics and prerequisites — each traceable to its sources and editable by you.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5"><CircleDashed aria-hidden className="size-4 text-primary" /> Not run yet</span>
          <span>Claude: {ai.configured ? `configured (${ai.model})` : "not configured"}</span>
          <span>Inputs ready: {pluralize(weeks.length, "week")}, {pluralize(subject.stats.slides, "slide")}, {pluralize(subject.stats.pages, "textbook page")}</span>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Teaching sequence</CardTitle>
              <CardDescription>From the Weekly Overview.</CardDescription>
            </div>
            <EvidenceBadge evidence="source_confirmed" />
          </CardHeader>
          <CardContent>
            {weeks.length === 0 ? (
              <p className="text-[13.5px] text-muted">No weekly structure was found in the overview.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-border">
                {weeks.map((week) => (
                  <li key={week.id} className="py-2.5 first:pt-0 last:pb-0">
                    <Link href={`/weekly-overview/${week.id}`} className="group block">
                      <div className="flex items-center gap-2 text-[13.5px] font-medium text-foreground group-hover:text-primary">
                        <CalendarRange aria-hidden className="size-3.5 text-subtle" /> {weekDisplayName(week)}
                        {weekDisplayName(week) !== week.label && <span className="font-normal text-muted">· {week.label}</span>}
                      </div>
                      <div className="mt-0.5 line-clamp-2 pl-5.5 text-[12.5px] text-muted">
                        {week.topics.map((t) => t.text).join(" · ") || "No topics listed"}
                      </div>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Textbook chapters</CardTitle>
              <CardDescription>{textbook ? textbook.originalFilename : "No textbook identified in the archive."}</CardDescription>
            </div>
            {textbook && textbook.chapters.length > 0 && (
              <EvidenceBadge evidence={textbook.chapters.every((c) => c.source === "pdf_outline") ? "source_confirmed" : "unverified"} />
            )}
          </CardHeader>
          <CardContent>
            {!textbook ? (
              <p className="text-[13.5px] text-muted">
                If your archive contains the textbook, re-run the pipeline with <code className="font-mono">--textbook &lt;path&gt;</code>.
              </p>
            ) : textbook.chapters.length === 0 ? (
              <p className="text-[13.5px] text-muted">The textbook has no outline and no recognisable chapter headings.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-border">
                {textbook.chapters.map((chapter) => (
                  <li key={chapter.index} className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="flex items-center gap-2 text-[13.5px] text-foreground">
                      <BookOpen aria-hidden className="size-3.5 shrink-0 text-subtle" /> {chapter.title}
                    </span>
                    {chapter.pageStart != null && (
                      <span className="shrink-0 text-[12px] tabular-nums text-subtle">pp. {chapter.pageStart}–{chapter.pageEnd}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Source coverage report</CardTitle>
            <CardDescription>
              {issues === 0 ? "No gaps found between the overview and the files." : `${pluralize(issues, "item")} to review.`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <ReportList
            icon={<CalendarRange aria-hidden className="size-4 text-warning" />}
            title="Weeks without linked material"
            items={coverage.weeksWithoutMaterial}
          />
          <ReportList
            icon={<Presentation aria-hidden className="size-4 text-warning" />}
            title="Lecture files the overview never links"
            items={coverage.lectureDocumentsNotInOverview.map((d) => d.filename)}
          />
          <ReportList
            icon={<Link2Off aria-hidden className="size-4 text-danger" />}
            title="Overview links to missing files"
            items={coverage.unresolvedOverviewLinks.map((l) => `${l.text || l.href} — ${l.reason ?? "not found"}`)}
          />
          <ReportList
            icon={<TriangleAlert aria-hidden className="size-4 text-danger" />}
            title="Files that failed to process"
            items={coverage.failedDocuments}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ReportList({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[13.5px] font-medium text-foreground">
        {icon} {title}
        <span className="ml-auto text-[12px] tabular-nums text-subtle">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="mt-1 pl-6 text-[12.5px] text-subtle">None</p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1 pl-6 text-[12.5px] text-muted">
          {items.map((item) => <li key={item} className="break-words">{item}</li>)}
        </ul>
      )}
    </div>
  );
}
