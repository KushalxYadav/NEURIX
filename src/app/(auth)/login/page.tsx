import type { Metadata } from "next";
import { Suspense } from "react";

import { signIn } from "@/app/auth/actions";
import { Skeleton } from "@/components/ui/skeleton";
import { getDataMode } from "@/lib/config/env";
import { safeNextPath } from "@/lib/utils/redirect";

import { AuthForm } from "../auth-form";
import { LocalModeNotice } from "../local-mode-notice";

export const metadata: Metadata = { title: "Sign in" };

async function LoginForm({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeNextPath(params.next) : undefined;
  const error = params.error === "confirmation" ? "That confirmation link is invalid or has expired." : undefined;
  return <AuthForm action={signIn} mode="login" next={next} initialError={error} />;
}

export default function LoginPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (getDataMode() !== "supabase") return <LocalModeNotice />;
  return (
    <Suspense fallback={<Skeleton className="h-[380px] w-full rounded-[var(--radius-card)]" />}>
      <LoginForm searchParams={props.searchParams} />
    </Suspense>
  );
}
