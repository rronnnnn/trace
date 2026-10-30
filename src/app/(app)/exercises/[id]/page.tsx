import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgressChart, type ProgressPoint } from "@/components/exercises/progress-chart";
import { IconArrowLeft, IconArrowRight } from "@/components/icons";
import {
  bestEstimate,
  bestEver,
  primaryValue,
  recentTrend,
  repMaxes,
  setLine,
  summarize,
  type ExerciseSession,
} from "@/lib/exercise-progress";
import { formatLongDate, formatShortDate, formatVolume, formatWeight, plural } from "@/lib/format";
import { goalProgress, goalTitle, progressLine } from "@/lib/goals";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import type { Measure } from "@/lib/workout/types";

export const metadata: Metadata = { title: "Exercise" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ExercisePage({ params }: PageProps<"/exercises/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [{ supabase, profile }, tz] = await Promise.all([requireProfile(), getTimeZone()]);
  const unit = profile.unit;

  const [exRes, historyRes, recordsRes, goalsRes, relatedRes] = await Promise.all([
    supabase
      .from("exercises")
      .select("id, name, primary_muscle, equipment, category, measure, owner_id, archived_at, variation_of")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("session_exercises")
      .select("notes, session:workout_sessions!inner(id, ended_at, template_name, is_sample), session_sets(weight, reps, completed, position)")
      .eq("exercise_id", id)
      .limit(1000),
    supabase
      .from("personal_records")
      .select("session_id, kind, value, weight, reps, achieved_at")
      .eq("exercise_id", id)
      .eq("is_baseline", false)
      .order("achieved_at"),
    supabase.from("goals").select("*").eq("exercise_id", id).is("archived_at", null).order("created_at", { ascending: false }),
    supabase.from("exercises").select("id, name, variation_of").eq("variation_of", id).is("archived_at", null),
  ]);
  if (exRes.error) throw exRes.error;
  if (!exRes.data) notFound();
  for (const r of [historyRes, recordsRes, goalsRes, relatedRes]) if (r.error) throw r.error;

  const ex = exRes.data;
  const measure = ex.measure as Measure;
  const weighted = measure === "weight_reps";

  // Siblings share the parent movement.
  const [{ data: parent }, { data: siblings }] = ex.variation_of
    ? await Promise.all([
        supabase.from("exercises").select("id, name").eq("id", ex.variation_of).maybeSingle(),
        supabase.from("exercises").select("id, name").eq("variation_of", ex.variation_of).neq("id", id).is("archived_at", null),
      ])
    : [{ data: null }, { data: [] }];
  const related = [...(relatedRes.data ?? []), ...(siblings ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  const sessions: ExerciseSession[] = (historyRes.data ?? []).map((e) => ({
    sessionId: e.session.id,
    endedAt: e.session.ended_at,
    routine: e.session.template_name,
    isSample: e.session.is_sample,
    notes: e.notes,
    sets: [...e.session_sets]
      .sort((a, b) => a.position - b.position)
      .filter((s) => s.completed)
      .map((s) => ({ weight: s.weight == null ? null : Number(s.weight), reps: s.reps })),
  }));
  const list = summarize(sessions);
  const records = recordsRes.data ?? [];
  const measuredRecords = records.filter((r) => r.kind !== "estimated_1rm");
  const recordSessions = new Set(measuredRecords.map((r) => r.session_id));

  const now = new Date();
  const best = bestEver(list, measure);
  const estimate = weighted ? bestEstimate(list) : null;
  const trend = recentTrend(list, measure, now);
  const maxes = weighted ? repMaxes(list) : [];
  const totalVolume = list.reduce((a, s) => a + s.volume, 0);
  const totalSets = list.reduce((a, s) => a + s.sets.filter((x) => (x.reps ?? 0) > 0).length, 0);

  const goals = (goalsRes.data ?? []).map((g) => {
    const goal = { targetWeight: g.target_weight == null ? null : Number(g.target_weight), targetReps: g.target_reps };
    const sets = list.flatMap((s) => s.sets.map((x) => ({ endedAt: s.endedAt, weight: x.weight, reps: x.reps, isSample: s.isSample })));
    return { id: g.id, title: goalTitle({ ...goal, exerciseName: g.exercise_name }, unit), achievedAt: g.achieved_at, progress: goalProgress(goal, sets), goal };
  });

  const points: ProgressPoint[] = list.map((s) => ({
    sessionId: s.sessionId,
    at: s.endedAt,
    value: primaryValue(s, measure),
    e1rm: s.e1rm,
    record: recordSessions.has(s.sessionId),
    isSample: s.isSample,
    date: formatShortDate(s.endedAt, tz),
    routine: s.routine ?? "Session",
    sets: setLine(s.sets),
  }));

  const fmtBest = (v: number, reps: number | null) => (weighted ? `${formatWeight(v)} ${unit}${reps ? ` × ${reps}` : ""}` : `${v} reps`);
  const usesSample = list.some((s) => s.isSample);

  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-6 sm:px-8 md:pt-10 lg:px-14">
      <Link href="/exercises" className="flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
        <IconArrowLeft /> Exercises
      </Link>

      <header className="mt-6">
        <p className="eyebrow capitalize">
          {ex.primary_muscle} · {ex.equipment} · {ex.category} · {weighted ? "weight × reps" : "reps only"}
        </p>
        <h1 className="mt-3 font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[52px]">
          {ex.name}
          {ex.owner_id ? <Tag>Yours</Tag> : null}
          {ex.archived_at ? <Tag>Archived</Tag> : null}
        </h1>
        {parent ? (
          <p className="mt-2 text-sm text-ink-3">
            A variation of{" "}
            <Link href={`/exercises/${parent.id}`} className="text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
              {parent.name}
            </Link>
          </p>
        ) : null}
      </header>

      {list.length === 0 ? (
        <section className="mt-10 border-t border-ink/80 pt-8">
          <h2 className="font-serif text-[26px] leading-tight">Not logged yet</h2>
          <p className="mt-2 max-w-md text-sm text-ink-2">
            Add {ex.name} to a routine or a freestyle session. Your first sets become its baseline, and every session after is measured
            against them.
          </p>
          <Link href="/train" className="mt-5 inline-flex items-center gap-1.5 text-sm underline underline-offset-4">
            Go to Train <IconArrowRight />
          </Link>
          <Related related={related} />
        </section>
      ) : (
        <>
          <dl className="num mt-8 grid grid-cols-2 gap-6 border-y border-ink/80 py-6 md:grid-cols-4">
            <Stat
              label={weighted ? "Heaviest set" : "Most reps"}
              value={best ? fmtBest(best.value, best.reps) : "—"}
              note={best ? formatShortDate(best.at, tz) : undefined}
            />
            {weighted ? (
              <Stat
                label="Estimated 1RM"
                value={estimate ? `${formatWeight(estimate.value)} ${unit}` : "—"}
                note={estimate ? "Epley estimate, not lifted" : "Needs a set of 12 reps or fewer"}
              />
            ) : (
              <Stat label="Sets logged" value={String(totalSets)} />
            )}
            <Stat label="Sessions" value={String(list.length)} note={`since ${formatShortDate(list[0].endedAt, tz)}`} />
            <Stat
              label="Last 4 weeks"
              value={trend ? trendValue(trend.current - trend.previous, weighted, unit) : "—"}
              note={trend ? "best vs the 4 weeks before" : "Not enough recent sessions to compare"}
              tone={trend && trend.current > trend.previous ? "up" : undefined}
            />
          </dl>

          <section aria-labelledby="progress" className="mt-10">
            <h2 id="progress" className="eyebrow">
              {weighted ? "Top set per session" : "Most reps per session"}
            </h2>
            <div className="mt-4">
              <ProgressChart points={points} weighted={weighted} unit={unit} now={now.toISOString()} />
            </div>
            {usesSample ? <p className="mt-2 text-[12px] text-ink-3">Includes sample sessions.</p> : null}
          </section>

          <div className="mt-14 grid gap-12 md:grid-cols-2">
            {weighted ? (
              <section aria-labelledby="rep-maxes">
                <h2 id="rep-maxes" className="eyebrow">
                  Rep maxes
                </h2>
                <p className="mt-1 text-[13px] text-ink-3">Heaviest weight you&apos;ve lifted for at least that many reps. Measured, not estimated.</p>
                <table className="num mt-4 w-full text-[14px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] text-ink-3">
                      <th className="w-20 py-2 font-normal">Reps</th>
                      <th className="py-2 font-normal">Weight</th>
                      <th className="py-2 text-right font-normal">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maxes.map((m) => (
                      <tr key={m.reps} className="border-b border-line">
                        <td className="py-2.5 text-ink-3">{m.reps}</td>
                        <td className="py-2.5">
                          {m.weight != null ? (
                            <>
                              {formatWeight(m.weight)} {unit}
                              {m.actualReps && m.actualReps > m.reps ? (
                                <span className="ml-1.5 text-[12px] text-ink-3">(did {m.actualReps})</span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                        </td>
                        <td className="py-2.5 text-right text-[13px] text-ink-3">
                          {m.sessionId && m.at ? (
                            <Link href={`/history/${m.sessionId}`} className="hover:text-ink">
                              {formatShortDate(m.at, tz)}
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            <section aria-labelledby="summits-records" className="space-y-10">
              <div>
                <h2 id="summits-records" className="eyebrow">
                  Summit
                </h2>
                {goals.length ? (
                  <ul className="mt-3 border-t border-line">
                    {goals.map((g) => (
                      <li key={g.id} className="border-b border-line py-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[15px] font-medium">{g.title}</span>
                          <span className="num text-[12px] text-ink-3">{Math.round(g.progress.fraction * 100)}%</span>
                        </div>
                        <div
                          className="mt-2 h-1.5 overflow-hidden rounded-full bg-sage-soft"
                          role="progressbar"
                          aria-label={g.title}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(g.progress.fraction * 100)}
                        >
                          <div className="h-full rounded-full bg-sage" style={{ width: `${g.progress.fraction * 100}%` }} />
                        </div>
                        <p className="num mt-1.5 text-[12px] text-ink-3">
                          {g.achievedAt ? `Reached ${formatShortDate(g.achievedAt, tz)}` : progressLine(g.progress, g.goal, unit).replace(/^\d+% · /, "")}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-ink-2">
                    No goal for {ex.name} yet.{" "}
                    <Link href="/goals" className="underline decoration-line-strong underline-offset-4 hover:text-ink">
                      Set a summit
                    </Link>
                  </p>
                )}
              </div>

              <div>
                <h2 className="eyebrow">Records</h2>
                {measuredRecords.length ? (
                  <ol className="mt-3 border-t border-line text-[14px]">
                    {[...measuredRecords].reverse().slice(0, 8).map((r, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 border-b border-line py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="size-1.5 rounded-full bg-sage" aria-hidden />
                          <span className="num">
                            {r.kind === "most_reps" ? `${r.reps} reps` : `${formatWeight(r.weight)} ${unit} × ${r.reps}`}
                          </span>
                        </span>
                        <Link href={`/history/${r.session_id}`} className="num text-[13px] text-ink-3 hover:text-ink">
                          {formatShortDate(r.achieved_at, tz)}
                        </Link>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 text-sm text-ink-3">
                    Your first sets are the baseline. Beat them and the record shows here.
                  </p>
                )}
              </div>
              <Related related={related} />
            </section>
          </div>

          <section aria-labelledby="log" className="mt-16">
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="log" className="eyebrow">
                Every session
              </h2>
              <p className="num text-[12px] text-ink-3">
                {plural(totalSets, "set")}
                {weighted ? ` · ${formatVolume(totalVolume, unit)} lifted` : ""}
              </p>
            </div>
            <ol className="mt-3 border-t border-ink/80">
              {[...list].reverse().map((s) => (
                <li key={s.sessionId}>
                  <Link
                    href={`/history/${s.sessionId}`}
                    className="group grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-4 border-b border-line py-3.5 transition-colors hover:bg-surface sm:grid-cols-[5.5rem_minmax(0,1fr)_8rem]"
                  >
                    <span className="num text-[13px] text-ink-3" title={formatLongDate(s.endedAt, tz)}>
                      {formatShortDate(s.endedAt, tz)}
                    </span>
                    <span className="min-w-0">
                      <span className="num block text-[15px]">
                        {setLine(s.sets)}
                        {!weighted ? <span className="text-ink-3"> reps</span> : null}
                        {recordSessions.has(s.sessionId) ? <span className="ml-2 text-[12px] text-sage-deep">Record</span> : null}
                      </span>
                      <span className="block truncate text-[12px] text-ink-3">
                        {s.routine ?? "Session"}
                        {s.isSample ? " · sample" : ""}
                        {s.notes ? <span className="italic"> · {s.notes}</span> : null}
                      </span>
                    </span>
                    <span className="num text-right text-[13px] text-ink-2">
                      {weighted ? formatVolume(s.volume, unit) : plural(s.sets.length, "set")}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </main>
  );
}

function trendValue(d: number, weighted: boolean, unit: string) {
  const r = Math.round(d * 10) / 10;
  const v = weighted ? `${formatWeight(Math.abs(r))} ${unit}` : `${Math.abs(r)} reps`;
  return r > 0 ? `+${v}` : r < 0 ? `−${v}` : "Level";
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "up" }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className={tone === "up" ? "mt-1.5 text-[24px] font-medium leading-none tracking-[-0.02em] text-sage-deep" : "mt-1.5 text-[24px] font-medium leading-none tracking-[-0.02em]"}>
        {value}
      </dd>
      {note ? <dd className="mt-1.5 text-[12px] text-ink-3">{note}</dd> : null}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-3 rounded-sm bg-sunken px-1.5 py-0.5 align-middle font-sans text-[11px] font-medium uppercase tracking-wider text-ink-3">
      {children}
    </span>
  );
}

function Related({ related }: { related: { id: string; name: string }[] }) {
  if (!related.length) return null;
  return (
    <div className="mt-8">
      <h2 className="eyebrow">Related movements</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {related.map((r) => (
          <li key={r.id}>
            <Link href={`/exercises/${r.id}`} className="inline-flex h-8 items-center rounded-full border border-line-strong px-3 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink">
              {r.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
