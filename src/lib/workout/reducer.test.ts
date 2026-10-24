import { describe, expect, it } from "vitest";
import { restRemainingMs, toCompletionPayload, workoutReducer, workoutStats } from "./reducer";
import type { ActiveExercise, ActiveWorkout, ExerciseRef } from "./types";

const bench: ExerciseRef = {
  id: "bench",
  name: "Bench Press",
  primaryMuscle: "Chest",
  equipment: "barbell",
  measure: "weight_reps",
  variationOf: null,
};
const db: ExerciseRef = {
  id: "db",
  name: "Dumbbell Bench Press",
  primaryMuscle: "Chest",
  equipment: "dumbbell",
  measure: "weight_reps",
  variationOf: "bench",
};
const row: ExerciseRef = {
  id: "row",
  name: "Barbell Row",
  primaryMuscle: "Back",
  equipment: "barbell",
  measure: "weight_reps",
  variationOf: null,
};

const set = (key: string, targetReps = 8) => ({
  key,
  weight: null,
  reps: null,
  targetWeight: null,
  targetReps,
  completed: false,
  completedAt: null,
});

function exercise(key: string, ref: ExerciseRef, sets: number, previous = true): ActiveExercise {
  return {
    key,
    exercise: ref,
    substitutedFor: null,
    restSeconds: 120,
    notes: "",
    previous: previous
      ? {
          sessionId: "s0",
          date: "2026-10-01T10:00:00Z",
          sets: [
            { weight: 100, reps: 8 },
            { weight: 100, reps: 7 },
          ],
        }
      : null,
    sets: Array.from({ length: sets }, (_, i) => set(`${key}-${i}`)),
  };
}

function workout(): ActiveWorkout {
  return {
    version: 1,
    id: "w1",
    ownerId: "u1",
    templateId: "t1",
    templateName: "Upper",
    estMinutes: 50,
    startedAt: "2026-10-24T10:00:00Z",
    currentIndex: 0,
    notes: "",
    exercises: [exercise("a", bench, 2), exercise("b", row, 1, false)],
    rest: { duration: 0, endsAt: null, pausedRemaining: null },
    updatedAt: 0,
  };
}

const NOW = 1_800_000_000_000;

describe("workoutReducer", () => {
  it("completes a set with explicit values and starts rest", () => {
    let w = workoutReducer(workout(), { type: "set.update", exerciseKey: "a", setKey: "a-0", patch: { weight: 102.5, reps: 8 } });
    w = workoutReducer(w, { type: "set.toggle", exerciseKey: "a", setKey: "a-0", now: NOW });
    expect(w.exercises[0].sets[0]).toMatchObject({ weight: 102.5, reps: 8, completed: true });
    expect(w.rest.endsAt).toBe(NOW + 120_000);
    expect(restRemainingMs(w.rest, NOW + 30_000)).toBe(90_000);
  });

  it("fills empty fields from last time / target when completing", () => {
    const w = workoutReducer(workout(), { type: "set.toggle", exerciseKey: "a", setKey: "a-0", now: NOW });
    expect(w.exercises[0].sets[0]).toMatchObject({ weight: 100, reps: 8, completed: true });
  });

  it("carries the weight just lifted into the next set", () => {
    let w = workoutReducer(workout(), { type: "set.update", exerciseKey: "a", setKey: "a-0", patch: { weight: 105 } });
    w = workoutReducer(w, { type: "set.toggle", exerciseKey: "a", setKey: "a-0", now: NOW });
    w = workoutReducer(w, { type: "set.toggle", exerciseKey: "a", setKey: "a-1", now: NOW });
    expect(w.exercises[0].sets[1]).toMatchObject({ weight: 105, reps: 8 });
  });

  it("refuses to complete a set with no reps information", () => {
    const base = workout();
    base.exercises[1].sets[0].targetReps = null;
    const w = workoutReducer(base, { type: "set.toggle", exerciseKey: "b", setKey: "b-0", now: NOW });
    expect(w).toBe(base);
  });

  it("advances focus after the last set of an exercise", () => {
    let w = workoutReducer(workout(), { type: "set.toggle", exerciseKey: "a", setKey: "a-0", now: NOW });
    expect(w.currentIndex).toBe(0);
    w = workoutReducer(w, { type: "set.toggle", exerciseKey: "a", setKey: "a-1", now: NOW });
    expect(w.currentIndex).toBe(1);
  });

  it("un-completes a set", () => {
    let w = workoutReducer(workout(), { type: "set.toggle", exerciseKey: "a", setKey: "a-0", now: NOW });
    w = workoutReducer(w, { type: "set.toggle", exerciseKey: "a", setKey: "a-0", now: NOW });
    expect(w.exercises[0].sets[0]).toMatchObject({ completed: false, completedAt: null, weight: 100 });
  });

  it("adds and removes sets", () => {
    let w = workoutReducer(workout(), { type: "set.add", exerciseKey: "a", key: "a-new" });
    expect(w.exercises[0].sets).toHaveLength(3);
    expect(w.exercises[0].sets[2].targetReps).toBe(8);
    w = workoutReducer(w, { type: "set.remove", exerciseKey: "a", setKey: "a-0" });
    expect(w.exercises[0].sets.map((s) => s.key)).toEqual(["a-1", "a-new"]);
  });

  it("sanitizes invalid numbers", () => {
    const w = workoutReducer(workout(), { type: "set.update", exerciseKey: "a", setKey: "a-0", patch: { weight: -5, reps: 7.6 } });
    expect(w.exercises[0].sets[0]).toMatchObject({ weight: null, reps: 8 });
  });

  it("substitutes an exercise, remembering the original and resetting actuals", () => {
    let w = workoutReducer(workout(), { type: "set.toggle", exerciseKey: "a", setKey: "a-0", now: NOW });
    w = workoutReducer(w, { type: "exercise.substitute", exerciseKey: "a", exercise: db, previous: null });
    expect(w.exercises[0].exercise.id).toBe("db");
    expect(w.exercises[0].substitutedFor?.id).toBe("bench");
    expect(w.exercises[0].sets.every((s) => !s.completed && s.weight == null)).toBe(true);
    // swapping back clears the substitution marker
    w = workoutReducer(w, { type: "exercise.substitute", exerciseKey: "a", exercise: bench, previous: null });
    expect(w.exercises[0].substitutedFor).toBeNull();
  });

  it("pauses, resumes and adjusts rest", () => {
    let w = workoutReducer(workout(), { type: "rest.start", seconds: 90, now: NOW });
    w = workoutReducer(w, { type: "rest.toggle", now: NOW + 10_000 });
    expect(w.rest.pausedRemaining).toBe(80_000);
    expect(restRemainingMs(w.rest, NOW + 999_999)).toBe(80_000);
    w = workoutReducer(w, { type: "rest.adjust", deltaSeconds: 15, now: NOW + 20_000 });
    expect(w.rest.pausedRemaining).toBe(95_000);
    w = workoutReducer(w, { type: "rest.toggle", now: NOW + 30_000 });
    expect(w.rest.endsAt).toBe(NOW + 30_000 + 95_000);
    w = workoutReducer(w, { type: "rest.adjust", deltaSeconds: -200, now: NOW + 30_000 });
    expect(restRemainingMs(w.rest, NOW + 30_000)).toBe(0);
  });

  it("builds a completion payload with snapshots and stats", () => {
    let w = workoutReducer(workout(), { type: "set.toggle", exerciseKey: "a", setKey: "a-0", now: NOW });
    w = workoutReducer(w, { type: "exercise.notes", exerciseKey: "a", notes: "  felt fast " });
    const p = toCompletionPayload(w, new Date("2026-10-24T11:00:00Z"));
    expect(p.exercises[0]).toMatchObject({ exercise_id: "bench", exercise_name: "Bench Press", notes: "felt fast" });
    expect(p.exercises[0].sets[0]).toMatchObject({ weight: 100, reps: 8, completed: true, target_reps: 8 });
    expect(p.exercises[0].sets[1].completed).toBe(false);
    expect(workoutStats(w)).toEqual({ done: 1, total: 3, volume: 800 });
  });
});
