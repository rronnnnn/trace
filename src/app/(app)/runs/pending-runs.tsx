"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { flushRuns, type RunRow } from "@/lib/run/sync";
import { runOutbox } from "@/lib/workout/storage";

/** Runs finished offline wait on the device; this sends them, and says so while any remain. */
export function PendingRuns({ uid }: { uid: string }) {
  const router = useRouter();
  const [waiting, setWaiting] = useState<{ count: number; rejected: number }>({ count: 0, rejected: 0 });
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const saved = await flushRuns(uid).catch(() => 0);
      const left = await runOutbox.list<RunRow>(uid);
      if (!alive) return;
      setWaiting({ count: left.length, rejected: left.filter((i) => i.rejected).length });
      if (saved) router.refresh();
    };
    void run();
    window.addEventListener("online", run);
    return () => {
      alive = false;
      window.removeEventListener("online", run);
    };
  }, [uid, router]);
  if (!waiting.count) return null;
  return (
    <p role="status" className="mt-6 rounded-md bg-sunken px-4 py-3 text-[13px] text-ink-2">
      {waiting.count === 1 ? "One run is" : `${waiting.count} runs are`} saved on this device and will upload when you&apos;re online.
      {waiting.rejected ? ` ${waiting.rejected} couldn't be saved by the server and are kept here.` : ""}
    </p>
  );
}
