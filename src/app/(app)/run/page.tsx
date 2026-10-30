import type { Metadata } from "next";
import { RunRecorder } from "@/components/run/run-recorder";
import { requireUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Run" };

export default async function RunPage() {
  const { userId } = await requireUser();
  return <RunRecorder uid={userId} />;
}
