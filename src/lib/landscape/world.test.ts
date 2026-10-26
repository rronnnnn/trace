import { describe, expect, it } from "vitest";
import { buildWorld, growthBetween, growthSentence, heightFor, sessionEffort, type WorldSession } from "./world";

const T0 = Date.parse("2026-01-05T18:00:00Z");
const day = 86400000;
const timeStart = new Date(T0 - day);
const timeEnd = new Date(T0 + 400 * day);

function sessions(key: string, label: string, count: number, from = 0, every = 7, volume = 5000): WorldSession[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${key}-${from + i}`,
    endedAt: new Date(T0 + (from + i) * every * day).toISOString(),
    templateKey: key,
    label,
    volume,
    sets: 15,
    records: 0,
  }));
}

const world = (history: WorldSession[], extra: Partial<Parameters<typeof buildWorld>[0]> = {}) =>
  buildWorld({ history, seed: "user-1", timeStart, timeEnd, cols: 120, rows: 77, ...extra });

const peak = (w: ReturnType<typeof world>, key: string) => w.regions.find((r) => r.key === key)?.peak ?? 0;
const maxField = (w: ReturnType<typeof world>) => w.field.reduce((m, v) => Math.max(m, v), 0);

describe("evolving world", () => {
  it("a new user starts with a gentle, low-relief world", () => {
    const empty = world([]);
    expect(empty.regions).toHaveLength(0);
    expect(maxField(empty)).toBeGreaterThan(0.02); // not flat: there is a landscape to grow
    expect(maxField(empty)).toBeLessThan(0.2);
    expect(empty.water.river.length).toBe(120); // the river is already there
  });

  it("is reproducible: the same history gives the same world", () => {
    const h = [...sessions("upper", "Upper", 6), ...sessions("lower", "Lower", 5, 0, 7)];
    const a = world(h);
    const b = world([...h].reverse());
    expect(Array.from(a.field)).toEqual(Array.from(b.field));
    expect(a.water).toEqual(b.water);
  });

  it("a workout grows its own region and leaves the others as they are", () => {
    const h = [...sessions("upper", "Upper", 6), ...sessions("lower", "Lower", 6)];
    const before = world(h);
    const after = world([...h, ...sessions("upper", "Upper", 1, 6)]);
    expect(peak(after, "upper")).toBeGreaterThan(peak(before, "upper"));
    expect(peak(after, "lower")).toBeCloseTo(peak(before, "lower"), 6);
    const change = growthBetween(before, after);
    expect(change.map((c) => c.key)).toEqual(["upper"]);
    expect(growthSentence(change, "workout")).toMatch(/^This workout: Upper (rose \d+%|grew)\.$/);
  });

  it("accumulates: the terrain only ever rises as sessions are added", () => {
    let prev = world(sessions("upper", "Upper", 1));
    for (let n = 2; n <= 12; n++) {
      const next = world(sessions("upper", "Upper", n));
      for (let k = 0; k < next.field.length; k++) expect(next.field[k]).toBeGreaterThanOrEqual(prev.field[k] - 1e-6);
      expect(peak(next, "upper")).toBeGreaterThan(peak(prev, "upper"));
      prev = next;
    }
  });

  it("time off never erases progress", () => {
    const h = sessions("upper", "Upper", 10);
    const atLast = world(h, { asOf: h.at(-1)!.endedAt });
    const monthsLater = world(h, { asOf: new Date(T0 + 300 * day).toISOString() });
    expect(Array.from(monthsLater.field)).toEqual(Array.from(atLast.field));
  });

  it("counts a session once, even if it appears twice", () => {
    const h = sessions("upper", "Upper", 5);
    expect(Array.from(world([...h, h[2]]).field)).toEqual(Array.from(world(h).field));
  });

  it("one enormous workout can't make a mountain", () => {
    const normal = world(sessions("upper", "Upper", 6));
    const huge = sessions("upper", "Upper", 6);
    huge[5] = { ...huge[5], volume: 500000, records: 20 };
    const withHuge = world(huge);
    expect(sessionEffort(500000, 5000, 20)).toBeLessThanOrEqual(2.6);
    expect(peak(withHuge, "upper")).toBeLessThan(peak(normal, "upper") * 1.35);
  });

  it("early progress shows; long-term growth slows but never stops", () => {
    expect(heightFor(1)).toBeGreaterThan(0.1);
    const step = (a: number, b: number) => heightFor(b) - heightFor(a);
    expect(step(0, 10)).toBeGreaterThan(step(100, 110));
    expect(step(300, 310)).toBeGreaterThan(0);
  });

  it("adding a routine never moves existing ranges", () => {
    const h = sessions("upper", "Upper", 8);
    const a = world(h);
    const b = world([...h, ...sessions("legs", "Legs", 3, 1, 9)]);
    for (const id of a.placed.keys()) expect(b.placed.get(id)).toEqual(a.placed.get(id));
  });

  it("the river keeps its course as the mountains grow", () => {
    const early = world([...sessions("upper", "Upper", 3), ...sessions("lower", "Lower", 3)]);
    const later = world([...sessions("upper", "Upper", 40, 0, 3), ...sessions("lower", "Lower", 40, 0, 3)]);
    const drift = early.water.river.reduce((m, [, y], i) => Math.max(m, Math.abs(y - later.water.river[i][1])), 0);
    expect(drift).toBeLessThan(0.02);
  });

  it("training more makes richer, taller terrain", () => {
    const month = world(sessions("upper", "Upper", 4));
    const year = world(sessions("upper", "Upper", 100, 0, 3));
    expect(maxField(year)).toBeGreaterThan(maxField(month) * 1.8);
  });
});
