"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { AuthState } from "./actions";

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: "sign-in" | "sign-up";
  action: (state: AuthState, form: FormData) => Promise<AuthState>;
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const isSignUp = mode === "sign-up";

  if (state.notice) {
    return (
      <div className="animate-fade-up">
        <h1 className="font-serif text-[32px] leading-tight">Check your inbox</h1>
        <p className="mt-3 text-ink-2">{state.notice}</p>
        <Link href="/sign-in" className="mt-8 inline-block text-sm text-ink underline underline-offset-4">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="animate-fade-up" noValidate>
      <h1 className="font-serif text-[34px] leading-[1.1] tracking-[-0.01em]">{isSignUp ? "Start your record." : "Welcome back."}</h1>
      <p className="mt-2 text-ink-2">
        {isSignUp ? "Every session you log becomes part of your landscape." : "Pick up where you left off."}
      </p>

      <div className="mt-9 space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            defaultValue={state.email}
            required
            autoFocus
            aria-invalid={state.error?.toLowerCase().includes("email") || undefined}
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            minLength={isSignUp ? 8 : undefined}
            required
          />
          {isSignUp ? <p className="mt-1.5 text-xs text-ink-3">At least 8 characters.</p> : null}
        </div>
        {next ? <input type="hidden" name="next" value={next} /> : null}
      </div>

      <p role="alert" aria-live="polite" className="mt-4 min-h-5 text-sm text-clay">
        {state.error}
      </p>

      <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
        {pending ? (isSignUp ? "Creating account…" : "Signing in…") : isSignUp ? "Create account" : "Sign in"}
      </Button>

      <p className="mt-6 text-center text-sm text-ink-3">
        {isSignUp ? "Already recording? " : "New to TRACE? "}
        <Link href={isSignUp ? "/sign-in" : "/sign-up"} className="text-ink underline underline-offset-4">
          {isSignUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
