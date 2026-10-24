/**
 * Active workout state. Lives entirely on the device (IndexedDB) until the session is
 * finished, so refreshes and connection loss never lose a logged set.
 */

export type Measure = "weight_reps" | "bodyweight_reps";

export type ExerciseRef = {
  id: string;
  name: string;
  primaryMuscle: string;
  equipment: string;
  measure: Measure;
  variationOf: string | null;
};

export type PreviousPerformance = {
  sessionId: string;
  date: string; // ISO
  sets: { weight: number | null; reps: number | null }[];
};

export type ActiveSet = {
  key: string;
  weight: number | null;
  reps: number | null;
  targetWeight: number | null;
  targetReps: number | null;
  completed: boolean;
  completedAt: string | null;
};

export type ActiveExercise = {
  key: string;
  exercise: ExerciseRef;
  /** The exercise originally planned, when the user swapped it for another. */
  substitutedFor: ExerciseRef | null;
  restSeconds: number;
  notes: string;
  previous: PreviousPerformance | null;
  sets: ActiveSet[];
};

export type RestTimer = {
  /** Total length of the current rest, for the progress ring. */
  duration: number;
  /** Epoch ms when rest ends; null when paused or idle. */
  endsAt: number | null;
  /** Remaining ms while paused. */
  pausedRemaining: number | null;
};

export type ActiveWorkout = {
  version: 1;
  id: string;
  ownerId: string;
  templateId: string | null;
  templateName: string;
  estMinutes: number | null;
  startedAt: string;
  currentIndex: number;
  notes: string;
  exercises: ActiveExercise[];
  rest: RestTimer;
  updatedAt: number;
};

/** Payload accepted by the `complete_session` RPC. */
export type CompletionPayload = {
  id: string;
  template_id: string | null;
  template_name: string;
  started_at: string;
  ended_at: string;
  notes: string | null;
  is_sample?: boolean;
  exercises: {
    exercise_id: string;
    exercise_name: string;
    substituted_for: string | null;
    notes: string | null;
    sets: {
      weight: number | null;
      reps: number | null;
      target_weight: number | null;
      target_reps: number | null;
      completed: boolean;
      completed_at: string | null;
    }[];
  }[];
};
