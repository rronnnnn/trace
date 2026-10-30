/**
 * The Frontier: the unexplored world beyond the developed landscape.
 *
 * The developed world (the routine ranges and the river) is the 100 × 64 map and is not touched
 * here. Around it lies a ring of distant ranges that never carry data: they fade out of mist at
 * the map's edge and into the horizon beyond. Two things bring the frontier closer:
 *  - `reach`, a 0–1 measure of how much history there is: the mist thins as the world grows
 *    (never thickens; the count of workouts only rises);
 *  - discovered summits: the ground around a summit you have reached comes out of the mist.
 *
 * Hidden summits sit on fixed slots around the far side and flanks of the map (the side the camera
 * looks toward), seeded by the user, so each person's frontier is their own and a summit never
 * moves. All functions are pure and deterministic.
 */

import { hashString } from "./terrain";
import { crags, gradientNoise } from "./world";
import { SIZE_X, SIZE_Z } from "./mesh";
import type { WorldLandmark } from "./landmarks";

export type SummitSpot = { slot: number; x: number; z: number; height: number };

/** World-unit extent of the frontier ring around the map. */
export const FRONTIER = { minX: -62, maxX: SIZE_X + 62, minZ: -56, maxZ: SIZE_Z + 44, step: 2 };

/** Workouts → how far the mist has drawn back (0 at the start, toward 1 over a long history). */
export const frontierReach = (workouts: number) => 1 - Math.exp(-Math.max(0, workouts) / 60);

/** Distance (world units) from a point to the developed map; 0 inside it. */
export function outside(x: number, z: number) {
  const dx = Math.max(0, -x, x - SIZE_X);
  const dz = Math.max(0, -z, z - SIZE_Z);
  return Math.hypot(dx, dz);
}

/** The fixed place of every summit slot, beyond the map's far side and flanks. */
export function summitSpots(seed: string, count: number): SummitSpot[] {
  const rnd = (i: number) => (hashString(`${seed}:summit:${i}`) % 100000) / 100000;
  const cx = SIZE_X / 2;
  const cz = SIZE_Z / 2;
  // from the east flank, round the far (north) side, to the west flank
  const a0 = 0.32;
  const a1 = -Math.PI - 0.32;
  return Array.from({ length: count }, (_, slot) => {
    // interleave so neighbouring slots (filled in order) spread round the ring
    const k = (slot * 5) % count;
    const tt = count > 1 ? k / (count - 1) : 0.5;
    const a = a0 + (a1 - a0) * tt + (rnd(slot * 3) - 0.5) * 0.12;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // where the ray leaves the map, then out into the frontier
    const sx = dx === 0 ? Infinity : (dx > 0 ? SIZE_X - cx : -cx) / dx;
    const sz = dz === 0 ? Infinity : (dz > 0 ? SIZE_Z - cz : -cz) / dz;
    const edge = Math.min(Math.abs(sx), Math.abs(sz));
    const out = 10 + 10 * rnd(slot * 3 + 1);
    return { slot, x: cx + dx * (edge + out), z: cz + dz * (edge + out), height: 11 + 4 * rnd(slot * 3 + 2) };
  });
}

/** Height (world units) of the frontier at a point; summits are pointed peaks on the ring. */
export function frontierHeight(seed: number, x: number, z: number, spots: SummitSpot[]) {
  const d = outside(x, z);
  if (d <= 0) return 0;
  const rise = smooth(0, 10, d) * smooth(80, 44, d);
  const rock = crags(seed + 211, x * 0.045, z * 0.045);
  const swell = 0.5 + 0.5 * gradientNoise(seed + 223, x * 0.018, z * 0.018);
  let h = rise * (1.5 + 7 * rock * (0.35 + 0.65 * swell));
  for (const s of spots) {
    const t = Math.hypot(x - s.x, z - s.z) / 8.5;
    if (t < 1) h = Math.max(h, s.height * Math.pow(1 - t, 1.6) * (0.82 + 0.3 * rock));
  }
  return h;
}

/** 0 = clear, 1 = lost in mist. Thins with reach, and around each discovered summit. */
export function frontierMist(x: number, z: number, reach: number, discovered: SummitSpot[]) {
  const d = outside(x, z);
  let mist = Math.min(1, 0.55 - 0.3 * reach + 0.45 * smooth(6, 60, d));
  for (const s of discovered) {
    const t = Math.hypot(x - s.x, z - s.z) / 16;
    if (t < 1) mist -= 0.5 * (1 - t * t);
  }
  return Math.min(1, Math.max(0.08, mist));
}

/** Opacity: rises out of the map's faded edge, falls into the horizon. */
export const frontierAlpha = (x: number, z: number) => {
  const d = outside(x, z);
  return smooth(1, 9, d) * smooth(84, 50, d);
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Grid of the frontier ring: heights, mist and alpha per vertex. */
export function frontierGrid(seed: string, spots: SummitSpot[], reach: number, discovered: number[]) {
  const s = hashString(`${seed}:frontier`);
  const { minX, maxX, minZ, maxZ, step } = FRONTIER;
  const cols = Math.round((maxX - minX) / step) + 1;
  const rows = Math.round((maxZ - minZ) / step) + 1;
  const found = spots.filter((p) => discovered.includes(p.slot));
  const heights = new Float32Array(cols * rows);
  const mist = new Float32Array(cols * rows);
  const alpha = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = minX + i * step;
      const z = minZ + j * step;
      const k = j * cols + i;
      heights[k] = frontierHeight(s, x, z, spots);
      mist[k] = frontierMist(x, z, reach, found);
      alpha[k] = frontierAlpha(x, z);
    }
  return { cols, rows, heights, mist, alpha, heightAt: (x: number, z: number) => frontierHeight(s, x, z, spots) };
}

/**
 * Where each landmark stands: beside the session that earned it (sessions never move), offset a
 * little so the session point stays selectable and landmarks of one session don't stack.
 */
export function landmarkSpots(landmarks: WorldLandmark[], placed: Map<string, { x: number; y: number }>, aspect = SIZE_X / SIZE_Z) {
  const perSession = new Map<string, number>();
  const out: { landmark: WorldLandmark; x: number; y: number }[] = [];
  for (const l of landmarks) {
    if (l.summit) continue;
    const p = placed.get(l.sessionId);
    if (!p) continue;
    const n = perSession.get(l.sessionId) ?? 0;
    perSession.set(l.sessionId, n + 1);
    const a = ((hashString(l.sessionId) % 360) * Math.PI) / 180 + n * 2.1;
    const r = 0.022;
    out.push({
      landmark: l,
      x: Math.min(0.95, Math.max(0.05, p.x + (Math.cos(a) * r) / aspect)),
      y: Math.min(0.94, Math.max(0.06, p.y + Math.sin(a) * r)),
    });
  }
  return out;
}
