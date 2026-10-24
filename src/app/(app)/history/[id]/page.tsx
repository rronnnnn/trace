import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft } from "@/components/icons";
import { formatDuration, formatLongDate, formatVolume, formatWeight } from "@/lib/format";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";

export const metadata: Metadata = { title: "Session" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SessionPage({ params, searchParams }: PageProps<"/history/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const [{ supabase, profile }, tz] = await Promise.all([requireProfile(), getTimeZone()]);

  const { data: s, error } = await supabase
    .from("workout_sessions")
    .select(
      "id, template_name, started_at, ended_at, notes, total_volume, completed_sets, is_sample, session_exercises(id, position, exercise_name, notes, substituted:exercises!session_exercises_substituted_for_fkey(name), session_sets(id, position, weight, reps, target_reps, completed)), personal_records(session_set_id, kind, value, is_baseline)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!s) notFound();

  const unit = profile.unit;
  // Baselines (the first value ever logged for an exercise) are kept for comparison but never celebrated.
  const records = s.personal_records.filter((r) => !r.is_baseline);
  const recordsBySet = new Map<string, { kind: string; value: number }[]>();
  for (const r of records) recordsBySet.set(r.session_set_id, [...(recordsBySet.get(r.session_set_id) ?? []), r]);
  const measuredRecords = records.filter((r) => r.kind !== "estimated_1rm").length;
  const isFirstSession = s.personal_records.length > 0 && records.length === 0;

  return (
    <main className="mx-auto w-full max-w-[880px] px-5 pb-20 pt-6 sm:px-8 md:pt-10">
      <Link href="/history" className="flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
        <IconArrowLeft /> History
      </Link>

      {sp.completed ? (
        <div role="status" className="mt-6 rounded-lg border border-sage-soft bg-sage-wash px-5 py-4 text-sm text-sage-deep">
          Saved to your record.
          {measuredRecords
            ? ` ${measuredRecords} new record${measuredRecords > 1 ? "s" : ""}, marked below.`
            : isFirstSession
              ? " These numbers are your baseline; future sessions are measured against them."
              : ""}
        </div>
      ) : null}

      <header className="mt-6">
        <p className="eyebrow">{formatLongDate(s.ended_at, tz)}</p>
        <h1 className="mt-3 font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[52px]">
          {s.template_name ?? "Session"}
          {s.is_sample ? (
            <span className="ml-3 rounded-sm bg-sunken px-1.5 py-0.5 align-middle font-sans text-[11px] font-medium uppercase tracking-wider text-ink-3">
              Sample
            </span>
          ) : null}
        </h1>
        <dl className="num mt-8 grid grid-cols-3 gap-6 border-y border-ink/80 py-6">
          <div>
            <dt className="text-xs text-ink-3">Duration</dt>
            <dd className="mt-1.5 text-[28px] font-medium leading-none tracking-[-0.02em]">
              {formatDuration(new Date(s.ended_at).getTime() - new Date(s.started_at).getTime())}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Sets</dt>
            <dd className="mt-1.5 text-[28px] font-medium leading-none tracking-[-0.02em]">{s.completed_sets}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Volume</dt>
            <dd className="mt-1.5 text-[28px] font-medium leading-none tracking-[-0.02em]">{formatVolume(Number(s.total_volume), unit)}</dd>
          </div>
        </dl>
        {s.notes ? <p className="mt-5 max-w-prose whitespace-pre-line text-ink-2">{s.notes}</p> : null}
      </header>

      <div className="mt-12 space-y-10">
        {[...s.session_exercises]
          .sort((a, b) => a.position - b.position)
          .map((e) => {
            const sets = [...e.session_sets].sort((a, b) => a.position - b.position);
            const performed = sets.filter((x) => x.completed);
            const skipped = sets.length - performed.length;
            return (
              <section key={e.id} aria-label={e.exercise_name}>
                <div className="flex items-baseline justify-between gap-4">
                  <h2
                    className={
                      performed.length ? "font-serif text-[22px] leading-tight" : "font-serif text-[22px] leading-tight text-ink-3"
                    }
                  >
                    {e.exercise_name}
                  </h2>
                  {!performed.length ? <span className="text-xs text-ink-3">Not performed</span> : null}
                </div>
                {e.substituted ? <p className="text-[13px] text-ink-3">In place of {e.substituted.name}</p> : null}
                {e.notes ? <p className="mt-1 text-[13px] italic text-ink-2">{e.notes}</p> : null}
                {performed.length ? (
                  <table className="num mt-3 w-full text-[14px]">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] text-ink-3">
                        <th className="w-14 py-2 font-normal">Set</th>
                        <th className="py-2 font-normal">Performed</th>
                        <th className="py-2 text-right font-normal">
                          <span className="sr-only">Records</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {performed.map((set, i) => {
                        const records = recordsBySet.get(set.id) ?? [];
                        const measured = records.filter((r) => r.kind !== "estimated_1rm");
                        const estimate = records.find((r) => r.kind === "estimated_1rm");
                        return (
                          <tr key={set.id} className="border-b border-line">
                            <td className="py-2.5 text-ink-3">{i + 1}</td>
                            <td className="py-2.5">
                              {set.weight != null ? `${formatWeight(set.weight)} ${unit} × ${set.reps}` : `${set.reps} reps`}
                            </td>
                            <td className="py-2.5 text-right text-[12px]">
                              {measured.length ? (
                                <span className="inline-flex items-center gap-1.5 text-sage-deep">
                                  <span className="size-1.5 rounded-full bg-sage" aria-hidden />
                                  {measured.map((r) => (r.kind === "most_reps" ? "Most reps" : "Heaviest")).join(" · ")}
                                </span>
                              ) : null}
                              {estimate ? (
                                <span className="ml-2 text-ink-3" title="Estimated with the Epley formula; not a measured lift">
                                  est. 1RM {formatWeight(estimate.value)}
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : null}
                {performed.length && skipped ? (
                  <p className="mt-2 text-xs text-ink-3">
                    {skipped} planned set{skipped > 1 ? "s" : ""} skipped
                  </p>
                ) : null}
              </section>
            );
          })}
      </div>
    </main>
  );
}
