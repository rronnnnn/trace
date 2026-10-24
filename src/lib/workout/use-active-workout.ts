"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { workoutReducer, type WorkoutAction } from "./reducer";
import { activeWorkoutStore } from "./storage";
import type { ActiveWorkout } from "./types";

const channelName = "trace-active-workout";
const lsKey = (uid: string) => `trace:active:${uid}`;

function readLocal(uid: string): ActiveWorkout | undefined {
  try {
    const raw = localStorage.getItem(lsKey(uid));
    return raw ? (JSON.parse(raw) as ActiveWorkout) : undefined;
  } catch {
    return undefined;
  }
}

function writeLocal(uid: string, w: ActiveWorkout | null) {
  try {
    if (w) localStorage.setItem(lsKey(uid), JSON.stringify(w));
    else localStorage.removeItem(lsKey(uid));
  } catch {
    // storage full or blocked; IndexedDB copy still applies
  }
}

/** Loads the newest of the two on-device copies. */
export async function loadActiveWorkout(uid: string): Promise<ActiveWorkout | null> {
  const [idb, local] = await Promise.all([activeWorkoutStore.load(uid).catch(() => undefined), Promise.resolve(readLocal(uid))]);
  const newest = [idb, local].filter((w): w is ActiveWorkout => w?.version === 1).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return newest ?? null;
}

/** Persists synchronously to localStorage (survives an immediate refresh) and to IndexedDB. */
export async function persistActiveWorkout(uid: string, w: ActiveWorkout | null) {
  writeLocal(uid, w);
  if (w) await activeWorkoutStore.save(w);
  else await activeWorkoutStore.clear(uid);
  try {
    new BroadcastChannel(channelName).postMessage({ uid, at: Date.now() });
  } catch {}
}

export function useActiveWorkout(uid: string) {
  const [workout, setWorkout] = useState<ActiveWorkout | null>(null);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef<ActiveWorkout | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      loadActiveWorkout(uid).then((w) => {
        if (!alive) return;
        // ignore echoes of our own writes
        if (w && latest.current && w.updatedAt <= latest.current.updatedAt && w.id === latest.current.id) return;
        latest.current = w;
        setWorkout(w);
        setLoaded(true);
      });
    load();

    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(channelName);
      channel.onmessage = (e) => e.data?.uid === uid && load();
    } catch {}
    const onStorage = (e: StorageEvent) => e.key === lsKey(uid) && load();
    window.addEventListener("storage", onStorage);
    return () => {
      alive = false;
      channel?.close();
      window.removeEventListener("storage", onStorage);
    };
  }, [uid]);

  const dispatch = useCallback(
    (action: WorkoutAction) => {
      const current = latest.current;
      if (!current) return;
      const next = workoutReducer(current, action);
      if (next === current) return;
      latest.current = next;
      setWorkout(next);
      void persistActiveWorkout(uid, next);
    },
    [uid],
  );

  const replace = useCallback(
    async (w: ActiveWorkout | null) => {
      latest.current = w;
      setWorkout(w);
      await persistActiveWorkout(uid, w);
    },
    [uid],
  );

  return { workout, loaded, dispatch, replace };
}
