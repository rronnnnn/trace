"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowLeft, IconPlus } from "@/components/icons";
import { contourLines, evenLevels, resampleField } from "@/lib/landscape/contours";
import { RANGES, toLandscapeSessions, type ExploreSession, type RangeId, type Window } from "@/lib/landscape/explore";
import { restSpans, type RestSpan } from "@/lib/landscape/rest";
import { buildTerrain, dateToX, type Landmark } from "@/lib/landscape/terrain";
import { clampCamera, initialCamera, lerpCamera, panBy, viewBox, zoomAt, type Camera, type Screen } from "@/lib/landscape/viewport";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { monthTicks, SessionDetail } from "./landscape-explorer";
import { ContourLayer, MapTooltip, MarkerGlyph, markerLabel, ReliefLayer, VegetationLayer, WaterLayer } from "./landscape-parts";

const W = 1000;
const H = 640;
const WORLD = { width: W, height: H };
const TILT = 34; // degrees, for the 3D view

type Selection = { kind: "session"; id: string } | { kind: "rest"; span: RestSpan } | null;

/**
 * Full-screen, explorable Training Landscape. Drag to pan, scroll or pinch to zoom, double-tap
 * to zoom in. Detail grows with zoom: finer contours, then session dates and rest-day labels.
 * An optional perspective tilt gives the terrain a gentle 3D read.
 */
export function LandscapeExplore({
  sessions,
  range,
  window: win,
  timeZone,
  seed,
  unit,
  trainingDays,
  onRangeChange,
}: {
  sessions: ExploreSession[];
  range: RangeId;
  window: Window;
  timeZone: string;
  seed: string;
  unit: string;
  trainingDays: number[];
  onRangeChange: (r: RangeId) => void;
}) {
  const start = useMemo(() => new Date(win.start), [win.start]);
  const end = useMemo(() => new Date(win.end), [win.end]);
  const rest = useMemo(
    () => restSpans({ start, end, timeZone, trainingDays, sessionEndedAts: sessions.map((s) => s.endedAt) }),
    [start, end, timeZone, trainingDays, sessions],
  );
  const terrain = useMemo(
    () =>
      buildTerrain({
        sessions: toLandscapeSessions(sessions, { templateId: null, exerciseId: null }),
        seed,
        start,
        end,
        cols: 280,
        rows: Math.round((280 * H) / W),
        aspect: W / H,
        rest,
      }),
    [sessions, seed, start, end, rest],
  );

  // ── camera ────────────────────────────────────────────────────────────────
  const box = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState<Screen>({ width: 1000, height: 640 });
  const [cam, setCam] = useState<Camera>(initialCamera(WORLD));
  const [tilted, setTilted] = useState(true);
  const camRef = useRef(cam);
  const screenRef = useRef(screen);
  // latest values for animation frames and native listeners
  useEffect(() => {
    camRef.current = cam;
    screenRef.current = screen;
  }, [cam, screen]);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setScreen({ width, height });
      setCam((c) => clampCamera(c, WORLD, { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const reduced = useRef(false);
  useEffect(() => {
    reduced.current = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  const anim = useRef<number | null>(null);
  const flyTo = useCallback((target: Camera) => {
    if (anim.current) cancelAnimationFrame(anim.current);
    const from = camRef.current;
    const to = clampCamera(target, WORLD, screenRef.current);
    if (reduced.current) return setCam(to);
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 320);
      setCam(lerpCamera(from, to, t));
      anim.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    anim.current = requestAnimationFrame(step);
  }, []);

  const local = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  // Under the tilt, zoom anchors at the centre (the projected point under the cursor drifts).
  const anchor = (p: { x: number; y: number }) => (tilted ? { x: screen.width / 2, y: screen.height / 2 } : p);

  // wheel: non-passive so the page itself never scrolls or zooms
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const p = tilted ? { x: r.width / 2, y: r.height / 2 } : { x: e.clientX - r.left, y: e.clientY - r.top };
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
      setCam((c) => zoomAt(c, WORLD, screenRef.current, factor, p.x, p.y));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [tilted]);

  // pointers: one = pan (after a small threshold, so taps still select), two = pinch
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; pinch: number | null; captured: boolean }>({ moved: false, pinch: null, captured: false });
  const squash = tilted ? 1 / Math.cos((TILT * Math.PI) / 180) : 1;

  const onPointerDown = (e: React.PointerEvent) => {
    if (anim.current) cancelAnimationFrame(anim.current);
    pointers.current.set(e.pointerId, local(e.clientX, e.clientY));
    gesture.current = { moved: false, pinch: null, captured: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = anchor({ x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 });
      if (gesture.current.pinch) setCam((c) => zoomAt(c, WORLD, screen, d / gesture.current.pinch!, mid.x, mid.y));
      gesture.current.pinch = d;
      gesture.current.moved = true;
      return;
    }
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    if (!gesture.current.moved && Math.hypot(dx, dy) < 3) return;
    if (!gesture.current.captured) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      gesture.current.captured = true;
      setDragging(true);
    }
    gesture.current.moved = true;
    setCam((c) => panBy(c, WORLD, screen, dx, dy, squash));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current.pinch = null;
    if (!pointers.current.size) setDragging(false);
  };

  const zoomButton = (factor: number) => flyTo(zoomAt(cam, WORLD, screen, factor, screen.width / 2, screen.height / 2));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 80;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => setCam((c) => panBy(c, WORLD, screen, step, 0)),
      ArrowRight: () => setCam((c) => panBy(c, WORLD, screen, -step, 0)),
      ArrowUp: () => setCam((c) => panBy(c, WORLD, screen, 0, step)),
      ArrowDown: () => setCam((c) => panBy(c, WORLD, screen, 0, -step)),
      "+": () => zoomButton(1.6),
      "=": () => zoomButton(1.6),
      "-": () => zoomButton(1 / 1.6),
      "0": () => flyTo(initialCamera(WORLD)),
      Escape: () => setSelected(null),
    };
    const fn = keys[e.key];
    if (fn && e.target === e.currentTarget) {
      e.preventDefault();
      fn();
    }
  };

  // ── level of detail ───────────────────────────────────────────────────────
  const k = cam.k;
  const detail = k >= 2 ? 2 : 1;
  const lines = useMemo(() => {
    const cc = detail === 2 ? 250 : 130;
    const cr = Math.round((cc * H) / W);
    const field = resampleField(terrain.field, terrain.cols, terrain.rows, cc, cr);
    return contourLines(field, cc, cr, W, H, evenLevels(detail === 2 ? 34 : 18));
  }, [terrain, detail]);

  const vb = viewBox(cam, WORLD, screen);
  const px = vb.w / Math.max(1, screen.width); // world units per screen pixel
  const months = useMemo(() => monthTicks(start, end), [start, end]);

  // Range names at each spine's midpoint, like a map's mountain labels.
  const rangeLabels = useMemo(() => {
    return terrain.bands.map((band) => {
      const ls = terrain.landmarks.filter((l) => l.session.templateKey === band);
      const mid = ls.reduce((best, l) => (Math.abs(l.u - 0.5) < Math.abs(best.u - 0.5) ? l : best), ls[0]);
      return { band, label: mid.session.label, x: mid.x * W, y: mid.y * H };
    });
  }, [terrain]);

  // ── selection ─────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Selection>(null);
  const [hover, setHover] = useState<string | null>(null);
  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const hoverMark = terrain.landmarks.find((l) => l.session.id === hover);
  const selectedSession = selected?.kind === "session" ? byId.get(selected.id) : undefined;

  const focusOn = (l: Landmark) => {
    setSelected({ kind: "session", id: l.session.id });
    if (cam.k < 2.2) flyTo({ cx: l.x * W, cy: l.y * H, k: 2.6 });
  };

  const restStretch =
    selected?.kind === "rest"
      ? { from: dateToX(`${selected.span.start}T00:00:00Z`, start, end), to: dateToX(`${selected.span.end}T23:59:59Z`, start, end) }
      : null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-paper">
      {/* top bar */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-3 sm:px-5">
        <Link
          href={`/landscape${range !== "12w" ? `?range=${range}` : ""}`}
          className="flex items-center gap-1.5 rounded-md px-2 py-2 text-[13px] text-ink-2 hover:text-ink"
        >
          <IconArrowLeft /> <span className="hidden sm:inline">Landscape</span>
        </Link>
        <p className="font-serif text-[18px] leading-none">Explore</p>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="explore-range">
            Period
          </label>
          <select
            id="explore-range"
            value={range}
            onChange={(e) => onRangeChange(e.target.value as RangeId)}
            className="h-9 max-w-36 appearance-none rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-ink focus:border-ink focus:outline-none"
          >
            {RANGES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* map */}
      <div
        ref={box}
        tabIndex={0}
        role="application"
        aria-label="Explorable training landscape. Drag or use arrow keys to move, scroll, pinch or plus and minus to zoom, 0 to reset."
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          const p = anchor(local(e.clientX, e.clientY));
          flyTo(zoomAt(cam, WORLD, screen, 2, p.x, p.y));
        }}
        className="relative flex-1 touch-none select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage"
        style={{ perspective: tilted ? "1100px" : undefined, cursor: dragging ? "grabbing" : "grab" }}
      >
        {tilted ? (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[22%] bg-gradient-to-b from-sunken to-transparent" />
        ) : null}
        <div
          className="absolute inset-0 transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={{
            transform: tilted ? `rotateX(${TILT}deg) scale(1.22) translateY(-4%)` : "none",
            transformOrigin: "50% 62%",
            maskImage: tilted ? "linear-gradient(to bottom, transparent 0%, black 16%)" : undefined,
            WebkitMaskImage: tilted ? "linear-gradient(to bottom, transparent 0%, black 16%)" : undefined,
          }}
        >
          <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="block h-full w-full" preserveAspectRatio="none">
            <rect x={0} y={0} width={W} height={H} fill="var(--terrain-mid)" />
            <ReliefLayer terrain={terrain} width={W} height={H} />
            <ContourLayer lines={lines} />
            <WaterLayer
              terrain={terrain}
              width={W}
              height={H}
              highlight={restStretch}
              onRest={(span) => setSelected({ kind: "rest", span })}
            />
            <VegetationLayer terrain={terrain} seed={seed} width={W} height={H} />

            {/* time along the river: month ticks, scaled to stay readable */}
            <g aria-hidden>
              {months.map((m) => (
                <text key={m.key} x={m.x * W + 4 * px} y={H - 12 * px} fontSize={12 * px} fill="var(--ink-3)">
                  {m.label}
                </text>
              ))}
            </g>

            {/* lakes become labelled as you zoom in */}
            {k >= 1.8
              ? terrain.water.lakes.map((l) => (
                  <text
                    key={l.span.start}
                    x={l.x * W}
                    y={l.y * H + (l.ry * H + 14 * px)}
                    textAnchor="middle"
                    fontSize={10.5 * px}
                    fontStyle="italic"
                    fill="var(--water-edge)"
                    className="pointer-events-none font-serif"
                    style={{ paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 3 * px, strokeOpacity: 0.7 }}
                  >
                    {l.span.days === 1 ? "rest" : `${l.span.days} days rest`}
                  </text>
                ))
              : null}

            {/* range names */}
            <g aria-hidden className="pointer-events-none">
              {rangeLabels.map((r) => (
                <text
                  key={r.band}
                  x={r.x}
                  y={r.y - 22 * px}
                  textAnchor="middle"
                  fontSize={13 * px}
                  letterSpacing={2.5 * px}
                  className="font-serif uppercase"
                  fill="var(--ink-2)"
                  style={{ paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 4 * px, strokeOpacity: 0.75 }}
                >
                  {r.label}
                </text>
              ))}
            </g>

            {terrain.landmarks.map((l) => {
              const id = l.session.id;
              return (
                <g
                  key={id}
                  role="button"
                  tabIndex={0}
                  aria-label={markerLabel(l, unit)}
                  aria-pressed={selectedSession?.id === id}
                  className="cursor-pointer outline-none"
                  onClick={() => focusOn(l)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      focusOn(l);
                    }
                  }}
                  onPointerEnter={() => setHover(id)}
                  onPointerLeave={() => setHover((h) => (h === id ? null : h))}
                  onFocus={() => setHover(id)}
                  onBlur={() => setHover(null)}
                >
                  <MarkerGlyph
                    cx={l.x * W}
                    cy={l.y * H}
                    r={4.4 * px}
                    record={l.session.prCount > 0}
                    active={hover === id}
                    selected={selectedSession?.id === id}
                  />
                  {k >= 2.4 ? (
                    <text
                      x={l.x * W + 9 * px}
                      y={l.y * H + 3.5 * px}
                      fontSize={10.5 * px}
                      fill="var(--ink-2)"
                      className="pointer-events-none"
                      style={{
                        paintOrder: "stroke",
                        stroke: "var(--paper)",
                        strokeWidth: 3 * px,
                        strokeOpacity: 0.8,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {formatShortDate(l.session.endedAt, timeZone)}
                    </text>
                  ) : null}
                </g>
              );
            })}

            {hoverMark && hoverMark.session.id !== selectedSession?.id ? (
              <g
                transform={`translate(${hoverMark.x * W} ${hoverMark.y * H}) scale(${px}) translate(${-hoverMark.x * W} ${-hoverMark.y * H})`}
              >
                <MapTooltip mark={hoverMark} width={W} height={H} unit={unit} />
              </g>
            ) : null}
          </svg>
        </div>

        {sessions.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="pointer-events-auto max-w-sm rounded-lg bg-surface/92 px-6 py-5 text-center shadow-[var(--shadow)]">
              <p className="font-serif text-[22px] leading-tight">Your landscape begins with your first session.</p>
              <p className="mt-2 text-sm text-ink-2">Each workout raises a range; rest days fill the river. Come back after training to explore it.</p>
              <Link href="/" className="mt-4 inline-block text-sm font-medium underline underline-offset-4">
                Go to Today
              </Link>
            </div>
          </div>
        ) : null}

        {/* controls */}
        <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+16px)] right-3 flex flex-col items-end gap-2 sm:right-5">
          <div className="flex flex-col overflow-hidden rounded-md border border-line-strong bg-surface shadow-[var(--shadow)]">
            <MapButton label="Zoom in" onClick={() => zoomButton(1.6)}>
              <IconPlus />
            </MapButton>
            <MapButton label="Zoom out" onClick={() => zoomButton(1 / 1.6)} className="border-t border-line">
              <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                <path d="M2.5 7h9" />
              </svg>
            </MapButton>
          </div>
          <button
            type="button"
            aria-pressed={tilted}
            onClick={() => setTilted((t) => !t)}
            className="h-10 rounded-md border border-line-strong bg-surface px-3 text-[12px] font-medium text-ink-2 shadow-[var(--shadow)] hover:text-ink"
          >
            {tilted ? "3D" : "2D"}
          </button>
          <button
            type="button"
            onClick={() => flyTo(initialCamera(WORLD))}
            className="h-9 rounded-md border border-line-strong bg-surface px-3 text-[12px] text-ink-2 shadow-[var(--shadow)] hover:text-ink"
          >
            Reset
          </button>
        </div>
        <p className="pointer-events-none absolute bottom-[calc(env(safe-area-inset-bottom)+16px)] left-3 hidden rounded-md bg-surface/85 px-2.5 py-1.5 text-[11px] text-ink-3 sm:left-5 sm:block">
          Drag to move · scroll or pinch to zoom · {k.toFixed(1)}×
        </p>

        {/* detail card */}
        {selected ? (
          <aside
            aria-live="polite"
            className={cn(
              "absolute inset-x-0 bottom-0 max-h-[58%] overflow-y-auto rounded-t-xl border-t border-line bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-[var(--shadow)]",
              "sm:inset-x-auto sm:bottom-auto sm:right-5 sm:top-5 sm:max-h-[calc(100%-40px)] sm:w-[360px] sm:rounded-lg sm:border",
            )}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {selectedSession ? (
              <SessionDetail
                session={selectedSession}
                exerciseId={null}
                unit={unit}
                timeZone={timeZone}
                onClose={() => setSelected(null)}
              />
            ) : selected.kind === "rest" ? (
              <RestDetail span={selected.span} onClose={() => setSelected(null)} />
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function MapButton({
  children,
  label,
  onClick,
  className,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn("flex size-10 items-center justify-center text-ink-2 hover:bg-sunken hover:text-ink", className)}
    >
      {children}
    </button>
  );
}

function RestDetail({ span, onClose }: { span: RestSpan; onClose: () => void }) {
  return (
    <section aria-label="Rest">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Rest</p>
          <h2 className="mt-2 font-serif text-[24px] leading-tight">{span.days === 1 ? "A day of rest" : `${span.days} days of rest`}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 flex size-9 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
        </button>
      </div>
      <p className="num mt-3 text-sm text-ink-2">{span.label.replace(/^.*?· /, "")}</p>
      <p className="mt-4 text-sm text-ink-3">
        Days your plan leaves open, with nothing logged. Recovery is where training turns into strength; on the map it is where the river
        widens.
      </p>
    </section>
  );
}
