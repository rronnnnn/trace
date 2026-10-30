// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunRecorder } from "./run-recorder";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/run/sync", () => ({ flushRuns: vi.fn(async () => 0), saveRun: vi.fn(async () => ({ status: "saved" })) }));

type Success = (p: GeolocationPosition) => void;
type Failure = (e: GeolocationPositionError) => void;
let onFix: Success | null = null;
let onError: Failure | null = null;
const watchPosition = vi.fn<(ok: Success, err: Failure, opts?: PositionOptions) => number>((ok, err) => {
  onFix = ok;
  onError = err;
  return 1;
});

beforeEach(() => {
  onFix = onError = null;
  watchPosition.mockClear();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition, clearWatch: vi.fn() } });
});
afterEach(cleanup);

const M_PER_DEG = 111194.9;
const position = (metersNorth: number, t: number, accuracy = 5) =>
  ({ timestamp: t, coords: { latitude: 52 + metersNorth / M_PER_DEG, longitude: 13, accuracy, altitude: null, altitudeAccuracy: null } }) as unknown as GeolocationPosition;

async function ready() {
  render(<RunRecorder uid="u1" />);
  return screen.findByRole("button", { name: "Start outdoor run" });
}

describe("RunRecorder", () => {
  it("asks for location only when an outdoor run starts", async () => {
    const start = await ready();
    expect(watchPosition).not.toHaveBeenCalled();
    fireEvent.click(start);
    expect(watchPosition).toHaveBeenCalledTimes(1);
    expect(watchPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true });
  });

  it("says plainly when location is refused, and keeps the time running", async () => {
    fireEvent.click(await ready());
    act(() => onError!({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: "" } as GeolocationPositionError));
    expect(screen.getByRole("alert").textContent).toContain("Location is off for TRACE");
    expect(screen.getByText("Location off")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("measures distance from good fixes, ignores a wild one, pauses and resumes", async () => {
    fireEvent.click(await ready());
    const t = Date.now();
    act(() => onFix!(position(0, t)));
    act(() => onFix!(position(15, t + 5000)));
    act(() => onFix!(position(2000, t + 6000))); // a GPS jump
    act(() => onFix!(position(30, t + 10000)));
    expect(screen.getByText("0.03")).toBeTruthy();
    expect(screen.getByText(/GPS ±5 m/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByText(/Paused/)).toBeTruthy();
    act(() => onFix!(position(500, t + 20000))); // while paused: not recorded
    expect(screen.getByText("0.03")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("discarding asks first, and keeps the run if you change your mind", async () => {
    fireEvent.click(await ready());
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard run" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it("a treadmill run asks for its distance before saving", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Start treadmill run" }));
    expect(watchPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    fireEvent.click(screen.getByRole("button", { name: "Save run" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Add the distance");
  });
});
