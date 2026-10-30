import type { Metadata } from "next";
import Link from "next/link";
import { dayKey } from "@/lib/dates";
import { historySpan, overview, parseDay } from "@/lib/atlas";
import { formatLongDate, formatNumber, plural } from "@/lib/format";
import { earnedLandmarks } from "@/lib/landscape/landmarks";
import { loadWorldHistory } from "@/lib/landscape/world-history";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { runningLandmarks } from "@/lib/run/landmarks";
import { loadRuns } from "../runs/data";
import { AtlasView } from "./atlas-view";

export const metadata: Metadata = { title: "Atlas" };

export default async function AtlasPage({ searchParams }: PageProps<"/atlas">) {
  const [{ supabase, userId, profile }, tz, sp] = await Promise.all([requireProfile(), getTimeZone(), searchParams]);
  const [history, runs] = await Promise.all([loadWorldHistory(supabase), loadRuns(supabase, { routes: false })]);
  const unit = profile.unit;
  // the record holds both: strength landmarks (placed in the world) and running ones (Atlas only)
  const landmarks = [...earnedLandmarks(history, { unit, timeZone: tz }), ...runningLandmarks(runs ?? [], { timeZone: tz })].sort(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
  );
  const o = overview(history, landmarks);
  const runCount = runs?.length ?? 0;
  const firstRun = runs?.at(-1)?.startedAt ?? null;
  const first = [o.first, firstRun].filter((x): x is string => Boolean(x)).sort()[0] ?? null;
  const now = new Date();
  // ?on=YYYY-MM-DD: the world at the end of that day, in the viewer's timezone
  const day = parseDay(sp.on) ? (sp.on as string) : null;
  const on = day ? (history.filter((s) => dayKey(s.endedAt, tz) <= day).at(-1)?.endedAt ?? parseDay(day)) : null;

  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-8 sm:px-8 md:pt-14 lg:px-14">
      <header>
        <p className="eyebrow">Atlas</p>
        <h1 className="mt-3 font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[52px]">A permanent record of your training journey.</h1>
        {first ? (
          <p className="num mt-3 max-w-xl text-[15px] text-ink-2">
            Since {formatLongDate(first, tz)}. Everything here is drawn from what you logged, so it can only grow.
          </p>
        ) : null}
      </header>

      {!first ? (
        <div className="mt-12 max-w-md border-t border-ink/80 pt-8">
          <p className="font-serif text-[24px] leading-tight">Your Atlas begins with your first workout.</p>
          <p className="mt-2 text-sm text-ink-2">
            Each session you log becomes part of a world, and the moments that matter become places in it. They are kept here, for good.
          </p>
          <Link href="/" className="mt-5 inline-block text-sm font-medium underline underline-offset-4">
            Go to Today
          </Link>
        </div>
      ) : (
        <>
          <dl className="num mt-10 grid grid-cols-2 gap-x-8 gap-y-6 border-y border-ink/80 py-6 sm:grid-cols-5">
            {[
              { label: "Workouts", value: formatNumber(o.workouts), sub: runCount ? plural(runCount, "run") : null },
              { label: "Training history", value: historySpan(first, now) },
              { label: "Personal records", value: formatNumber(o.records) },
              { label: "Landmarks", value: `${o.landmarks}`, sub: o.summits ? `${o.summits} on summits` : null },
              { label: "Routines", value: formatNumber(o.routines) },
            ].map((s) => (
              <div key={s.label}>
                <dd className="text-[22px] font-medium leading-none tracking-[-0.01em] sm:text-[26px]">{s.value}</dd>
                <dt className="mt-2 text-[12px] text-ink-3">
                  {s.label}
                  {s.sub ? <span className="text-ink-3"> · {s.sub}</span> : null}
                </dt>
              </div>
            ))}
          </dl>
          <AtlasView
            history={history}
            landmarks={landmarks}
            seed={userId}
            unit={unit}
            timeZone={tz}
            trainingDays={profile.training_days}
            now={now.toISOString()}
            initialAt={on}
          />
        </>
      )}
    </main>
  );
}
