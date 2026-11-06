"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconArrowLeft, IconPlus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { NumberInput } from "@/components/workout/number-input";
import { cn } from "@/lib/utils";
import { Cross, IconBtn } from "../../../train/routine-editor";
import { deleteSession, saveSessionEdit } from "../../actions";

export type EditSet = { key: string; id: string | null; weight: number | null; reps: number | null };
export type EditExercise = { id: string; name: string; weighted: boolean; notes: string; sets: EditSet[] };
export type EditSession = { id: string; title: string; date: string; notes: string; exercises: EditExercise[] };

const key = () => crypto.randomUUID();

/**
 * Corrects a logged session: performed sets only. Planned sets that were skipped stay as they are.
 * Nothing is written until Save, which rebuilds totals and records in one go.
 */
export function SessionEditor({ unit, initial }: { unit: string; initial: EditSession }) {
  const router = useRouter();
  const [notes, setNotes] = useState(initial.notes);
  const [exercises, setExercises] = useState(initial.exercises);
  const [deleteSets, setDeleteSets] = useState<string[]>([]);
  const [deleteExercises, setDeleteExercises] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [deleting, startDelete] = useTransition();
  const back = `/history/${initial.id}`;

  const patchExercise = (id: string, fn: (e: EditExercise) => EditExercise) =>
    setExercises((xs) => xs.map((e) => (e.id === id ? fn(e) : e)));
  const patchSet = (exId: string, setKey: string, patch: Partial<EditSet>) =>
    patchExercise(exId, (e) => ({ ...e, sets: e.sets.map((s) => (s.key === setKey ? { ...s, ...patch } : s)) }));

  function removeSet(exId: string, s: EditSet) {
    if (s.id) setDeleteSets((d) => [...d, s.id!]);
    patchExercise(exId, (e) => ({ ...e, sets: e.sets.filter((x) => x.key !== s.key) }));
  }

  function removeExercise(e: EditExercise) {
    setDeleteExercises((d) => [...d, e.id]);
    setExercises((xs) => xs.filter((x) => x.id !== e.id));
  }

  function save() {
    setError(null);
    start(async () => {
      const r = await saveSessionEdit({
        id: initial.id,
        notes,
        exercises: exercises.map((e) => ({ id: e.id, notes: e.notes })),
        sets: exercises.flatMap((e) =>
          e.sets.map((s) => ({ id: s.id, sessionExerciseId: e.id, weight: e.weighted ? s.weight : null, reps: s.reps })),
        ),
        deleteSets,
        deleteExercises,
      });
      if ("error" in r) return setError(r.error);
      router.push(back);
      router.refresh();
    });
  }

  function remove() {
    startDelete(async () => {
      const r = await deleteSession(initial.id);
      if ("error" in r) {
        setConfirmDelete(false);
        return setError(r.error);
      }
      router.push("/history");
      router.refresh();
    });
  }

  return (
    <main className="mx-auto w-full max-w-[760px] px-5 pb-8 pt-8 sm:px-8 md:pt-14">
      <Link href={back} className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <IconArrowLeft /> Session
      </Link>
      <p className="eyebrow mt-6">{initial.date}</p>
      <h1 className="mt-3 font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[44px]">Edit {initial.title}</h1>
      <p className="mt-3 max-w-xl text-ink-2">Fix what was logged. Totals and personal records are worked out again when you save.</p>

      <div className="mt-8">
        <Label htmlFor="s-notes">Session notes</Label>
        <textarea
          id="s-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="How it went (optional)"
          className="w-full resize-y rounded-md border border-line-strong bg-surface px-3 py-2.5 text-[16px] leading-relaxed text-ink placeholder:text-ink-3 focus:border-ink-2 focus:outline-none sm:text-[15px]"
        />
      </div>

      <ol className="mt-10 space-y-4">
        {exercises.map((e, i) => {
          const cols = e.weighted ? "grid-cols-[40px_1fr_1fr_36px]" : "grid-cols-[40px_1fr_36px]";
          return (
            <li key={e.id} className="rounded-lg border border-line bg-surface">
              <div className="flex items-start gap-2 border-b border-line px-4 py-3">
                <span className="eyebrow num pt-2">{String(i + 1).padStart(2, "0")}</span>
                <p className="min-w-0 flex-1 truncate pt-1.5 text-[16px] font-medium">{e.name}</p>
                <IconBtn label={`Remove ${e.name} from this session`} danger onClick={() => removeExercise(e)}>
                  <Cross />
                </IconBtn>
              </div>

              <div className="px-4 py-3">
                {e.sets.length ? (
                  <div className={cn("grid items-center gap-x-3 text-xs text-ink-3", cols)}>
                    <span>Set</span>
                    {e.weighted ? <span className="text-center">{unit}</span> : null}
                    <span className="text-center">Reps</span>
                    <span />
                  </div>
                ) : (
                  <p className="text-sm text-ink-3">No sets performed.</p>
                )}
                {e.sets.map((s, si) => (
                  <div key={s.key} className={cn("grid items-center gap-x-3 border-t border-line/60 py-1 first-of-type:border-t-0", cols)}>
                    <span className="num text-sm text-ink-3">{si + 1}</span>
                    {e.weighted ? (
                      <NumberInput
                        decimal
                        emphasized
                        label={`${e.name} set ${si + 1} weight`}
                        value={s.weight}
                        placeholder="—"
                        onValue={(v) => patchSet(e.id, s.key, { weight: v })}
                      />
                    ) : null}
                    <NumberInput
                      emphasized
                      label={`${e.name} set ${si + 1} reps`}
                      value={s.reps}
                      placeholder="—"
                      onValue={(v) => patchSet(e.id, s.key, { reps: v })}
                    />
                    <IconBtn label={`Remove ${e.name} set ${si + 1}`} danger onClick={() => removeSet(e.id, s)}>
                      <Cross />
                    </IconBtn>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  disabled={e.sets.length >= 30}
                  onClick={() =>
                    patchExercise(e.id, (x) => {
                      const last = x.sets[x.sets.length - 1];
                      return { ...x, sets: [...x.sets, { key: key(), id: null, weight: last?.weight ?? null, reps: last?.reps ?? null }] };
                    })
                  }
                >
                  <IconPlus /> Add set
                </Button>
                <Input
                  className="mt-3 h-10 text-[14px]!"
                  value={e.notes}
                  maxLength={1000}
                  placeholder="Notes (optional)"
                  aria-label={`Notes for ${e.name}`}
                  onChange={(ev) => patchExercise(e.id, (x) => ({ ...x, notes: ev.target.value }))}
                />
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-12 border-t border-line pt-6">
        <Button variant="quiet" className="text-clay!" onClick={() => setConfirmDelete(true)}>
          Delete this session
        </Button>
      </div>

      <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-5 mt-10 border-t border-line bg-paper/95 backdrop-blur sm:-mx-8 md:bottom-0">
        <div className="flex items-center gap-3 px-5 py-3 sm:px-8">
          <p role="alert" className="min-w-0 flex-1 text-sm text-clay">
            {error}
          </p>
          <Button variant="secondary" onClick={() => router.push(back)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this session?"
        description="It leaves your history, and records are worked out again without it. This can't be undone."
        confirmLabel="Delete session"
        tone="danger"
        busy={deleting}
        onConfirm={remove}
      />
    </main>
  );
}
