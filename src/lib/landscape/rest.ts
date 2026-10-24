import { addDays, dayKey, isoWeekday } from "@/lib/dates";

/** A run of consecutive rest days. On the landscape it becomes a lake; longer runs, larger lakes. */
export type RestSpan = {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD, inclusive
  days: number;
  /** Midpoint of the span, as an ISO instant, for placement on the time axis. */
  at: string;
  label: string;
};

/**
 * Rest days are the days the plan leaves open (weekdays outside `trainingDays`) on which no
 * session was logged. Missed training days are deliberately *not* water: the landscape never
 * turns a skipped session into a feature. Without a plan, every day without a session rests.
 * Only days up to today count.
 */
export function restSpans({
  start,
  end,
  timeZone,
  trainingDays,
  sessionEndedAts,
}: {
  start: Date;
  end: Date;
  timeZone: string;
  trainingDays: number[];
  sessionEndedAts: string[];
}): RestSpan[] {
  const trained = new Set(sessionEndedAts.map((t) => dayKey(t, timeZone)));
  const first = dayKey(start, timeZone);
  const last = dayKey(end, timeZone);
  const isRest = (k: string) => !trained.has(k) && (trainingDays.length === 0 || !trainingDays.includes(isoWeekday(k)));

  const spans: RestSpan[] = [];
  let run: string[] = [];
  const flush = () => {
    if (!run.length) return;
    const a = run[0];
    const b = run[run.length - 1];
    const mid = (Date.parse(`${a}T00:00:00Z`) + Date.parse(`${b}T23:59:59Z`)) / 2;
    spans.push({ start: a, end: b, days: run.length, at: new Date(mid).toISOString(), label: restLabel(a, b, run.length) });
    run = [];
  };
  for (let k = first; k <= last; k = addDays(k, 1)) {
    if (isRest(k)) run.push(k);
    else flush();
  }
  flush();
  return spans;
}

function restLabel(a: string, b: string, days: number) {
  const fmt = (k: string) =>
    new Date(`${k}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return days === 1 ? `Rest day · ${fmt(a)}` : `${days} rest days · ${fmt(a)} – ${fmt(b)}`;
}
