import type { TrackPoint } from "@/lib/run/recorder";

/**
 * A route projected onto a plane (local equirectangular: accurate at running scale), fitted
 * into a box with its true proportions. No map tiles: nothing about where the run happened is
 * sent anywhere to draw it.
 */
export function projectRoute(points: TrackPoint[], width: number, height: number, pad = 12) {
  if (!points.length) return { xy: [] as [number, number][], scale: 0 };
  const lat0 = points.reduce((n, p) => n + p[0], 0) / points.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const raw = points.map((p) => [p[1] * k, -p[0]] as [number, number]);
  const xs = raw.map((p) => p[0]);
  const ys = raw.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((width - pad * 2) / Math.max(1e-9, x1 - x0), (height - pad * 2) / Math.max(1e-9, y1 - y0));
  const ox = (width - (x1 - x0) * scale) / 2;
  const oy = (height - (y1 - y0) * scale) / 2;
  return { xy: raw.map(([x, y]) => [ox + (x - x0) * scale, oy + (y - y0) * scale] as [number, number]), scale };
}

/** Path data for the route, broken at pauses (a new segment starts a new line). */
export function routePath(points: TrackPoint[], xy: [number, number][], from = 0, to = points.length - 1) {
  let d = "";
  for (let i = from; i <= to && i < xy.length; i++) {
    const move = i === from || points[i][5] !== points[i - 1][5];
    d += `${move ? "M" : "L"}${xy[i][0].toFixed(1)},${xy[i][1].toFixed(1)}`;
  }
  return d;
}

/** The route as a single quiet line, for the live screen and lists. */
export function RouteTrace({ points, width = 160, height = 120, className, label }: { points: TrackPoint[]; width?: number; height?: number; className?: string; label?: string }) {
  if (points.length < 2) return null;
  const { xy } = projectRoute(points, width, height, 8);
  const last = xy.at(-1)!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={routePath(points, xy)} fill="none" stroke="var(--sage)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={4} fill="var(--sage-deep)" stroke="var(--paper)" strokeWidth={2} />
    </svg>
  );
}
