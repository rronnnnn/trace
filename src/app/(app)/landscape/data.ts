import "server-only";

import { buildWindow, parseRange, type ExploreSession, type RecordKind } from "@/lib/landscape/explore";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { loadRoutineKeys, loadWorldHistory } from "@/lib/landscape/world-history";

const ID = /^[0-9a-f-]{36}$|^name:.{1,80}$/i;
export const param = (v: string | string[] | undefined) => (typeof v === "string" && ID.test(v) ? v : null);

/** Persisted history for the Landscape screens (map and explore), scoped by RLS to the viewer. */
export async function loadLandscape(sp: Record<string, string | string[] | undefined>) {
  const [{ supabase, userId, profile }, tz] = await Promise.all([requireProfile(), getTimeZone()]);
  const range = parseRange(sp.range);
  const now = new Date();
  const [{ data: first }, { count: totalSessionsEver }] = await Promise.all([
    supabase.from("workout_sessions").select("ended_at").order("ended_at").limit(1).maybeSingle(),
    supabase.from("workout_sessions").select("id", { count: "exact", head: true }),
  ]);
  const win = buildWindow(range, now, tz, first?.ended_at);

  const [{ data, error }, routineKeys] = await Promise.all([
    supabase
      .from("workout_sessions")
      .select(
        "id, template_id, template_name, started_at, ended_at, total_volume, completed_sets, is_sample, session_exercises(id, exercise_id, exercise_name, position, session_sets(id, position, weight, reps, completed)), personal_records(exercise_id, session_set_id, kind, value, weight, reps, is_baseline)",
      )
      .gte("ended_at", win.start)
      .order("ended_at")
      .limit(1000),
    loadRoutineKeys(supabase),
  ]);
  if (error) throw error;

  const sessions: ExploreSession[] = data.map((s) => ({
    id: s.id,
    // the routine it was logged with, even after that routine is deleted: its range stays put
    templateId: routineKeys.get(s.id) ?? s.template_id,
    templateName: s.template_name ?? "Session",
    startedAt: s.started_at,
    endedAt: s.ended_at,
    totalVolume: Number(s.total_volume),
    completedSets: s.completed_sets,
    isSample: s.is_sample,
    exercises: s.session_exercises.map((e) => ({
      id: e.id,
      exerciseId: e.exercise_id,
      name: e.exercise_name,
      position: e.position,
      sets: e.session_sets.map((x) => ({
        id: x.id,
        position: x.position,
        weight: x.weight == null ? null : Number(x.weight),
        reps: x.reps,
        completed: x.completed,
      })),
    })),
    records: s.personal_records.map((r) => ({
      exerciseId: r.exercise_id,
      setId: r.session_set_id,
      kind: r.kind as RecordKind,
      value: Number(r.value),
      weight: r.weight == null ? null : Number(r.weight),
      reps: r.reps,
      isBaseline: r.is_baseline,
    })),
  }));

  // Muscle groups for the exercise filter.
  const exerciseIds = [...new Set(sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId)))];
  const { data: library } = exerciseIds.length
    ? await supabase.from("exercises").select("id, primary_muscle").in("id", exerciseIds)
    : { data: [] as { id: string; primary_muscle: string }[] };
  const muscles = Object.fromEntries((library ?? []).map((e) => [e.id, e.primary_muscle]));

  // the world itself is built from all of history; the period only chooses what is shown
  const history = await loadWorldHistory(supabase);

  return { sessions, history, range, win, tz, userId, profile, muscles, totalSessionsEver: totalSessionsEver ?? 0 };
}
