"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import { hashString } from "@/lib/landscape/terrain";
import type { CompletionPayload } from "@/lib/workout/types";

/**
 * Development / exploration data. Every session is written with is_sample = true, labelled
 * in the UI, and removable in one step (clear_sample_history), which also rebuilds records
 * from real sessions only. Generation is deterministic per user.
 */

function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE: Record<string, number> = {
  barbell: 60,
  dumbbell: 20,
  cable: 35,
  machine: 70,
};

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

export async function generateSampleHistory(uid: string, trainingDays: number[], onProgress?: (done: number, total: number) => void) {
  const supabase = supabaseBrowser();
  const { data: templates, error } = await supabase
    .from("workout_templates")
    .select(
      "id, name, est_minutes, template_exercises(position, exercise:exercises(id, name, equipment, measure, category), template_sets(position, target_reps))",
    )
    .is("archived_at", null)
    .order("position");
  if (error) throw error;
  if (!templates.length) throw new Error("Create a routine first.");

  const rand = rng(hashString(uid));
  const days = trainingDays.length ? trainingDays : [1, 3, 5];
  const WEEKS = 10;
  const payloads: CompletionPayload[] = [];
  const start = new Date();
  start.setUTCHours(17, 30, 0, 0);
  start.setUTCDate(start.getUTCDate() - WEEKS * 7);

  let rotation = 0;
  for (let d = 0; d < WEEKS * 7; d++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + d);
    const iso = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    if (!days.includes(iso)) continue;
    if (rand() < 0.14) continue; // a realistic missed session now and then
    const week = Math.floor(d / 7);
    const t = templates[rotation++ % templates.length];
    const minutes = (t.est_minutes ?? 50) + Math.round((rand() - 0.5) * 16);
    const ended = new Date(date.getTime() + minutes * 60_000);

    payloads.push({
      id: crypto.randomUUID(),
      template_id: t.id,
      template_name: t.name,
      started_at: date.toISOString(),
      ended_at: ended.toISOString(),
      notes: null,
      is_sample: true,
      exercises: [...t.template_exercises]
        .sort((a, b) => a.position - b.position)
        .map((te) => {
          const ex = te.exercise;
          const seed = (hashString(ex.id) % 1000) / 1000;
          const bodyweight = ex.measure === "bodyweight_reps";
          const step = ex.equipment === "dumbbell" ? 2 : 2.5;
          const base = (BASE[ex.equipment] ?? 40) * (ex.category === "isolation" ? 0.45 : 1) * (0.85 + seed * 0.5);
          // stepwise progression: plateaus of a few weeks, a lighter week, then a new step
          const stepEvery = 3 + (hashString(ex.id + "step") % 2);
          const progress = 1 + Math.floor(week / stepEvery) * (ex.category === "compound" ? 0.05 : 0.04) - (week === 6 ? 0.06 : 0);
          const weight = bodyweight ? null : Math.max(step, roundTo(base * progress, step));
          return {
            exercise_id: ex.id,
            exercise_name: ex.name,
            substituted_for: null,
            notes: null,
            sets: [...te.template_sets]
              .sort((a, b) => a.position - b.position)
              .map((s, i) => {
                const target = s.target_reps ?? 8;
                const reps = bodyweight
                  ? Math.max(3, Math.round(target - 3 + Math.floor(week / 3) - i + rand() * 1.2))
                  : Math.max(1, target - (rand() < 0.25 ? 1 : 0) - (i >= 2 && rand() < 0.3 ? 1 : 0));
                return {
                  weight,
                  reps,
                  target_weight: null,
                  target_reps: s.target_reps,
                  completed: true,
                  completed_at: new Date(date.getTime() + (i + 1) * 3 * 60_000).toISOString(),
                };
              }),
          };
        }),
    });
  }

  // Chronological order so records are derived as they would have been.
  for (const [i, p] of payloads.entries()) {
    const { error } = await supabase.rpc("complete_session", { payload: p as unknown as Json });
    if (error) throw error;
    onProgress?.(i + 1, payloads.length);
  }
  return payloads.length;
}

export async function clearSampleHistory() {
  const { error } = await supabaseBrowser().rpc("clear_sample_history");
  if (error) throw error;
}
