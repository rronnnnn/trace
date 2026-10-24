"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import { outbox } from "./storage";
import type { CompletionPayload } from "./types";

export type SubmitResult = { status: "saved"; id: string } | { status: "queued"; reason: string };

/** Errors that will never succeed on retry (validation, permissions) vs. transient ones. */
function isPermanent(code: string | undefined) {
  return code === "22023" || code === "42501" || code === "23503" || code === "23514" || code === "22P02";
}

/**
 * Sends a finished session to the server. The session is written to the outbox first,
 * so it survives a crash or a closed tab mid-request; it is removed only once the
 * server confirms. The RPC is idempotent on the session id, making retries safe.
 */
export async function submitSession(uid: string, payload: CompletionPayload): Promise<SubmitResult> {
  await outbox.enqueue(uid, payload);
  try {
    return await sendOne(uid, payload);
  } catch (e) {
    // Rejected while the workout is still open: the workout itself stays on the device to be
    // corrected, so the queued copy is dropped instead of being retried forever.
    if (e instanceof PermanentSyncError) await outbox.remove(uid, payload.id);
    throw e;
  }
}

async function sendOne(uid: string, payload: CompletionPayload): Promise<SubmitResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { status: "queued", reason: "You're offline." };
  }
  try {
    const { data, error } = await supabaseBrowser().rpc("complete_session", { payload: payload as unknown as Json });
    if (error) {
      const permanent = isPermanent(error.code);
      await outbox.markFailed(uid, payload.id, error.message, permanent);
      if (permanent) throw new PermanentSyncError(error.message);
      return { status: "queued", reason: error.message };
    }
    await outbox.remove(uid, payload.id);
    return { status: "saved", id: data };
  } catch (e) {
    if (e instanceof PermanentSyncError) throw e;
    const message = e instanceof Error ? e.message : "Network error";
    await outbox.markFailed(uid, payload.id, message);
    return { status: "queued", reason: message };
  }
}

export class PermanentSyncError extends Error {}

let flushing: Promise<number> | null = null;

/** Retries every queued session in order. Returns how many were saved. */
export function flushOutbox(uid: string): Promise<number> {
  flushing ??= (async () => {
    let saved = 0;
    try {
      // Oldest first so personal records are derived chronologically.
      const items = (await outbox.list(uid)).sort((a, b) => a.payload.ended_at.localeCompare(b.payload.ended_at));
      for (const item of items) {
        if (item.rejected) continue; // waiting for the user, see SyncAgent
        try {
          const result = await sendOne(uid, item.payload);
          if (result.status === "saved") saved++;
          else break; // still offline / server unavailable; try again later
        } catch {
          // Rejected for good: marked in the outbox and surfaced to the user instead of retried.
        }
      }
    } finally {
      flushing = null;
    }
    return saved;
  })();
  return flushing;
}
