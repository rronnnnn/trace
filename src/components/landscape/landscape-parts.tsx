"use client";

import type { ContourLine } from "@/lib/landscape/contours";
import type { Landmark } from "@/lib/landscape/terrain";
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
