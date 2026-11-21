import { NotebookPen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { DataErrorPanel } from "@/components/common/data-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { NoteEditor } from "@/components/learning/note-editor";
import { LearningUnavailable } from "@/components/learning/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { attempt } from "@/lib/server/load";
import { formatTimestamp } from "@/lib/utils/format";
import { sessionHref } from "@/modules/curriculum/schedule";
import { loadLearning } from "@/modules/learning/overview";

export const metadata: Metadata = { title: "My Notes" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-[480px] rounded-[var(--radius-card)]" />}>
      <Notes />
    </Suspense>
  );
}

async function Notes() {
  await connection();
  const loaded = await attempt(loadLearning);
  if (!loaded.ok) return <DataErrorPanel error={loaded.error} />;
  if (loaded.value.kind !== "ready") return <LearningUnavailable load={loaded.value} title="My Notes" />;
  const { curriculum, state, store } = loaded.value.overview;
  const sessions = curriculum.sessions.map((s) => ({ key: s.key, label: `${s.label} · ${s.title}` }));
  const label = new Map(sessions.map((s) => [s.key, s.label]));
  const notes = [...state.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const saveHint = store.available ? undefined : store.reason;

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="My Notes"
        title="Your notes, in your words"
        description="Notes are yours — SYNAPSE never mixes them with course material. Attach a note to a session to find it again in the Learning Room."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-3">
          {notes.length === 0 ? (
            <EmptyState icon={NotebookPen} title="No notes yet">
              Write your first note on the right, or from any session in the Learning Room.
            </EmptyState>
          ) : (
            notes.map((n) => (
              <details key={n.id} className="glass rounded-[var(--radius-card)] p-4">
                <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[14.5px] font-semibold text-foreground">{n.title}</span>
                  <span className="text-[12px] text-subtle">
                    {n.sessionKey ? (
                      <Link href={sessionHref({ key: n.sessionKey })} className="hover:text-primary">
                        {label.get(n.sessionKey) ?? n.sessionKey}
                      </Link>
                    ) : (
                      "General"
                    )}{" "}
                    · updated {formatTimestamp(n.updatedAt)}
                  </span>
                </summary>
                <div className="mt-4">
                  <NoteEditor note={n} sessions={sessions} canSave={store.available} saveHint={saveHint} />
                </div>
              </details>
            ))
          )}
        </div>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>New note</CardTitle>
          </CardHeader>
          <CardContent>
            <NoteEditor sessions={sessions} canSave={store.available} saveHint={saveHint} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
