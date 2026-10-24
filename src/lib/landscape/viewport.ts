/**
 * Camera for the explore map. The world is a fixed W×H map; the camera is a centre and a zoom
 * (1 = whole map fits the screen). Pure functions so gestures are testable without a browser.
 */

export type Camera = { cx: number; cy: number; k: number };
export type Screen = { width: number; height: number };
export type World = { width: number; height: number };

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

/** World units per screen pixel at zoom 1 (the whole map fits, "contain"). */
function basePerPx(world: World, screen: Screen) {
  return Math.max(world.width / Math.max(1, screen.width), world.height / Math.max(1, screen.height));
}

export function visibleSize(cam: Camera, world: World, screen: Screen) {
  const per = basePerPx(world, screen) / cam.k;
  return { w: screen.width * per, h: screen.height * per, per };
}

/** Keeps zoom in range and the map in view; centres an axis that is smaller than the screen. */
export function clampCamera(cam: Camera, world: World, screen: Screen): Camera {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.k));
  const { w, h } = visibleSize({ ...cam, k }, world, screen);
  const cx = w >= world.width ? world.width / 2 : Math.min(world.width - w / 2, Math.max(w / 2, cam.cx));
  const cy = h >= world.height ? world.height / 2 : Math.min(world.height - h / 2, Math.max(h / 2, cam.cy));
  return { cx, cy, k };
}

export function viewBox(cam: Camera, world: World, screen: Screen) {
  const { w, h } = visibleSize(cam, world, screen);
  return { x: cam.cx - w / 2, y: cam.cy - h / 2, w, h };
}

/** Screen point (px, relative to the map's box) → world point. */
export function toWorld(cam: Camera, world: World, screen: Screen, px: number, py: number) {
  const vb = viewBox(cam, world, screen);
  return { x: vb.x + (px / screen.width) * vb.w, y: vb.y + (py / screen.height) * vb.h };
}

/** Zoom by `factor`, keeping the world point under the screen point (px, py) fixed. */
export function zoomAt(cam: Camera, world: World, screen: Screen, factor: number, px: number, py: number): Camera {
  const before = toWorld(cam, world, screen, px, py);
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.k * factor));
  const { w, h } = visibleSize({ ...cam, k }, world, screen);
  const cx = before.x - (px / screen.width - 0.5) * w;
  const cy = before.y - (py / screen.height - 0.5) * h;
  return clampCamera({ cx, cy, k }, world, screen);
}

/** Pan by a screen-space drag of (dx, dy) pixels. `squash` > 1 compensates a tilted plane. */
export function panBy(cam: Camera, world: World, screen: Screen, dx: number, dy: number, squash = 1): Camera {
  const { per } = visibleSize(cam, world, screen);
  return clampCamera({ cx: cam.cx - dx * per, cy: cam.cy - dy * per * squash, k: cam.k }, world, screen);
}

export function initialCamera(world: World): Camera {
  return { cx: world.width / 2, cy: world.height / 2, k: 1 };
}

/** Eased interpolation between cameras, for button zooms and "fly to". */
export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  const e = 1 - Math.pow(1 - t, 3);
  // interpolate zoom geometrically so it feels uniform
  const k = a.k * Math.pow(b.k / a.k, e);
  return { cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e, k };
}
