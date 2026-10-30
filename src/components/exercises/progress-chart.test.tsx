// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ExerciseIndex, type IndexRow } from "@/app/(app)/exercises/exercise-index";
import { ProgressChart, type ProgressPoint } from "./progress-chart";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  push.mockReset();
});

const point = (at: string, value: number, extra: Partial<ProgressPoint> = {}): ProgressPoint => ({
  sessionId: `s-${at}`,
  at,
  value,
  e1rm: Math.round(value * 1.17 * 10) / 10,
  record: false,
  isSample: false,
  date: at.slice(5, 10),
  routine: "Push",
  sets: `${value} × 5`,
  ...extra,
});

const points = [
  point("2026-03-01T10:00:00Z", 70),
  point("2026-08-01T10:00:00Z", 77.5),
  point("2026-10-20T10:00:00Z", 85, { record: true }),
];

describe("ProgressChart", () => {
  it("steps through sessions with the arrow keys and opens one with Enter", async () => {
    render(<ProgressChart points={points} weighted unit="kg" now="2026-10-30T12:00:00Z" />);
    const chart = screen.getByRole("img", { name: /Top set per session, 3 sessions/ });
    chart.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("status").textContent).toContain("Top set: 85 kg");
    expect(screen.getByRole("status").textContent).toContain("Record");
    expect(screen.getByRole("status").textContent).toContain("Est. 1RM 99.4 kg");
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("status").textContent).toContain("Top set: 77.5 kg");
    await userEvent.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/history/s-2026-08-01T10:00:00Z");
  });

  it("offers only ranges shorter than the history, and filters to them", async () => {
    render(<ProgressChart points={points} weighted unit="kg" now="2026-10-30T12:00:00Z" />);
    const group = screen.getByRole("group", { name: "Time range" });
    expect([...group.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["3M", "6M", "All"]);
    fireEvent.click(screen.getByRole("button", { name: "3M" }));
    expect(screen.getByRole("img", { name: /2 sessions/ })).toBeTruthy();
  });

  it("labels bodyweight progress in reps with no estimate", () => {
    render(<ProgressChart points={points.map((p) => ({ ...p, e1rm: null }))} weighted={false} unit="kg" now="2026-10-30T12:00:00Z" />);
    expect(screen.getByRole("img", { name: /Most reps per session/ })).toBeTruthy();
    expect(screen.queryByText("Estimated 1RM")).toBeNull();
  });
});

describe("ExerciseIndex", () => {
  const row = (name: string, muscle: string, sessions: number): IndexRow => ({
    id: name,
    name,
    muscle,
    equipment: "barbell",
    weighted: true,
    custom: false,
    sessions,
    lastAt: sessions ? "2026-10-20T10:00:00Z" : null,
    best: sessions ? { value: 100, reps: 5 } : null,
    trend: null,
    spark: [],
    sample: false,
  });
  const rows = [row("Bench Press", "Chest", 4), row("Back Squat", "Quads", 2), row("Cable Chest Fly", "Chest", 0)];

  it("splits trained from not-yet-logged and filters by search and muscle", async () => {
    render(<ExerciseIndex rows={rows} unit="kg" timeZone="UTC" />);
    expect(screen.getByRole("heading", { name: "In your record" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Not logged yet" })).toBeTruthy();
    await userEvent.type(screen.getByRole("searchbox"), "squat");
    expect(screen.queryByText("Bench Press")).toBeNull();
    expect(screen.getByText("Back Squat")).toBeTruthy();
    await userEvent.clear(screen.getByRole("searchbox"));
    fireEvent.click(screen.getByRole("button", { name: "Chest" }));
    expect(screen.queryByText("Back Squat")).toBeNull();
    expect(screen.getByText("Cable Chest Fly")).toBeTruthy();
  });
});
