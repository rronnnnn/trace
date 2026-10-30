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
import { carveWater, fbm, hashString, type Landmark, type LandscapeSession, type Terrain } from "./terrain";

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
  /** the measured records behind `records`, for landmarks */
  prs?: { exerciseId: string; name: string; kind: "heaviest_weight" | "most_reps"; weight: number | null; reps: number | null }[];
  isSample?: boolean;
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


// ── rock: gradient noise (no lattice squares) and a ridged multifractal for crests and gullies ──
function hash2(seed: number, x: number, y: number) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
/** Perlin-style gradient noise, roughly −1…1. Smooth everywhere, no grid-aligned plateaus. */
export function gradientNoise(seed: number, x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const g = (ix: number, iy: number, dx: number, dy: number) => {
    const a = (hash2(seed, ix, iy) & 1023) * ((Math.PI * 2) / 1024);
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const u = fade(fx);
  const v = fade(fy);
  const a = g(xi, yi, fx, fy) + (g(xi + 1, yi, fx - 1, fy) - g(xi, yi, fx, fy)) * u;
  const b = g(xi, yi + 1, fx, fy - 1) + (g(xi + 1, yi + 1, fx - 1, fy - 1) - g(xi, yi + 1, fx, fy - 1)) * u;
  return (a + (b - a) * v) * 1.414;
}

/**
 * Ridged multifractal (Musgrave): knife-edge crests with gullies between, detail concentrated
 * on the high rock. Each octave is rotated, so no ridge lines up with the mesh grid. ~0…1.
 */
export function crags(seed: number, x: number, y: number, octaves = 4) {
  let sum = 0;
  let weight = 1;
  let amp = 0.55;
  let px = x;
  let py = y;
  const c = Math.cos(0.83);
  const sn = Math.sin(0.83);
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(gradientNoise(seed + o * 7919, px, py));
    n *= n;
    n *= weight;
    weight = Math.min(1, n * 1.8);
    sum += n * amp;
    amp *= o === octaves - 2 ? 0.38 : 0.5; // the finest octave stays faint: no shimmer at grid scale
    const qx = px * c - py * sn;
    py = (px * sn + py * c) * 1.93 + 17.1;
    px = qx * 1.93 + 31.7;
  }
  return sum / 0.95;
}

type Peak = { x: number; y: number; amp: number; r: number };

/** The summits along a range: fixed by the routine's spine, revealed as effort reaches them. */
function rangePeaks(spine: Spine, key: string, seed: string, aspect: number): Peak[] {
  const rnd = (i: number) => (hashString(`${key}:${seed}:peak:${i}`) % 100000) / 100000;
  const count = 9;
  const main = Math.floor(rnd(0) * 3) + 1; // the highest summit, early on the range
  return Array.from({ length: count }, (_, i) => {
    const u = Math.min(0.98, Math.max(0.02, 0.03 + (0.94 * i) / (count - 1) + (rnd(i * 4 + 1) - 0.5) * 0.06));
    const [px, py, nx, ny] = spine.at(u);
    const side = (rnd(i * 4 + 2) - 0.5) * 0.07;
    const fromMain = Math.abs(i - main);
    return {
      x: px + (nx * side) / aspect,
      y: py + ny * side,
      amp: fromMain === 0 ? 1 : Math.max(0.42, 0.88 - 0.07 * fromMain) * (0.75 + 0.25 * rnd(i * 4 + 3)),
      r: 0.07 + 0.05 * rnd(i * 4 + 4),
    };
  });
}

type Spine = { at: (u: number) => [number, number, number, number]; cx: number; cy: number };

/** A routine's spine: seeded by the routine and the user, kept clear of earlier regions. */
function placeSpine(key: string, seed: string, aspect: number, taken: { cx: number; cy: number }[]): Spine {
  const rnd = (i: number) => (hashString(`${key}:${seed}:${i}`) % 100000) / 100000;
  let best = { cx: 0.5, cy: 0.5, score: -Infinity };
  for (let i = 0; i < 40; i++) {
    // ranges cluster into one massif near the middle, not scattered islands
    const cx = 0.34 + 0.32 * rnd(i * 2);
    const cy = 0.34 + 0.32 * rnd(i * 2 + 1);
    const nearest = taken.length ? Math.min(...taken.map((t) => Math.hypot((t.cx - cx) * aspect, t.cy - cy))) : 1;
    if (nearest >= 0.16) {
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
  const peaksOf = bands.map((key, r) => rangePeaks(spines[r], key, seed, aspect));

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
  // effort says how *much* mountain stands where (a broad mass); the summits and rock come from the
  // range's fixed shape below, so a range grows taller without ever turning into a smooth dome
  const sc = SIGMA * 1.9;
  const reach = sc * 5;
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
  const baseField = new Float32Array(n);
  for (let j = 0; j < rows; j++) {
    const ny = j / (rows - 1);
    for (let i = 0; i < cols; i++) {
      const nx = i / (cols - 1);
      const k = j * cols + i;
      const base = 0.075 * fbm(s, nx * 2.1, ny * 1.6) + 0.025 * Math.sin((nx * 2.3 + ny * 1.1 + (s % 97) / 97) * Math.PI);
      let h = base;
      let lay = base;
      baseField[k] = base;
      let top = 0;
      let topRegion = -1;
      // distance to every range's spine: where ranges run (independent of how tall they are)
      const spineD = spineSamples.map((samples) => {
        let d2min = Infinity;
        for (const [sx, sy] of samples) {
          const dx = (nx - sx) * aspect;
          const dy = ny - sy;
          d2min = Math.min(d2min, dx * dx + dy * dy);
        }
        return Math.sqrt(d2min);
      });
      for (let r = 0; r < bands.length; r++) {
        const e = effortGrid[r][k];
        if (e <= 0.0005) continue;
        const mass = heightFor(e);
        // warp the ground a little so summits are irregular, never round cones
        const wx = nx * aspect + 0.035 * gradientNoise(s + 41 + r * 13, nx * 7, ny * 7);
        const wy = ny + 0.035 * gradientNoise(s + 43 + r * 13, nx * 7 + 9.3, ny * 7);
        // pointed summits: concave flanks rising to a sharp tip, joined by a jagged spine
        let summit = 0;
        for (const p of peaksOf[r]) {
          const t = Math.hypot(wx - p.x * aspect, wy - p.y) / p.r;
          if (t < 1) summit = Math.max(summit, p.amp * Math.pow(1 - t, 1.7));
        }
        const ridge = 0.32 * Math.pow(Math.max(0, 1 - spineD[r] / 0.11), 1.4);
        const shape = Math.max(summit, ridge);
        const rock = crags(s + 3 + r * 13, wx * 6.5, wy * 6.5);
        // fixed, positive multipliers: a vertex still only ever rises as effort grows
        const shaped = mass * (2.1 * shape * (0.45 + 0.85 * rock) + 0.16 * rock);
        h += shaped;
        if (shaped > top) {
          top = shaped;
          topRegion = r;
        }
        if (shaped > peaks[r].h) peaks[r] = { h: shaped, x: nx, y: ny };
      }
      // the layout only knows *where* ranges run (their whole spine, from the first session on),
      // never how tall they are, so the river's course doesn't move as they grow
      for (let r = 0; r < bands.length; r++) lay += 0.14 * Math.exp(-(spineD[r] * spineD[r]) / (2 * 0.07 * 0.07));
      field[k] = h;
      layout[k] = lay;
      if (topRegion >= 0 && top > 0.012) {
        regionIndex[k] = topRegion;
        const t = Math.min(1, top / 0.08);
        regionStrength[k] = t * t * (3 - 2 * t);
      }
    }
  }

  const uncarved = field.slice();
  const water = carveWater(field, cols, rows, aspect, rest, timeStart, timeEnd, s, layout, 0.05);
  // keep the lowest ground at zero after carving. The offset comes from the base ground alone
  // (the carve only cuts down, by the same amount whatever stands there), so it never shifts as
  // ranges grow and no vertex can sink.
  let min = Infinity;
  for (let k = 0; k < n; k++) min = Math.min(min, baseField[k] - (uncarved[k] - field[k]));
  for (let k = 0; k < n; k++) field[k] = Math.max(0, field[k] - min);

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
