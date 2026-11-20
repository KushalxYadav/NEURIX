"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import type { AuthFormState } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function AuthForm({
  action,
  mode,
  next,
  initialError,
}: {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  mode: "login" | "signup";
  next?: string;
  initialError?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialError ? { error: initialError } : {});
  const isLogin = mode === "login";
  return (
    <form action={formAction} className="glass flex flex-col gap-4 rounded-[var(--radius-card)] p-6" noValidate>
      <div>
        <h1 className="text-xl font-semibold">{isLogin ? "Welcome back" : "Create your account"}</h1>
        <p className="mt-1 text-[13.5px] text-muted">
          {isLogin ? "Sign in to continue learning." : "Your study material and progress stay private to you."}
        </p>
      </div>
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          minLength={8}
          required
        />
      </div>
      <div aria-live="polite" className="min-h-5 text-[13px]">
        {state.error && <p className="text-danger">{state.error}</p>}
        {state.message && <p className="text-success">{state.message}</p>}
      </div>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {isLogin ? "Sign in" : "Create account"}
      </Button>
      <p className="text-center text-[13px] text-muted">
        {isLogin ? "New to SYNAPSE? " : "Already have an account? "}
        <Link className="text-primary hover:underline" href={isLogin ? "/signup" : "/login"}>
          {isLogin ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </form>
  );
}
