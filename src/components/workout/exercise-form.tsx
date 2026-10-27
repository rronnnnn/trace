"use client";

import { useState, useTransition } from "react";
import { createExercise, updateExercise, type ExerciseInput } from "@/app/(app)/train/actions";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import type { ExerciseRef } from "@/lib/workout/types";
import { cn } from "@/lib/utils";

export const MUSCLES = [
  "Chest",
  "Back",
  "Shoulders",
  "Rear delts",
  "Biceps",
  "Triceps",
  "Forearms",
  "Quads",
  "Hamstrings",
  "Glutes",
  "Calves",
  "Posterior",
  "Core",
  "Full body",
];
export const EQUIPMENT = ["barbell", "dumbbell", "cable", "machine", "bodyweight", "kettlebell", "band", "other"];

const select =
  "h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[16px] capitalize text-ink sm:text-[15px] focus:border-ink-2 focus:outline-none";

function Toggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-md border border-line-strong p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn("h-9 rounded text-[14px] transition-colors", value === o.id ? "bg-ink text-paper" : "text-ink-2 hover:bg-sunken")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const blank = (name = ""): ExerciseInput => ({
  name,
  primaryMuscle: "Chest",
  equipment: "barbell",
  category: "compound",
  measure: "weight_reps",
});

/** Create or edit one of the user's own exercises. */
export function ExerciseForm({
  open,
  onOpenChange,
  initial,
  editId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Prefill; a bare name (from a search) starts a new exercise with that name. */
  initial?: Partial<ExerciseInput>;
  editId?: string;
  onSaved: (e: ExerciseRef | null) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={editId ? "Edit exercise" : "New exercise"}>
      {/* Sheet content unmounts when closed, so each open starts from `initial`. */}
      <FormBody initial={initial} editId={editId} onDone={(e) => (onSaved(e), onOpenChange(false))} />
    </Sheet>
  );
}

function FormBody({
  initial,
  editId,
  onDone,
}: {
  initial?: Partial<ExerciseInput>;
  editId?: string;
  onDone: (e: ExerciseRef | null) => void;
}) {
  const [form, setForm] = useState<ExerciseInput>(() => ({
    ...blank(),
    ...(initial?.name !== undefined ? { name: initial.name } : {}),
    ...(initial?.primaryMuscle ? { primaryMuscle: initial.primaryMuscle } : {}),
    ...(initial?.equipment ? { equipment: initial.equipment } : {}),
    ...(initial?.category ? { category: initial.category } : {}),
    ...(initial?.measure ? { measure: initial.measure } : {}),
  }));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = <K extends keyof ExerciseInput>(k: K, v: ExerciseInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    setError(null);
    start(async () => {
      if (editId) {
        const r = await updateExercise(editId, form);
        if ("error" in r) return setError(r.error);
        onDone(null);
      } else {
        const r = await createExercise(form);
        if ("error" in r) return setError(r.error);
        onDone(r.ok);
      }
    });
  };

  return (
    <form
      className="space-y-5 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <Label htmlFor="ex-name">Name</Label>
        <Input
          id="ex-name"
          autoFocus
          value={form.name}
          maxLength={80}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Cable Crunch"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ex-muscle">Muscle</Label>
          <select id="ex-muscle" className={select} value={form.primaryMuscle} onChange={(e) => set("primaryMuscle", e.target.value)}>
            {[...new Set([...MUSCLES, form.primaryMuscle])].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="ex-equipment">Equipment</Label>
          <select id="ex-equipment" className={select} value={form.equipment} onChange={(e) => set("equipment", e.target.value)}>
            {[...new Set([...EQUIPMENT, form.equipment])].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <Label>Measured by</Label>
        <Toggle
          value={form.measure}
          onChange={(v) => set("measure", v)}
          options={[
            { id: "weight_reps", label: "Weight × reps" },
            { id: "bodyweight_reps", label: "Reps only" },
          ]}
        />
      </div>
      <div>
        <Label>Type</Label>
        <Toggle
          value={form.category}
          onChange={(v) => set("category", v)}
          options={[
            { id: "compound", label: "Compound" },
            { id: "isolation", label: "Isolation" },
          ]}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-clay">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Saving…" : editId ? "Save changes" : "Create exercise"}
      </Button>
    </form>
  );
}
