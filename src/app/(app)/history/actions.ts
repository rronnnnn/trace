"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";

export type ActionResult = { error: string } | { ok: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SessionEdit = {
  id: string;
  notes: string;
  exercises: { id: string; notes: string }[];
  sets: { id: string | null; sessionExerciseId: string; weight: number | null; reps: number | null }[];
  deleteSets: string[];
  deleteExercises: string[];
};

/** Totals, records, the landscape and every chart read from sessions, so all of them may change. */
function revalidate(id: string) {
  revalidatePath(`/history/${id}`);
  revalidatePath("/history");
  revalidatePath("/");
  revalidatePath("/exercises", "layout");
  revalidatePath("/insights");
  revalidatePath("/landscape", "layout");
  revalidatePath("/reflections", "layout");
}

export async function saveSessionEdit(input: SessionEdit): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(input.id)) return { error: "Unknown session." };
  const ids = [
    ...input.exercises.map((e) => e.id),
    ...input.sets.flatMap((s) => (s.id ? [s.id, s.sessionExerciseId] : [s.sessionExerciseId])),
    ...input.deleteSets,
    ...input.deleteExercises,
  ];
  if (!ids.every((x) => UUID.test(x))) return { error: "Something in this session isn't available." };

  const sets = [];
  for (const s of input.sets) {
    const reps = s.reps == null || !Number.isFinite(s.reps) ? 0 : Math.round(s.reps);
    if (reps < 1) return { error: "Every set needs at least one rep. Remove the set instead." };
    if (reps > 200) return { error: "Up to 200 reps per set." };
    if (s.weight != null && (!Number.isFinite(s.weight) || s.weight < 0 || s.weight > 9999))
      return { error: "Weights go up to 9999." };
    sets.push({
      id: s.id,
      session_exercise_id: s.sessionExerciseId,
      weight: s.weight == null ? null : Math.round(s.weight * 100) / 100,
      reps,
    });
  }

  const { error } = await supabase.rpc("edit_session", {
    payload: {
      id: input.id,
      notes: input.notes.trim().slice(0, 2000),
      exercises: input.exercises.map((e) => ({ id: e.id, notes: e.notes.trim().slice(0, 1000) })),
      sets,
      delete_sets: input.deleteSets,
      delete_exercises: input.deleteExercises,
    },
  });
  if (error) return { error: error.message };
  revalidate(input.id);
  return { ok: true };
}

export async function deleteSession(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(id)) return { error: "Unknown session." };
  const { error } = await supabase.rpc("delete_session", { sid: id });
  if (error) return { error: error.message };
  revalidate(id);
  return { ok: true };
}
