import type { Metadata } from "next";
import { buildWindow, parseRange, weekOfSession, type ExploreSession, type RecordKind } from "@/lib/landscape/explore";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { LandscapeView } from "./landscape-view";

export const metadata: Metadata = { title: "Landscape" };

const ID = /^[0-9a-f-]{36}$|^name:.{1,80}$/i;
const param = (v: string | string[] | undefined) => (typeof v === "string" && ID.test(v) ? v : null);

export default async function LandscapePage({ searchParams }: PageProps<"/landscape">) {
  const [sp, { supabase, userId, profile }, tz] = await Promise.all([searchParams, requireProfile(), getTimeZone()]);
  const range = parseRange(sp.range);
  const now = new Date();

  const [{ data: first }, { count: totalSessionsEver }] = await Promise.all([
    supabase.from("workout_sessions").select("ended_at").order("ended_at").limit(1).maybeSingle(),
    supabase.from("workout_sessions").select("id", { count: "exact", head: true }),
  ]);
  const win = buildWindow(range, now, tz, first?.ended_at);

  const { data, error } = await supabase
    .from("workout_sessions")
    .select(
      "id, template_id, template_name, started_at, ended_at, total_volume, completed_sets, is_sample, session_exercises(id, exercise_id, exercise_name, position, session_sets(id, position, weight, reps, completed)), personal_records(exercise_id, session_set_id, kind, value, weight, reps, is_baseline)",
    )
    .gte("ended_at", win.start)
    .order("ended_at")
    .limit(1000);
  if (error) throw error;

  const sessions: ExploreSession[] = data.map((s) => ({
    id: s.id,
    templateId: s.template_id,
    templateName: s.template_name ?? "Session",
    startedAt: s.started_at,
    endedAt: s.ended_at,
    totalVolume: Number(s.total_volume),
    completedSets: s.completed_sets,
    isSample: s.is_sample,
    exercises: s.session_exercises.map((e) => ({
      id: e.id,
      exerciseId: e.exercise_id,
      name: e.exercise_name,
      position: e.position,
      sets: e.session_sets.map((x) => ({
        id: x.id,
        position: x.position,
        weight: x.weight == null ? null : Number(x.weight),
        reps: x.reps,
        completed: x.completed,
      })),
    })),
    records: s.personal_records.map((r) => ({
      exerciseId: r.exercise_id,
      setId: r.session_set_id,
      kind: r.kind as RecordKind,
      value: Number(r.value),
      weight: r.weight == null ? null : Number(r.weight),
      reps: r.reps,
      isBaseline: r.is_baseline,
    })),
  }));

  // Muscle groups for the exercise filter.
  const exerciseIds = [...new Set(sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId)))];
  const { data: library } = exerciseIds.length
    ? await supabase.from("exercises").select("id, primary_muscle").in("id", exerciseIds)
    : { data: [] as { id: string; primary_muscle: string }[] };
  const muscles = Object.fromEntries((library ?? []).map((e) => [e.id, e.primary_muscle]));

  const sessionId = param(sp.session);
  const linked = sessions.find((s) => s.id === sessionId);
  const week = typeof sp.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : null;

  return (
    <main className="mx-auto w-full max-w-[1440px] px-4 pb-20 pt-8 sm:px-8 md:pt-14 lg:px-12">
      <header>
        <p className="eyebrow">Training landscape</p>
        <h1 className="mt-3 font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[52px]">Your training, mapped.</h1>
        <p className="mt-3 max-w-2xl text-[15px] text-ink-2">
          Time runs left to right. Each routine raises its own range, every session builds it higher in proportion to its volume, and
          records stand as landmarks. Rest days collect as lakes along the river in the valley.
        </p>
      </header>
      <LandscapeView
        sessions={sessions}
        range={range}
        window={win}
        timeZone={tz}
        seed={userId}
        unit={profile.unit}
        muscles={muscles}
        totalSessionsEver={totalSessionsEver ?? 0}
        trainingDays={profile.training_days}
        initial={{
          templateId: param(sp.workout),
          exerciseId: param(sp.exercise),
          session: linked?.id ?? null,
          week: linked ? (weekOfSession(linked, win.weeks, tz)?.key ?? null) : win.weeks.some((w) => w.key === week) ? week : null,
        }}
      />
    </main>
  );
}
