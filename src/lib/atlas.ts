/**
 * The Atlas: the history behind the world. Pure helpers, no I/O.
 *
 * The world at any past moment is rebuilt from the sessions up to that moment (buildWorld with
 * `asOf`), never stored, so a historical view shows exactly the ranges, river, contours and
 * landmarks that existed then, and today's world is untouched by looking back.
 */

import { liftTrail, type RegionSummary } from "@/lib/landscape/explore";
import type { WorldLandmark } from "@/lib/landscape/landmarks";
import type { WorldSession } from "@/lib/landscape/world";

const DAY = 86400000;

export type Stop = { id: string; label: string; at: string };

/** Moments worth revisiting: the first week, month, quarter, half-year, years, and today. */
export function atlasStops(firstAt: string, now: Date): Stop[] {
  const t0 = Date.parse(firstAt);
  const marks: [string, string, number][] = [
    ["week", "First week", 7],
    ["month", "First month", 30],
    ["3m", "3 months", 91],
    ["6m", "6 months", 182],
    ["1y", "1 year", 365],
    ["2y", "2 years", 730],
    ["3y", "3 years", 1095],
  ];
  const stops = marks
    .filter(([, , days]) => t0 + days * DAY < now.getTime())
    .map(([id, label, days]) => ({ id, label, at: new Date(t0 + days * DAY).toISOString() }));
  return [...stops, { id: "now", label: "Today", at: now.toISOString() }];
}

/** "34 weeks", "1 year, 3 months": how long the record runs. */
export function historySpan(firstAt: string, now: Date) {
  const days = Math.max(0, Math.round((now.getTime() - Date.parse(firstAt)) / DAY));
  if (days < 14) return days === 1 ? "1 day" : `${days} days`;
  if (days < 7 * 26) return `${Math.round(days / 7)} weeks`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} months`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${y} ${y === 1 ? "year" : "years"}${m ? `, ${m} ${m === 1 ? "month" : "months"}` : ""}`;
}

export function overview(history: WorldSession[], landmarks: WorldLandmark[]) {
  const ids = new Set<string>();
  const unique = history.filter((s) => !ids.has(s.id) && ids.add(s.id));
  return {
    workouts: unique.length,
    records: unique.reduce((n, s) => n + s.records, 0),
    landmarks: landmarks.length,
    summits: landmarks.filter((l) => l.summit).length,
    routines: new Set(unique.map((s) => s.templateKey)).size,
    first: unique.reduce<string | null>((m, s) => (!m || s.endedAt < m ? s.endedAt : m), null),
  };
}

/** Region callouts and climbing trails as they stood at `asOf`, from the light history alone. */
export function regionsAsOf(history: WorldSession[], asOf: string): RegionSummary[] {
  const groups = new Map<string, WorldSession[]>();
  for (const s of history) if (s.endedAt <= asOf) groups.set(s.templateKey, [...(groups.get(s.templateKey) ?? []), s]);
  return [...groups.entries()].map(([key, list]) => ({
    key,
    name: list[0].label,
    workouts: list.length,
    records: list.reduce((n, s) => n + s.records, 0),
    volumeTrend: null,
    recent: [],
    prs: [],
    trail: liftTrail(list),
  }));
}

/** The record, newest month first, each month oldest event first (read like a journal). */
export function byMonth(landmarks: WorldLandmark[], timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone });
  const key = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone });
  const groups = new Map<string, { label: string; items: WorldLandmark[] }>();
  for (const l of [...landmarks].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))) {
    const k = key.format(new Date(l.at));
    const g = groups.get(k) ?? { label: fmt.format(new Date(l.at)), items: [] };
    g.items.push(l);
    groups.set(k, g);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, g]) => ({ key: k, ...g }));
}

/** The place key the landscape uses to locate a landmark: its summit, or its stone. */
export const placeOf = (l: WorldLandmark) => (l.summit ? (`summit:${l.summit.slot}` as const) : (`landmark:${l.id}` as const));

/** End of a YYYY-MM-DD day in UTC terms, as an ISO instant; null when not a real date. */
export function parseDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const t = Date.parse(`${value}T23:59:59Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
