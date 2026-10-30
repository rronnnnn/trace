import type { Metadata } from "next";
import Link from "next/link";
import { IconPlus } from "@/components/icons";
import { buttonClass } from "@/components/ui/button";
import { requireProfile } from "@/lib/supabase/server";
import { StartWorkoutButton } from "../start-workout-button";
import { FreestyleButton } from "./freestyle-button";

export const metadata: Metadata = { title: "Train" };

/** "3 × 10", or "3 sets · 12/10/8" when reps differ between sets. */
function setSummary(sets: { position: number; target_reps: number | null }[]) {
  const reps = [...sets].sort((a, b) => a.position - b.position).map((s) => s.target_reps);
  if (reps.every((r) => r === reps[0])) return `${reps.length} × ${reps[0] ?? "—"}`;
  return `${reps.length} sets · ${reps.map((r) => r ?? "—").join("/")}`;
}

export default async function TrainPage() {
  const { supabase, userId } = await requireProfile();
  const { data: templates, error } = await supabase
    .from("workout_templates")
    .select(
      "id, name, focus, est_minutes, template_exercises(position, rest_seconds, exercise:exercises(name), template_sets(position, target_reps))",
    )
    .is("archived_at", null)
    .order("position");
  if (error) throw error;

  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-8 sm:px-8 md:pt-14 lg:px-14">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[52px]">Train</h1>
          <p className="mt-3 max-w-xl text-ink-2">
            Your routines, and runs. Starting a routine copies it into a session, so later edits never rewrite history.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/train/exercises" className={buttonClass({ variant: "ghost" })}>
            Exercises
          </Link>
          <Link href="/run" className={buttonClass({ variant: "secondary" })}>
            Start a run
          </Link>
          <FreestyleButton uid={userId} />
          <Link href="/train/new" className={buttonClass()}>
            <IconPlus /> New routine
          </Link>
        </div>
      </header>

      {templates.length === 0 ? (
        <div className="mt-12 border-t border-line pt-6">
          <p className="text-ink-3">No routines yet. Build one from any exercises, sets and reps you like.</p>
          <Link href="/train/new" className={buttonClass({ variant: "secondary", className: "mt-4" })}>
            <IconPlus /> Create a routine
          </Link>
        </div>
      ) : (
        <ol className="mt-12 border-t border-ink/80">
          {templates.map((t, n) => {
            const items = [...t.template_exercises].sort((a, b) => a.position - b.position);
            return (
              <li
                key={t.id}
                className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-5 border-b border-line py-8 md:grid-cols-[minmax(0,4fr)_minmax(0,6fr)_auto] md:items-start"
              >
                <div>
                  <p className="eyebrow num">{String(n + 1).padStart(2, "0")}</p>
                  <h2 className="mt-2 font-serif text-[28px] leading-[1.1] tracking-[-0.01em]">{t.name}</h2>
                  <p className="num mt-1.5 text-sm text-ink-3">
                    {t.focus ? `${t.focus} · ` : ""}
                    {t.est_minutes ? `about ${t.est_minutes} min` : `${items.length} exercises`}
                  </p>
                </div>
                <ol className="text-[14px] md:pt-1">
                  {items.map((te, i) => (
                    <li key={i} className="flex justify-between gap-4 border-t border-line py-2 first:border-t-0 first:pt-0">
                      <span className="text-ink-2">{te.exercise.name}</span>
                      <span className="num text-ink-3">
                        {setSummary(te.template_sets)}
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="flex items-start gap-2 md:flex-col md:items-stretch md:pt-1">
                  <StartWorkoutButton uid={userId} templateId={t.id} templateName={t.name} variant="secondary" label="Start" />
                  <Link
                    href={`/train/${t.id}/edit`}
                    className={buttonClass({ variant: "ghost", size: "lg" })}
                    aria-label={`Edit ${t.name}`}
                  >
                    Edit
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
