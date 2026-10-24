import type { Metadata } from "next";
import Link from "next/link";
import { formatDuration, formatShortDate, formatVolume, plural } from "@/lib/format";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { SampleHistoryButton } from "../sample-history-button";

export const metadata: Metadata = { title: "History" };

export default async function HistoryPage() {
  const [{ supabase, userId, profile }, tz] = await Promise.all([requireProfile(), getTimeZone()]);
  const { data: sessions, error } = await supabase
    .from("workout_sessions")
    .select("id, template_name, started_at, ended_at, total_volume, completed_sets, is_sample, personal_records(kind, is_baseline)")
    .order("ended_at", { ascending: false })
    .limit(300);
  if (error) throw error;

  const months = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const m = new Date(s.ended_at).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: tz });
    months.set(m, [...(months.get(m) ?? []), s]);
  }
  const hasSample = sessions.some((s) => s.is_sample);

  return (
    <main className="mx-auto w-full max-w-[880px] px-5 pb-20 pt-8 sm:px-8 md:pt-14">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[52px]">History</h1>
          <p className="mt-3 text-ink-2">
            {sessions.length
              ? `${sessions.length} session${sessions.length === 1 ? "" : "s"} recorded.`
              : "Completed workouts appear here."}
          </p>
        </div>
        {hasSample ? <SampleHistoryButton uid={userId} mode="remove" /> : null}
      </header>

      {sessions.length === 0 ? (
        <div className="mt-12 rounded-lg border border-dashed border-line-strong px-6 py-12 text-center">
          <p className="font-serif text-[22px]">No sessions yet</p>
          <p className="mt-1 text-sm text-ink-3">Finish your first workout and it becomes the first entry in your record.</p>
          <Link href="/" className="mt-5 inline-block text-sm underline underline-offset-4">
            Go to Today
          </Link>
        </div>
      ) : (
        [...months.entries()].map(([month, list]) => (
          <section key={month} className="mt-10" aria-label={month}>
            <h2 className="eyebrow">{month}</h2>
            <ul className="mt-3 border-t border-ink/80">
              {list.map((s) => {
                const prs = s.personal_records.filter((p) => p.kind !== "estimated_1rm" && !p.is_baseline).length;
                return (
                  <li key={s.id}>
                    <Link
                      href={`/history/${s.id}`}
                      className="group grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-line py-4 transition-colors hover:bg-surface sm:grid-cols-[5.5rem_minmax(0,1fr)_7rem_2rem]"
                    >
                      <span className="num text-sm text-ink-3">{formatShortDate(s.ended_at, tz)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-medium">
                          {s.template_name ?? "Session"}
                          {s.is_sample ? (
                            <span className="ml-2 rounded-sm bg-sunken px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wider text-ink-3">
                              Sample
                            </span>
                          ) : null}
                        </span>
                        <span className="num block text-[13px] text-ink-3">
                          {formatDuration(new Date(s.ended_at).getTime() - new Date(s.started_at).getTime())} ·{" "}
                          {plural(s.completed_sets, "set")}
                          {prs ? (
                            <span className="text-sage-deep">
                              {" "}
                              · {prs} record{prs > 1 ? "s" : ""}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="num hidden text-right text-sm text-ink-2 sm:block">
                        {formatVolume(Number(s.total_volume), profile.unit)}
                      </span>
                      <span
                        className="text-right text-ink-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink"
                        aria-hidden
                      >
                        →
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
