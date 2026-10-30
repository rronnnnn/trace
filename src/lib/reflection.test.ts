import { describe, expect, it } from "vitest";
import { buildReflection, change, headline, parseWeek, weekLabel, weeklyTotals, type ReflectionSession } from "./reflection";

let n = 0;
const s = (endedAt: string, opts: Partial<ReflectionSession> & { bench?: number } = {}): ReflectionSession => ({
  id: `s${++n}`,
  startedAt: new Date(new Date(endedAt).getTime() - 3600_000).toISOString(),
  endedAt,
  routine: "Push",
  volume: 1000,
  sets: 3,
  isSample: false,
  notes: null,
  records: [],
  exercises: [
    {
      exerciseId: "bench",
      name: "Bench Press",
      muscle: "Chest",
      measure: "weight_reps",
      sets: [{ weight: opts.bench ?? 80, reps: 5 }, { weight: opts.bench ?? 80, reps: 5 }],
    },
    { exerciseId: "pullup", name: "Pull-up", muscle: "Back", measure: "bodyweight_reps", sets: [{ weight: null, reps: 10 }] },
  ],
  ...opts,
});

const MON_TUE_THU = [1, 2, 4];

describe("weekly reflection", () => {
  it("accepts only real Mondays as week keys", () => {
    expect(parseWeek("2026-10-26")).toBe("2026-10-26");
    expect(parseWeek("2026-10-27")).toBeNull();
    expect(parseWeek("2026-02-30")).toBeNull();
    expect(parseWeek("nope")).toBeNull();
  });

  it("labels weeks across months", () => {
    expect(weekLabel("2026-10-19")).toBe("Oct 19 – 25");
    expect(weekLabel("2026-10-26")).toBe("Oct 26 – Nov 1");
  });

  it("counts planned days hit, missed and extra sessions", () => {
    const r = buildReflection({
      week: "2026-10-19",
      sessions: [s("2026-10-19T18:00:00Z"), s("2026-10-22T18:00:00Z"), s("2026-10-25T10:00:00Z")],
      trainingDays: MON_TUE_THU,
      timeZone: "UTC",
      today: "2026-10-30",
    });
    expect(r).toMatchObject({ complete: true, planned: 3, plannedHit: 2, missed: ["2026-10-20"], extra: 1, volume: 3000, minutes: 180 });
    expect(headline(r)).toBe("You trained 2 of 3 planned days, plus 1 extra.");
  });

  it("does not call today or future planned days missed", () => {
    const r = buildReflection({ week: "2026-10-26", sessions: [s("2026-10-26T18:00:00Z")], trainingDays: [1, 2, 5], timeZone: "UTC", today: "2026-10-27" });
    expect(r.missed).toEqual([]);
    expect(r.complete).toBe(false);
    expect(headline(r)).toBe("So far you've trained 1 of 3 planned days.");
  });

  it("assigns sessions to days in the viewer's timezone", () => {
    // 23:30 UTC Sunday is Monday in Berlin, so it belongs to the next week there.
    const sessions = [s("2026-10-25T23:30:00Z")];
    expect(buildReflection({ week: "2026-10-19", sessions, trainingDays: [], timeZone: "UTC", today: "2026-10-30" }).sessions).toHaveLength(1);
    expect(buildReflection({ week: "2026-10-19", sessions, trainingDays: [], timeZone: "Europe/Berlin", today: "2026-10-30" }).sessions).toHaveLength(0);
  });

  it("compares volume with last week and the average of up to 4 weeks since training began", () => {
    const r = buildReflection({
      week: "2026-10-19",
      sessions: [
        s("2026-10-06T18:00:00Z", { volume: 2000 }),
        s("2026-10-13T18:00:00Z", { volume: 1000 }),
        s("2026-10-20T18:00:00Z", { volume: 1500 }),
      ],
      trainingDays: [],
      timeZone: "UTC",
      today: "2026-10-30",
    });
    expect(r.previousVolume).toBe(1000);
    expect(r.averageVolume).toBe(1500); // two weeks of history, not four with zeros
    expect(change(r.volume, r.previousVolume)).toBe(0.5);
    expect(change(100, null)).toBeNull();
  });

  it("finds what improved against each exercise's previous session", () => {
    const r = buildReflection({
      week: "2026-10-19",
      sessions: [s("2026-10-12T18:00:00Z", { bench: 80 }), s("2026-10-21T18:00:00Z", { bench: 85 })],
      trainingDays: [],
      timeZone: "UTC",
      today: "2026-10-30",
    });
    expect(r.improvements.map((i) => [i.name, i.direction, i.before, i.now])).toEqual([
      ["Bench Press", "up", 80, 85],
      ["Pull-up", "level", 10, 10],
    ]);
    expect(r.muscles).toEqual([
      { muscle: "Chest", sets: 2 },
      { muscle: "Back", sets: 1 },
    ]);
  });

  it("counts a plan streak, waiting for the current week to be met", () => {
    const sessions = ["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14", "2026-10-26"].map((d) => s(`${d}T18:00:00Z`));
    const r = buildReflection({ week: "2026-10-26", sessions, trainingDays: [1, 3], timeZone: "UTC", today: "2026-10-27" });
    expect(r.streak).toBe(0); // week of Oct 19 had nothing
    const r2 = buildReflection({ week: "2026-10-12", sessions, trainingDays: [1, 3], timeZone: "UTC", today: "2026-10-27" });
    expect(r2.streak).toBe(2);
  });

  it("says a week off plainly", () => {
    const r = buildReflection({ week: "2026-10-12", sessions: [], trainingDays: [1], timeZone: "UTC", today: "2026-10-30" });
    expect(headline(r)).toBe("A week off. Rest counts too.");
  });

  it("lists weekly totals from the first session's week, empty weeks included", () => {
    const totals = weeklyTotals([s("2026-10-06T18:00:00Z"), s("2026-10-21T18:00:00Z")], "UTC", "2026-10-30");
    expect(totals.map((w) => [w.key, w.sessions])).toEqual([
      ["2026-10-26", 0],
      ["2026-10-19", 1],
      ["2026-10-12", 0],
      ["2026-10-05", 1],
    ]);
  });
});
