"use client";

import { useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { loadLibrary } from "@/lib/workout/start";
import type { ExerciseRef } from "@/lib/workout/types";
import { cn } from "@/lib/utils";

/**
 * Library search. When `relativeTo` is given (substitution), related movements come first:
 * variations of the same lift, then the same muscle group.
 */
export function ExercisePicker({
  uid,
  open,
  onOpenChange,
  title,
  relativeTo,
  excludeIds = [],
  onPick,
}: {
  uid: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  relativeTo?: ExerciseRef | null;
  excludeIds?: string[];
  onPick: (e: ExerciseRef) => void;
}) {
  const [library, setLibrary] = useState<ExerciseRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || library) return;
    loadLibrary(uid)
      .then(setLibrary)
      .catch(() => setError("The exercise library isn't available offline yet. Reconnect and try again."));
  }, [open, library, uid]);

  const groups = useMemo(() => {
    if (!library) return [];
    const q = query.trim().toLowerCase();
    const pool = library.filter(
      (e) => !excludeIds.includes(e.id) && (!q || `${e.name} ${e.primaryMuscle} ${e.equipment}`.toLowerCase().includes(q)),
    );
    if (!relativeTo || q) return [{ label: q ? "Results" : "All exercises", items: pool }];
    const root = relativeTo.variationOf ?? relativeTo.id;
    const variations = pool.filter((e) => e.id === root || e.variationOf === root);
    const sameMuscle = pool.filter((e) => !variations.includes(e) && e.primaryMuscle === relativeTo.primaryMuscle);
    const rest = pool.filter((e) => !variations.includes(e) && !sameMuscle.includes(e));
    return [
      { label: "Variations", items: variations },
      { label: `Other ${relativeTo.primaryMuscle.toLowerCase()} exercises`, items: sameMuscle },
      { label: "Everything else", items: rest },
    ].filter((g) => g.items.length);
  }, [library, query, relativeTo, excludeIds]);

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) setQuery("");
        onOpenChange(v);
      }}
      title={title}
      description={relativeTo ? `Replacing ${relativeTo.name}` : undefined}
    >
      <div className="sticky top-0 z-10 border-b border-line bg-surface px-5 py-3">
        <Input
          autoFocus
          placeholder="Search exercises"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search exercises"
        />
      </div>
      <div className="max-h-[56dvh] overflow-y-auto px-2 pb-4 sm:max-h-[420px]">
        {error ? <p className="px-3 py-6 text-sm text-clay">{error}</p> : null}
        {!library && !error ? <p className="px-3 py-6 text-sm text-ink-3">Loading library…</p> : null}
        {library && groups.every((g) => !g.items.length) ? (
          <p className="px-3 py-6 text-sm text-ink-3">No exercises match “{query}”.</p>
        ) : null}
        {groups.map((g) => (
          <div key={g.label} className="pt-3">
            <p className="eyebrow px-3 pb-1">{g.label}</p>
            <ul>
              {g.items.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      onPick(e);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left hover:bg-sunken focus-visible:bg-sunken",
                    )}
                  >
                    <span className="text-[14px]">{e.name}</span>
                    <span className="text-xs capitalize text-ink-3">
                      {e.primaryMuscle} · {e.equipment}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
