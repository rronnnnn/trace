/**
 * Shaded relief for the Training Landscape: an elevation tint (low ground darkest, summits
 * palest, so the record reads as growing upward) multiplied by hillshading lit from the
 * north-west, with vegetation on the low, gentle slopes around the water.
 *
 * Pure and deterministic: field + palette → RGBA pixels. Colours come from the caller (CSS
 * tokens), so light and dark themes share one renderer.
 */

import { hashString, type Terrain } from "./terrain";

export type RGB = [number, number, number];

export type ReliefPalette = {
  low: RGB;
  mid: RGB;
  high: RGB;
  vegetation: RGB;
  /** 0–1: how strongly slopes are shaded */
  shade: number;
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Unit normal-based lighting at a cell. Light from the upper left, the cartographic convention. */
function lighting(field: Float32Array, cols: number, rows: number, i: number, j: number, zScale: number) {
  const at = (x: number, y: number) => field[Math.min(rows - 1, Math.max(0, y)) * cols + Math.min(cols - 1, Math.max(0, x))];
  const dx = (at(i + 1, j) - at(i - 1, j)) * zScale;
  const dy = (at(i, j + 1) - at(i, j - 1)) * zScale;
  // normal (-dx, -dy, 1), light (-1, -1, 1.35) normalised
  const nl = Math.hypot(dx, dy, 1);
  const L = [-0.5807, -0.5807, 0.5703];
  const lambert = (-dx * L[0] + -dy * L[1] + L[2]) / nl;
  return { lambert, slope: Math.hypot(dx, dy) };
}

/** How much vegetation grows at a height/slope: low, gentle ground, thinning toward the summits. */
export function vegetationAt(height: number, slope: number) {
  return smoothstep(0.04, 0.16, height) * (1 - smoothstep(0.3, 0.5, height)) * (1 - smoothstep(0.25, 0.8, slope));
}

export function shadeRelief(terrain: Pick<Terrain, "field" | "cols" | "rows">, palette: ReliefPalette): Uint8ClampedArray<ArrayBuffer> {
  const { field, cols, rows } = terrain;
  const out = new Uint8ClampedArray(new ArrayBuffer(cols * rows * 4));
  const zScale = cols / 26;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const h = field[j * cols + i];
      const { lambert, slope } = lighting(field, cols, rows, i, j, zScale);
      // elevation tint: dark valleys, pale summits
      let c = h < 0.5 ? mix(palette.low, palette.mid, smoothstep(0, 0.5, h)) : mix(palette.mid, palette.high, smoothstep(0.5, 1, h));
      c = mix(c, palette.vegetation, 0.42 * vegetationAt(h, slope));
      // hillshade around a flat-ground value of 1, clamped so shadows stay soft
      const flat = 0.5703;
      const shade = Math.min(1.12, Math.max(0.72, 1 + (lambert - flat) * 0.8 * palette.shade));
      const k = (j * cols + i) * 4;
      out[k] = c[0] * shade;
      out[k + 1] = c[1] * shade;
      out[k + 2] = c[2] * shade;
      out[k + 3] = 255;
    }
  }
  return out;
}

/**
 * Sparse tree marks: a jittered grid, kept where vegetation is dense, away from water.
 * Returns normalised positions; the renderer draws them as tiny glyphs.
 */
export function treePositions(terrain: Pick<Terrain, "field" | "cols" | "rows" | "water">, seed: string, spacing = 0.022, aspect = 5 / 3) {
  const { field, cols, rows, water } = terrain;
  const zScale = cols / 26;
  const trees: [number, number][] = [];
  const stepX = spacing;
  const stepY = spacing * aspect;
  const s = hashString(seed + "trees");
  for (let gy = 0, y = stepY / 2; y < 1; gy++, y += stepY) {
    for (let gx = 0, x = stepX / 2; x < 1; gx++, x += stepX) {
      const r = hashString(`${s}:${gx}:${gy}`);
      const jx = x + ((r % 1000) / 1000 - 0.5) * stepX * 0.9;
      const jy = y + (((r >>> 10) % 1000) / 1000 - 0.5) * stepY * 0.9;
      if (jx < 0.02 || jx > 0.98 || jy < 0.03 || jy > 0.97) continue;
      const i = Math.round(jx * (cols - 1));
      const j = Math.round(jy * (rows - 1));
      const h = field[j * cols + i];
      const { slope } = lighting(field, cols, rows, i, j, zScale);
      const v = vegetationAt(h, slope);
      if (v < 0.5 || ((r >>> 20) % 1000) / 1000 > v * 0.55) continue;
      // keep clear of the water itself
      const ri = Math.round(jx * (water.river.length - 1));
      if (water.river.length && Math.abs(water.river[ri][1] - jy) < water.river[ri][2] + 0.02) continue;
      if (water.lakes.some((l) => ((jx - l.x) / (l.rx * 1.5)) ** 2 + ((jy - l.y) / (l.ry * 1.5)) ** 2 < 1)) continue;
      trees.push([jx, jy]);
    }
  }
  return trees;
}

/** Parses "#rrggbb" or "rgb(r g b)" / "rgb(r, g, b)" from a computed CSS custom property. */
export function parseColor(value: string, fallback: RGB): RGB {
  const v = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return fallback;
}
