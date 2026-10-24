"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Confirm } from "@/components/ui/dialog";
import { outbox, type OutboxItem } from "@/lib/workout/storage";
import { flushOutbox } from "@/lib/workout/sync";

/**
 * Retries finished sessions that could not be saved (offline, server unavailable).
 * Runs on load, when the connection returns, when the tab regains focus, and every minute.
 * Sessions the server rejected outright are not retried; they are shown so the user can decide.
 */
export function SyncAgent({ uid }: { uid: string }) {
  const router = useRouter();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [online, setOnline] = useState(true);
  const [review, setReview] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const list = await outbox.list(uid);
      if (alive) setItems(list);
    };
    const run = async () => {
      setOnline(navigator.onLine);
      const saved = await flushOutbox(uid);
      await refresh();
      if (saved > 0) router.refresh();
    };
    run();
    const onOnline = () => run();
    const onOffline = () => setOnline(false);
    const onVisible = () => document.visibilityState === "visible" && run();
    const onQueued = () => refresh();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("trace:outbox", onQueued);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(run, 60_000);
    return () => {
      alive = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("trace:outbox", onQueued);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [uid, router]);

  const rejected = items.filter((i) => i.rejected);
  const pending = items.length - rejected.length;
  // An expired login fails every retry until the user signs in again; say so instead of "syncing…".
  const needsSignIn = items.some((i) => !i.rejected && /jwt|not authenticated|refresh token|401/i.test(i.lastError ?? ""));

  if (!items.length && online) return null;
  return (
    <>
      <div
        role="status"
        className="fixed left-1/2 top-3 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs text-ink-2 shadow-sm"
      >
        <span className="truncate">
          {rejected.length
            ? `${rejected.length} workout${rejected.length > 1 ? "s" : ""} couldn't be saved`
            : pending
              ? `${pending} workout${pending > 1 ? "s" : ""} saved on this device · ${
                  !online ? "will sync when you're back online" : needsSignIn ? "sign in again to sync" : "syncing…"
                }`
              : "Offline · changes are kept on this device"}
        </span>
        {rejected.length ? (
          <button type="button" onClick={() => setReview(true)} className="shrink-0 font-medium text-ink underline underline-offset-2">
            Review
          </button>
        ) : null}
      </div>
      <Confirm
        open={review}
        onOpenChange={setReview}
        title="A workout couldn't be saved"
        description={
          <div className="space-y-3">
            {rejected.map((i) => (
              <p key={i.payload.id}>
                <strong className="font-medium text-ink">{i.payload.template_name}</strong>{" "}
                <span className="num text-ink-3">({new Date(i.payload.ended_at).toLocaleDateString()})</span> was rejected by the server:{" "}
                <span className="text-clay">{i.lastError}</span>
              </p>
            ))}
            <p>It is kept on this device. Discarding it removes it permanently.</p>
          </div>
        }
        cancelLabel="Keep for now"
        confirmLabel="Discard"
        tone="danger"
        onConfirm={async () => {
          for (const i of rejected) await outbox.remove(uid, i.payload.id);
          setItems(await outbox.list(uid));
          setReview(false);
        }}
      />
    </>
  );
}
