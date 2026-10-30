import { describe, expect, it } from "vitest";
import type { TrackPoint } from "@/lib/run/recorder";
import { overlayLayout } from "./overlay";

const stats = [
  { label: "Distance", value: "6.09 km" },
  { label: "Pace", value: "5:55 /km" },
  { label: "Time", value: "36m 7s" },
];
/** A circular run of radius `r` metres around a point, as GPS points. */
const loop = (r: number, n = 72, lat0 = 52): TrackPoint[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [lat0 + (r * Math.sin(a)) / 111195, 13 + (r * Math.cos(a)) / (111195 * Math.cos((lat0 * Math.PI) / 180)), i * 5000, 5, null, 0];
  });

describe("share overlay", () => {
  it("draws the route from the GPS points: a loop comes out round", () => {
    const l = overlayLayout({ stats, points: loop(800), showRoute: true });
    const xs = l.route!.path.map((p) => p.x);
    const ys = l.route!.path.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    expect(w / h).toBeCloseTo(1, 1); // not squashed to the 220 × 200 box
    expect(l.route!.path[0].x).toBeCloseTo(l.route!.path.at(-1)!.x, 3); // and it closes
    // north stays up: the northernmost point is drawn highest
    const north = loop(800).reduce((m, p, i, a) => (p[0] > a[m][0] ? i : m), 0);
    expect(ys[north]).toBe(Math.min(...ys));
  });

  it("a pause starts a new stroke instead of drawing a line across", () => {
    const pts: TrackPoint[] = [...loop(300, 10).slice(0, 5), ...loop(300, 10).slice(6).map((p): TrackPoint => [p[0], p[1], p[2], p[3], p[4], 1])];
    const moves = overlayLayout({ stats, points: pts, showRoute: true }).route!.path.filter((p) => p.move);
    expect(moves).toHaveLength(2);
  });

  it("without a route (or with it switched off) the stats and mark close up", () => {
    const withRoute = overlayLayout({ stats, points: loop(500), showRoute: true });
    const statsOnly = overlayLayout({ stats, points: null, showRoute: true });
    expect(statsOnly.route).toBeNull();
    expect(overlayLayout({ stats, points: loop(500), showRoute: false }).route).toBeNull();
    expect(withRoute.height - statsOnly.height).toBe(228); // the 200 px route and its gap
    expect(withRoute.width).toBe(300);
  });
});
