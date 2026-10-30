import type { Metadata } from "next";
import Link from "next/link";
import { RouteTrace } from "@/components/run/route-trace";
import { Sparkline } from "@/components/sparkline";
import { buttonClass } from "@/components/ui/button";
import { formatShortDate, plural } from "@/lib/format";
import { bestEfforts, monthlyDistance, runTotals, weeklyDistance } from "@/lib/run/analysis";
import { formatClockTime, formatKm, formatPace, formatRunTime, paceOf } from "@/lib/run/recorder";
import { weekLabel } from "@/lib/reflection";
import { requireUser } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { loadRuns, runTitle } from "./data";
import { LogRun } from "./log-run";
import { PendingRuns } from "./pending-runs";

export const metadata: Metadata = { title: "Runs" };

export default async function RunsPage() {
  const [{ supabase, userId }, tz] = await Promise.all([requireUser(), getTimeZone()]);
  const runs = (await loadRuns(supabase)) ?? [];
  const now = new Date();
  const totals = runTotals(runs);
  const weeks = weeklyDistance(runs, 12, now, tz);
  const months = monthlyDistance(runs, tz).slice(0, 6);
  const efforts = bestEfforts(runs);
  // pace trend from GPS outdoor runs only: treadmill and hand-logged paces aren't measured the same way
  const measured = runs.filter((r) => r.kind === "outdoor" && r.source === "gps" && r.meters >= 1000).reverse();
  const paces = measured.map((r) => paceOf(r.movingSeconds, r.meters)!).slice(-20);
  const maxWeek = Math.max(1, ...weeks.map((w) => w.meters));
  const monthLabel = (k: string) => new Date(`${k}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const byMonth = new Map<string, typeof runs>();
  for (const r of runs) {
    const k = new Date(r.startedAt).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: tz });
    byMonth.set(k, [...(byMonth.get(k) ?? []), r]);
  }

  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-8 sm:px-8 md:pt-14 lg:px-14">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Running</p>
          <h1 className="mt-3 font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[52px]">Every run, kept.</h1>
          <p className="mt-3 max-w-xl text-[15px] text-ink-2">Distance, time and routes, private to you. Runs sit beside your strength training; they don&apos;t raise the landscape.</p>
        </div>
        <div className="flex gap-2">
          <LogRun />
          <Link href="/run" className={buttonClass({ size: "md" })}>
            Start a run
          </Link>
        </div>
      </header>
      <PendingRuns uid={userId} />

      {runs.length === 0 ? (
        <section className="mt-12 max-w-md border-t border-ink/80 pt-8">
          <p className="font-serif text-[24px] leading-tight">No runs yet.</p>
          <p className="mt-2 text-sm text-ink-2">
            Start one from your phone outdoors and TRACE records the route, or log a treadmill run by hand. Either way, it&apos;s yours alone.
          </p>
        </section>
      ) : (
        <>
          <dl className="num mt-10 grid grid-cols-2 gap-x-8 gap-y-6 border-y border-ink/80 py-6 sm:grid-cols-4">
            {[
              { label: "Distance", value: `${formatKm(totals.meters)} km` },
              { label: "Time running", value: formatRunTime(totals.seconds * 1000) },
              { label: "Runs", value: String(totals.runs) },
              { label: "Longest", value: totals.longest ? `${formatKm(totals.longest.meters)} km` : "—", href: totals.longest ? `/runs/${totals.longest.id}` : null },
            ].map((s) => (
              <div key={s.label}>
                <dd className="text-[24px] font-medium leading-none tracking-[-0.01em] sm:text-[28px]">
                  {s.href ? (
                    <Link href={s.href} className="hover:underline hover:underline-offset-4">
                      {s.value}
                    </Link>
                  ) : (
                    s.value
                  )}
                </dd>
                <dt className="mt-2 text-[12px] text-ink-3">{s.label}</dt>
              </div>
            ))}
          </dl>

          <section aria-labelledby="weekly" className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-10 md:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
            <figure>
              <h2 id="weekly" className="text-[13px] font-medium">
                Distance per week
              </h2>
              <div className="mt-3 flex h-32 items-end gap-[3px]" role="list" aria-label="Distance per week, last 12 weeks">
                {weeks.map((w, i) => (
                  <div
                    key={w.week}
                    role="listitem"
                    aria-label={`${weekLabel(w.week)}: ${formatKm(w.meters)} km, ${plural(w.runs, "run")}`}
                    title={`${weekLabel(w.week)} · ${formatKm(w.meters)} km · ${plural(w.runs, "run")}`}
                    className="flex h-full flex-1 items-end justify-center"
                  >
                    <span
                      className={cn("block w-full max-w-7 rounded-t-[4px]", i === weeks.length - 1 ? "bg-sage-deep" : "bg-sage", w.meters === 0 && "h-px! rounded-none bg-line")}
                      style={{ height: `${Math.max(2, (w.meters / maxWeek) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
              <figcaption className="num mt-2 flex justify-between text-[11px] text-ink-3">
                <span>{weekLabel(weeks[0].week).split(" – ")[0]}</span>
                <span>This week · {formatKm(weeks.at(-1)!.meters)} km</span>
              </figcaption>
            </figure>
            <div>
              <h2 className="text-[13px] font-medium">By month</h2>
              <ul className="num mt-2">
                {months.map((m) => (
                  <li key={m.month} className="flex justify-between border-b border-line py-2 text-[13px] last:border-0">
                    <span className="text-ink-2">{monthLabel(m.month)}</span>
                    <span>
                      {formatKm(m.meters)} km <span className="text-ink-3">· {plural(m.runs, "run")}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section aria-labelledby="efforts" className="mt-14 grid grid-cols-[minmax(0,1fr)] gap-10 md:grid-cols-2">
            <div>
              <h2 id="efforts" className="text-[13px] font-medium">
                Best efforts
              </h2>
              {efforts.length ? (
                <ul className="num mt-2">
                  {efforts.map((e) => (
                    <li key={e.id} className="flex items-baseline gap-3 border-b border-line py-2.5 text-[14px] last:border-0">
                      <span className="flex-1">{e.label}</span>
                      <span className="font-medium">{formatClockTime(e.seconds * 1000)}</span>
                      <Link href={`/runs/${e.runId}`} className="-my-2 w-16 py-2 text-right text-[12px] text-ink-3 hover:text-ink">
                        {formatShortDate(e.at, tz)}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] text-ink-3">Best efforts come from GPS-recorded outdoor runs. Record one to start the list.</p>
              )}
              <p className="mt-2 text-[12px] text-ink-3">GPS outdoor runs only: treadmill and hand-logged distances aren&apos;t measured the same way.</p>
            </div>
            <div>
              <h2 className="text-[13px] font-medium">Average pace, recent GPS runs</h2>
              {paces.length >= 3 ? (
                <div className="mt-3 flex items-center gap-4">
                  {/* lower is faster: plot the negative so a faster pace reads as a rise */}
                  <Sparkline values={paces.map((p) => -p)} label={`Average pace over the last ${paces.length} GPS runs`} className="h-auto w-48" />
                  <p className="num text-[13px] text-ink-2">
                    Latest {formatPace(paces.at(-1)!)} /km
                    <span className="block text-ink-3">
                      First of these {formatPace(paces[0])} /km · higher on the line is faster
                    </span>
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-[13px] text-ink-3">A trend shows after three GPS runs of at least a kilometre.</p>
              )}
            </div>
          </section>

          {[...byMonth.entries()].map(([month, list]) => (
            <section key={month} className="mt-12" aria-label={month}>
              <h2 className="eyebrow">{month}</h2>
              <ul className="mt-3 border-t border-ink/80">
                {list.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/runs/${r.id}`}
                      className="group grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-line py-4 transition-colors hover:bg-surface sm:grid-cols-[5.5rem_minmax(0,1fr)_5rem_8rem]"
                    >
                      <span className="num text-[13px] text-ink-3">{formatShortDate(r.startedAt, tz)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-medium">{runTitle(r, tz)}</span>
                        <span className="num block text-[13px] text-ink-3">
                          {formatPace(paceOf(r.movingSeconds, r.meters))} /km · {formatRunTime(r.movingSeconds * 1000)}
                          {r.kind === "treadmill" ? " · treadmill" : r.source === "manual" ? " · logged" : ""}
                          {r.isSample ? " · sample" : ""}
                        </span>
                      </span>
                      <span className="hidden sm:block">{r.points && r.points.length > 1 ? <RouteTrace points={r.points} width={72} height={40} /> : null}</span>
                      <span className="num text-right text-[15px] font-medium">{formatKm(r.meters)} km</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
