import { describe, expect, it } from "vitest";
import { restSpans } from "./rest";
import { parseColor, shadeRelief, treePositions } from "./relief";
import { buildTerrain, type LandscapeSession } from "./terrain";

const start = new Date("2026-10-05T00:00:00Z"); // Monday
const end = new Date("2026-10-18T20:00:00Z"); // Sunday, two weeks later

describe("rest days", () => {
  it("are the open days of the plan without a logged session, grouped into runs", () => {
    // plan: Mon, Tue, Wed, Fri. Open: Thu, Sat, Sun.
    const spans = restSpans({ start, end, timeZone: "UTC", trainingDays: [1, 2, 3, 5], sessionEndedAts: [] });
    expect(spans.map((s) => [s.start, s.days])).toEqual([
      ["2026-10-08", 1],
      ["2026-10-10", 2],
      ["2026-10-15", 1],
      ["2026-10-17", 2],
    ]);
    expect(spans[1].label).toBe("2 rest days · Sat, Oct 10 – Sun, Oct 11");
    expect(spans[0].label).toBe("Rest day · Thu, Oct 8");
  });

  it("never turns a missed training day into water, and training on an open day removes it", () => {
    const spans = restSpans({
      start,
      end,
      timeZone: "UTC",
      trainingDays: [1, 2, 3, 5],
      sessionEndedAts: ["2026-10-10T09:00:00Z"], // trained on Saturday
    });
    expect(spans.find((s) => s.start === "2026-10-10")).toBeUndefined();
    expect(spans.find((s) => s.start === "2026-10-11")?.days).toBe(1);
    // Mondays (planned, nothing logged) are never rest
    expect(spans.some((s) => s.start === "2026-10-05" || s.start === "2026-10-12")).toBe(false);
  });

  it("without a plan, every day without a session rests; nothing counts after today", () => {
    const spans = restSpans({
      start,
      end: new Date("2026-10-07T12:00:00Z"),
      timeZone: "UTC",
      trainingDays: [],
      sessionEndedAts: ["2026-10-06T18:00:00Z"],
    });
    expect(spans.map((s) => [s.start, s.days])).toEqual([
      ["2026-10-05", 1],
      ["2026-10-07", 1],
    ]);
  });
});

const sessions: LandscapeSession[] = Array.from({ length: 8 }, (_, i) => ({
  id: `s${i}`,
  endedAt: new Date(start.getTime() + i * 1.7 * 86400000).toISOString(),
  templateKey: i % 2 ? "upper" : "lower",
  label: "x",
  volume: 4000 + i * 300,
  sets: 12,
  prCount: 0,
}));

function terrain(seed = "u1") {
  // single rest days (Thu) and weekends (Sat–Sun)
  const rest = restSpans({ start, end, timeZone: "UTC", trainingDays: [1, 2, 3, 5], sessionEndedAts: [] });
  return buildTerrain({ sessions, seed, start, end, cols: 80, rows: 50, aspect: 1.6, rest });
}

describe("water", () => {
  it("places one lake per rest span, in time order, deterministically", () => {
    const a = terrain();
    const b = terrain();
    expect(a.water).toEqual(b.water);
    expect(a.water.lakes.length).toBeGreaterThan(0);
    const xs = a.water.lakes.map((l) => l.x);
    expect([...xs].sort((p, q) => p - q)).toEqual(xs);
    expect(a.water.lakes.find((l) => l.span.days === 2)!.rx).toBeGreaterThan(a.water.lakes.find((l) => l.span.days === 1)!.rx);
  });

  it("runs the river through low ground, across the whole map", () => {
    const t = terrain();
    const { river } = t.water;
    expect(river[0][0]).toBe(0);
    expect(river.at(-1)![0]).toBe(1);
    const at = (x: number, y: number) => t.field[Math.round(y * (t.rows - 1)) * t.cols + Math.round(x * (t.cols - 1))];
    const riverMean = river.reduce((s, [x, y]) => s + at(x, y), 0) / river.length;
    const mapMean = t.field.reduce((a, b) => a + b, 0) / t.field.length;
    expect(riverMean).toBeLessThan(mapMean * 0.6);
  });

  it("keeps trees off the water", () => {
    const t = terrain();
    for (const [x, y] of treePositions(t, "u1", 0.02, 1.6)) {
      for (const l of t.water.lakes) expect(((x - l.x) / l.rx) ** 2 + ((y - l.y) / l.ry) ** 2).toBeGreaterThan(1);
    }
  });
});

describe("relief", () => {
  const palette = {
    low: [80, 80, 70] as [number, number, number],
    mid: [180, 175, 160] as [number, number, number],
    high: [250, 248, 240] as [number, number, number],
    vegetation: [150, 165, 120] as [number, number, number],
    shade: 0.9,
  };

  it("is deterministic and shades low ground darker than summits", () => {
    const t = terrain();
    const a = shadeRelief(t, palette);
    expect(Array.from(a)).toEqual(Array.from(shadeRelief(t, palette)));
    let lo = 0;
    let hi = 0;
    for (let k = 1; k < t.field.length; k++) {
      if (t.field[k] < t.field[lo]) lo = k;
      if (t.field[k] > t.field[hi]) hi = k;
    }
    const lum = (k: number) => a[k * 4] + a[k * 4 + 1] + a[k * 4 + 2];
    expect(lum(lo)).toBeLessThan(lum(hi));
    expect(a[3]).toBe(255);
  });

  it("reads colours from CSS tokens in either notation", () => {
    expect(parseColor(" #9e9984", [0, 0, 0])).toEqual([0x9e, 0x99, 0x84]);
    expect(parseColor("rgb(10, 20, 30)", [0, 0, 0])).toEqual([10, 20, 30]);
    expect(parseColor("oklch(0.5 0.1 120)", [1, 2, 3])).toEqual([1, 2, 3]);
  });
});
