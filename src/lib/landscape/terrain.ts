import type { RestSpan } from "./rest";

/**
 * Training Landscape terrain.
 *
 * Every visible feature comes from data and is reproducible:
 *  - each routine is a mountain range raised along its own spine: a gentle curve whose
 *    position, angle (diagonal, vertical, arcing…) and curvature are seeded by the routine and
 *    the user. Its sessions climb the spine in order, first session at one foot, newest at the
 *    far end. A session sits off the spine when its volume differs from that routine's average.
 *  - time flows with the river, oldest at the left edge, today at the right. Rest days swell
 *    the river into broad reaches and lakes at their dates.
 *  - a session raises a hill whose height follows its working volume (relative to the
 *    user's own sessions, never an absolute claim about muscle) and whose footprint follows
 *    the number of completed sets.
 *  - a quiet base terrain, seeded by the user id, keeps sparse histories legible and
 *    gives every person a recognisably different map. It never changes between renders.
 */

export type LandscapeSession = {
  id: string;
  endedAt: string; // ISO
  templateKey: string; // template id or name; groups sessions into bands
  label: string;
  volume: number;
  sets: number;
  prCount: number;
};

export type Landmark = {
  session: LandscapeSession;
  /** normalised 0–1 position */
  x: number;
  y: number;
  height: number;
  /** 0–1 position along the routine's spine (chronological) */
  u: number;
};

export type Lake = {
  /** normalised centre and radii (radii in x units; ry already corrected for aspect) */
  x: number;
  y: number;
  rx: number;
  ry: number;
  span: RestSpan;
};

export type Water = {
  /** river centre line, normalised [x, y, halfWidth] left to right; halfWidth in y units */
  river: [number, number, number][];
  /** hit areas for the swells, one per rest span */
  lakes: Lake[];
};

export type Terrain = {
  cols: number;
  rows: number;
  /** row-major heights, 0–1 */
  field: Float32Array;
  landmarks: Landmark[];
  bands: string[];
  water: Water;
};

export type TerrainOptions = {
  sessions: LandscapeSession[];
  seed: string;
  start: Date;
  end: Date;
  cols?: number;
  rows?: number;
  /** width / height of the drawing, so hills stay round */
  aspect?: number;
  /** Runs of rest days. They become lakes on a river that follows the valleys. */
  rest?: RestSpan[];
};

// ── deterministic hashing / noise ─────────────────────────────────────────────

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function lattice(seed: number, x: number, y: number) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function valueNoise(seed: number, x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smooth(x - xi);
  const ty = smooth(y - yi);
  const a = lattice(seed, xi, yi);
  const b = lattice(seed, xi + 1, yi);
  const c = lattice(seed, xi, yi + 1);
  const d = lattice(seed, xi + 1, yi + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

export function fbm(seed: number, x: number, y: number) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(seed + o * 1013, x * freq, y * freq);
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum; // ~0–0.94
}

/** Normalised horizontal position (0–1) of a moment within the window. Shared with overlays. */
export function timeToX(t: number) {
  return 0.06 + 0.88 * Math.min(1, Math.max(0, t));
}

export function dateToX(date: string | Date, start: Date, end: Date) {
  const t0 = start.getTime();
  return timeToX((new Date(date).getTime() - t0) / Math.max(1, end.getTime() - t0));
}

/** Ridged multifractal: sharp crests and gullies, the texture of real mountain ranges. */
export function ridged(seed: number, x: number, y: number) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < 4; o++) {
    const n = 1 - Math.abs(2 * valueNoise(seed + 311 * o, x * freq, y * freq) - 1);
    sum += amp * n * n;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum;
}

/**
 * A routine's range: a quadratic curve through a seeded centre, at a seeded angle and
 * curvature. Centres spread around the map so ranges rarely sit on top of each other.
 * Returns u → [x, y, normalX, normalY] in normalised map units (normals in screen space).
 */
function rangeSpine(key: string, k: number, n: number, seed: string, aspect: number) {
  const h = hashString(`${key}:${seed}`);
  const r1 = (h % 1000) / 1000;
  const r2 = ((h >>> 10) % 1000) / 1000;
  const r3 = ((h >>> 20) % 1000) / 1000;
  const turn = ((hashString(seed) % 1000) / 1000) * Math.PI * 2;
  // centre: on a loose ring for several routines, mid-map for one
  const ring = n === 1 ? 0 : n === 2 ? 0.22 : 0.3;
  const a = turn + (k / n) * Math.PI * 2 + (r1 - 0.5) * 0.5;
  const cx = (0.5 + ring * 0.95 * Math.cos(a)) * aspect;
  const cy = 0.5 + ring * 0.78 * Math.sin(a);
  // orientation: anything from horizontal to vertical, never a uniform set
  const angles = [0.15, 0.7, 1.45, -0.6, 2.4, 1.05, -1.25];
  const theta = angles[(h >>> 3) % angles.length] + (r2 - 0.5) * 0.4;
  const len = (0.42 + 0.22 * r3) * Math.min(aspect, 1.6);
  const bend = (r1 - 0.5) * 0.7;
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  const ax = cx - (dx * len) / 2;
  const ay = cy - (dy * len) / 2;
  const bx = cx + (dx * len) / 2;
  const by = cy + (dy * len) / 2;
  const qx = cx - dy * bend * len;
  const qy = cy + dx * bend * len;
  return (u: number): [number, number, number, number] => {
    const v = 1 - u;
    const x = v * v * ax + 2 * v * u * qx + u * u * bx;
    const y = v * v * ay + 2 * v * u * qy + u * u * by;
    const tx = 2 * v * (qx - ax) + 2 * u * (bx - qx);
    const ty = 2 * v * (qy - ay) + 2 * u * (by - qy);
    const tl = Math.hypot(tx, ty) || 1;
    // clamp the spine into the map so no range runs off the edge
    return [Math.min(0.94, Math.max(0.06, x / aspect)), Math.min(0.9, Math.max(0.1, y)), -ty / tl, tx / tl];
  };
}

// ── terrain ──────────────────────────────────────────────────────────────────

export function buildTerrain({ sessions, seed, start, end, cols = 120, rows = 72, aspect = 5 / 3, rest = [] }: TerrainOptions): Terrain {
  const s = hashString(seed);
  const field = new Float32Array(cols * rows);

  const t0 = start.getTime();
  const inWindow = sessions.filter((x) => {
    const t = new Date(x.endedAt).getTime();
    return t >= t0 && t <= end.getTime();
  });

  // Bands ordered by first appearance so the map is stable as history grows.
  const bands: string[] = [];
  for (const x of [...inWindow].sort((a, b) => a.endedAt.localeCompare(b.endedAt))) {
    if (!bands.includes(x.templateKey)) bands.push(x.templateKey);
  }
  const spines = new Map(bands.map((key, k) => [key, rangeSpine(key, k, bands.length, seed, aspect)]));

  // Each routine's typical volume, so a session can sit off its spine when it differs.
  const meanVolume = new Map<string, number>();
  for (const key of bands) {
    const vols = inWindow.filter((x) => x.templateKey === key).map((x) => x.volume);
    meanVolume.set(key, vols.reduce((a, b) => a + b, 0) / Math.max(1, vols.length));
  }

  const maxVolume = Math.max(1, ...inWindow.map((x) => x.volume));
  const maxSets = Math.max(1, ...inWindow.map((x) => x.sets));

  const rank = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const x of [...inWindow].sort((a, b) => a.endedAt.localeCompare(b.endedAt) || a.id.localeCompare(b.id))) {
    const n = counts.get(x.templateKey) ?? 0;
    rank.set(x.id, n);
    counts.set(x.templateKey, n + 1);
  }

  const landmarks: Landmark[] = inWindow.map((x) => {
    const n = counts.get(x.templateKey)!;
    const u = n === 1 ? 0.5 : 0.06 + (0.88 * rank.get(x.id)!) / (n - 1);
    const spine = spines.get(x.templateKey)!;
    const [px, py, nx, ny] = spine(u);
    // heavier-than-usual sessions sit to one side of the crest, lighter ones to the other
    const mean = meanVolume.get(x.templateKey) || 1;
    const lift = Math.max(-0.35, Math.min(0.35, (x.volume - mean) / mean)) * 0.09;
    const jitter = ((hashString(x.id) % 1000) / 1000 - 0.5) * 0.03;
    const off = lift + jitter;
    return {
      session: x,
      x: Math.min(0.96, Math.max(0.04, px + (nx * off) / aspect)),
      y: Math.min(0.93, Math.max(0.07, py + ny * off)),
      height: 0,
      u,
    };
  });

  // A short history raises gentler hills, so the base terrain stays legible around them;
  // the landscape gains relief as the record grows.
  const relief = Math.min(1, 0.4 + inWindow.length / 24);
  const hills = landmarks.map((l) => {
    const v = l.session.volume > 0 ? l.session.volume / maxVolume : l.session.sets / maxSets;
    return {
      x: l.x,
      y: l.y,
      amp: relief * (0.24 + 0.46 * Math.sqrt(v)),
      sigma: 0.022 + 0.02 * (l.session.sets / maxSets),
    };
  });

  for (let j = 0; j < rows; j++) {
    const ny = j / (rows - 1);
    for (let i = 0; i < cols; i++) {
      const nx = i / (cols - 1);
      // base terrain: gentle, seeded, slightly stretched along time
      let h = 0.42 * fbm(s, nx * 2.1, ny * 1.6) + 0.08 * Math.sin((nx * 2.3 + ny * 1.1 + (s % 97) / 97) * Math.PI);
      let mass = 0;
      for (const hill of hills) {
        const dx = (nx - hill.x) * aspect;
        const dy = ny - hill.y;
        const d2 = dx * dx + dy * dy;
        const r2 = hill.sigma * hill.sigma * aspect;
        if (d2 < r2 * 16) mass += hill.amp * Math.exp(-d2 / (2 * r2));
      }
      // Training raises the mass; ridged detail scaled by that mass carves spurs and gullies into
      // it, so trained-on ground reads as mountains while untrained lowland stays smooth.
      const crag = ridged(s + 1, nx * 9, ny * 6.5);
      h += mass * (0.42 + 1.25 * crag);
      field[j * cols + i] = h;
    }
  }

  const water = carveWater(field, cols, rows, aspect, rest, start, end, s);

  let min = Infinity;
  let max = -Infinity;
  for (const h of field) {
    if (h < min) min = h;
    if (h > max) max = h;
  }

  const range = max - min || 1;
  // A gentle power curve: summits rise out of their ranges instead of reading as mesas,
  // and the valleys (where the water runs) open up.
  for (let k = 0; k < field.length; k++) field[k] = Math.pow((field[k] - min) / range, 1.55);

  for (const l of landmarks) {
    const i = Math.round(l.x * (cols - 1));
    const j = Math.round(l.y * (rows - 1));
    l.height = field[j * cols + i];
  }

  return { cols, rows, field, landmarks, bands, water };
}

// ── water ────────────────────────────────────────────────────────────────────

/**
 * Finds the river (the cheapest left-to-right path through low ground, moving at most one row
 * per column) and carves it, plus one lake per rest span, into the field. Runs before
 * normalisation so contours wrap the water naturally. Deterministic: same field, same river.
 */
export function carveWater(
  field: Float32Array,
  cols: number,
  rows: number,
  aspect: number,
  rest: RestSpan[],
  start: Date,
  end: Date,
  seed: number,
  /** route through this field instead of the heights (keeps the river's course stable as terrain grows) */
  costField: Float32Array = field,
  /** carve depth in field units; defaults to a share of the field's own range */
  depthAbs?: number,
): Water {
  // Dynamic programming over columns. Cost is height, plus a pull away from the map edges and a
  // small price for each change of row, so the river meanders instead of zig-zagging.
  const edge = (j: number) => {
    const ny = j / (rows - 1);
    // stay off the map edges, and drift toward the middle rather than hugging a border
    return (ny < 0.14 || ny > 0.86 ? 0.6 : 0) + 0.9 * (ny - 0.5) * (ny - 0.5);
  };
  const cost = new Float32Array(cols * rows);
  const from = new Int16Array(cols * rows);
  // Seeded noise in the cost lets the river wander the way real water does, around small rises.
  const wander = (i: number, j: number) => 0.35 * fbm(seed + 77, (i / cols) * 5, (j / rows) * 4);
  for (let j = 0; j < rows; j++) cost[j * cols] = costField[j * cols] + edge(j) + wander(0, j);
  for (let i = 1; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      let best = Infinity;
      let arg = j;
      for (let d = -1; d <= 1; d++) {
        const pj = j + d;
        if (pj < 0 || pj >= rows) continue;
        const c = cost[pj * cols + i - 1] + (d ? 0.006 : 0);
        if (c < best) {
          best = c;
          arg = pj;
        }
      }
      cost[j * cols + i] = best + costField[j * cols + i] + edge(j) + wander(i, j);
      from[j * cols + i] = arg;
    }
  }
  let end_j = 0;
  for (let j = 1; j < rows; j++) if (cost[j * cols + cols - 1] < cost[end_j * cols + cols - 1]) end_j = j;
  const rowsAt = new Array<number>(cols);
  for (let i = cols - 1, j = end_j; i >= 0; i--) {
    rowsAt[i] = j;
    j = from[j * cols + i];
  }
  // Smooth the stepped path into a river line: two wide box passes (≈ a Gaussian), so the
  // row-by-row steps of the search never show as kinks in the water.
  const box = (src: number[], win: number) =>
    src.map((_, i) => {
      let sum = 0;
      let n = 0;
      for (let k = i - win; k <= i + win; k++) {
        if (k < 0 || k >= src.length) continue;
        sum += src[k];
        n++;
      }
      return sum / n;
    });
  const win = Math.max(3, Math.round(cols / 14));
  const yAt = box(box(rowsAt, win), win).map((r) => r / (rows - 1));
  // Width: a slender stream that swells smoothly into broad reaches at rest spans, so the
  // water is one continuous river and rest reads as where it widens and slows.
  const BASE = 0.0032;
  const swells = rest.map((span) => {
    const x = dateToX(span.at, start, end);
    // spread in x roughly matches the span's length on the time axis, never thinner than a pool
    const spread = Math.max(0.005, (span.days / Math.max(1, (end.getTime() - start.getTime()) / 86400000)) * 0.88 * 0.5);
    // a day off is a bulge in the stream, a weekend a small lake, a longer rest a broad one
    const amp = 0.0022 + 0.0042 * Math.pow(span.days, 0.85);
    return { x, spread, amp, span };
  });
  const widthAt = (x: number) => {
    let w = BASE;
    for (const sw of swells) {
      const d = (x - sw.x) / sw.spread;
      if (d * d < 25) w += sw.amp * Math.exp(-(d * d) / 2);
    }
    return w;
  };
  const river: [number, number, number][] = yAt.map((y, i) => {
    const x = i / (cols - 1);
    return [x, y, widthAt(x) * aspect * 0.6];
  });

  const riverY = (x: number) => {
    const f = Math.min(cols - 1, Math.max(0, x * (cols - 1)));
    const i = Math.floor(f);
    const t = f - i;
    return yAt[i] * (1 - t) + (yAt[Math.min(cols - 1, i + 1)] ?? yAt[i]) * t;
  };

  // Hit areas for tooltips and selection: one per swell.
  const lakes: Lake[] = swells.map((sw) => ({
    x: sw.x,
    y: riverY(sw.x),
    rx: sw.spread * 1.6,
    ry: widthAt(sw.x) * aspect * 0.6,
    span: sw.span,
  }));

  // Carve a valley under the river, deeper and wider where it swells, so contours follow it.
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of field) {
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  const depth = depthAbs ?? (hi - lo) * 0.16;
  // One smooth valley profile along the whole river (varying it per column streaks the shading).
  const sigma = 0.035;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const dy = j / (rows - 1) - yAt[i];
      if (Math.abs(dy) > sigma * 4) continue;
      field[j * cols + i] -= depth * 0.6 * Math.exp(-(dy * dy) / (2 * sigma * sigma));
    }
  }

  return { river, lakes };
}
