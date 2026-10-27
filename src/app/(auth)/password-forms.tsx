"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { AuthState } from "./actions";

type Action = (state: AuthState, form: FormData) => Promise<AuthState>;

export function ForgotPasswordForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});

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
      <h1 className="font-serif text-[34px] leading-[1.1] tracking-[-0.01em]">Reset your password.</h1>
      <p className="mt-2 text-ink-2">We&apos;ll email you a link to choose a new one.</p>

      <div className="mt-9">
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
          aria-invalid={Boolean(state.error) || undefined}
        />
      </div>

      <p role="alert" aria-live="polite" className="mt-4 min-h-5 text-sm text-clay">
        {state.error}
      </p>

      <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
        {pending ? "Sending link…" : "Send reset link"}
      </Button>

      <p className="mt-6 text-center text-sm text-ink-3">
        Remembered it?{" "}
        <Link href="/sign-in" className="text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ action, email }: { action: Action; email: string | null }) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="animate-fade-up" noValidate>
      <h1 className="font-serif text-[34px] leading-[1.1] tracking-[-0.01em]">Choose a new password.</h1>
      <p className="mt-2 text-ink-2">{email ? `For ${email}.` : "You'll stay signed in after saving."}</p>

      <div className="mt-9">
        {email ? <input type="hidden" name="email" autoComplete="username" value={email} /> : null}
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          autoFocus
          aria-invalid={Boolean(state.error) || undefined}
        />
        <p className="mt-1.5 text-xs text-ink-3">At least 8 characters.</p>
      </div>

      <p role="alert" aria-live="polite" className="mt-4 min-h-5 text-sm text-clay">
        {state.error}
      </p>

      <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
        {pending ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}
