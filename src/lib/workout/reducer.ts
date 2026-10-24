import type { ActiveExercise, ActiveSet, ActiveWorkout, CompletionPayload, ExerciseRef, PreviousPerformance } from "./types";

export type WorkoutAction =
  | { type: "set.update"; exerciseKey: string; setKey: string; patch: Partial<Pick<ActiveSet, "weight" | "reps">> }
  | { type: "set.toggle"; exerciseKey: string; setKey: string; now: number }
  | { type: "set.add"; exerciseKey: string; key: string }
  | { type: "set.remove"; exerciseKey: string; setKey: string }
  | { type: "exercise.focus"; index: number }
  | { type: "exercise.notes"; exerciseKey: string; notes: string }
  | { type: "exercise.substitute"; exerciseKey: string; exercise: ExerciseRef; previous: PreviousPerformance | null }
  | { type: "exercise.add"; exercise: ActiveExercise }
  | { type: "exercise.remove"; exerciseKey: string }
  | { type: "workout.notes"; notes: string }
  | { type: "rest.start"; seconds: number; now: number }
  | { type: "rest.adjust"; deltaSeconds: number; now: number }
  | { type: "rest.toggle"; now: number }
  | { type: "rest.stop" };

const MAX_REST_MS = 15 * 60_000;

function mapExercise(w: ActiveWorkout, key: string, fn: (e: ActiveExercise) => ActiveExercise): ActiveWorkout {
  return { ...w, exercises: w.exercises.map((e) => (e.key === key ? fn(e) : e)) };
}

/**
 * The value a set falls back to when completed with an empty field.
 * Weight: what you just lifted this session, else the plan, else last time.
 * Reps: the plan, else this session, else last time.
 */
export function suggestedFor(exercise: ActiveExercise, setIndex: number): { weight: number | null; reps: number | null } {
  const set = exercise.sets[setIndex];
  const prev = exercise.previous?.sets[Math.min(setIndex, (exercise.previous?.sets.length ?? 1) - 1)];
  const earlier = exercise.sets.slice(0, setIndex).findLast((s) => s.completed);
  return {
    weight: earlier?.weight ?? set?.targetWeight ?? prev?.weight ?? null,
    reps: set?.targetReps ?? earlier?.reps ?? prev?.reps ?? null,
  };
}

export function restRemainingMs(rest: ActiveWorkout["rest"], now: number): number {
  if (rest.pausedRemaining != null) return rest.pausedRemaining;
  if (rest.endsAt == null) return 0;
  return Math.max(0, rest.endsAt - now);
}

export function workoutReducer(w: ActiveWorkout, a: WorkoutAction): ActiveWorkout {
  const next = reduce(w, a);
  return next === w ? w : { ...next, updatedAt: Date.now() };
}

function reduce(w: ActiveWorkout, a: WorkoutAction): ActiveWorkout {
  switch (a.type) {
    case "set.update":
      return mapExercise(w, a.exerciseKey, (e) => ({
        ...e,
        sets: e.sets.map((s) => (s.key === a.setKey ? { ...s, ...sanitize(a.patch) } : s)),
      }));

    case "set.toggle": {
      const exercise = w.exercises.find((e) => e.key === a.exerciseKey);
      if (!exercise) return w;
      const index = exercise.sets.findIndex((s) => s.key === a.setKey);
      const set = exercise.sets[index];
      if (!set) return w;

      if (set.completed) {
        return mapExercise(w, a.exerciseKey, (e) => ({
          ...e,
          sets: e.sets.map((s) => (s.key === a.setKey ? { ...s, completed: false, completedAt: null } : s)),
        }));
      }

      const fallback = suggestedFor(exercise, index);
      const weight = set.weight ?? (exercise.exercise.measure === "weight_reps" ? fallback.weight : set.weight);
      const reps = set.reps ?? fallback.reps;
      if (!reps || reps <= 0) return w; // nothing to record yet

      const updated = mapExercise(w, a.exerciseKey, (e) => ({
        ...e,
        sets: e.sets.map((s) =>
          s.key === a.setKey ? { ...s, weight, reps, completed: true, completedAt: new Date(a.now).toISOString() } : s,
        ),
      }));
      const target = updated.exercises.find((e) => e.key === a.exerciseKey)!;
      const allDone = target.sets.every((s) => s.completed);
      const exerciseIndex = updated.exercises.indexOf(target);
      const isLastExercise = exerciseIndex === updated.exercises.length - 1;

      return {
        ...updated,
        // Move on once every set of the focused exercise is logged.
        currentIndex: allDone && !isLastExercise && w.currentIndex === exerciseIndex ? exerciseIndex + 1 : w.currentIndex,
        rest: allDone && isLastExercise ? { duration: 0, endsAt: null, pausedRemaining: null } : startRest(exercise.restSeconds, a.now),
      };
    }

    case "set.add":
      return mapExercise(w, a.exerciseKey, (e) => {
        const last = e.sets.at(-1);
        return {
          ...e,
          sets: [
            ...e.sets,
            {
              key: a.key,
              weight: null,
              reps: null,
              targetWeight: last?.targetWeight ?? null,
              targetReps: last?.targetReps ?? null,
              completed: false,
              completedAt: null,
            },
          ],
        };
      });

    case "set.remove":
      return mapExercise(w, a.exerciseKey, (e) => ({ ...e, sets: e.sets.filter((s) => s.key !== a.setKey) }));

    case "exercise.focus":
      if (a.index < 0 || a.index >= w.exercises.length) return w;
      return { ...w, currentIndex: a.index };

    case "exercise.notes":
      return mapExercise(w, a.exerciseKey, (e) => ({ ...e, notes: a.notes.slice(0, 1000) }));

    case "exercise.substitute":
      return mapExercise(w, a.exerciseKey, (e) => {
        if (e.exercise.id === a.exercise.id) return e;
        const original = e.substitutedFor ?? e.exercise;
        return {
          ...e,
          exercise: a.exercise,
          substitutedFor: original.id === a.exercise.id ? null : original,
          previous: a.previous,
          // Logged numbers belong to the old movement; keep the prescription, clear the actuals.
          sets: e.sets.map((s) => ({ ...s, weight: null, reps: null, targetWeight: null, completed: false, completedAt: null })),
        };
      });

    case "exercise.add":
      return { ...w, exercises: [...w.exercises, a.exercise], currentIndex: w.exercises.length };

    case "exercise.remove": {
      const index = w.exercises.findIndex((e) => e.key === a.exerciseKey);
      if (index === -1) return w;
      const exercises = w.exercises.filter((e) => e.key !== a.exerciseKey);
      return { ...w, exercises, currentIndex: Math.max(0, Math.min(w.currentIndex, exercises.length - 1)) };
    }

    case "workout.notes":
      return { ...w, notes: a.notes.slice(0, 2000) };

    case "rest.start":
      return { ...w, rest: startRest(a.seconds, a.now) };

    case "rest.adjust": {
      const remaining = restRemainingMs(w.rest, a.now);
      if (remaining <= 0 && w.rest.pausedRemaining == null) {
        return a.deltaSeconds > 0 ? { ...w, rest: startRest(a.deltaSeconds, a.now) } : w;
      }
      const nextRemaining = Math.min(MAX_REST_MS, Math.max(0, remaining + a.deltaSeconds * 1000));
      const duration = Math.max(w.rest.duration + a.deltaSeconds, Math.ceil(nextRemaining / 1000));
      if (w.rest.pausedRemaining != null) return { ...w, rest: { ...w.rest, duration, pausedRemaining: nextRemaining } };
      return { ...w, rest: { duration, endsAt: a.now + nextRemaining, pausedRemaining: null } };
    }

    case "rest.toggle": {
      if (w.rest.pausedRemaining != null) {
        return { ...w, rest: { ...w.rest, endsAt: a.now + w.rest.pausedRemaining, pausedRemaining: null } };
      }
      const remaining = restRemainingMs(w.rest, a.now);
      if (remaining <= 0) return w;
      return { ...w, rest: { ...w.rest, endsAt: null, pausedRemaining: remaining } };
    }

    case "rest.stop":
      return { ...w, rest: { duration: 0, endsAt: null, pausedRemaining: null } };
  }
}

function startRest(seconds: number, now: number): ActiveWorkout["rest"] {
  if (seconds <= 0) return { duration: 0, endsAt: null, pausedRemaining: null };
  return { duration: seconds, endsAt: now + seconds * 1000, pausedRemaining: null };
}

function sanitize(patch: Partial<Pick<ActiveSet, "weight" | "reps">>) {
  const out: Partial<Pick<ActiveSet, "weight" | "reps">> = {};
  if ("weight" in patch) {
    const v = patch.weight;
    out.weight = v == null || !Number.isFinite(v) || v < 0 ? null : Math.min(9999, Math.round(v * 100) / 100);
  }
  if ("reps" in patch) {
    const v = patch.reps;
    out.reps = v == null || !Number.isFinite(v) || v < 0 ? null : Math.min(200, Math.round(v));
  }
  return out;
}

export function workoutStats(w: ActiveWorkout) {
  let done = 0;
  let total = 0;
  let volume = 0;
  for (const e of w.exercises) {
    for (const s of e.sets) {
      total++;
      if (s.completed) {
        done++;
        volume += (s.weight ?? 0) * (s.reps ?? 0);
      }
    }
  }
  return { done, total, volume };
}

export function toCompletionPayload(w: ActiveWorkout, endedAt: Date): CompletionPayload {
  return {
    id: w.id,
    template_id: w.templateId,
    template_name: w.templateName,
    started_at: w.startedAt,
    ended_at: endedAt.toISOString(),
    notes: w.notes.trim() || null,
    exercises: w.exercises
      .filter((e) => e.sets.length > 0)
      .map((e) => ({
        exercise_id: e.exercise.id,
        exercise_name: e.exercise.name,
        substituted_for: e.substitutedFor?.id ?? null,
        notes: e.notes.trim() || null,
        sets: e.sets.map((s) => ({
          weight: s.weight,
          reps: s.reps,
          target_weight: s.targetWeight,
          target_reps: s.targetReps,
          completed: s.completed,
          completed_at: s.completedAt,
        })),
      })),
  };
}
