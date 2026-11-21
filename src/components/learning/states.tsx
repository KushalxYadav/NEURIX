import { Workflow } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { NoSourcesState } from "@/components/common/no-sources";
import { PageHeader } from "@/components/common/page-header";
import type { LearningLoad } from "@/modules/learning/overview";

/** Honest empty states shared by every learning page. */
export function LearningUnavailable({ load, title }: { load: Exclude<LearningLoad, { kind: "ready" }>; title: string }) {
  if (load.kind === "no_subject") {
    return (
      <>
        <PageHeader eyebrow={title} title="Let’s set up your subject" />
        <NoSourcesState mode={load.mode} />
      </>
    );
  }
  return (
    <>
      <PageHeader eyebrow={title} title={title} />
      <EmptyState
        icon={Workflow}
        title={load.reason === "not_in_this_mode" ? "Curriculum not available in Supabase mode yet" : load.reason === "no_sessions" ? "No teaching sessions identified" : "No curriculum yet"}
      >
        {load.reason === "no_sessions" ? (
          <>
            SYNAPSE found no session or class numbers and no dates in your slides and readings, so it will not invent a session sequence. The Weekly Overview and Source Library
            still show everything that was extracted; see <code className="font-mono text-foreground">data/reports/curriculum_report.md</code>.
          </>
        ) : load.reason === "not_in_this_mode" ? (
          <>The curriculum map is generated locally by the ingestion pipeline and is not loaded into the database yet. Run SYNAPSE in local mode to use this page.</>
        ) : (
          <>
            Run <code className="font-mono text-foreground">.venv/bin/python scripts/run_pipeline.py</code> to build the session map from your archive.
          </>
        )}
      </EmptyState>
    </>
  );
}
