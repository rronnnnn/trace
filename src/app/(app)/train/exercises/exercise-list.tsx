"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconPlus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/dialog";
import { ExerciseForm } from "@/components/workout/exercise-form";
import type { Measure } from "@/lib/workout/types";
import { deleteExercise } from "../actions";

export type OwnExercise = {
  id: string;
  name: string;
  primaryMuscle: string;
  equipment: string;
  category: "compound" | "isolation";
  measure: Measure;
};

export function ExerciseList({ exercises }: { exercises: OwnExercise[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<OwnExercise | "new" | null>(null);
  const [deleting, setDeleting] = useState<OwnExercise | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const remove = () => {
    if (!deleting) return;
    start(async () => {
      const r = await deleteExercise(deleting.id);
      setDeleting(null);
      if ("error" in r) return setError(r.error);
      setError(null);
      router.refresh();
    });
  };

  return (
    <>
      <div className="mt-8">
        <Button size="lg" onClick={() => setEditing("new")}>
          <IconPlus /> New exercise
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-clay">
          {error}
        </p>
      ) : null}

      {exercises.length === 0 ? (
        <p className="mt-10 border-t border-line pt-6 text-ink-3">You haven&apos;t added any exercises yet.</p>
      ) : (
        <ul className="mt-10 border-t border-ink/80">
          {exercises.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-4 border-b border-line py-4">
              <div className="min-w-0">
                <p className="truncate text-[16px]">{e.name}</p>
                <p className="text-xs capitalize text-ink-3">
                  {e.primaryMuscle} · {e.equipment} · {e.measure === "weight_reps" ? "weight × reps" : "reps only"}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(e)}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" className="hover:text-clay" onClick={() => setDeleting(e)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ExerciseForm
        open={editing !== null}
        onOpenChange={(v) => !v && setEditing(null)}
        editId={editing && editing !== "new" ? editing.id : undefined}
        initial={editing && editing !== "new" ? editing : undefined}
        onSaved={() => router.refresh()}
      />
      <Confirm
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "exercise"}?`}
        description="It will be removed from every routine. Sessions where you logged it stay in your history."
        confirmLabel="Delete exercise"
        tone="danger"
        busy={pending}
        onConfirm={remove}
      />
    </>
  );
}
