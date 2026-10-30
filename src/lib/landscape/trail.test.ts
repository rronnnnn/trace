import { describe, expect, it } from "vitest";
import { marksBetween, MAX_BETWEEN, progressStops } from "./trail";

const trail = (weights: number[]) => ({
  exerciseName: "Barbell Row",
  steps: weights.map((weight, i) => ({ weight, reps: 5, endedAt: `2026-08-${String(17 + i).padStart(2, "0")}T18:00:00Z`, sessionId: `s${i}` })),
});
const texts = (w: number[]) => progressStops(trail(w), 10, "kg", "UTC").map((s) => s.text);

describe("trail waypoints", () => {
  it("a small climb gets a mark per whole kilo, not one per half", () => {
    expect(texts([80, 80.5, 81, 81.5, 82])).toEqual(["80 kg · Aug 17", "81 kg", ""]);
  });

  it("a long climb is marked on round numbers, never crowded", () => {
    expect(texts([60, 75, 100])).toEqual(["60 kg · Aug 17", "70 kg", "80 kg", "90 kg", ""]);
    expect(texts([40, 160])).toEqual(["40 kg · Aug 17", "100 kg", ""]);
    for (const w of [[50, 52.5], [100, 101], [20, 200], [62.5, 87.5]]) expect(progressStops(trail(w), 10, "kg", "UTC").length - 2).toBeLessThanOrEqual(MAX_BETWEEN);
  });

  it("marks stand where their share of the climb is", () => {
    const s = progressStops(trail([60, 100]), 10, "kg", "UTC");
    expect(s.map((x) => x.t)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("without a lift, counts workouts on round numbers", () => {
    expect(progressStops(null, 23, "kg", "UTC").map((s) => s.text)).toEqual(["1st workout", "5 workouts", "10 workouts", "15 workouts", "20 workouts", ""]);
    expect(progressStops(null, 1, "kg", "UTC")).toEqual([]);
  });

  it("keeps marks clear of the ends", () => {
    expect(marksBetween(80, 90.5, 5)).toEqual([85]);
    expect(marksBetween(79.9, 90, 10)).toEqual([]);
  });
});
