import { describe, expect, it } from "vitest";
import { clampCamera, initialCamera, lerpCamera, MAX_ZOOM, panBy, toWorld, viewBox, zoomAt } from "./viewport";

const world = { width: 1000, height: 640 };
const screen = { width: 390, height: 700 }; // a phone, portrait

describe("explore camera", () => {
  it("fits the whole map at zoom 1", () => {
    const vb = viewBox(initialCamera(world), world, screen);
    expect(vb.w).toBeCloseTo(1000);
    expect(vb.h).toBeGreaterThanOrEqual(640);
  });

  it("keeps the point under the fingers fixed while zooming", () => {
    const wide = { width: 1000, height: 640 };
    const cam = initialCamera(world);
    const before = toWorld(cam, world, wide, 300, 400);
    const z = zoomAt(cam, world, wide, 3, 300, 400);
    const after = toWorld(z, world, wide, 300, 400);
    expect(z.k).toBe(3);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it("prefers keeping the map on screen over an anchor in the letterbox", () => {
    // on a portrait phone the top of the screen is empty margin above the map
    const z = zoomAt(initialCamera(world), world, screen, 3, 195, 20);
    const vb = viewBox(z, world, screen);
    expect(vb.y).toBeGreaterThanOrEqual(0);
  });

  it("never lets the map leave the screen and clamps zoom", () => {
    let cam = zoomAt(initialCamera(world), world, screen, 4, 195, 350);
    cam = panBy(cam, world, screen, 100000, 100000);
    const vb = viewBox(cam, world, screen);
    expect(vb.x).toBeCloseTo(0);
    expect(vb.y).toBeCloseTo(0);
    expect(zoomAt(cam, world, screen, 1000, 0, 0).k).toBe(MAX_ZOOM);
    expect(clampCamera({ cx: 0, cy: 0, k: 0.1 }, world, screen)).toEqual(initialCamera(world));
  });

  it("pans in the direction of the drag, scaled by zoom", () => {
    const cam = zoomAt(initialCamera(world), world, screen, 2, 195, 350);
    const moved = panBy(cam, world, screen, -50, 0);
    expect(moved.cx).toBeGreaterThan(cam.cx);
    const deeper = zoomAt(cam, world, screen, 2, 195, 350);
    expect(Math.abs(panBy(deeper, world, screen, -50, 0).cx - deeper.cx)).toBeLessThan(Math.abs(moved.cx - cam.cx));
  });

  it("animates zoom geometrically and lands exactly", () => {
    const a = { cx: 500, cy: 320, k: 1 };
    const b = { cx: 200, cy: 100, k: 4 };
    expect(lerpCamera(a, b, 1)).toEqual(b);
    expect(lerpCamera(a, b, 0)).toEqual(a);
  });
});
