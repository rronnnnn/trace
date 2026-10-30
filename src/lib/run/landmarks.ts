/**
 * Running landmarks: the first run, first runs of the classic distances, and distance totals.
 * Derived from saved runs like every other landmark (never stored), they live in the Atlas
 * record only. Runs never enter the Training Landscape, so these have no place on the map and
 * never touch its summits.
 */

import type { WorldLandmark } from "@/lib/landscape/landmarks";
import { formatShortDate } from "@/lib/format";
import type { RunSummary } from "./analysis";
import { formatKm, formatPace, formatRunTime, paceOf } from "./recorder";

export const RUN_DISTANCES = [
  { id: "5k", meters: 5000, title: "First 5 km run" },
  { id: "10k", meters: 10000, title: "First 10 km run" },
  { id: "half", meters: 21097.5, title: "First half marathon distance" },
  { id: "marathon", meters: 42195, title: "First marathon distance" },
];
export const RUN_TOTALS_KM = [50, 100, 250, 500, 1000, 2500];

export function runningLandmarks(runs: RunSummary[], { timeZone, asOf }: { timeZone: string; asOf?: string }): WorldLandmark[] {
  const seen = new Set<string>();
  const ordered = [...runs]
    .filter((r) => !seen.has(r.id) && seen.add(r.id) && (!asOf || r.startedAt <= asOf))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  const out: WorldLandmark[] = [];
  const add = (r: RunSummary, l: Pick<WorldLandmark, "id" | "title" | "description" | "stats">) =>
    out.push({ ...l, category: "running", sessionId: r.id, runId: r.id, at: r.startedAt, routine: r.kind === "treadmill" ? "Treadmill run" : "Run", routineKey: "run", exercise: null, summit: null, sample: r.isSample });
  const basic = (r: RunSummary) => [
    { label: "Distance", value: `${formatKm(r.meters)} km` },
    { label: r.kind === "treadmill" ? "Pace (treadmill)" : "Pace", value: `${formatPace(paceOf(r.movingSeconds, r.meters))} /km` },
  ];
  const distances = [...RUN_DISTANCES];
  const totals = [...RUN_TOTALS_KM];
  let total = 0;
  ordered.forEach((r, i) => {
    if (i === 0) add(r, { id: "run-first", title: "First run", description: "The first run in your record.", stats: basic(r) });
    while (distances.length && r.meters >= distances[0].meters) {
      const d = distances.shift()!;
      add(r, { id: `run-${d.id}`, title: d.title, description: `${formatKm(r.meters)} km in ${formatRunTime(r.movingSeconds * 1000)}${r.kind === "treadmill" ? ", on a treadmill" : ""}.`, stats: basic(r) });
    }
    total += r.meters;
    while (totals.length && total >= totals[0] * 1000) {
      const km = totals.shift()!;
      add(r, {
        id: `run-total-${km}`,
        title: `${km} km run`,
        description: `${km} km across ${i + 1} runs, since ${formatShortDate(ordered[0].startedAt, timeZone)}.`,
        stats: [
          { label: "Runs", value: String(i + 1) },
          { label: "Since", value: formatShortDate(ordered[0].startedAt, timeZone) },
        ],
      });
    }
  });
  return out;
}
