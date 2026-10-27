/**
 * The evolving Training Landscape: a world built from the user's whole training history.
 *
 * Every number here is derived from persisted sessions, so the same history always produces the
 * same world (any device, any refresh) and a session can only ever be counted once (ids are
 * deduplicated; the database's completion RPC is idempotent too).
 *
 * Growth model
 *  - Each routine is a region with its own mountain range. Its spine (where the range runs) is
 *    seeded by the routine itself and placed away from earlier regions, so adding a routine never
 *    moves the others.
 *  - Each session raises the ground at a fixed spot on its region's spine. Spots are assigned in
 *    order and never move: early sessions spread along the range, later ones build it up.
 *  - A session contributes bounded *effort*: 1 for showing up, adjusted by its volume against the
 *    user's own median for that routine (capped both ways), plus a capped bonus for measured
 *    personal records. One enormous workout can't make a mountain.
 *  - Height at a point is a logarithm of the effort accumulated there: early sessions show
 *    clearly, long-term growth never stops, and nothing ever goes down. Rest and breaks add no
 *    effort but take nothing away.
 *  - The river is routed through the layout (base terrain + where the ranges are), not through
 *    the heights, so its course stays recognisable while the mountains grow around it.
 *
 * This is a picture of consistency and performance history — not a measure of muscle.
 */

import type { RestSpan } from "./rest";
import { carveWater, fbm, hashString, ridged, type Landmark, type LandscapeSession, type Terrain } from "./terrain";

export type WorldSession = {
  id: string;
  endedAt: string;
  templateKey: string;
  label: string;
  volume: number;
  sets: number;
  /** measured, non-baseline personal records set in this session */
  records: number;
  /** the heaviest completed set of each weighted exercise in it (progress trails) */
  lifts?: { exerciseId: string; name: string; weight: number; reps: number | null }[];
};

export type RegionGrowth = {
  key: string;
  label: string;
  sessions: number;
  effort: number;
  /** highest point of this region's range, in field units, and where it is */
  peak: number;
  peakX: number;
  peakY: number;
};

export type World = Terrain & {
  regions: RegionGrowth[];
  /** per cell: region index (−1 open ground) and a 0–1 membership strength, for highlighting */
  regionIndex: Float32Array;
  regionStrength: Float32Array;
  asOf: string;
  /** every placed session, including ones outside any period being viewed */
  placed: Map<string, { x: number; y: number; u: number }>;
};

const HEIGHT = 0.3; // A in A·ln(1 + effort/κ)
const KAPPA = 1.6;
const SIGMA = 0.032; // footprint of one session's contribution
const PLACE_TAU = 22; // sessions until a range is ~63% laid out along its spine

/** Bounded contribution of one session. `median` is the routine's median volume before it. */
export function sessionEffort(volume: number, median: number | null, records: number) {
  const relative = median && median > 0 ? Math.min(1.6, Math.max(0.6, volume / median)) : 1;
  return 0.4 + 0.6 * relative + Math.min(1, 0.35 * records);
}

/** Effort → height, with diminishing returns that never flatten out. */
export const heightFor = (effort: number) => HEIGHT * Math.log(1 + effort / KAPPA);

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

type Spine = { at: (u: number) => [number, number, number, number]; cx: number; cy: number };

/** A routine's spine: seeded by the routine and the user, kept clear of earlier regions. */
function placeSpine(key: string, seed: string, aspect: number, taken: { cx: number; cy: number }[]): Spine {
  const rnd = (i: number) => (hashString(`${key}:${seed}:${i}`) % 100000) / 100000;
  let best = { cx: 0.5, cy: 0.5, score: -Infinity };
  for (let i = 0; i < 40; i++) {
    const cx = 0.24 + 0.52 * rnd(i * 2);
    const cy = 0.26 + 0.48 * rnd(i * 2 + 1);
    const nearest = taken.length ? Math.min(...taken.map((t) => Math.hypot((t.cx - cx) * aspect, t.cy - cy))) : 1;
    if (nearest >= 0.3) {
      best = { cx, cy, score: Infinity };
      break;
    }
    if (nearest > best.score) best = { cx, cy, score: nearest };
  }
  const angles = [0.15, 0.7, 1.45, -0.6, 2.4, 1.05, -1.25];
  const theta = angles[hashString(`${key}${seed}a`) % angles.length] + (rnd(90) - 0.5) * 0.4;
  const len = 0.4 + 0.18 * rnd(91);
  const bend = (rnd(92) - 0.5) * 0.7;
  const cx = best.cx * aspect;
  const cy = best.cy;
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  const ax = cx - (dx * len) / 2;
  const ay = cy - (dy * len) / 2;
  const bx = cx + (dx * len) / 2;
  const by = cy + (dy * len) / 2;
  const qx = cx - dy * bend * len;
  const qy = cy + dx * bend * len;
  return {
    cx: best.cx,
    cy: best.cy,
    at: (u) => {
      const v = 1 - u;
      const x = v * v * ax + 2 * v * u * qx + u * u * bx;
      const y = v * v * ay + 2 * v * u * qy + u * u * by;
      const tx = 2 * v * (qx - ax) + 2 * u * (bx - qx);
      const ty = 2 * v * (qy - ay) + 2 * u * (by - qy);
      const tl = Math.hypot(tx, ty) || 1;
      return [Math.min(0.92, Math.max(0.08, x / aspect)), Math.min(0.9, Math.max(0.1, y)), -ty / tl, tx / tl];
    },
  };
}

export function buildWorld({
  history,
  seed,
  asOf,
  exclude = [],
  rest = [],
  timeStart,
  timeEnd,
  cols = 200,
  rows = 128,
  aspect = 100 / 64,
  show,
}: {
  history: WorldSession[];
  seed: string;
  /** the world as of this moment (sessions after it are not counted) */
  asOf?: string;
  /** session ids to leave out (e.g. "before this workout") */
  exclude?: string[];
  rest?: RestSpan[];
  /** time axis for the river (rest swells sit at their dates) */
  timeStart: Date;
  timeEnd: Date;
  cols?: number;
  rows?: number;
  aspect?: number;
  /** sessions to expose as landmarks (e.g. the viewed period); defaults to all */
  show?: LandscapeSession[];
}): World {
  const s = hashString(seed);
  const seen = new Set<string>();
  const sessions = [...history]
    .filter((x) => !exclude.includes(x.id) && (!asOf || x.endedAt <= asOf) && !seen.has(x.id) && seen.add(x.id))
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt) || a.id.localeCompare(b.id));

  // regions in order of first appearance: a stable layout as history grows
  const bands: string[] = [];
  for (const x of sessions) if (!bands.includes(x.templateKey)) bands.push(x.templateKey);
  const spines: Spine[] = [];
  for (const key of bands) spines.push(placeSpine(key, seed, aspect, spines));

  // place sessions and work out their effort, in chronological order
  type Placed = { session: WorldSession; region: number; x: number; y: number; u: number; effort: number };
  const placedList: Placed[] = [];
  const perRegion = bands.map(() => ({ count: 0, volumes: [] as number[], effort: 0 }));
  for (const x of sessions) {
    const r = bands.indexOf(x.templateKey);
    const reg = perRegion[r];
    const effort = sessionEffort(x.volume, median(reg.volumes), x.records);
    const u = 0.08 + 0.84 * (1 - Math.exp(-reg.count / PLACE_TAU));
    const [px, py, nx, ny] = spines[r].at(u);
    const side = ((hashString(x.id) % 1000) / 1000 - 0.5) * 0.045;
    placedList.push({
      session: x,
      region: r,
      x: Math.min(0.94, Math.max(0.06, px + (nx * side) / aspect)),
      y: Math.min(0.92, Math.max(0.08, py + ny * side)),
      u,
      effort,
    });
    reg.count++;
    reg.volumes.push(x.volume);
    reg.effort += effort;
  }

  // accumulated effort per region and cell (each session only touches its own neighbourhood)
  const n = cols * rows;
  const effortGrid = bands.map(() => new Float32Array(n));
  // a cone, not a bell: ln(1 + A·e^(−d/σ)) ≈ ln A − d/σ, so the log turns each range into straight
  // flanks meeting at a ridge (a bell would flatten into a mesa under the log)
  const sc = SIGMA * 1.1;
  const reach = sc * 6;
  for (const p of placedList) {
    const grid = effortGrid[p.region];
    const i0 = Math.max(0, Math.floor((p.x - reach / aspect) * (cols - 1)));
    const i1 = Math.min(cols - 1, Math.ceil((p.x + reach / aspect) * (cols - 1)));
    const j0 = Math.max(0, Math.floor((p.y - reach) * (rows - 1)));
    const j1 = Math.min(rows - 1, Math.ceil((p.y + reach) * (rows - 1)));
    for (let j = j0; j <= j1; j++) {
      const dy = j / (rows - 1) - p.y;
      for (let i = i0; i <= i1; i++) {
        const dx = (i / (cols - 1) - p.x) * aspect;
        const d2 = dx * dx + dy * dy;
        grid[j * cols + i] += p.effort * Math.exp(-Math.sqrt(d2) / sc);
      }
    }
  }

  const spineSamples = spines.map((sp) => Array.from({ length: 24 }, (_, i) => sp.at(i / 23).slice(0, 2) as [number, number]));

  // heights: a gentle seeded base world + every region's earned relief
  const field = new Float32Array(n);
  const layout = new Float32Array(n);
  const regionIndex = new Float32Array(n).fill(-1);
  const regionStrength = new Float32Array(n);
  const peaks = bands.map(() => ({ h: 0, x: 0.5, y: 0.5 }));
  for (let j = 0; j < rows; j++) {
    const ny = j / (rows - 1);
    for (let i = 0; i < cols; i++) {
      const nx = i / (cols - 1);
      const k = j * cols + i;
      const base = 0.075 * fbm(s, nx * 2.1, ny * 1.6) + 0.025 * Math.sin((nx * 2.3 + ny * 1.1 + (s % 97) / 97) * Math.PI);
      let h = base;
      let lay = base;
      let top = 0;
      let topRegion = -1;
      for (let r = 0; r < bands.length; r++) {
        const e = effortGrid[r][k];
        if (e <= 0.0005) continue;
        const relief = heightFor(e);
        // crags, spurs and gullies appear as a range rises (low ground stays calm): a broad ridged
        // layer for the arêtes, a fine one for broken rock. Multipliers stay positive, so a vertex
        // still only ever rises as effort grows.
        const rise = Math.min(1, relief / 0.2);
        const crag = ridged(s + 1 + r * 13, nx * 9, ny * 6.5);
        const grit = ridged(s + 5 + r * 13, nx * 27, ny * 19);
        const shaped = relief * (0.5 + (1.05 * crag + 0.55 * grit) * rise);
        h += shaped;
        if (shaped > top) {
          top = shaped;
          topRegion = r;
        }
        if (shaped > peaks[r].h) peaks[r] = { h: shaped, x: nx, y: ny };
      }
      // the layout only knows *where* ranges run (their whole spine, from the first session on),
      // never how tall they are, so the river's course doesn't move as they grow
      for (let r = 0; r < bands.length; r++) {
        let d2min = Infinity;
        for (const [sx, sy] of spineSamples[r]) {
          const dx = (nx - sx) * aspect;
          const dy = ny - sy;
          d2min = Math.min(d2min, dx * dx + dy * dy);
        }
        lay += 0.14 * Math.exp(-d2min / (2 * 0.07 * 0.07));
      }
      field[k] = h;
      layout[k] = lay;
      if (topRegion >= 0 && top > 0.012) {
        regionIndex[k] = topRegion;
        const t = Math.min(1, top / 0.08);
        regionStrength[k] = t * t * (3 - 2 * t);
      }
    }
  }

  const water = carveWater(field, cols, rows, aspect, rest, timeStart, timeEnd, s, layout, 0.05);
  // keep the lowest ground at zero after carving
  let min = Infinity;
  for (const h of field) if (h < min) min = h;
  for (let k = 0; k < n; k++) field[k] -= min;

  const placed = new Map(placedList.map((p) => [p.session.id, { x: p.x, y: p.y, u: p.u }]));
  const visible = show ?? placedList.map((p) => ({ ...p.session, prCount: p.session.records }));
  const landmarks: Landmark[] = [];
  for (const sess of visible) {
    const p = placed.get(sess.id);
    if (!p) continue;
    const i = Math.round(p.x * (cols - 1));
    const j = Math.round(p.y * (rows - 1));
    landmarks.push({ session: sess as LandscapeSession, x: p.x, y: p.y, u: p.u, height: field[j * cols + i] });
  }

  return {
    cols,
    rows,
    field,
    landmarks,
    bands,
    water,
    regionIndex,
    regionStrength,
    asOf: asOf ?? sessions.at(-1)?.endedAt ?? new Date(0).toISOString(),
    placed,
    regions: bands.map((key, r) => ({
      key,
      label: sessions.find((x) => x.templateKey === key)!.label,
      sessions: perRegion[r].count,
      effort: perRegion[r].effort,
      peak: Math.max(0, peaks[r].h),
      peakX: peaks[r].x,
      peakY: peaks[r].y,
    })),
  };
}

export type GrowthChange = {
  key: string;
  label: string;
  before: number;
  after: number;
  percent: number | null;
  isNew: boolean;
  sessions: number;
};

/** What changed between two states of the same world, region by region (only regions that grew). */
export function growthBetween(before: World, after: World): GrowthChange[] {
  return after.regions
    .map((r) => {
      const prev = before.regions.find((p) => p.key === r.key);
      const percent = prev && prev.peak > 0 ? Math.round(((r.peak - prev.peak) / prev.peak) * 100) : null;
      return {
        key: r.key,
        label: r.label,
        before: prev?.peak ?? 0,
        after: r.peak,
        percent,
        isNew: !prev,
        sessions: r.sessions - (prev?.sessions ?? 0),
      };
    })
    .filter((c) => c.sessions > 0)
    .sort((a, b) => b.after - b.before - (a.after - a.before));
}

/** One line for the user: factual and short. */
export function growthSentence(changes: GrowthChange[], context: "workout" | "visit") {
  if (!changes.length) return null;
  const parts = changes
    .slice(0, 2)
    .map((c) =>
      c.isNew ? `a new ${c.label} range began` : c.percent != null && c.percent > 0 ? `${c.label} rose ${c.percent}%` : `${c.label} grew`,
    );
  const lead = context === "workout" ? "This workout" : "Since your last visit";
  const list = parts.length === 2 ? `${parts[0]} and ${parts[1]}` : parts[0];
  return `${lead}: ${list}.`;
}
