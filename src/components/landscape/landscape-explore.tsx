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
import type { Landmark } from "@/lib/landscape/terrain";
import { buildWorld, growthBetween, growthSentence, type WorldSession } from "@/lib/landscape/world";
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

const isTouch = () => typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
const noop = () => () => {};

// When the viewer last saw their world. Read once per visit (cached until the screen unmounts), so the
// growth plays from a fixed "before" even after the new state has been written back.
const seenKey = (uid: string) => `trace:world-seen:${uid}`;
const seenCache = new Map<string, string | null>();
function lastSeen(uid: string): string | null {
  if (!seenCache.has(uid)) {
    let v: string | null = null;
    try {
      v = window.localStorage.getItem(seenKey(uid));
    } catch {}
    seenCache.set(uid, v);
  }
  return seenCache.get(uid)!;
}
function markSeen(uid: string, asOf: string) {
  try {
    window.localStorage.setItem(seenKey(uid), asOf);
  } catch {}
}

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
  history,
  grew,
  range,
  window: win,
  timeZone,
  seed,
  unit,
  trainingDays,
  onRangeChange,
}: {
  sessions: ExploreSession[];
  /** the whole history: the world is built from it, the period only chooses what is shown */
  history: WorldSession[];
  /** a session just completed: grow the world from just before it */
  grew: string | null;
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
  // client-only: the world is built in the browser, at a lighter grid on phones
  const client = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const touch = useSyncExternalStore(noop, isTouch, () => false);
  const seen = useSyncExternalStore(
    noop,
    () => lastSeen(seed),
    () => null,
  );
  useEffect(() => () => void seenCache.delete(seed), [seed]);
  const latest = history.length ? history.reduce((m, h) => (h.endedAt > m ? h.endedAt : m), history[0].endedAt) : null;

  const worldOpts = useMemo(() => {
    const cols = touch ? 160 : 220;
    return {
      history,
      seed,
      timeStart: start,
      timeEnd: end,
      cols,
      rows: Math.round((cols * 64) / 100),
      aspect: 100 / 64,
      rest,
    };
  }, [history, seed, start, end, rest, touch]);
  const terrain = useMemo(
    () => (client ? buildWorld({ ...worldOpts, show: toLandscapeSessions(sessions, { templateId: null, exerciseId: null }) }) : null),
    [client, worldOpts, sessions],
  );
  // the earlier world the terrain grows from: just before this workout, or as of the last visit
  const growth = useMemo(() => {
    if (!terrain) return null;
    const before = grew
      ? buildWorld({ ...worldOpts, exclude: [grew] })
      : seen && latest && seen < latest
        ? buildWorld({ ...worldOpts, asOf: seen })
        : null;
    if (!before) return null;
    const changes = growthBetween(before, terrain);
    const sentence = growthSentence(changes, grew ? "workout" : "visit");
    return sentence ? { before, sentence, focus: changes[0].key } : null;
  }, [terrain, worldOpts, grew, seen, latest]);
  const [growthDone, setGrowthDone] = useState(false);
  useEffect(() => {
    // the world has been seen as it is now; a shared ?grew link should not replay on refresh
    if (!client || !latest) return;
    if (!growth) markSeen(seed, latest);
    if (grew)
      window.history.replaceState(window.history.state, "", window.location.href.replace(/([?&])grew=[^&]*&?/, "$1").replace(/[?&]$/, ""));
  }, [client, growth, grew, latest, seed]);
  const onGrowthDone = useCallback(() => {
    if (latest) markSeen(seed, latest);
    setGrowthDone(true);
  }, [latest, seed]);
  const [toastGone, setToastGone] = useState(false);
  useEffect(() => {
    if (!growthDone) return;
    const t = setTimeout(() => setToastGone(true), 6000);
    return () => clearTimeout(t);
  }, [growthDone]);

  const theme = useSyncExternalStore(subscribeTheme, themeKey, () => "server");
  const themeVersion = useMemo(() => Array.from(theme).reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0), [theme]);
  const webgl = useSyncExternalStore(
    () => () => {},
    hasWebGL,
    () => true,
  );

  const scene = useRef<Terrain3DHandle>(null);
  const [tilted, setTilted] = useState(true);
  const [selected, setSelectedRaw] = useState<Selection>(null);
  const [expanded, setExpanded] = useState(false);
  const setSelected = useCallback((v: Selection) => {
    setSelectedRaw(v);
    setExpanded(false);
  }, []);
  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const selectedSession = selected?.kind === "session" ? byId.get(selected.id) : undefined;

  const onSelectSession = useCallback((l: Landmark) => setSelected({ kind: "session", id: l.session.id }), [setSelected]);
  const onSelectRest = useCallback((span: RestSpan) => setSelected({ kind: "rest", span }), [setSelected]);
  const onSelectRegion = useCallback((key: string) => setSelected({ kind: "region", key }), [setSelected]);
  const regions = useMemo(() => regionSummaries(sessions), [sessions]);
  // a range with no sessions in this period still has a panel (its all-time facts)
  const selectedRegion: RegionSummary | undefined =
    selected?.kind === "region"
      ? (regions.find((r) => r.key === selected.key) ??
        (() => {
          const w = terrain?.regions.find((r) => r.key === selected.key);
          return w ? { key: w.key, name: w.label, workouts: 0, records: 0, volumeTrend: null, recent: [], prs: [] } : undefined;
        })())
      : undefined;
  const allTime = selected?.kind === "region" ? terrain?.regions.find((r) => r.key === selected.key) : undefined;
  // a selected session keeps its region lit, so the context stays visible
  const litRegion =
    selectedRegion?.key ??
    (selectedSession ? (selectedSession.templateId ?? `name:${selectedSession.templateName}`) : null) ??
    // while the terrain grows, the range that grew most is lit
    (growth && !growthDone ? growth.focus : null);
  const onClear = useCallback(() => setSelected(null), [setSelected]);

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
  }, [setSelected]);

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
        {webgl && terrain ? (
          <Terrain3D
            ref={scene}
            terrain={terrain}
            from={growth?.before ?? null}
            onGrowthDone={onGrowthDone}
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
        ) : !webgl ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="max-w-sm">
              <p className="font-serif text-[22px]">This device can&apos;t draw the 3D landscape.</p>
              <Link href="/landscape" className="mt-4 inline-block text-sm underline underline-offset-4">
                Open the map instead
              </Link>
            </div>
          </div>
        ) : (
          <p className="absolute inset-0 grid place-items-center text-sm text-ink-3">Raising the terrain…</p>
        )}

        {/* every session stays reachable without the canvas (screen readers, keyboard) */}
        <ul className="sr-only">
          {(terrain?.landmarks ?? []).map((l) => (
            <li key={l.session.id}>
              <button type="button" onClick={() => onSelectSession(l)}>
                {markerLabel(l, unit)}
              </button>
            </li>
          ))}
        </ul>

        {/* what grew, in one factual line */}
        {growth && !toastGone ? (
          <p
            role="status"
            className="pointer-events-none absolute inset-x-3 top-[calc(env(safe-area-inset-top)+64px)] z-10 mx-auto w-fit max-w-[calc(100%-24px)] animate-[fade-in_600ms_var(--ease-out)_both] rounded-md bg-surface/92 px-3.5 py-2 text-center text-[13px] text-ink-2 shadow-[var(--shadow)] backdrop-blur"
          >
            {growthDone ? growth.sentence : grew ? "Your landscape is growing from this workout…" : "Your landscape since your last visit…"}
          </p>
        ) : null}

        {sessions.length === 0 && history.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="pointer-events-auto max-w-sm rounded-lg bg-surface/92 px-6 py-5 text-center shadow-[var(--shadow)]">
              <p className="font-serif text-[22px] leading-tight">Your landscape begins with your first session.</p>
              <p className="mt-2 text-sm text-ink-2">
                Each workout raises its routine&apos;s range; rest days fill the river. Come back after training to see it grow.
              </p>
              <Link href="/" className="mt-4 inline-block text-sm font-medium underline underline-offset-4">
                Go to Today
              </Link>
            </div>
          </div>
        ) : null}

        {/* controls: one compact bar on touch screens (hidden under an open sheet), a column on desktop */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+14px)] z-10 flex justify-center px-3",
            "roomy:inset-x-auto roomy:right-5 roomy:bottom-[calc(env(safe-area-inset-bottom)+16px)] roomy:px-0",
            selected && "compact:hidden",
          )}
        >
          <div className="flex items-center gap-1 rounded-lg border border-line-strong bg-surface/92 p-1 shadow-[var(--shadow)] backdrop-blur roomy:flex-col roomy:items-end roomy:gap-2 roomy:border-0 roomy:bg-transparent roomy:p-0 roomy:shadow-none roomy:backdrop-blur-none">
            <div className="flex overflow-hidden roomy:flex-col roomy:rounded-md roomy:border roomy:border-line-strong roomy:bg-surface/90 roomy:shadow-[var(--shadow)] roomy:backdrop-blur">
              <MapButton
                label="Zoom out"
                onClick={() => scene.current?.zoomOut()}
                className="compact:order-first roomy:order-last roomy:border-t roomy:border-line"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                  <path d="M2.5 7h9" />
                </svg>
              </MapButton>
              <MapButton label="Zoom in" onClick={() => scene.current?.zoomIn()}>
                <IconPlus />
              </MapButton>
            </div>
            {tilted ? (
              <div className="flex roomy:hidden">
                <MapButton label="Turn left" onClick={() => scene.current?.rotate(-Math.PI / 4)}>
                  <IconTurn />
                </MapButton>
                <MapButton label="Turn right" onClick={() => scene.current?.rotate(Math.PI / 4)}>
                  <IconTurn flip />
                </MapButton>
              </div>
            ) : null}
            <div
              role="radiogroup"
              aria-label="View"
              className="flex overflow-hidden rounded-md text-[12px] font-medium roomy:border roomy:border-line-strong roomy:bg-surface/90 roomy:shadow-[var(--shadow)] roomy:backdrop-blur"
            >
              {(["3D", "2D"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={(m === "3D") === tilted}
                  onClick={() => setTilted(m === "3D")}
                  className={cn(
                    "h-11 px-3 transition-colors roomy:h-9",
                    (m === "3D") === tilted ? "rounded-md bg-ink text-paper roomy:rounded-none" : "text-ink-2 hover:text-ink",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => scene.current?.reset()}
              aria-label="Reset view"
              className="h-11 rounded-md px-3 text-[12px] text-ink-2 hover:text-ink roomy:h-9 roomy:border roomy:border-line-strong roomy:bg-surface/90 roomy:shadow-[var(--shadow)] roomy:backdrop-blur"
            >
              Reset
            </button>
          </div>
        </div>
        <p className="pointer-events-none absolute bottom-[calc(env(safe-area-inset-bottom)+16px)] left-3 z-10 hidden rounded-md bg-surface/80 px-2.5 py-1.5 text-[11px] text-ink-3 backdrop-blur roomy:left-5 roomy:block">
          Drag to move · scroll or pinch to zoom · right-drag or two fingers to turn
        </p>

        {/* details: a bottom sheet on phones, a side panel on desktop */}
        {selected ? (
          <aside
            aria-live="polite"
            className={cn(
              "absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-xl border-t border-line bg-surface shadow-[var(--shadow)] transition-[max-height] duration-300 ease-[var(--ease-out)]",
              expanded ? "max-h-[85dvh]" : "max-h-[46dvh]",
              "roomy:inset-x-auto roomy:bottom-auto roomy:right-5 roomy:top-16 roomy:max-h-[calc(100%-96px)] roomy:w-[360px] roomy:rounded-lg roomy:border",
            )}
          >
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Show less" : "Show more"}
              aria-expanded={expanded}
              className="flex h-6 shrink-0 items-center justify-center roomy:hidden"
            >
              <span className="h-1 w-9 rounded-full bg-line-strong" aria-hidden />
            </button>
            <div className="overflow-y-auto overscroll-contain px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] compact:pt-1 roomy:p-5">
              {selectedSession ? (
                <SessionDetail session={selectedSession} exerciseId={null} unit={unit} timeZone={timeZone} onClose={onClear} />
              ) : selected.kind === "rest" ? (
                <RestDetail span={selected.span} onClose={onClear} />
              ) : selectedRegion ? (
                <RegionDetail
                  region={selectedRegion}
                  allTime={allTime ? { sessions: allTime.sessions } : null}
                  unit={unit}
                  timeZone={timeZone}
                  range={range}
                  onOpen={(id) => setSelected({ kind: "session", id })}
                  onClose={onClear}
                />
              ) : null}
            </div>
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
      className={cn(
        "flex size-11 items-center justify-center rounded-md text-ink-2 hover:bg-sunken hover:text-ink roomy:size-10 roomy:rounded-none",
        className,
      )}
    >
      {children}
    </button>
  );
}

function IconTurn({ flip }: { flip?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M3.5 6.5A5 5 0 1 1 3 9.5" strokeLinecap="round" />
      <path d="M3.5 2.8v3.7h3.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RegionDetail({
  region: r,
  allTime,
  unit,
  timeZone,
  range,
  onOpen,
  onClose,
}: {
  region: RegionSummary;
  allTime: { sessions: number } | null;
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
        This routine&apos;s range. Every session raises it a little{allTime ? ` (${plural(allTime.sessions, "session")} so far)` : ""}, and
        it never shrinks.
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
      {r.workouts === 0 ? <p className="mt-5 text-[13px] text-ink-3">No sessions of this routine in this period.</p> : null}
      {r.prs.length ? (
        <>
          <h3 className="mt-5 text-[13px] font-medium">Personal records</h3>
          <ul className="mt-2">
            {r.prs.slice(0, 4).map(({ session: s, record, exerciseName }) => (
              <li
                key={`${record.setId}:${record.kind}`}
                className="num flex items-baseline gap-3 border-b border-line py-2.5 text-[13px] last:border-0"
              >
                <span className="min-w-0 flex-1 truncate">{exerciseName}</span>
                <span className="text-ink-2">
                  {record.kind === "most_reps" ? `${record.reps} reps` : `${formatWeight(record.weight)} ${unit} × ${record.reps}`}
                </span>
                <span className="w-14 text-right text-[11px] text-ink-3">{formatShortDate(s.endedAt, timeZone)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className={cn("mt-5 flex items-baseline justify-between", !r.recent.length && "hidden")}>
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
