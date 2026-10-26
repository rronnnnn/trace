import { describe, expect, it } from "vitest";
import { chaikin, edgeFalloff, riverMesh, SIZE_X, SIZE_Z, terrainMesh } from "./mesh";
import { restSpans } from "./rest";
import { buildTerrain, type LandscapeSession } from "./terrain";

const start = new Date("2026-09-01T00:00:00Z");
const end = new Date("2026-10-20T00:00:00Z");
const sessions: LandscapeSession[] = Array.from({ length: 18 }, (_, i) => ({
  id: `s${i}`,
  endedAt: new Date(start.getTime() + i * 2.6 * 86400000).toISOString(),
  templateKey: `t${i % 3}`,
  label: "x",
  volume: 4000 + (i % 5) * 400,
  sets: 12,
  prCount: 0,
}));
const terrain = buildTerrain({
  sessions,
  seed: "u",
  start,
  end,
  cols: 120,
  rows: 77,
  aspect: SIZE_X / SIZE_Z,
  rest: restSpans({ start, end, timeZone: "UTC", trainingDays: [1, 3, 5], sessionEndedAts: sessions.map((s) => s.endedAt) }),
});
const pal = {
  low: [20, 20, 20] as [number, number, number],
  mid: [120, 120, 120] as [number, number, number],
  high: [240, 240, 240] as [number, number, number],
  vegetation: [60, 90, 50] as [number, number, number],
};

describe("3D terrain mesh", () => {
  const m = terrainMesh(terrain, pal);

  it("has one vertex per field cell and a closed triangle grid", () => {
    expect(m.positions.length).toBe(terrain.cols * terrain.rows * 3);
    expect(m.indices.length).toBe((terrain.cols - 1) * (terrain.rows - 1) * 6);
    expect(Math.max(...m.indices)).toBe(terrain.cols * terrain.rows - 1);
  });

  it("falls to the ground at its borders, so it melts into the plain", () => {
    expect(edgeFalloff(0, 0.5)).toBe(0);
    expect(edgeFalloff(0.5, 0.5)).toBe(1);
    for (let i = 0; i < terrain.cols; i++) expect(m.positions[i * 3 + 1]).toBe(0); // first row
    expect(m.heightAt(0.5, 0.5)).toBeGreaterThanOrEqual(0);
  });

  it("samples heights consistently with its vertices", () => {
    const i = 40;
    const j = 30;
    const k = j * terrain.cols + i;
    expect(m.heightAt(i / (terrain.cols - 1), j / (terrain.rows - 1))).toBeCloseTo(m.positions[k * 3 + 1], 5);
  });

  it("tints low ground darker than summits", () => {
    let lo = 0;
    let hi = 0;
    for (let k = 0; k < terrain.field.length; k++) {
      if (m.positions[k * 3 + 1] < m.positions[lo * 3 + 1]) lo = k;
      if (m.positions[k * 3 + 1] > m.positions[hi * 3 + 1]) hi = k;
    }
    expect(m.colors[lo * 3] + m.colors[lo * 3 + 1] + m.colors[lo * 3 + 2]).toBeLessThan(
      m.colors[hi * 3] + m.colors[hi * 3 + 1] + m.colors[hi * 3 + 2],
    );
  });
});

describe("river", () => {
  const m = terrainMesh(terrain, pal);
  const r = riverMesh(terrain.water.river, m.heightAt)!;

  it("is smooth: no sharp turns anywhere along the channel", () => {
    let worst = 0;
    for (let i = 1; i < r.centre.length - 1; i++) {
      const [ax, , az] = r.centre[i - 1];
      const [bx, , bz] = r.centre[i];
      const [cx, , cz] = r.centre[i + 1];
      const a1 = Math.atan2(bz - az, bx - ax);
      const a2 = Math.atan2(cz - bz, cx - bx);
      let d = Math.abs(a2 - a1);
      if (d > Math.PI) d = 2 * Math.PI - d;
      worst = Math.max(worst, d);
    }
    expect(worst).toBeLessThan(0.25); // under ~14° between consecutive segments
  });

  it("is never pierced by ground inside its banks", () => {
    const carved = terrainMesh(terrain, pal, 13, 1);
    const surface = riverMesh(terrain.water.river, carved.heightAt, 0.3, 1, carved.riverBed)!;
    for (let i = 0; i < surface.positions.length; i += 3) {
      const x = surface.positions[i] / SIZE_X;
      const z = surface.positions[i + 2] / SIZE_Z;
      // the rim fades to transparent and the river tapers to nothing there; check the visible map
      if (edgeFalloff(x, z, 0.16) < 1) continue;
      expect(carved.heightAt(x, z)).toBeLessThan(surface.positions[i + 1] + 1e-6);
    }
  });

  it("lies nearly level: no steep steps in the water surface", () => {
    const carved = terrainMesh(terrain, pal, 13, 1);
    const surface = riverMesh(terrain.water.river, carved.heightAt, 0.3, 1, carved.riverBed)!;
    let steepest = 0;
    for (let i = 1; i < surface.centre.length; i++) {
      const [ax, ay, az] = surface.centre[i - 1];
      const [bx, by, bz] = surface.centre[i];
      steepest = Math.max(steepest, Math.abs(by - ay) / (Math.hypot(bx - ax, bz - az) || 1));
    }
    expect(steepest).toBeLessThan(0.25); // gentler than ~14°: water never climbs a step
  });

  it("lies on the terrain, above its bed, across the map", () => {
    expect(r.centre[0][0]).toBeCloseTo(0, 0);
    expect(r.centre.at(-1)![0]).toBeCloseTo(SIZE_X, 0);
    for (const [x, y, z] of r.centre) expect(y).toBeGreaterThan(m.heightAt(x / SIZE_X, z / SIZE_Z));
  });

  it("chaikin keeps endpoints and multiplies detail", () => {
    const pts = [
      [0, 0],
      [1, 1],
      [2, 0],
    ];
    const out = chaikin(pts, 2);
    expect(out[0]).toEqual([0, 0]);
    expect(out.at(-1)).toEqual([2, 0]);
    expect(out.length).toBeGreaterThan(pts.length * 2);
  });
});

describe("terrain refinement", () => {
  it("smoothing softens noise but keeps the peaks where they are", async () => {
    const { smoothField } = await import("./mesh");
    const rough = Float32Array.from(terrain.field);
    const smooth = smoothField(rough, terrain.cols, terrain.rows, 2);
    const roughness = (f: Float32Array) => {
      let s = 0;
      for (let k = 1; k < f.length; k++) s += Math.abs(f[k] - f[k - 1]);
      return s;
    };
    expect(roughness(smooth)).toBeLessThan(roughness(rough));
    // the smoothed summit stands on a genuine high point of the original terrain (needle-like
    // spikes may lose more height than broad summits, which is the point), not on new ground
    const si = smooth.reduce((best, v, i) => (v > smooth[best] ? i : best), 0);
    const [sx, sy] = [si % terrain.cols, Math.floor(si / terrain.cols)];
    let near = 0;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = sx + dx;
        const y = sy + dy;
        if (x >= 0 && y >= 0 && x < terrain.cols && y < terrain.rows) near = Math.max(near, rough[y * terrain.cols + x]);
      }
    expect(near).toBeGreaterThan(Math.max(...rough) * 0.85);
    expect(Math.max(...smooth)).toBeGreaterThan(Math.max(...rough) * 0.75);
  });

  it("assigns ground near a routine's sessions to that region, open ground to none", async () => {
    const { regionMap } = await import("./mesh");
    const map = regionMap(terrain.landmarks, terrain.bands, terrain.cols, terrain.rows);
    const l = terrain.landmarks[0];
    const k = Math.round(l.y * (terrain.rows - 1)) * terrain.cols + Math.round(l.x * (terrain.cols - 1));
    expect(terrain.bands[map[k]]).toBe(l.session.templateKey);
    expect(map.some((v) => v === -1)).toBe(true);
  });
});
