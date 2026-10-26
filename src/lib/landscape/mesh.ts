/**
 * Geometry for the 3D Training Landscape, as plain typed arrays (no WebGL dependency, so it is
 * unit-tested and could feed any renderer).
 *
 * World space: x across the map (0…SIZE_X), z down the map (0…SIZE_Z), y up. One terrain field
 * cell maps to one vertex. Edges fall smoothly to the ground plane, so the map has no rim and
 * melts into the horizon instead of sitting in a square window.
 */

import { vegetationAt, type RGB } from "./relief";
import type { Terrain } from "./terrain";

export const SIZE_X = 100;
export const SIZE_Z = 64;

export type MeshPalette = { low: RGB; mid: RGB; high: RGB; vegetation: RGB };

export type TerrainMesh = {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  cols: number;
  rows: number;
  /** world height at normalised map coordinates */
  heightAt: (nx: number, ny: number) => number;
  /** the river's smoothed bed height at a normalised x, when the terrain has a river */
  riverBed: ((nx: number) => number) | null;
  heightScale: number;
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 1 inside the map, falling to 0 at its borders. */
export function edgeFalloff(nx: number, ny: number, margin = 0.07) {
  return smoothstep(0, margin, nx) * smoothstep(0, margin, 1 - nx) * smoothstep(0, margin, ny) * smoothstep(0, margin, 1 - ny);
}

export function terrainMesh(
  terrain: Pick<Terrain, "field" | "cols" | "rows"> & Partial<Pick<Terrain, "water">>,
  palette: MeshPalette,
  heightScale = 13,
  riverWiden = 1,
): TerrainMesh {
  const { field, cols, rows } = terrain;
  const positions = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  const heights = new Float32Array(cols * rows);

  for (let j = 0; j < rows; j++) {
    const ny = j / (rows - 1);
    for (let i = 0; i < cols; i++) {
      const nx = i / (cols - 1);
      const k = j * cols + i;
      const h = field[k] * edgeFalloff(nx, ny);
      heights[k] = h * heightScale;
      positions[k * 3] = nx * SIZE_X;
      positions[k * 3 + 1] = heights[k];
      positions[k * 3 + 2] = ny * SIZE_Z;

      // elevation tint: dark valleys, pale summits; vegetation on low gentle ground
      const at = (x: number, y: number) => field[Math.min(rows - 1, Math.max(0, y)) * cols + Math.min(cols - 1, Math.max(0, x))];
      const slope = Math.hypot(at(i + 1, j) - at(i - 1, j), at(i, j + 1) - at(i, j - 1)) * (cols / 26);
      const t = h < 0.5 ? h / 0.5 : (h - 0.5) / 0.5;
      const a = h < 0.5 ? palette.low : palette.mid;
      const b = h < 0.5 ? palette.mid : palette.high;
      const veg = 0.5 * vegetationAt(h, slope);
      for (let c = 0; c < 3; c++) {
        const base = a[c] + (b[c] - a[c]) * t;
        colors[k * 3 + c] = (base + (palette.vegetation[c] - base) * veg) / 255;
      }
    }
  }

  // Carve the channel. The bed follows a smoothed profile along the river (water lies nearly
  // level, never climbing a saddle in steps), and nothing inside the banks stands above it,
  // so the water surface is never pierced by ground. The river has one point per column.
  const river = terrain.water?.river;
  let bedProfile: Float32Array | null = null;
  if (river && river.length === cols) {
    const raw = new Float32Array(cols);
    for (let i = 0; i < cols; i++) {
      const jc = Math.min(rows - 1, Math.max(0, Math.round(river[i][1] * (rows - 1))));
      raw[i] = heights[jc * cols + i];
    }
    const box = (src: Float32Array, win: number) =>
      src.map((_, i) => {
        let sum = 0;
        let n = 0;
        for (let k = Math.max(0, i - win); k <= Math.min(src.length - 1, i + win); k++) {
          sum += src[k];
          n++;
        }
        return sum / n;
      });
    const win = Math.max(2, Math.round(cols / 12));
    // never higher than the lowest nearby ground, so the channel only ever cuts down
    bedProfile = box(box(raw, win), win).map((v, i) => Math.min(v, raw[i]));
    bedProfile = box(bedProfile, Math.max(1, Math.round(win / 2)));
    for (let i = 0; i < cols; i++) {
      const [, ry, w] = river[i];
      const taper = edgeFalloff(i / (cols - 1), 0.5, 0.16);
      if (taper <= 0) continue;
      // the water can be slimmer than a grid cell: the channel must still span whole rows, or the
      // ground between rows would interpolate up through the surface
      const half = Math.max(w * riverWiden * taper * 1.9, 1.6 / (rows - 1));
      for (let j = 0; j < rows; j++) {
        const d = Math.abs(j / (rows - 1) - ry);
        if (d > half * 1.6) continue;
        const k = j * cols + i;
        // flat under the water, easing back up to the original ground across the bank
        const t = d <= half ? 0 : smoothstep(half, half * 1.6, d);
        const target = bedProfile[i] + (heights[k] - bedProfile[i]) * t;
        if (heights[k] > target) {
          heights[k] = target;
          positions[k * 3 + 1] = target;
        }
      }
    }
  }

  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let n = 0;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices[n++] = a;
      indices[n++] = c;
      indices[n++] = b;
      indices[n++] = b;
      indices[n++] = c;
      indices[n++] = d;
    }
  }

  const heightAt = (nx: number, ny: number) => {
    const fx = Math.min(cols - 1, Math.max(0, nx * (cols - 1)));
    const fy = Math.min(rows - 1, Math.max(0, ny * (rows - 1)));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(cols - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const top = heights[y0 * cols + x0] * (1 - tx) + heights[y0 * cols + x1] * tx;
    const bottom = heights[y1 * cols + x0] * (1 - tx) + heights[y1 * cols + x1] * tx;
    return top * (1 - ty) + bottom * ty;
  };

  const profile = bedProfile;
  const riverBed = profile
    ? (nx: number) => {
        const f = Math.min(cols - 1, Math.max(0, nx * (cols - 1)));
        const i = Math.floor(f);
        const t = f - i;
        return profile[i] * (1 - t) + profile[Math.min(cols - 1, i + 1)] * t;
      }
    : null;

  return { positions, colors, indices, cols, rows, heightAt, riverBed, heightScale };
}

/** Chaikin corner cutting: each pass rounds every corner; a few passes leave no edges at all. */
export function chaikin<T extends number[]>(pts: T[], passes = 3): T[] {
  let out = pts;
  for (let p = 0; p < passes; p++) {
    if (out.length < 3) return out;
    const next: T[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i];
      const b = out[i + 1];
      next.push(a.map((v, k) => v * 0.75 + b[k] * 0.25) as T, a.map((v, k) => v * 0.25 + b[k] * 0.75) as T);
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/**
 * River surface as a triangle strip. The centre line and widths are smoothed with Chaikin passes,
 * and the surface sits just above the carved bed so it reads as water lying in the valley.
 */
export function riverMesh(
  river: [number, number, number][],
  heightAt: (nx: number, ny: number) => number,
  lift = 0.3,
  widen = 1,
  bed: ((nx: number) => number) | null = null,
) {
  if (river.length < 3) return null;
  const step = Math.max(1, Math.round(river.length / 120));
  const sampled = river.filter((_, i) => i % step === 0 || i === river.length - 1);
  const smooth = chaikin(
    sampled.map(([x, y, w]) => [x, y, w]),
    3,
  );
  const positions = new Float32Array(smooth.length * 2 * 3);
  const centre: [number, number, number][] = [];
  smooth.forEach(([x, y, w], i) => {
    const a = smooth[Math.max(0, i - 1)];
    const b = smooth[Math.min(smooth.length - 1, i + 1)];
    const tx = (b[0] - a[0]) * SIZE_X;
    const tz = (b[1] - a[1]) * SIZE_Z;
    const tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl;
    const nz = tx / tl;
    // taper to nothing where the terrain fades out, so the water never pokes past the map's edge
    const half = w * SIZE_Z * widen * edgeFalloff(x, 0.5, 0.16);
    const cx = x * SIZE_X;
    const cz = y * SIZE_Z;
    // water is level across the channel; on diagonal reaches the banks sit over other columns,
    // so take the highest bed under the centre and both banks
    const lx = (cx + nx * half) / SIZE_X;
    const rx = (cx - nx * half) / SIZE_X;
    const level = (bed ? Math.max(bed(x), bed(lx), bed(rx)) : heightAt(x, y)) + lift;
    positions.set([cx + nx * half, level, cz + nz * half], i * 6);
    positions.set([cx - nx * half, level, cz - nz * half], i * 6 + 3);
    centre.push([cx, level, cz]);
  });
  const indices = new Uint32Array((smooth.length - 1) * 6);
  for (let i = 0; i < smooth.length - 1; i++) {
    const a = i * 2;
    indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }
  return { positions, indices, centre };
}

/** Normalised map point → world position on the surface. */
export function toWorld(nx: number, ny: number, heightAt: (nx: number, ny: number) => number, lift = 0) {
  return [nx * SIZE_X, heightAt(nx, ny) + lift, ny * SIZE_Z] as [number, number, number];
}
