/**
 * Training Insights: factual observations from recorded training, nothing else.
 *
 * Every figure is calculated from persisted sessions and their completed sets. There is no
 * model, no advice and no score. Where the data is too thin to say something honestly, the
 * result says so (`insufficient`) instead of inventing an observation.
 *
 * Conventions
 *  - Weeks are Monday-aligned in the viewer's timezone. A window of N weeks ends with the current
 *    week; the comparison window is the N weeks before it.
 *  - An exercise is compared only with itself: variations have their own ids (an incline press is
 *    not a bench press), so equipment and variation differences never mix.
 *  - Sets count toward the exercise's one primary muscle. The exercise model has no weighting for
 *    secondary muscles, so compound lifts are never counted twice.
 *  - Measured values (heaviest weight, most reps) and estimates (Epley e1RM) stay apart, and
 *    estimates are always labelled as such by the presentation.
 */

import { addDays, dayKey, weekStart } from "@/lib/dates";
import { epley } from "@/lib/exercise-progress";
import type { Measure } from "@/lib/workout/types";

export type InsightSet = { weight: number | null; reps: number | null };

export type InsightExercise = {
  exerciseId: string;
  name: string;
  muscle: string;
  measure: Measure;
  /** completed sets only */
  sets: InsightSet[];
};

export type InsightRecord = {
  exerciseId: string;
  name: string;
  kind: "heaviest_weight" | "most_reps" | "estimated_1rm";
  weight: number | null;
  reps: number | null;
  value: number;
  isBaseline: boolean;
};

export type InsightSession = {
  id: string;
  endedAt: string;
  routine: string;
  isSample: boolean;
  exercises: InsightExercise[];
  records: InsightRecord[];
};

export const WINDOWS = [
  { id: "4w", weeks: 4, label: "4 weeks" },
  { id: "8w", weeks: 8, label: "8 weeks" },
  { id: "12w", weeks: 12, label: "12 weeks" },
] as const;
export type WindowId = (typeof WINDOWS)[number]["id"];
export const parseWindow = (v: unknown): WindowId => (WINDOWS.some((w) => w.id === v) ? (v as WindowId) : "8w");

export type Period = { weeks: number; start: string; end: string; previousStart: string };

/** The recent window (ending with this week) and the equal window before it, as day keys. */
export function periodFor(weeks: number, now: Date, timeZone: string): Period {
  const thisWeek = weekStart(dayKey(now, timeZone));
  const start = addDays(thisWeek, -7 * (weeks - 1));
  return { weeks, start, end: addDays(thisWeek, 6), previousStart: addDays(start, -7 * weeks) };
}

const dayOf = (s: Pick<InsightSession, "endedAt">, tz: string) => dayKey(s.endedAt, tz);
const inRecent = (s: InsightSession, p: Period, tz: string) => {
  const d = dayOf(s, tz);
  return d >= p.start && d <= p.end;
};
const inPrevious = (s: InsightSession, p: Period, tz: string) => {
  const d = dayOf(s, tz);
  return d >= p.previousStart && d < p.start;
};

const valid = (x: InsightSet) => (x.reps ?? 0) > 0;
const ordered = (sessions: InsightSession[]) => {
  const seen = new Set<string>();
  return [...sessions]
    .filter((s) => !seen.has(s.id) && seen.add(s.id))
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt) || a.id.localeCompare(b.id));
};

// ── per-exercise session summaries ───────────────────────────────────────────────────────

export type ExerciseDay = {
  sessionId: string;
  endedAt: string;
  topWeight: number | null;
  topReps: number;
  bestReps: number;
  e1rm: number | null;
  volume: number;
  sets: number;
  /** most reps at each weight performed, for comparisons at the same weight */
  repsAt: Map<number, number>;
};

export type ExerciseHistory = { exerciseId: string; name: string; muscle: string; measure: Measure; days: ExerciseDay[] };

/** Every exercise's sessions, oldest first. An exercise done twice in one session counts once. */
export function exerciseHistories(sessions: InsightSession[]): ExerciseHistory[] {
  const map = new Map<string, ExerciseHistory>();
  for (const s of ordered(sessions)) {
    const merged = new Map<string, InsightExercise>();
    for (const e of s.exercises) {
      const m = merged.get(e.exerciseId);
      merged.set(e.exerciseId, m ? { ...m, sets: [...m.sets, ...e.sets] } : e);
    }
    for (const e of merged.values()) {
      const sets = e.sets.filter(valid);
      if (!sets.length) continue;
      let topWeight: number | null = null;
      let topReps = 0;
      let bestReps = 0;
      let e1rm: number | null = null;
      let volume = 0;
      const repsAt = new Map<number, number>();
      for (const x of sets) {
        const reps = x.reps ?? 0;
        bestReps = Math.max(bestReps, reps);
        const w = x.weight ?? 0;
        if (e.measure === "weight_reps" && w > 0) {
          volume += w * reps;
          repsAt.set(w, Math.max(repsAt.get(w) ?? 0, reps));
          if (topWeight == null || w > topWeight || (w === topWeight && reps > topReps)) {
            topWeight = w;
            topReps = reps;
          }
          const est = epley(w, reps);
          if (est != null && (e1rm == null || est > e1rm)) e1rm = est;
        }
      }
      if (e.measure === "weight_reps" && topWeight == null) continue; // a weighted lift with no load logged
      const h = map.get(e.exerciseId) ?? { exerciseId: e.exerciseId, name: e.name, muscle: e.muscle, measure: e.measure, days: [] };
      h.name = e.name; // the latest name
      h.days.push({ sessionId: s.id, endedAt: s.endedAt, topWeight, topReps, bestReps, e1rm, volume, sets: sets.length, repsAt });
      map.set(e.exerciseId, h);
    }
  }
  return [...map.values()];
}

// ── A. progression ───────────────────────────────────────────────────────────────────────

export type Progress = {
  exerciseId: string;
  name: string;
  measure: Measure;
  /** what moved: the heaviest set, reps at the same weight, or (bodyweight) the most reps */
  basis: "top_weight" | "reps_at_weight" | "reps";
  from: number;
  to: number;
  /** for reps at weight: the weight compared at */
  atWeight: number | null;
  /** relative change of the basis value */
  change: number;
  /** best estimated 1RM in each window (an estimate, labelled as one) */
  estimate: { from: number; to: number } | null;
  sessions: { recent: number; previous: number };
  /** the session in the recent window with the best set */
  sessionId: string;
  /** recent and previous days, for a small chart */
  days: ExerciseDay[];
};

/** Minimum sessions in each window before two windows are compared. */
export const MIN_PER_WINDOW = 2;

/**
 * Exercises with measurable progress: the recent window's best against the previous window's.
 * Needs at least MIN_PER_WINDOW sessions in each window; otherwise nothing is claimed.
 */
export function progression(sessions: InsightSession[], p: Period, timeZone: string): Progress[] {
  const out: Progress[] = [];
  const recentIds = new Set(sessions.filter((s) => inRecent(s, p, timeZone)).map((s) => s.id));
  const prevIds = new Set(sessions.filter((s) => inPrevious(s, p, timeZone)).map((s) => s.id));
  for (const h of exerciseHistories(sessions)) {
    const recent = h.days.filter((d) => recentIds.has(d.sessionId));
    const previous = h.days.filter((d) => prevIds.has(d.sessionId));
    if (recent.length < MIN_PER_WINDOW || previous.length < MIN_PER_WINDOW) continue;
    const base = { exerciseId: h.exerciseId, name: h.name, measure: h.measure, sessions: { recent: recent.length, previous: previous.length }, days: [...previous, ...recent] };
    if (h.measure === "bodyweight_reps") {
      const a = Math.max(...previous.map((d) => d.bestReps));
      const b = Math.max(...recent.map((d) => d.bestReps));
      if (b > a)
        out.push({ ...base, basis: "reps", from: a, to: b, atWeight: null, change: (b - a) / a, estimate: null, sessionId: recent.find((d) => d.bestReps === b)!.sessionId });
      continue;
    }
    const a = Math.max(...previous.map((d) => d.topWeight ?? 0));
    const b = Math.max(...recent.map((d) => d.topWeight ?? 0));
    const ea = Math.max(0, ...previous.map((d) => d.e1rm ?? 0));
    const eb = Math.max(0, ...recent.map((d) => d.e1rm ?? 0));
    const estimate = ea > 0 && eb > 0 ? { from: ea, to: eb } : null;
    if (b > a) {
      out.push({ ...base, basis: "top_weight", from: a, to: b, atWeight: null, change: (b - a) / a, estimate, sessionId: recent.find((d) => d.topWeight === b)!.sessionId });
      continue;
    }
    // the same heaviest weight, more reps: the heaviest weight both windows share
    const shared = [...new Set(previous.flatMap((d) => [...d.repsAt.keys()]))].filter((w) => recent.some((d) => d.repsAt.has(w))).sort((x, y) => y - x)[0];
    if (shared == null) continue;
    const ra = Math.max(...previous.map((d) => d.repsAt.get(shared) ?? 0));
    const rb = Math.max(...recent.map((d) => d.repsAt.get(shared) ?? 0));
    if (rb > ra)
      out.push({
        ...base,
        basis: "reps_at_weight",
        from: ra,
        to: rb,
        atWeight: shared,
        change: (rb - ra) / ra,
        estimate,
        sessionId: recent.find((d) => (d.repsAt.get(shared) ?? 0) === rb)!.sessionId,
      });
  }
  return out.sort((x, y) => y.change - x.change || x.name.localeCompare(y.name));
}

// ── B. plateaus ──────────────────────────────────────────────────────────────────────────

export type Steadiness =
  | { status: "holding"; exerciseId: string; name: string; measure: Measure; best: number; bestAt: string; bestSessionId: string; recentRange: [number, number]; recentSessions: number; since: string }
  | { status: "insufficient"; exerciseId: string; name: string; sessions: number };

/** Sessions an exercise needs before a plateau can be told apart from noise. */
export const PLATEAU_MIN_SESSIONS = 6;
/** The recent stretch judged against the baseline before it. */
export const PLATEAU_RECENT = 4;
/** …and how long that stretch must span, so a few close-together sessions aren't a plateau. */
export const PLATEAU_MIN_DAYS = 21;
/** Only exercises still being trained (last session within this many days). */
const ACTIVE_DAYS = 28;

const measureOf = (h: ExerciseHistory, d: ExerciseDay) => (h.measure === "weight_reps" ? (d.e1rm ?? d.topWeight ?? 0) : d.bestReps);

/**
 * Exercises holding steady: no session in the last PLATEAU_RECENT has beaten the best of the
 * sessions before them, over at least PLATEAU_MIN_DAYS. One off day can't make a plateau: the
 * recent stretch is judged by its best session, not its worst. Weighted lifts are judged by the
 * best estimated 1RM, so more reps at the same weight counts as progress.
 */
export function steadiness(sessions: InsightSession[], now: Date): Steadiness[] {
  const out: Steadiness[] = [];
  for (const h of exerciseHistories(sessions)) {
    const last = h.days.at(-1)!;
    if (now.getTime() - Date.parse(last.endedAt) > ACTIVE_DAYS * 86400000) continue;
    if (h.days.length < PLATEAU_MIN_SESSIONS) {
      out.push({ status: "insufficient", exerciseId: h.exerciseId, name: h.name, sessions: h.days.length });
      continue;
    }
    const recent = h.days.slice(-PLATEAU_RECENT);
    const before = h.days.slice(0, -PLATEAU_RECENT);
    const span = Date.parse(recent.at(-1)!.endedAt) - Date.parse(recent[0].endedAt);
    if (span < PLATEAU_MIN_DAYS * 86400000) continue;
    const bestBefore = before.reduce((m, d) => (measureOf(h, d) > measureOf(h, m) ? d : m), before[0]);
    const recentValues = recent.map((d) => measureOf(h, d));
    if (Math.max(...recentValues) > measureOf(h, bestBefore)) continue;
    out.push({
      status: "holding",
      exerciseId: h.exerciseId,
      name: h.name,
      measure: h.measure,
      best: measureOf(h, bestBefore),
      bestAt: bestBefore.endedAt,
      bestSessionId: bestBefore.sessionId,
      recentRange: [Math.min(...recentValues), Math.max(...recentValues)],
      recentSessions: recent.length,
      since: recent[0].endedAt,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ── C. volume and frequency ──────────────────────────────────────────────────────────────

export type WeekTotals = { week: string; sessions: number; days: number; sets: number; volume: number; setsByMuscle: Map<string, number> };

/** Totals for every week from the previous window's start to this week, empty weeks included. */
export function weeklyTotals(sessions: InsightSession[], p: Period, timeZone: string): WeekTotals[] {
  const weeks: WeekTotals[] = [];
  for (let w = p.previousStart; w <= p.end; w = addDays(w, 7)) weeks.push({ week: w, sessions: 0, days: 0, sets: 0, volume: 0, setsByMuscle: new Map() });
  const byWeek = new Map(weeks.map((w) => [w.week, w]));
  const daysSeen = new Map<string, Set<string>>();
  for (const s of ordered(sessions)) {
    const day = dayOf(s, timeZone);
    const w = byWeek.get(weekStart(day));
    if (!w) continue;
    w.sessions++;
    const seen = daysSeen.get(w.week) ?? new Set();
    seen.add(day);
    daysSeen.set(w.week, seen);
    w.days = seen.size;
    for (const e of s.exercises) {
      const sets = e.sets.filter(valid);
      w.sets += sets.length;
      w.setsByMuscle.set(e.muscle, (w.setsByMuscle.get(e.muscle) ?? 0) + sets.length);
      if (e.measure === "weight_reps") for (const x of sets) w.volume += (x.weight ?? 0) * (x.reps ?? 0);
    }
  }
  return weeks;
}

export type MuscleVolume = { muscle: string; recent: number; previous: number };

/** Average weekly sets per primary muscle, recent window against the one before. */
export function muscleVolume(weeks: WeekTotals[], p: Period): MuscleVolume[] {
  const recent = weeks.filter((w) => w.week >= p.start);
  const previous = weeks.filter((w) => w.week < p.start);
  const muscles = new Set(weeks.flatMap((w) => [...w.setsByMuscle.keys()]));
  const avg = (list: WeekTotals[], m: string) => (list.length ? list.reduce((n, w) => n + (w.setsByMuscle.get(m) ?? 0), 0) / list.length : 0);
  return [...muscles]
    .map((m) => ({ muscle: m, recent: avg(recent, m), previous: avg(previous, m) }))
    .filter((m) => m.recent > 0 || m.previous > 0)
    .sort((a, b) => b.recent - a.recent || b.previous - a.previous || a.muscle.localeCompare(b.muscle));
}

export type Frequency = { recent: { sessionsPerWeek: number; daysPerWeek: number; sets: number; volume: number }; previous: { sessionsPerWeek: number; daysPerWeek: number; sets: number; volume: number } };

export function frequency(weeks: WeekTotals[], p: Period): Frequency {
  const sum = (list: WeekTotals[]) => ({
    sessionsPerWeek: list.reduce((n, w) => n + w.sessions, 0) / Math.max(1, list.length),
    daysPerWeek: list.reduce((n, w) => n + w.days, 0) / Math.max(1, list.length),
    sets: list.reduce((n, w) => n + w.sets, 0),
    volume: list.reduce((n, w) => n + w.volume, 0),
  });
  return { recent: sum(weeks.filter((w) => w.week >= p.start)), previous: sum(weeks.filter((w) => w.week < p.start)) };
}

/** Weekly volume of one exercise, for every week of both windows. */
export function exerciseWeeklyVolume(sessions: InsightSession[], exerciseId: string, p: Period, timeZone: string) {
  const weeks = weeklyTotals([], p, timeZone).map((w) => ({ week: w.week, volume: 0, sets: 0 }));
  const byWeek = new Map(weeks.map((w) => [w.week, w]));
  for (const s of ordered(sessions)) {
    const w = byWeek.get(weekStart(dayOf(s, timeZone)));
    if (!w) continue;
    for (const e of s.exercises)
      if (e.exerciseId === exerciseId)
        for (const x of e.sets.filter(valid)) {
          w.sets++;
          w.volume += (x.weight ?? 0) * (x.reps ?? 0);
        }
  }
  return weeks;
}

// ── D. balance ───────────────────────────────────────────────────────────────────────────

export const PUSH = ["Chest", "Shoulders", "Triceps"];
export const PULL = ["Back", "Rear delts", "Biceps"];
export const LOWER = ["Quads", "Hamstrings", "Glutes", "Calves", "Posterior"];
const UPPER_OTHER = ["Forearms"];

export type Balance = {
  push: number;
  pull: number;
  upper: number;
  lower: number;
  /** sets that are neither (core, full body) or not classifiable */
  other: number;
  total: number;
  /** muscles trained before this window and not at all in it */
  untrained: string[];
  enough: boolean;
};

/** Minimum sets in the window before any balance is described. */
export const BALANCE_MIN_SETS = 20;

export function balance(weeks: WeekTotals[], p: Period): Balance {
  const recent = weeks.filter((w) => w.week >= p.start);
  const previous = weeks.filter((w) => w.week < p.start);
  const sets = (ms: string[], list = recent) => list.reduce((n, w) => n + ms.reduce((k, m) => k + (w.setsByMuscle.get(m) ?? 0), 0), 0);
  const total = recent.reduce((n, w) => n + w.sets, 0);
  const push = sets(PUSH);
  const pull = sets(PULL);
  const lower = sets(LOWER);
  const upper = push + pull + sets(UPPER_OTHER);
  const before = new Set(previous.flatMap((w) => [...w.setsByMuscle.entries()].filter(([, n]) => n > 0).map(([m]) => m)));
  const now = new Set(recent.flatMap((w) => [...w.setsByMuscle.entries()].filter(([, n]) => n > 0).map(([m]) => m)));
  return {
    push,
    pull,
    upper,
    lower,
    other: total - upper - lower,
    total,
    untrained: [...before].filter((m) => !now.has(m)).sort(),
    enough: total >= BALANCE_MIN_SETS,
  };
}

/** A factual sentence about a pair, or null when they are within 1.5× of each other. */
export function pairObservation(a: { label: string; sets: number }, b: { label: string; sets: number }, weeks: number) {
  const [hi, lo] = a.sets >= b.sets ? [a, b] : [b, a];
  if (hi.sets === 0 || (lo.sets > 0 && hi.sets / lo.sets < 1.5)) return null;
  return `Over the last ${weeks} weeks you logged ${hi.sets} ${hi.label} sets and ${lo.sets} ${lo.label}.`;
}

// ── E. records ───────────────────────────────────────────────────────────────────────────

export type RecordEntry = { sessionId: string; endedAt: string; exerciseId: string; name: string; kind: "heaviest_weight" | "most_reps"; weight: number | null; reps: number | null };

/** Measured, non-baseline records (the existing record system), newest first. */
export function measuredRecords(sessions: InsightSession[]): RecordEntry[] {
  return ordered(sessions)
    .flatMap((s) =>
      s.records
        .filter((r) => !r.isBaseline && r.kind !== "estimated_1rm")
        .map((r) => ({ sessionId: s.id, endedAt: s.endedAt, exerciseId: r.exerciseId, name: r.name, kind: r.kind as RecordEntry["kind"], weight: r.weight, reps: r.reps })),
    )
    .reverse();
}

/** How many records fell in each period: this window, the one before, the last year, all time. */
export function recordCounts(records: RecordEntry[], p: Period, now: Date, timeZone: string) {
  const yearAgo = dayKey(new Date(now.getTime() - 365 * 86400000), timeZone);
  const day = (r: RecordEntry) => dayKey(r.endedAt, timeZone);
  return {
    recent: records.filter((r) => day(r) >= p.start && day(r) <= p.end).length,
    previous: records.filter((r) => day(r) >= p.previousStart && day(r) < p.start).length,
    year: records.filter((r) => day(r) >= yearAgo).length,
    all: records.length,
  };
}

export type BestPerformance = { exerciseId: string; name: string; measure: Measure; weight: number | null; reps: number; at: string; sessionId: string; sessions: number };

/** Each exercise's best measured set ever (heaviest, more reps breaking ties; or most reps). */
export function bestPerformances(sessions: InsightSession[]): BestPerformance[] {
  return exerciseHistories(sessions)
    .map((h) => {
      const best = h.days.reduce((m, d) => {
        if (h.measure === "weight_reps") return (d.topWeight ?? 0) > (m.topWeight ?? 0) || (d.topWeight === m.topWeight && d.topReps > m.topReps) ? d : m;
        return d.bestReps > m.bestReps ? d : m;
      }, h.days[0]);
      return {
        exerciseId: h.exerciseId,
        name: h.name,
        measure: h.measure,
        weight: h.measure === "weight_reps" ? best.topWeight : null,
        reps: h.measure === "weight_reps" ? best.topReps : best.bestReps,
        at: best.endedAt,
        sessionId: best.sessionId,
        sessions: h.days.length,
      };
    })
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
}

/** Relative change, or null when there is nothing to compare against. */
export const relative = (now: number, before: number) => (before > 0 ? (now - before) / before : null);
