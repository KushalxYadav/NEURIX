import { Flame, Target, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { DataErrorPanel } from "@/components/common/data-error";
import { PageHeader } from "@/components/common/page-header";
import { Stat } from "@/components/common/stat";
import { LearningUnavailable } from "@/components/learning/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { attempt } from "@/lib/server/load";
import { sessionHref } from "@/modules/curriculum/schedule";
import { loadLearning } from "@/modules/learning/overview";
import { studyStreak } from "@/modules/learning/state";

export const metadata: Metadata = { title: "Progress" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-[480px] rounded-[var(--radius-card)]" />}>
      <Progress />
    </Suspense>
  );
}

const STATUS_LABEL = { studied: "Studied", in_progress: "In progress", not_started: "Not started" } as const;

async function Progress() {
  await connection();
  const loaded = await attempt(loadLearning);
  if (!loaded.ok) return <DataErrorPanel error={loaded.error} />;
  if (loaded.value.kind !== "ready") return <LearningUnavailable load={loaded.value} title="Progress" />;
  const { curriculum, bank, state, mastery, weak, today } = loaded.value.overview;

  const latest = new Map<string, string>();
  for (const a of state.attempts) latest.set(a.questionId, a.result);
  const answered = [...latest.values()];
  const accuracy = answered.length ? Math.round((answered.filter((r) => r === "correct").length / answered.length) * 100) : null;
  const studied = curriculum.sessions.filter((s) => state.sessions[s.key]?.status === "studied").length;
  const streak = studyStreak(state, today);

  // Performance by question source (practice set, quiz, reading)
  const bySource = new Map<string, { answered: number; correct: number; total: number }>();
  for (const q of bank.questions) {
    const row = bySource.get(q.filename) ?? { answered: 0, correct: 0, total: 0 };
    row.total += 1;
    const r = latest.get(q.id);
    if (r) {
      row.answered += 1;
      if (r === "correct") row.correct += 1;
    }
    bySource.set(q.filename, row);
  }
  const sources = [...bySource.entries()].filter(([, r]) => r.answered > 0).sort((a, b) => b[1].answered - a[1].answered);

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Progress"
        title="What you can actually do"
        description="Mastery is the share of a session’s questions you got right on your latest attempt. Reading and opening pages never count — only answers do."
      />
      <div className="glass mb-6 grid grid-cols-2 gap-5 rounded-[var(--radius-card)] p-5 sm:grid-cols-4">
        <Stat label="Sessions studied" value={`${studied}/${curriculum.sessions.length}`} hint="marked by you" />
        <Stat label="Questions answered" value={`${answered.length}/${bank.questions.length}`} hint={`${state.attempts.length} attempts`} />
        <Stat label="Latest accuracy" value={accuracy == null ? "—" : `${accuracy}%`} hint="across answered questions" />
        <Stat label="Study streak" value={<span className="inline-flex items-center gap-1.5">{streak}<Flame aria-hidden className="size-4 text-warning" /></span>} hint={streak === 1 ? "day" : "days"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          {curriculum.modules.map((module) => {
            const sessions = curriculum.sessions.filter((s) => s.module === module.number);
            if (!sessions.length) return null;
            return (
              <Card key={module.number}>
                <CardHeader>
                  <div>
                    <CardTitle>
                      Module {module.number}
                      {module.title ? ` · ${module.title}` : ""}
                    </CardTitle>
                    <CardDescription>Topic mastery by session.</CardDescription>
                  </div>
                  <TrendingUp aria-hidden className="size-4 text-subtle" />
                </CardHeader>
                <CardContent>
                  <table className="w-full text-left text-[13px]">
                    <thead className="text-[11.5px] uppercase tracking-wider text-subtle">
                      <tr>
                        <th scope="col" className="pb-2 font-medium">Session</th>
                        <th scope="col" className="hidden pb-2 font-medium sm:table-cell">Status</th>
                        <th scope="col" className="w-[38%] pb-2 font-medium">Mastery</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s) => {
                        const m = mastery.get(s.key);
                        const status = state.sessions[s.key]?.status ?? "not_started";
                        return (
                          <tr key={s.key} className="border-t border-border">
                            <td className="py-2.5 pr-3">
                              <Link href={sessionHref(s)} className="text-foreground hover:text-primary">
                                <span className="font-mono text-[11.5px] text-subtle">{s.label}</span> {s.title}
                              </Link>
                            </td>
                            <td className="hidden py-2.5 pr-3 text-muted sm:table-cell">{STATUS_LABEL[status]}</td>
                            <td className="py-2.5">
                              {!m || m.total === 0 ? (
                                <span className="text-[12px] text-subtle">No course questions</span>
                              ) : m.score == null ? (
                                <span className="text-[12px] text-subtle">0/{m.total} answered</span>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <ProgressBar value={m.score} label={`Mastery of ${s.title}`} tone={m.score >= 75 ? "success" : undefined} />
                                  <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-muted">
                                    {m.score}% · {m.attempted}/{m.total}
                                  </span>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Weak topics</CardTitle>
                <CardDescription>Under 60% with at least two answers.</CardDescription>
              </div>
              <Target aria-hidden className="size-4 text-subtle" />
            </CardHeader>
            <CardContent>
              {weak.length === 0 ? (
                <p className="text-[13px] text-muted">None detected yet. Weak topics appear only after you answer questions.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {weak.map((key) => {
                    const s = curriculum.sessions.find((x) => x.key === key)!;
                    return (
                      <li key={key} className="flex items-center justify-between gap-2">
                        <Link href={`/practice?scope=${key}`} className="text-[13px] text-foreground hover:text-primary">
                          {s.label} · {s.title}
                        </Link>
                        <Badge tone="danger">{mastery.get(key)?.score}%</Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Quiz & practice performance</CardTitle>
                <CardDescription>Latest result per question, by source.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {sources.length === 0 ? (
                <p className="text-[13px] text-muted">Answer questions in the Practice Arena to see results here.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {sources.map(([file, r]) => (
                    <li key={file}>
                      <div className="mb-1 flex justify-between gap-2 text-[12.5px]">
                        <span className="truncate text-foreground">{file}</span>
                        <span className="shrink-0 tabular-nums text-muted">
                          {r.correct}/{r.answered} correct · {r.answered}/{r.total}
                        </span>
                      </div>
                      <ProgressBar value={(r.correct / r.answered) * 100} label={`Correct in ${file}`} tone="success" />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
