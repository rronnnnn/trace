"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { libraryCache } from "./storage";
import type { ActiveExercise, ActiveWorkout, ExerciseRef, Measure, PreviousPerformance } from "./types";

type ExerciseRow = {
  id: string;
  name: string;
  primary_muscle: string;
  equipment: string;
  measure: string;
  variation_of: string | null;
};

export const toExerciseRef = (r: ExerciseRow): ExerciseRef => ({
  id: r.id,
  name: r.name,
  primaryMuscle: r.primary_muscle,
  equipment: r.equipment,
  measure: r.measure as Measure,
  variationOf: r.variation_of,
});

const uuid = () => crypto.randomUUID();

/** The most recent completed performance of each exercise, keyed by exercise id. */
export async function fetchPreviousPerformance(
  exerciseIds: string[],
  supabase: SupabaseClient<Database> = supabaseBrowser(),
): Promise<Map<string, PreviousPerformance>> {
  const result = new Map<string, PreviousPerformance>();
  if (exerciseIds.length === 0) return result;

  const { data: latest, error } = await supabase
    .from("latest_exercise_performance")
    .select("exercise_id, session_exercise_id, session_id, ended_at")
    .in("exercise_id", exerciseIds);
  if (error) throw error;
  if (!latest.length) return result;

  const { data: sets, error: setsError } = await supabase
    .from("session_sets")
    .select("session_exercise_id, position, weight, reps")
    .in(
      "session_exercise_id",
      latest.map((l) => l.session_exercise_id),
    )
    .eq("completed", true)
    .order("position");
  if (setsError) throw setsError;

  for (const l of latest) {
    result.set(l.exercise_id, {
      sessionId: l.session_id,
      date: l.ended_at,
      sets: sets.filter((s) => s.session_exercise_id === l.session_exercise_id).map((s) => ({ weight: s.weight, reps: s.reps })),
    });
  }
  return result;
}

/** Builds a fresh active workout from one of the user's templates. */
export async function buildWorkoutFromTemplate(
  ownerId: string,
  templateId: string,
  supabase: SupabaseClient<Database> = supabaseBrowser(),
): Promise<ActiveWorkout> {
  const { data: t, error } = await supabase
    .from("workout_templates")
    .select(
      "id, name, est_minutes, template_exercises(id, position, rest_seconds, notes, exercise:exercises(id, name, primary_muscle, equipment, measure, variation_of), template_sets(position, target_reps, target_weight))",
    )
    .eq("id", templateId)
    .single();
  if (error) throw error;

  const items = [...t.template_exercises].sort((a, b) => a.position - b.position);
  const previous = await fetchPreviousPerformance(
    items.map((i) => i.exercise.id),
    supabase,
  );

  const exercises: ActiveExercise[] = items.map((item) => ({
    key: uuid(),
    exercise: toExerciseRef(item.exercise),
    substitutedFor: null,
    restSeconds: item.rest_seconds,
    notes: item.notes ?? "",
    previous: previous.get(item.exercise.id) ?? null,
    sets: [...item.template_sets]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        key: uuid(),
        weight: null,
        reps: null,
        targetWeight: s.target_weight,
        targetReps: s.target_reps,
        completed: false,
        completedAt: null,
      })),
  }));

  return {
    version: 1,
    id: uuid(),
    ownerId,
    templateId: t.id,
    templateName: t.name,
    estMinutes: t.est_minutes,
    startedAt: new Date().toISOString(),
    currentIndex: 0,
    notes: "",
    exercises,
    rest: { duration: 0, endsAt: null, pausedRemaining: null },
    updatedAt: Date.now(),
  };
}

export function emptyWorkout(ownerId: string): ActiveWorkout {
  return {
    version: 1,
    id: uuid(),
    ownerId,
    templateId: null,
    templateName: "Freestyle session",
    estMinutes: null,
    startedAt: new Date().toISOString(),
    currentIndex: 0,
    notes: "",
    exercises: [],
    rest: { duration: 0, endsAt: null, pausedRemaining: null },
    updatedAt: Date.now(),
  };
}

export function newActiveExercise(exercise: ExerciseRef, previous: PreviousPerformance | null, sets = 3): ActiveExercise {
  return {
    key: uuid(),
    exercise,
    substitutedFor: null,
    restSeconds: exercise.measure === "weight_reps" ? 120 : 90,
    notes: "",
    previous,
    sets: Array.from({ length: sets }, () => ({
      key: uuid(),
      weight: null,
      reps: null,
      targetWeight: null,
      targetReps: null,
      completed: false,
      completedAt: null,
    })),
  };
}

/** Exercise library (shared + own). Cached on device so substitutions work offline. */
export async function loadLibrary(ownerId: string): Promise<ExerciseRef[]> {
  try {
    const { data, error } = await supabaseBrowser()
      .from("exercises")
      .select("id, name, primary_muscle, equipment, measure, variation_of")
      .is("archived_at", null)
      .order("name");
    if (error) throw error;
    const items = data.map(toExerciseRef);
    void libraryCache.save(ownerId, items);
    return items;
  } catch (e) {
    const cached = await libraryCache.load(ownerId);
    if (cached?.length) return cached;
    throw e;
  }
}
