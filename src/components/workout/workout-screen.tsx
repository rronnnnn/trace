"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowLeft, IconArrowRight, IconCheck, IconMore, IconNote, IconPlus, IconSwap } from "@/components/icons";
import { Button, buttonClass } from "@/components/ui/button";
import { Confirm, Sheet } from "@/components/ui/dialog";
import { formatElapsed, formatShortDate, formatVolume, formatWeight, plural } from "@/lib/format";
import { suggestedFor, toCompletionPayload, workoutStats, type WorkoutAction } from "@/lib/workout/reducer";
import { fetchPreviousPerformance, newActiveExercise } from "@/lib/workout/start";
import { outbox } from "@/lib/workout/storage";
import { PermanentSyncError, submitSession } from "@/lib/workout/sync";
import type { ActiveExercise, ActiveWorkout, ExerciseRef } from "@/lib/workout/types";
import { useActiveWorkout } from "@/lib/workout/use-active-workout";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { ExercisePicker } from "./exercise-picker";
import { NumberInput } from "./number-input";
import { RestTimer } from "./rest-timer";

export function WorkoutScreen({ uid, unit }: { uid: string; unit: string }) {
  const { workout, loaded, dispatch, replace } = useActiveWorkout(uid);
  // Finished while offline: kept in the outbox; shown here because navigating needs the network.
  const [queued, setQueued] = useState<{ name: string; sets: number; volume: number } | null>(null);
  useWakeLock(Boolean(workout));

  if (queued) return <QueuedSummary uid={uid} unit={unit} summary={queued} />;

  if (!loaded) {
    return (
      <main className="mx-auto max-w-[1080px] px-5 pt-10 sm:px-8 lg:px-12" aria-busy>
        <div className="h-6 w-40 animate-pulse rounded bg-sunken" />
        <div className="mt-6 h-72 animate-pulse rounded-lg bg-sunken/70" />
      </main>
    );
  }

  if (!workout) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-start px-6 pt-20 sm:pt-28">
        <p className="eyebrow">Train</p>
        <h1 className="mt-3 font-serif text-[32px] leading-tight">Nothing in progress.</h1>
        <p className="mt-2 text-ink-2">Start a routine from Today or Train. Your sets are saved on this device as you log them.</p>
        <div className="mt-8 flex gap-3">
          <Link href="/" className={buttonClass({ size: "lg" })}>
            Go to Today
          </Link>
          <Link href="/train" className={buttonClass({ variant: "secondary", size: "lg" })}>
            Choose a routine
          </Link>
        </div>
      </main>
    );
  }

  return (
    <ActiveWorkoutView
      key={workout.id}
      uid={uid}
      unit={unit}
      workout={workout}
      dispatch={dispatch}
      replace={replace}
      onQueued={setQueued}
    />
  );
}

/** Shown after finishing offline: the session waits in the outbox and syncs on reconnect. */
function QueuedSummary({ uid, unit, summary }: { uid: string; unit: string; summary: { name: string; sets: number; volume: number } }) {
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    if (synced) return;
    const check = async () => setSynced((await outbox.list(uid)).length === 0);
    const t = setInterval(check, 2000);
    window.addEventListener("online", check);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", check);
    };
  }, [uid, synced]);

  return (
    <main className="mx-auto flex max-w-md flex-col items-start px-6 pt-20 sm:pt-28" role="status">
      <p className="eyebrow">{synced ? "Saved to your record" : "Saved on this device"}</p>
      <h1 className="mt-3 font-serif text-[32px] leading-tight">{summary.name}</h1>
      <p className="num mt-2 text-ink-2">
        {plural(summary.sets, "set")} · {formatVolume(summary.volume, unit)}
      </p>
      <p className="mt-6 text-sm text-ink-2">
        {synced
          ? "You're back online and this workout is now in your history."
          : "You're offline, so this workout is waiting on this device. It will be added to your history automatically when the connection returns. Nothing is lost if you close the app."}
      </p>
      <Link href={synced ? "/history" : "/"} className={cn(buttonClass({ size: "lg" }), "mt-8")}>
        {synced ? "View history" : "Go to Today"}
      </Link>
    </main>
  );
}

function ActiveWorkoutView({
  uid,
  unit,
  workout,
  dispatch,
  replace,
  onQueued,
}: {
  uid: string;
  unit: string;
  workout: ActiveWorkout;
  dispatch: (a: WorkoutAction) => void;
  replace: (w: ActiveWorkout | null) => Promise<void>;
  onQueued: (summary: { name: string; sets: number; volume: number }) => void;
}) {
  const router = useRouter();
  const now = useNow(1000);
  // Keyboard flow: logging the last set of an exercise hands focus to the next panel.
  const carryFocus = useRef(false);
  const focusHandoff = useMemo(
    () => ({
      request: (v: boolean) => {
        carryFocus.current = v;
      },
      consume: () => {
        const v = carryFocus.current;
        carryFocus.current = false;
        return v;
      },
    }),
    [],
  );
  const [finishOpen, setFinishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const stats = workoutStats(workout);
  const current = workout.exercises[workout.currentIndex];
  const isLast = workout.currentIndex >= workout.exercises.length - 1;

  async function finish() {
    setSaving(true);
    setSaveError(null);
    const payload = toCompletionPayload(workout, new Date());
    try {
      const result = await submitSession(uid, payload);
      window.dispatchEvent(new Event("trace:outbox"));
      if (result.status === "queued") {
        onQueued({ name: workout.templateName, sets: stats.done, volume: stats.volume });
        await replace(null);
        return;
      }
      await replace(null);
      router.push(`/history/${result.id}?completed=1`);
      router.refresh();
    } catch (e) {
      setSaving(false);
      setSaveError(
        e instanceof PermanentSyncError
          ? `The server rejected this workout: ${e.message}`
          : "Something went wrong while saving. Your workout is still here.",
      );
    }
  }

  async function discard() {
    await replace(null);
    router.push("/");
  }

  async function addExercise(e: ExerciseRef) {
    setAddOpen(false);
    const previous = await fetchPreviousPerformance([e.id]).catch(() => new Map());
    dispatch({ type: "exercise.add", exercise: newActiveExercise(e, previous.get(e.id) ?? null) });
  }

  return (
    <main className="mx-auto w-full max-w-[1080px] px-4 pb-40 pt-5 sm:px-8 md:pb-16 md:pt-8 lg:px-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
          <IconArrowLeft /> Today
        </Link>
        <p className="num text-[13px] text-ink-3" aria-label="Elapsed time">
          {now ? formatElapsed(now - new Date(workout.startedAt).getTime()) : "--:--"}
        </p>
      </div>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-[28px] leading-tight tracking-[-0.01em] sm:text-[34px]">{workout.templateName}</h1>
          <p className="num mt-1 text-sm text-ink-3">
            {stats.done} of {stats.total} sets · {formatVolume(stats.volume, unit)}
          </p>
        </div>
        <RestTimer rest={workout.rest} defaultSeconds={current?.restSeconds ?? 120} dispatch={dispatch} className="w-full sm:w-auto" />
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          {/* Mobile exercise stepper */}
          {workout.exercises.length > 1 ? (
            <nav
              aria-label="Exercises"
              className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden"
            >
              {workout.exercises.map((e, i) => {
                const done = e.sets.length > 0 && e.sets.every((s) => s.completed);
                return (
                  <button
                    key={e.key}
                    type="button"
                    onClick={() => dispatch({ type: "exercise.focus", index: i })}
                    aria-current={i === workout.currentIndex ? "step" : undefined}
                    className={cn(
                      "num flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors",
                      i === workout.currentIndex
                        ? "border-ink bg-ink text-paper"
                        : done
                          ? "border-sage-soft bg-sage-wash text-sage-deep"
                          : "border-line text-ink-2",
                    )}
                  >
                    {done ? <IconCheck width={11} height={11} /> : null}
                    {i + 1}. {e.exercise.name}
                  </button>
                );
              })}
            </nav>
          ) : null}

          {current ? (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={current.key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                <ExercisePanel
                  uid={uid}
                  unit={unit}
                  index={workout.currentIndex}
                  exercise={current}
                  dispatch={dispatch}
                  onDone={() => (isLast ? setFinishOpen(true) : dispatch({ type: "exercise.focus", index: workout.currentIndex + 1 }))}
                  excludeIds={workout.exercises.map((e) => e.exercise.id)}
                  focusHandoff={focusHandoff}
                  count={workout.exercises.length}
                />
              </motion.div>
            </AnimatePresence>
          ) : (
            <div className="rounded-lg border border-dashed border-line-strong px-6 py-12 text-center">
              <p className="font-serif text-[22px]">An empty session</p>
              <p className="mt-1 text-sm text-ink-3">Add the first exercise to start logging.</p>
              <Button className="mt-6" onClick={() => setAddOpen(true)}>
                <IconPlus /> Add exercise
              </Button>
            </div>
          )}

          {/* Primary actions */}
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 backdrop-blur md:static md:mt-6 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
            <div className="mx-auto flex max-w-[1080px] gap-2">
              {current && !isLast ? (
                <Button size="lg" className="flex-1" onClick={() => dispatch({ type: "exercise.focus", index: workout.currentIndex + 1 })}>
                  Next exercise <IconArrowRight />
                </Button>
              ) : (
                <Button size="lg" className="flex-1" onClick={() => setFinishOpen(true)} disabled={stats.done === 0}>
                  Finish workout
                </Button>
              )}
              <EndMenu
                onFinish={() => setFinishOpen(true)}
                onDiscard={() => setDiscardOpen(true)}
                onAdd={() => setAddOpen(true)}
                canFinish={stats.done > 0}
              />
            </div>
          </div>
        </div>

        {/* Desktop overview */}
        <aside className="hidden lg:block" aria-label="Workout overview">
          <p className="eyebrow">Exercises</p>
          <ol className="mt-3 border-t border-line">
            {workout.exercises.map((e, i) => {
              const done = e.sets.filter((s) => s.completed).length;
              const active = i === workout.currentIndex;
              return (
                <li key={e.key} className="border-b border-line">
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "exercise.focus", index: i })}
                    aria-current={active ? "step" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 py-3 text-left transition-colors",
                      active ? "text-ink" : "text-ink-2 hover:text-ink",
                    )}
                  >
                    <span
                      className={cn(
                        "num flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px]",
                        done === e.sets.length && e.sets.length
                          ? "border-sage-deep bg-sage-deep text-paper"
                          : active
                            ? "border-ink"
                            : "border-line-strong",
                      )}
                    >
                      {done === e.sets.length && e.sets.length ? <IconCheck width={11} height={11} /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-[14px]", active && "font-medium")}>{e.exercise.name}</span>
                      <span className="num block text-xs text-ink-3">
                        {done}/{e.sets.length} sets
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="mt-3 flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink"
          >
            <IconPlus /> Add exercise
          </button>
          <p className="mt-10 text-xs leading-relaxed text-ink-3">
            Saved on this device as you go. <kbd className="rounded border border-line px-1">Enter</kbd> logs a set and moves on;{" "}
            <kbd className="rounded border border-line px-1">↑</kbd> <kbd className="rounded border border-line px-1">↓</kbd> move between
            sets.
          </p>
        </aside>
      </div>

      <ExercisePicker
        uid={uid}
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add exercise"
        excludeIds={workout.exercises.map((e) => e.exercise.id)}
        onPick={addExercise}
      />

      <Confirm
        open={finishOpen}
        onOpenChange={(v) => !saving && setFinishOpen(v)}
        title="Finish workout?"
        confirmLabel="Save workout"
        busy={saving}
        onConfirm={finish}
        description={
          <div>
            <dl className="num mt-2 grid grid-cols-3 gap-3 border-y border-line py-4 text-ink">
              <Stat label="Duration" value={now ? formatElapsed(now - new Date(workout.startedAt).getTime()) : "—"} />
              <Stat label="Sets" value={`${stats.done}/${stats.total}`} />
              <Stat label="Volume" value={formatVolume(stats.volume, unit)} />
            </dl>
            {stats.done < stats.total ? (
              <p className="mt-3 text-[13px] text-ink-3">
                {stats.total - stats.done} unchecked set{stats.total - stats.done > 1 ? "s" : ""} will be recorded as skipped.
              </p>
            ) : null}
          </div>
        }
      >
        <label className="mt-4 block">
          <span className="text-[13px] text-ink-2">Session notes</span>
          <textarea
            value={workout.notes}
            onChange={(e) => dispatch({ type: "workout.notes", notes: e.target.value })}
            rows={3}
            maxLength={2000}
            placeholder="How did it feel? Anything to remember next time?"
            className="mt-1.5 w-full resize-none rounded-md border border-line-strong bg-white px-3 py-2 text-[16px] placeholder:text-ink-3 sm:text-sm focus:border-ink-2 focus:outline-none"
          />
        </label>
        {saveError ? (
          <p role="alert" className="mt-3 text-sm text-clay">
            {saveError}
          </p>
        ) : null}
      </Confirm>

      <Confirm
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard this workout?"
        description={`${stats.done} logged set${stats.done === 1 ? "" : "s"} will be deleted from this device. Nothing will be added to your history.`}
        confirmLabel="Discard workout"
        cancelLabel="Keep training"
        tone="danger"
        onConfirm={discard}
      />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-medium">{value}</dd>
    </div>
  );
}

function EndMenu({
  onFinish,
  onDiscard,
  onAdd,
  canFinish,
}: {
  onFinish: () => void;
  onDiscard: () => void;
  onAdd: () => void;
  canFinish: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="lg" onClick={() => setOpen(true)} className="md:min-w-36">
        End workout
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="End workout">
        <div className="flex flex-col gap-2 p-5">
          <Button
            size="lg"
            disabled={!canFinish}
            onClick={() => {
              setOpen(false);
              onFinish();
            }}
          >
            Finish & save
          </Button>
          {!canFinish ? <p className="-mt-1 text-center text-xs text-ink-3">Log at least one set to save this workout.</p> : null}
          <Button
            variant="secondary"
            size="lg"
            onClick={() => {
              setOpen(false);
              onAdd();
            }}
          >
            <IconPlus /> Add an exercise
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="text-clay hover:bg-clay-soft hover:text-clay"
            onClick={() => {
              setOpen(false);
              onDiscard();
            }}
          >
            Discard workout
          </Button>
        </div>
      </Sheet>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ExercisePanel({
  uid,
  unit,
  index,
  exercise,
  dispatch,
  onDone,
  excludeIds,
  focusHandoff,
  count,
}: {
  uid: string;
  unit: string;
  index: number;
  count: number;
  exercise: ActiveExercise;
  dispatch: (a: WorkoutAction) => void;
  onDone: () => void;
  excludeIds: string[];
  /** Set by the keyboard flow; the next panel mounts fresh (keyed animation) and consumes it. */
  focusHandoff: { request: (v: boolean) => void; consume: () => boolean };
}) {
  const [swapOpen, setSwapOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const weighted = exercise.exercise.measure === "weight_reps";
  const prev = exercise.previous;
  const target = exercise.sets.find((s) => s.targetReps != null);

  const reg = (key: string) => (el: HTMLInputElement | null) => {
    if (el) inputs.current.set(key, el);
    else inputs.current.delete(key);
  };
  const focus = (key: string) => requestAnimationFrame(() => inputs.current.get(key)?.focus());
  const firstField = weighted ? "w" : "r";

  // Continue the keyboard flow into this exercise when it was reached by logging the previous one.
  useEffect(() => {
    if (!focusHandoff.consume()) return;
    const open = exercise.sets.find((s) => !s.completed);
    if (open) focus(`${open.key}:${firstField}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKey = useCallback(
    (setIndex: number, field: "w" | "r") => (e: React.KeyboardEvent<HTMLInputElement>) => {
      const set = exercise.sets[setIndex];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const nextSet = exercise.sets[setIndex + (e.key === "ArrowDown" ? 1 : -1)];
        if (nextSet) focus(`${nextSet.key}:${field}`);
        return;
      }
      if (e.key === "Escape") return e.currentTarget.blur();
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (field === "w") return focus(`${set.key}:r`);
      if (!set.completed) dispatch({ type: "set.toggle", exerciseKey: exercise.key, setKey: set.key, now: Date.now() });
      const nextOpen = exercise.sets.slice(setIndex + 1).find((s) => !s.completed);
      if (nextOpen) focus(`${nextOpen.key}:${firstField}`);
      else {
        // Only the focused exercise auto-advances, and never past the last one.
        focusHandoff.request(exercise.sets.every((s, k) => k === setIndex || s.completed));
        e.currentTarget.blur();
      }
    },
    [exercise, dispatch, firstField, focusHandoff],
  );

  async function substitute(e: ExerciseRef) {
    setSwapOpen(false);
    const previous = await fetchPreviousPerformance([e.id]).catch(() => new Map());
    dispatch({ type: "exercise.substitute", exerciseKey: exercise.key, exercise: e, previous: previous.get(e.id) ?? null });
  }

  const allDone = exercise.sets.length > 0 && exercise.sets.every((s) => s.completed);
  const nextSetKey = exercise.sets.find((s) => !s.completed)?.key;

  return (
    <section aria-labelledby={`ex-${exercise.key}`} className="border-t border-ink/80">
      {/* Exercise header */}
      <div className="flex items-start gap-4 pb-5 pt-5">
        <div className="min-w-0 flex-1">
          <p className="eyebrow num">
            Exercise {index + 1} of {count}
            {exercise.substitutedFor ? (
              <span className="normal-case tracking-normal"> · in place of {exercise.substitutedFor.name}</span>
            ) : null}
          </p>
          <h2 id={`ex-${exercise.key}`} className="mt-2 font-serif text-[28px] leading-[1.1] tracking-[-0.01em] sm:text-[32px]">
            {exercise.exercise.name}
          </h2>
          <p className="num mt-1.5 text-[13px] text-ink-3">
            <span className="capitalize">{exercise.exercise.primaryMuscle}</span> ·{" "}
            <span className="capitalize">{exercise.exercise.equipment}</span>
            {target ? (
              <>
                {" · "}
                <span className="text-ink-2">
                  Target {exercise.sets.length} × {target.targetReps}
                  {target.targetWeight ? ` @ ${formatWeight(target.targetWeight)} ${unit}` : ""}
                </span>
              </>
            ) : null}
          </p>
          <p className="num mt-3 text-[13px] text-ink-2">
            {prev ? (
              <>
                <span className="text-ink-3">Last time, {formatShortDate(prev.date)} · </span>
                {prev.sets.map((s) => (weighted ? `${formatWeight(s.weight)} × ${s.reps}` : `${s.reps}`)).join("   ")}
              </>
            ) : (
              <span className="text-ink-3">First time logging this exercise. Today sets your baseline.</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={`More options for ${exercise.exercise.name}`}
          className="-mr-2 flex size-10 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
        >
          <IconMore />
        </button>
      </div>

      {/* Sets */}
      <div role="table" aria-label={`${exercise.exercise.name} sets`}>
        <div
          role="row"
          className="grid grid-cols-[1.75rem_minmax(0,1fr)_5.25rem_4.5rem_2.75rem] items-center gap-1 border-t border-line py-2 text-[11px] uppercase tracking-[0.06em] text-ink-3 sm:grid-cols-[3rem_9rem_7rem_6rem_minmax(0,1fr)] sm:px-5"
        >
          <span role="columnheader">Set</span>
          <span role="columnheader">Previous</span>
          <span role="columnheader" className="text-center">
            {weighted ? unit : "Load"}
          </span>
          <span role="columnheader" className="text-center">
            Reps
          </span>
          <span role="columnheader" className="sr-only">
            Done
          </span>
        </div>
        <ul>
          <AnimatePresence initial={false}>
            {exercise.sets.map((s, i) => {
              const suggestion = suggestedFor(exercise, i);
              const p = prev?.sets[i];
              const isNext = s.key === nextSetKey;
              return (
                <motion.li
                  key={s.key}
                  role="row"
                  layout="position"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className={cn(
                    "group grid grid-cols-[1.75rem_minmax(0,1fr)_5.25rem_4.5rem_2.75rem] items-center gap-1 border-t border-line py-1.5 transition-colors duration-200 sm:grid-cols-[3rem_9rem_7rem_6rem_minmax(0,1fr)] sm:px-5",
                    s.completed ? "bg-sage-wash/60" : isNext ? "bg-surface" : "",
                  )}
                >
                  <span
                    role="cell"
                    className={cn("num relative flex items-center pl-1 text-[14px]", isNext ? "font-medium text-ink" : "text-ink-3")}
                  >
                    {i + 1}
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "set.remove", exerciseKey: exercise.key, setKey: s.key })}
                      aria-label={`Remove set ${i + 1}`}
                      className="absolute -left-1.5 flex size-7 items-center justify-center rounded-md bg-surface text-ink-3 opacity-0 transition-opacity hover:text-clay focus:opacity-100 group-hover:opacity-100 pointer-coarse:hidden"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                      </svg>
                    </button>
                  </span>
                  <span role="cell" className="num truncate text-[14px] text-ink-3">
                    {p ? (weighted ? `${formatWeight(p.weight)} × ${p.reps}` : `${p.reps} reps`) : "—"}
                  </span>
                  <span role="cell">
                    {weighted ? (
                      <NumberInput
                        ref={reg(`${s.key}:w`)}
                        decimal
                        label={`Set ${i + 1} weight in ${unit}`}
                        value={s.weight}
                        placeholder={suggestion.weight != null ? formatWeight(suggestion.weight) : unit}
                        onValue={(v) => dispatch({ type: "set.update", exerciseKey: exercise.key, setKey: s.key, patch: { weight: v } })}
                        onKeyDown={onKey(i, "w")}
                        emphasized={isNext}
                      />
                    ) : (
                      <span className="block text-center text-[13px] text-ink-3">Body</span>
                    )}
                  </span>
                  <span role="cell">
                    <NumberInput
                      ref={reg(`${s.key}:r`)}
                      label={`Set ${i + 1} reps`}
                      value={s.reps}
                      placeholder={suggestion.reps != null ? String(suggestion.reps) : "reps"}
                      onValue={(v) => dispatch({ type: "set.update", exerciseKey: exercise.key, setKey: s.key, patch: { reps: v } })}
                      onKeyDown={onKey(i, "r")}
                      emphasized={isNext}
                    />
                  </span>
                  <span role="cell" className="flex justify-end pr-0.5">
                    <CompleteToggle
                      done={s.completed}
                      label={`${s.completed ? "Undo" : "Complete"} set ${i + 1}`}
                      disabled={!s.completed && !(s.reps ?? suggestion.reps)}
                      onClick={() => dispatch({ type: "set.toggle", exerciseKey: exercise.key, setKey: s.key, now: Date.now() })}
                    />
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
        <div className="flex items-center justify-between border-y border-line py-2">
          <button
            type="button"
            onClick={() => {
              const key = crypto.randomUUID();
              dispatch({ type: "set.add", exerciseKey: exercise.key, key });
              focus(`${key}:${firstField}`);
            }}
            className="-ml-2 flex h-9 items-center gap-2 rounded-md px-2 text-[13px] text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
          >
            <IconPlus /> Add set
          </button>
          {allDone ? (
            <button
              type="button"
              onClick={onDone}
              className="flex h-9 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-sage-deep hover:bg-sage-wash"
            >
              Exercise complete <IconArrowRight />
            </button>
          ) : null}
        </div>
      </div>

      {/* Secondary actions */}
      <div className="flex flex-wrap gap-x-8 gap-y-2 py-4">
        <button type="button" onClick={() => setSwapOpen(true)} className="group flex min-w-0 items-center gap-2.5 text-left">
          <IconSwap className="shrink-0 text-ink-3 transition-colors group-hover:text-ink" />
          <span className="text-[13px] text-ink-2 underline decoration-transparent underline-offset-4 transition-colors group-hover:text-ink group-hover:decoration-line-strong">
            {exercise.substitutedFor ? `Substituted · was ${exercise.substitutedFor.name}` : "Substitute"}
          </span>
        </button>
        <button type="button" onClick={() => setNotesOpen(true)} className="group flex min-w-0 max-w-full items-center gap-2.5 text-left">
          <IconNote className="shrink-0 text-ink-3 transition-colors group-hover:text-ink" />
          <span className="truncate text-[13px] text-ink-2 underline decoration-transparent underline-offset-4 transition-colors group-hover:text-ink group-hover:decoration-line-strong">
            {exercise.notes ? <span className="italic">“{exercise.notes}”</span> : "Add a note"}
          </span>
        </button>
      </div>

      <ExercisePicker
        uid={uid}
        open={swapOpen}
        onOpenChange={setSwapOpen}
        title="Substitute exercise"
        relativeTo={exercise.substitutedFor ?? exercise.exercise}
        excludeIds={excludeIds.filter((id) => id !== exercise.substitutedFor?.id)}
        onPick={substitute}
      />

      <Sheet
        open={notesOpen}
        onOpenChange={setNotesOpen}
        title={`Notes · ${exercise.exercise.name}`}
        description="Saved with this session."
      >
        <div className="p-5">
          <textarea
            autoFocus
            value={exercise.notes}
            onChange={(e) => dispatch({ type: "exercise.notes", exerciseKey: exercise.key, notes: e.target.value })}
            rows={5}
            maxLength={1000}
            placeholder="e.g. Pause on the chest. Elbows at 45°."
            className="w-full resize-none rounded-md border border-line-strong bg-white px-3 py-2 text-[16px] placeholder:text-ink-3 sm:text-sm focus:border-ink-2 focus:outline-none"
          />
          <Button className="mt-3 w-full" size="lg" onClick={() => setNotesOpen(false)}>
            Done
          </Button>
        </div>
      </Sheet>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title={exercise.exercise.name}>
        <div className="flex flex-col gap-1 p-3">
          <MenuItem onClick={() => (setMenuOpen(false), setSwapOpen(true))}>Substitute exercise</MenuItem>
          <MenuItem onClick={() => (setMenuOpen(false), setNotesOpen(true))}>Edit notes</MenuItem>
          <MenuItem
            onClick={() => {
              setMenuOpen(false);
              const key = crypto.randomUUID();
              dispatch({ type: "set.add", exerciseKey: exercise.key, key });
            }}
          >
            Add a set
          </MenuItem>
          {exercise.sets.length > 0 ? (
            <MenuItem
              onClick={() => {
                setMenuOpen(false);
                const last = exercise.sets.at(-1)!;
                dispatch({ type: "set.remove", exerciseKey: exercise.key, setKey: last.key });
              }}
            >
              Remove last set
            </MenuItem>
          ) : null}
          <MenuItem danger onClick={() => (setMenuOpen(false), setConfirmRemove(true))}>
            Remove exercise from workout
          </MenuItem>
        </div>
      </Sheet>

      <Confirm
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove exercise?"
        description={`${exercise.exercise.name} and its ${exercise.sets.filter((s) => s.completed).length} logged sets will be removed from this workout. Your routine is not changed.`}
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => {
          setConfirmRemove(false);
          dispatch({ type: "exercise.remove", exerciseKey: exercise.key });
        }}
      />
    </section>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded-md px-3 py-3 text-left text-[14px] hover:bg-sunken", danger ? "text-clay hover:bg-clay-soft" : "text-ink")}
    >
      {children}
    </button>
  );
}

function CompleteToggle({ done, label, onClick, disabled }: { done: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative flex size-10 items-center justify-center rounded-full transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-40",
        done ? "text-paper" : "text-ink-3 hover:text-ink",
      )}
    >
      <motion.span
        aria-hidden
        className={cn("absolute inset-1.5 rounded-full border", done ? "border-sage-deep bg-sage-deep" : "border-line-strong bg-surface")}
        animate={{ scale: done ? [1, 1.12, 1] : 1 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      />
      {done ? <IconCheck className="relative" /> : null}
    </button>
  );
}

function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const request = () =>
      navigator.wakeLock
        .request("screen")
        .then((l) => (lock = l))
        .catch(() => {});
    request();
    const onVisible = () => document.visibilityState === "visible" && request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
