"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";

export type RunActionResult = { error: string } | { ok: true; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidate(id?: string) {
  revalidatePath("/runs");
  if (id) revalidatePath(`/runs/${id}`);
  revalidatePath("/history");
  revalidatePath("/atlas");
  revalidatePath("/insights");
}

/** A run logged by hand: a treadmill session, or an outdoor run recorded elsewhere. No route. */
export async function logRun(input: { kind: "outdoor" | "treadmill"; startedAt: string; distanceKm: number; minutes: number; seconds: number; title: string }): Promise<RunActionResult> {
  const { supabase } = await requireUser();
  const kind = input.kind === "treadmill" ? "treadmill" : "outdoor";
  const start = Date.parse(input.startedAt);
  if (Number.isNaN(start)) return { error: "Choose when the run started." };
  if (start > Date.now() + 5 * 60000) return { error: "That time is in the future." };
  const km = Number(input.distanceKm);
  if (!(km > 0 && km <= 500)) return { error: "Distance should be between 0 and 500 km." };
  const secs = Math.round(Number(input.minutes) * 60 + Number(input.seconds || 0));
  if (!(secs >= 60 && secs <= 172800)) return { error: "Duration should be at least a minute." };
  if (secs / km < 90) return { error: "That pace is faster than any runner: check the distance and time." };
  const { data, error } = await supabase
    .from("runs")
    .insert({
      kind,
      source: "manual",
      title: input.title.trim().slice(0, 80) || null,
      started_at: new Date(start).toISOString(),
      ended_at: new Date(start + secs * 1000).toISOString(),
      elapsed_seconds: secs,
      moving_seconds: secs,
      distance_m: Math.round(km * 10000) / 10,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidate(data.id);
  return { ok: true, id: data.id };
}

export async function renameRun(id: string, title: string): Promise<RunActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(id)) return { error: "Unknown run." };
  const { error } = await supabase.from("runs").update({ title: title.trim().slice(0, 80) || null }).eq("id", id);
  if (error) return { error: error.message };
  revalidate(id);
  return { ok: true, id };
}

/** Deletes the run and, with it, its route: nothing of where it went is kept. */
export async function deleteRun(id: string): Promise<RunActionResult> {
  const { supabase } = await requireUser();
  if (!UUID.test(id)) return { error: "Unknown run." };
  const { error } = await supabase.from("runs").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true, id };
}
