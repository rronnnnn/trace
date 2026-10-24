"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconArrowRight } from "@/components/icons";
import { formatElapsed } from "@/lib/format";
import { workoutStats } from "@/lib/workout/reducer";
import { useActiveWorkout } from "@/lib/workout/use-active-workout";
import { useNow } from "@/lib/use-now";

/** Persistent way back into a workout in progress, from anywhere in the app. */
export function ActiveWorkoutBar({ uid }: { uid: string }) {
  const path = usePathname();
  const { workout } = useActiveWorkout(uid);
  const now = useNow(1000, Boolean(workout));

  if (!workout || path === "/workout") return null;
  const { done, total } = workoutStats(workout);

  return (
    <Link
      href="/workout"
      className="fixed inset-x-3 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] z-30 flex items-center justify-between gap-3 rounded-lg bg-ink px-4 py-3 text-paper shadow-lg md:bottom-6 md:left-auto md:right-6 md:w-[340px]"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{workout.templateName}</span>
        <span className="num block text-xs text-paper/65">
          In progress · {now ? formatElapsed(now - new Date(workout.startedAt).getTime()) : "--:--"} · {done}/{total} sets
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-sm">
        Resume <IconArrowRight />
      </span>
    </Link>
  );
}
