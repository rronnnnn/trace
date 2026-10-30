"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatShortDate, formatWeight, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

export type IndexRow = {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
  weighted: boolean;
  custom: boolean;
  sessions: number;
  lastAt: string | null;
  best: { value: number; reps: number | null } | null;
  trend: { change: number; line: string } | null;
  /** primary value of the most recent sessions, oldest first */
  spark: number[];
  sample: boolean;
};

export function ExerciseIndex({ rows, unit, timeZone }: { rows: IndexRow[]; unit: string; timeZone: string }) {
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<string | null>(null);

  const muscles = useMemo(() => [...new Set(rows.map((r) => r.muscle))].sort(), [rows]);
  const match = (r: IndexRow) =>
    (!muscle || r.muscle === muscle) &&
    (!query.trim() || `${r.name} ${r.muscle} ${r.equipment}`.toLowerCase().includes(query.trim().toLowerCase()));

  const trained = rows.filter((r) => r.sessions > 0 && match(r)).sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  const untrained = rows.filter((r) => r.sessions === 0 && match(r));

  return (
    <>
      <div className="mt-10 flex flex-col gap-3 border-t border-ink/80 pt-6 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor="exercise-search">
          Search exercises
        </label>
        <Input
          id="exercise-search"
          type="search"
          placeholder="Search exercises"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="sm:max-w-xs"
        />
        <div role="group" aria-label="Muscle" className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0">
          {[null, ...muscles].map((m) => (
            <button
              key={m ?? "all"}
              type="button"
              aria-pressed={muscle === m}
              onClick={() => setMuscle(m)}
              className={cn(
                "h-8 shrink-0 rounded-full border px-3 text-[13px] transition-colors",
                muscle === m ? "border-ink bg-ink text-paper" : "border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink",
              )}
            >
              {m ?? "All"}
            </button>
          ))}
        </div>
      </div>

      {trained.length ? (
        <section aria-labelledby="trained" className="mt-10">
          <h2 id="trained" className="eyebrow">
            In your record
          </h2>
          <ul className="mt-3 border-t border-line">
            {trained.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/exercises/${r.id}`}
                  className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 border-b border-line py-4 transition-colors hover:bg-surface sm:grid-cols-[minmax(0,1fr)_120px_9rem_2rem]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[16px] font-medium">
                      {r.name}
                      {r.sample ? <Tag>Sample</Tag> : null}
                    </span>
                    <span className="num block truncate text-[13px] text-ink-3">
                      {r.muscle} · {plural(r.sessions, "session")} · last {r.lastAt ? formatShortDate(r.lastAt, timeZone) : "—"}
                    </span>
                  </span>
                  <Sparkline values={r.spark} className="hidden sm:block" label={`${r.name}, recent sessions`} />
                  <span className="text-right">
                    <span className="num block text-[15px] font-medium">
                      {r.best
                        ? r.weighted
                          ? `${formatWeight(r.best.value)} ${unit}${r.best.reps ? ` × ${r.best.reps}` : ""}`
                          : `${r.best.value} reps`
                        : "—"}
                    </span>
                    <span
                      className={cn("num block text-[12px]", r.trend && r.trend.change > 0 ? "text-sage-deep" : "text-ink-3")}
                      title={r.trend?.line}
                    >
                      {r.trend ? trendShort(r.trend.change, r.weighted, unit) : "Best set"}
                    </span>
                  </span>
                  <span
                    className="hidden text-right text-ink-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink sm:block"
                    aria-hidden
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {untrained.length ? (
        <section aria-labelledby="library" className="mt-14">
          <h2 id="library" className="eyebrow">
            {trained.length ? "Not logged yet" : "Library"}
          </h2>
          <ul className="mt-3 grid border-t border-line sm:grid-cols-2 sm:gap-x-10 lg:grid-cols-3">
            {untrained.map((r) => (
              <li key={r.id}>
                <Link href={`/exercises/${r.id}`} className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 hover:text-ink">
                  <span className="truncate text-[14px] text-ink-2">
                    {r.name}
                    {r.custom ? <Tag>Yours</Tag> : null}
                  </span>
                  <span className="shrink-0 text-[12px] text-ink-3">{r.muscle}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!trained.length && !untrained.length ? (
        <p className="mt-10 text-sm text-ink-3">
          Nothing matches{query ? ` “${query}”` : ""}
          {muscle ? ` in ${muscle}` : ""}.
        </p>
      ) : null}
    </>
  );
}

function trendShort(change: number, weighted: boolean, unit: string) {
  const d = Math.round(change * 10) / 10;
  const v = weighted ? `${formatWeight(Math.abs(d))} ${unit}` : `${Math.abs(d)} reps`;
  if (d > 0) return `+${v} · 4 wk`;
  if (d < 0) return `−${v} · 4 wk`;
  return "Level · 4 wk";
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-2 rounded-sm bg-sunken px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wider text-ink-3">
      {children}
    </span>
  );
}

/** Recent sessions' top values: a trend at a glance, latest point marked. */
function Sparkline({ values, className, label }: { values: number[]; className?: string; label: string }) {
  const w = 120;
  const h = 28;
  if (values.length < 2) return <span className={className} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => [2 + (i / (values.length - 1)) * (w - 6), h - 4 - ((v - min) / (max - min || 1)) * (h - 8)]);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className} role="img" aria-label={label}>
      <polyline
        points={pts.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke="var(--ink-3)"
        strokeOpacity={0.55}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lx} cy={ly} r={3} fill="var(--sage)" stroke="var(--paper)" strokeWidth={1.5} />
    </svg>
  );
}
