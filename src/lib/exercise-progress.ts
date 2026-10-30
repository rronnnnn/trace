/**
 * Exercise progress, derived from recorded sets only. Measured values (heaviest weight, most
 * reps) and estimates (Epley e1RM) are kept apart, the same way the records are.
 */

import type { Measure } from "@/lib/workout/types";

export type LoggedSet = { weight: number | null; reps: number | null };

export type ExerciseSession = {
  sessionId: string;
  endedAt: string;
  routine: string | null;
  isSample: boolean;
  notes: string | null;
  /** completed sets only, in the order performed */
  sets: LoggedSet[];
};

export type SessionSummary = ExerciseSession & {
  /** heaviest weight lifted (weight × reps exercises) */
  topWeight: number | null;
  /** reps performed at the top weight */
  topWeightReps: number | null;
  /** most reps in one set */
  bestReps: number;
  volume: number;
  /** best Epley estimate in the session; sets of ≤ 12 reps only */
  e1rm: number | null;
};

const DAY = 86_400_000;

/** Epley, matching derive_session_records: weight × (1 + reps / 30), rounded to 0.1. Null past 12 reps. */
export function epley(weight: number | null, reps: number | null) {
  if (weight == null || weight <= 0 || reps == null || reps <= 0 || reps > 12) return null;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

const valid = (s: LoggedSet) => (s.reps ?? 0) > 0;

export function summarizeSession(s: ExerciseSession): SessionSummary {
  let topWeight: number | null = null;
  let topWeightReps: number | null = null;
  let bestReps = 0;
  let volume = 0;
  let e1rm: number | null = null;
  for (const set of s.sets.filter(valid)) {
    const reps = set.reps ?? 0;
    bestReps = Math.max(bestReps, reps);
    if (set.weight != null && set.weight > 0) {
      volume += set.weight * reps;
      if (topWeight == null || set.weight > topWeight || (set.weight === topWeight && reps > (topWeightReps ?? 0))) {
        topWeight = set.weight;
        topWeightReps = reps;
      }
      const est = epley(set.weight, reps);
      if (est != null && (e1rm == null || est > e1rm)) e1rm = est;
    }
  }
  return { ...s, topWeight, topWeightReps, bestReps, volume, e1rm };
}

/** Sessions that performed the exercise, oldest first. Sessions with no valid set are dropped. */
export function summarize(sessions: ExerciseSession[]): SessionSummary[] {
  return sessions
    .map(summarizeSession)
    .filter((s) => s.bestReps > 0)
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt));
}

/** The number a session is judged by: top weight, or most reps for bodyweight moves. */
export function primaryValue(s: SessionSummary, measure: Measure) {
  return measure === "weight_reps" ? (s.topWeight ?? 0) : s.bestReps;
}

export type Best = { value: number; reps: number | null; at: string; sessionId: string } | null;

/** Best measured set ever: heaviest weight (more reps break ties), or most reps. */
export function bestEver(list: SessionSummary[], measure: Measure): Best {
  let best: Best = null;
  for (const s of list) {
    const value = primaryValue(s, measure);
    if (value <= 0) continue;
    const reps = measure === "weight_reps" ? s.topWeightReps : null;
    if (!best || value > best.value || (value === best.value && (reps ?? 0) > (best.reps ?? 0)))
      best = { value, reps, at: s.endedAt, sessionId: s.sessionId };
  }
  return best;
}

export function bestEstimate(list: SessionSummary[]) {
  let best: { value: number; at: string } | null = null;
  for (const s of list) if (s.e1rm != null && (!best || s.e1rm > best.value)) best = { value: s.e1rm, at: s.endedAt };
  return best;
}

export const REP_TARGETS = [1, 3, 5, 8, 10, 12] as const;

/**
 * Heaviest weight lifted for at least N reps, for each N. A 100 × 5 also counts as a 3-rep max of
 * at least 100: that is a measurement, not an estimate.
 */
export function repMaxes(list: SessionSummary[]) {
  return REP_TARGETS.map((n) => {
    let best: { reps: number; weight: number; at: string; sessionId: string; actualReps: number } | null = null;
    for (const s of list)
      for (const set of s.sets)
        if (set.weight != null && set.weight > 0 && (set.reps ?? 0) >= n && (!best || set.weight > best.weight))
          best = { reps: n, weight: set.weight, at: s.endedAt, sessionId: s.sessionId, actualReps: set.reps ?? n };
    return best ?? { reps: n, weight: null, at: null, sessionId: null, actualReps: null };
  });
}

export type Trend = { current: number; previous: number; change: number } | null;

/**
 * Best of the last 4 weeks against the best of the 4 weeks before. Null when either window has no
 * sessions, so a trend is only claimed when there is something to compare.
 */
export function recentTrend(list: SessionSummary[], measure: Measure, now: Date, windowDays = 28): Trend {
  const t = now.getTime();
  const best = (from: number, to: number) => {
    const values = list
      .filter((s) => {
        const at = new Date(s.endedAt).getTime();
        return at > from && at <= to;
      })
      .map((s) => primaryValue(s, measure))
      .filter((v) => v > 0);
    return values.length ? Math.max(...values) : null;
  };
  const current = best(t - windowDays * DAY, t);
  const previous = best(t - 2 * windowDays * DAY, t - windowDays * DAY);
  if (current == null || previous == null) return null;
  return { current, previous, change: previous ? (current - previous) / previous : 0 };
}

/** One sentence on where an exercise stands, from facts only. */
export function trendLine(trend: Trend, measure: Measure, unit = "kg") {
  if (!trend) return null;
  const diff = Math.round((trend.current - trend.previous) * 10) / 10;
  const fmt = (n: number) => (measure === "weight_reps" ? `${Number.isInteger(n) ? n : n.toFixed(1)} ${unit}` : `${n} reps`);
  if (diff > 0) return `Up ${fmt(diff)} on the 4 weeks before`;
  if (diff < 0) return `Down ${fmt(-diff)} on the 4 weeks before`;
  return "Level with the 4 weeks before";
}

/** "80 × 5 (×2), 85 × 3": a session's sets in one line; reps only for bodyweight sets. */
export function setLine(sets: LoggedSet[]) {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const parts = sets.filter(valid).map((s) => (s.weight != null && s.weight > 0 ? `${fmt(s.weight)} × ${s.reps}` : `${s.reps}`));
  // Collapse runs of identical sets: "80 × 5 ×3"
  const out: string[] = [];
  for (let i = 0; i < parts.length; ) {
    let j = i;
    while (j < parts.length && parts[j] === parts[i]) j++;
    out.push(j - i > 1 ? `${parts[i]} (×${j - i})` : parts[i]);
    i = j;
  }
  return out.join(", ");
}
