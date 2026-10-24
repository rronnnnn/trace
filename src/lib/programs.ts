/**
 * Starter programs offered during onboarding. They are copied into the user's own
 * templates, so editing them later never touches anyone else's data or past sessions.
 * Exercises reference the shared library by slug; `alt` is used when the user lacks
 * the primary exercise's equipment.
 */

export type ProgramExercise = { slug: string; alt?: string; sets: number; reps: number; rest: number };
export type ProgramDay = { name: string; focus: string; minutes: number; exercises: ProgramExercise[] };
export type Program = { id: string; name: string; summary: string; daysPerWeek: number[]; days: ProgramDay[] };

const ex = (slug: string, sets: number, reps: number, rest: number, alt?: string): ProgramExercise => ({ slug, sets, reps, rest, alt });

export const PROGRAMS: Program[] = [
  {
    id: "full-body",
    name: "Full Body",
    summary: "Two alternating sessions. Every major pattern, every time you train.",
    daysPerWeek: [2, 3],
    days: [
      {
        name: "Full Body A",
        focus: "Squat · Press · Row",
        minutes: 55,
        exercises: [
          ex("barbell-back-squat", 3, 6, 180, "goblet-squat"),
          ex("barbell-bench-press", 3, 6, 150, "dumbbell-bench-press"),
          ex("barbell-row", 3, 8, 120, "dumbbell-row"),
          ex("lateral-raise", 2, 12, 60),
          ex("triceps-pushdown", 2, 12, 60, "push-up"),
        ],
      },
      {
        name: "Full Body B",
        focus: "Hinge · Press · Pull",
        minutes: 55,
        exercises: [
          ex("romanian-deadlift", 3, 8, 150, "hip-thrust"),
          ex("overhead-press", 3, 6, 150, "dumbbell-shoulder-press"),
          ex("pull-up", 3, 8, 120, "lat-pulldown"),
          ex("leg-curl", 2, 12, 60),
          ex("barbell-curl", 2, 10, 60, "dumbbell-curl"),
        ],
      },
    ],
  },
  {
    id: "upper-lower",
    name: "Upper / Lower",
    summary: "Four sessions: two upper, two lower. More volume per muscle, still simple.",
    daysPerWeek: [4],
    days: [
      {
        name: "Upper Body Strength",
        focus: "Press · Row · Vertical pull",
        minutes: 55,
        exercises: [
          ex("barbell-bench-press", 4, 6, 150, "dumbbell-bench-press"),
          ex("barbell-row", 3, 8, 120, "dumbbell-row"),
          ex("overhead-press", 3, 8, 120, "dumbbell-shoulder-press"),
          ex("pull-up", 3, 8, 120, "lat-pulldown"),
          ex("triceps-pushdown", 2, 12, 60, "push-up"),
        ],
      },
      {
        name: "Lower Body Strength",
        focus: "Squat · Hinge",
        minutes: 55,
        exercises: [
          ex("barbell-back-squat", 4, 5, 180, "goblet-squat"),
          ex("romanian-deadlift", 3, 8, 150, "hip-thrust"),
          ex("leg-press", 3, 10, 120, "goblet-squat"),
          ex("leg-curl", 3, 12, 60),
          ex("standing-calf-raise", 3, 12, 60),
        ],
      },
      {
        name: "Upper Body Volume",
        focus: "Incline · Rows · Arms",
        minutes: 50,
        exercises: [
          ex("incline-dumbbell-press", 3, 10, 120),
          ex("seated-cable-row", 3, 10, 90, "dumbbell-row"),
          ex("lateral-raise", 3, 15, 60),
          ex("face-pull", 3, 15, 60, "lateral-raise"),
          ex("dumbbell-curl", 3, 12, 60),
        ],
      },
      {
        name: "Lower Body Volume",
        focus: "Deadlift · Single-leg · Glutes",
        minutes: 50,
        exercises: [
          ex("barbell-deadlift", 3, 5, 180, "romanian-deadlift"),
          ex("front-squat", 3, 8, 150, "goblet-squat"),
          ex("hip-thrust", 3, 10, 90),
          ex("leg-extension", 3, 12, 60),
        ],
      },
    ],
  },
  {
    id: "push-pull-legs",
    name: "Push · Pull · Legs",
    summary: "Three focused sessions, rotated. Suits five or six days a week.",
    daysPerWeek: [5, 6],
    days: [
      {
        name: "Push",
        focus: "Chest · Shoulders · Triceps",
        minutes: 55,
        exercises: [
          ex("barbell-bench-press", 4, 6, 150, "dumbbell-bench-press"),
          ex("overhead-press", 3, 8, 120, "dumbbell-shoulder-press"),
          ex("incline-dumbbell-press", 3, 10, 90),
          ex("lateral-raise", 3, 15, 60),
          ex("triceps-pushdown", 3, 12, 60, "dip"),
        ],
      },
      {
        name: "Pull",
        focus: "Back · Rear delts · Biceps",
        minutes: 55,
        exercises: [
          ex("pull-up", 4, 8, 120, "lat-pulldown"),
          ex("barbell-row", 3, 8, 120, "dumbbell-row"),
          ex("seated-cable-row", 3, 10, 90, "chest-supported-row"),
          ex("face-pull", 3, 15, 60, "lateral-raise"),
          ex("hammer-curl", 3, 12, 60),
        ],
      },
      {
        name: "Legs",
        focus: "Squat · Hinge · Accessories",
        minutes: 60,
        exercises: [
          ex("barbell-back-squat", 4, 5, 180, "goblet-squat"),
          ex("romanian-deadlift", 3, 8, 150, "hip-thrust"),
          ex("leg-press", 3, 10, 120, "goblet-squat"),
          ex("leg-curl", 3, 12, 60),
          ex("standing-calf-raise", 3, 15, 60),
        ],
      },
    ],
  },
];

export function recommendedProgram(daysPerWeek: number): Program {
  return PROGRAMS.find((p) => p.daysPerWeek.includes(daysPerWeek)) ?? (daysPerWeek <= 3 ? PROGRAMS[0] : PROGRAMS[2]);
}

export const EQUIPMENT_OPTIONS = [
  { id: "barbell", label: "Barbell & rack" },
  { id: "dumbbell", label: "Dumbbells" },
  { id: "cable", label: "Cables" },
  { id: "machine", label: "Machines" },
  { id: "bodyweight", label: "Pull-up bar" },
] as const;

export const GOAL_OPTIONS = [
  { id: "strength", label: "Get stronger", detail: "Heavier weights, lower reps." },
  { id: "hypertrophy", label: "Build muscle", detail: "Moderate weights, more volume." },
  { id: "general", label: "Stay fit", detail: "Balanced, sustainable training." },
] as const;

export const EXPERIENCE_OPTIONS = [
  { id: "new", label: "New", detail: "Under a year of consistent lifting." },
  { id: "intermediate", label: "Intermediate", detail: "One to three years." },
  { id: "advanced", label: "Advanced", detail: "Years of structured training." },
] as const;
