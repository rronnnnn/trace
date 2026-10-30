import { describe, expect, it } from "vitest";
import { earnedLandmarks, landmarksSince, summitDefs, summits } from "./landmarks";
import { frontierAlpha, frontierGrid, frontierHeight, frontierMist, frontierReach, landmarkSpots, outside, summitSpots } from "./frontier";
import { buildWorld, type WorldSession } from "./world";

const T0 = Date.parse("2026-01-05T18:00:00Z"); // a Monday
const day = 86400000;
const opts = { unit: "kg", timeZone: "UTC" };

/** One session a week, Upper/Lower alternating unless told otherwise. */
function history(count: number, f: (i: number) => Partial<WorldSession> = () => ({})): WorldSession[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s-${String(i).padStart(4, "0")}`,
    endedAt: new Date(T0 + i * 7 * day).toISOString(),
    templateKey: i % 2 ? "lower" : "upper",
    label: i % 2 ? "Lower" : "Upper",
    volume: 5000,
    sets: 15,
    records: 0,
    ...f(i),
  }));
}

const ids = (h: WorldSession[], asOf?: string) => earnedLandmarks(h, { ...opts, asOf }).map((l) => l.id);

describe("landmarks", () => {
  it("marks the first workout, each new range and workout counts, on the sessions that earned them", () => {
    const h = history(26);
    const ls = earnedLandmarks(h, opts);
    const by = (id: string) => ls.find((l) => l.id === id)!;
    expect(by("first-workout").sessionId).toBe("s-0000");
    expect(by("range-lower").sessionId).toBe("s-0001");
    expect(by("workouts-10").sessionId).toBe("s-0009");
    expect(by("workouts-25").sessionId).toBe("s-0024");
    expect(by("workouts-25").at).toBe(h[24].endedAt);
    expect(ls.some((l) => l.id === "workouts-50")).toBe(false);
  });

  it("counts unbroken weeks, and a gap starts the count again", () => {
    const steady = history(13);
    expect(ids(steady)).toContain("streak-12");
    // a missing week after week 6 breaks it: 6 + 7 never reaches 12
    const gap = history(13, (i) => ({ endedAt: new Date(T0 + (i < 6 ? i : i + 1) * 7 * day).toISOString() }));
    expect(ids(gap)).toContain("streak-4");
    expect(ids(gap)).not.toContain("streak-12");
    // two sessions in one week are one week
    const doubled = history(8, (i) => ({ endedAt: new Date(T0 + Math.floor(i / 2) * 7 * day + (i % 2) * day).toISOString() }));
    expect(ids(doubled)).toContain("streak-4");
  });

  it("strength milestones come from completed sets: a load crossed once, and an exercise doubled", () => {
    const h = history(6, (i) => ({
      lifts: [{ exerciseId: "squat", name: "Back Squat", weight: [50, 70, 95, 105, 100, 150][i], reps: 5 }],
    }));
    const ls = earnedLandmarks(h, opts);
    expect(ls.filter((l) => l.id === "load-100").map((l) => l.sessionId)).toEqual(["s-0003"]);
    expect(ls.find((l) => l.id === "load-140")!.sessionId).toBe("s-0005");
    expect(ls.find((l) => l.id === "doubled-squat")!.sessionId).toBe("s-0003");
    expect(ls.find((l) => l.id === "doubled-squat")!.stats[1].value).toBe("105 kg × 5");
    // a set with no reps lifted nothing
    expect(ids(history(1, () => ({ lifts: [{ exerciseId: "x", name: "X", weight: 120, reps: 0 }] })))).not.toContain("load-100");
  });

  it("the first record is a measured one, with its real weight and reps", () => {
    const h = history(3, (i) =>
      i === 2 ? { records: 1, prs: [{ exerciseId: "bench", name: "Bench Press", kind: "heaviest_weight", weight: 82.5, reps: 3 }] } : {},
    );
    const first = earnedLandmarks(h, opts).find((l) => l.id === "first-record")!;
    expect(first.sessionId).toBe("s-0002");
    expect(first.stats[0].value).toBe("82.5 kg × 3");
  });

  it("is reproducible and never counts a session twice", () => {
    const h = history(30);
    const shuffled = [...h].reverse();
    expect(earnedLandmarks(shuffled, opts)).toEqual(earnedLandmarks(h, opts));
    expect(ids([...h, ...h.slice(0, 5)])).toEqual(ids(h));
    expect(new Set(ids(h)).size).toBe(ids(h).length);
  });

  it("as of a date, shows exactly the landmarks that existed then, unchanged since", () => {
    const h = history(60);
    const then = h[30].endedAt;
    const past = earnedLandmarks(h, { ...opts, asOf: then });
    expect(past.every((l) => l.at <= then)).toBe(true);
    expect(past.map((l) => l.id)).not.toContain("workouts-50");
    // a landmark earned then is the same landmark now: same session, same date
    const now = earnedLandmarks(h, opts);
    for (const l of past) expect(now.find((n) => n.id === l.id)).toEqual(l);
  });

  it("editing or renaming a routine keeps every landmark on its session (the routine key holds)", () => {
    const h = history(12);
    const renamed = h.map((s) => ({ ...s, label: s.label === "Upper" ? "Upper A" : s.label }));
    const pick = (x: WorldSession[]) => earnedLandmarks(x, opts).map((l) => [l.id, l.sessionId, l.at]);
    expect(pick(renamed)).toEqual(pick(h));
  });

  it("summits stay uncharted, giving nothing away, until reached", () => {
    const ls = earnedLandmarks(history(50), opts);
    const all = summits(ls, "kg");
    expect(all).toHaveLength(summitDefs("kg").length);
    const reached = all.find((s) => s.id === "workouts-50")!;
    expect(reached.name).toBe("Long Ridge");
    expect(reached.landmark?.sessionId).toBe("s-0049");
    const uncharted = all.find((s) => s.id === "workouts-100")!;
    expect(uncharted.name).toBeNull();
    expect(uncharted.landmark).toBeNull();
    // the summit's landmark is the same milestone the archive holds, not a second record
    expect(ls.filter((l) => l.id === "workouts-50")).toHaveLength(1);
    expect(ls.find((l) => l.id === "workouts-50")!.summit).toEqual({ slot: reached.slot, name: "Long Ridge" });
  });

  it("finds what was earned since a moment, for the world to reveal", () => {
    const h = history(12);
    const ls = earnedLandmarks(h, opts);
    expect(landmarksSince(ls, h[8].endedAt).map((l) => l.id)).toEqual(["workouts-10", "streak-12"]);
    expect(landmarksSince(ls, null)).toEqual([]);
  });
});

describe("frontier", () => {
  const spots = summitSpots("user-1", 12);

  it("summits keep fixed places beyond the developed map, away from the near side", () => {
    expect(summitSpots("user-1", 12)).toEqual(spots);
    expect(summitSpots("user-2", 12)).not.toEqual(spots);
    for (const s of spots) {
      expect(outside(s.x, s.z)).toBeGreaterThan(8);
      expect(s.z).toBeLessThan(64 + 22); // the camera looks across from the south
    }
  });

  it("never rises inside the developed world, and summits stand above their ground", () => {
    expect(frontierHeight(7, 50, 32, spots)).toBe(0);
    expect(frontierHeight(7, 0.5, 63, spots)).toBe(0);
    for (const s of spots) {
      const top = frontierHeight(7, s.x, s.z, spots);
      expect(top).toBeGreaterThan(frontierHeight(7, s.x + 14, s.z + 14, spots));
      expect(top).toBeGreaterThan(8);
    }
    expect(frontierAlpha(50, 32)).toBe(0);
  });

  it("the mist only thins: with more history, and around a discovered summit", () => {
    const p = { x: spots[0].x + 6, z: spots[0].z };
    expect(frontierMist(p.x, p.z, frontierReach(200), [])).toBeLessThan(frontierMist(p.x, p.z, frontierReach(10), []));
    expect(frontierMist(p.x, p.z, 0.3, [spots[0]])).toBeLessThan(frontierMist(p.x, p.z, 0.3, []));
    expect(frontierReach(0)).toBe(0);
    expect(frontierReach(500)).toBeLessThan(1);
    const g = frontierGrid("user-1", spots, 0.2, [0]);
    expect(g.heights.length).toBe(g.cols * g.rows);
    expect(frontierGrid("user-1", spots, 0.2, [0]).heights).toEqual(g.heights);
  });

  it("landmarks stand beside the session that earned it, wherever the world is rebuilt", () => {
    const h = history(26);
    const ls = earnedLandmarks(h, opts);
    const w = (asOf?: string) =>
      buildWorld({ history: h, seed: "user-1", asOf, timeStart: new Date(T0 - day), timeEnd: new Date(T0 + 200 * day), cols: 60, rows: 39 });
    const now = landmarkSpots(ls, w().placed);
    const before = landmarkSpots(
      ls.filter((l) => l.at <= h[12].endedAt),
      w(h[12].endedAt).placed,
    );
    for (const b of before) expect(now.find((n) => n.landmark.id === b.landmark.id)).toEqual(b);
    // two landmarks on one session (first workout of a range and a count) don't stack
    const spot = landmarkSpots(ls, w().placed);
    const keys = spot.map((s) => `${s.x.toFixed(4)},${s.y.toFixed(4)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
