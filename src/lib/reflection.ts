/**
 * Weekly reflection: what a Monday–Sunday week of training actually contained, measured against
 * the plan and the weeks before it. Everything here is derived from recorded sessions; the only
 * thing a person writes is how the week felt and what to focus on next.
 */

import { addDays, dayKey, isoWeekday, weekStart } from "@/lib/dates";
import type { Measure } from "@/lib/workout/types";

export type ReflectionSet = { weight: number | null; reps: number | null };

export type ReflectionSession = {
  id: string;
  startedAt: string;
  endedAt: string;
  routine: string | null;
  volume: number;
  sets: number;
  isSample: boolean;
  notes: string | null;
  exercises: { exerciseId: string; name: string; muscle: string | null; measure: Measure; sets: ReflectionSet[] }[];
  /** measured records only (no baselines, no estimates) */
  records: { exerciseName: string; kind: "heaviest_weight" | "most_reps"; weight: number | null; reps: number | null }[];
};

export const ENERGY = [
  { value: 1, label: "Drained" },
  { value: 2, label: "Tired" },
  { value: 3, label: "Steady" },
  { value: 4, label: "Good" },
  { value: 5, label: "Strong" },
] as const;

export const energyLabel = (v: number | null | undefined) => ENERGY.find((e) => e.value === v)?.label ?? null;

/** A valid Monday day key, or null. */
export function parseWeek(key: string | undefined | null) {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const d = new Date(`${key}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== key) return null;
  return isoWeekday(key) === 1 ? key : null;
}

export function weekLabel(monday: string) {
  const sunday = addDays(monday, 6);
  const a = new Date(`${monday}T12:00:00Z`);
  const b = new Date(`${sunday}T12:00:00Z`);
  const month = (d: Date) => d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  return `${month(a)} ${a.getUTCDate()} – ${sameMonth ? "" : `${month(b)} `}${b.getUTCDate()}`;
}

export type WeekTotals = { key: string; sessions: number; volume: number; records: number; sample: boolean };

/** Totals for every week from the first session's week through the current one, newest first. */
export function weeklyTotals(
  sessions: (Pick<ReflectionSession, "endedAt" | "volume" | "isSample"> & { records: unknown[] })[],
  timeZone: string,
  today: string,
) {
  const current = weekStart(today);
  const byWeek = new Map<string, WeekTotals>();
  let first = current;
  for (const s of sessions) {
    const k = weekStart(dayKey(s.endedAt, timeZone));
    if (k < first) first = k;
    const w = byWeek.get(k) ?? { key: k, sessions: 0, volume: 0, records: 0, sample: false };
    w.sessions++;
    w.volume += s.volume;
    w.records += s.records.length;
    w.sample ||= s.isSample;
    byWeek.set(k, w);
  }
  const out: WeekTotals[] = [];
  for (let k = current; k >= first; k = addDays(k, -7)) out.push(byWeek.get(k) ?? { key: k, sessions: 0, volume: 0, records: 0, sample: false });
  return out;
}

export type Day = { key: string; weekday: number; planned: boolean; sessionIds: string[]; volume: number; isToday: boolean; future: boolean };

export type Improvement = {
  exerciseId: string;
  name: string;
  measure: Measure;
  now: number;
  before: number | null;
  direction: "up" | "level" | "down" | "new";
};

export type Reflection = {
  week: string;
  /** the week has fully ended */
  complete: boolean;
  days: Day[];
  sessions: ReflectionSession[];
  planned: number;
  plannedHit: number;
  /** planned days already past with no session */
  missed: string[];
  /** sessions on days that weren't planned */
  extra: number;
  volume: number;
  minutes: number;
  previousVolume: number | null;
  /** mean of the up to 4 weeks before, counting only weeks after training began */
  averageVolume: number | null;
  muscles: { muscle: string; sets: number }[];
  improvements: Improvement[];
  records: (ReflectionSession["records"][number] & { at: string })[];
  /** consecutive weeks, ending with this one (or the last complete one), that met the plan */
  streak: number;
  usesSample: boolean;
};

const best = (e: ReflectionSession["exercises"][number]) =>
  Math.max(0, ...e.sets.filter((s) => (s.reps ?? 0) > 0).map((s) => (e.measure === "weight_reps" ? (s.weight ?? 0) : (s.reps ?? 0))));

/**
 * Builds the reflection for the week starting `week` (a Monday key). `sessions` should include the
 * weeks before it so comparisons have something to compare against; anything after the week is ignored.
 */
export function buildReflection(input: {
  week: string;
  sessions: ReflectionSession[];
  trainingDays: number[];
  timeZone: string;
  today: string;
}): Reflection {
  const { week, trainingDays, timeZone, today } = input;
  const end = addDays(week, 7);
  const keyOf = (s: ReflectionSession) => dayKey(s.endedAt, timeZone);
  const all = [...input.sessions].filter((s) => keyOf(s) < end).sort((a, b) => a.endedAt.localeCompare(b.endedAt));
  const inWeek = all.filter((s) => keyOf(s) >= week);
  const before = all.filter((s) => keyOf(s) < week);

  const days: Day[] = Array.from({ length: 7 }, (_, i) => {
    const key = addDays(week, i);
    const list = inWeek.filter((s) => keyOf(s) === key);
    return {
      key,
      weekday: i + 1,
      planned: trainingDays.includes(i + 1),
      sessionIds: list.map((s) => s.id),
      volume: list.reduce((a, s) => a + s.volume, 0),
      isToday: key === today,
      future: key > today,
    };
  });

  const plannedDays = days.filter((d) => d.planned);
  const plannedHit = plannedDays.filter((d) => d.sessionIds.length).length;
  const missed = plannedDays.filter((d) => !d.sessionIds.length && d.key < today).map((d) => d.key);
  const extra = days.filter((d) => !d.planned).reduce((a, d) => a + d.sessionIds.length, 0);

  const volumeOf = (from: string) =>
    all.filter((s) => keyOf(s) >= from && keyOf(s) < addDays(from, 7)).reduce((a, s) => a + s.volume, 0);
  const firstWeek = all.length ? weekStart(keyOf(all[0])) : week;
  const previousWeeks = [1, 2, 3, 4].map((n) => addDays(week, -7 * n)).filter((k) => k >= firstWeek);
  const previousVolume = previousWeeks.length ? volumeOf(previousWeeks[0]) : null;
  const averageVolume = previousWeeks.length
    ? previousWeeks.reduce((a, k) => a + volumeOf(k), 0) / previousWeeks.length
    : null;

  const muscleSets = new Map<string, number>();
  for (const s of inWeek)
    for (const e of s.exercises) {
      const n = e.sets.filter((x) => (x.reps ?? 0) > 0).length;
      if (n) muscleSets.set(e.muscle ?? "Other", (muscleSets.get(e.muscle ?? "Other") ?? 0) + n);
    }
  const muscles = [...muscleSets.entries()].map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets);

  // Each exercise's best this week against its most recent earlier session.
  const improvements = new Map<string, Improvement>();
  for (const s of inWeek)
    for (const e of s.exercises) {
      const value = best(e);
      if (!value) continue;
      const prev = improvements.get(e.exerciseId);
      if (prev && prev.now >= value) continue;
      let beforeValue: number | null = null;
      for (let i = before.length - 1; i >= 0 && beforeValue == null; i--) {
        const match = before[i].exercises.find((x) => x.exerciseId === e.exerciseId && best(x) > 0);
        if (match) beforeValue = best(match);
      }
      const direction = beforeValue == null ? "new" : value > beforeValue ? "up" : value < beforeValue ? "down" : "level";
      improvements.set(e.exerciseId, { exerciseId: e.exerciseId, name: e.name, measure: e.measure, now: value, before: beforeValue, direction });
    }
  const order = { up: 0, new: 1, level: 2, down: 3 };
  const improvementList = [...improvements.values()].sort((a, b) => order[a.direction] - order[b.direction] || a.name.localeCompare(b.name));

  // Plan streak: weeks meeting the target, counting back. An unfinished week only adds once it's met.
  const target = trainingDays.length;
  const countIn = (from: string) => all.filter((s) => keyOf(s) >= from && keyOf(s) < addDays(from, 7)).length;
  let streak = 0;
  if (target > 0) {
    let k = week;
    if (end > today && countIn(week) < target) k = addDays(week, -7);
    for (; k >= firstWeek && countIn(k) >= target; k = addDays(k, -7)) streak++;
  }

  return {
    week,
    complete: end <= today,
    days,
    sessions: inWeek,
    planned: plannedDays.length,
    plannedHit,
    missed,
    extra,
    volume: inWeek.reduce((a, s) => a + s.volume, 0),
    minutes: Math.round(inWeek.reduce((a, s) => a + (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()), 0) / 60000),
    previousVolume,
    averageVolume,
    muscles,
    improvements: improvementList,
    records: inWeek.flatMap((s) => s.records.map((r) => ({ ...r, at: s.endedAt }))),
    streak,
    usesSample: inWeek.some((s) => s.isSample),
  };
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const weekdayName = (key: string) => WEEKDAY_NAMES[isoWeekday(key) - 1];

/** Percent change, or null when there is nothing to compare against. */
export function change(now: number, before: number | null) {
  if (before == null || before <= 0) return null;
  return (now - before) / before;
}

/** The week in one factual sentence. */
export function headline(r: Reflection) {
  const n = r.sessions.length;
  const recs = r.records.length;
  const recordPart = recs ? ` and set ${recs} record${recs > 1 ? "s" : ""}` : "";
  if (!n) {
    if (!r.complete && r.days.every((d) => d.future || d.isToday)) return "The week is just starting.";
    return r.complete ? "A week off. Rest counts too." : "No sessions yet this week.";
  }
  const sessions = `${n} session${n > 1 ? "s" : ""}`;
  if (r.planned) {
    const lead = r.complete ? "You trained" : "So far you've trained";
    if (r.plannedHit === r.planned) return `${lead} every planned day${recordPart}.`;
    return `${lead} ${r.plannedHit} of ${r.planned} planned days${r.extra ? `, plus ${r.extra} extra` : ""}${recordPart}.`;
  }
  return `${r.complete ? "You logged" : "So far you've logged"} ${sessions}${recordPart}.`;
}
