import "server-only";

import type { ReflectionSession } from "@/lib/reflection";
import type { requireProfile } from "@/lib/supabase/server";
import type { Measure } from "@/lib/workout/types";

type Client = Awaited<ReturnType<typeof requireProfile>>["supabase"];

/** Sessions with what the reflection needs, optionally between two instants. */
export async function loadReflectionSessions(supabase: Client, range: { from?: string; to?: string } = {}): Promise<ReflectionSession[]> {
  let q = supabase
    .from("workout_sessions")
    .select(
      "id, started_at, ended_at, template_name, total_volume, completed_sets, is_sample, notes, session_exercises(exercise_id, exercise_name, position, exercise:exercises!session_exercises_exercise_id_fkey(primary_muscle, measure), session_sets(weight, reps, completed)), personal_records(kind, is_baseline, weight, reps, exercise:exercises(name))",
    )
    .order("ended_at", { ascending: false })
    .limit(400);
  if (range.from) q = q.gte("ended_at", range.from);
  if (range.to) q = q.lt("ended_at", range.to);
  const { data, error } = await q;
  if (error) throw error;

  return data.map((s) => ({
    id: s.id,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    routine: s.template_name,
    volume: Number(s.total_volume),
    sets: s.completed_sets,
    isSample: s.is_sample,
    notes: s.notes,
    exercises: [...s.session_exercises]
      .sort((a, b) => a.position - b.position)
      .map((e) => ({
        exerciseId: e.exercise_id,
        name: e.exercise_name,
        muscle: e.exercise?.primary_muscle ?? null,
        measure: (e.exercise?.measure ?? "weight_reps") as Measure,
        sets: e.session_sets.filter((x) => x.completed).map((x) => ({ weight: x.weight == null ? null : Number(x.weight), reps: x.reps })),
      })),
    records: s.personal_records
      .filter((r) => !r.is_baseline && r.kind !== "estimated_1rm")
      .map((r) => ({
        exerciseName: r.exercise?.name ?? "Exercise",
        kind: r.kind as "heaviest_weight" | "most_reps",
        weight: r.weight == null ? null : Number(r.weight),
        reps: r.reps,
      })),
  }));
}

export type StoredReflection = { week: string; energy: number | null; note: string | null; nextFocus: string | null; updatedAt: string };

/**
 * Written reflections, keyed by week. `available` is false when the weekly_reflections migration
 * hasn't been applied yet, so the facts still render and only writing is switched off.
 */
export async function loadWrittenReflections(supabase: Client, weeks?: string[]) {
  let q = supabase.from("weekly_reflections").select("week_start, energy, note, next_focus, updated_at");
  if (weeks) q = q.in("week_start", weeks);
  const { data, error } = await q;
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") return { available: false, byWeek: new Map<string, StoredReflection>() };
    throw error;
  }
  return {
    available: true,
    byWeek: new Map(
      data.map((r) => [r.week_start, { week: r.week_start, energy: r.energy, note: r.note, nextFocus: r.next_focus, updatedAt: r.updated_at }]),
    ),
  };
}
