"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cumulative, paceProfile, type Split } from "@/lib/run/analysis";
import { formatPace, type TrackPoint } from "@/lib/run/recorder";
import { cn } from "@/lib/utils";
import { projectRoute, routePath } from "./route-trace";

const W = 640;
const H = 400;

/**
 * The route, the pace along it and its splits, linked: choosing a split lights its stretch of
 * route and chart; moving along the chart moves a marker on the route; replay runs the route
 * through in ten seconds. Drawn from the recorded points alone, with no map tiles.
 */
export function RunView({ points, splits, hasAltitude }: { points: TrackPoint[]; splits: Split[]; hasAltitude: boolean }) {
  const [split, setSplit] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [replay, setReplay] = useState<number | null>(null);
  const { xy, scale } = useMemo(() => projectRoute(points, W, H, 28), [points]);
  const { dist } = useMemo(() => cumulative(points), [points]);
  const profile = useMemo(() => paceProfile(points), [points]);
  const total = dist[points.length - 1] ?? 0;

  // replay: the marker walks the route in 10 s (instantly to the end with reduced motion)
  const raf = useRef(0);
  const startReplay = () => {
    cancelAnimationFrame(raf.current);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return setReplay(points.length - 1);
    const t0 = performance.now();
    const step = (t: number) => {
      const f = Math.min(1, (t - t0) / 10000);
      const target = f * total;
      let i = 0;
      while (i < points.length - 1 && dist[i] < target) i++;
      setReplay(i);
      if (f < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const sel = split != null ? splits[split] : null;
  const marker = replay ?? cursor;
  // a 500 m grid behind the route gives it scale without a map
  const grid = scale > 0 ? (500 / 111195) * scale : 0;

  return (
    <div className="grid gap-8">
      <figure>
        <div className="relative overflow-hidden rounded-lg border border-line bg-surface">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Route of the run">
            {grid > 8 ? (
              <g stroke="var(--line)" strokeWidth={1}>
                {Array.from({ length: Math.ceil(W / grid) + 1 }, (_, i) => (
                  <line key={`x${i}`} x1={i * grid} x2={i * grid} y1={0} y2={H} />
                ))}
                {Array.from({ length: Math.ceil(H / grid) + 1 }, (_, i) => (
                  <line key={`y${i}`} y1={i * grid} y2={i * grid} x1={0} x2={W} />
                ))}
              </g>
            ) : null}
            <path d={routePath(points, xy)} fill="none" stroke={sel ? "var(--line-strong)" : "var(--sage)"} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
            {sel ? <path d={routePath(points, xy, sel.from, sel.to)} fill="none" stroke="var(--sage-deep)" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" /> : null}
            {xy.length ? (
              <>
                <circle cx={xy[0][0]} cy={xy[0][1]} r={6} fill="var(--paper)" stroke="var(--ink-2)" strokeWidth={2} />
                <circle cx={xy.at(-1)![0]} cy={xy.at(-1)![1]} r={6} fill="var(--ink-2)" stroke="var(--paper)" strokeWidth={2} />
              </>
            ) : null}
            {marker != null && xy[marker] ? <circle cx={xy[marker][0]} cy={xy[marker][1]} r={7} fill="var(--sage-deep)" stroke="var(--paper)" strokeWidth={2.5} /> : null}
          </svg>
          <button
            type="button"
            onClick={startReplay}
            className="absolute bottom-3 right-3 h-9 rounded-md border border-line-strong bg-surface/90 px-3 text-[13px] text-ink-2 backdrop-blur hover:text-ink"
          >
            Replay route
          </button>
        </div>
        <figcaption className="mt-2 flex gap-4 text-[12px] text-ink-3">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full border-2 border-ink-2 bg-paper" aria-hidden /> Start
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-ink-2" aria-hidden /> Finish
          </span>
          {grid > 8 ? <span>Grid: 500 m</span> : null}
        </figcaption>
      </figure>

      {profile.length > 4 ? <PaceChart profile={profile} total={total} split={sel} dist={dist} onCursor={setCursor} /> : null}
      {hasAltitude ? <ElevationChart points={points} dist={dist} total={total} /> : null}

      {splits.length ? (
        <section aria-labelledby="splits">
          <h2 id="splits" className="text-[13px] font-medium">
            Splits
          </h2>
          <table className="num mt-2 w-full text-[14px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-ink-3">
                <th className="py-2 font-normal">Km</th>
                <th className="py-2 font-normal">Pace</th>
                <th className="hidden py-2 font-normal sm:table-cell">Time</th>
                {hasAltitude ? <th className="py-2 text-right font-normal">Climb</th> : null}
                <th className="w-[38%] py-2 font-normal" aria-hidden />
              </tr>
            </thead>
            <tbody>
              {(() => {
                const fastest = Math.min(...splits.map((s) => s.pace));
                const slowest = Math.max(...splits.map((s) => s.pace));
                return splits.map((s) => (
                  <tr
                    key={s.index}
                    aria-selected={split === s.index}
                    className={cn("cursor-pointer border-b border-line transition-colors hover:bg-sunken/60", split === s.index && "bg-sage-wash")}
                    onClick={() => setSplit(split === s.index ? null : s.index)}
                  >
                    <td className="py-2.5">
                      <button
                        type="button"
                        className="text-left underline-offset-4 hover:underline"
                        aria-pressed={split === s.index}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSplit(split === s.index ? null : s.index);
                        }}
                      >
                        {s.meters >= 999 ? s.index + 1 : `${(s.meters / 1000).toFixed(2)}`}
                      </button>
                    </td>
                    <td className="py-2.5 font-medium">{formatPace(s.pace)}</td>
                    <td className="hidden py-2.5 text-ink-2 sm:table-cell">{formatPace(s.seconds)}</td>
                    {hasAltitude ? <td className="py-2.5 text-right text-ink-2">{s.climb == null ? "—" : `${s.climb > 0 ? "+" : ""}${s.climb} m`}</td> : null}
                    <td className="py-2.5 pl-4">
                      {/* longer bar = faster; the slowest split still shows a sliver */}
                      <span className="block h-1.5 rounded-full bg-sage-soft">
                        <span
                          className={cn("block h-full rounded-full", split === s.index ? "bg-sage-deep" : "bg-sage")}
                          style={{ width: `${slowest === fastest ? 100 : 25 + 75 * ((slowest - s.pace) / (slowest - fastest))}%` }}
                        />
                      </span>
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

function PaceChart({
  profile,
  total,
  split,
  dist,
  onCursor,
}: {
  profile: { km: number; pace: number; index: number }[];
  total: number;
  split: Split | null;
  dist: Float64Array;
  onCursor: (i: number | null) => void;
}) {
  const w = 640;
  const h = 160;
  const padL = 44;
  const padB = 22;
  const paces = profile.map((p) => p.pace).sort((a, b) => a - b);
  // a robust range: ignore the most extreme 3% (a stop to tie a shoe)
  const lo = paces[Math.floor(paces.length * 0.03)];
  const hi = paces[Math.min(paces.length - 1, Math.ceil(paces.length * 0.97))];
  const span = Math.max(20, hi - lo);
  const x = (km: number) => padL + (km / Math.max(0.001, total / 1000)) * (w - padL - 8);
  // faster pace higher up
  const y = (pace: number) => 8 + ((Math.min(hi, Math.max(lo, pace)) - lo) / span) * (h - padB - 16);
  const d = profile.map((p, i) => `${i ? "L" : "M"}${x(p.km).toFixed(1)},${y(p.pace).toFixed(1)}`).join("");
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const move = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect();
    const km = ((clientX - r.left) / r.width) * w;
    let best = 0;
    for (let i = 0; i < profile.length; i++) if (Math.abs(x(profile[i].km) - km) < Math.abs(x(profile[best].km) - km)) best = i;
    setHover(best);
    onCursor(profile[best].index);
  };
  const ticks = [lo, lo + span / 2, hi];
  const hv = hover != null ? profile[hover] : null;
  return (
    <figure>
      <figcaption className="mb-2 flex items-baseline justify-between">
        <span className="text-[13px] font-medium">Pace</span>
        <span className="num text-[12px] text-ink-3" role="status">
          {hv ? `${hv.km.toFixed(2)} km · ${formatPace(hv.pace)} /km` : "Faster is higher"}
        </span>
      </figcaption>
      <svg
        ref={svg}
        viewBox={`0 0 ${w} ${h}`}
        className="block h-auto w-full touch-none"
        role="img"
        aria-label="Pace over distance"
        onPointerMove={(e) => move(e.clientX)}
        onPointerDown={(e) => move(e.clientX)}
        onPointerLeave={() => {
          setHover(null);
          onCursor(null);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - 8} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="fill-[var(--ink-3)] text-[11px]">
              {formatPace(t)}
            </text>
          </g>
        ))}
        {split ? (
          <rect x={x(dist[split.from] / 1000)} width={Math.max(2, x(dist[split.to] / 1000) - x(dist[split.from] / 1000))} y={4} height={h - padB - 8} fill="var(--sage-wash)" />
        ) : null}
        <path d={d} fill="none" stroke="var(--sage)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hv ? (
          <>
            <line x1={x(hv.km)} x2={x(hv.km)} y1={4} y2={h - padB} stroke="var(--ink-3)" strokeDasharray="2 3" />
            <circle cx={x(hv.km)} cy={y(hv.pace)} r={4.5} fill="var(--sage-deep)" stroke="var(--surface)" strokeWidth={2} />
          </>
        ) : null}
        {Array.from({ length: Math.floor(total / 1000) + 1 }, (_, k) => (
          <text key={k} x={x(k)} y={h - 6} textAnchor="middle" className="fill-[var(--ink-3)] text-[11px]">
            {k}
          </text>
        ))}
      </svg>
    </figure>
  );
}

function ElevationChart({ points, dist, total }: { points: TrackPoint[]; dist: Float64Array; total: number }) {
  const w = 640;
  const h = 90;
  const alts = points.map((p) => p[4]);
  const known = alts.filter((a): a is number => a != null);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const span = Math.max(10, hi - lo);
  const x = (m: number) => 44 + (m / Math.max(1, total)) * (w - 52);
  const y = (a: number) => 6 + (1 - (a - lo) / span) * (h - 14);
  let d = "";
  points.forEach((p, i) => {
    if (p[4] == null) return;
    d += `${d ? "L" : "M"}${x(dist[i]).toFixed(1)},${y(p[4]).toFixed(1)}`;
  });
  return (
    <figure>
      <figcaption className="mb-2 flex items-baseline justify-between">
        <span className="text-[13px] font-medium">Elevation</span>
        <span className="num text-[12px] text-ink-3">
          {Math.round(lo)}–{Math.round(hi)} m, from the device&apos;s altitude
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} className="block h-auto w-full" role="img" aria-label={`Elevation from ${Math.round(lo)} to ${Math.round(hi)} metres`}>
        <path d={`${d}L${x(total)},${h}L${x(0)},${h}Z`} fill="var(--sunken)" />
        <path d={d} fill="none" stroke="var(--ink-3)" strokeWidth={1.5} />
      </svg>
    </figure>
  );
}
