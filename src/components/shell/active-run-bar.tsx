"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IconArrowRight } from "@/components/icons";
import { activeTime, formatClockTime, formatKm, type RunState } from "@/lib/run/recorder";
import { useNow } from "@/lib/use-now";
import { activeRunStore } from "@/lib/workout/storage";

/**
 * The way back into a run being recorded, from anywhere in the app. Location isn't recorded
 * while away from the run screen, and the bar says so.
 */
export function ActiveRunBar({ uid }: { uid: string }) {
  const path = usePathname();
  const [run, setRun] = useState<RunState | null>(null);
  useEffect(() => {
    let alive = true;
    activeRunStore.load<RunState>(uid).then((r) => alive && setRun(r && r.ownerId === uid && r.status !== "finished" ? r : null));
    return () => {
      alive = false;
    };
  }, [uid, path]);
  const now = useNow(1000, Boolean(run));
  if (!run || path === "/run") return null;
  return (
    <Link
      href="/run"
      className="fixed inset-x-3 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] z-30 flex items-center justify-between gap-3 rounded-lg bg-ink px-4 py-3 text-paper shadow-lg md:bottom-6 md:left-auto md:right-6 md:w-[340px]"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{run.status === "paused" ? "Run paused" : "Run in progress"}</span>
        <span className="num block text-xs text-paper/65">
          {now ? formatClockTime(activeTime(run, now)) : "--:--"}
          {run.kind === "outdoor" ? ` · ${formatKm(run.distance)} km · route paused while you're here` : ""}
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-sm">
        Back to run <IconArrowRight />
      </span>
    </Link>
  );
}
