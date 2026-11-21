"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={TriangleAlert}
      title="Something went wrong"
      actions={
        <Button variant="secondary" onClick={reset}>
          <RotateCcw aria-hidden /> Try again
        </Button>
      }
    >
      SYNAPSE could not load this page. Nothing was changed.
      {error.digest && <div className="mt-2 font-mono text-[12px] text-subtle">Reference: {error.digest}</div>}
    </EmptyState>
  );
}
