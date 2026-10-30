import type { Metadata } from "next";
import Link from "next/link";
import { bestEver, primaryValue, recentTrend, summarize, trendLine, type ExerciseSession } from "@/lib/exercise-progress";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import type { Measure } from "@/lib/workout/types";
import { ExerciseIndex, type IndexRow } from "./exercise-index";

export const metadata: Metadata = { title: "Exercises" };

export default async function ExercisesPage() {
  const [{ supabase, profile }, tz] = await Promise.all([requireProfile(), getTimeZone()]);
  const unit = profile.unit;

  const [libraryRes, historyRes] = await Promise.all([
    supabase.from("exercises").select("id, name, primary_muscle, equipment, measure, owner_id, archived_at").order("name"),
    supabase
      .from("session_exercises")
      .select("exercise_id, session:workout_sessions!inner(id, ended_at, template_name, is_sample), session_sets(weight, reps, completed, position)")
      .limit(3000),
  ]);
  if (libraryRes.error) throw libraryRes.error;
  if (historyRes.error) throw historyRes.error;

  const byExercise = new Map<string, ExerciseSession[]>();
  for (const e of historyRes.data) {
    const sets = [...e.session_sets].sort((a, b) => a.position - b.position).filter((s) => s.completed);
    if (!sets.length) continue;
    const list = byExercise.get(e.exercise_id) ?? [];
    list.push({
      sessionId: e.session.id,
      endedAt: e.session.ended_at,
      routine: e.session.template_name,
      isSample: e.session.is_sample,
      notes: null,
      sets: sets.map((s) => ({ weight: s.weight == null ? null : Number(s.weight), reps: s.reps })),
    });
    byExercise.set(e.exercise_id, list);
  }

  const now = new Date();
  const rows: IndexRow[] = libraryRes.data
    // Archived exercises only appear when they have history to show.
    .filter((x) => !x.archived_at || byExercise.has(x.id))
    .map((x) => {
      const measure = x.measure as Measure;
      const list = summarize(byExercise.get(x.id) ?? []);
      const best = bestEver(list, measure);
      const trend = recentTrend(list, measure, now);
      return {
        id: x.id,
        name: x.name,
        muscle: x.primary_muscle,
        equipment: x.equipment,
        weighted: measure === "weight_reps",
        custom: x.owner_id != null,
        sessions: list.length,
        lastAt: list.length ? list[list.length - 1].endedAt : null,
        best: best ? { value: best.value, reps: best.reps } : null,
        trend: trend ? { change: trend.current - trend.previous, line: trendLine(trend, measure, unit)! } : null,
        spark: list.slice(-16).map((s) => primaryValue(s, measure)),
        sample: list.length > 0 && list.every((s) => s.isSample),
      };
    });

  const trained = rows.filter((r) => r.sessions > 0).length;

  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-8 sm:px-8 md:pt-14 lg:px-14">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Exercises</p>
          <h1 className="mt-3 font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[52px]">Every lift, over time.</h1>
          <p className="mt-3 max-w-xl text-[15px] text-ink-2">
            {trained
              ? `${trained} exercise${trained === 1 ? "" : "s"} in your record. Bests are measured sets; estimates are always labelled.`
              : "Log a workout and each exercise starts its own line of progress here."}
          </p>
        </div>
        <Link
          href="/train/exercises"
          className="text-sm text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-ink"
        >
          Manage your own exercises
        </Link>
      </header>
      <ExerciseIndex rows={rows} unit={unit} timeZone={tz} />
    </main>
  );
}
