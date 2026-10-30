/**
 * What a recorded route says, derived at read time: splits, a pace profile, best efforts and
 * elevation. Only measured points are used; nothing is interpolated beyond the split boundary
 * between two recorded points, and nothing is claimed where the data can't support it.
 */

import { addDays, dayKey, weekStart } from "@/lib/dates";
import { pointDistance, type TrackPoint } from "./recorder";

/** Cumulative distance (m) and active time (s) at each point; pauses add no time. */
export function cumulative(points: TrackPoint[]) {
  const dist = new Float64Array(points.length);
  const time = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const same = a[5] === b[5];
    dist[i] = dist[i - 1] + (same ? pointDistance(a, b) : 0);
    time[i] = time[i - 1] + (same ? (b[2] - a[2]) / 1000 : 0);
  }
  return { dist, time };
}

export type Split = {
  index: number;
  /** metres covered in this split (the last one may be partial) */
  meters: number;
  seconds: number;
  pace: number;
  /** point range on the route: [from, to] */
  from: number;
  to: number;
  /** change in altitude, when altitude is reliable */
  climb: number | null;
};

/** Per-kilometre splits (or per `every` metres). The final split may be partial; under 50 m it is dropped. */
export function splits(points: TrackPoint[], every = 1000): Split[] {
  if (points.length < 2) return [];
  const { dist, time } = cumulative(points);
  const out: Split[] = [];
  let startIdx = 0;
  let startD = 0;
  let startT = 0;
  for (let i = 1; i < points.length; i++) {
    while (dist[i] - startD >= every) {
      // the boundary falls between points i-1 and i: interpolate its time along that step
      const target = startD + every;
      const f = (target - dist[i - 1]) / Math.max(1e-9, dist[i] - dist[i - 1]);
      const t = time[i - 1] + f * (time[i] - time[i - 1]);
      out.push({ index: out.length, meters: every, seconds: t - startT, pace: (t - startT) / (every / 1000), from: startIdx, to: i, climb: climbBetween(points, startIdx, i) });
      startIdx = i - 1;
      startD = target;
      startT = t;
    }
  }
  const restM = dist[points.length - 1] - startD;
  const restT = time[points.length - 1] - startT;
  if (restM >= 50) out.push({ index: out.length, meters: restM, seconds: restT, pace: restT / (restM / 1000), from: startIdx, to: points.length - 1, climb: climbBetween(points, startIdx, points.length - 1) });
  return out;
}

/** A gap longer than this between two points means the route there is a guess: no best effort spans it. */
export const MAX_EFFORT_GAP = 30000;

/**
 * The fastest stretch of at least `meters`, measured on recorded points only (no interpolation
 * past the ends, so it can only be slower than the truth, never faster). Null when the route is
 * shorter, or every candidate crosses a gap or a pause.
 */
export function bestEffort(points: TrackPoint[], meters: number): { seconds: number; from: number; to: number } | null {
  if (points.length < 2) return null;
  const { dist, time } = cumulative(points);
  if (dist[points.length - 1] < meters) return null;
  let best: { seconds: number; from: number; to: number } | null = null;
  let lo = 0;
  for (let hi = 1; hi < points.length; hi++) {
    // a pause or a long gap breaks the stretch: start again after it
    if (points[hi][5] !== points[hi - 1][5] || points[hi][2] - points[hi - 1][2] > MAX_EFFORT_GAP) {
      lo = hi;
      continue;
    }
    while (lo < hi && dist[hi] - dist[lo + 1] >= meters) lo++;
    if (dist[hi] - dist[lo] >= meters) {
      const seconds = time[hi] - time[lo];
      if (!best || seconds < best.seconds) best = { seconds, from: lo, to: hi };
    }
  }
  return best;
}

/** The standard distances best efforts are kept for. */
export const EFFORTS = [
  { id: "1k", label: "1 km", meters: 1000 },
  { id: "5k", label: "5 km", meters: 5000 },
  { id: "10k", label: "10 km", meters: 10000 },
  { id: "half", label: "Half marathon", meters: 21097.5 },
  { id: "marathon", label: "Marathon", meters: 42195 },
] as const;

/** Best pace: the fastest 400 m, the shortest stretch GPS measures reliably. */
export function bestPace(points: TrackPoint[]) {
  const e = bestEffort(points, 400);
  return e ? e.seconds / 0.4 : null;
}

/**
 * Elevation gain from the device's altitude, only when most points carry a reliable one
 * (the recorder keeps altitude only within 15 m accuracy). Smoothed, and counted in steps of
 * 3 m, so GPS noise doesn't add phantom climbing. Null when the data isn't there.
 */
export function elevationGain(points: TrackPoint[]) {
  const alts = points.map((p) => p[4]);
  const known = alts.filter((a) => a != null).length;
  if (points.length < 10 || known / points.length < 0.8) return null;
  const filled: number[] = [];
  let last = alts.find((a) => a != null)!;
  for (const a of alts) filled.push((last = a ?? last));
  const smooth = filled.map((_, i) => {
    const w = filled.slice(Math.max(0, i - 2), i + 3);
    return w.reduce((n, x) => n + x, 0) / w.length;
  });
  let gain = 0;
  let base = smooth[0];
  for (const a of smooth) {
    if (a - base >= 3) {
      gain += a - base;
      base = a;
    } else if (a < base) base = a;
  }
  return Math.round(gain);
}

function climbBetween(points: TrackPoint[], from: number, to: number) {
  const a = points[from][4];
  const b = points[to][4];
  return a == null || b == null ? null : Math.round(b - a);
}

/** Pace along the route for a chart: [km, seconds per km] over a trailing 200 m window. */
export function paceProfile(points: TrackPoint[], window = 200) {
  const { dist, time } = cumulative(points);
  const out: { km: number; pace: number; index: number }[] = [];
  let lo = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i][5] !== points[i - 1][5]) {
      lo = i;
      continue;
    }
    while (lo < i && dist[i] - dist[lo] > window) lo++;
    const d = dist[i] - dist[Math.max(0, lo - 1)];
    const t = time[i] - time[Math.max(0, lo - 1)];
    if (d >= window * 0.6 && t > 0) out.push({ km: dist[i] / 1000, pace: t / (d / 1000), index: i });
  }
  return out;
}

// ── across runs ──────────────────────────────────────────────────────────────────────────

export type RunSummary = {
  id: string;
  kind: "outdoor" | "treadmill";
  source: "gps" | "manual";
  title: string | null;
  startedAt: string;
  movingSeconds: number;
  elapsedSeconds: number;
  meters: number;
  points: TrackPoint[] | null;
  isSample: boolean;
};

export type BestEffortRecord = { id: string; label: string; meters: number; seconds: number; runId: string; at: string };

/**
 * Best efforts across runs, from GPS-recorded outdoor runs only: a treadmill's or a hand-logged
 * distance can't be checked the same way, so it never competes with a measured one.
 */
export function bestEfforts(runs: RunSummary[]): BestEffortRecord[] {
  return EFFORTS.flatMap((e) => {
    let best: BestEffortRecord | null = null;
    for (const r of runs) {
      if (r.kind !== "outdoor" || r.source !== "gps" || !r.points || r.meters < e.meters) continue;
      const b = bestEffort(r.points, e.meters);
      if (b && (!best || b.seconds < best.seconds)) best = { id: e.id, label: e.label, meters: e.meters, seconds: b.seconds, runId: r.id, at: r.startedAt };
    }
    return best ? [best] : [];
  });
}

/** Distance and runs per Monday-aligned week, from `weeks` weeks ago to this week, empty weeks included. */
export function weeklyDistance(runs: RunSummary[], weeks: number, now: Date, timeZone: string) {
  const thisWeek = weekStart(dayKey(now, timeZone));
  const list = Array.from({ length: weeks }, (_, i) => ({ week: addDays(thisWeek, -7 * (weeks - 1 - i)), meters: 0, runs: 0, seconds: 0 }));
  const by = new Map(list.map((w) => [w.week, w]));
  for (const r of runs) {
    const w = by.get(weekStart(dayKey(r.startedAt, timeZone)));
    if (!w) continue;
    w.meters += r.meters;
    w.runs++;
    w.seconds += r.movingSeconds;
  }
  return list;
}

/** Distance per calendar month (viewer's timezone), newest first. */
export function monthlyDistance(runs: RunSummary[], timeZone: string) {
  const key = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone });
  const map = new Map<string, { month: string; meters: number; runs: number }>();
  for (const r of runs) {
    const k = key.format(new Date(r.startedAt));
    const m = map.get(k) ?? { month: k, meters: 0, runs: 0 };
    m.meters += r.meters;
    m.runs++;
    map.set(k, m);
  }
  return [...map.values()].sort((a, b) => b.month.localeCompare(a.month));
}

export function runTotals(runs: RunSummary[]) {
  const longest = runs.reduce<RunSummary | null>((m, r) => (!m || r.meters > m.meters ? r : m), null);
  return {
    runs: runs.length,
    meters: runs.reduce((n, r) => n + r.meters, 0),
    seconds: runs.reduce((n, r) => n + r.movingSeconds, 0),
    longest: longest && longest.meters > 0 ? longest : null,
  };
}

/**
 * Running over a recent window against the window before (day keys, as Insights' periods).
 * Pace is compared from GPS outdoor runs only; treadmill paces aren't measured the same way.
 */
export function runningPeriod(runs: RunSummary[], p: { start: string; end: string; previousStart: string }, timeZone: string) {
  const day = (r: RunSummary) => dayKey(r.startedAt, timeZone);
  const sum = (list: RunSummary[]) => {
    const gps = list.filter((r) => r.kind === "outdoor" && r.source === "gps" && r.meters >= 1000);
    const gpsMeters = gps.reduce((n, r) => n + r.meters, 0);
    return {
      runs: list.length,
      meters: list.reduce((n, r) => n + r.meters, 0),
      seconds: list.reduce((n, r) => n + r.movingSeconds, 0),
      longest: list.reduce<RunSummary | null>((m, r) => (!m || r.meters > m.meters ? r : m), null),
      // distance-weighted: total GPS moving time over total GPS distance
      pace: gps.length ? gps.reduce((n, r) => n + r.movingSeconds, 0) / (gpsMeters / 1000) : null,
      paceRuns: gps.length,
    };
  };
  return {
    recent: sum(runs.filter((r) => day(r) >= p.start && day(r) <= p.end)),
    previous: sum(runs.filter((r) => day(r) >= p.previousStart && day(r) < p.start)),
  };
}
