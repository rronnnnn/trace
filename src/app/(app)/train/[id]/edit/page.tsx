import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/supabase/server";
import type { Measure } from "@/lib/workout/types";
import { RoutineEditor } from "../../routine-editor";

export const metadata: Metadata = { title: "Edit routine" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditRoutinePage({ params }: PageProps<"/train/[id]/edit">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, userId, profile } = await requireProfile();
  const { data: t, error } = await supabase
    .from("workout_templates")
    .select(
      "id, name, focus, est_minutes, template_exercises(id, position, rest_seconds, notes, exercise:exercises(id, name, primary_muscle, equipment, measure, variation_of), template_sets(id, position, target_reps, target_weight))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!t) notFound();

  return (
    <RoutineEditor
      uid={userId}
      unit={profile.unit}
      initial={{
        id: t.id,
        name: t.name,
        focus: t.focus ?? "",
        estMinutes: t.est_minutes,
        exercises: [...t.template_exercises]
          .sort((a, b) => a.position - b.position)
          .map((te) => ({
            key: te.id,
            exercise: {
              id: te.exercise.id,
              name: te.exercise.name,
              primaryMuscle: te.exercise.primary_muscle,
              equipment: te.exercise.equipment,
              measure: te.exercise.measure as Measure,
              variationOf: te.exercise.variation_of,
            },
            restSeconds: te.rest_seconds,
            notes: te.notes ?? "",
            sets: [...te.template_sets]
              .sort((a, b) => a.position - b.position)
              .map((s) => ({ key: s.id, reps: s.target_reps, weight: s.target_weight == null ? null : Number(s.target_weight) })),
          })),
      }}
    />
  );
}
