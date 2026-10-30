import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InsightSession } from "@/lib/insights";
import type { Database } from "@/lib/supabase/database.types";
import type { Measure } from "@/lib/workout/types";

/** The whole strength history with completed sets and records, scoped by RLS to the viewer. */
export async function loadInsightSessions(supabase: SupabaseClient<Database>): Promise<InsightSession[]> {
  const { data, error } = await supabase
    .from("workout_sessions")
    .select(
      "id, template_name, ended_at, is_sample, session_exercises(exercise_id, exercise_name, session_sets(weight, reps, completed)), personal_records(exercise_id, kind, weight, reps, value, is_baseline)",
    )
    .order("ended_at")
    .limit(3000);
  if (error) throw error;

  const ids = [...new Set(data.flatMap((s) => s.session_exercises.map((e) => e.exercise_id)))];
  const { data: library, error: libraryError } = ids.length
    ? await supabase.from("exercises").select("id, primary_muscle, measure").in("id", ids)
    : { data: [] as { id: string; primary_muscle: string; measure: string }[], error: null };
  if (libraryError) throw libraryError;
  const meta = new Map((library ?? []).map((e) => [e.id, e]));

  return data.map((s) => {
    const names = new Map(s.session_exercises.map((e) => [e.exercise_id, e.exercise_name]));
    return {
      id: s.id,
      endedAt: s.ended_at,
      routine: s.template_name ?? "Session",
      isSample: s.is_sample,
      exercises: s.session_exercises.map((e) => ({
        exerciseId: e.exercise_id,
        name: e.exercise_name,
        muscle: meta.get(e.exercise_id)?.primary_muscle ?? "Other",
        measure: (meta.get(e.exercise_id)?.measure ?? "weight_reps") as Measure,
        sets: e.session_sets.filter((x) => x.completed).map((x) => ({ weight: x.weight == null ? null : Number(x.weight), reps: x.reps })),
      })),
      records: s.personal_records.map((r) => ({
        exerciseId: r.exercise_id,
        name: names.get(r.exercise_id) ?? "Exercise",
        kind: r.kind as InsightSession["records"][number]["kind"],
        weight: r.weight == null ? null : Number(r.weight),
        reps: r.reps,
        value: Number(r.value),
        isBaseline: r.is_baseline,
      })),
    };
  });
}
