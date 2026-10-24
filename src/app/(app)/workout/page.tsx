import type { Metadata } from "next";
import { WorkoutScreen } from "@/components/workout/workout-screen";
import { requireProfile } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Workout" };

export default async function WorkoutPage() {
  const { userId, profile } = await requireProfile();
  return <WorkoutScreen uid={userId} unit={profile.unit} />;
}
