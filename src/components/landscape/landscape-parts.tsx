"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { smoothPath, type ContourLine } from "@/lib/landscape/contours";
import { parseColor, shadeRelief, treePositions, type ReliefPalette } from "@/lib/landscape/relief";
import type { Lake, Landmark, Terrain } from "@/lib/landscape/terrain";
import { formatShortDate, formatVolume } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Contour strokes. Higher levels draw slightly darker, like ink pooling on a map. */
export function ContourLayer({ lines, fade = 1 }: { lines: ContourLine[]; fade?: number }) {
  return (
    <g aria-hidden style={{ opacity: fade, transition: "opacity 300ms var(--ease-out)" }}>
      {lines.map((l) => (
        <path
          key={l.level}
          d={l.d}
          fill="none"
          stroke={l.index ? "var(--contour-index)" : "var(--contour)"}
          strokeWidth={l.index ? 1 : 0.65}
          strokeOpacity={0.35 + l.level * 0.45}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

/** Session landmark glyph: hollow for a session, layered sage for one where a record was set. */
export function MarkerGlyph({
  cx,
  cy,
  r,
  record,
  active,
  selected,
  dimmed,
}: {
  cx: number;
  cy: number;
  r: number;
  record: boolean;
  active?: boolean;
  selected?: boolean;
  dimmed?: boolean;
}) {
  return (
    <g style={{ opacity: dimmed ? 0.28 : 1, transition: "opacity 200ms var(--ease-out)" }}>
      <circle cx={cx} cy={cy} r={18} fill="transparent" />
      {record ? (
        <>
          <circle cx={cx} cy={cy} r={r * 3.2} fill="none" stroke="var(--sage)" strokeOpacity={0.35} vectorEffect="non-scaling-stroke" />
          <circle
            cx={cx}
            cy={cy}
            r={r * 1.9}
            fill="var(--sage-soft)"
            stroke="var(--sage)"
            strokeOpacity={0.6}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={cx} cy={cy} r={r} fill="var(--sage-deep)" />
        </>
      ) : (
        <circle
          cx={cx}
          cy={cy}
          r={r * 0.9}
          fill="var(--surface)"
          stroke="var(--ink-2)"
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <circle
        cx={cx}
        cy={cy}
        r={r * 4.4}
        fill="none"
        stroke="var(--ink)"
        strokeWidth={selected ? 1.5 : 1}
        vectorEffect="non-scaling-stroke"
        className={cn("transition-opacity duration-150", selected ? "opacity-90" : active ? "opacity-50" : "opacity-0")}
      />
    </g>
  );
}

export function markerLabel(l: Landmark, unit: string) {
  const pr = l.session.prCount;
  return `${l.session.label}, ${formatShortDate(l.session.endedAt)}, ${formatVolume(l.session.volume, unit)}${
    pr ? `, ${pr} personal record${pr > 1 ? "s" : ""}` : ""
  }`;
}

/** Drawn inside the SVG so it stays attached to its marker under any crop or scale. */
export function MapTooltip({ mark, width, height, unit }: { mark: Landmark; width: number; height: number; unit: string }) {
  const title = mark.session.label;
  const sub = `${formatShortDate(mark.session.endedAt)} · ${formatVolume(mark.session.volume, unit)}${
    mark.session.prCount ? ` · ${mark.session.prCount} record${mark.session.prCount > 1 ? "s" : ""}` : ""
  }`;
  const w = Math.round(Math.max(title.length * 6.8, sub.length * 6) + 24);
  const h = 42;
  const cx = mark.x * width;
  const cy = mark.y * height;
  const x = Math.min(Math.max(cx - w / 2, 6), width - w - 6);
  const above = cy - h - 18 > 4;
  const y = above ? cy - h - 18 : cy + 18;
  return (
    <g pointerEvents="none" aria-hidden>
      <rect x={x} y={y} width={w} height={h} rx={6} fill="var(--ink)" />
      <text x={x + 12} y={y + 17} fontSize={12} fontWeight={500} fill="var(--paper)">
        {title}
      </text>
      <text x={x + 12} y={y + 32} fontSize={11} fill="var(--paper)" fillOpacity={0.7} style={{ fontVariantNumeric: "tabular-nums" }}>
        {sub}
      </text>
    </g>
  );
}

// ── relief, water, vegetation ────────────────────────────────────────────────

const FALLBACK: ReliefPalette = {
  low: [0x9e, 0x99, 0x84],
  mid: [0xd9, 0xd4, 0xc3],
  high: [0xf7, 0xf5, 0xef],
  vegetation: [0xb4, 0xbb, 0x9b],
  shade: 0.9,
};

function readPalette(): ReliefPalette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name);
  const shade = Number.parseFloat(v("--terrain-shade"));
  return {
    low: parseColor(v("--terrain-low"), FALLBACK.low),
    mid: parseColor(v("--terrain-mid"), FALLBACK.mid),
    high: parseColor(v("--terrain-high"), FALLBACK.high),
    vegetation: parseColor(v("--terrain-vegetation"), FALLBACK.vegetation),
    shade: Number.isFinite(shade) ? shade : FALLBACK.shade,
  };
}

/** Bumps when the colour scheme changes (system preference or a theme attribute on <html>). */
function useThemeVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    mq?.addEventListener("change", bump);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => {
      mq?.removeEventListener("change", bump);
      mo.disconnect();
    };
  }, []);
  return version;
}

/**
 * Shaded relief raster under the contours. Drawn client-side from the same field the contours
 * come from, so the two always agree; the SVG stretches it to the map's coordinate space.
 */
export function ReliefLayer({ terrain, width, height }: { terrain: Terrain; width: number; height: number }) {
  const theme = useThemeVersion();
  const ref = useRef<SVGImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    const canvas = document.createElement("canvas");
    canvas.width = terrain.cols;
    canvas.height = terrain.rows;
    const ctx = canvas.getContext("2d");
    if (!img || !ctx) return; // no canvas (e.g. test DOM): contours alone still render the map
    const pixels = shadeRelief(terrain, readPalette());
    ctx.putImageData(new ImageData(pixels, terrain.cols, terrain.rows), 0, 0);
    img.setAttribute("href", canvas.toDataURL("image/png"));
    img.style.opacity = "1";
  }, [terrain, theme]);
  return (
    <image
      ref={ref}
      x={0}
      y={0}
      width={width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden
      style={{ opacity: 0, imageRendering: "auto", transition: "opacity 400ms var(--ease-out)" }}
    />
  );
}

/** Outline of the river as one filled ribbon: left bank downstream, right bank back up. */
export function riverRibbon(river: [number, number, number][], width: number, height: number, from = 0, to = 1) {
  const pts = river.filter(([x]) => x >= from && x <= to);
  if (pts.length < 3) return "";
  const step = Math.max(1, Math.round(pts.length / 90));
  const sampled = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  sampled.forEach(([x, y, w], i) => {
    const a = sampled[Math.max(0, i - 1)];
    const b = sampled[Math.min(sampled.length - 1, i + 1)];
    const tx = (b[0] - a[0]) * width;
    const ty = (b[1] - a[1]) * height;
    const tl = Math.hypot(tx, ty) || 1;
    const nx = -ty / tl;
    const ny = tx / tl;
    const half = w * height;
    left.push([x * width + nx * half, y * height + ny * half]);
    right.push([x * width - nx * half, y * height - ny * half]);
  });
  const ring = [...left, ...right.reverse()];
  return smoothPath([...ring, ring[0]]);
}

/**
 * The river: one continuous body of water flowing with time, widening into broad reaches and
 * lakes on rest days. Each swell carries an invisible hit area with its dates.
 */
export function WaterLayer({
  terrain,
  width,
  height,
  highlight,
  onRest,
  restLabel = true,
}: {
  terrain: Terrain;
  width: number;
  height: number;
  /** a stretch of river (normalised x range) to emphasise, e.g. the selected week */
  highlight?: { from: number; to: number } | null;
  onRest?: (span: Lake["span"]) => void;
  restLabel?: boolean;
}) {
  const { river, lakes } = terrain.water;
  const body = useMemo(() => riverRibbon(river, width, height), [river, width, height]);
  const lit = useMemo(
    () => (highlight ? riverRibbon(river, width, height, highlight.from, highlight.to) : ""),
    [river, width, height, highlight],
  );
  if (!body) return null;
  return (
    <g>
      <path
        d={body}
        fill="var(--water)"
        stroke="var(--water-edge)"
        strokeWidth={0.9}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        aria-hidden
      />
      {lit ? <path d={lit} fill="var(--water-edge)" fillOpacity={0.55} aria-hidden /> : null}
      {lakes.map((l) => (
        <ellipse
          key={l.span.start}
          cx={l.x * width}
          cy={l.y * height}
          rx={l.rx * width}
          ry={Math.max(l.ry * height, 6)}
          fill="transparent"
          className={onRest ? "cursor-pointer" : undefined}
          onClick={onRest ? () => onRest(l.span) : undefined}
          aria-hidden
        >
          {restLabel ? <title>{l.span.label}</title> : null}
        </ellipse>
      ))}
    </g>
  );
}

/** Sparse tree marks on the low, gentle ground. */
export function VegetationLayer({ terrain, seed, width, height }: { terrain: Terrain; seed: string; width: number; height: number }) {
  const trees = useMemo(() => treePositions(terrain, seed, 0.018, width / height), [terrain, seed, width, height]);
  const r = width / 520;
  return (
    <g aria-hidden fill="var(--tree)" fillOpacity={0.5}>
      {trees.map(([x, y], i) => (
        <circle key={i} cx={x * width} cy={y * height} r={r} />
      ))}
    </g>
  );
}
