import { NextResponse, type NextRequest } from "next/server";

import { getDataMode } from "@/lib/config/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/utils/redirect";

/** Email confirmation / magic-link landing: exchange the code for a session. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));
  if (getDataMode() !== "supabase" || !code) {
    return NextResponse.redirect(new URL("/login?error=confirmation", url.origin));
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=confirmation", url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
