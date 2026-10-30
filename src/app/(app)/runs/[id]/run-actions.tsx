"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { deleteRun, renameRun } from "../actions";

/** Rename and delete. Deleting removes the route with the run, and asks first. */
export function RunActions({ id, title }: { id: string; title: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title ?? "");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {editing ? (
        <form
          className="flex w-full flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await renameRun(id, value);
              if ("error" in r) return setError(r.error);
              setEditing(false);
              router.refresh();
            });
          }}
        >
          <div className="min-w-0 flex-1">
            <Label htmlFor="run-rename">Title</Label>
            <Input id="run-rename" value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} autoFocus />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Rename
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
            Delete
          </Button>
        </>
      )}
      {error ? (
        <p role="alert" className="w-full text-sm text-clay">
          {error}
        </p>
      ) : null}
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this run?"
        description="The run and its whole route are deleted for good. Nothing of where it went is kept."
        confirmLabel="Delete run"
        tone="danger"
        busy={pending}
        onConfirm={() =>
          start(async () => {
            const r = await deleteRun(id);
            if ("error" in r) {
              setConfirm(false);
              return setError(r.error);
            }
            router.replace("/runs");
          })
        }
      />
    </div>
  );
}
