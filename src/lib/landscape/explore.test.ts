import { describe, expect, it } from "vitest";
import { BENCH, LOWER, NOW, PULLUP, S1, S3, S4, SQUAT, UPPER, sessions } from "@/test/landscape-fixture";
import {
  buildWindow,
  exerciseOptions,
  exerciseStats,
  filterSessions,
  parseRange,
  summarize,
  templateOptions,
  toLandscapeSessions,
  weeklyTotals,
  weekOfSession,
} from "./explore";
import { buildTerrain } from "./terrain";

const none = { templateId: null, exerciseId: null };

describe("buildWindow", () => {
  it("returns Monday-aligned weeks ending in the current week", () => {
    const w = buildWindow("4w", NOW, "UTC");
    expect(w.weeks.map((x) => x.key)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(w.start).toBe("2026-09-28T00:00:00Z");
  });

  it("'all' starts at the week of the earliest session, never fewer than 4 weeks", () => {
    expect(buildWindow("all", NOW, "UTC", "2026-06-03T10:00:00Z").weeks[0].key).toBe("2026-06-01");
    expect(buildWindow("all", NOW, "UTC", "2026-10-20T10:00:00Z").weeks).toHaveLength(4);
  });

  it("uses the viewer's timezone for week boundaries", () => {
    // Sunday 23:30 in UTC is already Monday in Tokyo
    const w = buildWindow("4w", new Date("2026-10-25T23:30:00Z"), "Asia/Tokyo");
    expect(w.weeks.at(-1)!.key).toBe("2026-10-26");
  });

  it("falls back to 12 weeks for unknown ranges", () => {
    expect(parseRange("nope")).toBe("12w");
    expect(parseRange("26w")).toBe("26w");
  });
});

describe("filters and terrain input", () => {
  it("filters by workout and by exercise", () => {
    expect(filterSessions(sessions, { templateId: LOWER, exerciseId: null }).map((s) => s.id)).toEqual([sessions[1].id, S4]);
    expect(filterSessions(sessions, { templateId: null, exerciseId: PULLUP }).map((s) => s.id)).toEqual([S1, S3]);
    expect(filterSessions(sessions, { templateId: LOWER, exerciseId: BENCH })).toEqual([]);
  });

  it("measures one exercise when an exercise is selected", () => {
    const all = toLandscapeSessions(sessions, none).find((s) => s.id === S3)!;
    const bench = toLandscapeSessions(sessions, { templateId: null, exerciseId: BENCH }).find((s) => s.id === S3)!;
    expect(all.volume).toBe(65 * 8 + 65 * 7);
    expect(bench).toMatchObject({ volume: 65 * 8 + 65 * 7, sets: 2, prCount: 1 });
    expect(all.prCount).toBe(2); // heaviest bench + most pull-ups; the estimate is not counted
  });

  it("never counts baselines or estimates as records", () => {
    const s = summarize(sessions, none);
    expect(s.records.map((r) => r.record.kind).sort()).toEqual(["heaviest_weight", "most_reps"]);
    expect(s.sessions).toBe(4);
    expect(s.sets).toBe(3 + 3 + 3 + 1);
  });

  it("builds options ordered by use, exercises grouped by muscle", () => {
    expect(templateOptions(sessions).map((o) => [o.id, o.count])).toEqual([
      [LOWER, 2],
      [UPPER, 2],
    ]);
    expect(exerciseOptions(sessions, { [BENCH]: "Chest", [SQUAT]: "Quads", [PULLUP]: "Back" }).map((o) => o.label)).toEqual([
      "Pull-up",
      "Bench Press",
      "Back Squat",
    ]);
  });

  it("totals weeks for the navigator", () => {
    const w = buildWindow("4w", NOW, "UTC");
    const t = weeklyTotals(sessions, w.weeks, "UTC", none);
    expect(t.get("2026-09-28")).toEqual({ sessions: 0, volume: 0, records: 0 });
    expect(t.get("2026-10-19")).toEqual({ sessions: 2, volume: 65 * 15 + 400, records: 2 });
    expect(weekOfSession(sessions[0], w.weeks, "UTC")!.key).toBe("2026-10-05");
  });

  it("separates measured bests from estimates", () => {
    const st = exerciseStats(sessions, BENCH);
    expect(st.heaviest).toMatchObject({ weight: 65, reps: 8 });
    expect(st.bestEstimate?.value).toBe(82.3);
    expect(st.latest?.session.id).toBe(S3);
  });
});

describe("terrain", () => {
  const opts = { seed: "user-1", start: new Date("2026-09-28T00:00:00Z"), end: NOW, cols: 40, rows: 24 };

  it("is deterministic", () => {
    const a = buildTerrain({ ...opts, sessions: toLandscapeSessions(sessions, none) });
    const b = buildTerrain({ ...opts, sessions: toLandscapeSessions(sessions, none) });
    expect(Array.from(a.field)).toEqual(Array.from(b.field));
    expect(a.landmarks.map((l) => [l.x, l.y])).toEqual(b.landmarks.map((l) => [l.x, l.y]));
  });

  it("differs per person and places sessions in time order", () => {
    const a = buildTerrain({ ...opts, sessions: toLandscapeSessions(sessions, none) });
    const c = buildTerrain({ ...opts, seed: "user-2", sessions: toLandscapeSessions(sessions, none) });
    expect(Array.from(a.field)).not.toEqual(Array.from(c.field));
    const xs = a.landmarks.map((l) => l.x);
    expect([...xs].sort((p, q) => p - q)).toEqual(xs);
  });

  it("raises terrain where training happened", () => {
    const t = buildTerrain({ ...opts, sessions: toLandscapeSessions(sessions, none) });
    const flat = buildTerrain({ ...opts, sessions: [] });
    const at = (tt: typeof t, l: (typeof t.landmarks)[number]) => tt.field[Math.round(l.y * 23) * 40 + Math.round(l.x * 39)];
    for (const l of t.landmarks) expect(at(t, l)).toBeGreaterThan(0.5);
    expect(flat.landmarks).toHaveLength(0);
  });
});
