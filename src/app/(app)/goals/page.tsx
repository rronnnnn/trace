import type { Metadata } from "next";
import { GoalMountain } from "@/components/goals/goal-mountain";
import { goalProgress, goalTitle, isWeighted, progressLine, suggestTarget, type Goal, type GoalSet } from "@/lib/goals";
import { formatLongDate, formatShortDate, formatWeight } from "@/lib/format";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { GoalActions, NewGoal } from "./goal-controls";

export const metadata: Metadata = { title: "Goals" };

export default async function GoalsPage() {
  const [{ supabase, profile, userId }, tz] = await Promise.all([requireProfile(), getTimeZone()]);
  const unit = profile.unit;

  const [{ data: rows, error }, { data: history, error: hError }] = await Promise.all([
    supabase.from("goals").select("*").order("created_at", { ascending: false }),
    supabase
      .from("session_exercises")
      .select(
        "exercise_id, exercise_name, session:workout_sessions!inner(ended_at, is_sample), session_sets(weight, reps, completed), exercise:exercises!session_exercises_exercise_id_fkey(measure)",
      )
      .limit(2000),
  ]);
  if (error) throw error;
  if (hError) throw hError;

  const setsByExercise = new Map<string, GoalSet[]>();
  const usage = new Map<string, { name: string; count: number; measure: string }>();
  for (const e of history) {
    const list = setsByExercise.get(e.exercise_id) ?? [];
    for (const s of e.session_sets)
      if (s.completed)
        list.push({
          endedAt: e.session.ended_at,
          weight: s.weight == null ? null : Number(s.weight),
          reps: s.reps,
          isSample: e.session.is_sample,
        });
    setsByExercise.set(e.exercise_id, list);
    const u = usage.get(e.exercise_id) ?? { name: e.exercise_name, count: 0, measure: e.exercise?.measure ?? "weight_reps" };
    u.count++;
    usage.set(e.exercise_id, u);
  }

  const goals: (Goal & { progress: ReturnType<typeof goalProgress> })[] = rows.map((r) => {
    const g: Goal = {
      id: r.id,
      exerciseId: r.exercise_id,
      exerciseName: r.exercise_name,
      targetWeight: r.target_weight == null ? null : Number(r.target_weight),
      targetReps: r.target_reps,
      note: r.note,
      achievedAt: r.achieved_at,
      archivedAt: r.archived_at,
      createdAt: r.created_at,
    };
    return { ...g, progress: goalProgress(g, setsByExercise.get(g.exerciseId) ?? []) };
  });

  // Record the moment a summit is first reached (derived from history, so it is exact).
  const newlyReached = goals.filter((g) => g.progress.reachedAt && !g.achievedAt);
  if (newlyReached.length) {
    await Promise.all(newlyReached.map((g) => supabase.from("goals").update({ achieved_at: g.progress.reachedAt }).eq("id", g.id)));
    for (const g of newlyReached) g.achievedAt = g.progress.reachedAt;
  }

  const active = goals.filter((g) => !g.archivedAt && !g.achievedAt);
  const reached = goals.filter((g) => !g.archivedAt && g.achievedAt);
  const archived = goals.filter((g) => g.archivedAt);

  // Suggestions: your most-trained exercises without an open goal, from their current best.
  const suggestions = [...usage.entries()]
    .filter(([id]) => !active.some((g) => g.exerciseId === id))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3)
    .map(([id, u]) => {
      const weighted = u.measure === "weight_reps";
      const p = goalProgress({ targetWeight: weighted ? 1 : null, targetReps: 1 }, setsByExercise.get(id) ?? []);
      return { exerciseId: id, name: u.name, weighted, best: p.current, target: suggestTarget(p.current, weighted) };
    })
    .filter((s) => s.best > 0);

  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-8 sm:px-8 md:pt-14 lg:px-14">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Goals</p>
          <h1 className="mt-3 font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[52px]">Summits.</h1>
          <p className="mt-3 max-w-xl text-[15px] text-ink-2">
            A goal is a peak. Your best measured lifts mark how far up the trail you are. Estimates never count.
          </p>
        </div>
        <NewGoal uid={userId} unit={unit} />
      </header>

      {active.length === 0 ? (
        <section className="mt-12 border-t border-ink/80 pt-8">
          <h2 className="font-serif text-[26px] leading-tight">{reached.length ? "No open summits" : "Choose your first summit"}</h2>
          <p className="mt-2 max-w-md text-sm text-ink-2">
            Pick an exercise and a target, like 100 kg on the bench or 20 pull-ups. Progress updates every time you log a set.
          </p>
          {suggestions.length ? (
            <ul className="mt-6 border-t border-line">
              {suggestions.map((s) => (
                <li key={s.exerciseId} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4">
                  <span>
                    <span className="block text-[15px] font-medium">
                      {s.weighted ? `${formatWeight(s.target)} ${unit}` : `${s.target} reps`} · {s.name}
                    </span>
                    <span className="num block text-[13px] text-ink-3">
                      Your best so far: {s.weighted ? `${formatWeight(s.best)} ${unit}` : `${s.best} reps`}
                    </span>
                  </span>
                  <NewGoal
                    uid={userId}
                    unit={unit}
                    preset={{ exerciseId: s.exerciseId, name: s.name, weighted: s.weighted, target: s.target }}
                    compact
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <ol className="mt-12 space-y-14">
          {active.map((g) => (
            <GoalCard key={g.id} goal={g} unit={unit} tz={tz} />
          ))}
        </ol>
      )}

      {reached.length ? (
        <section className="mt-16">
          <h2 className="eyebrow">Summits reached</h2>
          <ol className="mt-4 space-y-12">
            {reached.map((g) => (
              <GoalCard key={g.id} goal={g} unit={unit} tz={tz} />
            ))}
          </ol>
        </section>
      ) : null}

      {archived.length ? (
        <section className="mt-16">
          <h2 className="eyebrow">Archived</h2>
          <ul className="mt-3 border-t border-line">
            {archived.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 border-b border-line py-3 text-sm">
                <span className="text-ink-2">{goalTitle(g, unit)}</span>
                <GoalActions id={g.id} archived />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function GoalCard({ goal: g, unit, tz }: { goal: Goal & { progress: ReturnType<typeof goalProgress> }; unit: string; tz: string }) {
  const p = g.progress;
  const left = Math.max(0, p.target - p.current);
  const fmt = (n: number) => (isWeighted(g) ? `${formatWeight(n)} ${unit}` : `${n} reps`);
  return (
    <li className="border-t border-ink/80 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">
            {g.achievedAt ? `Reached ${formatLongDate(g.achievedAt, tz)}` : `Set ${formatShortDate(g.createdAt, tz)}`}
          </p>
          <h3 className="mt-2 font-serif text-[28px] leading-[1.1] tracking-[-0.01em]">{goalTitle(g, unit)}</h3>
          {g.note ? <p className="mt-1 text-sm italic text-ink-2">{g.note}</p> : null}
        </div>
        <GoalActions id={g.id} />
      </div>

      <GoalMountain
        seed={g.id}
        fraction={p.fraction}
        reached={Boolean(g.achievedAt)}
        label={goalTitle(g, unit)}
        sublabel={progressLine(p, g, unit).replace(/^\d+% · /, "")}
        className="mt-4 block h-auto w-full"
      />

      <dl className="num mt-4 grid grid-cols-3 gap-4 border-y border-line py-4">
        <div>
          <dt className="text-[11px] text-ink-3">Best so far</dt>
          <dd className="mt-1 text-[18px] font-medium">{p.current ? fmt(p.current) : "—"}</dd>
          {p.bestAt ? <dd className="text-[11px] text-ink-3">{formatShortDate(p.bestAt, tz)}</dd> : null}
        </div>
        <div>
          <dt className="text-[11px] text-ink-3">Summit</dt>
          <dd className="mt-1 text-[18px] font-medium">{fmt(p.target)}</dd>
          {isWeighted(g) && g.targetReps > 1 ? <dd className="text-[11px] text-ink-3">for {g.targetReps} reps</dd> : null}
        </div>
        <div>
          <dt className="text-[11px] text-ink-3">{g.achievedAt ? "Climbed" : "To go"}</dt>
          <dd className="mt-1 text-[18px] font-medium">{g.achievedAt ? "100%" : fmt(Math.round(left * 10) / 10)}</dd>
        </div>
      </dl>
      {p.history.length > 1 ? (
        <p className="num mt-3 text-[12px] text-ink-3">
          Climb so far:{" "}
          {p.history.map((h) => `${isWeighted(g) ? formatWeight(h.value) : h.value} (${formatShortDate(h.at, tz)})`).join(" → ")}
        </p>
      ) : p.current === 0 ? (
        <p className="mt-3 text-[12px] text-ink-3">
          No qualifying sets yet{isWeighted(g) && g.targetReps > 1 ? ` (needs at least ${g.targetReps} reps)` : ""}. The climb starts with
          your next session.
        </p>
      ) : null}
      {p.usesSample ? <p className="mt-1 text-[12px] text-ink-3">Includes sample sessions.</p> : null}
    </li>
  );
}
