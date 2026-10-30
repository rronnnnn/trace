"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import { runOutbox } from "@/lib/workout/storage";
import type { toRow } from "./recorder";

export type RunRow = ReturnType<typeof toRow>;
export type SaveResult = { status: "saved" } | { status: "queued"; reason: string } | { status: "rejected"; reason: string };

const permanent = (code: string | undefined) => code === "22023" || code === "42501" || code === "23514" || code === "22P02";

/**
 * Saves a finished run. It goes to the device's outbox first, so it survives a closed tab or a
 * lost connection mid-request, and leaves it only once the server has it. The id was made on the
 * device when the run started and the insert ignores an id it already has: retrying can never
 * create a second copy.
 */
export async function saveRun(uid: string, row: RunRow): Promise<SaveResult> {
  await runOutbox.enqueue(uid, row);
  return sendRun(uid, row);
}

async function sendRun(uid: string, row: RunRow): Promise<SaveResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { status: "queued", reason: "You're offline. The run is kept on this device and saves when you're back online." };
  try {
    const { error } = await supabaseBrowser()
      .from("runs")
      .upsert({ ...row, route: row.route as unknown as Json }, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      const p = permanent(error.code);
      await runOutbox.markFailed(uid, row.id, error.message, p);
      return p ? { status: "rejected", reason: error.message } : { status: "queued", reason: error.message };
    }
    await runOutbox.remove(uid, row.id);
    return { status: "saved" };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Network error";
    await runOutbox.markFailed(uid, row.id, reason);
    return { status: "queued", reason };
  }
}

/** Retries every queued run. Returns how many were saved. */
export async function flushRuns(uid: string) {
  let saved = 0;
  for (const item of await runOutbox.list<RunRow>(uid)) {
    if (item.rejected) continue;
    if ((await sendRun(uid, item.row)).status === "saved") saved++;
  }
  return saved;
}
