import { describe, expect, it } from "vitest";
import {
  balance,
  bestPerformances,
  exerciseHistories,
  frequency,
  measuredRecords,
  muscleVolume,
  pairObservation,
  periodFor,
  progression,
  recordCounts,
  steadiness,
  weeklyTotals,
  type InsightExercise,
  type InsightSession,
} from "./insights";

// Monday 2026-10-26 is the current week; "now" is that Friday.
const NOW = new Date("2026-10-30T12:00:00Z");
const TZ = "UTC";
const at = (day: string) => `${day}T18:00:00Z`;
const daysBefore = (n: number) => new Date(Date.parse("2026-10-30T18:00:00Z") - n * 86400000).toISOString().slice(0, 10);

const lift = (exerciseId: string, sets: [number, number][], muscle = "Chest", name = exerciseId): InsightExercise => ({
  exerciseId,
  name,
  muscle,
  measure: "weight_reps",
  sets: sets.map(([weight, reps]) => ({ weight, reps })),
});
const bw = (exerciseId: string, reps: number[], muscle = "Back"): InsightExercise => ({
  exerciseId,
  name: exerciseId,
  muscle,
  measure: "bodyweight_reps",
  sets: reps.map((r) => ({ weight: null, reps: r })),
});
let n = 0;
const session = (day: string, exercises: InsightExercise[], records: InsightSession["records"] = []): InsightSession => ({
  id: `s${n++}`,
  endedAt: at(day),
  routine: "Upper",
  isSample: false,
  exercises,
  records,
});

describe("periods", () => {
  it("ends with this week and compares with the equal window before, Monday-aligned", () => {
    const p = periodFor(4, NOW, TZ);
    expect(p).toEqual({ weeks: 4, start: "2026-10-05", end: "2026-11-01", previousStart: "2026-09-07" });
    // a Sunday-evening session in New York is still that Sunday, not Monday UTC
    expect(periodFor(1, new Date("2026-11-02T03:00:00Z"), "America/New_York").start).toBe("2026-10-26");
  });
});

describe("progression", () => {
  const p = periodFor(4, NOW, TZ);

  it("finds a heavier top set, and labels the estimate separately", () => {
    const s = [
      session("2026-09-10", [lift("bench", [[80, 5]])]),
      session("2026-09-24", [lift("bench", [[82.5, 5]])]),
      session("2026-10-08", [lift("bench", [[85, 5]])]),
      session("2026-10-22", [lift("bench", [[87.5, 3]])]),
    ];
    const [r] = progression(s, p, TZ);
    expect(r).toMatchObject({ exerciseId: "bench", basis: "top_weight", from: 82.5, to: 87.5, sessions: { recent: 2, previous: 2 } });
    expect(r.change).toBeCloseTo(5 / 82.5);
    expect(r.estimate).toEqual({ from: 96.3, to: 99.2 });
  });

  it("counts more reps at the same weight as progress", () => {
    const s = [
      session("2026-09-10", [lift("row", [[60, 8]], "Back")]),
      session("2026-09-24", [lift("row", [[60, 8]], "Back")]),
      session("2026-10-08", [lift("row", [[60, 9]], "Back")]),
      session("2026-10-22", [lift("row", [[60, 10]], "Back")]),
    ];
    expect(progression(s, p, TZ)[0]).toMatchObject({ basis: "reps_at_weight", atWeight: 60, from: 8, to: 10 });
  });

  it("counts bodyweight progress in reps", () => {
    const s = ["2026-09-10", "2026-09-24", "2026-10-08", "2026-10-22"].map((d, i) => session(d, [bw("pullup", [6 + i])]));
    expect(progression(s, p, TZ)[0]).toMatchObject({ basis: "reps", from: 7, to: 9 });
  });

  it("claims nothing without enough sessions in both windows, or without progress", () => {
    const thin = [session("2026-09-10", [lift("bench", [[80, 5]])]), session("2026-10-22", [lift("bench", [[90, 5]])]), session("2026-10-23", [lift("bench", [[90, 5]])])];
    expect(progression(thin, p, TZ)).toEqual([]);
    const flat = ["2026-09-10", "2026-09-24", "2026-10-08", "2026-10-22"].map((d) => session(d, [lift("bench", [[80, 5]])]));
    expect(progression(flat, p, TZ)).toEqual([]);
  });

  it("never compares an exercise with its variation", () => {
    const s = [
      session("2026-09-10", [lift("bench", [[80, 5]])]),
      session("2026-09-24", [lift("bench", [[80, 5]])]),
      session("2026-10-08", [lift("incline", [[100, 5]])]),
      session("2026-10-22", [lift("incline", [[100, 5]])]),
    ];
    expect(progression(s, p, TZ)).toEqual([]);
  });

  it("respects window boundaries to the day", () => {
    // 2026-10-04 is the last day of the previous window; 2026-10-05 the first of the recent one
    const s = [
      session("2026-09-07", [lift("bench", [[80, 5]])]),
      session("2026-10-04", [lift("bench", [[80, 5]])]),
      session("2026-10-05", [lift("bench", [[85, 5]])]),
      session("2026-11-01", [lift("bench", [[85, 5]])]),
      session("2026-09-06", [lift("bench", [[200, 5]])]), // before both windows: ignored
    ];
    expect(progression(s, p, TZ)[0]).toMatchObject({ from: 80, to: 85, sessions: { recent: 2, previous: 2 } });
  });
});

describe("steadiness", () => {
  it("one off day is not a plateau: the recent stretch is judged by its best", () => {
    const s = [
      ...[50, 46, 42, 38, 34].map((d, i) => session(daysBefore(d), [lift("squat", [[100 + i * 2.5, 5]], "Quads")])),
      session(daysBefore(8), [lift("squat", [[90, 5]], "Quads")]), // a bad day
      session(daysBefore(2), [lift("squat", [[112.5, 5]], "Quads")]), // a new best right after
    ];
    expect(steadiness(s, NOW).filter((x) => x.status === "holding")).toEqual([]);
  });

  it("holding steady: no new best across the last four sessions over three weeks or more", () => {
    const s = [
      ...[60, 55, 50].map((d, i) => session(daysBefore(d), [lift("ohp", [[50 + i * 2.5, 5]], "Shoulders")])),
      ...[28, 21, 14, 3].map((d) => session(daysBefore(d), [lift("ohp", [[55, 4]], "Shoulders")])),
    ];
    const [h] = steadiness(s, NOW);
    expect(h).toMatchObject({ status: "holding", exerciseId: "ohp", recentSessions: 4 });
    if (h.status === "holding") expect(h.best).toBeCloseTo(64.2, 1);
  });

  it("more reps at the same weight is not a plateau", () => {
    const s = [
      ...[60, 55, 50].map((d) => session(daysBefore(d), [lift("ohp", [[55, 4]], "Shoulders")])),
      ...[28, 21, 14, 3].map((d, i) => session(daysBefore(d), [lift("ohp", [[55, 4 + (i === 3 ? 2 : 0)]], "Shoulders")])),
    ];
    expect(steadiness(s, NOW).filter((x) => x.status === "holding")).toEqual([]);
  });

  it("separates too little data from a plateau, and skips exercises no longer trained", () => {
    const few = [14, 7, 2].map((d) => session(daysBefore(d), [lift("curl", [[20, 10]], "Biceps")]));
    expect(steadiness(few, NOW)).toEqual([{ status: "insufficient", exerciseId: "curl", name: "curl", sessions: 3 }]);
    const old = [120, 110, 100, 90, 80, 70, 60].map((d) => session(daysBefore(d), [lift("fly", [[20, 10]])]));
    expect(steadiness(old, NOW)).toEqual([]);
    // four sessions in one week are too close together to call
    const close = [...[40, 35].map((d) => session(daysBefore(d), [lift("dip", [[20, 8]])])), ...[6, 5, 4, 3].map((d) => session(daysBefore(d), [lift("dip", [[20, 8]])]))];
    expect(steadiness(close, NOW).filter((x) => x.status === "holding")).toEqual([]);
  });
});

describe("volume and balance", () => {
  const p = periodFor(4, NOW, TZ);
  const s = [
    session("2026-10-26", [lift("bench", [[80, 5], [80, 5], [80, 5]]), lift("row", [[60, 8], [60, 8]], "Back")]),
    session("2026-10-28", [lift("squat", [[100, 5], [100, 5]], "Quads"), bw("pullup", [8, 8])]),
    session("2026-10-28", [lift("bench", [[80, 5]])]), // a second session the same day
    session("2026-09-15", [lift("calf", [[50, 12]], "Calves")]),
  ];
  const weeks = weeklyTotals(s, p, TZ);

  it("buckets every week of both windows, empty ones included", () => {
    expect(weeks).toHaveLength(8);
    const now = weeks.at(-1)!;
    expect(now).toMatchObject({ week: "2026-10-26", sessions: 3, days: 2, sets: 10, volume: 80 * 5 * 4 + 60 * 8 * 2 + 100 * 5 * 2 });
    expect(weeks.find((w) => w.week === "2026-09-14")!.sets).toBe(1);
  });

  it("counts each set once, toward its primary muscle only", () => {
    const now = weeks.at(-1)!;
    expect(Object.fromEntries(now.setsByMuscle)).toEqual({ Chest: 4, Back: 4, Quads: 2 });
    const mv = muscleVolume(weeks, p);
    expect(mv.find((m) => m.muscle === "Chest")).toEqual({ muscle: "Chest", recent: 1, previous: 0 });
    expect(mv.find((m) => m.muscle === "Calves")).toEqual({ muscle: "Calves", recent: 0, previous: 0.25 });
  });

  it("frequency averages over the window's weeks", () => {
    const f = frequency(weeks, p);
    expect(f.recent.sessionsPerWeek).toBe(0.75);
    expect(f.recent.daysPerWeek).toBe(0.5);
    expect(f.previous.sessionsPerWeek).toBe(0.25);
  });

  it("describes balance only from recorded sets, and only with enough of them", () => {
    const b = balance(weeks, p);
    expect(b).toMatchObject({ push: 4, pull: 4, lower: 2, upper: 8, other: 0, total: 10, untrained: ["Calves"], enough: false });
    expect(pairObservation({ label: "pushing", sets: 64 }, { label: "pulling", sets: 31 }, 8)).toBe(
      "Over the last 8 weeks you logged 64 pushing sets and 31 pulling.",
    );
    expect(pairObservation({ label: "pushing", sets: 30 }, { label: "pulling", sets: 25 }, 8)).toBeNull();
  });
});

describe("records", () => {
  const p = periodFor(4, NOW, TZ);
  const s = [
    session("2026-10-20", [lift("bench", [[90, 3]])], [
      { exerciseId: "bench", name: "Bench", kind: "heaviest_weight", weight: 90, reps: 3, value: 90, isBaseline: false },
      { exerciseId: "bench", name: "Bench", kind: "estimated_1rm", weight: 90, reps: 3, value: 99, isBaseline: false },
    ]),
    session("2026-09-01", [lift("bench", [[85, 5]])], [{ exerciseId: "bench", name: "Bench", kind: "heaviest_weight", weight: 85, reps: 5, value: 85, isBaseline: true }]),
    session("2026-09-20", [lift("bench", [[88, 2]])], [{ exerciseId: "bench", name: "Bench", kind: "heaviest_weight", weight: 88, reps: 2, value: 88, isBaseline: false }]),
  ];

  it("reuses the existing records: measured, never baselines or estimates, newest first", () => {
    const r = measuredRecords(s);
    expect(r.map((x) => x.weight)).toEqual([90, 88]);
    expect(recordCounts(r, p, NOW, TZ)).toEqual({ recent: 1, previous: 1, year: 2, all: 2 });
  });

  it("each exercise's best measured set ever", () => {
    expect(bestPerformances(s)[0]).toMatchObject({ exerciseId: "bench", weight: 90, reps: 3, sessions: 3 });
    // an exercise done twice in one session is one session
    expect(exerciseHistories([session("2026-10-01", [lift("bench", [[80, 5]]), lift("bench", [[85, 5]])])])[0].days).toHaveLength(1);
  });
});
