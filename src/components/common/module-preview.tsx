import { CheckCircle2, CircleDashed, CircleSlash, type LucideIcon } from "lucide-react";
import { Suspense } from "react";

import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { aiConfig, getDataMode } from "@/lib/config/env";
import { getSubjectContext } from "@/lib/server/context";
import { attempt } from "@/lib/server/load";
import { pluralize } from "@/lib/utils/format";

export type Requirement = "sources" | "curriculum" | "ai" | "account";

/**
 * Honest placeholder for a module that arrives in a later phase: what it will
 * do, and a live check of what it depends on. No mock data.
 */
export function ModulePreview({
  icon: Icon,
  eyebrow,
  title,
  description,
  phase,
  capabilities,
  requires,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  phase: number;
  capabilities: string[];
  requires: Requirement[];
}) {
  return (
    <div className="animate-fade-up">
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={<Badge tone="violet">Arrives in phase {phase}</Badge>} />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>What this module will do</CardTitle>
            <Icon aria-hidden className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2.5">
              {capabilities.map((capability) => (
                <li key={capability} className="flex gap-2.5 text-[13.5px] leading-relaxed text-muted">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  {capability}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Readiness</CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-28" />}>
              <Readiness requires={requires} />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function Readiness({ requires }: { requires: Requirement[] }) {
  const loaded = await attempt(getSubjectContext);
  const subject = loaded.ok ? loaded.value.subject : null;
  const mode = getDataMode();
  const ai = aiConfig();
  const rows: { key: Requirement; state: "ok" | "missing" | "pending"; label: string; detail: string }[] = [];
  for (const requirement of requires) {
    if (requirement === "sources") {
      rows.push(
        subject && subject.stats.chunks > 0
          ? { key: requirement, state: "ok", label: "Course material processed", detail: `${pluralize(subject.stats.chunks, "searchable passage")} ready` }
          : { key: requirement, state: "missing", label: "Course material processed", detail: "Run the ingestion pipeline on your archive" },
      );
    } else if (requirement === "curriculum") {
      rows.push({ key: requirement, state: "pending", label: "Curriculum reconstructed", detail: "Curriculum Agent (phase 3) turns the weekly overview into teachable topics" });
    } else if (requirement === "ai") {
      rows.push(
        ai.configured
          ? { key: requirement, state: "ok", label: "Claude connected", detail: `Model ${ai.model}` }
          : { key: requirement, state: "missing", label: "Claude connected", detail: "Set ANTHROPIC_API_KEY on the server" },
      );
    } else {
      rows.push(
        mode === "supabase"
          ? { key: requirement, state: "ok", label: "Account for saved progress", detail: "Supabase connected" }
          : { key: requirement, state: "missing", label: "Account for saved progress", detail: "Configure Supabase to save your work" },
      );
    }
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.key} className="flex gap-2.5">
          {row.state === "ok" ? (
            <CheckCircle2 aria-label="Ready" className="mt-0.5 size-4 shrink-0 text-success" />
          ) : row.state === "pending" ? (
            <CircleDashed aria-label="Pending" className="mt-0.5 size-4 shrink-0 text-primary" />
          ) : (
            <CircleSlash aria-label="Missing" className="mt-0.5 size-4 shrink-0 text-subtle" />
          )}
          <div>
            <div className="text-[13.5px] text-foreground">{row.label}</div>
            <div className="text-[12.5px] text-muted">{row.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
