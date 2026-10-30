import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowRight } from "@/components/icons";
import { addDays, dayKey, weekStart } from "@/lib/dates";
import { formatVolume, plural } from "@/lib/format";
import { buildReflection, change, energyLabel, headline, weekLabel, weeklyTotals } from "@/lib/reflection";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { loadReflectionSessions, loadWrittenReflections } from "./data";

export const metadata: Metadata = { title: "Reflections" };

const CHART_WEEKS = 12;

export default async function ReflectionsPage() {
  const [{ supabase, profile }, tz] = await Promise.all([requireProfile(), getTimeZone()]);
  const today = dayKey(new Date(), tz);
  const current = weekStart(today);
  const lastWeek = addDays(current, -7);
  const unit = profile.unit;

  const [sessions, written] = await Promise.all([loadReflectionSessions(supabase), loadWrittenReflections(supabase)]);
  const weeks = weeklyTotals(sessions, tz, today);
  const target = profile.training_days.length;
  const thisWeek = buildReflection({ week: current, sessions, trainingDays: profile.training_days, timeZone: tz, today });
  const last = weeks.find((w) => w.key === lastWeek);
  const promptLastWeek = written.available && last && last.sessions > 0 && !written.byWeek.has(lastWeek);

  const chart = weeks.slice(0, CHART_WEEKS).reverse();
  const maxVolume = Math.max(1, ...chart.map((w) => w.volume));
  const hasHistory = sessions.length > 0;

  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-8 sm:px-8 md:pt-14 lg:px-14">
      <header>
        <p className="eyebrow">Reflections</p>
        <h1 className="mt-3 font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[52px]">Look back, then forward.</h1>
        <p className="mt-3 max-w-xl text-[15px] text-ink-2">
          Each week, what you did against what you planned, what moved, and a line or two from you about how it felt.
        </p>
      </header>

      <section aria-labelledby="this-week" className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-8 border-t border-ink/80 pt-8 md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] md:gap-12">
        <div>
          <p className="eyebrow num" id="this-week">
            This week · {weekLabel(current)}
          </p>
          <h2 className="mt-3 font-serif text-[28px] leading-[1.15] tracking-[-0.01em] sm:text-[32px]">{headline(thisWeek)}</h2>
          <p className="num mt-2 text-sm text-ink-3">
            {plural(thisWeek.sessions.length, "session")}
            {target ? ` of ${target} planned` : ""} · {formatVolume(thisWeek.volume, unit)}
            {thisWeek.streak ? ` · ${thisWeek.streak}-week plan streak` : ""}
          </p>
          {written.byWeek.get(lastWeek)?.nextFocus ? (
            <p className="mt-4 border-l-2 border-sage pl-3 text-[15px] text-ink-2">
              <span className="text-ink-3">Focus: </span>
              {written.byWeek.get(lastWeek)!.nextFocus}
            </p>
          ) : null}
          <Link href={`/reflections/${current}`} className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium hover:text-ink">
            Open this week <IconArrowRight />
          </Link>
        </div>

        {promptLastWeek ? (
          <div className="self-start rounded-lg border border-sage-soft bg-sage-wash px-5 py-5">
            <p className="text-[15px] font-medium text-sage-deep">Last week is ready to look back on</p>
            <p className="mt-1 text-sm text-ink-2">
              {plural(last.sessions, "session")}, {formatVolume(last.volume, unit)}
              {last.records ? `, ${plural(last.records, "record")}` : ""}. Two minutes to note how it went and set a focus.
            </p>
            <Link
              href={`/reflections/${lastWeek}#yours`}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper hover:bg-ink/85"
            >
              Reflect on {weekLabel(lastWeek)}
            </Link>
          </div>
        ) : hasHistory ? (
          <figure className="self-end">
            <div className="flex h-32 items-end gap-[2px]" role="list" aria-label={`Weekly volume, last ${chart.length} weeks`}>
              {chart.map((w) => (
                <Link
                  key={w.key}
                  role="listitem"
                  href={`/reflections/${w.key}`}
                  aria-label={`${weekLabel(w.key)}: ${plural(w.sessions, "session")}, ${formatVolume(w.volume, unit)}`}
                  title={`${weekLabel(w.key)} · ${plural(w.sessions, "session")} · ${formatVolume(w.volume, unit)}`}
                  className="group flex h-full flex-1 items-end justify-center"
                >
                  <span
                    className={cn(
                      "block w-full max-w-6 rounded-t-[4px] transition-colors",
                      w.key === current ? "bg-sage-deep" : "bg-sage-soft group-hover:bg-sage",
                      w.volume === 0 && "h-px! rounded-none bg-line-strong",
                    )}
                    style={{ height: `${Math.max(2, (w.volume / maxVolume) * 100)}%` }}
                  />
                </Link>
              ))}
            </div>
            <figcaption className="num mt-2 flex justify-between text-[11px] text-ink-3">
              <span>{weekLabel(chart[0].key).split(" – ")[0]}</span>
              <span>Weekly volume</span>
              <span>This week</span>
            </figcaption>
          </figure>
        ) : null}
      </section>

      {!hasHistory ? (
        <p className="mt-10 max-w-md text-sm text-ink-3">
          Your first reflection fills in as soon as you finish a workout.{" "}
          <Link href="/" className="text-ink-2 underline underline-offset-4">
            Go to Today
          </Link>
        </p>
      ) : (
        <section aria-labelledby="past" className="mt-16">
          <h2 id="past" className="eyebrow">
            Past weeks
          </h2>
          <ol className="mt-3 border-t border-line">
            {weeks
              .filter((w) => w.key !== current)
              .map((w, i, list) => {
                const prev = list[i + 1];
                const delta = prev ? change(w.volume, prev.volume) : null;
                const mine = written.byWeek.get(w.key);
                const met = target > 0 && w.sessions >= target;
                return (
                  <li key={w.key}>
                    <Link
                      href={`/reflections/${w.key}`}
                      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 border-b border-line py-4 transition-colors hover:bg-surface sm:grid-cols-[9rem_minmax(0,1fr)_8rem_7rem_1.5rem]"
                    >
                      <span className="num text-[15px] font-medium">
                        {weekLabel(w.key)}
                        {w.sample ? (
                          <span className="ml-2 rounded-sm bg-sunken px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wider text-ink-3">
                            Sample
                          </span>
                        ) : null}
                      </span>
                      <span className="num col-span-2 row-start-2 flex items-center gap-2 text-[13px] text-ink-3 sm:col-span-1 sm:row-start-auto">
                        <span className="flex gap-1" aria-hidden>
                          {Array.from({ length: Math.max(target, w.sessions) }, (_, k) => (
                            <span key={k} className={cn("size-2 rounded-full", k < w.sessions ? "bg-sage-deep" : "border border-line-strong")} />
                          ))}
                        </span>
                        {w.sessions ? plural(w.sessions, "session") : "Rest week"}
                        {met ? <span className="text-sage-deep">· plan met</span> : null}
                        {w.records ? <span className="text-sage-deep">· {plural(w.records, "record")}</span> : null}
                      </span>
                      <span className="num text-right text-[13px] sm:text-left">
                        <span className="block text-ink-2">{w.volume ? formatVolume(w.volume, unit) : "—"}</span>
                        {delta != null && w.volume ? (
                          <span className="block text-[12px] text-ink-3">
                            {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
                            {Math.abs(Math.round(delta * 100))}% on prior
                          </span>
                        ) : null}
                      </span>
                      <span className="hidden text-[13px] sm:block">
                        {mine ? (
                          <span className="text-ink-2">{energyLabel(mine.energy) ?? "Written"}</span>
                        ) : (
                          <span className="text-ink-3 group-hover:text-ink-2">{written.available ? "Reflect" : ""}</span>
                        )}
                      </span>
                      <span className="hidden text-right text-ink-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink sm:block" aria-hidden>
                        →
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ol>
        </section>
      )}
    </main>
  );
}
