/**
 * Waypoints up a range's climbing trail, foot to summit. `t` is the share of the climb
 * (0 = the first session, 1 = today's best). Stops fall on round numbers (every 1, 2.5, 5, 10,
 * 20 … kg, or every 5, 10, 25 … workouts), with at most MAX_BETWEEN between foot and summit,
 * so a small climb gets a few marks and a long one isn't crowded.
 */

import { formatShortDate, formatWeight, plural } from "@/lib/format";
import type { LiftTrail } from "./explore";

export const MAX_BETWEEN = 4;
const WEIGHT_STEPS = [1, 2.5, 5, 10, 20, 25, 50, 100];
const COUNT_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 250, 500];

/** The smallest round step that leaves at most MAX_BETWEEN marks inside (from, to). */
export function roundStep(from: number, to: number, steps: number[]) {
  return steps.find((s) => marksBetween(from, to, s).length <= MAX_BETWEEN) ?? steps.at(-1)!;
}

/** Multiples of `step` strictly between from and to, kept clear of both ends by a third of a step. */
export function marksBetween(from: number, to: number, step: number) {
  const out: number[] = [];
  for (let v = Math.ceil((from + step / 3) / step) * step; v < to - step / 3 + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

export type Stop = { t: number; text: string };

export function progressStops(trail: LiftTrail | null, sessions: number, unit: string, timeZone: string): Stop[] {
  if (trail) {
    const first = trail.steps[0];
    const best = trail.steps.at(-1)!;
    const span = best.weight - first.weight;
    if (span <= 0) return [];
    const step = roundStep(first.weight, best.weight, WEIGHT_STEPS);
    return [
      { t: 0, text: `${formatWeight(first.weight)} ${unit} · ${formatShortDate(first.endedAt, timeZone)}` },
      ...marksBetween(first.weight, best.weight, step).map((w) => ({ t: (w - first.weight) / span, text: `${formatWeight(w)} ${unit}` })),
      // the summit's own callout carries today's best
      { t: 1, text: "" },
    ];
  }
  if (sessions < 2) return [];
  const step = roundStep(1, sessions, COUNT_STEPS);
  return [
    { t: 0, text: "1st workout" },
    ...marksBetween(1, sessions, step).map((n) => ({ t: (n - 1) / (sessions - 1), text: plural(n, "workout") })),
    { t: 1, text: "" },
  ];
}
