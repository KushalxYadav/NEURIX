"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDataMode, getEnv } from "@/lib/config/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/utils/redirect";

export interface AuthFormState {
  error?: string;
  message?: string;
}

const Credentials = z.object({
  email: z.email("Enter a valid email address.").max(320),
  password: z.string().min(8, "Use at least 8 characters.").max(128),
});

function readCredentials(formData: FormData) {
  return Credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
}

function requireSupabase(): AuthFormState | null {
  return getDataMode() === "supabase"
    ? null
    : { error: "Accounts are disabled in local mode. Configure Supabase to enable sign-in." };
}

async function siteOrigin(): Promise<string> {
  const configured = getEnv().NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export async function signIn(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const blocked = requireSupabase();
  if (blocked) return blocked;
  const parsed = readCredentials(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Email or password is incorrect, or the email is not confirmed yet." };
  redirect(safeNextPath(formData.get("next")));
}

export async function signUp(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const blocked = requireSupabase();
  if (blocked) return blocked;
  const parsed = readCredentials(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback` },
  });
  if (error) return { error: error.message };
  if (data.session) redirect("/dashboard");
  return { message: "Check your inbox to confirm your email, then sign in." };
}

export async function signOut(): Promise<void> {
  if (getDataMode() === "supabase") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
