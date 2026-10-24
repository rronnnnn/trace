"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { smoothPath } from "@/lib/landscape/contours";
import { mountainProfile, pointOnTrail } from "@/lib/goals";

const W = 600;
const H = 300;

export type ClimberPosition = { x: number; y: number; angle: number; fraction: number };

/**
 * A goal as a summit, in side view. The trail runs from the foot to the peak; the climbed part
 * is solid, the rest dashed. The climber stands at the current progress.
 *
 * `renderClimber` is the slot for the generated climbing animation: it receives the position
 * (in this SVG's 600×300 coordinates) and heading, and replaces the default marker.
 */
export function GoalMountain({
  seed,
  fraction,
  reached,
  label,
  sublabel,
  renderClimber,
  className,
  animate = true,
}: {
  seed: string;
  fraction: number;
  reached: boolean;
  label: string;
  sublabel: string;
  renderClimber?: (pos: ClimberPosition) => React.ReactNode;
  className?: string;
  /** climb up from the foot on first view; false renders at the current progress */
  animate?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const p = useMemo(() => mountainProfile(seed), [seed]);
  const [shown, setShown] = useState(animate ? 0 : fraction);

  // Climb from the foot to the current progress once, on first view.
  useEffect(() => {
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !animate) {
      const t = setTimeout(() => setShown(fraction), 0);
      return () => clearTimeout(t);
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 1100);
      setShown(fraction * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [fraction, animate]);

  const S = (pts: [number, number][]) => pts.map(([x, y]) => [x * W, y * H] as [number, number]);
  const ridge = S(p.ridge);
  const body = smoothPath([[0, H], ...ridge, [W, H], [0, H]]);
  const trail = S(p.trail);
  const pos = pointOnTrail(p.trail, shown, W / H);
  const climbed = useMemo(() => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 40; i++) {
      const q = pointOnTrail(p.trail, (shown * i) / 40, W / H);
      pts.push([q.x * W, q.y * H]);
    }
    return pts;
  }, [p.trail, shown]);
  const summit: [number, number] = [p.summit[0] * W, p.summit[1] * H];
  const milestones = [0.25, 0.5, 0.75].map((f) => ({ f, ...pointOnTrail(p.trail, f, W / H) }));
  const cx = pos.x * W;
  const cy = pos.y * H;
  const calloutLeft = cx > W * 0.55;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label={`${label}. ${sublabel}`}>
      <defs>
        <linearGradient id={`${id}-rock`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--terrain-high)" />
          <stop offset="0.55" stopColor="var(--terrain-mid)" />
          <stop offset="1" stopColor="var(--terrain-low)" />
        </linearGradient>
        <clipPath id={`${id}-body`}>
          <path d={body} />
        </clipPath>
      </defs>

      {/* distant ranges for depth */}
      {p.far.map((pts, i) => (
        <path
          key={i}
          d={smoothPath([[0, H], ...S(pts), [W, H], [0, H]])}
          fill="var(--terrain-mid)"
          fillOpacity={i === 0 ? 0.35 : 0.55}
          aria-hidden
        />
      ))}

      {/* the mountain: pale summit, dark foot; the shaded east face reads as volume */}
      <path d={body} fill={`url(#${id}-rock)`} stroke="var(--contour-index)" strokeOpacity={0.5} strokeWidth={1} />
      <g clipPath={`url(#${id}-body)`} aria-hidden>
        <path d={`M${summit[0]} ${summit[1]} L${W} ${H * 0.55} L${W} ${H} L${summit[0] + 40} ${H} Z`} fill="#000" fillOpacity={0.1} />
        {[0.3, 0.45, 0.6, 0.75].map((y) => (
          <path
            key={y}
            d={`M0 ${H * y} Q ${W / 2} ${H * (y - 0.02)} ${W} ${H * y}`}
            fill="none"
            stroke="var(--contour)"
            strokeOpacity={0.35}
            strokeWidth={0.8}
          />
        ))}
      </g>

      {/* trail: dashed ahead, solid behind */}
      <path d={smoothPath(trail)} fill="none" stroke="var(--ink-3)" strokeWidth={1.4} strokeDasharray="3 5" strokeLinecap="round" />
      <path d={smoothPath(climbed)} fill="none" stroke="var(--sage-deep)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />

      {/* milestones */}
      {milestones.map((m) => (
        <g key={m.f} aria-hidden>
          <circle
            cx={m.x * W}
            cy={m.y * H}
            r={3}
            fill={shown >= m.f ? "var(--sage-deep)" : "var(--surface)"}
            stroke="var(--ink-3)"
            strokeWidth={1}
          />
          {/* the label steps aside while the climber's own callout is near */}
          {Math.abs(m.f - shown) > 0.09 ? (
            <text
              x={m.x * W - 8}
              y={m.y * H + 16}
              fontSize={10}
              fill="var(--ink-3)"
              textAnchor="end"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {Math.round(m.f * 100)}%
            </text>
          ) : null}
        </g>
      ))}

      {/* summit flag: the goal */}
      <g aria-hidden>
        <line x1={summit[0]} y1={summit[1]} x2={summit[0]} y2={summit[1] - 30} stroke="var(--ink)" strokeWidth={1.4} />
        <path
          d={`M${summit[0]} ${summit[1] - 30} L${summit[0] + 22} ${summit[1] - 24} L${summit[0]} ${summit[1] - 17} Z`}
          fill={reached ? "var(--sage-deep)" : "var(--surface)"}
          stroke="var(--sage-deep)"
          strokeWidth={1.2}
        />
      </g>

      {/* climber — replace via renderClimber with the generated animation */}
      <g data-climber transform={renderClimber ? undefined : `translate(${cx} ${cy})`}>
        {renderClimber ? (
          renderClimber({ x: cx, y: cy, angle: pos.angle, fraction: shown })
        ) : (
          <>
            <circle r={11} fill="var(--sage)" fillOpacity={0.18} />
            <circle r={5.5} fill="var(--ink)" stroke="var(--paper)" strokeWidth={2} />
          </>
        )}
      </g>

      {/* callout */}
      <g transform={`translate(${calloutLeft ? cx - 16 : cx + 16} ${Math.max(28, cy - 22)})`} aria-hidden>
        <text
          textAnchor={calloutLeft ? "end" : "start"}
          fontSize={22}
          fontWeight={600}
          fill="var(--ink)"
          style={{ fontVariantNumeric: "tabular-nums", paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 4 }}
        >
          {Math.round(shown * 100)}%
        </text>
        <text
          y={18}
          textAnchor={calloutLeft ? "end" : "start"}
          fontSize={11.5}
          fill="var(--ink-2)"
          style={{ fontVariantNumeric: "tabular-nums", paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 3 }}
        >
          {sublabel}
        </text>
      </g>
    </svg>
  );
}
