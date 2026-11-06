import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatLongDate } from "@/lib/format";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { SessionEditor } from "./session-editor";

export const metadata: Metadata = { title: "Edit session" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditSessionPage({ params }: PageProps<"/history/[id]/edit">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [{ supabase, profile }, tz] = await Promise.all([requireProfile(), getTimeZone()]);
  const { data: s, error } = await supabase
    .from("workout_sessions")
    .select(
      "id, template_name, ended_at, notes, session_exercises(id, position, exercise_name, notes, exercise:exercises!session_exercises_exercise_id_fkey(measure), session_sets(id, position, weight, reps, completed))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!s) notFound();

  return (
    <SessionEditor
      unit={profile.unit}
      initial={{
        id: s.id,
        title: s.template_name ?? "session",
        date: formatLongDate(s.ended_at, tz),
        notes: s.notes ?? "",
        exercises: [...s.session_exercises]
          .sort((a, b) => a.position - b.position)
          .map((e) => ({
            id: e.id,
            name: e.exercise_name,
            weighted: e.exercise.measure === "weight_reps",
            notes: e.notes ?? "",
            sets: [...e.session_sets]
              .filter((x) => x.completed)
              .sort((a, b) => a.position - b.position)
              .map((x) => ({ key: x.id, id: x.id, weight: x.weight == null ? null : Number(x.weight), reps: x.reps })),
          })),
      }}
    />
  );
}
