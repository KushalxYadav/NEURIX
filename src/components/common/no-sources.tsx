import { FolderArchive } from "lucide-react";

import { EmptyState } from "./empty-state";

/** Shown when no subject has been ingested yet. Explains the real next step. */
export function NoSourcesState({ mode }: { mode: "local" | "supabase" }) {
  return (
    <EmptyState icon={FolderArchive} title="No study material processed yet">
      <p>
        SYNAPSE only teaches from your own course material. Place your subject archive in{" "}
        <code className="font-mono text-foreground">source-material/</code> and run the ingestion pipeline:
      </p>
      <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-background-raised p-3 text-left font-mono text-[12px] leading-relaxed text-foreground">
        {`python3 -m venv .venv
.venv/bin/pip install -r ingestion/requirements.txt
.venv/bin/python scripts/run_pipeline.py${
          mode === "supabase" ? "\n.venv/bin/python scripts/load_to_database.py --owner-email you@example.com" : ""
        }`}
      </pre>
      <p className="mt-3">
        {mode === "local"
          ? "This page refreshes from data/processed/ automatically once the pipeline finishes."
          : "Loading attaches the processed material to your account; it stays private to you."}
      </p>
    </EmptyState>
  );
}
