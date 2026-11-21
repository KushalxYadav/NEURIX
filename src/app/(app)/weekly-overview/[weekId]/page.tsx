import { ArrowLeft, BookOpen, Link2Off, ListChecks, Presentation, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DataErrorPanel } from "@/components/common/data-error";
import { NoSourcesState } from "@/components/common/no-sources";
import { PageHeader } from "@/components/common/page-header";
import { EvidenceBadge, StatusBadge } from "@/components/common/status";
import { WeekCoverageChips } from "@/components/curriculum/week-coverage";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getSubjectContext } from "@/lib/server/context";
import { attempt } from "@/lib/server/load";
import { formatDateRange } from "@/lib/utils/format";
import { DOCUMENT_TYPE_LABEL, weekDisplayName } from "@/modules/sources/timeline";
import { getCurriculum } from "@/modules/curriculum";
import type { DocumentSummary, Week } from "@/modules/sources/types";

export const metadata: Metadata = { title: "Week" };

export default function WeekPage({ params }: { params: Promise<{ weekId: string }> }) {
  return (
    <>
      <Link href="/weekly-overview" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" /> Weekly timeline
      </Link>
      <Suspense fallback={<Skeleton className="h-96 rounded-[var(--radius-card)]" />}>
        <WeekDetail params={params} />
      </Suspense>
    </>
  );
}

/** Textbook chapters a "Chapter N" reference may point to (a numeric match, so unverified). */
function matchTextbookChapters(week: Week, textbook: DocumentSummary | undefined) {
  if (!textbook) return [];
  const numbers = new Set<number>();
  for (const reference of week.references) {
    if (reference.kind !== "chapter") continue;
    for (const match of reference.text.matchAll(/\d+/g)) numbers.add(Number(match[0]));
  }
  return textbook.chapters.filter(
    (chapter) => numbers.has(chapter.index) || [...numbers].some((n) => new RegExp(`\\bchapter\\s+${n}\\b`, "i").test(chapter.title)),
  );
}

async function WeekDetail({ params }: { params: Promise<{ weekId: string }> }) {
  const { weekId } = await params;
  const loaded = await attempt(async () => {
    const context = await getSubjectContext();
    if (!context.subject) return { ...context, week: null, documents: [] as DocumentSummary[], curriculum: null };
    const [week, documents, availability] = await Promise.all([
      context.repo.getWeek(context.subject.id, weekId),
      context.repo.listDocuments(context.subject.id),
      getCurriculum(context.subject.id),
    ]);
    return { ...context, week, documents, curriculum: availability.curriculum };
  });
  if (!loaded.ok) return <DataErrorPanel error={loaded.error} />;
  const { subject, repo, week, documents, curriculum } = loaded.value;
  if (!subject) return <NoSourcesState mode={repo.mode} />;
  if (!week) notFound();

  const linked = documents.filter((d) => week.documentIds.includes(d.id));
  const taught = curriculum?.sessions.filter((s) => s.planWeek?.weekId === week.id) ?? [];
  const plannedHere = curriculum?.sessions.filter((s) => s.plannedTopicMatch?.weekId === week.id && s.planWeek?.weekId !== week.id) ?? [];
  const textbook = documents.find((d) => d.documentType === "textbook");
  const chapterMatches = matchTextbookChapters(week, textbook);
  const unresolved = week.resources.filter((r) => r.kind === "unresolved");
  const coverage = subject.coverage.weeks.find((row) => row.weekId === week.id);
  const dates = formatDateRange(week.dateRange?.startDate, week.dateRange?.endDate);
  const displayName = weekDisplayName(week);

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow={week.weekNumber != null ? `Week ${week.weekNumber}` : `Section ${week.ordinal}`}
        title={displayName === week.label ? week.label : `${displayName} · ${week.label}`}
        description={
          <>
            {dates && <>{dates}{week.dateRange?.yearSource && week.dateRange.yearSource !== "explicit" && " (year inferred)"}. </>}
            {week.weekNumberSource === "inferred_from_order" && "Week number taken from its position in the overview. "}
          </>
        }
      />
      <div className="mb-6">
        <WeekCoverageChips row={coverage} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="flex flex-col gap-4 lg:col-span-3">
          {curriculum && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Taught this week</CardTitle>
                  <CardDescription>Sessions whose printed date falls in this week.</CardDescription>
                </div>
                <EvidenceBadge evidence="source_confirmed" />
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {taught.length === 0 && <p className="text-[13px] text-muted">No dated session falls in this week.</p>}
                {taught.map((s) => (
                  <Link key={s.key} href={`/learning/${s.key}`} className="rounded-xl border border-border bg-surface p-3 hover:border-border-strong">
                    <div className="text-[12px] text-subtle">
                      {s.label} · {s.date}
                    </div>
                    <div className="text-[13.5px] font-medium text-foreground">{s.title}</div>
                  </Link>
                ))}
                {plannedHere.length > 0 && (
                  <p className="mt-1 text-[12.5px] text-muted">
                    <Sparkles aria-hidden className="mr-1 inline size-3.5 text-warning" />
                    Topics planned here but taught in another week (keyword match):{" "}
                    {plannedHere.map((s, i) => (
                      <span key={s.key}>
                        {i > 0 && ", "}
                        <Link href={`/learning/${s.key}`} className="text-primary hover:underline">
                          {s.label} {s.title}
                        </Link>
                        {s.planWeek ? ` (${s.planWeek.label.split(" (")[0]})` : " (undated)"}
                      </span>
                    ))}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>What the overview lists</CardTitle>
                <CardDescription>Verbatim from your course page.</CardDescription>
              </div>
              <EvidenceBadge evidence="source_confirmed" />
            </CardHeader>
            <CardContent>
              {week.topics.length === 0 ? (
                <p className="text-[13.5px] text-muted">The overview lists no topics for this week.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {week.topics.map((topic, i) => (
                    <li key={i} className="flex items-start gap-2.5 rounded-xl border border-border bg-surface px-3 py-2">
                      {topic.origin === "resource_link_title" ? (
                        <Presentation aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
                      ) : (
                        <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                      )}
                      <div className="text-[13.5px] text-foreground">
                        {topic.text}
                        {topic.origin === "resource_link_title" && <span className="ml-2 text-[12px] text-subtle">linked file</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 flex items-start gap-2 text-[12.5px] text-subtle">
                <Sparkles aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
                These lines become structured, teachable topics once the curriculum is reconstructed (Phase 3).
              </p>
            </CardContent>
          </Card>

          {week.learningObjectives.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Learning objectives</CardTitle>
                <ListChecks aria-hidden className="size-4 text-subtle" />
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] text-foreground marker:text-primary">
                  {week.learningObjectives.map((objective, i) => <li key={i}>{objective}</li>)}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Lecture material</CardTitle>
              <Presentation aria-hidden className="size-4 text-subtle" />
            </CardHeader>
            <CardContent>
              {linked.length === 0 ? (
                <p className="text-[13.5px] text-muted">No processed file is linked to this week.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {linked.map((document) => {
                    const association = document.weekAssociations.find((a) => a.weekId === week.id);
                    return (
                      <li key={document.id}>
                        <Link
                          href={`/sources/${document.id}`}
                          className="block rounded-xl border border-border bg-surface p-3 hover:border-border-strong"
                        >
                          <div className="break-words text-[13.5px] font-medium">{document.originalFilename}</div>
                          <div className="mt-0.5 text-[12px] text-subtle">{DOCUMENT_TYPE_LABEL[document.documentType]}</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <StatusBadge status={document.processingStatus} />
                            {association && <EvidenceBadge evidence={association.evidence} />}
                          </div>
                          {association?.note && <div className="mt-1.5 text-[12px] text-subtle">{association.note}</div>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Textbook</CardTitle>
              <BookOpen aria-hidden className="size-4 text-subtle" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {week.references.length === 0 ? (
                <p className="text-[13.5px] text-muted">The overview gives no chapter or page reference for this week.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {week.references.map((reference, i) => <Badge key={i} tone="info">{reference.text}</Badge>)}
                </ul>
              )}
              {chapterMatches.map((chapter) => (
                <Link
                  key={chapter.index}
                  href={textbook ? `/sources/${textbook.id}` : "/sources"}
                  className="rounded-xl border border-border bg-surface p-3 hover:border-border-strong"
                >
                  <div className="text-[13.5px] font-medium">{chapter.title}</div>
                  <div className="mt-0.5 text-[12px] text-subtle">
                    {textbook?.originalFilename}
                    {chapter.pageStart != null && `, PDF pages ${chapter.pageStart}–${chapter.pageEnd}`}
                  </div>
                  <div className="mt-2"><EvidenceBadge evidence="unverified" /></div>
                </Link>
              ))}
            </CardContent>
          </Card>

          {unresolved.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Missing material</CardTitle>
                <Link2Off aria-hidden className="size-4 text-danger" />
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-[13px]">
                  {unresolved.map((resource, i) => (
                    <li key={i}>
                      <div className="text-foreground">{resource.text || resource.href}</div>
                      <div className="text-subtle">{resource.reason ?? "Not found in the archive"}</div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
