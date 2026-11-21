import type { Metadata } from "next";

import { signUp } from "@/app/auth/actions";
import { getDataMode } from "@/lib/config/env";

import { AuthForm } from "../auth-form";
import { LocalModeNotice } from "../local-mode-notice";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  if (getDataMode() !== "supabase") return <LocalModeNotice />;
  return <AuthForm action={signUp} mode="signup" />;
}
