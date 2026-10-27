import type { Metadata } from "next";
import { requestPasswordReset } from "../actions";
import { ForgotPasswordForm } from "../password-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm action={requestPasswordReset} />;
}
