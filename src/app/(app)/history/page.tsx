import type { Metadata } from "next";
import Link from "next/link";
import { formatDuration, formatShortDate, formatVolume, plural } from "@/lib/format";
import { formatKm, formatPace, formatRunTime, paceOf } from "@/lib/run/recorder";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { loadRuns, runTitle } from "../runs/data";
import { SampleHistoryButton } from "../sample-history-button";

export const metadata: Metadata = { title: "History" };

type Entry =
  | { kind: "workout"; at: string; id: string; title: string; detail: string; prs: number; side: string; sample: boolean }
  | { kind: "run"; at: string; id: string; title: string; detail: string; side: string; sample: boolean };

export default async function HistoryPage() {
  const [{ supabase, userId, profile }, tz] = await Promise.all([requireProfile(), getTimeZone()]);
  const [{ data: sessions, error }, runs] = await Promise.all([
    supabase
      .from("workout_sessions")
      .select("id, template_name, started_at, ended_at, total_volume, completed_sets, is_sample, personal_records(kind, is_baseline)")
      .order("ended_at", { ascending: false })
      .limit(300),
    loadRuns(supabase, { routes: false }),
  ]);
  if (error) throw error;

  // strength and running together, newest first
  const entries: Entry[] = [
    ...sessions.map(
      (s): Entry => ({
        kind: "workout",
        at: s.ended_at,
        id: s.id,
        title: s.template_name ?? "Session",
        detail: `${formatDuration(new Date(s.ended_at).getTime() - new Date(s.started_at).getTime())} · ${plural(s.completed_sets, "set")}`,
        prs: s.personal_records.filter((p) => p.kind !== "estimated_1rm" && !p.is_baseline).length,
        side: formatVolume(Number(s.total_volume), profile.unit),
        sample: s.is_sample,
      }),
    ),
    ...(runs ?? []).slice(0, 300).map(
      (r): Entry => ({
        kind: "run",
        at: r.startedAt,
        id: r.id,
        title: runTitle(r, tz),
        detail: `${formatKm(r.meters)} km · ${formatRunTime(r.movingSeconds * 1000)} · ${formatPace(paceOf(r.movingSeconds, r.meters))} /km${r.kind === "treadmill" ? " · treadmill" : ""}`,
        side: `${formatKm(r.meters)} km`,
        sample: r.isSample,
      }),
    ),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const months = new Map<string, Entry[]>();
  for (const e of entries) {
    const m = new Date(e.at).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: tz });
    months.set(m, [...(months.get(m) ?? []), e]);
  }
  const hasSample = sessions.some((s) => s.is_sample);
  const runCount = runs?.length ?? 0;

  return (
    <main className="mx-auto w-full max-w-[880px] px-5 pb-20 pt-8 sm:px-8 md:pt-14">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[52px]">History</h1>
          <p className="mt-3 text-ink-2">
            {entries.length
              ? [sessions.length ? plural(sessions.length, "workout") : null, runCount ? plural(runCount, "run") : null].filter(Boolean).join(" and ") + " recorded."
              : "Completed workouts and runs appear here."}
          </p>
        </div>
        {hasSample ? <SampleHistoryButton uid={userId} mode="remove" /> : null}
      </header>

      {entries.length === 0 ? (
        <div className="mt-12 border-t border-ink/80 pt-8">
          <p className="font-serif text-[24px] leading-tight">Nothing recorded yet.</p>
          <p className="mt-2 max-w-md text-sm text-ink-2">Finish a workout or a run and it becomes the first entry in your record.</p>
          <div className="mt-5 flex gap-5 text-sm">
            <Link href="/" className="font-medium underline underline-offset-4">
              Go to Today
            </Link>
            <Link href="/runs" className="text-ink-2 underline underline-offset-4 hover:text-ink">
              Runs
            </Link>
          </div>
        </div>
      ) : (
        [...months.entries()].map(([month, list]) => (
          <section key={month} className="mt-10" aria-label={month}>
            <h2 className="eyebrow">{month}</h2>
            <ul className="mt-3 border-t border-ink/80">
              {list.map((e) => (
                <li key={`${e.kind}:${e.id}`}>
                  <Link
                    href={e.kind === "run" ? `/runs/${e.id}` : `/history/${e.id}`}
                    className="group grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-line py-4 transition-colors hover:bg-surface sm:grid-cols-[5.5rem_minmax(0,1fr)_7rem_2rem]"
                  >
                    <span className="num text-sm text-ink-3">{formatShortDate(e.at, tz)}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium">
                        {e.kind === "run" ? (
                          <span className="mr-2 rounded-sm border border-line-strong px-1.5 py-px align-middle text-[10px] font-medium uppercase tracking-wider text-ink-3">Run</span>
                        ) : null}
                        {e.title}
                        {e.sample ? (
                          <span className="ml-2 rounded-sm bg-sunken px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wider text-ink-3">Sample</span>
                        ) : null}
                      </span>
                      <span className="num block truncate text-[13px] text-ink-3">
                        {e.detail}
                        {e.kind === "workout" && e.prs ? <span className="text-sage-deep"> · {plural(e.prs, "record")}</span> : null}
                      </span>
                    </span>
                    <span className="num hidden text-right text-sm text-ink-2 sm:block">{e.side}</span>
                    <span className="text-right text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink motion-reduce:transition-none" aria-hidden>
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
