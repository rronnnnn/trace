"use client";

import { useEffect, useRef, useState } from "react";
import { useNow } from "@/lib/use-now";
import { IconPause, IconPlay } from "@/components/icons";
import { formatClock } from "@/lib/format";
import { restRemainingMs, type WorkoutAction } from "@/lib/workout/reducer";
import type { ActiveWorkout } from "@/lib/workout/types";
import { cn } from "@/lib/utils";

const R = 15;
const C = 2 * Math.PI * R;

export function RestTimer({
  rest,
  defaultSeconds,
  dispatch,
  className,
}: {
  rest: ActiveWorkout["rest"];
  defaultSeconds: number;
  dispatch: (a: WorkoutAction) => void;
  className?: string;
}) {
  const running = rest.endsAt != null;
  const paused = rest.pausedRemaining != null;
  const now = useNow(250, running);
  // Before the first tick, treat a running rest as just started (keeps render pure).
  const remaining = now == null && running ? rest.duration * 1000 : restRemainingMs(rest, now ?? 0);
  const active = (running && remaining > 0) || paused;
  const [justFinished, setJustFinished] = useState(false);
  const wasActive = useRef(active);

  // When rest runs out: signal it (only if we watched it finish), then return to idle.
  // A rest that expired while the page was closed is cleared silently.
  useEffect(() => {
    if (running && !active) {
      if (wasActive.current) {
        setJustFinished(true);
        try {
          navigator.vibrate?.([120, 80, 120]);
        } catch {}
      }
      dispatch({ type: "rest.stop" });
    }
    wasActive.current = active;
  }, [active, running, dispatch]);

  useEffect(() => {
    if (!justFinished) return;
    const t = setTimeout(() => setJustFinished(false), 4000);
    return () => clearTimeout(t);
  }, [justFinished]);

  const progress = active && rest.duration > 0 ? remaining / (rest.duration * 1000) : 0;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors duration-300",
        justFinished ? "border-sage bg-sage-wash" : active ? "border-line-strong bg-surface" : "border-line bg-transparent",
        className,
      )}
      role="timer"
      aria-live="off"
    >
      <span className="sr-only" role="status" aria-live="polite">
        {justFinished ? "Rest complete" : ""}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] leading-none text-ink-3">
          {justFinished ? "Rest complete" : paused ? "Rest paused" : active ? "Rest" : "Rest timer"}
        </p>
        <p
          className={cn("num mt-1 text-[22px] font-medium leading-none tracking-tight", !active && "text-ink-3")}
          aria-label={`Rest ${formatClock(active ? remaining : defaultSeconds * 1000)}`}
        >
          {formatClock(active ? remaining : defaultSeconds * 1000)}
        </p>
      </div>

      {active ? (
        <svg width="36" height="36" viewBox="0 0 36 36" className="-rotate-90 shrink-0" aria-hidden>
          <circle cx="18" cy="18" r={R} fill="none" stroke="var(--line)" strokeWidth="2" />
          <circle
            cx="18"
            cy="18"
            r={R}
            fill="none"
            stroke={paused ? "var(--ink-3)" : "var(--sage-deep)"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress)}
            style={{ transition: running ? "stroke-dashoffset 250ms linear" : undefined }}
          />
        </svg>
      ) : null}

      <div className="flex items-center gap-0.5">
        {active ? (
          <>
            <TimerButton label="Subtract 15 seconds" onClick={() => dispatch({ type: "rest.adjust", deltaSeconds: -15, now: Date.now() })}>
              −15
            </TimerButton>
            <TimerButton label="Add 15 seconds" onClick={() => dispatch({ type: "rest.adjust", deltaSeconds: 15, now: Date.now() })}>
              +15
            </TimerButton>
            <TimerButton label={paused ? "Resume rest" : "Pause rest"} onClick={() => dispatch({ type: "rest.toggle", now: Date.now() })}>
              {paused ? <IconPlay /> : <IconPause />}
            </TimerButton>
            <TimerButton label="Skip rest" onClick={() => dispatch({ type: "rest.stop" })}>
              Skip
            </TimerButton>
          </>
        ) : (
          <TimerButton
            label={`Start ${Math.round(defaultSeconds / 60)} minute rest`}
            onClick={() => dispatch({ type: "rest.start", seconds: defaultSeconds, now: Date.now() })}
          >
            Start
          </TimerButton>
        )}
      </div>
    </div>
  );
}

function TimerButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="num flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-[13px] text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
    >
      {children}
    </button>
  );
}
