import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { Wordmark } from "@/components/wordmark";
import { OnboardingFlow } from "./flow";

export const metadata: Metadata = { title: "Set up" };

export default async function OnboardingPage() {
  const { supabase, userId } = await requireUser();
  const { data: profile } = await supabase.from("profiles").select("onboarded_at, display_name").eq("id", userId).maybeSingle();
  if (profile?.onboarded_at) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-6 py-8 sm:px-8">
      <Wordmark />
      <OnboardingFlow defaultName={profile?.display_name ?? ""} />
    </main>
  );
}
