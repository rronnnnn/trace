"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import type { ExerciseRef, Measure } from "@/lib/workout/types";

export type ActionResult<T = true> = { error: string } | { ok: T };

const UUID = /^[0-9a-f-]{36}$/i;

export type RoutineInput = {
  id: string | null;
  name: string;
  focus: string;
  estMinutes: number | null;
  exercises: {
    exerciseId: string;
    restSeconds: number;
    notes: string;
    sets: { targetReps: number | null; targetWeight: number | null }[];
  }[];
};

const clampInt = (v: number | null, min: number, max: number) =>
  v == null || !Number.isFinite(v) ? null : Math.min(max, Math.max(min, Math.round(v)));

function revalidateRoutines() {
  revalidatePath("/train");
  revalidatePath("/");
}

export async function saveRoutine(input: RoutineInput): Promise<ActionResult<string>> {
  const { supabase } = await requireUser();
  const name = input.name.trim();
  if (!name) return { error: "Give the routine a name." };
  if (name.length > 80) return { error: "Keep the name under 80 characters." };
  if (input.id && !UUID.test(input.id)) return { error: "Unknown routine." };
  if (input.exercises.length === 0) return { error: "Add at least one exercise." };
  if (input.exercises.length > 40) return { error: "A routine can hold up to 40 exercises." };

  const exercises = [];
  for (const e of input.exercises) {
    if (!UUID.test(e.exerciseId)) return { error: "One of the exercises isn't available." };
    if (e.sets.length === 0) return { error: "Every exercise needs at least one set." };
    if (e.sets.length > 20) return { error: "Up to 20 sets per exercise." };
    exercises.push({
      exercise_id: e.exerciseId,
      rest_seconds: clampInt(e.restSeconds, 0, 900) ?? 120,
      notes: e.notes.trim().slice(0, 500),
      sets: e.sets.map((s) => ({
        target_reps: clampInt(s.targetReps, 1, 100),
        target_weight:
          s.targetWeight == null || !Number.isFinite(s.targetWeight) || s.targetWeight <= 0
            ? null
            : Math.min(9999, Math.round(s.targetWeight * 100) / 100),
      })),
    });
  }

  const { data, error } = await supabase.rpc("save_template", {
    payload: {
      id: input.id,
      name,
      focus: input.focus.trim().slice(0, 80),
      est_minutes: clampInt(input.estMinutes, 5, 300),
      exercises,
    },
  });
  if (error) return { error: error.message };
  revalidateRoutines();
  return { ok: data };
}

export async function deleteRoutine(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(id)) return { error: "Unknown routine." };
  // Past sessions keep their snapshot; template_id is set null on delete.
  const { error } = await supabase.from("workout_templates").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateRoutines();
  return { ok: true };
}

export type ExerciseInput = {
  name: string;
  primaryMuscle: string;
  equipment: string;
  category: "compound" | "isolation";
  measure: Measure;
};

function validateExercise(input: ExerciseInput): string | null {
  const name = input.name.trim();
  if (!name) return "Give the exercise a name.";
  if (name.length > 80) return "Keep the name under 80 characters.";
  if (!input.primaryMuscle.trim()) return "Choose a muscle group.";
  if (!input.equipment.trim()) return "Choose the equipment.";
  if (!["compound", "isolation"].includes(input.category)) return "Choose a category.";
  if (!["weight_reps", "bodyweight_reps"].includes(input.measure)) return "Choose how it's measured.";
  return null;
}

const slugify = (name: string) =>
  `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "exercise"}-${crypto.randomUUID().slice(0, 8)}`;

export async function createExercise(input: ExerciseInput): Promise<ActionResult<ExerciseRef>> {
  const { supabase, userId } = await requireUser();
  const invalid = validateExercise(input);
  if (invalid) return { error: invalid };
  const { data, error } = await supabase
    .from("exercises")
    .insert({
      owner_id: userId,
      slug: slugify(input.name),
      name: input.name.trim(),
      primary_muscle: input.primaryMuscle.trim(),
      equipment: input.equipment.trim(),
      category: input.category,
      measure: input.measure,
    })
    .select("id, name, primary_muscle, equipment, measure, variation_of")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/train/exercises");
  return {
    ok: {
      id: data.id,
      name: data.name,
      primaryMuscle: data.primary_muscle,
      equipment: data.equipment,
      measure: data.measure as Measure,
      variationOf: data.variation_of,
    },
  };
}

export async function updateExercise(id: string, input: ExerciseInput): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(id)) return { error: "Unknown exercise." };
  const invalid = validateExercise(input);
  if (invalid) return { error: invalid };
  // RLS limits updates to the user's own exercises; library rows are read-only.
  const { data, error } = await supabase
    .from("exercises")
    .update({
      name: input.name.trim(),
      primary_muscle: input.primaryMuscle.trim(),
      equipment: input.equipment.trim(),
      category: input.category,
      measure: input.measure,
    })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data.length) return { error: "Only your own exercises can be edited." };
  revalidatePath("/train/exercises");
  revalidateRoutines();
  return { ok: true };
}

export async function deleteExercise(id: string): Promise<ActionResult<"deleted" | "archived">> {
  const { supabase } = await requireUser();
  if (!UUID.test(id)) return { error: "Unknown exercise." };
  const { data, error } = await supabase.rpc("delete_exercise", { eid: id });
  if (error) return { error: error.message };
  revalidatePath("/train/exercises");
  revalidateRoutines();
  return { ok: data as "deleted" | "archived" };
}
