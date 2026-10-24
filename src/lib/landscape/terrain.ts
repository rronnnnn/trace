/**
 * Training Landscape terrain.
 *
 * Every visible feature comes from data and is reproducible:
 *  - x is time. Each session sits at its date within the window.
 *  - y is the routine. Sessions of the same template share a latitude band that meanders
 *    along time, so a program reads as a set of ridgelines. Within its band a session sits
 *    higher when its volume is above that routine's average and lower when below.
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
};

export type Terrain = {
  cols: number;
  rows: number;
  /** row-major heights, 0–1 */
  field: Float32Array;
  landmarks: Landmark[];
  bands: string[];
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

function fbm(seed: number, x: number, y: number) {
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

// ── terrain ──────────────────────────────────────────────────────────────────

export function buildTerrain({ sessions, seed, start, end, cols = 120, rows = 72, aspect = 5 / 3 }: TerrainOptions): Terrain {
  const s = hashString(seed);
  const field = new Float32Array(cols * rows);

  const t0 = start.getTime();
  const span = Math.max(1, end.getTime() - t0);
  const inWindow = sessions.filter((x) => {
    const t = new Date(x.endedAt).getTime();
    return t >= t0 && t <= end.getTime();
  });

  // Bands ordered by first appearance so the map is stable as history grows.
  const bands: string[] = [];
  for (const x of [...inWindow].sort((a, b) => a.endedAt.localeCompare(b.endedAt))) {
    if (!bands.includes(x.templateKey)) bands.push(x.templateKey);
  }
  const bandY = (key: string) => {
    const n = Math.max(bands.length, 1);
    const i = bands.indexOf(key);
    // spread bands across the middle 70%, with a seeded wobble so it never looks gridded
    const base = n === 1 ? 0.5 : 0.18 + (0.64 * i) / (n - 1);
    return base + ((hashString(key + seed) % 1000) / 1000 - 0.5) * 0.08;
  };

  const maxVolume = Math.max(1, ...inWindow.map((x) => x.volume));
  const maxSets = Math.max(1, ...inWindow.map((x) => x.sets));

  // Each routine's typical volume, so a session can sit above or below its own ridge.
  const meanVolume = new Map<string, number>();
  for (const key of bands) {
    const vols = inWindow.filter((x) => x.templateKey === key).map((x) => x.volume);
    meanVolume.set(key, vols.reduce((a, b) => a + b, 0) / Math.max(1, vols.length));
  }

  const landmarks: Landmark[] = inWindow.map((x) => {
    const t = (new Date(x.endedAt).getTime() - t0) / span;
    const nx = timeToX(t);
    // ridges meander along time with a phase unique to the routine (and the user)
    const phase = (hashString(x.templateKey + seed) % 628) / 100;
    const meander = 0.055 * Math.sin(nx * Math.PI * 2.2 + phase);
    // heavier-than-usual sessions climb toward the top of their ridge, lighter ones settle below
    const mean = meanVolume.get(x.templateKey) || 1;
    const lift = Math.max(-0.35, Math.min(0.35, (x.volume - mean) / mean)) * -0.1;
    const jitter = ((hashString(x.id) % 1000) / 1000 - 0.5) * 0.025;
    return {
      session: x,
      x: nx,
      y: Math.min(0.9, Math.max(0.1, bandY(x.templateKey) + meander + lift + jitter)),
      height: 0,
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

  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < rows; j++) {
    const ny = j / (rows - 1);
    for (let i = 0; i < cols; i++) {
      const nx = i / (cols - 1);
      // base terrain: gentle, seeded, slightly stretched along time
      let h = 0.42 * fbm(s, nx * 2.1, ny * 1.6) + 0.08 * Math.sin((nx * 2.3 + ny * 1.1 + (s % 97) / 97) * Math.PI);
      for (const hill of hills) {
        const dx = (nx - hill.x) * aspect;
        const dy = ny - hill.y;
        const d2 = dx * dx + dy * dy;
        const r2 = hill.sigma * hill.sigma * aspect;
        if (d2 < r2 * 16) h += hill.amp * Math.exp(-d2 / (2 * r2));
      }
      field[j * cols + i] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }

  const range = max - min || 1;
  for (let k = 0; k < field.length; k++) field[k] = (field[k] - min) / range;

  for (const l of landmarks) {
    const i = Math.round(l.x * (cols - 1));
    const j = Math.round(l.y * (rows - 1));
    l.height = field[j * cols + i];
  }

  return { cols, rows, field, landmarks, bands };
}
