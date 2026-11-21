import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { DataErrorPanel } from "@/components/common/data-error";
import { PageHeader } from "@/components/common/page-header";
import { LearningUnavailable } from "@/components/learning/states";
import { TutorChat } from "@/components/learning/tutor-chat";
import { Skeleton } from "@/components/ui/skeleton";
import { aiConfig } from "@/lib/config/env";
import { attempt } from "@/lib/server/load";
import { upcomingSessions } from "@/modules/curriculum/schedule";
import { loadLearning } from "@/modules/learning/overview";

export const metadata: Metadata = { title: "AI Tutor" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<Skeleton className="h-[480px] rounded-[var(--radius-card)]" />}>
      <Tutor searchParams={searchParams} />
    </Suspense>
  );
}

async function Tutor({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const query = await searchParams;
  const loaded = await attempt(loadLearning);
  if (!loaded.ok) return <DataErrorPanel error={loaded.error} />;
  if (loaded.value.kind !== "ready") return <LearningUnavailable load={loaded.value} title="AI Tutor" />;
  const { curriculum, today } = loaded.value.overview;
  const ai = aiConfig();
  const session = typeof query.session === "string" && curriculum.sessions.some((s) => s.key === query.session) ? query.session : undefined;
  const next = upcomingSessions(curriculum.sessions, today, 1)[0];
  const suggestions = [
    ...(next ? [`Prepare me for ${next.label}: ${next.title}`] : []),
    "What is the difference between a hub and a switch?",
    "How does two's complement represent negative numbers?",
    "Why is a cache faster than RAM?",
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="AI Tutor"
        title="Ask about anything in your course"
        description={
          ai.configured
            ? `Answers come from your slides, readings and textbooks first, with the exact file and slide/page. Anything beyond your material is labelled “AI supplementary”. Model: ${ai.model}.`
            : "Search mode: SYNAPSE finds the exact passages in your slides, readings and textbooks. Add ANTHROPIC_API_KEY on the server to get written explanations built from those passages."
        }
      />
      <div className="mx-auto max-w-3xl">
        <TutorChat
          aiEnabled={ai.configured}
          sessions={curriculum.sessions.map((s) => ({ key: s.key, label: `${s.label} · ${s.title}` }))}
          initialSession={session}
          suggestions={suggestions}
        />
      </div>
    </div>
  );
}
