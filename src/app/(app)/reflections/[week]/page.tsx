import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft, IconArrowRight } from "@/components/icons";
import { addDays, dayKey, weekStart } from "@/lib/dates";
import { formatDuration, formatShortDate, formatVolume, formatWeight } from "@/lib/format";
import { buildReflection, change, energyLabel, headline, parseWeek, weekdayName, weekLabel } from "@/lib/reflection";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { loadReflectionSessions, loadWrittenReflections } from "../data";
import { ReflectionForm } from "../reflection-form";

export const metadata: Metadata = { title: "Reflection" };

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
// Enough history for "previous session of this exercise" and a long plan streak.
const LOOKBACK_WEEKS = 26;

export default async function ReflectionPage({ params }: PageProps<"/reflections/[week]">) {
  const { week: raw } = await params;
  const week = parseWeek(raw);
  if (!week) notFound();
  const [{ supabase, profile }, tz] = await Promise.all([requireProfile(), getTimeZone()]);
  const today = dayKey(new Date(), tz);
  const current = weekStart(today);
  if (week > current) notFound();
  const unit = profile.unit;

  const previousWeek = addDays(week, -7);
  const nextWeek = addDays(week, 7);
  const [sessions, written] = await Promise.all([
    // A day of slack either side covers every timezone; buildReflection assigns days precisely.
    loadReflectionSessions(supabase, {
      from: new Date(`${addDays(week, -7 * LOOKBACK_WEEKS - 1)}T00:00:00Z`).toISOString(),
      to: new Date(`${addDays(nextWeek, 1)}T00:00:00Z`).toISOString(),
    }),
    loadWrittenReflections(supabase, [week, previousWeek]),
  ]);

  const r = buildReflection({ week, sessions, trainingDays: profile.training_days, timeZone: tz, today });
  const mine = written.byWeek.get(week) ?? null;
  const lastFocus = written.byWeek.get(previousWeek)?.nextFocus ?? null;
  const vsLast = change(r.volume, r.previousVolume);
  const vsAverage = change(r.volume, r.averageVolume);
  const maxMuscle = Math.max(1, ...r.muscles.map((m) => m.sets));
  const notes = r.sessions.filter((s) => s.notes);
  const sessionById = new Map(r.sessions.map((s) => [s.id, s]));

  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-6 sm:px-8 md:pt-10 lg:px-14">
      <nav className="flex items-center justify-between gap-4 text-[13px] text-ink-3" aria-label="Weeks">
        <Link href="/reflections" className="flex items-center gap-1.5 hover:text-ink">
          <IconArrowLeft /> Reflections
        </Link>
        <span className="flex items-center gap-1">
          {sessions.some((s) => s.endedAt < `${week}T00:00:00Z`) ? (
          <Link href={`/reflections/${previousWeek}`} className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-sunken hover:text-ink">
            <IconArrowLeft /> <span className="num">{weekLabel(previousWeek)}</span>
          </Link>
          ) : null}
          {nextWeek <= current ? (
            <Link href={`/reflections/${nextWeek}`} className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-sunken hover:text-ink">
              <span className="num">{weekLabel(nextWeek)}</span> <IconArrowRight />
            </Link>
          ) : null}
        </span>
      </nav>

      <header className="mt-8">
        <p className="eyebrow num">
          {week === current ? "This week · " : ""}
          {weekLabel(week)}
          {r.usesSample ? " · includes sample sessions" : ""}
        </p>
        <h1 className="mt-3 max-w-3xl font-serif text-[32px] leading-[1.1] tracking-[-0.02em] sm:text-[44px]">{headline(r)}</h1>
        {lastFocus ? (
          <p className="mt-4 max-w-2xl border-l-2 border-sage pl-3 text-[15px] text-ink-2">
            <span className="text-ink-3">Your focus for this week: </span>
            {lastFocus}
          </p>
        ) : null}
      </header>

      {/* The week, day by day. */}
      <ol className="mt-10 grid grid-cols-7 border-y border-ink/80" aria-label="Days">
        {r.days.map((d, i) => {
          const trained = d.sessionIds.length > 0;
          const missed = r.missed.includes(d.key);
          const state = trained ? "Trained" : missed ? "Planned, not trained" : d.future ? (d.planned ? "Planned" : "") : d.planned ? "Planned" : "Rest";
          return (
            <li
              key={d.key}
              aria-label={`${weekdayName(d.key)}${state ? `: ${state}` : ""}`}
              className={cn("min-w-0 px-1 py-4 sm:px-3", i > 0 && "border-l border-line", d.isToday && "bg-surface")}
            >
              <p className={cn("num text-[11px]", d.isToday ? "font-semibold text-ink" : "text-ink-3")}>
                {DAY_LETTERS[i]} <span className="hidden sm:inline">{Number(d.key.slice(8))}</span>
              </p>
              <div className="mt-3 flex h-6 items-center">
                {trained ? (
                  <span className="size-3 rounded-full bg-sage-deep ring-2 ring-sage-soft" aria-hidden />
                ) : missed ? (
                  <span className="size-3 rounded-full border border-dashed border-ink-3" aria-hidden />
                ) : d.planned ? (
                  <span className="size-3 rounded-full border border-dashed border-line-strong" aria-hidden />
                ) : (
                  <span className="h-px w-3 bg-line-strong" aria-hidden />
                )}
              </div>
              <div className="mt-2 hidden min-h-[2.5rem] sm:block">
                {d.sessionIds.map((id) => {
                  const s = sessionById.get(id)!;
                  return (
                    <Link key={id} href={`/history/${id}`} className="block truncate text-[12px] text-ink-2 hover:text-ink">
                      {s.routine ?? "Session"}
                    </Link>
                  );
                })}
                {!trained ? <p className="text-[12px] text-ink-3">{missed ? "Missed" : d.future ? (d.planned ? "Planned" : "") : "Rest"}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[12px] text-ink-3 sm:hidden">
        {r.sessions.map((s) => `${weekdayName(dayKey(s.endedAt, tz)).slice(0, 3)}: ${s.routine ?? "Session"}`).join(" · ") || "No sessions"}
      </p>

      <dl className="num mt-8 grid grid-cols-2 gap-6 border-b border-line pb-8 md:grid-cols-4">
        <Stat
          label="Sessions"
          value={String(r.sessions.length)}
          suffix={r.planned ? ` / ${r.planned}` : undefined}
          note={r.planned ? `${r.plannedHit} of ${r.planned} planned days${r.extra ? ` · ${r.extra} extra` : ""}` : "No days planned"}
        />
        <Stat
          label="Volume"
          value={formatVolume(r.volume, unit)}
          note={
            vsLast != null
              ? `${pct(vsLast)} on last week${vsAverage != null && r.averageVolume !== r.previousVolume ? ` · ${pct(vsAverage)} on your 4-week average` : ""}`
              : "First week on record"
          }
        />
        <Stat label="Time training" value={r.minutes ? formatDuration(r.minutes * 60000) : "—"} />
        <Stat
          label="Plan streak"
          value={r.planned ? `${r.streak} wk` : "—"}
          note={r.planned ? (r.streak ? "weeks in a row meeting your plan" : r.complete ? "Plan not met this week" : "Meet the plan to start one") : "Plan training days in onboarding"}
        />
      </dl>

      {r.sessions.length ? (
        <div className="mt-12 grid gap-12 md:grid-cols-2">
          <section aria-labelledby="moved">
            <h2 id="moved" className="eyebrow">
              What moved
            </h2>
            <p className="mt-1 text-[13px] text-ink-3">Your best set of each exercise, against the last time you did it.</p>
            <ul className="mt-4 border-t border-line text-[14px]">
              {r.improvements.map((i) => {
                const fmt = (v: number) => (i.measure === "weight_reps" ? `${formatWeight(v)} ${unit}` : `${v} reps`);
                return (
                  <li key={i.exerciseId}>
                    <Link href={`/exercises/${i.exerciseId}`} className="flex items-center justify-between gap-3 border-b border-line py-2.5 hover:bg-surface">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Direction d={i.direction} />
                        <span className="truncate text-ink-2">{i.name}</span>
                      </span>
                      <span className="num shrink-0">
                        {i.before != null && i.direction !== "level" ? <span className="text-ink-3">{fmt(i.before)} → </span> : null}
                        <span className={i.direction === "up" ? "font-medium text-sage-deep" : "font-medium"}>{fmt(i.now)}</span>
                        {i.direction === "new" ? <span className="ml-1.5 text-[12px] text-ink-3">first time</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="muscles">
            <h2 id="muscles" className="eyebrow">
              Where the work went
            </h2>
            <p className="mt-1 text-[13px] text-ink-3">Completed sets by primary muscle.</p>
            <ul className="mt-4 space-y-2.5">
              {r.muscles.map((m) => (
                <li key={m.muscle} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2rem] items-center gap-3 text-[13px]">
                  <span className="truncate text-ink-2">{m.muscle}</span>
                  <span className="h-2.5">
                    <span className="block h-full rounded-r-[3px] bg-sage" style={{ width: `${(m.sets / maxMuscle) * 100}%` }} />
                  </span>
                  <span className="num text-right text-ink-2">{m.sets}</span>
                </li>
              ))}
            </ul>

            {r.records.length ? (
              <div className="mt-10">
                <h2 className="eyebrow">Records this week</h2>
                <ul className="mt-3 border-t border-line text-sm">
                  {r.records.map((rec, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 border-b border-line py-2">
                      <span className="flex items-center gap-2 text-ink-2">
                        <span className="size-1.5 rounded-full bg-sage" aria-hidden />
                        {rec.exerciseName}
                      </span>
                      <span className="num font-medium">
                        {rec.kind === "most_reps" ? `${rec.reps} reps` : `${formatWeight(rec.weight)} ${unit} × ${rec.reps}`}
                        <span className="ml-2 text-xs font-normal text-ink-3">{formatShortDate(rec.at, tz)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {notes.length ? (
        <section aria-labelledby="notes" className="mt-12">
          <h2 id="notes" className="eyebrow">
            Notes you left
          </h2>
          <ul className="mt-3 space-y-3">
            {notes.map((s) => (
              <li key={s.id} className="max-w-2xl text-[14px]">
                <span className="num text-[12px] text-ink-3">
                  {weekdayName(dayKey(s.endedAt, tz))} · {s.routine ?? "Session"}
                </span>
                <p className="whitespace-pre-line italic text-ink-2">{s.notes}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="yours" className="mt-14 grid gap-8 border-t border-ink/80 pt-8 md:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] md:gap-12">
        <div>
          <h2 id="yours" className="font-serif text-[28px] leading-[1.1]">
            Your reflection
          </h2>
          <p className="mt-2 max-w-xs text-sm text-ink-2">
            The numbers say what happened. This is for what they can&apos;t: how it felt, and what you&apos;ll carry into next week.
          </p>
          {mine ? (
            <p className="mt-4 text-[12px] text-ink-3">
              {energyLabel(mine.energy) ? `Felt ${energyLabel(mine.energy)!.toLowerCase()} · ` : ""}last edited {formatShortDate(mine.updatedAt, tz)}
            </p>
          ) : null}
          <Link
            href={`/landscape?range=all&week=${week}`}
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink"
          >
            See this week on your landscape <IconArrowRight />
          </Link>
        </div>
        {written.available ? (
          <ReflectionForm key={mine?.updatedAt ?? "new"} week={week} initial={mine} complete={r.complete} />
        ) : (
          <p className="rounded-md border border-dashed border-line-strong px-4 py-5 text-sm text-ink-3">
            Writing reflections needs the <code className="text-ink-2">weekly_reflections</code> table. Apply the latest database migration to turn it on.
          </p>
        )}
      </section>
    </main>
  );
}

const pct = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(Math.round(n * 100))}%`;

function Direction({ d }: { d: "up" | "level" | "down" | "new" }) {
  const label = { up: "Improved", level: "Matched", down: "Lower", new: "New" }[d];
  return (
    <span
      aria-label={label}
      title={label}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px]",
        d === "up" ? "bg-sage-soft text-sage-deep" : "bg-sunken text-ink-3",
      )}
    >
      {d === "up" ? "↑" : d === "down" ? "↓" : d === "new" ? "•" : "="}
    </span>
  );
}

function Stat({ label, value, suffix, note }: { label: string; value: string; suffix?: string; note?: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-1.5 text-[26px] font-medium leading-none tracking-[-0.02em]">
        {value}
        {suffix ? <span className="text-ink-3">{suffix}</span> : null}
      </dd>
      {note ? <dd className="mt-1.5 text-[12px] leading-snug text-ink-3">{note}</dd> : null}
    </div>
  );
}
