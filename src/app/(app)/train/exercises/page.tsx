import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowLeft } from "@/components/icons";
import { requireProfile } from "@/lib/supabase/server";
import { ExerciseList, type OwnExercise } from "./exercise-list";

export const metadata: Metadata = { title: "Exercises" };

export default async function ExercisesPage() {
  const { supabase, userId } = await requireProfile();
  const { data, error } = await supabase
    .from("exercises")
    .select("id, name, primary_muscle, equipment, category, measure")
    .eq("owner_id", userId)
    .is("archived_at", null)
    .order("name");
  if (error) throw error;

  const exercises: OwnExercise[] = data.map((e) => ({
    id: e.id,
    name: e.name,
    primaryMuscle: e.primary_muscle,
    equipment: e.equipment,
    category: e.category as OwnExercise["category"],
    measure: e.measure as OwnExercise["measure"],
  }));

  return (
    <main className="mx-auto w-full max-w-[760px] px-5 pb-20 pt-8 sm:px-8 md:pt-14">
      <Link href="/train" className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <IconArrowLeft /> Train
      </Link>
      <h1 className="mt-4 font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[44px]">Your exercises</h1>
      <p className="mt-3 max-w-xl text-ink-2">
        Anything missing from the library. Deleting one removes it from your routines; if you&apos;ve already logged it, your history keeps it.
      </p>
      <ExerciseList exercises={exercises} />
    </main>
  );
}
