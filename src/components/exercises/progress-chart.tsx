"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ProgressPoint = {
  sessionId: string;
  at: string;
  /** measured: top weight, or most reps for bodyweight moves */
  value: number;
  /** Epley estimate; weighted exercises only */
  e1rm: number | null;
  record: boolean;
  isSample: boolean;
  date: string;
  routine: string;
  sets: string;
};

const RANGES = [
  { id: "3m", label: "3M", days: 91 },
  { id: "6m", label: "6M", days: 182 },
  { id: "1y", label: "1Y", days: 365 },
  { id: "all", label: "All", days: null },
] as const;

const H = 260;
const PAD = { top: 18, right: 56, bottom: 28, left: 40 };

function niceTicks(min: number, max: number, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Top measured set per session over time, with the Epley estimate as a second, quieter line on the
 * same axis (both are kg). Records are ringed dots. Hover or arrow keys move a crosshair; Enter
 * opens the session.
 */
export function ProgressChart({ points, weighted, unit, now }: { points: ProgressPoint[]; weighted: boolean; unit: string; now: string }) {
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("all");
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const spanDays = points.length ? (new Date(now).getTime() - new Date(points[0].at).getTime()) / 86_400_000 : 0;
  // Only offer ranges that would show something different from "All".
  const ranges = RANGES.filter((r) => r.days == null || r.days < spanDays);

  const shown = useMemo(() => {
    const spec = RANGES.find((r) => r.id === range);
    if (!spec?.days) return points;
    const from = new Date(now).getTime() - spec.days * 86_400_000;
    return points.filter((p) => new Date(p.at).getTime() >= from);
  }, [points, range, now]);

  const showEstimate = weighted && shown.some((p) => p.e1rm != null);
  const values = shown.flatMap((p) => (showEstimate && p.e1rm != null ? [p.value, p.e1rm] : [p.value]));
  const ticks = niceTicks(Math.max(0, Math.min(...values) * 0.95), Math.max(...values) * 1.02);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const t0 = shown.length ? new Date(shown[0].at).getTime() : 0;
  const t1 = shown.length ? new Date(shown[shown.length - 1].at).getTime() : 1;
  const x = (at: string) => (shown.length < 2 ? PAD.left + innerW / 2 : PAD.left + ((new Date(at).getTime() - t0) / (t1 - t0)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const path = (get: (p: ProgressPoint) => number | null) => {
    let d = "";
    let pen = false;
    for (const p of shown) {
      const v = get(p);
      if (v == null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(p.at).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  // A handful of date labels along the bottom, never overlapping.
  const dateTicks = useMemo(() => {
    if (!shown.length) return [];
    const every = Math.max(1, Math.ceil(shown.length / Math.max(2, Math.floor(innerW / 90))));
    return shown.filter((_, i) => i % every === 0);
  }, [shown, innerW]);

  const nearest = (clientX: number) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box || !shown.length) return null;
    const px = clientX - box.left;
    let best = 0;
    for (let i = 1; i < shown.length; i++) if (Math.abs(x(shown[i].at) - px) < Math.abs(x(shown[best].at) - px)) best = i;
    return best;
  };

  const a = active != null ? shown[active] : null;
  const last = shown[shown.length - 1];
  const label = weighted ? "Top set" : "Most reps";

  return (
    <figure>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-sage" aria-hidden />
            {label} {weighted ? "(measured)" : ""}
          </span>
          {showEstimate ? (
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full bg-ink-3" aria-hidden />
              Estimated 1RM
            </span>
          ) : null}
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-sage-deep ring-2 ring-sage-soft" aria-hidden />
            Record
          </span>
        </figcaption>
        {ranges.length > 1 ? (
          <div role="group" aria-label="Time range" className="flex rounded-md border border-line p-0.5">
            {ranges.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={range === r.id}
                onClick={() => {
                  setRange(r.id);
                  setActive(null);
                }}
                className={cn(
                  "num h-7 rounded-[5px] px-2.5 text-[12px] transition-colors",
                  range === r.id ? "bg-sunken text-ink" : "text-ink-3 hover:text-ink",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div ref={wrap} className="relative mt-4 select-none">
        {shown.length === 0 ? (
          <p className="flex h-[260px] items-center justify-center text-sm text-ink-3">No sessions in this range.</p>
        ) : (
          <svg
            width={width}
            height={H}
            viewBox={`0 0 ${width} ${H}`}
            role="img"
            aria-label={`${label} per session, ${shown.length} sessions. Use the arrow keys to step through them.`}
            tabIndex={0}
            className="block touch-pan-y rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ink-3"
            onPointerMove={(e) => setActive(nearest(e.clientX))}
            onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
            onClick={() => a && router.push(`/history/${a.sessionId}`)}
            onBlur={() => setActive(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const d = e.key === "ArrowRight" ? 1 : -1;
                setActive((i) => Math.min(shown.length - 1, Math.max(0, (i ?? (d > 0 ? -1 : shown.length)) + d)));
              } else if (e.key === "Enter" && a) router.push(`/history/${a.sessionId}`);
              else if (e.key === "Escape") setActive(null);
            }}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-ink-3 text-[11px]">
                  {fmt(t)}
                </text>
              </g>
            ))}
            {dateTicks.map((p) => (
              <text key={p.sessionId} x={x(p.at)} y={H - 8} textAnchor="middle" className="num fill-ink-3 text-[11px]">
                {p.date}
              </text>
            ))}

            {showEstimate ? (
              <path d={path((p) => p.e1rm)} fill="none" stroke="var(--ink-3)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />
            ) : null}
            <path d={path((p) => p.value)} fill="none" stroke="var(--sage)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

            {a ? <line x1={x(a.at)} x2={x(a.at)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--line-strong)" strokeWidth={1} /> : null}

            {shown.map((p, i) => (
              <circle
                key={p.sessionId}
                cx={x(p.at)}
                cy={y(p.value)}
                r={p.record ? 5 : i === active ? 4.5 : shown.length > 40 ? 2.5 : 4}
                fill={p.record ? "var(--sage-deep)" : "var(--sage)"}
                stroke="var(--surface)"
                strokeWidth={2}
              />
            ))}
            {a && showEstimate && a.e1rm != null ? (
              <circle cx={x(a.at)} cy={y(a.e1rm)} r={4} fill="var(--ink-3)" stroke="var(--surface)" strokeWidth={2} />
            ) : null}

            {last ? (
              <text x={x(last.at) + 10} y={y(last.value)} dy="0.32em" className="num fill-ink text-[12px] font-medium">
                {fmt(last.value)}
                <tspan className="fill-ink-3 font-normal"> {weighted ? unit : "reps"}</tspan>
              </text>
            ) : null}
          </svg>
        )}

        {a ? (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 w-max max-w-[220px] rounded-md border border-line bg-surface px-3 py-2 text-[12px] shadow-[var(--shadow)]"
            style={{
              left: Math.min(Math.max(0, x(a.at) - 110), width - 220),
              transform: y(a.value) < H / 2 ? `translateY(${H - 96}px)` : undefined,
            }}
          >
            <p className="num text-ink-3">
              {a.date} · {a.routine}
              {a.isSample ? " · sample" : ""}
            </p>
            <p className="num mt-1 font-medium text-ink">
              {label}: {fmt(a.value)} {weighted ? unit : "reps"}
              {a.record ? <span className="ml-1.5 font-normal text-sage-deep">Record</span> : null}
            </p>
            {showEstimate && a.e1rm != null ? (
              <p className="num text-ink-2">
                Est. 1RM {fmt(a.e1rm)} {unit}
              </p>
            ) : null}
            <p className="num mt-1 text-ink-3">{a.sets}</p>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
