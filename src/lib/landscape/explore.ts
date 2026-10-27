/**
 * Pure data logic behind the Training Landscape screen: time windows, filters and
 * summaries over persisted sessions. No React, no I/O, so it is unit-tested directly.
 */

import { addDays, dayKey, weekStart } from "@/lib/dates";
import type { LandscapeSession } from "./terrain";
import type { WorldSession } from "./world";

export type RecordKind = "heaviest_weight" | "most_reps" | "estimated_1rm";

export type ExploreSet = { id: string; position: number; weight: number | null; reps: number | null; completed: boolean };

export type ExploreExercise = {
  id: string;
  exerciseId: string;
  name: string;
  position: number;
  sets: ExploreSet[];
};

export type ExploreRecord = {
  exerciseId: string;
  setId: string;
  kind: RecordKind;
  value: number;
  weight: number | null;
  reps: number | null;
  isBaseline: boolean;
};

export type ExploreSession = {
  id: string;
  templateId: string | null;
  templateName: string;
  startedAt: string;
  endedAt: string;
  totalVolume: number;
  completedSets: number;
  isSample: boolean;
  exercises: ExploreExercise[];
  records: ExploreRecord[];
};

export const RANGES = [
  { id: "4w", label: "Last 4 weeks", weeks: 4 },
  { id: "12w", label: "Last 12 weeks", weeks: 12 },
  { id: "26w", label: "Last 6 months", weeks: 26 },
  { id: "52w", label: "Last 12 months", weeks: 52 },
  { id: "all", label: "All time", weeks: null },
] as const;

export type RangeId = (typeof RANGES)[number]["id"];

export function parseRange(value: unknown): RangeId {
  return RANGES.some((r) => r.id === value) ? (value as RangeId) : "12w";
}

export type Week = { key: string; index: number; start: string; end: string; label: string };

export type Window = { start: string; end: string; weeks: Week[] };

/**
 * Monday-aligned weeks ending with the current week, in the viewer's timezone.
 * "all" starts at the week of the earliest session (at least 4 weeks).
 */
export function buildWindow(range: RangeId, now: Date, timeZone: string, earliest?: string | null): Window {
  const today = dayKey(now, timeZone);
  const thisWeek = weekStart(today);
  const spec = RANGES.find((r) => r.id === range)!;
  let count: number = spec.weeks ?? 4;
  if (spec.weeks == null && earliest) {
    const first = weekStart(dayKey(earliest, timeZone));
    const diff = Math.round((Date.parse(`${thisWeek}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / (7 * 86400000));
    count = Math.max(4, diff + 1);
  }
  const firstWeek = addDays(thisWeek, -7 * (count - 1));
  const weeks: Week[] = Array.from({ length: count }, (_, i) => {
    const key = addDays(firstWeek, 7 * i);
    return {
      key,
      index: i,
      start: key,
      end: addDays(key, 6),
      label: new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    };
  });
  return { start: `${firstWeek}T00:00:00Z`, end: now.toISOString(), weeks };
}

export function weekOfSession(session: Pick<ExploreSession, "endedAt">, weeks: Week[], timeZone: string): Week | undefined {
  const k = weekStart(dayKey(session.endedAt, timeZone));
  return weeks.find((w) => w.key === k);
}

export type Filters = { templateId: string | null; exerciseId: string | null };

const templateKey = (s: ExploreSession) => s.templateId ?? `name:${s.templateName}`;

export function filterSessions(sessions: ExploreSession[], f: Filters): ExploreSession[] {
  return sessions.filter(
    (s) =>
      (!f.templateId || templateKey(s) === f.templateId) &&
      (!f.exerciseId || s.exercises.some((e) => e.exerciseId === f.exerciseId && e.sets.some((x) => x.completed))),
  );
}

/** Records worth celebrating: measured (not estimated) and not a first-ever baseline. */
export function achievedRecords(s: ExploreSession, exerciseId?: string | null) {
  return s.records.filter((r) => !r.isBaseline && r.kind !== "estimated_1rm" && (!exerciseId || r.exerciseId === exerciseId));
}

export function exerciseVolume(s: ExploreSession, exerciseId: string) {
  let v = 0;
  for (const e of s.exercises) {
    if (e.exerciseId !== exerciseId) continue;
    for (const x of e.sets) if (x.completed) v += (x.weight ?? 0) * (x.reps ?? 0);
  }
  return v;
}

function completedSetCount(s: ExploreSession, exerciseId: string) {
  return s.exercises.filter((e) => e.exerciseId === exerciseId).reduce((n, e) => n + e.sets.filter((x) => x.completed).length, 0);
}

/**
 * Terrain input. With an exercise selected, each hill measures that exercise alone,
 * so its ridge shows the exercise's own history rather than whole-session volume.
 */
export function toLandscapeSessions(sessions: ExploreSession[], f: Filters): LandscapeSession[] {
  return filterSessions(sessions, f).map((s) => ({
    id: s.id,
    endedAt: s.endedAt,
    templateKey: templateKey(s),
    label: s.templateName,
    volume: f.exerciseId ? exerciseVolume(s, f.exerciseId) : s.totalVolume,
    sets: f.exerciseId ? completedSetCount(s, f.exerciseId) : s.completedSets,
    prCount: achievedRecords(s, f.exerciseId).length,
  }));
}

export type Option = { id: string; label: string; count: number; group?: string };

export function templateOptions(sessions: ExploreSession[]): Option[] {
  const map = new Map<string, Option>();
  for (const s of sessions) {
    const k = templateKey(s);
    const o = map.get(k) ?? { id: k, label: s.templateName, count: 0 };
    o.count++;
    map.set(k, o);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function exerciseOptions(sessions: ExploreSession[], muscles: Record<string, string> = {}): Option[] {
  const map = new Map<string, Option>();
  for (const s of sessions)
    for (const e of s.exercises) {
      if (!e.sets.some((x) => x.completed)) continue;
      const o = map.get(e.exerciseId) ?? { id: e.exerciseId, label: e.name, count: 0, group: muscles[e.exerciseId] };
      o.count++;
      map.set(e.exerciseId, o);
    }
  return [...map.values()].sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.label.localeCompare(b.label));
}

export type Summary = {
  sessions: number;
  volume: number;
  sets: number;
  records: { session: ExploreSession; record: ExploreRecord; exerciseName: string }[];
};

export function summarize(sessions: ExploreSession[], f: Filters): Summary {
  const list = filterSessions(sessions, f);
  const records: Summary["records"] = [];
  for (const s of list)
    for (const r of achievedRecords(s, f.exerciseId)) {
      const name = s.exercises.find((e) => e.exerciseId === r.exerciseId)?.name ?? "Exercise";
      records.push({ session: s, record: r, exerciseName: name });
    }
  records.sort((a, b) => b.session.endedAt.localeCompare(a.session.endedAt));
  return {
    sessions: list.length,
    volume: list.reduce((v, s) => v + (f.exerciseId ? exerciseVolume(s, f.exerciseId) : s.totalVolume), 0),
    sets: list.reduce((n, s) => n + (f.exerciseId ? completedSetCount(s, f.exerciseId) : s.completedSets), 0),
    records,
  };
}

/** Week-by-week totals for the strip navigator. */
export function weeklyTotals(sessions: ExploreSession[], weeks: Week[], timeZone: string, f: Filters) {
  const totals = new Map(weeks.map((w) => [w.key, { sessions: 0, volume: 0, records: 0 }]));
  for (const s of filterSessions(sessions, f)) {
    const w = weekOfSession(s, weeks, timeZone);
    if (!w) continue;
    const t = totals.get(w.key)!;
    t.sessions++;
    t.volume += f.exerciseId ? exerciseVolume(s, f.exerciseId) : s.totalVolume;
    t.records += achievedRecords(s, f.exerciseId).length;
  }
  return totals;
}

/** Factual exercise stats. Estimates are kept apart from measurements by name. */
export function exerciseStats(sessions: ExploreSession[], exerciseId: string) {
  let heaviest: { weight: number; reps: number; session: ExploreSession } | null = null;
  let mostReps: { reps: number; session: ExploreSession } | null = null;
  let bestEstimate: { value: number; session: ExploreSession } | null = null;
  let latest: { sets: ExploreSet[]; session: ExploreSession } | null = null;
  for (const s of [...sessions].sort((a, b) => a.endedAt.localeCompare(b.endedAt))) {
    const sets = s.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter((x) => x.completed));
    if (!sets.length) continue;
    latest = { sets, session: s };
    for (const x of sets) {
      if (
        x.weight != null &&
        x.reps &&
        (!heaviest || x.weight > heaviest.weight || (x.weight === heaviest.weight && x.reps > heaviest.reps))
      )
        heaviest = { weight: x.weight, reps: x.reps, session: s };
      if (x.reps && (!mostReps || x.reps > mostReps.reps)) mostReps = { reps: x.reps, session: s };
    }
    for (const r of s.records)
      if (r.exerciseId === exerciseId && r.kind === "estimated_1rm" && (!bestEstimate || r.value > bestEstimate.value))
        bestEstimate = { value: r.value, session: s };
  }
  return { heaviest, mostReps, bestEstimate, latest };
}

export type RegionSummary = {
  key: string;
  name: string;
  workouts: number;
  records: number;
  /** average session volume, later third vs earlier third of the period; null if too few */
  volumeTrend: number | null;
  recent: { session: ExploreSession; topSet: { exercise: string; weight: number | null; reps: number | null } | null; record: boolean }[];
  /** measured records in this routine, newest first */
  prs: { session: ExploreSession; record: ExploreRecord; exerciseName: string }[];
  /** the routine's main lift, climbing: each step a new best weight, first session to today's PR */
  trail: LiftTrail | null;
};

export type LiftTrail = {
  exerciseName: string;
  steps: { weight: number; reps: number | null; endedAt: string; sessionId: string }[];
};

type LiftSession = Pick<WorldSession, "id" | "endedAt" | "lifts">;

/** A session's heaviest completed set per weighted exercise, in the form trails are built from. */
export function sessionLifts(s: ExploreSession): LiftSession {
  return {
    id: s.id,
    endedAt: s.endedAt,
    lifts: s.exercises.flatMap((e) => {
      let best: ExploreSet | null = null;
      for (const x of e.sets) if (x.completed && (x.weight ?? 0) > (best?.weight ?? 0)) best = x;
      return best?.weight ? [{ exerciseId: e.exerciseId, name: e.name, weight: best.weight, reps: best.reps }] : [];
    }),
  };
}

/**
 * The climb of a routine's main lift (the weighted exercise it trains most): the first session's
 * best set, then every session that beat the best so far. Null when there is no climb to show.
 */
export function liftTrail(sessions: LiftSession[]): LiftTrail | null {
  const ordered = [...sessions].sort((a, b) => a.endedAt.localeCompare(b.endedAt));
  const seen = new Map<string, { name: string; sessions: number; top: number }>();
  for (const s of ordered)
    for (const l of s.lifts ?? []) {
      const c = seen.get(l.exerciseId) ?? { name: l.name, sessions: 0, top: 0 };
      c.sessions++;
      c.top = Math.max(c.top, l.weight);
      seen.set(l.exerciseId, c);
    }
  const main = [...seen.entries()].sort((a, b) => b[1].sessions - a[1].sessions || b[1].top - a[1].top)[0];
  if (!main) return null;
  const steps: LiftTrail["steps"] = [];
  for (const s of ordered)
    for (const l of s.lifts ?? [])
      if (l.exerciseId === main[0] && l.weight > (steps.at(-1)?.weight ?? 0))
        steps.push({ weight: l.weight, reps: l.reps, endedAt: s.endedAt, sessionId: s.id });
  return steps.length >= 2 ? { exerciseName: main[1].name, steps } : null;
}

/** Factual per-routine figures for the region callouts and panel. */
export function regionSummaries(sessions: ExploreSession[], history?: WorldSession[]): RegionSummary[] {
  const groups = new Map<string, ExploreSession[]>();
  for (const s of sessions) {
    const k = s.templateId ?? `name:${s.templateName}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return [...groups.entries()].map(([key, list]) => {
    const ordered = [...list].sort((a, b) => a.endedAt.localeCompare(b.endedAt));
    const third = Math.floor(ordered.length / 3);
    const avg = (xs: ExploreSession[]) => xs.reduce((v, s) => v + s.totalVolume, 0) / Math.max(1, xs.length);
    const early = avg(ordered.slice(0, third));
    const late = avg(ordered.slice(-third));
    const recent = [...ordered]
      .reverse()
      .slice(0, 3)
      .map((s) => {
        let top: { exercise: string; weight: number | null; reps: number | null } | null = null;
        for (const e of s.exercises)
          for (const x of e.sets)
            if (x.completed && (!top || (x.weight ?? 0) > (top.weight ?? 0))) top = { exercise: e.name, weight: x.weight, reps: x.reps };
        return { session: s, topSet: top, record: achievedRecords(s).length > 0 };
      });
    const prs = [...ordered].reverse().flatMap((s) =>
      achievedRecords(s).map((record) => ({
        session: s,
        record,
        exerciseName: s.exercises.find((e) => e.exerciseId === record.exerciseId)?.name ?? "Exercise",
      })),
    );
    return {
      key,
      name: ordered[0].templateName,
      prs,
      // the trail runs over the whole history when it's known, so its foot is the very first session
      trail: liftTrail(history ? history.filter((h) => h.templateKey === key) : ordered.map(sessionLifts)),
      workouts: list.length,
      records: list.reduce((n, s) => n + achievedRecords(s).length, 0),
      volumeTrend: third >= 2 && early > 0 ? Math.round(((late - early) / early) * 100) : null,
      recent,
    };
  });
}
