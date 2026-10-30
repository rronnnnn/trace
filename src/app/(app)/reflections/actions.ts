"use server";

import { revalidatePath } from "next/cache";
import { dayKey, weekStart } from "@/lib/dates";
import { parseWeek } from "@/lib/reflection";
import { requireUser } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";

export type ReflectionInput = { week: string; energy: number | null; note: string; nextFocus: string };
export type ReflectionResult = { error: string } | { ok: true; cleared: boolean };

export async function saveReflection(input: ReflectionInput): Promise<ReflectionResult> {
  const [{ supabase, userId }, tz] = await Promise.all([requireUser(), getTimeZone()]);
  const week = parseWeek(input.week);
  if (!week) return { error: "Unknown week." };
  if (week > weekStart(dayKey(new Date(), tz))) return { error: "That week hasn't started yet." };

  const energy = input.energy == null ? null : Math.round(Number(input.energy));
  if (energy != null && !(energy >= 1 && energy <= 5)) return { error: "Choose how the week felt." };
  const note = input.note.trim().slice(0, 2000) || null;
  const nextFocus = input.nextFocus.trim().slice(0, 200) || null;

  // Clearing every field removes the reflection rather than keeping an empty row.
  if (energy == null && !note && !nextFocus) {
    const { error } = await supabase.from("weekly_reflections").delete().eq("week_start", week);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("weekly_reflections").upsert(
      { owner_id: userId, week_start: week, energy, note, next_focus: nextFocus, updated_at: new Date().toISOString() },
      { onConflict: "owner_id,week_start" },
    );
    if (error) return { error: error.message };
  }
  revalidatePath("/reflections");
  revalidatePath(`/reflections/${week}`);
  revalidatePath("/");
  return { ok: true, cleared: energy == null && !note && !nextFocus };
}
