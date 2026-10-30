import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunSummary } from "@/lib/run/analysis";
import type { TrackPoint } from "@/lib/run/recorder";
import type { Database, Json } from "@/lib/supabase/database.types";

export const routePoints = (route: Json | null): TrackPoint[] | null => {
  const pts = (route as { points?: unknown } | null)?.points;
  return Array.isArray(pts) ? (pts as TrackPoint[]) : null;
};

/**
 * Every run, newest first, scoped by RLS to the viewer. Routes come with them (best efforts are
 * measured on the route); `routes: false` leaves them out where only totals are needed.
 * Returns null when the runs table isn't there yet.
 */
export async function loadRuns(supabase: SupabaseClient<Database>, { routes = true } = {}): Promise<RunSummary[] | null> {
  const { data, error } = await supabase
    .from("runs")
    .select(`id, kind, source, title, started_at, elapsed_seconds, moving_seconds, distance_m, is_sample${routes ? ", route" : ""}`)
    .order("started_at", { ascending: false })
    .limit(1000)
    .returns<(Database["public"]["Tables"]["runs"]["Row"])[]>();
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") return null;
    throw error;
  }
  return data.map((r) => ({
    id: r.id,
    kind: r.kind,
    source: r.source,
    title: r.title,
    startedAt: r.started_at,
    movingSeconds: r.moving_seconds,
    elapsedSeconds: r.elapsed_seconds,
    meters: Number(r.distance_m),
    points: routes ? routePoints(r.route) : null,
    isSample: r.is_sample,
  }));
}

/** "Morning run", from the hour the run started, when it has no title of its own. */
export function runTitle(r: { title: string | null; kind: string; startedAt: string }, timeZone: string) {
  if (r.title) return r.title;
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(new Date(r.startedAt)));
  const part = h < 5 ? "Night" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : h < 21 ? "Evening" : "Night";
  return `${part} ${r.kind === "treadmill" ? "treadmill run" : "run"}`;
}
