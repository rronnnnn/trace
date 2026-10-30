import { describe, expect, it } from "vitest";
import { bestEstimate, bestEver, epley, recentTrend, repMaxes, setLine, summarize, trendLine, type ExerciseSession } from "./exercise-progress";

const session = (endedAt: string, sets: [number | null, number | null][], id = endedAt): ExerciseSession => ({
  sessionId: id,
  endedAt,
  routine: "Push",
  isSample: false,
  notes: null,
  sets: sets.map(([weight, reps]) => ({ weight, reps })),
});

describe("exercise progress", () => {
  it("uses Epley like the database, and refuses past 12 reps", () => {
    expect(epley(100, 5)).toBe(116.7);
    expect(epley(100, 13)).toBeNull();
    expect(epley(0, 5)).toBeNull();
  });

  it("summarises a session's top set, volume and estimate", () => {
    const [s] = summarize([session("2026-10-01T10:00:00Z", [[80, 5], [85, 3], [85, 2], [60, 15]])]);
    expect(s).toMatchObject({ topWeight: 85, topWeightReps: 3, bestReps: 15, volume: 80 * 5 + 85 * 5 + 60 * 15 });
    expect(s.e1rm).toBe(93.5); // 85 × 3 beats 80 × 5 (93.3); 60 × 15 is excluded
  });

  it("orders oldest first and drops sessions without a valid set", () => {
    const list = summarize([session("2026-10-08", [[80, 5]]), session("2026-10-01", [[75, 5]]), session("2026-10-04", [[80, 0]])]);
    expect(list.map((s) => s.endedAt)).toEqual(["2026-10-01", "2026-10-08"]);
  });

  it("finds the best measured set, more reps breaking a tie", () => {
    const list = summarize([session("a", [[100, 3]]), session("b", [[100, 5]]), session("c", [[95, 8]])]);
    expect(bestEver(list, "weight_reps")).toMatchObject({ value: 100, reps: 5, sessionId: "b" });
    expect(bestEstimate(list)?.value).toBe(120.3); // 95 × 8 estimates higher than 100 × 5
  });

  it("measures bodyweight moves in reps", () => {
    const list = summarize([session("a", [[null, 8], [null, 10]]), session("b", [[null, 12]])]);
    expect(bestEver(list, "bodyweight_reps")).toMatchObject({ value: 12, sessionId: "b" });
    expect(bestEstimate(list)).toBeNull();
  });

  it("rep maxes count heavier sets with more reps as measured", () => {
    const maxes = repMaxes(summarize([session("a", [[100, 5]]), session("b", [[110, 1]]), session("c", [[80, 10]])]));
    const at = (n: number) => maxes.find((m) => m.reps === n)?.weight;
    expect(at(1)).toBe(110);
    expect(at(3)).toBe(100);
    expect(at(5)).toBe(100);
    expect(at(8)).toBe(80);
    expect(at(12)).toBeNull();
  });

  it("compares the last 4 weeks with the 4 before, only when both have data", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const list = summarize([session("2026-09-20T10:00:00Z", [[80, 5]]), session("2026-10-20T10:00:00Z", [[85, 5]])]);
    const t = recentTrend(list, "weight_reps", now);
    expect(t).toMatchObject({ current: 85, previous: 80 });
    expect(trendLine(t, "weight_reps")).toBe("Up 5 kg on the 4 weeks before");
    expect(recentTrend(summarize([session("2026-10-20T10:00:00Z", [[85, 5]])]), "weight_reps", now)).toBeNull();
  });

  it("writes sets in one line, collapsing repeats", () => {
    expect(setLine([{ weight: 80, reps: 5 }, { weight: 80, reps: 5 }, { weight: 85, reps: 3 }])).toBe("80 × 5 (×2), 85 × 3");
    expect(setLine([{ weight: 82.5, reps: 4 }])).toBe("82.5 × 4");
    expect(setLine([{ weight: null, reps: 12 }, { weight: null, reps: 10 }])).toBe("12, 10");
  });
});
