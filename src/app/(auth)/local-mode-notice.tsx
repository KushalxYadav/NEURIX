import Link from "next/link";

import { Button } from "@/components/ui/button";

export function LocalModeNotice() {
  return (
    <div className="glass rounded-[var(--radius-card)] p-6 text-center">
      <h1 className="text-lg font-semibold">Accounts are off in local mode</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
        Supabase is not configured, so SYNAPSE is showing your locally processed material without sign-in. Add the
        Supabase variables from <code className="font-mono">.env.example</code> to enable accounts and saved progress.
      </p>
      <Button asChild className="mt-5">
        <Link href="/dashboard">Open dashboard</Link>
      </Button>
    </div>
  );
}
