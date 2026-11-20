import { TriangleAlert } from "lucide-react";

import { SourceDataError } from "@/modules/sources/types";

/** Render a data-loading failure honestly instead of showing partial or fake content. */
export function DataErrorPanel({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const hint = error instanceof SourceDataError ? error.hint : undefined;
  return (
    <div role="alert" className="glass rounded-[var(--radius-card)] border-danger/30 p-5">
      <div className="flex items-start gap-3">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Source data could not be loaded</h2>
          <p className="mt-1 text-[13.5px] text-muted">{message}</p>
          {hint && <p className="mt-2 font-mono text-[12.5px] text-subtle">{hint}</p>}
        </div>
      </div>
    </div>
  );
}
