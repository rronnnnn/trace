/**
 * The share overlay, after the "Trace Overlay" design, set in the app's own Geist (the same
 * face and weight as the run page's figures): three stacked stats, the route as one
 * line drawn from the run's own GPS points, and the TRACE wordmark, on a transparent background
 * so it can sit on the runner's own photo. Drawn straight onto a canvas (not a screenshot of the
 * page), so the PNG is crisp at any scale and nothing but the marks is opaque.
 */

import type { TrackPoint } from "@/lib/run/recorder";
import { projectRoute } from "./route-trace";

export const ROUTE_COLORS = ["#e8d9bf", "#d6c3a1", "#f3ead9", "#ffffff"] as const;

export type OverlayStat = { label: string; value: string };
export type OverlayOptions = { stats: OverlayStat[]; points: TrackPoint[] | null; showRoute: boolean; routeColor: string; fontFamily: string };

// the design's measurements, in CSS pixels
const PAD_X = 40;
const PAD_Y = 32;
const ROUTE_W = 220;
const ROUTE_H = 200;
const LABEL = 17;
const VALUE = 44;
const VALUE_LINE = VALUE * 1.05;
const LABEL_LINE = LABEL * 1.2;
const STAT_GAP = 18;
const INNER_GAP = 2;
const SECTION_GAP = 28;
const MARK = 18;
const MARK_SPACING = 0.42; // em
const VALUE_TRACKING = -0.02; // em, as the run page's figures

/** Where everything goes, in CSS pixels. Pure, so it is tested without a canvas. */
export function overlayLayout(o: Pick<OverlayOptions, "stats" | "points" | "showRoute">) {
  const hasRoute = o.showRoute && Boolean(o.points && o.points.length > 1);
  const width = ROUTE_W + PAD_X * 2;
  let y = PAD_Y;
  const stats = o.stats.map((s, i) => {
    if (i) y += STAT_GAP;
    const labelY = y;
    y += LABEL_LINE + INNER_GAP;
    const valueY = y;
    y += VALUE_LINE;
    return { ...s, labelY, valueY };
  });
  y += SECTION_GAP;
  let route: { x: number; y: number; path: { x: number; y: number; move: boolean }[] } | null = null;
  if (hasRoute) {
    // the run's own shape, true to its proportions (a loop stays round), fitted to the box
    const { xy } = projectRoute(o.points!, ROUTE_W, ROUTE_H, 3);
    route = { x: PAD_X, y, path: xy.map(([px, py], i) => ({ x: PAD_X + px, y: y + py, move: i === 0 || o.points![i][5] !== o.points![i - 1][5] })) };
    y += ROUTE_H + SECTION_GAP;
  }
  const markY = y;
  y += MARK * 1.2 + PAD_Y;
  return { width, height: Math.ceil(y), stats, route, markY };
}

/** Draws the overlay at `scale`× onto a fresh canvas and returns it. */
export function drawOverlay(o: OverlayOptions, scale = 4) {
  const l = overlayLayout(o);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(l.width * scale);
  canvas.height = Math.round(l.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const cx = l.width / 2;
  const tracking = (px: number) => {
    // supported in current Chrome, Safari and Firefox; elsewhere the figures are simply untightened
    if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
  };
  for (const s of l.stats) {
    ctx.font = `500 ${LABEL}px ${o.fontFamily}`;
    tracking(0);
    ctx.fillText(s.label, cx, s.labelY + (LABEL_LINE - LABEL) / 2);
    ctx.font = `500 ${VALUE}px ${o.fontFamily}`;
    tracking(VALUE * VALUE_TRACKING);
    ctx.fillText(s.value, cx, s.valueY + (VALUE_LINE - VALUE) / 2);
  }
  tracking(0);
  if (l.route) {
    ctx.strokeStyle = o.routeColor;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const p of l.route.path) (p.move ? ctx.moveTo : ctx.lineTo).call(ctx, p.x, p.y);
    ctx.stroke();
  }
  // the wordmark, letter-spaced by hand (canvas letterSpacing isn't everywhere yet)
  ctx.font = `600 ${MARK}px ${o.fontFamily}`;
  ctx.textAlign = "left";
  const word = "TRACE";
  const gap = MARK * MARK_SPACING;
  const widths = [...word].map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (word.length - 1);
  let x = cx - total / 2;
  [...word].forEach((c, i) => {
    ctx.fillText(c, x, l.markY + (MARK * 1.2 - MARK) / 2);
    x += widths[i] + gap;
  });
  return canvas;
}
