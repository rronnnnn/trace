import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { WorldSession } from "./world";

/** The whole training history in the light form the world is built from (no sets). RLS-scoped. */
export async function loadWorldHistory(supabase: SupabaseClient<Database>): Promise<WorldSession[]> {
  const { data, error } = await supabase
    .from("workout_sessions")
    .select("id, template_id, template_name, ended_at, total_volume, completed_sets, personal_records(kind, is_baseline)")
    .order("ended_at")
    .limit(5000);
  if (error) throw error;
  return data.map((s) => ({
    id: s.id,
    endedAt: s.ended_at,
    templateKey: s.template_id ?? `name:${s.template_name ?? "Session"}`,
    label: s.template_name ?? "Session",
    volume: Number(s.total_volume),
    sets: s.completed_sets,
    records: s.personal_records.filter((r) => !r.is_baseline && r.kind !== "estimated_1rm").length,
  }));
}
