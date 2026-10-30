/**
 * Run recording as a pure state machine: GPS fixes in, an honest track out.
 *
 * The browser hands over position fixes; this decides which ones are trustworthy:
 *  - fixes less accurate than MAX_ACCURACY are not recorded (they still update the GPS status);
 *  - a fix implying a speed no runner reaches (MAX_SPEED) is a GPS jump, and dropped;
 *  - a fix that moved less than the fixes' own uncertainty is standing-still jitter, and dropped,
 *    so a runner waiting at a crossing doesn't gain distance;
 *  - while paused nothing is recorded.
 * Time is kept as active segments (start → pause, resume → pause …), so the running time
 * excludes pauses while the elapsed time (start to finish) doesn't. No I/O, so it is tested
 * directly and its state can be saved to the device and restored after a reload.
 */

export type Fix = { lat: number; lng: number; t: number; accuracy: number; altitude: number | null; altitudeAccuracy: number | null };

/** A recorded point: [lat, lng, t (ms), accuracy (m), altitude (m) | null, segment]. Compact, for storage. */
export type TrackPoint = [number, number, number, number, number | null, number];

export type RunKind = "outdoor" | "treadmill";
export type RunStatus = "running" | "paused" | "finished";
export type GpsStatus = "off" | "acquiring" | "good" | "weak" | "denied" | "unavailable";

export type RunState = {
  id: string;
  ownerId: string;
  kind: RunKind;
  status: RunStatus;
  startedAt: number;
  finishedAt: number | null;
  /** active time: [start, end | null] per segment; a pause closes one, a resume opens the next */
  segments: [number, number | null][];
  points: TrackPoint[];
  distance: number;
  gps: GpsStatus;
  /** the latest fix's accuracy, accepted or not, for the status line */
  accuracy: number | null;
  /** how many fixes were dropped, and why (shown on the summary; never hidden) */
  dropped: { inaccurate: number; jump: number; still: number };
  /** the longest gap between recorded points while running, in ms (screen locked, app hidden) */
  longestGap: number;
};

export const MAX_ACCURACY = 30; // m
export const WEAK_ACCURACY = 15; // m: recorded, but shown as a weak signal
export const MAX_SPEED = 8; // m/s ≈ 2:05 /km: faster is a GPS jump, not running
export const MIN_STEP = 3; // m: below this (or the fixes' own uncertainty) is jitter
const EARTH = 6371008.8;

/** Great-circle distance in metres. */
export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const pointDistance = (a: TrackPoint, b: TrackPoint) => haversine({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });

export type RunEvent =
  | { type: "fix"; fix: Fix }
  | { type: "gps"; status: GpsStatus }
  | { type: "pause"; t: number }
  | { type: "resume"; t: number }
  | { type: "finish"; t: number };

export function startRun({ id, ownerId, kind, t }: { id: string; ownerId: string; kind: RunKind; t: number }): RunState {
  return {
    id,
    ownerId,
    kind,
    status: "running",
    startedAt: t,
    finishedAt: null,
    segments: [[t, null]],
    points: [],
    distance: 0,
    gps: kind === "outdoor" ? "acquiring" : "off",
    accuracy: null,
    dropped: { inaccurate: 0, jump: 0, still: 0 },
    longestGap: 0,
  };
}

export type FixVerdict = "accepted" | "inaccurate" | "jump" | "still" | "paused" | "stale";

/** Whether a fix should be recorded after `prev` (the last recorded point of the current segment). */
export function judgeFix(prev: TrackPoint | null, fix: Fix): FixVerdict {
  if (!(fix.accuracy <= MAX_ACCURACY)) return "inaccurate";
  if (!prev) return "accepted";
  const dt = (fix.t - prev[2]) / 1000;
  if (dt <= 0) return "stale";
  const d = haversine({ lat: prev[0], lng: prev[1] }, fix);
  if (d / dt > MAX_SPEED) return "jump";
  if (d < Math.max(MIN_STEP, (fix.accuracy + prev[3]) / 4)) return "still";
  return "accepted";
}

export function runReducer(s: RunState, e: RunEvent): RunState {
  if (s.status === "finished") return s;
  switch (e.type) {
    case "gps":
      return s.gps === e.status ? s : { ...s, gps: e.status };
    case "pause":
      if (s.status !== "running") return s;
      return { ...s, status: "paused", segments: s.segments.map((x, i) => (i === s.segments.length - 1 ? [x[0], Math.max(x[0], e.t)] : x)) };
    case "resume":
      if (s.status !== "paused") return s;
      return { ...s, status: "running", segments: [...s.segments, [e.t, null]] };
    case "finish": {
      const closed = s.segments.map((x, i): [number, number | null] => (i === s.segments.length - 1 && x[1] == null ? [x[0], Math.max(x[0], e.t)] : x));
      return { ...s, status: "finished", finishedAt: Math.max(s.startedAt, e.t), segments: closed };
    }
    case "fix": {
      if (s.kind !== "outdoor") return s;
      const f = e.fix;
      const gps: GpsStatus = f.accuracy <= WEAK_ACCURACY ? "good" : "weak";
      const seg = s.segments.length - 1;
      if (s.status !== "running") return { ...s, gps, accuracy: f.accuracy };
      const last = s.points.at(-1) ?? null;
      const prev = last && last[5] === seg ? last : null;
      const verdict = judgeFix(prev, f);
      if (verdict === "stale") return s;
      if (verdict !== "accepted") {
        const key = verdict === "inaccurate" ? "inaccurate" : verdict === "jump" ? "jump" : "still";
        return { ...s, gps: verdict === "inaccurate" ? "weak" : gps, accuracy: f.accuracy, dropped: { ...s.dropped, [key]: s.dropped[key] + 1 } };
      }
      const point: TrackPoint = [round(f.lat, 6), round(f.lng, 6), Math.round(f.t), Math.round(f.accuracy * 10) / 10, f.altitude == null || (f.altitudeAccuracy ?? 99) > 15 ? null : Math.round(f.altitude * 10) / 10, seg];
      const add = prev ? pointDistance(prev, point) : 0;
      const gap = prev ? point[2] - prev[2] : 0;
      return { ...s, gps, accuracy: f.accuracy, points: [...s.points, point], distance: s.distance + add, longestGap: Math.max(s.longestGap, gap) };
    }
  }
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Active (unpaused) time in ms at `now`. */
export function activeTime(s: Pick<RunState, "segments">, now: number) {
  return s.segments.reduce((n, [a, b]) => n + Math.max(0, (b ?? now) - a), 0);
}

/**
 * Time actually moving, in ms: between consecutive recorded points of a segment, counted when the
 * runner covered ground at a running or walking pace (≥ 0.5 m/s). Standing still drops out.
 */
export function movingTime(points: TrackPoint[]) {
  let ms = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a[5] !== b[5]) continue;
    const dt = b[2] - a[2];
    if (dt > 0 && pointDistance(a, b) / (dt / 1000) >= 0.5) ms += dt;
  }
  return ms;
}

/** Pace over the last `window` ms of recorded points, in seconds per km; null until it means something. */
export function currentPace(points: TrackPoint[], now: number, window = 30000) {
  const recent = [];
  for (let i = points.length - 1; i >= 0; i--) {
    if (now - points[i][2] > window || (recent.length && points[i][5] !== recent[0][5])) break;
    recent.unshift(points[i]);
  }
  if (recent.length < 2) return null;
  let d = 0;
  for (let i = 1; i < recent.length; i++) d += pointDistance(recent[i - 1], recent[i]);
  const t = (recent.at(-1)![2] - recent[0][2]) / 1000;
  return d >= 20 && t > 0 ? t / (d / 1000) : null;
}

/** Seconds per km, or null for no distance. */
export const paceOf = (seconds: number, meters: number) => (meters >= 10 ? seconds / (meters / 1000) : null);

/** "5:55" from seconds per km. */
export function formatPace(secondsPerKm: number | null) {
  if (secondsPerKm == null || !Number.isFinite(secondsPerKm)) return "–:––";
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "6.09" km. */
export const formatKm = (meters: number) => (meters / 1000).toFixed(meters < 100000 ? 2 : 1);

/** "36m 7s", "1h 04m" */
export function formatRunTime(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${sec}s`;
}

/** "36:07" / "1:04:12", for the live clock. */
export function formatClockTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** The row saved to the server: what was measured, nothing more. */
export function toRow(s: RunState, opts: { title: string | null; distanceOverride?: number | null }) {
  const finished = s.finishedAt ?? Date.now();
  const elapsed = Math.round((finished - s.startedAt) / 1000);
  const gps = s.kind === "outdoor" && s.points.length >= 2;
  const active = Math.round(activeTime(s, finished) / 1000);
  const moving = gps ? Math.min(active, Math.round(movingTime(s.points) / 1000)) : active;
  const distance = gps ? s.distance : Math.max(0, opts.distanceOverride ?? 0);
  return {
    id: s.id,
    kind: s.kind,
    source: gps ? ("gps" as const) : ("manual" as const),
    title: opts.title?.trim().slice(0, 80) || null,
    started_at: new Date(s.startedAt).toISOString(),
    ended_at: new Date(finished).toISOString(),
    elapsed_seconds: elapsed,
    moving_seconds: Math.min(moving, elapsed),
    distance_m: Math.round(distance * 10) / 10,
    route: gps ? { v: 1, points: s.points } : null,
  };
}
