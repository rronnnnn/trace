import { describe, expect, it } from "vitest";
import { atlasStops, byMonth, historySpan, overview, parseDay, placeOf, regionsAsOf } from "./atlas";
import { earnedLandmarks } from "./landscape/landmarks";
import { buildWorld, type WorldSession } from "./landscape/world";

const T0 = Date.parse("2026-01-05T18:00:00Z");
const day = 86400000;
const history: WorldSession[] = Array.from({ length: 30 }, (_, i) => ({
  id: `s-${String(i).padStart(3, "0")}`,
  endedAt: new Date(T0 + i * 7 * day).toISOString(),
  templateKey: i % 3 ? "upper" : "lower",
  label: i % 3 ? "Upper" : "Lower",
  volume: 5000 + i * 100,
  sets: 15,
  records: i % 5 === 0 ? 1 : 0,
  lifts: [{ exerciseId: "bench", name: "Bench Press", weight: 60 + i * 2.5, reps: 5 }],
}));

describe("atlas", () => {
  it("offers only moments that have passed, then today", () => {
    const now = new Date(T0 + 200 * day);
    expect(atlasStops(history[0].endedAt, now).map((s) => s.id)).toEqual(["week", "month", "3m", "6m", "now"]);
    expect(atlasStops(history[0].endedAt, new Date(T0 + 3 * day)).map((s) => s.id)).toEqual(["now"]);
  });

  it("says how long the record runs, plainly", () => {
    expect(historySpan("2026-01-01T00:00:00Z", new Date("2026-01-06T00:00:00Z"))).toBe("5 days");
    expect(historySpan("2026-01-01T00:00:00Z", new Date("2026-03-12T00:00:00Z"))).toBe("10 weeks");
    expect(historySpan("2026-01-01T00:00:00Z", new Date("2027-04-01T00:00:00Z"))).toBe("1 year, 3 months");
  });

  it("counts the overview from the history itself, each session once", () => {
    const ls = earnedLandmarks(history, { unit: "kg", timeZone: "UTC" });
    const o = overview([...history, history[0]], ls);
    expect(o).toMatchObject({ workouts: 30, records: 6, routines: 2, first: history[0].endedAt, landmarks: ls.length });
  });

  it("a past world is the world rebuilt from what existed then, and today's is unchanged by it", () => {
    const opts = { history, seed: "u", timeStart: new Date(T0 - day), timeEnd: new Date(T0 + 220 * day), cols: 60, rows: 39 };
    const today = buildWorld(opts);
    const then = buildWorld({ ...opts, asOf: history[9].endedAt });
    expect(then.landmarks).toHaveLength(10);
    expect(then.regions.reduce((n, r) => n + r.sessions, 0)).toBe(10);
    // positions earned then are where they are today
    for (const [id, p] of then.placed) expect(today.placed.get(id)).toEqual(p);
    expect(Array.from(buildWorld(opts).field)).toEqual(Array.from(today.field));
    const regions = regionsAsOf(history, history[9].endedAt);
    expect(regions.reduce((n, r) => n + r.workouts, 0)).toBe(10);
  });

  it("groups the record by month, newest month first", () => {
    const ls = earnedLandmarks(history, { unit: "kg", timeZone: "UTC" });
    const months = byMonth(ls, "UTC");
    expect(months[0].key > months.at(-1)!.key).toBe(true);
    expect(months.at(-1)!.items[0].id).toBe("first-workout");
    expect(months.flatMap((m) => m.items)).toHaveLength(ls.length);
  });

  it("locates summits on the frontier and other landmarks by their stone", () => {
    const ls = earnedLandmarks(history, { unit: "kg", timeZone: "UTC" });
    expect(placeOf(ls.find((l) => l.id === "first-workout")!)).toBe("landmark:first-workout");
    expect(placeOf(ls.find((l) => l.id === "streak-12")!)).toMatch(/^summit:\d+$/);
  });

  it("reads a day from the address bar, or nothing", () => {
    expect(parseDay("2026-03-04")).toBe("2026-03-04T23:59:59.000Z");
    expect(parseDay("2026-13-40")).toBeNull();
    expect(parseDay("x")).toBeNull();
    expect(parseDay(undefined)).toBeNull();
  });
});
