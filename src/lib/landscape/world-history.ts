import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { WorldSession } from "./world";

/**
 * Each session's original routine id (routine_key), which survives the routine being deleted;
 * template_id does not. Keyed by session id. Empty when the column isn't there yet (migration
 * 20261031000000 not applied), in which case callers fall back to template_id as before.
 */
export async function loadRoutineKeys(supabase: SupabaseClient<Database>): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("workout_sessions").select("id, routine_key").not("routine_key", "is", null).limit(5000);
  if (error) return new Map();
  return new Map(data.map((s) => [s.id, s.routine_key!]));
}

/** The world key of a session's routine: stable for the life of the history. */
export const routineKeyOf = (s: { id: string; template_id: string | null; template_name: string | null }, keys: Map<string, string>) =>
  keys.get(s.id) ?? s.template_id ?? `name:${s.template_name ?? "Session"}`;

/** The whole training history in the light form the world is built from. RLS-scoped. */
export async function loadWorldHistory(supabase: SupabaseClient<Database>): Promise<WorldSession[]> {
  const [{ data, error }, keys] = await Promise.all([
    supabase
      .from("workout_sessions")
      .select(
        "id, template_id, template_name, ended_at, total_volume, completed_sets, is_sample, personal_records(exercise_id, kind, weight, reps, is_baseline), session_exercises(exercise_id, exercise_name, session_sets(weight, reps, completed))",
      )
      .order("ended_at")
      .limit(5000),
    loadRoutineKeys(supabase),
  ]);
  if (error) throw error;
  return data.map((s) => {
    const names = new Map(s.session_exercises.map((e) => [e.exercise_id, e.exercise_name]));
    const measured = s.personal_records.filter((r) => !r.is_baseline && r.kind !== "estimated_1rm");
    return {
      id: s.id,
      endedAt: s.ended_at,
      templateKey: routineKeyOf(s, keys),
      label: s.template_name ?? "Session",
      volume: Number(s.total_volume),
      sets: s.completed_sets,
      records: measured.length,
      isSample: s.is_sample,
      prs: measured.map((r) => ({
        exerciseId: r.exercise_id,
        name: names.get(r.exercise_id) ?? "Exercise",
        kind: r.kind as "heaviest_weight" | "most_reps",
        weight: r.weight == null ? null : Number(r.weight),
        reps: r.reps,
      })),
      lifts: s.session_exercises.flatMap((e) => {
        let best: { weight: number; reps: number | null } | null = null;
        for (const x of e.session_sets) {
          const w = Number(x.weight ?? 0);
          if (x.completed && w > (best?.weight ?? 0)) best = { weight: w, reps: x.reps };
        }
        return best ? [{ exerciseId: e.exercise_id, name: e.exercise_name, ...best }] : [];
      }),
    };
  });
}
