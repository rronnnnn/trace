import type { ExploreRecord, ExploreSession } from "@/lib/landscape/explore";

/**
 * Three weeks of training (Mon 5 Oct – Fri 23 Oct 2026, UTC):
 *  w1  Upper  bench 60×8 ×2, pull-ups 8        (baselines only)
 *  w2  Lower  squat 80×5 ×3                    (baseline only)
 *  w3  Upper  bench 65×8, 65×7, pull-ups 10    (heaviest + most reps records, plus an e1RM estimate)
 *  w3  Lower  squat 80×5                       (no record)
 */
export const BENCH = "00000000-0000-4000-8000-0000000000b1";
export const SQUAT = "00000000-0000-4000-8000-0000000000b2";
export const PULLUP = "00000000-0000-4000-8000-0000000000b3";
export const UPPER = "00000000-0000-4000-8000-00000000a001";
export const LOWER = "00000000-0000-4000-8000-00000000a002";

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function session(
  sid: string,
  templateId: string,
  name: string,
  endedAt: string,
  exercises: { exerciseId: string; name: string; sets: [number | null, number][] }[],
  records: (Omit<ExploreRecord, "setId"> & { setIndex: [number, number] })[] = [],
): ExploreSession {
  const ex = exercises.map((e, i) => ({
    id: id(),
    exerciseId: e.exerciseId,
    name: e.name,
    position: i,
    sets: e.sets.map(([weight, reps], k) => ({ id: id(), position: k, weight, reps, completed: true })),
  }));
  const volume = ex.reduce((v, e) => v + e.sets.reduce((a, s) => a + (s.weight ?? 0) * (s.reps ?? 0), 0), 0);
  return {
    id: sid,
    templateId,
    templateName: name,
    startedAt: new Date(Date.parse(endedAt) - 50 * 60000).toISOString(),
    endedAt,
    totalVolume: volume,
    completedSets: ex.reduce((c, e) => c + e.sets.length, 0),
    isSample: false,
    exercises: ex,
    records: records.map(({ setIndex: [e, s], ...r }) => ({ ...r, setId: ex[e].sets[s].id })),
  };
}

export const S1 = "00000000-0000-4000-8000-00000000c001";
export const S2 = "00000000-0000-4000-8000-00000000c002";
export const S3 = "00000000-0000-4000-8000-00000000c003";
export const S4 = "00000000-0000-4000-8000-00000000c004";

export const NOW = new Date("2026-10-23T18:00:00Z");

export const sessions: ExploreSession[] = [
  session(
    S1,
    UPPER,
    "Upper Body",
    "2026-10-05T18:00:00Z",
    [
      {
        exerciseId: BENCH,
        name: "Bench Press",
        sets: [
          [60, 8],
          [60, 8],
        ],
      },
      { exerciseId: PULLUP, name: "Pull-up", sets: [[null, 8]] },
    ],
    [
      { exerciseId: BENCH, kind: "heaviest_weight", value: 60, weight: 60, reps: 8, isBaseline: true, setIndex: [0, 0] },
      { exerciseId: PULLUP, kind: "most_reps", value: 8, weight: null, reps: 8, isBaseline: true, setIndex: [1, 0] },
    ],
  ),
  session(
    S2,
    LOWER,
    "Lower Body",
    "2026-10-14T18:00:00Z",
    [
      {
        exerciseId: SQUAT,
        name: "Back Squat",
        sets: [
          [80, 5],
          [80, 5],
          [80, 5],
        ],
      },
    ],
    [{ exerciseId: SQUAT, kind: "heaviest_weight", value: 80, weight: 80, reps: 5, isBaseline: true, setIndex: [0, 0] }],
  ),
  session(
    S3,
    UPPER,
    "Upper Body",
    "2026-10-19T18:00:00Z",
    [
      {
        exerciseId: BENCH,
        name: "Bench Press",
        sets: [
          [65, 8],
          [65, 7],
        ],
      },
      { exerciseId: PULLUP, name: "Pull-up", sets: [[null, 10]] },
    ],
    [
      { exerciseId: BENCH, kind: "heaviest_weight", value: 65, weight: 65, reps: 8, isBaseline: false, setIndex: [0, 0] },
      { exerciseId: BENCH, kind: "estimated_1rm", value: 82.3, weight: 65, reps: 8, isBaseline: false, setIndex: [0, 0] },
      { exerciseId: PULLUP, kind: "most_reps", value: 10, weight: null, reps: 10, isBaseline: false, setIndex: [1, 0] },
    ],
  ),
  session(S4, LOWER, "Lower Body", "2026-10-22T18:00:00Z", [{ exerciseId: SQUAT, name: "Back Squat", sets: [[80, 5]] }]),
];

export const muscles = { [BENCH]: "Chest", [SQUAT]: "Quads", [PULLUP]: "Back" };
