"use server";

import { redirect } from "next/navigation";
import { EQUIPMENT_OPTIONS, EXPERIENCE_OPTIONS, GOAL_OPTIONS, PROGRAMS } from "@/lib/programs";
import { requireUser } from "@/lib/supabase/server";

export type OnboardingInput = {
  displayName: string;
  goal: string;
  experience: string;
  equipment: string[];
  trainingDays: number[];
  programId: string;
};

export type OnboardingResult = { error: string } | undefined;

export async function completeOnboarding(input: OnboardingInput): Promise<OnboardingResult> {
  const { supabase, userId } = await requireUser();

  const displayName = input.displayName.trim().slice(0, 60);
  const goal = GOAL_OPTIONS.find((g) => g.id === input.goal)?.id;
  const experience = EXPERIENCE_OPTIONS.find((g) => g.id === input.experience)?.id;
  const equipment = input.equipment.filter((e) => EQUIPMENT_OPTIONS.some((o) => o.id === e));
  const trainingDays = [...new Set(input.trainingDays)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort();
  const program = PROGRAMS.find((p) => p.id === input.programId);

  if (!goal || !experience) return { error: "Choose a goal and experience level." };
  if (trainingDays.length < 1) return { error: "Pick at least one training day." };
  if (!program) return { error: "Choose a program to start with." };

  // Only seed templates the first time; re-running onboarding must not duplicate routines.
  const { count, error: countError } = await supabase
    .from("workout_templates")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);
  if (countError) return { error: countError.message };

  if (!count) {
    const slugs = program.days.flatMap((d) => d.exercises.flatMap((e) => [e.slug, e.alt].filter(Boolean) as string[]));
    const { data: library, error: libError } = await supabase
      .from("exercises")
      .select("id, slug, equipment")
      .is("owner_id", null)
      .in("slug", slugs);
    if (libError) return { error: libError.message };
    const bySlug = new Map(library.map((e) => [e.slug, e]));
    const has = (eq: string) => equipment.length === 0 || equipment.includes(eq);

    // Several inserts, no transaction over PostgREST: undo the routines created so far on failure,
    // so a retry starts clean instead of skipping creation and leaving a half-built program.
    const created: string[] = [];
    const fail = async (message: string) => {
      if (created.length) await supabase.from("workout_templates").delete().in("id", created);
      return { error: `Couldn't create your routines: ${message}` };
    };
    for (const [position, day] of program.days.entries()) {
      const { data: template, error } = await supabase
        .from("workout_templates")
        .insert({ owner_id: userId, name: day.name, focus: day.focus, est_minutes: day.minutes, position })
        .select("id")
        .single();
      if (error) return fail(error.message);
      created.push(template.id);

      for (const [i, item] of day.exercises.entries()) {
        const primary = bySlug.get(item.slug);
        const alt = item.alt ? bySlug.get(item.alt) : undefined;
        const chosen = primary && has(primary.equipment) ? primary : alt && has(alt.equipment) ? alt : (primary ?? alt);
        if (!chosen) continue;

        const { data: te, error: teError } = await supabase
          .from("template_exercises")
          .insert({ owner_id: userId, template_id: template.id, exercise_id: chosen.id, position: i, rest_seconds: item.rest })
          .select("id")
          .single();
        if (teError) return fail(teError.message);

        const { error: setsError } = await supabase.from("template_sets").insert(
          Array.from({ length: item.sets }, (_, k) => ({
            owner_id: userId,
            template_exercise_id: te.id,
            position: k,
            target_reps: item.reps,
          })),
        );
        if (setsError) return fail(setsError.message);
      }
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName || null,
      goal,
      experience,
      equipment,
      training_days: trainingDays,
      onboarded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) return { error: error.message };

  redirect("/");
}
