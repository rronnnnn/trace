import { describe, expect, it } from "vitest";
import { bestEffort, bestEfforts, bestPace, elevationGain, paceProfile, runTotals, splits, weeklyDistance, type RunSummary } from "./analysis";
import {
  activeTime,
  currentPace,
  formatClockTime,
  formatPace,
  haversine,
  judgeFix,
  movingTime,
  runReducer,
  startRun,
  toRow,
  type Fix,
  type RunState,
  type TrackPoint,
} from "./recorder";

const M_PER_DEG = 111194.9; // metres per degree of latitude on the mean sphere
const T0 = Date.parse("2026-10-30T07:00:00Z");
const fix = (metersNorth: number, t: number, accuracy = 5, altitude: number | null = null): Fix => ({
  lat: 52 + metersNorth / M_PER_DEG,
  lng: 13,
  t,
  accuracy,
  altitude,
  altitudeAccuracy: altitude == null ? null : 5,
});
const run = (events: Parameters<typeof runReducer>[1][], kind: "outdoor" | "treadmill" = "outdoor") =>
  events.reduce(runReducer, startRun({ id: "r1", ownerId: "u", kind, t: T0 }));
/** A steady run north: one fix every `every` s at `speed` m/s. */
const steady = (seconds: number, speed = 3, every = 5, from = 0, t0 = T0, seg = 0): TrackPoint[] =>
  Array.from({ length: Math.floor(seconds / every) + 1 }, (_, i) => [52 + (from + i * every * speed) / M_PER_DEG, 13, t0 + i * every * 1000, 5, null, seg]);

describe("distance", () => {
  it("measures great-circle distance", () => {
    expect(haversine({ lat: 52, lng: 13 }, { lat: 52 + 1000 / M_PER_DEG, lng: 13 })).toBeCloseTo(1000, 0);
    expect(haversine({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(M_PER_DEG, -1);
  });
});

describe("GPS noise", () => {
  it("drops inaccurate fixes, jumps and standing-still jitter", () => {
    const p: TrackPoint = [52, 13, T0, 5, null, 0];
    expect(judgeFix(null, fix(0, T0, 50))).toBe("inaccurate");
    expect(judgeFix(p, fix(200, T0 + 5000))).toBe("jump"); // 40 m/s
    expect(judgeFix(p, fix(2, T0 + 5000))).toBe("still");
    expect(judgeFix(p, fix(15, T0 + 5000))).toBe("accepted");
    expect(judgeFix(p, fix(15, T0))).toBe("stale");
  });

  it("standing at a crossing adds no distance", () => {
    const events = [fix(0, T0), ...Array.from({ length: 60 }, (_, i) => fix(((i * 7) % 5) - 2, T0 + (i + 1) * 2000, 8))].map((f) => ({ type: "fix" as const, fix: f }));
    const s = run(events);
    expect(s.distance).toBe(0);
    expect(s.points).toHaveLength(1);
    expect(s.dropped.still).toBeGreaterThan(50);
  });

  it("a single wild fix mid-run is dropped and the track carries on", () => {
    const fixes = [fix(0, T0), fix(15, T0 + 5000), fix(900, T0 + 10000), fix(30, T0 + 10000 + 1), fix(45, T0 + 15000)];
    const s = run(fixes.map((f) => ({ type: "fix" as const, fix: f })));
    expect(s.dropped.jump).toBe(1);
    expect(s.distance).toBeCloseTo(45, 0);
  });
});

describe("pause and resume", () => {
  it("records nothing while paused, and the running time excludes the pause", () => {
    const s = run([
      { type: "fix", fix: fix(0, T0) },
      { type: "fix", fix: fix(150, T0 + 50000) },
      { type: "pause", t: T0 + 60000 },
      { type: "fix", fix: fix(400, T0 + 90000) }, // walked on while paused: not recorded
      { type: "resume", t: T0 + 120000 },
      { type: "fix", fix: fix(400, T0 + 121000) }, // first point of the new segment: no distance from the pause
      { type: "fix", fix: fix(550, T0 + 171000) },
      { type: "finish", t: T0 + 180000 },
    ]);
    expect(s.distance).toBeCloseTo(300, 0);
    expect(activeTime(s, T0 + 999999)).toBe(60000 + 60000);
    const row = toRow(s, { title: " Morning " });
    expect(row).toMatchObject({ title: "Morning", source: "gps", elapsed_seconds: 180, distance_m: 300 });
    expect(row.moving_seconds).toBe(100);
    expect(row.moving_seconds).toBeLessThanOrEqual(row.elapsed_seconds);
  });

  it("a finished run takes no more events", () => {
    const s = run([{ type: "finish", t: T0 + 1000 }]);
    expect(runReducer(s, { type: "fix", fix: fix(10, T0 + 2000) })).toBe(s);
    expect(runReducer(s, { type: "resume", t: T0 + 3000 })).toBe(s);
  });

  it("a treadmill run keeps time and takes its distance by hand", () => {
    const s = run([{ type: "fix", fix: fix(100, T0 + 1000) }, { type: "finish", t: T0 + 1800000 }], "treadmill");
    expect(s.points).toEqual([]);
    expect(toRow(s, { title: null, distanceOverride: 5000 })).toMatchObject({ source: "manual", kind: "treadmill", distance_m: 5000, moving_seconds: 1800, route: null });
  });

  it("a recovered run is the same run: its state round-trips through storage", () => {
    const s = run([{ type: "fix", fix: fix(0, T0) }, { type: "fix", fix: fix(30, T0 + 10000) }, { type: "pause", t: T0 + 12000 }]);
    const restored = JSON.parse(JSON.stringify(s)) as RunState;
    expect(restored).toEqual(s);
    const next = runReducer(runReducer(restored, { type: "resume", t: T0 + 20000 }), { type: "fix", fix: fix(60, T0 + 30000) });
    expect(next.points).toHaveLength(3);
    expect(next.distance).toBeCloseTo(30, 0); // the new segment starts fresh
  });
});

describe("pace and time", () => {
  it("current pace over the last 30 seconds, average pace from moving time", () => {
    const pts = steady(120, 3); // 3 m/s ≈ 5:33 /km
    expect(currentPace(pts, T0 + 120000)).toBeCloseTo(1000 / 3, 0);
    expect(currentPace(pts.slice(0, 1), T0)).toBeNull();
    expect(movingTime(pts)).toBe(120000);
    expect(formatPace(355)).toBe("5:55");
    expect(formatPace(null)).toBe("–:––");
    expect(formatClockTime(3725000)).toBe("1:02:05");
  });
});

describe("splits and efforts", () => {
  it("splits per kilometre, the last one partial", () => {
    const pts = steady(1200, 3); // 3.6 km
    const s = splits(pts);
    expect(s.map((x) => Math.round(x.meters))).toEqual([1000, 1000, 1000, 600]);
    for (const x of s.slice(0, 3)) expect(x.seconds).toBeCloseTo(333.3, 0);
    expect(s[3].pace).toBeCloseTo(333.3, 0);
  });

  it("best effort finds the fastest stretch and never spans a pause or a gap", () => {
    const slow = steady(400, 2.5); // 1 km at 2.5 m/s
    const fast = steady(400, 4, 5, 1000, T0 + 405000).slice(1); // then 1.6 km at 4 m/s
    const e = bestEffort([...slow, ...fast], 1000)!;
    expect(e.seconds).toBeCloseTo(250, -1);
    // the same stretch split by a pause has no 1 km effort in either half
    const paused = [...steady(200, 4), ...steady(200, 4, 5, 800, T0 + 300000, 1)];
    expect(bestEffort(paused, 1000)).toBeNull();
    // a 60 s gap (screen locked) breaks it too
    const gap = [...steady(150, 4), ...steady(150, 4, 5, 600 + 240, T0 + 210000).map((p) => p)];
    expect(bestEffort(gap, 1000)).toBeNull();
    expect(bestPace(steady(200, 4))).toBeCloseTo(250, 0);
  });

  it("awards best efforts from GPS outdoor runs only", () => {
    const gps: RunSummary = { id: "a", kind: "outdoor", source: "gps", title: null, startedAt: new Date(T0).toISOString(), movingSeconds: 1800, elapsedSeconds: 1800, meters: 5400, points: steady(1800, 3), isSample: false };
    const tread: RunSummary = { ...gps, id: "b", kind: "treadmill", source: "manual", points: null, meters: 10000, movingSeconds: 1500 };
    const manual: RunSummary = { ...gps, id: "c", source: "manual", points: null, meters: 10000, movingSeconds: 1000 };
    const b = bestEfforts([gps, tread, manual]);
    expect(b.map((x) => x.id)).toEqual(["1k", "5k"]);
    expect(b.every((x) => x.runId === "a")).toBe(true);
    expect(runTotals([gps, tread, manual]).longest?.id).toBe("b");
  });

  it("elevation only from reliable altitude, without phantom climbing", () => {
    const flatNoisy: TrackPoint[] = steady(300, 3).map((p, i) => [p[0], p[1], p[2], p[3], 40 + ((i * 13) % 3) - 1, 0]);
    expect(elevationGain(flatNoisy)).toBe(0);
    const hill: TrackPoint[] = steady(300, 3).map((p, i) => [p[0], p[1], p[2], p[3], 40 + i * 0.5, 0]);
    expect(elevationGain(hill)).toBeGreaterThan(25);
    expect(elevationGain(steady(300, 3))).toBeNull();
    expect(paceProfile(steady(300, 3)).at(-1)!.pace).toBeCloseTo(333.3, 0);
  });

  it("weekly distance includes empty weeks", () => {
    const r: RunSummary = { id: "a", kind: "outdoor", source: "manual", title: null, startedAt: "2026-10-27T07:00:00Z", movingSeconds: 1800, elapsedSeconds: 1800, meters: 5000, points: null, isSample: false };
    const w = weeklyDistance([r], 4, new Date("2026-10-30T12:00:00Z"), "UTC");
    expect(w.map((x) => x.meters)).toEqual([0, 0, 0, 5000]);
  });
});

describe("running landmarks", () => {
  it("marks the first run, the first of each distance and distance totals, in the Atlas only", async () => {
    const { runningLandmarks } = await import("./landmarks");
    const mk = (i: number, km: number, kind: "outdoor" | "treadmill" = "outdoor"): RunSummary => ({ id: `r${i}`, kind, source: "manual", title: null, startedAt: new Date(T0 + i * 86400000).toISOString(), movingSeconds: km * 330, elapsedSeconds: km * 330, meters: km * 1000, points: null, isSample: false });
    const runs = [mk(0, 3), mk(1, 5.2), mk(2, 10.5, "treadmill"), ...Array.from({ length: 4 }, (_, i) => mk(3 + i, 8))];
    const ls = runningLandmarks(runs, { timeZone: "UTC" });
    expect(ls.map((l) => [l.id, l.runId])).toEqual([
      ["run-first", "r0"],
      ["run-5k", "r1"],
      ["run-10k", "r2"],
      ["run-total-50", "r6"],
    ]);
    expect(ls.every((l) => l.category === "running" && l.summit === null)).toBe(true);
    expect(runningLandmarks([...runs].reverse(), { timeZone: "UTC" })).toEqual(ls);
    expect(runningLandmarks(runs, { timeZone: "UTC", asOf: runs[1].startedAt }).map((l) => l.id)).toEqual(["run-first", "run-5k"]);
  });
});

describe("running in Insights", () => {
  it("compares a period with the one before, pace from GPS outdoor runs only", async () => {
    const { runningPeriod } = await import("./analysis");
    const mk = (id: string, day: string, km: number, secPerKm: number, kind: "outdoor" | "treadmill" = "outdoor", source: "gps" | "manual" = "gps"): RunSummary => ({ id, kind, source, title: null, startedAt: `${day}T07:00:00Z`, movingSeconds: km * secPerKm, elapsedSeconds: km * secPerKm, meters: km * 1000, points: null, isSample: false });
    const p = { start: "2026-10-05", end: "2026-11-01", previousStart: "2026-09-07" };
    const r = runningPeriod([mk("a", "2026-10-10", 5, 300), mk("b", "2026-10-20", 10, 330), mk("t", "2026-10-21", 8, 200, "treadmill", "manual"), mk("c", "2026-09-10", 5, 360)], p, "UTC");
    expect(r.recent).toMatchObject({ runs: 3, meters: 23000, paceRuns: 2 });
    expect(r.recent.pace).toBeCloseTo((1500 + 3300) / 15, 5);
    expect(r.recent.longest?.id).toBe("b");
    expect(r.previous).toMatchObject({ runs: 1, pace: 360 });
  });
});
