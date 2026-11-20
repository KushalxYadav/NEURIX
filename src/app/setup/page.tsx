import { Settings2 } from "lucide-react";
import type { Metadata } from "next";

import { Wordmark } from "@/components/shell/logo";

export const metadata: Metadata = { title: "Configuration required" };

const REQUIRED = [
  ["NEXT_PUBLIC_SUPABASE_URL", "Your Supabase project URL"],
  ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "Publishable (anon) key — safe for the browser"],
  ["ANTHROPIC_API_KEY", "Server-only; enables the AI teaching features"],
] as const;

/** Shown in production when neither Supabase nor explicit local mode is configured. */
export default function SetupPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-10">
      <Wordmark />
      <div className="glass mt-8 rounded-[var(--radius-card)] p-6">
        <div className="flex items-center gap-2 text-primary">
          <Settings2 aria-hidden className="size-5" />
          <h1 className="text-lg font-semibold text-foreground">Configuration required</h1>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          This deployment has no data source. Set these environment variables (see <code className="font-mono">.env.example</code>)
          and redeploy. For a private, single-user local install you can instead set{" "}
          <code className="font-mono text-foreground">SYNAPSE_DATA_SOURCE=local</code>.
        </p>
        <ul className="mt-4 flex flex-col gap-2">
          {REQUIRED.map(([name, description]) => (
            <li key={name} className="rounded-xl border border-border bg-background-raised px-3 py-2">
              <code className="font-mono text-[12.5px] text-foreground">{name}</code>
              <div className="text-[12px] text-subtle">{description}</div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
