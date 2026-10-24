"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";

export type GoalInput = { exerciseId: string; targetWeight: number | null; targetReps: number; note: string };
export type GoalResult = { error: string } | { ok: true };

const UUID = /^[0-9a-f-]{36}$/i;

export async function createGoal(input: GoalInput): Promise<GoalResult> {
  const { supabase, userId } = await requireUser();
  if (!UUID.test(input.exerciseId)) return { error: "Choose an exercise." };
  const reps = Math.round(Number(input.targetReps));
  if (!Number.isFinite(reps) || reps < 1 || reps > 200) return { error: "Reps must be between 1 and 200." };

  const { data: ex, error: exError } = await supabase
    .from("exercises")
    .select("id, name, measure")
    .eq("id", input.exerciseId)
    .maybeSingle();
  if (exError) return { error: exError.message };
  if (!ex) return { error: "That exercise isn't available." };

  let weight: number | null = null;
  if (ex.measure === "weight_reps") {
    weight = Number(input.targetWeight);
    if (!Number.isFinite(weight) || weight <= 0 || weight >= 10000) return { error: "Enter a target weight." };
    weight = Math.round(weight * 100) / 100;
  } else if (reps < 2) {
    return { error: "Set a rep target of at least 2." };
  }

  const { error } = await supabase.from("goals").insert({
    owner_id: userId,
    exercise_id: ex.id,
    exercise_name: ex.name,
    target_weight: weight,
    target_reps: reps,
    note: input.note.trim().slice(0, 200) || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/goals");
  return { ok: true };
}

export async function archiveGoal(id: string, archived: boolean): Promise<GoalResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(id)) return { error: "Unknown goal." };
  const { error } = await supabase
    .from("goals")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/goals");
  return { ok: true };
}

export async function deleteGoal(id: string): Promise<GoalResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(id)) return { error: "Unknown goal." };
  const { error } = await supabase.from("goals").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/goals");
  return { ok: true };
}
