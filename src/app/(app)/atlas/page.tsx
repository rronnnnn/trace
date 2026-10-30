import type { Metadata } from "next";
import Link from "next/link";
import { dayKey } from "@/lib/dates";
import { historySpan, overview, parseDay } from "@/lib/atlas";
import { formatLongDate, formatNumber } from "@/lib/format";
import { earnedLandmarks } from "@/lib/landscape/landmarks";
import { loadWorldHistory } from "@/lib/landscape/world-history";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { AtlasView } from "./atlas-view";

export const metadata: Metadata = { title: "Atlas" };

export default async function AtlasPage({ searchParams }: PageProps<"/atlas">) {
  const [{ supabase, userId, profile }, tz, sp] = await Promise.all([requireProfile(), getTimeZone(), searchParams]);
  const history = await loadWorldHistory(supabase);
  const unit = profile.unit;
  const landmarks = earnedLandmarks(history, { unit, timeZone: tz });
  const o = overview(history, landmarks);
  const now = new Date();
  // ?on=YYYY-MM-DD: the world at the end of that day, in the viewer's timezone
  const day = parseDay(sp.on) ? (sp.on as string) : null;
  const on = day ? (history.filter((s) => dayKey(s.endedAt, tz) <= day).at(-1)?.endedAt ?? parseDay(day)) : null;

  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-8 sm:px-8 md:pt-14 lg:px-14">
      <header>
        <p className="eyebrow">Atlas</p>
        <h1 className="mt-3 font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[52px]">A permanent record of your training journey.</h1>
        {o.first ? (
          <p className="num mt-3 max-w-xl text-[15px] text-ink-2">
            Since {formatLongDate(o.first, tz)}. Everything here is drawn from the workouts you logged, so it can only grow.
          </p>
        ) : null}
      </header>

      {!o.first ? (
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
              { label: "Workouts", value: formatNumber(o.workouts) },
              { label: "Training history", value: historySpan(o.first, now) },
              { label: "Personal records", value: formatNumber(o.records) },
              { label: "Landmarks", value: `${o.landmarks}`, sub: o.summits ? `${o.summits} on summits` : null },
              { label: "Routines", value: formatNumber(o.routines) },
            ].map((s) => (
              <div key={s.label}>
                <dd className="text-[22px] font-medium leading-none tracking-[-0.01em] sm:text-[26px]">{s.value}</dd>
                <dt className="mt-2 text-[12px] text-ink-3">
                  {s.label}
                  {s.sub ? <span className="text-ink-4"> · {s.sub}</span> : null}
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
