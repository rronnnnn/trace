"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconArrowLeft, IconPlus, IconSwap } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import { NumberInput } from "@/components/workout/number-input";
import type { ExerciseRef } from "@/lib/workout/types";
import { cn } from "@/lib/utils";
import { deleteRoutine, saveRoutine } from "./actions";

export type DraftSet = { key: string; reps: number | null; weight: number | null };
export type DraftExercise = { key: string; exercise: ExerciseRef; restSeconds: number; notes: string; sets: DraftSet[] };
export type DraftRoutine = { id: string | null; name: string; focus: string; estMinutes: number | null; exercises: DraftExercise[] };

const REST_OPTIONS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
const restLabel = (s: number) => (s === 0 ? "No rest" : s < 60 ? `${s}s` : s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s / 60} min`);
const key = () => crypto.randomUUID();

const select =
  "h-9 rounded-md border border-line-strong bg-surface px-2 text-[14px] text-ink focus:border-ink-2 focus:outline-none";

function IconBtn({ label, onClick, disabled, children, danger }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-9 place-items-center rounded-md text-ink-3 transition-colors hover:bg-sunken disabled:opacity-30 disabled:hover:bg-transparent",
        danger ? "hover:text-clay" : "hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

const Chevron = ({ up }: { up?: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
    <path d={up ? "M3 8.5 7 4.5l4 4" : "M3 5.5l4 4 4-4"} />
  </svg>
);
const Cross = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M2 2l10 10M12 2L2 12" />
  </svg>
);

export function RoutineEditor({ uid, unit, initial }: { uid: string; unit: string; initial: DraftRoutine }) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [picker, setPicker] = useState<{ mode: "add" } | { mode: "swap"; key: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [deleting, startDelete] = useTransition();

  const patch = (p: Partial<DraftRoutine>) => setDraft((d) => ({ ...d, ...p }));
  const patchExercise = (k: string, fn: (e: DraftExercise) => DraftExercise) =>
    setDraft((d) => ({ ...d, exercises: d.exercises.map((e) => (e.key === k ? fn(e) : e)) }));
  const move = (i: number, by: number) =>
    setDraft((d) => {
      const next = [...d.exercises];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item);
      return { ...d, exercises: next };
    });

  const onPick = (exercise: ExerciseRef) => {
    if (picker?.mode === "swap") {
      patchExercise(picker.key, (e) => ({ ...e, exercise, sets: exercise.measure === "weight_reps" ? e.sets : e.sets.map((s) => ({ ...s, weight: null })) }));
    } else {
      setDraft((d) => ({
        ...d,
        exercises: [
          ...d.exercises,
          {
            key: key(),
            exercise,
            restSeconds: exercise.measure === "weight_reps" ? 120 : 90,
            notes: "",
            sets: Array.from({ length: 3 }, () => ({ key: key(), reps: 10, weight: null })),
          },
        ],
      }));
    }
    setPicker(null);
  };

  const save = () => {
    setError(null);
    start(async () => {
      const r = await saveRoutine({
        id: draft.id,
        name: draft.name,
        focus: draft.focus,
        estMinutes: draft.estMinutes,
        exercises: draft.exercises.map((e) => ({
          exerciseId: e.exercise.id,
          restSeconds: e.restSeconds,
          notes: e.notes,
          sets: e.sets.map((s) => ({ targetReps: s.reps, targetWeight: e.exercise.measure === "weight_reps" ? s.weight : null })),
        })),
      });
      if ("error" in r) return setError(r.error);
      router.push("/train");
      router.refresh();
    });
  };

  const remove = () => {
    if (!draft.id) return;
    startDelete(async () => {
      const r = await deleteRoutine(draft.id!);
      if ("error" in r) {
        setConfirmDelete(false);
        return setError(r.error);
      }
      router.push("/train");
      router.refresh();
    });
  };

  return (
    <main className="mx-auto w-full max-w-[760px] px-5 pb-8 pt-8 sm:px-8 md:pt-14">
      <Link href="/train" className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <IconArrowLeft /> Train
      </Link>
      <h1 className="mt-4 font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[44px]">
        {draft.id ? "Edit routine" : "New routine"}
      </h1>

      <section className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
        <div className="sm:col-span-3">
          <Label htmlFor="r-name">Name</Label>
          <Input id="r-name" value={draft.name} maxLength={80} placeholder="e.g. Upper A" onChange={(e) => patch({ name: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="r-focus">Focus (optional)</Label>
          <Input id="r-focus" value={draft.focus} maxLength={80} placeholder="e.g. Chest · Back · Arms" onChange={(e) => patch({ focus: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="r-min">Minutes</Label>
          <Input
            id="r-min"
            inputMode="numeric"
            value={draft.estMinutes ?? ""}
            placeholder="—"
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 3);
              patch({ estMinutes: v ? Number(v) : null });
            }}
          />
        </div>
      </section>

      <ol className="mt-10 space-y-4">
        {draft.exercises.map((e, i) => {
          const weighted = e.exercise.measure === "weight_reps";
          return (
            <li key={e.key} className="rounded-lg border border-line bg-surface">
              <div className="flex items-start gap-2 border-b border-line px-4 py-3">
                <span className="eyebrow num pt-2">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="truncate text-[16px] font-medium">{e.exercise.name}</p>
                  <p className="text-xs capitalize text-ink-3">
                    {e.exercise.primaryMuscle} · {e.exercise.equipment}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <IconBtn label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <Chevron up />
                  </IconBtn>
                  <IconBtn label="Move down" disabled={i === draft.exercises.length - 1} onClick={() => move(i, 1)}>
                    <Chevron />
                  </IconBtn>
                  <IconBtn label="Swap exercise" onClick={() => setPicker({ mode: "swap", key: e.key })}>
                    <IconSwap width={15} height={15} />
                  </IconBtn>
                  <IconBtn label={`Remove ${e.exercise.name}`} danger onClick={() => patch({ exercises: draft.exercises.filter((x) => x.key !== e.key) })}>
                    <Cross />
                  </IconBtn>
                </div>
              </div>

              <div className="px-4 py-3">
                <div className={cn("grid items-center gap-x-3 text-xs text-ink-3", weighted ? "grid-cols-[40px_1fr_1fr_36px]" : "grid-cols-[40px_1fr_36px]")}>
                  <span>Set</span>
                  {weighted ? <span className="text-center">{unit} (optional)</span> : null}
                  <span className="text-center">Reps</span>
                  <span />
                </div>
                {e.sets.map((s, si) => (
                  <div
                    key={s.key}
                    className={cn("grid items-center gap-x-3 border-t border-line/60 py-1 first-of-type:border-t-0", weighted ? "grid-cols-[40px_1fr_1fr_36px]" : "grid-cols-[40px_1fr_36px]")}
                  >
                    <span className="num text-sm text-ink-3">{si + 1}</span>
                    {weighted ? (
                      <NumberInput
                        decimal
                        emphasized
                        label={`Set ${si + 1} target weight`}
                        value={s.weight}
                        placeholder="—"
                        onValue={(v) => patchExercise(e.key, (x) => ({ ...x, sets: x.sets.map((y) => (y.key === s.key ? { ...y, weight: v } : y)) }))}
                      />
                    ) : null}
                    <NumberInput
                      emphasized
                      label={`Set ${si + 1} target reps`}
                      value={s.reps}
                      placeholder="—"
                      onValue={(v) => patchExercise(e.key, (x) => ({ ...x, sets: x.sets.map((y) => (y.key === s.key ? { ...y, reps: v } : y)) }))}
                    />
                    <IconBtn
                      label={`Remove set ${si + 1}`}
                      danger
                      disabled={e.sets.length === 1}
                      onClick={() => patchExercise(e.key, (x) => ({ ...x, sets: x.sets.filter((y) => y.key !== s.key) }))}
                    >
                      <Cross />
                    </IconBtn>
                  </div>
                ))}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={e.sets.length >= 20}
                    onClick={() =>
                      patchExercise(e.key, (x) => {
                        const last = x.sets[x.sets.length - 1];
                        return { ...x, sets: [...x.sets, { key: key(), reps: last?.reps ?? 10, weight: last?.weight ?? null }] };
                      })
                    }
                  >
                    <IconPlus /> Add set
                  </Button>
                  <label className="flex items-center gap-2 text-xs text-ink-3">
                    Rest
                    <select
                      className={select}
                      value={e.restSeconds}
                      onChange={(ev) => patchExercise(e.key, (x) => ({ ...x, restSeconds: Number(ev.target.value) }))}
                    >
                      {[...new Set([...REST_OPTIONS, e.restSeconds])].sort((a, b) => a - b).map((r) => (
                        <option key={r} value={r}>
                          {restLabel(r)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <Input
                  className="mt-3 h-10 text-[14px]!"
                  value={e.notes}
                  maxLength={500}
                  placeholder="Notes (optional) — cues, tempo, machine settings"
                  aria-label={`Notes for ${e.exercise.name}`}
                  onChange={(ev) => patchExercise(e.key, (x) => ({ ...x, notes: ev.target.value }))}
                />
              </div>
            </li>
          );
        })}
      </ol>

      <Button variant="secondary" size="lg" className="mt-4 w-full" onClick={() => setPicker({ mode: "add" })} disabled={draft.exercises.length >= 40}>
        <IconPlus /> Add exercise
      </Button>

      {draft.id ? (
        <div className="mt-12 border-t border-line pt-6">
          <Button variant="quiet" className="text-clay!" onClick={() => setConfirmDelete(true)}>
            Delete this routine
          </Button>
        </div>
      ) : null}

      <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-5 mt-10 border-t border-line bg-paper/95 backdrop-blur sm:-mx-8 md:bottom-0">
        <div className="flex items-center gap-3 px-5 py-3 sm:px-8">
          <p role="alert" className="min-w-0 flex-1 text-sm text-clay">
            {error}
          </p>
          <Button variant="secondary" onClick={() => router.push("/train")}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save routine"}
          </Button>
        </div>
      </div>

      <ExercisePicker
        uid={uid}
        open={picker !== null}
        onOpenChange={(v) => !v && setPicker(null)}
        title={picker?.mode === "swap" ? "Swap exercise" : "Add exercise"}
        relativeTo={picker?.mode === "swap" ? draft.exercises.find((e) => e.key === picker.key)?.exercise : null}
        excludeIds={draft.exercises.map((e) => e.exercise.id)}
        onPick={onPick}
      />
      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this routine?"
        description="Past sessions done with it stay in your history. This can't be undone."
        confirmLabel="Delete routine"
        tone="danger"
        busy={deleting}
        onConfirm={remove}
      />
    </main>
  );
}
