// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { earnedLandmarks } from "@/lib/landscape/landmarks";
import type { WorldSession } from "@/lib/landscape/world";
import { AtlasView } from "./atlas-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = () => {};
  // no WebGL in jsdom: the view says so and the record still works
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(cleanup);

const T0 = Date.parse("2026-01-05T18:00:00Z");
const history: WorldSession[] = Array.from({ length: 26 }, (_, i) => ({
  id: `s-${String(i).padStart(3, "0")}`,
  endedAt: new Date(T0 + i * 7 * 86400000).toISOString(),
  templateKey: i % 2 ? "lower" : "upper",
  label: i % 2 ? "Lower" : "Upper",
  volume: 5000,
  sets: 15,
  records: 0,
  lifts: [{ exerciseId: "squat", name: "Back Squat", weight: 60 + i * 4, reps: 5 }],
}));
const landmarks = earnedLandmarks(history, { unit: "kg", timeZone: "UTC" });
const now = new Date(T0 + 190 * 86400000).toISOString();

const view = () =>
  render(
    <AtlasView history={history} landmarks={landmarks} seed="u" unit="kg" timeZone="UTC" trainingDays={[1, 3, 5]} now={now} initialAt={null} />,
  );

describe("AtlasView", () => {
  it("filters the record by kind and summits", () => {
    view();
    expect(screen.getByText("First workout")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Strength/ }));
    expect(screen.queryByText("First workout")).toBeNull();
    expect(screen.getByText("Back Squat, doubled")).toBeTruthy();
    expect(screen.getByText("Iron Tor")).toBeTruthy(); // the first 100 kg set is a summit, named by its place
    fireEvent.click(screen.getByRole("button", { name: /^Summits/ }));
    expect(screen.getByText("Quarter Peak")).toBeTruthy(); // 12 weeks unbroken: a summit, named once reached
  });

  it("opens an entry with its facts and links, and shows the world on the day it was earned", () => {
    view();
    expect(screen.getByRole("heading", { name: "Your world today" })).toBeTruthy();
    fireEvent.click(screen.getByText("25 workouts"));
    expect(screen.getByRole("link", { name: "The workout" }).getAttribute("href")).toBe("/history/s-024");
    expect(screen.getByRole("link", { name: "Show in landscape" }).getAttribute("href")).toBe("/landscape/explore?range=all&place=landmark%3Aworkouts-25");
    fireEvent.click(screen.getByRole("button", { name: "See your world that day" }));
    expect(screen.getByRole("heading", { name: /Your world on/ }).textContent).toContain("Jun 22, 2026");
    expect(screen.getByText(/25 workouts · 2 ranges/)).toBeTruthy();
  });
});
