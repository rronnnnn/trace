"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { IconArrowLeft, IconArrowRight } from "@/components/icons";
import { buttonClass } from "@/components/ui/button";
import { contourLines, evenLevels } from "@/lib/landscape/contours";
import {
  achievedRecords,
  exerciseOptions,
  exerciseStats,
  exerciseVolume,
  filterSessions,
  RANGES,
  summarize,
  templateOptions,
  toLandscapeSessions,
  weeklyTotals,
  weekOfSession,
  type ExploreSession,
  type Filters,
  type RangeId,
  type Window,
} from "@/lib/landscape/explore";
import { buildTerrain, dateToX } from "@/lib/landscape/terrain";
import { formatDuration, formatLongDate, formatNumber, formatShortDate, formatVolume, formatWeight, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ContourLayer, MapTooltip, MarkerGlyph, markerLabel } from "./landscape-parts";

export type Selection = Filters & { week: string | null; session: string | null };

const W = 1000;
const H = 600;

export function LandscapeExplorer({
  sessions,
  range,
  window: win,
  timeZone,
  seed,
  unit,
  muscles,
  totalSessionsEver,
  initial,
  onRangeChange,
  onSelectionChange,
}: {
  sessions: ExploreSession[];
  range: RangeId;
  window: Window;
  timeZone: string;
  seed: string;
  unit: string;
  muscles: Record<string, string>;
  totalSessionsEver: number;
  initial: Selection;
  onRangeChange: (r: RangeId) => void;
  onSelectionChange?: (s: Selection) => void;
}) {
  const [sel, setSel] = useState<Selection>(initial);
  const [hover, setHover] = useState<string | null>(null);
  const titleId = useId();
  const filters: Filters = useMemo(() => ({ templateId: sel.templateId, exerciseId: sel.exerciseId }), [sel.templateId, sel.exerciseId]);

  const update = useCallback(
    (patch: Partial<Selection>) =>
      setSel((prev) => {
        const next = { ...prev, ...patch };
        onSelectionChange?.(next);
        return next;
      }),
    [onSelectionChange],
  );

  const workouts = useMemo(() => templateOptions(sessions), [sessions]);
  const exercises = useMemo(() => exerciseOptions(sessions, muscles), [sessions, muscles]);
  const visible = useMemo(() => filterSessions(sessions, filters), [sessions, filters]);

  const start = useMemo(() => new Date(win.start), [win.start]);
  const end = useMemo(() => new Date(win.end), [win.end]);

  const { terrain, lines } = useMemo(() => {
    const terrain = buildTerrain({
      sessions: toLandscapeSessions(sessions, filters),
      seed,
      start,
      end,
      cols: 130,
      rows: 78,
      aspect: W / H,
    });
    return { terrain, lines: contourLines(terrain.field, terrain.cols, terrain.rows, W, H, evenLevels(17)) };
  }, [sessions, filters, seed, start, end]);

  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  // A selected session hidden by the current filters is not shown out of context.
  const selectedSession = sel.session && visible.some((s) => s.id === sel.session) ? byId.get(sel.session) : undefined;
  const selectedWeek = win.weeks.find((w) => w.key === sel.week);
  const totals = useMemo(() => weeklyTotals(sessions, win.weeks, timeZone, filters), [sessions, win.weeks, timeZone, filters]);
  const maxWeekVolume = Math.max(1, ...[...totals.values()].map((t) => t.volume));

  const inWeek = (id: string) => {
    if (!selectedWeek) return true;
    const s = byId.get(id);
    return Boolean(s && weekOfSession(s, win.weeks, timeZone)?.key === selectedWeek.key);
  };

  const selectSession = (id: string) => {
    const s = byId.get(id);
    update({ session: id, week: s ? (weekOfSession(s, win.weeks, timeZone)?.key ?? null) : null });
  };

  const months = useMemo(() => monthTicks(start, end), [start, end]);
  const hoverMark = terrain.landmarks.find((l) => l.session.id === hover);
  const empty = totalSessionsEver === 0;
  const emptyHere = !empty && visible.length === 0;
  const sparse = !empty && visible.length > 0 && visible.length < 4;
  const filtered = Boolean(sel.templateId || sel.exerciseId);

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape" && (sel.session || sel.week)) update({ session: null, week: null });
      }}
    >
      {/* Filters */}
      <div
        className="mt-8 flex flex-wrap items-end gap-x-3 gap-y-3 border-t border-ink/80 pt-5"
        role="group"
        aria-label="Landscape filters"
      >
        <FilterSelect label="Period" value={range} onChange={(v) => onRangeChange(v as RangeId)}>
          {RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Workout"
          value={sel.templateId ?? ""}
          onChange={(v) => update({ templateId: v || null })}
          disabled={!workouts.length}
        >
          <option value="">All workouts</option>
          {workouts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label} ({o.count})
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Exercise"
          value={sel.exerciseId ?? ""}
          onChange={(v) => update({ exerciseId: v || null })}
          disabled={!exercises.length}
        >
          <option value="">All exercises</option>
          {groupBy(exercises, (o) => o.group ?? "Other").map(([group, items]) => (
            <optgroup key={group} label={group}>
              {items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </FilterSelect>
        {filtered || sel.week || sel.session ? (
          <button
            type="button"
            onClick={() => update({ templateId: null, exerciseId: null, week: null, session: null })}
            className="h-10 px-1 text-[13px] text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-ink"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10">
        {/* Map + week navigator */}
        <div className="min-w-0">
          <div className="relative overflow-hidden rounded-md border border-line bg-surface/60" style={{ aspectRatio: `${W} / ${H}` }}>
            <svg viewBox={`0 0 ${W} ${H}`} className="block h-full w-full" role="group" aria-labelledby={titleId}>
              <title id={titleId}>{`Training landscape: ${plural(visible.length, "session")} shown`}</title>
              {selectedWeek ? <WeekBand week={selectedWeek} start={start} end={end} /> : null}
              <ContourLayer lines={lines} fade={empty || emptyHere ? 0.55 : 1} />
              <g aria-hidden>
                {months.map((m) => (
                  <g key={m.key}>
                    <line
                      x1={m.x * W}
                      x2={m.x * W}
                      y1={H - 18}
                      y2={H - 12}
                      stroke="var(--ink-3)"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                    <text x={m.x * W + 4} y={H - 10} fontSize={12} fill="var(--ink-3)">
                      {m.label}
                    </text>
                  </g>
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
                    data-session={id}
                    className="cursor-pointer outline-none"
                    onClick={() => selectSession(id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectSession(id);
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
                      r={4.2}
                      record={l.session.prCount > 0}
                      active={hover === id}
                      selected={selectedSession?.id === id}
                      dimmed={!inWeek(id)}
                    />
                  </g>
                );
              })}
              {hoverMark && hoverMark.session.id !== selectedSession?.id ? (
                <MapTooltip mark={hoverMark} width={W} height={H} unit={unit} />
              ) : null}
            </svg>

            {empty ? (
              <MapNotice
                title="Your landscape begins with your first session."
                body="Each workout you finish raises the terrain. Records become landmarks you can come back to."
                action={
                  <Link href="/" className={buttonClass({ size: "md" })}>
                    Go to Today
                  </Link>
                }
              />
            ) : emptyHere ? (
              <MapNotice
                title={filtered ? "Nothing matches these filters." : "No sessions in this period."}
                body={
                  filtered ? "Try another workout or exercise, or clear the filters." : "Choose a longer period to see earlier training."
                }
                action={
                  filtered ? (
                    <button
                      type="button"
                      className={buttonClass({ variant: "secondary" })}
                      onClick={() => update({ templateId: null, exerciseId: null })}
                    >
                      Clear filters
                    </button>
                  ) : range !== "all" ? (
                    <button type="button" className={buttonClass({ variant: "secondary" })} onClick={() => onRangeChange("all")}>
                      Show all time
                    </button>
                  ) : null
                }
              />
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12px] text-ink-3">
            <span>
              {sparse
                ? "Early terrain. Each session you record adds relief."
                : sel.exerciseId
                  ? "Hill height follows this exercise's volume in each session."
                  : "Hill height follows each session's volume relative to your own training."}
            </span>
            <span className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-sage-deep ring-2 ring-sage-soft" aria-hidden /> Record
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full border border-ink-2 bg-surface" aria-hidden /> Session
              </span>
            </span>
          </div>

          <WeekStrip
            weeks={win.weeks}
            totals={totals}
            maxVolume={maxWeekVolume}
            selected={sel.week}
            unit={unit}
            onSelect={(week) => update({ week, session: null })}
          />
        </div>

        {/* Detail */}
        <aside
          aria-live="polite"
          aria-label="Details"
          className="min-w-0 border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0"
        >
          {selectedSession ? (
            <SessionDetail
              session={selectedSession}
              exerciseId={sel.exerciseId}
              unit={unit}
              timeZone={timeZone}
              onClose={() => update({ session: null })}
            />
          ) : selectedWeek ? (
            <WeekDetail
              week={selectedWeek}
              sessions={visible.filter((s) => weekOfSession(s, win.weeks, timeZone)?.key === selectedWeek.key)}
              previous={totals.get(win.weeks[selectedWeek.index - 1]?.key ?? "")}
              current={totals.get(selectedWeek.key)!}
              unit={unit}
              timeZone={timeZone}
              exerciseId={sel.exerciseId}
              onSelect={selectSession}
              onClose={() => update({ week: null })}
            />
          ) : (
            <Overview
              sessions={sessions}
              filters={filters}
              exerciseName={exercises.find((e) => e.id === sel.exerciseId)?.label}
              unit={unit}
              timeZone={timeZone}
              rangeLabel={RANGES.find((r) => r.id === range)!.label}
              onSelect={selectSession}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

// ── map pieces ───────────────────────────────────────────────────────────────

function WeekBand({ week, start, end }: { week: { start: string; end: string }; start: Date; end: Date }) {
  const x1 = dateToX(`${week.start}T00:00:00Z`, start, end) * W;
  const x2 = dateToX(`${week.end}T23:59:59Z`, start, end) * W;
  return (
    <g aria-hidden>
      <rect x={x1} y={0} width={Math.max(4, x2 - x1)} height={H} fill="var(--sage)" fillOpacity={0.07} />
      <line
        x1={x1}
        x2={x1}
        y1={0}
        y2={H}
        stroke="var(--sage)"
        strokeOpacity={0.45}
        strokeDasharray="3 4"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={x2}
        x2={x2}
        y1={0}
        y2={H}
        stroke="var(--sage)"
        strokeOpacity={0.45}
        strokeDasharray="3 4"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function MapNotice({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="max-w-sm bg-surface/90 px-6 py-5 text-center backdrop-blur-[2px]">
        <p className="font-serif text-[22px] leading-tight">{title}</p>
        <p className="mt-2 text-sm text-ink-2">{body}</p>
        {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}

function monthTicks(start: Date, end: Date) {
  const ticks: { key: string; x: number; label: string }[] = [];
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const spanMonths = (end.getTime() - start.getTime()) / (30 * 86400000);
  const step = spanMonths > 14 ? 3 : 1;
  while (d <= end) {
    if (d.getUTCMonth() % step === 0)
      ticks.push({
        key: d.toISOString(),
        x: dateToX(d, start, end),
        label: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC", ...(d.getUTCMonth() === 0 ? { year: "numeric" } : {}) }),
      });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return ticks;
}

function WeekStrip({
  weeks,
  totals,
  maxVolume,
  selected,
  unit,
  onSelect,
}: {
  weeks: Window["weeks"];
  totals: Map<string, { sessions: number; volume: number; records: number }>;
  maxVolume: number;
  selected: string | null;
  unit: string;
  onSelect: (week: string | null) => void;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const index = weeks.findIndex((w) => w.key === selected);
  const go = (i: number) => {
    const w = weeks[Math.max(0, Math.min(weeks.length - 1, i))];
    onSelect(w.key);
    refs.current.get(w.key)?.focus();
  };
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // keep the most recent weeks in view on narrow screens
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [weeks.length]);

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Weeks</p>
        <div className="flex items-center gap-1">
          <StepButton label="Previous week" disabled={index === 0} onClick={() => go(index === -1 ? weeks.length - 1 : index - 1)}>
            <IconArrowLeft />
          </StepButton>
          <StepButton label="Next week" disabled={index === -1 || index === weeks.length - 1} onClick={() => go(index + 1)}>
            <IconArrowRight />
          </StepButton>
        </div>
      </div>
      <div ref={scroller} className="-mx-1 mt-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div role="toolbar" aria-label="Select a week" className="flex min-w-full gap-1" style={{ minWidth: weeks.length * 28 }}>
          {weeks.map((w, i) => {
            const t = totals.get(w.key)!;
            const on = w.key === selected;
            const h = t.volume ? 6 + 30 * (t.volume / maxVolume) : 0;
            return (
              <button
                key={w.key}
                ref={(el) => {
                  if (el) refs.current.set(w.key, el);
                  else refs.current.delete(w.key);
                }}
                type="button"
                aria-pressed={on}
                aria-label={`Week of ${w.label}: ${plural(t.sessions, "session")}${t.volume ? `, ${formatVolume(t.volume, unit)}` : ""}${
                  t.records ? `, ${plural(t.records, "record")}` : ""
                }`}
                tabIndex={on || (index === -1 && i === weeks.length - 1) ? 0 : -1}
                onClick={() => onSelect(on ? null : w.key)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") {
                    e.preventDefault();
                    go(i + 1);
                  }
                  if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    go(i - 1);
                  }
                }}
                className={cn(
                  "group flex min-w-6 flex-1 flex-col items-center gap-1.5 rounded-md px-0.5 pb-1.5 pt-2 transition-colors",
                  on ? "bg-ink text-paper" : "hover:bg-sunken",
                )}
              >
                <span className="flex h-9 items-end">
                  {t.volume ? (
                    <span
                      className={cn("block w-1.5 rounded-[2px]", on ? "bg-paper" : t.records ? "bg-sage-deep" : "bg-ink-3")}
                      style={{ height: h }}
                    />
                  ) : (
                    <span className={cn("block h-px w-2", on ? "bg-paper/60" : "bg-line-strong")} />
                  )}
                </span>
                <span className={cn("num text-[10px] leading-none", on ? "text-paper" : "text-ink-3")}>
                  {weeks.length <= 16 || i % 4 === 0 || on ? Number(w.key.slice(8)) : ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StepButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:text-ink-4"
    >
      {children}
    </button>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0 flex-1 sm:flex-none">
      <label htmlFor={id} className="mb-1 block text-[11px] uppercase tracking-[0.06em] text-ink-3">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full appearance-none rounded-md border border-line-strong bg-surface pl-3 pr-9 text-[14px] text-ink transition-colors hover:border-ink-3 focus:border-ink focus:outline-none disabled:text-ink-4 sm:w-auto sm:min-w-44"
        >
          {children}
        </select>
        <svg
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden
        >
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </div>
    </div>
  );
}

// ── detail panels ────────────────────────────────────────────────────────────

function PanelHeader({
  eyebrow,
  title,
  onClose,
  closeLabel,
}: {
  eyebrow: string;
  title: React.ReactNode;
  onClose?: () => void;
  closeLabel?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="eyebrow num">{eyebrow}</p>
        <h2 className="mt-2 font-serif text-[26px] leading-[1.1] tracking-[-0.01em]">{title}</h2>
      </div>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel ?? "Close"}
          className="-mr-2 flex size-9 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

function Stats({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="num mt-5 grid grid-cols-3 gap-4 border-y border-line py-4">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-[11px] text-ink-3">{i.label}</dt>
          <dd className="mt-1 truncate text-[17px] font-medium tracking-[-0.01em]">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SampleTag() {
  return (
    <span className="ml-2 rounded-sm bg-sunken px-1.5 py-0.5 align-middle font-sans text-[10px] font-medium uppercase tracking-wider text-ink-3">
      Sample
    </span>
  );
}

function SessionDetail({
  session: s,
  exerciseId,
  unit,
  timeZone,
  onClose,
}: {
  session: ExploreSession;
  exerciseId: string | null;
  unit: string;
  timeZone: string;
  onClose: () => void;
}) {
  const recordsBySet = new Map<string, ExploreSession["records"]>();
  for (const r of s.records) if (!r.isBaseline) recordsBySet.set(r.setId, [...(recordsBySet.get(r.setId) ?? []), r]);
  const exercises = [...s.exercises]
    .filter((e) => e.sets.some((x) => x.completed))
    .sort((a, b) => (a.exerciseId === exerciseId ? -1 : b.exerciseId === exerciseId ? 1 : a.position - b.position));
  const records = achievedRecords(s);

  return (
    <section aria-label={`Session: ${s.templateName}`}>
      <PanelHeader
        eyebrow={formatLongDate(s.endedAt, timeZone)}
        title={
          <>
            {s.templateName}
            {s.isSample ? <SampleTag /> : null}
          </>
        }
        onClose={onClose}
        closeLabel="Close session"
      />
      <Stats
        items={[
          { label: "Duration", value: formatDuration(Date.parse(s.endedAt) - Date.parse(s.startedAt)) },
          { label: "Sets", value: String(s.completedSets) },
          { label: "Volume", value: formatVolume(s.totalVolume, unit) },
        ]}
      />
      {records.length ? (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-sage-deep">
          <span className="size-1.5 rounded-full bg-sage" aria-hidden />
          {plural(records.length, "record")} set in this session
        </p>
      ) : null}

      <div className="mt-5 space-y-5">
        {exercises.map((e) => {
          const done = e.sets.filter((x) => x.completed).sort((a, b) => a.position - b.position);
          const focus = e.exerciseId === exerciseId;
          return (
            <div key={e.id} className={cn(focus && "-mx-3 rounded-md bg-sage-wash/70 px-3 py-3")}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[14px] font-medium">{e.name}</h3>
                {exerciseId && !focus ? null : (
                  <span className="num text-[12px] text-ink-3">{formatVolume(exerciseVolume(s, e.exerciseId), unit)}</span>
                )}
              </div>
              <ol className="num mt-1.5 text-[13px]">
                {done.map((x, i) => {
                  const rs = recordsBySet.get(x.id) ?? [];
                  const measured = rs.filter((r) => r.kind !== "estimated_1rm");
                  const estimate = rs.find((r) => r.kind === "estimated_1rm");
                  return (
                    <li key={x.id} className="flex items-baseline justify-between gap-3 border-t border-line py-1.5 first:border-t-0">
                      <span>
                        <span className="mr-3 inline-block w-3 text-ink-3">{i + 1}</span>
                        {x.weight != null ? `${formatWeight(x.weight)} ${unit} × ${x.reps}` : `${x.reps} reps`}
                      </span>
                      <span className="text-[11px]">
                        {measured.length ? (
                          <span className="text-sage-deep">
                            {measured.map((r) => (r.kind === "most_reps" ? "Most reps" : "Heaviest")).join(" · ")}
                          </span>
                        ) : null}
                        {estimate ? (
                          <span className="ml-2 text-ink-3" title="Estimated with the Epley formula; not a measured lift">
                            est. 1RM {formatWeight(estimate.value)}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>

      <Link href={`/history/${s.id}`} className="mt-6 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        Open full session <IconArrowRight />
      </Link>
    </section>
  );
}

function WeekDetail({
  week,
  sessions,
  current,
  previous,
  unit,
  timeZone,
  exerciseId,
  onSelect,
  onClose,
}: {
  week: Window["weeks"][number];
  sessions: ExploreSession[];
  current: { sessions: number; volume: number; records: number };
  previous?: { sessions: number; volume: number; records: number };
  unit: string;
  timeZone: string;
  exerciseId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const delta = previous && previous.volume > 0 ? Math.round(((current.volume - previous.volume) / previous.volume) * 100) : null;
  return (
    <section aria-label={`Week of ${week.label}`}>
      <PanelHeader
        eyebrow="Week"
        title={`${week.label} – ${formatShortDate(`${week.end}T12:00:00Z`, "UTC")}`}
        onClose={onClose}
        closeLabel="Close week"
      />
      <Stats
        items={[
          { label: "Sessions", value: String(current.sessions) },
          { label: exerciseId ? "Exercise volume" : "Volume", value: formatVolume(current.volume, unit) },
          { label: "Records", value: String(current.records) },
        ]}
      />
      {previous ? (
        <p className="num mt-3 text-[13px] text-ink-3">
          {previous.sessions === 0 && current.sessions === 0
            ? "No training this week or the week before."
            : `Previous week: ${plural(previous.sessions, "session")}, ${formatVolume(previous.volume, unit)}${
                delta != null && current.sessions ? ` (${delta > 0 ? "+" : ""}${delta}% volume)` : ""
              }.`}
        </p>
      ) : null}
      {sessions.length ? (
        <ul className="mt-5 border-t border-line">
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className="group flex w-full items-center justify-between gap-3 border-b border-line py-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">
                    {s.templateName}
                  </span>
                  <span className="num block text-[12px] text-ink-3">
                    {new Date(s.endedAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone })} ·{" "}
                    {formatVolume(exerciseId ? exerciseVolume(s, exerciseId) : s.totalVolume, unit)}
                    {achievedRecords(s, exerciseId).length ? (
                      <span className="text-sage-deep"> · {plural(achievedRecords(s, exerciseId).length, "record")}</span>
                    ) : null}
                  </span>
                </span>
                <IconArrowRight className="shrink-0 text-ink-4 group-hover:text-ink" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-ink-3">No sessions this week. Rest weeks are part of training; nothing here is lost.</p>
      )}
    </section>
  );
}

function Overview({
  sessions,
  filters,
  exerciseName,
  unit,
  timeZone,
  rangeLabel,
  onSelect,
}: {
  sessions: ExploreSession[];
  filters: Filters;
  exerciseName?: string;
  unit: string;
  timeZone: string;
  rangeLabel: string;
  onSelect: (id: string) => void;
}) {
  const summary = summarize(sessions, filters);
  const stats = filters.exerciseId ? exerciseStats(filterSessions(sessions, filters), filters.exerciseId) : null;
  return (
    <section aria-label="Overview">
      <PanelHeader eyebrow={rangeLabel} title={exerciseName ?? "Overview"} />
      <Stats
        items={[
          { label: "Sessions", value: String(summary.sessions) },
          {
            label: "Volume",
            value:
              summary.volume >= 100000 ? `${formatNumber(Math.round(summary.volume / 1000))}k ${unit}` : formatVolume(summary.volume, unit),
          },
          { label: "Records", value: String(summary.records.length) },
        ]}
      />

      {stats ? (
        <dl className="mt-5 space-y-3 text-[13px]">
          {stats.heaviest ? (
            <Row
              label="Heaviest set"
              value={`${formatWeight(stats.heaviest.weight)} ${unit} × ${stats.heaviest.reps}`}
              note={formatShortDate(stats.heaviest.session.endedAt, timeZone)}
            />
          ) : stats.mostReps ? (
            <Row label="Most reps" value={`${stats.mostReps.reps} reps`} note={formatShortDate(stats.mostReps.session.endedAt, timeZone)} />
          ) : null}
          {stats.latest ? (
            <Row
              label="Latest"
              value={stats.latest.sets.map((x) => (x.weight != null ? `${formatWeight(x.weight)}×${x.reps}` : `${x.reps}`)).join(", ")}
              note={formatShortDate(stats.latest.session.endedAt, timeZone)}
            />
          ) : null}
          {stats.bestEstimate ? (
            <Row
              label="Estimated 1RM"
              value={`${formatWeight(stats.bestEstimate.value)} ${unit}`}
              note="Epley estimate, not a measured lift"
              muted
            />
          ) : null}
        </dl>
      ) : null}

      <h3 className="eyebrow mt-7">Records in this period</h3>
      {summary.records.length ? (
        <ul className="mt-2 border-t border-line">
          {summary.records.slice(0, 8).map(({ session, record, exerciseName: name }) => (
            <li key={`${session.id}-${record.setId}-${record.kind}`}>
              <button
                type="button"
                onClick={() => onSelect(session.id)}
                className="group flex w-full items-baseline justify-between gap-3 border-b border-line py-2.5 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-ink group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">
                    {name}
                  </span>
                  <span className="num block text-[11px] text-ink-3">{formatShortDate(session.endedAt, timeZone)}</span>
                </span>
                <span className="num shrink-0 text-[13px] font-medium">
                  {record.kind === "most_reps" ? `${record.reps} reps` : `${formatWeight(record.weight)} ${unit} × ${record.reps}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-3">
          {summary.sessions
            ? "No new records in this period. Holding steady counts too."
            : "Records appear here as you beat your own numbers."}
        </p>
      )}
      {summary.sessions ? <p className="mt-6 text-[12px] text-ink-3">Select a session on the map or a week below to inspect it.</p> : null}
    </section>
  );
}

function Row({ label, value, note, muted }: { label: string; value: string; note?: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="num min-w-0 text-right">
        <span className={cn("font-medium", muted && "font-normal text-ink-2")}>{value}</span>
        {note ? <span className="block text-[11px] text-ink-3">{note}</span> : null}
      </dd>
    </div>
  );
}

function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const i of items) map.set(key(i), [...(map.get(key(i)) ?? []), i]);
  return [...map.entries()];
}
