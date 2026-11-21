import { CheckCircle2, CircleSlash } from "lucide-react";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { DataErrorPanel } from "@/components/common/data-error";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { aiConfig, embeddingsConfig, getDataMode } from "@/lib/config/env";
import { getSubjectContext } from "@/lib/server/context";
import { attempt } from "@/lib/server/load";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { localDataDir } from "@/modules/sources";

import { PreferencesForm, type PreferencesDefaults } from "./preferences-form";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader eyebrow="Settings" title="Settings" description="Your exam, study preferences and how this SYNAPSE installation is configured." />
      <div className="flex flex-col gap-4">
        <Suspense fallback={<Skeleton className="h-64 rounded-[var(--radius-card)]" />}>
          <AccountAndPreferences />
        </Suspense>
        <SystemStatus />
      </div>
    </>
  );
}

async function AccountAndPreferences() {
  const loaded = await attempt(async () => {
    const context = await getSubjectContext();
    let defaults: PreferencesDefaults | null = null;
    if (context.viewer.kind === "user" && context.subject) {
      const supabase = await createSupabaseServerClient();
      const [profile, exam] = await Promise.all([
        supabase.from("profiles").select("daily_study_minutes, knowledge_level, preferred_study_time").maybeSingle(),
        supabase.from("exams").select("title, exam_date").eq("subject_id", context.subject.id).order("created_at").limit(1).maybeSingle(),
      ]);
      defaults = {
        subjectId: context.subject.id,
        examTitle: exam.data?.title ?? "End-semester examination",
        examDate: exam.data?.exam_date ?? "",
        dailyMinutes: profile.data?.daily_study_minutes?.toString() ?? "",
        knowledgeLevel: profile.data?.knowledge_level ?? "",
        preferredTime: profile.data?.preferred_study_time ?? "",
      };
    }
    return { ...context, defaults };
  });
  if (!loaded.ok) return <DataErrorPanel error={loaded.error} />;
  const { viewer, subject, defaults } = loaded.value;
  return (
    <>
      <Card id="exam">
        <CardHeader>
          <div>
            <CardTitle>Exam & study preferences</CardTitle>
            <CardDescription>Used by the Study Planner to build a schedule from your real curriculum.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {viewer.kind !== "user" ? (
            <p className="text-[13.5px] text-muted">Preferences are stored in your account. Configure Supabase and sign in to save them.</p>
          ) : !subject || !defaults ? (
            <p className="text-[13.5px] text-muted">Load your subject first; preferences are saved per subject.</p>
          ) : (
            <PreferencesForm defaults={defaults} disabled={false} />
          )}
        </CardContent>
      </Card>
      {viewer.kind === "user" && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Account</CardTitle>
              <CardDescription>{viewer.email}</CardDescription>
            </div>
            <form action={signOut}>
              <Button variant="secondary" size="sm" type="submit">Sign out</Button>
            </form>
          </CardHeader>
          <CardContent />
        </Card>
      )}
    </>
  );
}

function StatusRow({ ok, label, children }: { ok: boolean; label: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      {ok ? (
        <CheckCircle2 aria-label="Configured" className="mt-0.5 size-4 shrink-0 text-success" />
      ) : (
        <CircleSlash aria-label="Not configured" className="mt-0.5 size-4 shrink-0 text-subtle" />
      )}
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium text-foreground">{label}</div>
        <div className="text-[12.5px] text-muted">{children}</div>
      </div>
    </li>
  );
}

/** Configuration status only — never shows secret values. */
function SystemStatus() {
  const mode = getDataMode();
  const ai = aiConfig();
  const embeddings = embeddingsConfig();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>System status</CardTitle>
          <CardDescription>Secrets stay on the server and are never displayed.</CardDescription>
        </div>
        <Badge tone={mode === "supabase" ? "success" : "warning"}>{mode === "supabase" ? "Supabase mode" : "Local mode"}</Badge>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          <StatusRow ok={mode === "supabase"} label="Accounts & database">
            {mode === "supabase"
              ? "Supabase connected. Data is private to each account (Row Level Security)."
              : <>Reading processed files from <code className="break-all font-mono">{localDataDir()}</code>. No sign-in; nothing is saved.</>}
          </StatusRow>
          <StatusRow ok={ai.configured} label="AI teaching (Claude)">
            {ai.configured ? `Model ${ai.model}, effort ${ai.effort}.` : "ANTHROPIC_API_KEY not set — AI features stay disabled."}
          </StatusRow>
          <StatusRow ok={embeddings.configured} label="Semantic search (optional)">
            {embeddings.configured
              ? `Embeddings: ${embeddings.provider} ${embeddings.model}. Hybrid retrieval enabled.`
              : "No embedding provider — retrieval uses PostgreSQL full-text search, which works on its own."}
          </StatusRow>
        </ul>
      </CardContent>
    </Card>
  );
}
