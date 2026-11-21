"use client";

import { Check, CircleDashed, Loader2, PlayCircle } from "lucide-react";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils/cn";
import { setSessionStatus } from "@/modules/learning/actions";

const OPTIONS = [
  { value: "not_started", label: "Not started", Icon: CircleDashed },
  { value: "in_progress", label: "In progress", Icon: PlayCircle },
  { value: "studied", label: "Studied", Icon: Check },
] as const;

export function SessionStatusControl({ sessionKey, status, disabledReason }: { sessionKey: string; status: string; disabledReason?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <div role="radiogroup" aria-label="Your status for this session" className="inline-flex rounded-xl border border-border-strong bg-surface p-1">
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = status === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={pending || Boolean(disabledReason)}
              title={disabledReason}
              onClick={() =>
                start(async () => {
                  const result = await setSessionStatus(sessionKey, value);
                  setError(result.ok ? null : (result.error ?? "Could not save."));
                })
              }
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-colors disabled:opacity-50",
                active ? "bg-primary-soft text-primary" : "text-muted hover:text-foreground",
              )}
            >
              {pending && active ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Icon aria-hidden className="size-3.5" />}
              {label}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
