"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { IconArrowLeft, IconPlus } from "@/components/icons";
import {
  RANGES,
  regionSummaries,
  toLandscapeSessions,
  type ExploreSession,
  type RangeId,
  type RegionSummary,
  type Window,
} from "@/lib/landscape/explore";
import { restSpans, type RestSpan } from "@/lib/landscape/rest";
import { buildTerrain, type Landmark } from "@/lib/landscape/terrain";
import { formatShortDate, formatWeight, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SessionDetail } from "./landscape-explorer";
import { markerLabel } from "./landscape-parts";
import type { Terrain3DHandle } from "./terrain-3d";

// three.js is heavy; load it only on this screen, and only in the browser.
const Terrain3D = dynamic(() => import("./terrain-3d").then((m) => m.Terrain3D), {
  ssr: false,
  loading: () => <p className="absolute inset-0 grid place-items-center text-sm text-ink-3">Raising the terrain…</p>,
});

type Selection = { kind: "session"; id: string } | { kind: "rest"; span: RestSpan } | { kind: "region"; key: string } | null;

const subscribeTheme = (fn: () => void) => {
  const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  mq?.addEventListener("change", fn);
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    mq?.removeEventListener("change", fn);
    mo.disconnect();
  };
};
const themeKey = () =>
  `${document.documentElement.dataset.theme ?? "system"}:${typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches}`;

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Full-screen 3D Training Landscape. One finger (or drag) pans, two fingers (or scroll) zoom and
 * rotate. 2D is the same scene seen from straight above.
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
        cols: 220,
        rows: Math.round((220 * 64) / 100),
        aspect: 100 / 64,
        rest,
      }),
    [sessions, seed, start, end, rest],
  );

  const theme = useSyncExternalStore(subscribeTheme, themeKey, () => "server");
  const themeVersion = useMemo(() => Array.from(theme).reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0), [theme]);
  const webgl = useSyncExternalStore(
    () => () => {},
    hasWebGL,
    () => true,
  );

  const scene = useRef<Terrain3DHandle>(null);
  const [tilted, setTilted] = useState(true);
  const [selected, setSelected] = useState<Selection>(null);
  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const selectedSession = selected?.kind === "session" ? byId.get(selected.id) : undefined;

  const onSelectSession = useCallback((l: Landmark) => setSelected({ kind: "session", id: l.session.id }), []);
  const onSelectRest = useCallback((span: RestSpan) => setSelected({ kind: "rest", span }), []);
  const onSelectRegion = useCallback((key: string) => setSelected({ kind: "region", key }), []);
  const regions = useMemo(() => regionSummaries(sessions), [sessions]);
  const selectedRegion = selected?.kind === "region" ? regions.find((r) => r.key === selected.key) : undefined;
  // a selected session keeps its region lit, so the context stays visible
  const litRegion =
    selectedRegion?.key ?? (selectedSession ? (selectedSession.templateId ?? `name:${selectedSession.templateName}`) : null);
  const onClear = useCallback(() => setSelected(null), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Escape") setSelected(null);
      if (e.key === "+" || e.key === "=") scene.current?.zoomIn();
      if (e.key === "-") scene.current?.zoomOut();
      if (e.key === "0") scene.current?.reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-paper">
      {/* top bar floats over the scene so the terrain fills the screen */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-14 items-center justify-between gap-3 bg-gradient-to-b from-paper via-paper/80 to-transparent px-3 pt-[env(safe-area-inset-top)] sm:px-5">
        <Link
          href={`/landscape${range !== "12w" ? `?range=${range}` : ""}`}
          className="pointer-events-auto flex items-center gap-1.5 rounded-md bg-surface/80 px-2.5 py-2 text-[13px] text-ink-2 backdrop-blur hover:text-ink"
        >
          <IconArrowLeft /> <span className="hidden sm:inline">Landscape</span>
        </Link>
        <p className="font-serif text-[18px] leading-none">Explore</p>
        <label className="sr-only" htmlFor="explore-range">
          Period
        </label>
        <select
          id="explore-range"
          value={range}
          onChange={(e) => onRangeChange(e.target.value as RangeId)}
          className="pointer-events-auto h-9 max-w-36 appearance-none rounded-md border border-line-strong bg-surface/90 px-2.5 text-[13px] text-ink backdrop-blur focus:border-ink focus:outline-none"
        >
          {RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div className="relative flex-1 select-none overflow-hidden" role="region" aria-label="3D training landscape">
        {webgl ? (
          <Terrain3D
            ref={scene}
            terrain={terrain}
            timeZone={timeZone}
            unit={unit}
            tilted={tilted}
            selectedId={selectedSession?.id ?? null}
            selectedRegion={litRegion}
            regions={regions}
            theme={themeVersion}
            onSelectSession={onSelectSession}
            onSelectRegion={onSelectRegion}
            onSelectRest={onSelectRest}
            onClearSelection={onClear}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="max-w-sm">
              <p className="font-serif text-[22px]">This device can&apos;t draw the 3D landscape.</p>
              <Link href="/landscape" className="mt-4 inline-block text-sm underline underline-offset-4">
                Open the map instead
              </Link>
            </div>
          </div>
        )}

        {/* every session stays reachable without the canvas (screen readers, keyboard) */}
        <ul className="sr-only">
          {terrain.landmarks.map((l) => (
            <li key={l.session.id}>
              <button type="button" onClick={() => onSelectSession(l)}>
                {markerLabel(l, unit)}
              </button>
            </li>
          ))}
        </ul>

        {sessions.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="pointer-events-auto max-w-sm rounded-lg bg-surface/92 px-6 py-5 text-center shadow-[var(--shadow)]">
              <p className="font-serif text-[22px] leading-tight">Your landscape begins with your first session.</p>
              <p className="mt-2 text-sm text-ink-2">
                Each workout raises a range; rest days fill the river. Come back after training to explore it.
              </p>
              <Link href="/" className="mt-4 inline-block text-sm font-medium underline underline-offset-4">
                Go to Today
              </Link>
            </div>
          </div>
        ) : null}

        {/* controls */}
        <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+16px)] right-3 z-10 flex flex-col items-end gap-2 sm:right-5">
          <div className="flex flex-col overflow-hidden rounded-md border border-line-strong bg-surface/90 shadow-[var(--shadow)] backdrop-blur">
            <MapButton label="Zoom in" onClick={() => scene.current?.zoomIn()}>
              <IconPlus />
            </MapButton>
            <MapButton label="Zoom out" onClick={() => scene.current?.zoomOut()} className="border-t border-line">
              <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                <path d="M2.5 7h9" />
              </svg>
            </MapButton>
          </div>
          <div
            role="radiogroup"
            aria-label="View"
            className="flex overflow-hidden rounded-md border border-line-strong bg-surface/90 text-[12px] font-medium shadow-[var(--shadow)] backdrop-blur"
          >
            {(["3D", "2D"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={(m === "3D") === tilted}
                onClick={() => setTilted(m === "3D")}
                className={cn("h-9 px-3 transition-colors", (m === "3D") === tilted ? "bg-ink text-paper" : "text-ink-2 hover:text-ink")}
              >
                {m}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => scene.current?.reset()}
            className="h-9 rounded-md border border-line-strong bg-surface/90 px-3 text-[12px] text-ink-2 shadow-[var(--shadow)] backdrop-blur hover:text-ink"
          >
            Reset
          </button>
        </div>
        <p className="pointer-events-none absolute bottom-[calc(env(safe-area-inset-bottom)+16px)] left-3 z-10 hidden rounded-md bg-surface/80 px-2.5 py-1.5 text-[11px] text-ink-3 backdrop-blur sm:left-5 sm:block">
          Drag to move · scroll or pinch to zoom · right-drag or two fingers to turn
        </p>

        {/* detail card */}
        {selected ? (
          <aside
            aria-live="polite"
            className={cn(
              "absolute inset-x-0 bottom-0 z-20 max-h-[58%] overflow-y-auto rounded-t-xl border-t border-line bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-[var(--shadow)]",
              "sm:inset-x-auto sm:bottom-auto sm:right-5 sm:top-16 sm:max-h-[calc(100%-96px)] sm:w-[360px] sm:rounded-lg sm:border",
            )}
          >
            {selectedSession ? (
              <SessionDetail session={selectedSession} exerciseId={null} unit={unit} timeZone={timeZone} onClose={onClear} />
            ) : selected.kind === "rest" ? (
              <RestDetail span={selected.span} onClose={onClear} />
            ) : selectedRegion ? (
              <RegionDetail
                region={selectedRegion}
                unit={unit}
                timeZone={timeZone}
                range={range}
                onOpen={(id) => setSelected({ kind: "session", id })}
                onClose={onClear}
              />
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

function RegionDetail({
  region: r,
  unit,
  timeZone,
  range,
  onOpen,
  onClose,
}: {
  region: RegionSummary;
  unit: string;
  timeZone: string;
  range: RangeId;
  onOpen: (sessionId: string) => void;
  onClose: () => void;
}) {
  return (
    <section aria-label={`Region: ${r.name}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="size-2 rounded-full bg-sage" aria-hidden />
          <h2 className="text-[16px] font-medium leading-tight">{r.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 -mt-1 flex size-9 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
        </button>
      </div>
      <p className="mt-2 text-[13px] text-ink-3">
        This routine&apos;s range: every session raises it, and its records stand as sage points.
      </p>
      <dl className="num mt-5 grid grid-cols-3 gap-4 border-y border-line py-4">
        <div>
          <dd className="text-[20px] font-medium leading-none">{r.workouts}</dd>
          <dt className="mt-1.5 text-[11px] text-ink-3">Workouts</dt>
        </div>
        <div>
          <dd className="text-[20px] font-medium leading-none">{r.records}</dd>
          <dt className="mt-1.5 text-[11px] text-ink-3">Personal records</dt>
        </div>
        <div>
          <dd className="text-[20px] font-medium leading-none">
            {r.volumeTrend == null ? "—" : `${r.volumeTrend > 0 ? "+" : ""}${r.volumeTrend}%`}
          </dd>
          <dt className="mt-1.5 text-[11px] text-ink-3" title="Average session volume, latest third of the period vs the first third">
            Volume trend
          </dt>
        </div>
      </dl>
      <div className="mt-5 flex items-baseline justify-between">
        <h3 className="text-[13px] font-medium">Recent sessions</h3>
        <span className="text-[11px] text-ink-3">{plural(r.workouts, "session")} in this period</span>
      </div>
      <ul className="mt-2">
        {r.recent.map(({ session: s, topSet, record }) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onOpen(s.id)}
              className="group flex w-full items-center gap-3 border-b border-line py-3 text-left last:border-0"
            >
              <span className={record ? "size-1.5 shrink-0 rounded-full bg-sage" : "size-1.5 shrink-0 rounded-full bg-ink-4"} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="num block text-[13px] text-ink">
                  {formatShortDate(s.endedAt, timeZone)}
                  {record ? (
                    <span className="ml-2 rounded-sm bg-sage-wash px-1.5 py-px text-[10px] font-medium text-sage-deep">PR</span>
                  ) : null}
                </span>
                {topSet ? (
                  <span className="num block truncate text-[12px] text-ink-3">
                    {topSet.exercise} ·{" "}
                    {topSet.weight != null ? `${formatWeight(topSet.weight)} ${unit} × ${topSet.reps}` : `${topSet.reps} reps`}
                  </span>
                ) : null}
              </span>
              <span className="text-ink-4 transition-colors group-hover:text-ink" aria-hidden>
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Link
        href={`/landscape?workout=${encodeURIComponent(r.key)}${range !== "12w" ? `&range=${range}` : ""}`}
        className="mt-5 flex h-10 items-center justify-center rounded-md border border-line-strong text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink"
      >
        Explore this routine&apos;s sessions
      </Link>
    </section>
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
      <p className="num mt-3 text-sm text-ink-2">
        {formatShortDate(`${span.start}T12:00:00Z`, "UTC")}
        {span.days > 1 ? ` – ${formatShortDate(`${span.end}T12:00:00Z`, "UTC")}` : ""}
      </p>
      <p className="mt-4 text-sm text-ink-3">
        Days your plan leaves open, with nothing logged. Recovery is where training turns into strength; on the map it is where the river
        widens.
      </p>
    </section>
  );
}
