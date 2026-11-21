import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { getDataMode } from "@/lib/config/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Viewer =
  | { kind: "local" }
  | { kind: "user"; id: string; email: string | null };

/**
 * Data Access Layer entry point: who is viewing?
 * - local mode: a single local viewer (no authentication, read-only data)
 * - Supabase mode: the verified user from the JWT, or a redirect to /login
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  const mode = getDataMode();
  if (mode === "local") return { kind: "local" };
  if (mode === "unconfigured") redirect("/setup");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) redirect("/login");
  return { kind: "user", id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
});

export async function requireUser(): Promise<Extract<Viewer, { kind: "user" }>> {
  const viewer = await getViewer();
  if (viewer.kind !== "user") {
    throw new Error("This action requires a signed-in Supabase user.");
  }
  return viewer;
}
