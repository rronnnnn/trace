import type { Metadata } from "next";
import { signIn } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next } = await searchParams;
  return <AuthForm mode="sign-in" action={signIn} next={typeof next === "string" ? next : undefined} />;
}
