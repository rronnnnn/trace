// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveWorkout, CompletionPayload } from "./types";

const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({ rpc }) }));

const { loadActiveWorkout, persistActiveWorkout } = await import("./use-active-workout");
const { outbox, activeWorkoutStore } = await import("./storage");
const { submitSession, flushOutbox, PermanentSyncError } = await import("./sync");
const { workoutReducer, toCompletionPayload } = await import("./reducer");

const UID = "user-a";

function workout(updatedAt = 1): ActiveWorkout {
  return {
    version: 1,
    id: "w-1",
    ownerId: UID,
    templateId: null,
    templateName: "Upper",
    estMinutes: null,
    startedAt: "2026-10-24T10:00:00Z",
    currentIndex: 0,
    notes: "",
    exercises: [
      {
        key: "e1",
        exercise: {
          id: "bench",
          name: "Bench Press",
          primaryMuscle: "Chest",
          equipment: "barbell",
          measure: "weight_reps",
          variationOf: null,
        },
        substitutedFor: null,
        restSeconds: 90,
        notes: "",
        previous: null,
        sets: [{ key: "s1", weight: null, reps: null, targetWeight: null, targetReps: 5, completed: false, completedAt: null }],
      },
    ],
    rest: { duration: 0, endsAt: null, pausedRemaining: null },
    updatedAt,
  };
}

const payload = (id: string, ended = "2026-10-24T11:00:00Z", reps = 5): CompletionPayload => ({
  id,
  template_id: null,
  template_name: "Upper",
  started_at: "2026-10-24T10:00:00Z",
  ended_at: ended,
  notes: null,
  exercises: [
    {
      exercise_id: "bench",
      exercise_name: "Bench Press",
      substituted_for: null,
      notes: null,
      sets: [{ weight: 100, reps, target_weight: null, target_reps: 5, completed: true, completed_at: null }],
    },
  ],
});

const setOnline = (v: boolean) => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => v });

beforeEach(async () => {
  rpc.mockReset();
  setOnline(true);
  localStorage.clear();
  await activeWorkoutStore.clear(UID);
  for (const i of await outbox.list(UID)) await outbox.remove(UID, i.payload.id);
});

describe("refresh recovery", () => {
  it("restores a logged set after a reload", async () => {
    const two = workoutReducer(workout(), { type: "set.add", exerciseKey: "e1", key: "s2" });
    const w = workoutReducer(two, { type: "set.update", exerciseKey: "e1", setKey: "s1", patch: { weight: 100, reps: 5 } });
    const logged = workoutReducer(w, { type: "set.toggle", exerciseKey: "e1", setKey: "s1", now: Date.parse("2026-10-24T10:05:00Z") });
    await persistActiveWorkout(UID, logged);
    const restored = await loadActiveWorkout(UID);
    expect(restored?.exercises[0].sets[0]).toMatchObject({ weight: 100, reps: 5, completed: true });
    expect(restored?.exercises[0].sets[1]).toMatchObject({ completed: false });
    expect(restored?.rest.endsAt).toBe(Date.parse("2026-10-24T10:05:00Z") + 90_000);
  });

  it("survives a refresh before the IndexedDB write lands (localStorage copy is synchronous)", async () => {
    await activeWorkoutStore.save(workout(1)); // stale IDB copy
    localStorage.setItem(`trace:active:${UID}`, JSON.stringify({ ...workout(2), notes: "newest" }));
    expect((await loadActiveWorkout(UID))?.notes).toBe("newest");
  });

  it("falls back to IndexedDB when localStorage is corrupt or unavailable", async () => {
    await activeWorkoutStore.save({ ...workout(5), notes: "from idb" });
    localStorage.setItem(`trace:active:${UID}`, "{not json");
    expect((await loadActiveWorkout(UID))?.notes).toBe("from idb");
  });

  it("ignores data from another account and unknown versions", async () => {
    await persistActiveWorkout("user-b", { ...workout(), ownerId: "user-b" });
    expect(await loadActiveWorkout(UID)).toBeNull();
    localStorage.setItem(`trace:active:${UID}`, JSON.stringify({ ...workout(9), version: 2 }));
    expect(await loadActiveWorkout(UID)).toBeNull();
  });

  it("clears both copies when a workout is finished or discarded", async () => {
    await persistActiveWorkout(UID, workout());
    await persistActiveWorkout(UID, null);
    expect(await loadActiveWorkout(UID)).toBeNull();
    expect(localStorage.getItem(`trace:active:${UID}`)).toBeNull();
  });
});

describe("completion and the offline outbox", () => {
  it("saves online and leaves nothing queued", async () => {
    rpc.mockResolvedValue({ data: "s-1", error: null });
    await expect(submitSession(UID, payload("s-1"))).resolves.toEqual({ status: "saved", id: "s-1" });
    expect(rpc).toHaveBeenCalledWith("complete_session", { payload: payload("s-1") });
    expect(await outbox.list(UID)).toEqual([]);
  });

  it("queues offline without calling the server, then syncs on reconnect", async () => {
    setOnline(false);
    expect((await submitSession(UID, payload("s-1"))).status).toBe("queued");
    expect(rpc).not.toHaveBeenCalled();
    setOnline(true);
    rpc.mockResolvedValue({ data: "s-1", error: null });
    expect(await flushOutbox(UID)).toBe(1);
    expect(await outbox.list(UID)).toEqual([]);
  });

  it("keeps the session queued on network failure or server errors", async () => {
    rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect((await submitSession(UID, payload("s-1"))).status).toBe("queued");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST301", message: "JWT expired" } });
    expect(await flushOutbox(UID)).toBe(0);
    expect((await outbox.list(UID))[0]).toMatchObject({ attempts: 2, lastError: "JWT expired" });
  });

  it("syncs oldest first and stops at the first transient failure", async () => {
    setOnline(false);
    await submitSession(UID, payload("late", "2026-10-24T12:00:00Z"));
    await submitSession(UID, payload("early", "2026-10-20T12:00:00Z"));
    setOnline(true);
    rpc
      .mockResolvedValueOnce({ data: "early", error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "", message: "Failed to fetch" } });
    expect(await flushOutbox(UID)).toBe(1);
    expect(rpc.mock.calls[0][1].payload.id).toBe("early");
    expect((await outbox.list(UID)).map((i) => i.payload.id)).toEqual(["late"]);
  });

  it("re-finishing a workout replaces its queued copy (never syncs stale sets)", async () => {
    setOnline(false);
    await submitSession(UID, payload("s-1", undefined, 5));
    await submitSession(UID, payload("s-1", undefined, 8));
    const items = await outbox.list(UID);
    expect(items).toHaveLength(1);
    expect(items[0].payload.exercises[0].sets[0].reps).toBe(8);
  });

  it("a rejected workout is reported, not retried forever", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "violates check constraint" } });
    await expect(submitSession(UID, payload("s-1"))).rejects.toBeInstanceOf(PermanentSyncError);
    // still open on the device for the user to correct, so nothing lingers in the outbox
    expect(await outbox.list(UID)).toEqual([]);

    // rejected during a background sync: kept, flagged, and skipped by later syncs
    setOnline(false);
    await submitSession(UID, payload("s-2"));
    setOnline(true);
    await flushOutbox(UID);
    await flushOutbox(UID);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect((await outbox.list(UID))[0]).toMatchObject({ rejected: true, lastError: "violates check constraint" });
  });

  it("builds the payload the server expects from a logged workout", () => {
    let w = workoutReducer(workout(), { type: "set.update", exerciseKey: "e1", setKey: "s1", patch: { weight: 100 } });
    w = workoutReducer(w, { type: "set.toggle", exerciseKey: "e1", setKey: "s1", now: 0 });
    const p = toCompletionPayload(w, new Date("2026-10-24T11:00:00Z"));
    expect(p.exercises[0].sets[0]).toMatchObject({ weight: 100, reps: 5, completed: true, target_reps: 5 });
  });
});
