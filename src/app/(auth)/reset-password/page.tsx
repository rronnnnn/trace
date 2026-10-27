import type { Metadata } from "next";
import { requireUser } from "@/lib/supabase/server";
import { updatePassword } from "../actions";
import { ResetPasswordForm } from "../password-forms";

export const metadata: Metadata = { title: "New password" };

/** Reached from the reset email via /auth/callback, which signs the user in first. */
export default async function ResetPasswordPage() {
  const { email } = await requireUser();
  return <ResetPasswordForm action={updatePassword} email={email} />;
}
