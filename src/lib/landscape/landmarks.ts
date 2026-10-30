/**
 * Landmarks: the meaningful moments in a training history, as permanent places in the world.
 *
 * Nothing here is stored. Every landmark is derived from persisted sessions and their measured
 * records with fixed, deterministic conditions, so the same history always yields the same
 * landmarks on the same sessions and dates (any device, any refresh, before or after a routine
 * is edited or deleted) and none can be counted twice. Each landmark belongs to the session that
 * earned it, which is how it finds its place: sessions never move once placed.
 *
 * Some milestones are hidden summits instead: fixed peaks out on the frontier, beyond the
 * developed world, that stay uncharted until the milestone is reached. Their conditions are not
 * shown before then.
 *
 * Discovery is quiet by design: no notifications. A landmark is simply there the next time the
 * world is looked at.
 */

import { addDays, dayKey, weekStart } from "@/lib/dates";
import { formatShortDate, formatWeight } from "@/lib/format";
import type { WorldSession } from "./world";

export type LandmarkCategory = "strength" | "consistency" | "journey" | "running";

export const CATEGORIES: { id: LandmarkCategory; label: string }[] = [
  { id: "journey", label: "Journey" },
  { id: "consistency", label: "Consistency" },
  { id: "strength", label: "Strength" },
  { id: "running", label: "Running" },
];

export type LandmarkStat = { label: string; value: string };

export type WorldLandmark = {
  /** stable id: the same history always gives the same ids */
  id: string;
  category: LandmarkCategory;
  title: string;
  description: string;
  /** the session that earned it: its date, its place in the world */
  sessionId: string;
  at: string;
  routine: string;
  routineKey: string;
  exercise: string | null;
  stats: LandmarkStat[];
  /** a hidden summit on the frontier, rather than a monument on a range */
  summit: { slot: number; name: string } | null;
  /** earned in sample (demo) data */
  sample: boolean;
  /** a running landmark: the run it belongs to (runs have no place in the landscape) */
  runId?: string;
};

// ── conditions: deliberately few, each one a real step ─────────────────────────────────────
/** completed-workout counts worth marking; the larger ones are summits */
export const WORKOUT_COUNTS = [10, 25, 50, 100, 250, 500, 1000];
/** consecutive Monday-aligned weeks with at least one workout */
export const STREAK_WEEKS = [4, 12, 26, 52];
/** heaviest completed set across any exercise, in the user's unit */
export const LOADS: Record<string, number[]> = { kg: [100, 140, 180, 220], lb: [225, 315, 405, 495] };
/** an exercise's best set reaching twice its first, when the first was at least this heavy */
const DOUBLE_FROM: Record<string, number> = { kg: 10, lb: 20 };

/**
 * The hidden summits, in slot order. A slot is a fixed place on the frontier, so a summit keeps
 * its place whatever else changes. Names are place names; the condition stays hidden until met.
 */
export function summitDefs(unit: string) {
  const loads = LOADS[unit] ?? LOADS.kg;
  return [
    { id: "workouts-50", name: "Long Ridge" },
    { id: "streak-12", name: "Quarter Peak" },
    { id: `load-${loads[0]}`, name: "Iron Tor" },
    { id: "workouts-100", name: "Centenary" },
    { id: "streak-26", name: "Halfyear Crag" },
    { id: `load-${loads[1]}`, name: "Granite Tor" },
    { id: "workouts-250", name: "Far Cairn" },
    { id: "streak-52", name: "The Long Year" },
    { id: `load-${loads[2]}`, name: "Basalt Tor" },
    { id: "workouts-500", name: "Steadfast" },
    { id: `load-${loads[3]}`, name: "Obsidian Tor" },
    { id: "workouts-1000", name: "The Thousand" },
  ].map((d, slot) => ({ ...d, slot }));
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

function ordered(history: WorldSession[]) {
  const seen = new Set<string>();
  return [...history]
    .filter((s) => !seen.has(s.id) && seen.add(s.id))
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt) || a.id.localeCompare(b.id));
}

/**
 * Every landmark the history has earned, oldest first. `asOf` gives the landmarks that existed at
 * that moment (exactly the ones a rebuild of the world at that date would show).
 */
export function earnedLandmarks(history: WorldSession[], { unit, timeZone, asOf }: { unit: string; timeZone: string; asOf?: string }): WorldLandmark[] {
  const sessions = ordered(history).filter((s) => !asOf || s.endedAt <= asOf);
  const summits = new Map(summitDefs(unit).map((d) => [d.id, d]));
  const out: WorldLandmark[] = [];
  const add = (l: Omit<WorldLandmark, "summit" | "routine" | "routineKey" | "at" | "sample">, s: WorldSession) => {
    const d = summits.get(l.id);
    out.push({
      ...l,
      at: s.endedAt,
      routine: s.label,
      routineKey: s.templateKey,
      sample: Boolean(s.isSample),
      summit: d ? { slot: d.slot, name: d.name } : null,
    });
  };
  const date = (iso: string) => formatShortDate(iso, timeZone);
  const w = (n: number) => `${formatWeight(n)} ${unit}`;

  const routines = new Set<string>();
  let firstRecord = false;
  const loads = [...(LOADS[unit] ?? LOADS.kg)];
  const firstLift = new Map<string, { weight: number; at: string; name: string }>();
  const doubled = new Set<string>();
  let streak = 0;
  let lastWeek: string | null = null;
  let streakFrom: string | null = null;
  const streaks = [...STREAK_WEEKS];

  sessions.forEach((s, i) => {
    const n = i + 1;
    // journey: where it began, each new range, the first record
    if (n === 1)
      add(
        {
          id: "first-workout",
          category: "journey",
          title: "First workout",
          description: `Where the landscape began: ${s.label}.`,
          sessionId: s.id,
          exercise: null,
          stats: [
            { label: "Routine", value: s.label },
            { label: "Sets", value: String(s.sets) },
          ],
        },
        s,
      );
    else if (!routines.has(s.templateKey))
      add(
        {
          id: `range-${s.templateKey}`,
          category: "journey",
          title: `A new range: ${s.label}`,
          description: `The first ${s.label} session raised a range of its own.`,
          sessionId: s.id,
          exercise: null,
          stats: [
            { label: "Workout", value: `${ordinal(n)} overall` },
            { label: "Ranges", value: String(routines.size + 1) },
          ],
        },
        s,
      );
    routines.add(s.templateKey);

    const record = s.prs?.find((r) => r.kind === "heaviest_weight") ?? s.prs?.[0];
    if (!firstRecord && record) {
      firstRecord = true;
      add(
        {
          id: "first-record",
          category: "journey",
          title: "First personal record",
          description: `Your first measured best: ${record.name}.`,
          sessionId: s.id,
          exercise: record.name,
          stats: [
            {
              label: record.kind === "most_reps" ? "Most reps" : "Heaviest set",
              value: record.kind === "most_reps" || record.weight == null ? `${record.reps} reps` : `${w(record.weight)} × ${record.reps}`,
            },
            { label: "Workout", value: ordinal(n) },
          ],
        },
        s,
      );
    }

    // consistency: completed workouts
    if (WORKOUT_COUNTS.includes(n))
      add(
        {
          id: `workouts-${n}`,
          category: "consistency",
          title: `${n} workouts`,
          description: `Your ${ordinal(n)} completed workout.`,
          sessionId: s.id,
          exercise: null,
          stats: [
            { label: "Workouts", value: String(n) },
            { label: "Since", value: date(sessions[0].endedAt) },
          ],
        },
        s,
      );

    // consistency: weeks in a row with at least one workout (the week it reached N)
    const week = weekStart(dayKey(s.endedAt, timeZone));
    if (week !== lastWeek) {
      if (lastWeek && addDays(lastWeek, 7) === week) streak++;
      else {
        streak = 1;
        streakFrom = week;
      }
      lastWeek = week;
      if (streaks.length && streak >= streaks[0]) {
        const weeks = streaks.shift()!;
        add(
          {
            id: `streak-${weeks}`,
            category: "consistency",
            title: `${weeks} weeks unbroken`,
            description: `${weeks} weeks in a row with at least one workout.`,
            sessionId: s.id,
            exercise: null,
            stats: [
              { label: "Weeks", value: String(weeks) },
              { label: "From", value: formatShortDate(`${streakFrom}T12:00:00Z`, "UTC") },
            ],
          },
          s,
        );
      }
    }

    // strength: the heaviest set yet crossing a load, and an exercise doubling its first best
    const heaviest = (s.lifts ?? []).filter((l) => (l.reps ?? 0) >= 1).sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))[0];
    while (heaviest && loads.length && heaviest.weight >= loads[0]) {
      const load = loads.shift()!;
      add(
        {
          id: `load-${load}`,
          category: "strength",
          title: `First ${w(load)} lift`,
          description: `${heaviest.name}: the first completed set at ${w(load)} or more.`,
          sessionId: s.id,
          exercise: heaviest.name,
          stats: [
            { label: "Set", value: `${w(heaviest.weight)} × ${heaviest.reps}` },
            { label: "Exercise", value: heaviest.name },
          ],
        },
        s,
      );
    }
    for (const l of s.lifts ?? []) {
      if ((l.reps ?? 0) < 1) continue;
      const first = firstLift.get(l.exerciseId);
      if (!first) {
        firstLift.set(l.exerciseId, { weight: l.weight, at: s.endedAt, name: l.name });
        continue;
      }
      if (doubled.has(l.exerciseId) || first.weight < (DOUBLE_FROM[unit] ?? DOUBLE_FROM.kg) || l.weight < first.weight * 2) continue;
      doubled.add(l.exerciseId);
      add(
        {
          id: `doubled-${l.exerciseId}`,
          category: "strength",
          title: `${l.name}, doubled`,
          description: `From ${w(first.weight)} to ${w(l.weight)}: twice your first ${l.name}.`,
          sessionId: s.id,
          exercise: l.name,
          stats: [
            { label: "First", value: `${w(first.weight)} · ${date(first.at)}` },
            { label: "Now", value: `${w(l.weight)} × ${l.reps}` },
          ],
        },
        s,
      );
    }
  });
  return out;
}

export type Summit = {
  id: string;
  slot: number;
  /** null until discovered: an uncharted summit gives nothing away */
  name: string | null;
  landmark: WorldLandmark | null;
};

/** Every hidden summit, discovered or not, in slot order. */
export function summits(landmarks: WorldLandmark[], unit: string): Summit[] {
  const byId = new Map(landmarks.map((l) => [l.id, l]));
  return summitDefs(unit).map((d) => {
    const landmark = byId.get(d.id) ?? null;
    return { id: d.id, slot: d.slot, name: landmark ? d.name : null, landmark };
  });
}

/** Landmarks earned after `since` (e.g. since the last visit), for the world to reveal. */
export const landmarksSince = (landmarks: WorldLandmark[], since: string | null) => (since ? landmarks.filter((l) => l.at > since) : []);
