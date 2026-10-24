"use client";

import { createStore, del, get, set, update } from "idb-keyval";
import type { ActiveWorkout, CompletionPayload, ExerciseRef } from "./types";

/**
 * Device persistence, keyed per user so shared devices never mix accounts.
 *  - active:<uid>     the workout in progress
 *  - outbox:<uid>     finished sessions not yet confirmed by the server
 *  - library:<uid>    cached exercise library for offline substitutions
 */
const store = typeof indexedDB === "undefined" ? undefined : createStore("trace", "kv");

export type OutboxItem = {
  payload: CompletionPayload;
  queuedAt: number;
  attempts: number;
  lastError: string | null;
  /** The server rejected it for good (validation/permissions); it is kept for the user, never retried. */
  rejected?: boolean;
};

export const activeWorkoutStore = {
  load: (uid: string) => (store ? get<ActiveWorkout>(`active:${uid}`, store) : Promise.resolve(undefined)),
  save: (w: ActiveWorkout) => (store ? set(`active:${w.ownerId}`, w, store) : Promise.resolve()),
  clear: (uid: string) => (store ? del(`active:${uid}`, store) : Promise.resolve()),
};

export const outbox = {
  list: async (uid: string) => (store ? ((await get<OutboxItem[]>(`outbox:${uid}`, store)) ?? []) : []),
  enqueue: (uid: string, payload: CompletionPayload) =>
    store
      ? update<OutboxItem[]>(
          `outbox:${uid}`,
          // The latest version of a session always wins: a re-finished workout must not sync stale sets.
          (items = []) => [
            ...items.filter((i) => i.payload.id !== payload.id),
            { payload, queuedAt: Date.now(), attempts: 0, lastError: null },
          ],
          store,
        )
      : Promise.resolve(),
  remove: (uid: string, id: string) =>
    store ? update<OutboxItem[]>(`outbox:${uid}`, (items = []) => items.filter((i) => i.payload.id !== id), store) : Promise.resolve(),
  markFailed: (uid: string, id: string, error: string, rejected = false) =>
    store
      ? update<OutboxItem[]>(
          `outbox:${uid}`,
          (items = []) => items.map((i) => (i.payload.id === id ? { ...i, attempts: i.attempts + 1, lastError: error, rejected } : i)),
          store,
        )
      : Promise.resolve(),
};

export const libraryCache = {
  load: (uid: string) => (store ? get<ExerciseRef[]>(`library:${uid}`, store) : Promise.resolve(undefined)),
  save: (uid: string, items: ExerciseRef[]) => (store ? set(`library:${uid}`, items, store) : Promise.resolve()),
};
