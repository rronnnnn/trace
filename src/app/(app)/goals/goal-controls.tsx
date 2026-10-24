"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconMore, IconPlus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Confirm, Sheet } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import type { ExerciseRef } from "@/lib/workout/types";
import { archiveGoal, createGoal, deleteGoal } from "./actions";

type Preset = { exerciseId: string; name: string; weighted: boolean; target: number };

export function NewGoal({ uid, unit, preset, compact }: { uid: string; unit: string; preset?: Preset; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [exercise, setExercise] = useState<{ id: string; name: string; weighted: boolean } | null>(
    preset ? { id: preset.exerciseId, name: preset.name, weighted: preset.weighted } : null,
  );
  const [weight, setWeight] = useState(preset?.weighted ? String(preset.target) : "");
  const [reps, setReps] = useState(preset ? (preset.weighted ? "1" : String(preset.target)) : "1");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const pick = (e: ExerciseRef) => {
    setPicking(false);
    const weighted = e.measure === "weight_reps";
    setExercise({ id: e.id, name: e.name, weighted });
    if (!weighted && Number(reps) < 2) setReps("10");
    if (weighted && !weight) setReps("1");
  };

  const submit = () => {
    if (!exercise) return setError("Choose an exercise.");
    setError(null);
    start(async () => {
      const result = await createGoal({
        exerciseId: exercise.id,
        targetWeight: exercise.weighted ? Number(weight.replace(",", ".")) : null,
        targetReps: Number(reps),
        note,
      });
      if ("error" in result) return setError(result.error);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button variant={compact ? "secondary" : "primary"} size={compact ? "sm" : "lg"} onClick={() => setOpen(true)}>
        {compact ? (
          "Set this goal"
        ) : (
          <>
            <IconPlus /> New goal
          </>
        )}
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="New goal" description="Choose a summit. Progress comes from your recorded sets.">
        <form
          className="space-y-5 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <Label>Exercise</Label>
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="flex h-11 w-full items-center justify-between rounded-md border border-line-strong bg-surface px-3 text-left text-[16px] sm:text-[15px]"
            >
              <span className={exercise ? "text-ink" : "text-ink-3"}>{exercise?.name ?? "Choose an exercise"}</span>
              <span className="text-xs text-ink-3">Change</span>
            </button>
          </div>
          {exercise?.weighted !== false ? (
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <div>
                <Label htmlFor="goal-weight">Target weight ({unit})</Label>
                <Input id="goal-weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="100" />
              </div>
              <div>
                <Label htmlFor="goal-reps">For reps</Label>
                <Input id="goal-reps" inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value.replace(/\D/g, ""))} />
              </div>
            </div>
          ) : (
            <div>
              <Label htmlFor="goal-reps">Target reps in one set</Label>
              <Input
                id="goal-reps"
                inputMode="numeric"
                value={reps}
                onChange={(e) => setReps(e.target.value.replace(/\D/g, ""))}
                placeholder="20"
              />
            </div>
          )}
          <div>
            <Label htmlFor="goal-note">Why it matters (optional)</Label>
            <Input id="goal-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Before the summer" />
          </div>
          <p role="alert" className="min-h-5 text-sm text-clay">
            {error}
          </p>
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Set goal"}
          </Button>
        </form>
      </Sheet>
      <ExercisePicker uid={uid} open={picking} onOpenChange={setPicking} title="Goal exercise" onPick={pick} />
    </>
  );
}

export function GoalActions({ id, archived = false }: { id: string; archived?: boolean }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      setMenu(false);
      setConfirm(false);
      router.refresh();
    });
  return (
    <>
      <button
        type="button"
        onClick={() => setMenu(true)}
        aria-label="Goal options"
        className="-mr-2 flex size-9 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink"
      >
        <IconMore />
      </button>
      <Sheet open={menu} onOpenChange={setMenu} title="Goal">
        <div className="flex flex-col gap-1 p-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => archiveGoal(id, !archived))}
            className="rounded-md px-3 py-3 text-left text-[14px] hover:bg-sunken"
          >
            {archived ? "Restore goal" : "Archive goal"}
          </button>
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="rounded-md px-3 py-3 text-left text-[14px] text-clay hover:bg-clay-soft"
          >
            Delete goal
          </button>
        </div>
      </Sheet>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this goal?"
        description="The goal is removed. Your training history is not affected."
        confirmLabel="Delete"
        tone="danger"
        busy={pending}
        onConfirm={() => run(() => deleteGoal(id))}
      />
    </>
  );
}
