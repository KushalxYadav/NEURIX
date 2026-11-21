import {
  AlertTriangle,
  ArrowLeft,
  BookMarked,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Lightbulb,
  ListChecks,
  MessageSquareText,
  NotebookPen,
  Presentation,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { DataErrorPanel } from "@/components/common/data-error";
import { EvidenceBadge } from "@/components/common/status";
import { NoteEditor } from "@/components/learning/note-editor";
import { QuestionCard, Verbatim, type QuestionView } from "@/components/learning/question-card";
import { SessionStatusControl } from "@/components/learning/session-status";
import { LearningUnavailable } from "@/components/learning/states";
import { TutorChat } from "@/components/learning/tutor-chat";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { aiConfig } from "@/lib/config/env";
import { getSubjectContext } from "@/lib/server/context";
import { attempt } from "@/lib/server/load";
import { cn } from "@/lib/utils/cn";
import { formatIsoDate } from "@/lib/utils/format";
import { moduleTitle, sessionHref, sourceUnitHref, studyDocuments } from "@/modules/curriculum/schedule";
import { loadLearning } from "@/modules/learning/overview";

export const metadata: Metadata = { title: "Session" };

type Params = Promise<{ sessionKey: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function SessionPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <>
      <Link href="/learning" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" /> Learning Room
      </Link>
      <Suspense fallback={<Skeleton className="h-[640px] rounded-[var(--radius-card)]" />}>
        <SessionRoom params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const ROLE_LABEL: Record<string, string> = { slides: "Slides", reading: "Reading", practice: "Practice", activity: "Activity", assessment: "Assessment" };

async function SessionRoom({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await connection();
  const [{ sessionKey }, query] = await Promise.all([params, searchParams]);
  const loaded = await attempt(loadLearning);
  if (!loaded.ok) return <DataErrorPanel error={loaded.error} />;
  if (loaded.value.kind !== "ready") return <LearningUnavailable load={loaded.value} title="Learning Room" />;
  const { curriculum, bank, state, mastery, store, subjectId } = loaded.value.overview;
  const key = decodeURIComponent(sessionKey);
  const session = curriculum.sessions.find((s) => s.key === key);
  if (!session) notFound();

  const docs = studyDocuments(session).filter((d) => d.role === "slides" || d.role === "reading" || d.role === "activity" || d.role === "practice");
  const docParam = typeof query.doc === "string" ? query.doc : undefined;
  const activeDoc = docs.find((d) => d.documentId === docParam) ?? docs[0];
  const unitParam = Number(typeof query.unit === "string" ? query.unit : 1);
  const unitIndex = Number.isInteger(unitParam) && unitParam > 0 ? unitParam : 1;

  const { repo } = await getSubjectContext();
  const page = activeDoc ? await repo.listDocumentUnits(subjectId, activeDoc.documentId, { offset: unitIndex - 1, limit: 1 }) : null;
  const unit = page?.items[0];

  const sessionQuestions = bank.questions.filter((q) => q.sessionKeys.includes(session.key));
  const latest = new Map<string, QuestionView["lastResult"]>();
  for (const a of state.attempts) latest.set(a.questionId, a.result);
  const questions: QuestionView[] = sessionQuestions.map((q) => ({ ...q, lastResult: latest.get(q.id) ?? null }));
  const terms = bank.terms.filter((t) => t.sessionKeys.includes(session.key));
  const notes = state.notes.filter((n) => n.sessionKey === session.key);
  const m = mastery.get(session.key);
  const ordered = curriculum.sessions;
  const position = ordered.findIndex((s) => s.key === session.key);
  const prev = ordered[position - 1];
  const next = ordered[position + 1];
  const ai = aiConfig().configured;
  const saveHint = store.available ? undefined : store.reason;
  const href = (doc: string, u: number) => `${sessionHref(session)}?doc=${doc}&unit=${u}#study`;

  return (
    <div className="animate-fade-up">
      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-primary">
          {moduleTitle(curriculum, session.module)} <span className="text-subtle">·</span> {session.label}
        </div>
        <h1 className="text-[28px] font-semibold leading-tight text-foreground sm:text-[32px]">{session.title}</h1>
        {session.subtitle && <p className="mt-1 text-[15px] text-muted">{session.subtitle}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays aria-hidden className="size-4" />
            {session.date ? formatIsoDate(session.date, { weekday: "long", day: "numeric", month: "long" }) : "Date not stated in the material"}
          </span>
          {session.planWeek ? (
            <Link href={`/weekly-overview/${session.planWeek.weekId}`} className="inline-flex items-center gap-1.5 hover:text-foreground" title={session.planWeek.basis}>
              Weekly Overview: {session.planWeek.label} <EvidenceBadge evidence="source_confirmed" />
            </Link>
          ) : (
            <span title="Placement in a week needs a date printed in the material">No overview week (undated)</span>
          )}
          {session.lmsUnits.length > 0 && <span>LMS module: {session.lmsUnits.join(", ")}</span>}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SessionStatusControl sessionKey={session.key} status={state.sessions[session.key]?.status ?? "not_started"} disabledReason={saveHint} />
          {m && m.total > 0 && (
            <Badge tone={m.score == null ? "neutral" : m.score >= 75 ? "success" : m.score >= 50 ? "warning" : "danger"}>
              {m.score == null ? `${m.total} checkpoint questions` : `Mastery ${m.score}% · ${m.attempted}/${m.total} answered`}
            </Badge>
          )}
        </div>
      </header>

      {session.drivingQuestion && (
        <div className="glass mb-6 flex gap-3 rounded-[var(--radius-card)] border-primary/25 p-5">
          <Lightbulb aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <div className="text-[12px] font-medium uppercase tracking-wider text-primary">The question this session answers</div>
            <p className="mt-1 text-[17px] font-medium leading-snug text-foreground">{session.drivingQuestion}</p>
            <p className="mt-1.5 text-[12px] text-subtle">{session.drivingQuestionSource} · Try to answer it before you start — then again at the end.</p>
          </div>
        </div>
      )}

      {session.objectives.length > 0 && (
        <div className="glass mb-6 rounded-[var(--radius-card)] p-5">
          <div className="mb-2 flex items-center gap-2">
            <ListChecks aria-hidden className="size-4 text-primary" />
            <span className="text-[13px] font-semibold text-foreground">What you will learn</span>
            <EvidenceBadge evidence="source_confirmed" />
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {session.objectives.map((o) => (
              <li key={o} className="flex gap-2 text-[13.5px] leading-relaxed text-muted">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                {o}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-subtle">{session.objectivesSource}</p>
        </div>
      )}

      {session.discrepancies.length > 0 && (
        <details className="mb-6 rounded-[var(--radius-card)] border border-warning/25 bg-warning-soft/40 p-4">
          <summary className="cursor-pointer text-[13px] font-medium text-warning">
            <AlertTriangle aria-hidden className="mr-1.5 inline size-4" /> {session.discrepancies.length} source {session.discrepancies.length === 1 ? "discrepancy" : "discrepancies"} — both versions kept
          </summary>
          <ul className="mt-2 list-disc pl-5 text-[13px] text-muted">
            {session.discrepancies.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section id="study" className="scroll-mt-24" aria-labelledby="study-heading">
            <SectionTitle id="study-heading" icon={<Presentation aria-hidden className="size-4" />} title="Study the material" hint="One slide or page at a time, exactly as your teacher wrote it." />
            {docs.length === 0 ? (
              <p className="text-[13.5px] text-muted">No slides or readings are mapped to this session.</p>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap gap-2">
                  {docs.map((d) => (
                    <Link
                      key={d.documentId}
                      href={href(d.documentId, 1)}
                      scroll={false}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px]",
                        d.documentId === activeDoc?.documentId ? "border-primary/40 bg-primary-soft text-primary" : "border-border-strong text-muted hover:text-foreground",
                      )}
                    >
                      {d.role === "slides" ? <Presentation aria-hidden className="size-3.5" /> : <FileText aria-hidden className="size-3.5" />}
                      {ROLE_LABEL[d.role] ?? d.role}: <span className="max-w-[16rem] truncate">{d.filename}</span>
                      {d.verification === "unverified" && <span title={d.evidence.join("; ")} className="text-warning">?</span>}
                    </Link>
                  ))}
                </div>
                {unit && activeDoc && page ? (
                  <Card>
                    <CardHeader>
                      <div>
                        <CardTitle>
                          {activeDoc.role === "slides" ? "Slide" : unit.unitType === "section" ? "Section" : "Page"} {unit.unitNumber}{" "}
                          <span className="font-normal text-subtle">of {page.total}</span>
                        </CardTitle>
                        <CardDescription>{unit.citation}</CardDescription>
                      </div>
                      <EvidenceBadge evidence="source_confirmed" />
                    </CardHeader>
                    <CardContent>
                      {unit.text.trim() ? (
                        <Verbatim text={unit.text} className="max-h-[520px] overflow-y-auto pr-1 text-[14.5px] leading-[1.75] text-foreground/95" />
                      ) : (
                        <p className="text-[13.5px] text-muted">This slide has no extractable text (it may be a diagram). Open the original in the Source Library.</p>
                      )}
                      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                        <PagerLink disabled={unit.unitNumber <= 1} href={href(activeDoc.documentId, unit.unitNumber - 1)} icon={<ChevronLeft aria-hidden />} label="Previous" />
                        <PagerLink disabled={unit.unitNumber >= page.total} href={href(activeDoc.documentId, unit.unitNumber + 1)} icon={<ChevronRight aria-hidden />} label="Next" trailing />
                        <Link href={sourceUnitHref(activeDoc.documentId, unit.unitNumber)} className="ml-auto text-[12.5px] text-primary hover:underline">
                          Open in Source Library
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <p className="text-[13.5px] text-muted">This document has no extracted text.</p>
                )}
              </>
            )}
          </section>

          {terms.length > 0 && (
            <section aria-labelledby="terms-heading">
              <SectionTitle id="terms-heading" icon={<BookMarked aria-hidden className="size-4" />} title="Key terms" hint="Defined in your course reading." />
              <dl className="grid gap-3 sm:grid-cols-2">
                {terms.map((t) => (
                  <div key={t.id} className="glass rounded-2xl p-4">
                    <dt className="text-[14px] font-semibold text-foreground">{t.term}</dt>
                    <dd className="mt-1 text-[13px] leading-relaxed text-muted">{t.definition}</dd>
                    <dd className="mt-1.5 text-[11.5px] text-subtle">{t.citation}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section aria-labelledby="check-heading">
            <SectionTitle id="check-heading" icon={<ListChecks aria-hidden className="size-4" />} title="Check your understanding" hint="Questions from your course, with the course’s own answers." />
            {questions.length ? (
              <div className="flex flex-col gap-3">
                {questions.map((q, i) => (
                  <QuestionCard key={q.id} question={q} index={i + 1} canSave={store.available} saveHint={saveHint} />
                ))}
              </div>
            ) : (
              <p className="glass rounded-2xl p-4 text-[13.5px] text-muted">
                Your course material has no numbered questions for this session. Module-wide practice sets are in the{" "}
                <Link href="/practice" className="text-primary hover:underline">Practice Arena</Link>; or ask the tutor below to quiz you.
              </p>
            )}
          </section>

          <section aria-labelledby="tutor-heading">
            <SectionTitle
              id="tutor-heading"
              icon={<MessageSquareText aria-hidden className="size-4" />}
              title="Learn it with the tutor"
              hint={ai ? "Answers cite this session’s material first." : "Without an API key the tutor finds the exact passages instead of writing explanations."}
            />
            <TutorChat
              aiEnabled={ai}
              sessions={[{ key: session.key, label: `${session.label} — ${session.title}` }]}
              initialSession={session.key}
              suggestions={[
                `Teach me ${session.title} from zero`,
                `Explain ${session.title} at university level`,
                `What are the key points of ${session.title} for the exam?`,
                ...(session.drivingQuestion ? [session.drivingQuestion] : []),
              ]}
            />
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          {session.scheduleCover && (
            <Card>
              <CardHeader>
                <CardTitle>From the schedule</CardTitle>
                <EvidenceBadge evidence="source_confirmed" />
              </CardHeader>
              <CardContent>
                <p className="text-[13.5px] leading-relaxed text-muted">{session.scheduleCover}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Further reading</CardTitle>
                <CardDescription>Chapters your teacher cites for this session.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {session.furtherReading.length === 0 && <p className="text-[13px] text-muted">None cited in this session’s material.</p>}
              {session.furtherReading.map((r, i) => (
                <div key={i} className="rounded-xl border border-border bg-surface p-3">
                  <div className="text-[13px] font-medium text-foreground">{r.bookTitle.replace(/ compressed$/, "")}</div>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {r.resolved.map((p) => (
                      <li key={`${p.title}-${p.pageStart}`} className="flex items-center justify-between gap-2 text-[12.5px]">
                        <Link href={sourceUnitHref(r.bookDocumentId, p.pageStart)} className="text-primary hover:underline">
                          {p.title} · pp. {p.pageStart}–{p.pageEnd}
                        </Link>
                        <EvidenceBadge evidence={p.verification === "source_confirmed" ? "source_confirmed" : "unverified"} />
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[11.5px] text-subtle">
                    Cited in {r.citedIn}, {r.citedAt}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {session.suggestedSections.length > 0 && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Related textbook sections</CardTitle>
                  <CardDescription>Keyword match — not cited by your teacher.</CardDescription>
                </div>
                <Badge tone="warning">
                  <Sparkles aria-hidden /> Suggestion
                </Badge>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-1.5">
                  {session.suggestedSections.map((s) => (
                    <li key={`${s.bookDocumentId}-${s.pageStart}`} className="text-[12.5px]">
                      <Link href={sourceUnitHref(s.bookDocumentId, s.pageStart)} className="text-primary hover:underline">
                        {s.title}
                      </Link>{" "}
                      <span className="text-subtle">
                        · {s.bookTitle.split(/[:,]/)[0].replace(/ compressed$/, "")} pp. {s.pageStart}–{s.pageEnd}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>My notes</CardTitle>
              <NotebookPen aria-hidden className="size-4 text-subtle" />
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {notes.map((n) => (
                <details key={n.id} className="rounded-xl border border-border bg-surface p-3">
                  <summary className="cursor-pointer text-[13px] font-medium text-foreground">{n.title}</summary>
                  <div className="mt-3">
                    <NoteEditor note={n} canSave={store.available} saveHint={saveHint} />
                  </div>
                </details>
              ))}
              <NoteEditor sessionKey={session.key} canSave={store.available} saveHint={saveHint} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How this session was mapped</CardTitle>
              <ShieldCheck aria-hidden className="size-4 text-subtle" />
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-[12.5px] text-muted">
                {session.date && <li>Date: {session.dateBasis}</li>}
                {session.planWeek && <li>Week: {session.planWeek.basis}</li>}
                {session.documents.map((d) => (
                  <li key={d.documentId}>
                    <span className="text-foreground">{d.filename}</span> — {d.evidence.join("; ")}{" "}
                    <EvidenceBadge evidence={d.verification === "source_confirmed" ? "source_confirmed" : "unverified"} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>

      <nav className="mt-10 flex justify-between gap-3 border-t border-border pt-5" aria-label="Session navigation">
        {prev ? (
          <Link href={sessionHref(prev)} className="text-[13px] text-muted hover:text-foreground">
            ← {prev.label}: {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={sessionHref(next)} className="text-right text-[13px] text-muted hover:text-foreground">
            {next.label}: {next.title} →
          </Link>
        )}
      </nav>
    </div>
  );
}

function SectionTitle({ id, icon, title, hint }: { id: string; icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="flex items-center gap-2 text-[16px] font-semibold text-foreground">
        <span className="text-primary">{icon}</span> {title}
      </h2>
      {hint && <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p>}
    </div>
  );
}

function PagerLink({ href, disabled, icon, label, trailing }: { href: string; disabled: boolean; icon: ReactNode; label: string; trailing?: boolean }) {
  const content = trailing ? (
    <>
      {label} {icon}
    </>
  ) : (
    <>
      {icon} {label}
    </>
  );
  const className = "inline-flex h-8 items-center gap-1 rounded-xl border border-border-strong px-3 text-[13px] [&_svg]:size-4";
  if (disabled) return <span className={cn(className, "opacity-40")}>{content}</span>;
  return (
    <Link href={href} scroll={false} className={cn(className, "text-foreground hover:bg-surface-strong")}>
      {content}
    </Link>
  );
}
