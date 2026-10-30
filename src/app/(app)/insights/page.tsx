import type { Metadata } from "next";
import Link from "next/link";
import { Sparkline } from "@/components/sparkline";
import { dayKey } from "@/lib/dates";
import { formatNumber, formatShortDate, formatVolume, formatWeight, plural } from "@/lib/format";
import {
  balance,
  bestPerformances,
  frequency,
  measuredRecords,
  muscleVolume,
  pairObservation,
  parseWindow,
  periodFor,
  progression,
  recordCounts,
  relative,
  steadiness,
  WINDOWS,
  weeklyTotals,
  type Progress,
  type WeekTotals,
} from "@/lib/insights";
import { weekLabel } from "@/lib/reflection";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { runningPeriod } from "@/lib/run/analysis";
import { formatKm, formatPace, formatRunTime } from "@/lib/run/recorder";
import { loadRuns } from "../runs/data";
import { loadInsightSessions } from "./data";

export const metadata: Metadata = { title: "Insights" };

/** "+12%" / "−8%" / "no change": a plain comparison, never coloured as good or bad. */
function delta(now: number, before: number) {
  const r = relative(now, before);
  if (r == null) return null;
  const pct = Math.round(r * 100);
  return pct === 0 ? "about the same" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();

export default async function InsightsPage({ searchParams }: PageProps<"/insights">) {
  const [{ supabase, profile }, tz, sp] = await Promise.all([requireProfile(), getTimeZone(), searchParams]);
  const unit = profile.unit;
  const [sessions, runs] = await Promise.all([loadInsightSessions(supabase), loadRuns(supabase, { routes: false })]);
  const now = new Date();
  const windowId = parseWindow(sp.window);
  const weeksN = WINDOWS.find((w) => w.id === windowId)!.weeks;
  const p = periodFor(weeksN, now, tz);

  const weeks = weeklyTotals(sessions, p, tz);
  const freq = frequency(weeks, p);
  const progress = progression(sessions, p, tz);
  const steady = steadiness(sessions, now);
  const holding = steady.filter((s) => s.status === "holding");
  const building = steady.filter((s) => s.status === "insufficient");
  const muscles = muscleVolume(weeks, p);
  const bal = balance(weeks, p);
  const records = measuredRecords(sessions);
  const counts = recordCounts(records, p, now, tz);
  const bests = bestPerformances(sessions).slice(0, 8);
  const recentRecords = records.filter((r) => dayKey(r.endedAt, tz) >= p.start).slice(0, 8);
  const inWindow = sessions.filter((s) => dayKey(s.endedAt, tz) >= p.previousStart);
  const sample = inWindow.some((s) => s.isSample);

  const running = runs?.length ? runningPeriod(runs, p, tz) : null;
  const hasHistory = sessions.length > 0 || Boolean(runs?.length);
  const recentSessions = weeks.filter((w) => w.week >= p.start).reduce((n, w) => n + w.sessions, 0);

  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-8 sm:px-8 md:pt-14 lg:px-14">
      <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
        <div>
          <p className="eyebrow">Insights</p>
          <h1 className="mt-3 font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[52px]">What your training shows.</h1>
          <p className="mt-3 max-w-xl text-[15px] text-ink-2">
            Observations from the workouts you logged: the last {weeksN} weeks, set against the {weeksN} before. Nothing here is advice.
          </p>
        </div>
        <nav aria-label="Period" className="flex rounded-md border border-line-strong p-0.5 text-[13px]">
          {WINDOWS.map((w) => (
            <Link
              key={w.id}
              href={w.id === "8w" ? "/insights" : `/insights?window=${w.id}`}
              aria-current={w.id === windowId ? "page" : undefined}
              scroll={false}
              className={cn(
                "flex h-9 items-center rounded-[5px] px-3 transition-colors",
                w.id === windowId ? "bg-ink text-paper" : "text-ink-2 hover:text-ink",
              )}
            >
              {w.label}
            </Link>
          ))}
        </nav>
      </header>

      {!hasHistory ? (
        <section className="mt-12 max-w-md border-t border-ink/80 pt-8">
          <p className="font-serif text-[24px] leading-tight">Insights begin with a few workouts.</p>
          <p className="mt-2 text-sm text-ink-2">
            Once there are sessions to compare, this page shows what has moved, what is holding steady, and where the work went. Nothing is
            estimated beyond what you log.
          </p>
          <Link href="/" className="mt-5 inline-block text-sm font-medium underline underline-offset-4">
            Go to Today
          </Link>
        </section>
      ) : (
        <>
          {/* the period at a glance, in sentences */}
          <section aria-labelledby="glance" className="mt-10 border-t border-ink/80 pt-8">
            <h2 id="glance" className="sr-only">
              The period at a glance
            </h2>
            <p className="num text-[13px] text-ink-3">
              {formatShortDate(`${p.start}T12:00:00Z`, "UTC")} – {formatShortDate(`${p.end}T12:00:00Z`, "UTC")}
              {sample ? <span className="ml-2 rounded-sm bg-sunken px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">Includes sample data</span> : null}
            </p>
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-5 font-serif text-[22px] leading-snug sm:text-[26px] md:grid-cols-2">
              <p>
                {recentSessions === 0
                  ? `No workouts logged in the last ${weeksN} weeks.`
                  : `${plural(recentSessions, "workout")} in ${weeksN} weeks, about ${fmt1(freq.recent.sessionsPerWeek)} a week`}
                {recentSessions > 0 && freq.previous.sessionsPerWeek > 0 ? <span className="text-ink-3"> (before: {fmt1(freq.previous.sessionsPerWeek)}).</span> : recentSessions > 0 ? "." : null}
              </p>
              {freq.recent.volume > 0 ? (
                <p>
                  {formatVolume(freq.recent.volume, unit)} lifted across {formatNumber(freq.recent.sets)} sets
                  {delta(freq.recent.volume, freq.previous.volume) ? (
                    <span className="text-ink-3"> ({delta(freq.recent.volume, freq.previous.volume)} on the {weeksN} weeks before).</span>
                  ) : (
                    "."
                  )}
                </p>
              ) : null}
              {progress[0] ? <p>{lead(progress[0], unit)}</p> : null}
              {counts.recent > 0 ? (
                <p>
                  {plural(counts.recent, "personal record")} in this period
                  <span className="text-ink-3"> ({counts.previous} in the {weeksN} weeks before).</span>
                </p>
              ) : null}
            </div>
          </section>

          <WeeklyChart weeks={weeks} start={p.start} unit={unit} />

          {/* progression */}
          <Section id="moved" title="What moved" note={`Best set in the last ${weeksN} weeks against the ${weeksN} before. Each exercise is compared only with itself.`}>
            {progress.length ? (
              <ol className="border-t border-line">
                {progress.slice(0, 10).map((r) => (
                  <li key={r.exerciseId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 border-b border-line py-4 sm:grid-cols-[minmax(0,1fr)_120px_9rem]">
                    <div className="min-w-0">
                      <Link href={`/exercises/${r.exerciseId}`} className="block truncate text-[15px] font-medium hover:underline hover:underline-offset-4">
                        {r.name}
                      </Link>
                      <p className="num mt-0.5 text-[13px] text-ink-2">{describe(r, unit)}</p>
                      {r.estimate && r.estimate.to !== r.estimate.from ? (
                        <p className="num mt-0.5 text-[12px] text-ink-3">
                          Estimated 1RM {formatWeight(r.estimate.from)} → {formatWeight(r.estimate.to)} {unit} (Epley, an estimate)
                        </p>
                      ) : null}
                    </div>
                    <Sparkline
                      className="hidden sm:block"
                      values={r.days.map((d) => (r.basis === "reps" ? d.bestReps : r.basis === "reps_at_weight" ? (d.repsAt.get(r.atWeight!) ?? 0) : (d.topWeight ?? 0)))}
                      label={`${r.name}: ${r.days.length} sessions`}
                    />
                    <div className="num text-right text-[13px]">
                      <span className="block text-ink">+{Math.round(r.change * 100)}%</span>
                      <Link href={`/history/${r.sessionId}`} className="text-[12px] text-ink-3 hover:text-ink">
                        See the session
                      </Link>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>
                Nothing to compare yet. An exercise shows here once it has at least two sessions in this period and two in the {weeksN} weeks
                before, and its best set has moved.
              </Empty>
            )}
          </Section>

          {/* plateaus, without judgement */}
          <Section
            id="steady"
            title="Holding steady"
            note="Exercises whose last four sessions, over three weeks or more, haven't passed the best before them. Weighted lifts are judged by estimated 1RM, so more reps at the same weight counts as moving."
          >
            {holding.length ? (
              <ul className="border-t border-line">
                {holding.map((h) =>
                  h.status === "holding" ? (
                    <li key={h.exerciseId} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-4">
                      <Link href={`/exercises/${h.exerciseId}`} className="min-w-0 truncate text-[15px] font-medium hover:underline hover:underline-offset-4">
                        {h.name}
                      </Link>
                      <span className="num text-[13px] text-ink-2">
                        {h.measure === "weight_reps"
                          ? `Best ${formatWeight(h.best)} ${unit} est. 1RM on ${formatShortDate(h.bestAt, tz)}; since ${formatShortDate(h.since, tz)}, ${formatWeight(h.recentRange[0])}–${formatWeight(h.recentRange[1])}`
                          : `Best ${h.best} reps on ${formatShortDate(h.bestAt, tz)}; since ${formatShortDate(h.since, tz)}, ${h.recentRange[0]}–${h.recentRange[1]}`}
                      </span>
                    </li>
                  ) : null,
                )}
              </ul>
            ) : (
              <Empty>Nothing is holding steady: every exercise with enough history has moved in its last four sessions.</Empty>
            )}
            {building.length ? (
              <p className="mt-4 text-[13px] text-ink-3">
                Still building a baseline (fewer than six sessions): {building.map((b) => b.status === "insufficient" && b.name).filter(Boolean).join(", ")}.
              </p>
            ) : null}
          </Section>

          {/* volume per muscle */}
          <Section
            id="where"
            title="Where the work went"
            note="Average sets a week, counted toward each exercise's primary muscle only, so compound lifts are never counted twice."
          >
            {muscles.length ? (
              <>
                <div className="mb-3 flex items-center gap-5 text-[12px] text-ink-3" aria-hidden>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-4 rounded-[2px] bg-sage" /> Last {weeksN} weeks
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-0.5 bg-ink-3" /> The {weeksN} before
                  </span>
                </div>
                <ul className="space-y-3">
                  {(() => {
                    const max = Math.max(1, ...muscles.flatMap((m) => [m.recent, m.previous]));
                    return muscles.map((m) => (
                      <li key={m.muscle} className="grid grid-cols-[6.5rem_minmax(0,1fr)_6.5rem] items-center gap-3 text-[13px] sm:grid-cols-[8rem_minmax(0,1fr)_8rem]">
                        <span className="truncate text-ink-2">{m.muscle}</span>
                        <span className="relative h-2.5 rounded-full bg-sunken" role="img" aria-label={`${m.muscle}: ${fmt1(m.recent)} sets a week, ${fmt1(m.previous)} before`}>
                          <span className="absolute inset-y-0 left-0 rounded-full bg-sage" style={{ width: `${(m.recent / max) * 100}%` }} />
                          {m.previous > 0 ? (
                            <span className="absolute -inset-y-1 w-0.5 rounded-full bg-ink-3" style={{ left: `calc(${(m.previous / max) * 100}% - 1px)` }} />
                          ) : null}
                        </span>
                        <span className="num text-right text-ink-2">
                          {fmt1(m.recent)}
                          <span className="text-ink-3"> / {fmt1(m.previous)}</span>
                        </span>
                      </li>
                    ));
                  })()}
                </ul>
                {bal.untrained.length ? (
                  <p className="mt-4 text-[13px] text-ink-3">Trained before, not in the last {weeksN} weeks: {bal.untrained.join(", ")}.</p>
                ) : null}
              </>
            ) : (
              <Empty>No sets logged in either period yet.</Empty>
            )}
          </Section>

          {/* balance */}
          <Section id="balance" title="Balance" note="How recorded sets divide between movements. An observation of what was logged, not a biomechanical assessment.">
            {bal.enough ? (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-2">
                <Split a={{ label: "Pushing", sets: bal.push }} b={{ label: "Pulling", sets: bal.pull }} weeks={weeksN} />
                <Split a={{ label: "Upper body", sets: bal.upper }} b={{ label: "Lower body", sets: bal.lower }} weeks={weeksN} />
                {bal.other > 0 ? <p className="text-[12px] text-ink-3 md:col-span-2">{plural(bal.other, "set")} (core, full body) sit outside both splits.</p> : null}
              </div>
            ) : (
              <Empty>
                Balance is described once there are at least 20 sets in the period ({bal.total} so far), so a single session can&apos;t tip it.
              </Empty>
            )}
          </Section>

          {/* running, on its own terms: never converted into lifting volume */}
          {running ? (
            <Section id="running" title="Running" note={`Runs in the last ${weeksN} weeks against the ${weeksN} before, kept apart from strength training. Pace compares GPS-recorded outdoor runs only.`}>
              {running.recent.runs + running.previous.runs === 0 ? (
                <Empty>No runs in either period.</Empty>
              ) : (
                <dl className="num grid grid-cols-2 gap-x-8 gap-y-6 border-y border-line py-5 sm:grid-cols-4">
                  {[
                    { label: "Distance", now: `${formatKm(running.recent.meters)} km`, before: `${formatKm(running.previous.meters)} km`, d: delta(running.recent.meters, running.previous.meters) },
                    { label: "Runs", now: String(running.recent.runs), before: String(running.previous.runs), d: null },
                    { label: "Time running", now: formatRunTime(running.recent.seconds * 1000), before: formatRunTime(running.previous.seconds * 1000), d: null },
                    {
                      label: "Average pace (GPS)",
                      now: running.recent.pace ? `${formatPace(running.recent.pace)} /km` : "—",
                      before: running.previous.pace ? `${formatPace(running.previous.pace)} /km` : "—",
                      d: null,
                    },
                  ].map((c) => (
                    <div key={c.label}>
                      <dd className="text-[22px] font-medium leading-none">{c.now}</dd>
                      <dt className="mt-1.5 text-[12px] text-ink-3">{c.label}</dt>
                      <dd className="mt-1 text-[12px] text-ink-3">
                        Before: {c.before}
                        {c.d ? ` (${c.d})` : ""}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {running.recent.longest ? (
                <p className="mt-4 text-[13px] text-ink-2">
                  Longest run this period:{" "}
                  <Link href={`/runs/${running.recent.longest.id}`} className="underline underline-offset-4">
                    {formatKm(running.recent.longest.meters)} km on {formatShortDate(running.recent.longest.startedAt, tz)}
                  </Link>
                  .
                </p>
              ) : null}
            </Section>
          ) : null}

          {/* records */}
          <Section id="records" title="Records" note="Measured records only: the heaviest set or the most reps, never estimates, and never a first-ever baseline.">
            <dl className="num grid grid-cols-2 gap-x-8 gap-y-5 border-y border-line py-5 sm:grid-cols-4">
              {[
                { label: `Last ${weeksN} weeks`, value: counts.recent },
                { label: `The ${weeksN} before`, value: counts.previous },
                { label: "Last 12 months", value: counts.year },
                { label: "All time", value: counts.all },
              ].map((c) => (
                <div key={c.label}>
                  <dd className="text-[24px] font-medium leading-none">{c.value}</dd>
                  <dt className="mt-1.5 text-[12px] text-ink-3">{c.label}</dt>
                </div>
              ))}
            </dl>
            <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-10 md:grid-cols-2">
              <div>
                <h3 className="text-[13px] font-medium">Recent records</h3>
                {recentRecords.length ? (
                  <ul className="mt-2">
                    {recentRecords.map((r) => (
                      <li key={`${r.sessionId}:${r.exerciseId}:${r.kind}`} className="num flex items-baseline gap-3 border-b border-line py-2.5 text-[13px] last:border-0">
                        <Link href={`/exercises/${r.exerciseId}`} className="min-w-0 flex-1 truncate hover:underline hover:underline-offset-4">
                          {r.name}
                        </Link>
                        <span className="text-ink-2">{r.kind === "most_reps" || r.weight == null ? `${r.reps} reps` : `${formatWeight(r.weight)} ${unit} × ${r.reps}`}</span>
                        <Link href={`/history/${r.sessionId}`} className="-my-2 w-14 py-2 text-right text-[11px] text-ink-3 hover:text-ink">
                          {formatShortDate(r.endedAt, tz)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[13px] text-ink-3">No new records in the last {weeksN} weeks.</p>
                )}
              </div>
              <div>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[13px] font-medium">Best sets ever</h3>
                  <Link href="/atlas" className="text-[12px] text-ink-3 hover:text-ink">
                    The Atlas →
                  </Link>
                </div>
                <ul className="mt-2">
                  {bests.map((b) => (
                    <li key={b.exerciseId} className="num flex items-baseline gap-3 border-b border-line py-2.5 text-[13px] last:border-0">
                      <Link href={`/exercises/${b.exerciseId}`} className="min-w-0 flex-1 truncate hover:underline hover:underline-offset-4">
                        {b.name}
                      </Link>
                      <span className="text-ink-2">{b.weight != null ? `${formatWeight(b.weight)} ${unit} × ${b.reps}` : `${b.reps} reps`}</span>
                      <Link href={`/history/${b.sessionId}`} className="-my-2 w-14 py-2 text-right text-[11px] text-ink-3 hover:text-ink">
                        {formatShortDate(b.at, tz)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>
        </>
      )}
    </main>
  );
}

function lead(r: Progress, unit: string) {
  if (r.basis === "top_weight") return `${r.name}: heaviest set from ${formatWeight(r.from)} to ${formatWeight(r.to)} ${unit}.`;
  if (r.basis === "reps_at_weight") return `${r.name}: ${r.to} reps at ${formatWeight(r.atWeight)} ${unit}, up from ${r.from}.`;
  return `${r.name}: ${r.to} reps in a set, up from ${r.from}.`;
}

function describe(r: Progress, unit: string) {
  if (r.basis === "top_weight") return `Heaviest set ${formatWeight(r.from)} → ${formatWeight(r.to)} ${unit}`;
  if (r.basis === "reps_at_weight") return `At ${formatWeight(r.atWeight)} ${unit}: ${r.from} → ${r.to} reps`;
  return `Most reps ${r.from} → ${r.to}`;
}

function Section({ id, title, note, children }: { id: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-16">
      <h2 id={id} className="font-serif text-[26px] leading-tight sm:text-[30px]">
        {title}
      </h2>
      <p className="mt-1.5 max-w-2xl text-[13px] text-ink-3">{note}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="max-w-xl border-l-2 border-line-strong py-1 pl-4 text-[14px] text-ink-3">{children}</p>;
}

/** Two parts of a whole, side by side, each named and counted in text. */
function Split({ a, b, weeks }: { a: { label: string; sets: number }; b: { label: string; sets: number }; weeks: number }) {
  const total = Math.max(1, a.sets + b.sets);
  const obs = pairObservation({ label: a.label.toLowerCase(), sets: a.sets }, { label: b.label.toLowerCase(), sets: b.sets }, weeks);
  return (
    <div>
      <div className="num flex justify-between text-[13px]">
        <span>
          {a.label} <span className="text-ink-3">{a.sets}</span>
        </span>
        <span>
          <span className="text-ink-3">{b.sets}</span> {b.label}
        </span>
      </div>
      <div className="mt-2 flex h-2.5 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`${a.label} ${a.sets} sets, ${b.label} ${b.sets} sets`}>
        <span className="h-full rounded-l-full bg-sage-deep" style={{ width: `${(a.sets / total) * 100}%` }} />
        <span className="h-full flex-1 rounded-r-full bg-sage-soft" />
      </div>
      <p className="mt-2 text-[13px] text-ink-3">{obs ?? "Close to even in this period."}</p>
    </div>
  );
}

/** Sets per week over both periods; each column opens that week's reflection. */
function WeeklyChart({ weeks, start, unit }: { weeks: WeekTotals[]; start: string; unit: string }) {
  const max = Math.max(1, ...weeks.map((w) => w.sets));
  return (
    <figure className="mt-10">
      <div className="flex h-28 items-end gap-[2px]" role="list" aria-label="Sets per week">
        {weeks.map((w) => (
          <Link
            key={w.week}
            role="listitem"
            href={`/reflections/${w.week}`}
            aria-label={`${weekLabel(w.week)}: ${plural(w.sets, "set")}, ${plural(w.sessions, "workout")}, ${formatVolume(w.volume, unit)}`}
            title={`${weekLabel(w.week)} · ${plural(w.sets, "set")} · ${plural(w.sessions, "workout")}`}
            className="group flex h-full flex-1 items-end justify-center"
          >
            <span
              className={cn(
                "block w-full max-w-7 rounded-t-[4px] transition-colors",
                w.week >= start ? "bg-sage group-hover:bg-sage-deep" : "bg-line-strong group-hover:bg-ink-4",
                w.sets === 0 && "h-px! rounded-none bg-line",
              )}
              style={{ height: `${Math.max(2, (w.sets / max) * 100)}%` }}
            />
          </Link>
        ))}
      </div>
      <figcaption className="num mt-2 flex justify-between text-[11px] text-ink-3">
        <span>{weekLabel(weeks[0].week).split(" – ")[0]}</span>
        <span>Sets per week: the period before in grey, this period in sage</span>
        <span>This week</span>
      </figcaption>
    </figure>
  );
}
