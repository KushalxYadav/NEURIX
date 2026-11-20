import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/**
 * In Supabase mode every request refreshes the session and signed-out users
 * are redirected to /login. In local mode (no Supabase configured, not
 * production) the app is a read-only viewer of locally processed data.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const forcedLocal = process.env.SYNAPSE_DATA_SOURCE === "local";
  if (url && key && !forcedLocal) {
    return updateSession(request, url, key);
  }
  return NextResponse.next({ request });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
