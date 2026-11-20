"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyCommand({ command, label = "Copy command" }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch overflow-hidden rounded-xl border border-border bg-background-raised">
      <code className="scrollbar-thin flex-1 overflow-x-auto whitespace-nowrap px-3 py-2 font-mono text-[12px] text-foreground">{command}</code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
        aria-label={label}
        className="flex shrink-0 items-center border-l border-border px-3 text-muted hover:bg-surface-strong hover:text-foreground"
      >
        {copied ? <Check aria-hidden className="size-4 text-success" /> : <Copy aria-hidden className="size-4" />}
        <span aria-live="polite" className="sr-only">{copied ? "Copied" : ""}</span>
      </button>
    </div>
  );
}
