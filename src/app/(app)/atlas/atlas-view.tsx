"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { hasWebGL } from "@/components/landscape/landscape-explore";
import type { PlaceKey } from "@/components/landscape/terrain-3d";
import { atlasStops, byMonth, placeOf, regionsAsOf } from "@/lib/atlas";
import { dayKey, weekStart } from "@/lib/dates";
import { formatLongDate, formatShortDate, plural } from "@/lib/format";
import { frontierGrid, frontierReach, landmarkSpots, summitSpots } from "@/lib/landscape/frontier";
import { CATEGORIES, summits, type LandmarkCategory, type WorldLandmark } from "@/lib/landscape/landmarks";
import { restSpans } from "@/lib/landscape/rest";
import type { Landmark } from "@/lib/landscape/terrain";
import { buildWorld, type WorldSession } from "@/lib/landscape/world";
import { cn } from "@/lib/utils";

const Terrain3D = dynamic(() => import("@/components/landscape/terrain-3d").then((m) => m.Terrain3D), {
  ssr: false,
  loading: () => <p className="absolute inset-0 grid place-items-center text-sm text-ink-3">Raising the terrain…</p>,
});

const noop = () => () => {};
const DAY = 86400000;

type Filter = "all" | LandmarkCategory | "summits";

/**
 * The Atlas, below its overview: the world as it stood on any day (rebuilt from the sessions up
 * to that day), and the record of every landmark, each one linked to its workout, its place in
 * the landscape, and the world on the day it was earned.
 */
export function AtlasView({
  history,
  landmarks,
  seed,
  unit,
  timeZone,
  trainingDays,
  now,
  initialAt,
}: {
  history: WorldSession[];
  landmarks: WorldLandmark[];
  seed: string;
  unit: string;
  timeZone: string;
  trainingDays: number[];
  now: string;
  initialAt: string | null;
}) {
  const client = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const webgl = useSyncExternalStore(noop, hasWebGL, () => true);
  const touch = useSyncExternalStore(
    noop,
    () => typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );

  const first = history[0]?.endedAt ?? now;
  const span = Math.max(1, Math.ceil((Date.parse(now) - Date.parse(first)) / DAY));
  const clamp = (iso: string) => (iso > now ? now : iso < first ? first : iso);
  // the committed moment the world is rebuilt for, and the slider's position while it moves
  const [at, setAt] = useState(() => clamp(initialAt ?? now));
  const [draft, setDraft] = useState(at);
  useEffect(() => {
    if (draft === at) return;
    const t = setTimeout(() => setAt(draft), 260);
    return () => clearTimeout(t);
  }, [draft, at]);
  const go = useCallback((iso: string) => {
    const v = iso > now ? now : iso;
    setDraft(v);
    setAt(v);
  }, [now]);

  const stops = useMemo(() => atlasStops(first, new Date(now)), [first, now]);
  const isNow = at === now;

  const past = useMemo(() => history.filter((s) => s.endedAt <= at), [history, at]);
  const then = useMemo(() => landmarks.filter((l) => l.at <= at), [landmarks, at]);
  const world = useMemo(() => {
    if (!client || !past.length) return null;
    const start = new Date(`${weekStart(dayKey(first, timeZone))}T00:00:00Z`);
    const end = new Date(Math.max(Date.parse(at), start.getTime() + DAY));
    const rest = restSpans({ start, end, timeZone, trainingDays, sessionEndedAts: past.map((s) => s.endedAt) });
    const cols = touch ? 160 : 220;
    return buildWorld({ history, seed, asOf: at, timeStart: start, timeEnd: end, cols, rows: Math.round((cols * 64) / 100), aspect: 100 / 64, rest });
  }, [client, past, history, seed, at, first, timeZone, trainingDays, touch]);
  const frontier = useMemo(() => {
    if (!client) return null;
    const all = summits(then, unit);
    const spots = summitSpots(seed, all.length);
    const found = all.filter((s) => s.landmark).map((s) => s.slot);
    return { grid: frontierGrid(seed, spots, frontierReach(past.length), found), spots, summits: all };
  }, [client, then, unit, seed, past.length]);
  const spots = useMemo(() => (world ? landmarkSpots(then, world.placed) : []), [world, then]);
  const regions = useMemo(() => regionsAsOf(history, at), [history, at]);

  // selection is shared: a place picked in the world opens its entry in the record, and back
  const [active, setActive] = useState<string | null>(null);
  const [session, setSession] = useState<Landmark["session"] | null>(null);
  const activeLandmark = landmarks.find((l) => l.id === active) ?? null;
  const onSelectPlace = useCallback(
    (key: PlaceKey) => {
      const l = key.startsWith("summit:")
        ? landmarks.find((x) => x.summit && `summit:${x.summit.slot}` === key)
        : landmarks.find((x) => `landmark:${x.id}` === key);
      setSession(null);
      setActive(l?.id ?? null);
      if (l) document.getElementById(`entry-${l.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [landmarks],
  );
  const onSelectSession = useCallback((l: Landmark) => {
    setActive(null);
    setSession(l.session);
  }, []);
  const onClear = useCallback(() => {
    setActive(null);
    setSession(null);
  }, []);
  const ignore = useCallback(() => {}, []);

  const worldRef = useRef<HTMLElement>(null);
  const seeThen = (l: WorldLandmark) => {
    go(l.at);
    setActive(l.id);
    worldRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const [filter, setFilter] = useState<Filter>("all");
  const shown = landmarks.filter((l) => (filter === "all" ? true : filter === "summits" ? l.summit : l.category === filter));
  const months = byMonth(shown, timeZone);
  const counts = (f: Filter) => landmarks.filter((l) => (f === "all" ? true : f === "summits" ? l.summit : l.category === f)).length;

  const dayIndex = Math.round((Date.parse(draft) - Date.parse(first)) / DAY);

  return (
    <>
      <section ref={worldRef} aria-labelledby="atlas-world" className="mt-14 scroll-mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 id="atlas-world" className="font-serif text-[26px] leading-tight sm:text-[30px]">
            {isNow ? "Your world today" : `Your world on ${formatLongDate(at, timeZone)}`}
          </h2>
          <p className="num text-[13px] text-ink-3">
            {plural(past.length, "workout")} · {plural(new Set(past.map((s) => s.templateKey)).size, "range")} · {plural(then.length, "landmark")}
          </p>
        </div>

        {/* when: the moments worth revisiting, then any day */}
        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" role="group" aria-label="Moments">
          {stops.map((s) => {
            const on = s.id === "now" ? isNow : Math.abs(Date.parse(at) - Date.parse(s.at)) < DAY / 2;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => go(s.id === "now" ? now : s.at)}
                className={cn(
                  "h-9 shrink-0 rounded-md border px-3 text-[13px] transition-colors",
                  on ? "border-ink bg-ink text-paper" : "border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-4">
          <label htmlFor="atlas-day" className="sr-only">
            Day
          </label>
          <input
            id="atlas-day"
            type="range"
            min={0}
            max={span}
            step={1}
            value={Math.min(span, Math.max(0, dayIndex))}
            onChange={(e) => {
              const n = Number(e.target.value);
              setDraft(n >= span ? now : new Date(Date.parse(first) + n * DAY).toISOString());
            }}
            aria-valuetext={formatLongDate(draft, timeZone)}
            className="h-11 flex-1 accent-[var(--sage-deep)]"
          />
          <span className="num w-24 shrink-0 text-right text-[13px] text-ink-2">{formatShortDate(draft, timeZone)}</span>
        </div>

        <div className="relative mt-3 h-[58dvh] min-h-[340px] overflow-hidden rounded-lg border border-line bg-paper sm:h-[540px]">
          {!client ? null : !webgl ? (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <p className="max-w-xs text-sm text-ink-3">This device can&apos;t draw the 3D landscape. The record below has every landmark.</p>
            </div>
          ) : world ? (
            <Terrain3D
              key={at}
              terrain={world}
              timeZone={timeZone}
              unit={unit}
              tilted
              selectedId={session?.id ?? null}
              selectedRegion={null}
              regions={regions}
              theme={0}
              frontier={frontier}
              landmarks={spots}
              selectedPlace={activeLandmark && activeLandmark.at <= at ? placeOf(activeLandmark) : null}
              focusPlace={activeLandmark && activeLandmark.at <= at ? placeOf(activeLandmark) : null}
              onSelectPlace={onSelectPlace}
              onSelectSession={onSelectSession}
              onSelectRegion={ignore}
              onSelectRest={ignore}
              onClearSelection={onClear}
            />
          ) : (
            <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-ink-3">Before your first workout, the land was quiet.</p>
          )}
          {session ? (
            <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 rounded-md bg-surface/92 px-3.5 py-2.5 text-[13px] shadow-[var(--shadow)] backdrop-blur sm:inset-x-auto sm:left-3 sm:min-w-72">
              <span className="num min-w-0 truncate text-ink-2">
                {formatShortDate(session.endedAt, timeZone)} · {session.label}
              </span>
              <Link href={`/history/${session.id}`} className="shrink-0 font-medium underline underline-offset-4">
                Open workout
              </Link>
            </div>
          ) : null}
        </div>
        <p className="mt-2 text-[12px] text-ink-3">
          Rebuilt from the workouts logged up to this day: the ranges, river and landmarks as they stood then. Drag to move, scroll or pinch to
          zoom.
        </p>
      </section>

      <section aria-labelledby="atlas-record" className="mt-16">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-ink/80 pb-3">
          <h2 id="atlas-record" className="font-serif text-[26px] leading-tight sm:text-[30px]">
            The record
          </h2>
          <p className="text-[13px] text-ink-3">Every landmark, the day it was earned.</p>
        </div>
        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" role="group" aria-label="Kind">
          {(["all", ...CATEGORIES.map((c) => c.id), "summits"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] transition-colors",
                filter === f ? "border-ink bg-ink text-paper" : "border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink",
              )}
            >
              {f === "all" ? "All" : f === "summits" ? "Summits" : CATEGORIES.find((c) => c.id === f)!.label}
              <span className={cn("num text-[11px]", filter === f ? "text-paper/70" : "text-ink-4")}>{counts(f)}</span>
            </button>
          ))}
        </div>

        {months.length === 0 ? (
          <p className="mt-8 text-sm text-ink-3">Nothing of this kind yet.</p>
        ) : (
          <ol className="mt-6">
            {months.map((m) => (
              <li key={m.key} className="mb-8">
                <h3 className="eyebrow num">{m.label}</h3>
                <ol className="relative mt-3 border-l border-line pl-0">
                  {m.items.map((l) => {
                    const open = active === l.id;
                    const later = l.at > at;
                    return (
                      <li key={l.id} id={`entry-${l.id}`} className="relative scroll-mt-24">
                        <span className="absolute -left-[9px] top-[18px] flex size-[17px] items-center justify-center rounded-full bg-paper" aria-hidden>
                          <Glyph landmark={l} className={open ? "text-sage-deep" : "text-ink-3"} />
                        </span>
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setActive(open ? null : l.id)}
                          className={cn(
                            "group flex w-full items-baseline gap-4 rounded-md py-3 pl-6 pr-2 text-left transition-colors hover:bg-surface",
                            later && "opacity-45",
                          )}
                        >
                          <span className="num w-14 shrink-0 text-[12px] text-ink-3">{formatShortDate(l.at, timeZone)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-medium leading-snug">
                              {l.summit ? (
                                <>
                                  <span className="font-serif italic">{l.summit.name}</span>
                                  <span className="text-ink-3"> · {l.title}</span>
                                </>
                              ) : (
                                l.title
                              )}
                              {l.sample ? (
                                <span className="ml-2 rounded-sm bg-sunken px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wider text-ink-3">
                                  Sample
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block truncate text-[13px] text-ink-3">
                              {CATEGORIES.find((c) => c.id === l.category)!.label} · {l.exercise ?? l.routine}
                            </span>
                          </span>
                        </button>
                        {open ? (
                          <div className="pb-5 pl-6 pr-2 sm:pl-[104px]">
                            <p className="text-[14px] text-ink-2">{l.description}</p>
                            <dl className="num mt-3 flex flex-wrap gap-x-8 gap-y-2">
                              {l.stats.map((s) => (
                                <div key={s.label}>
                                  <dt className="text-[11px] text-ink-3">{s.label}</dt>
                                  <dd className="text-[14px] font-medium">{s.value}</dd>
                                </div>
                              ))}
                            </dl>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => seeThen(l)}
                                className="h-9 rounded-md bg-ink px-3.5 text-[13px] font-medium text-paper hover:bg-ink/85"
                              >
                                See your world that day
                              </button>
                              <Link
                                href={`/landscape/explore?range=all&place=${encodeURIComponent(placeOf(l))}`}
                                className="flex h-9 items-center rounded-md border border-line-strong px-3.5 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink"
                              >
                                Show in landscape
                              </Link>
                              <Link
                                href={`/history/${l.sessionId}`}
                                className="flex h-9 items-center rounded-md border border-line-strong px-3.5 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink"
                              >
                                The workout
                              </Link>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

/** The landmark's silhouette, as it stands in the world: stone, cairn, spire, or summit. */
function Glyph({ landmark: l, className }: { landmark: WorldLandmark; className?: string }) {
  const common = { width: 13, height: 13, viewBox: "0 0 13 13", fill: "none", stroke: "currentColor", strokeWidth: 1.3, className } as const;
  if (l.summit)
    return (
      <svg {...common}>
        <path d="M1 11.5 5 4l2 3 1.5-2.5L12 11.5Z" strokeLinejoin="round" />
      </svg>
    );
  if (l.category === "consistency")
    return (
      <svg {...common}>
        <ellipse cx="6.5" cy="10" rx="4" ry="1.7" />
        <ellipse cx="6.5" cy="6.6" rx="2.9" ry="1.4" />
        <ellipse cx="6.5" cy="3.7" rx="1.8" ry="1.1" />
      </svg>
    );
  if (l.category === "strength")
    return (
      <svg {...common}>
        <path d="M6.5 1.2 9 11.8H4Z" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M5 11.8V3.4c0-1.3.7-2 1.5-2s1.5.7 1.5 2v8.4" strokeLinecap="round" />
      <path d="M3 11.8h7" strokeLinecap="round" />
    </svg>
  );
}
