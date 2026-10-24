/**
 * Goals as summits. Progress is derived from recorded sets only (measured lifts, never
 * estimates), so a goal can't claim more than the history shows.
 */

import { hashString } from "@/lib/landscape/terrain";

export type Goal = {
  id: string;
  exerciseId: string;
  exerciseName: string;
  targetWeight: number | null; // null: bodyweight rep goal
  targetReps: number;
  note: string | null;
  achievedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type GoalSet = { endedAt: string; weight: number | null; reps: number | null; isSample: boolean };

export type GoalProgress = {
  /** best qualifying value so far: kg for weighted goals, reps for bodyweight goals */
  current: number;
  target: number;
  /** 0–1, capped */
  fraction: number;
  /** when the best value was set, and when the goal was first reached */
  bestAt: string | null;
  reachedAt: string | null;
  /** best-so-far over time: one point per new best */
  history: { at: string; value: number }[];
  usesSample: boolean;
};

export const isWeighted = (g: Pick<Goal, "targetWeight">) => g.targetWeight != null;

/**
 * Weighted goal: heaviest weight lifted for at least targetReps. Bodyweight goal: most reps in
 * one set. Both are actual measurements from completed sets.
 */
export function goalProgress(goal: Pick<Goal, "targetWeight" | "targetReps">, sets: GoalSet[]): GoalProgress {
  const target = goal.targetWeight ?? goal.targetReps;
  const ordered = [...sets].sort((a, b) => a.endedAt.localeCompare(b.endedAt));
  let current = 0;
  let bestAt: string | null = null;
  let reachedAt: string | null = null;
  let usesSample = false;
  const history: GoalProgress["history"] = [];
  for (const s of ordered) {
    const value = isWeighted(goal) ? ((s.reps ?? 0) >= goal.targetReps ? (s.weight ?? 0) : 0) : (s.reps ?? 0);
    if (value > current) {
      current = value;
      bestAt = s.endedAt;
      history.push({ at: s.endedAt, value });
      if (s.isSample) usesSample = true;
      if (!reachedAt && value >= target) reachedAt = s.endedAt;
    }
  }
  return { current, target, fraction: Math.min(1, target > 0 ? current / target : 0), bestAt, reachedAt, history, usesSample };
}

export function goalTitle(g: Pick<Goal, "targetWeight" | "targetReps" | "exerciseName">, unit = "kg") {
  if (g.targetWeight == null) return `${g.targetReps} ${g.exerciseName}${g.targetReps === 1 ? "" : "s"}`.replace(/(s)s$/, "$1");
  const w = Number.isInteger(g.targetWeight) ? g.targetWeight : g.targetWeight.toFixed(1);
  return g.targetReps > 1 ? `${w} ${unit} × ${g.targetReps} ${g.exerciseName}` : `${w} ${unit} ${g.exerciseName}`;
}

export function progressLine(p: GoalProgress, g: Pick<Goal, "targetWeight">, unit = "kg") {
  const pct = Math.round(p.fraction * 100);
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return isWeighted(g) ? `${pct}% · ${fmt(p.current)} ${unit} of ${fmt(p.target)} ${unit}` : `${pct}% · ${p.current} of ${p.target} reps`;
}

/** A sensible next summit from a current best: about 10% higher, rounded to the plate. */
export function suggestTarget(best: number, weighted: boolean) {
  if (!weighted) return Math.max(best + 2, Math.ceil(best * 1.25));
  return Math.max(best + 2.5, Math.ceil((best * 1.1) / 2.5) * 2.5);
}

// ── side-view mountain ───────────────────────────────────────────────────────

export type MountainProfile = {
  /** silhouette, left base → summit → right base, in a 0–1 box (y down) */
  ridge: [number, number][];
  /** climbing trail from the foot to the summit */
  trail: [number, number][];
  summit: [number, number];
  /** distant ranges for depth */
  far: [number, number][][];
};

/** Deterministic per goal: every summit has its own shape, and the summit is the goal. */
export function mountainProfile(seedKey: string): MountainProfile {
  const h = hashString(seedKey);
  const rand = (k: number) => (hashString(`${h}:${k}`) % 10000) / 10000;
  const peakX = 0.68 + rand(1) * 0.1;
  const summit: [number, number] = [peakX, 0.12];

  // left flank: a climbable slope with shoulders; right flank: steeper
  const left: [number, number][] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = 0.02 + (peakX - 0.02) * t;
    const base = 0.92 - (0.92 - summit[1]) * Math.pow(t, 1.18);
    const shoulder = Math.sin(t * Math.PI * (2 + Math.floor(rand(2) * 2))) * 0.035 * (1 - t);
    const crag = (rand(10 + i) - 0.5) * 0.03 * (t > 0.05 && t < 0.98 ? 1 : 0);
    left.push([x, Math.min(0.95, base - shoulder + crag)]);
  }
  left[left.length - 1] = summit;
  const right: [number, number][] = [];
  const rs = 7;
  for (let i = 1; i <= rs; i++) {
    const t = i / rs;
    const x = peakX + (0.99 - peakX) * t;
    const y = summit[1] + (0.94 - summit[1]) * Math.pow(t, 0.75) + (rand(40 + i) - 0.5) * 0.03 * (i < rs ? 1 : 0);
    right.push([x, Math.min(0.96, y)]);
  }
  const ridge = [...left, ...right];

  // the trail hugs the left flank a little below the ridge line, switching back near the top
  const trail: [number, number][] = left.map(([x, y], i) => {
    const t = i / steps;
    const inset = 0.035 * (1 - t) + 0.008;
    const zig = t > 0.6 ? Math.sin(t * Math.PI * 7) * 0.012 : 0;
    return [x + zig, Math.min(0.94, y + inset)];
  });
  trail[trail.length - 1] = summit;

  const far = [0, 1].map((layer) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const x = i / 12;
      const y =
        0.5 + layer * 0.12 + Math.sin(x * Math.PI * (2 + layer) + rand(60 + layer) * 6) * 0.06 + (rand(70 + i + layer * 20) - 0.5) * 0.06;
      pts.push([x, y]);
    }
    return pts;
  });
  return { ridge, trail, summit, far };
}

/** Point and heading at fraction `f` of the trail's length. */
export function pointOnTrail(trail: [number, number][], f: number, aspect = 2) {
  const seg = trail.slice(1).map((p, i) => Math.hypot((p[0] - trail[i][0]) * aspect, p[1] - trail[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  let d = Math.min(1, Math.max(0, f)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? Math.min(1, d / seg[i]) : 0;
      const a = trail[i];
      const b = trail[i + 1];
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, angle: Math.atan2(b[1] - a[1], (b[0] - a[0]) * aspect) };
    }
    d -= seg[i];
  }
  const last = trail[trail.length - 1];
  return { x: last[0], y: last[1], angle: 0 };
}
