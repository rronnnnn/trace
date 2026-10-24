import { describe, expect, it } from "vitest";
import { goalProgress, goalTitle, mountainProfile, pointOnTrail, progressLine, suggestTarget } from "./goals";

const set = (endedAt: string, weight: number | null, reps: number, isSample = false) => ({ endedAt, weight, reps, isSample });

describe("goal progress", () => {
  const bench = { targetWeight: 100, targetReps: 1 };

  it("is the heaviest measured weight against the target (40 of 100 → 40%)", () => {
    const p = goalProgress(bench, [set("2026-10-01", 35, 8), set("2026-10-08", 40, 5), set("2026-10-15", 37.5, 8)]);
    expect(p).toMatchObject({ current: 40, target: 100, fraction: 0.4, bestAt: "2026-10-08", reachedAt: null });
    expect(progressLine(p, bench)).toBe("40% · 40 kg of 100 kg");
    expect(p.history.map((h) => h.value)).toEqual([35, 40]);
  });

  it("counts only sets with at least the target reps", () => {
    const p = goalProgress({ targetWeight: 80, targetReps: 5 }, [set("a", 85, 3), set("b", 70, 5), set("c", 75, 4)]);
    expect(p.current).toBe(70);
  });

  it("marks when the summit was reached and caps at 100%", () => {
    const p = goalProgress(bench, [set("2026-01-01", 90, 1), set("2026-02-01", 102.5, 1), set("2026-03-01", 105, 1)]);
    expect(p).toMatchObject({ fraction: 1, reachedAt: "2026-02-01", current: 105 });
  });

  it("bodyweight goals measure reps", () => {
    const pullups = { targetWeight: null, targetReps: 20 };
    const p = goalProgress(pullups, [set("a", null, 8), set("b", null, 12)]);
    expect(progressLine(p, pullups)).toBe("60% · 12 of 20 reps");
    expect(goalTitle({ ...pullups, exerciseName: "Pull-up" })).toBe("20 Pull-ups");
  });

  it("flags progress that comes from sample data", () => {
    expect(goalProgress(bench, [set("a", 50, 1, true)]).usesSample).toBe(true);
    expect(goalProgress(bench, []).fraction).toBe(0);
  });

  it("titles weighted goals and suggests a plate-rounded next summit", () => {
    expect(goalTitle({ targetWeight: 100, targetReps: 1, exerciseName: "Bench Press" })).toBe("100 kg Bench Press");
    expect(goalTitle({ targetWeight: 80, targetReps: 5, exerciseName: "Back Squat" })).toBe("80 kg × 5 Back Squat");
    expect(suggestTarget(65, true)).toBe(72.5);
    expect(suggestTarget(10, false)).toBe(13);
  });
});

describe("goal mountain", () => {
  it("is deterministic per goal, with the summit as the highest point", () => {
    const a = mountainProfile("goal-1");
    expect(mountainProfile("goal-1")).toEqual(a);
    expect(mountainProfile("goal-2")).not.toEqual(a);
    expect(Math.min(...a.ridge.map(([, y]) => y))).toBe(a.summit[1]);
  });

  it("places the climber along the trail by progress", () => {
    const { trail, summit } = mountainProfile("goal-1");
    const foot = pointOnTrail(trail, 0);
    const mid = pointOnTrail(trail, 0.4);
    const top = pointOnTrail(trail, 1);
    expect(foot.y).toBeGreaterThan(mid.y);
    expect(mid.y).toBeGreaterThan(top.y);
    expect([top.x, top.y]).toEqual(summit);
  });
});
