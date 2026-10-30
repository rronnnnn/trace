"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ENERGY } from "@/lib/reflection";
import { cn } from "@/lib/utils";
import { saveReflection } from "./actions";

export function ReflectionForm({
  week,
  initial,
  complete,
}: {
  week: string;
  initial: { energy: number | null; note: string | null; nextFocus: string | null } | null;
  complete: boolean;
}) {
  const router = useRouter();
  const [energy, setEnergy] = useState<number | null>(initial?.energy ?? null);
  const [note, setNote] = useState(initial?.note ?? "");
  const [nextFocus, setNextFocus] = useState(initial?.nextFocus ?? "");
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const dirty = energy !== (initial?.energy ?? null) || note !== (initial?.note ?? "") || nextFocus !== (initial?.nextFocus ?? "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await saveReflection({ week, energy, note, nextFocus });
      if ("error" in r) return setStatus({ tone: "error", text: r.error });
      setStatus({ tone: "ok", text: r.cleared ? "Reflection cleared." : "Saved." });
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-ink-2">{complete ? "How did the week feel?" : "How is the week feeling?"}</legend>
        <div className="grid grid-cols-5 gap-1.5">
          {ENERGY.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={energy === o.value}
              onClick={() => setEnergy(energy === o.value ? null : o.value)}
              className={cn(
                "flex h-14 flex-col items-center justify-center gap-1.5 rounded-md border text-[12px] transition-colors sm:text-[13px]",
                energy === o.value ? "border-ink bg-ink text-paper" : "border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink",
              )}
            >
              <span className="flex items-end gap-0.5" aria-hidden>
                {[1, 2, 3, 4, 5].map((i) => (
                  <span
                    key={i}
                    className={cn("w-1 rounded-[1px]", i <= o.value ? (energy === o.value ? "bg-paper" : "bg-sage") : "bg-line-strong")}
                    style={{ height: 3 + i * 2 }}
                  />
                ))}
              </span>
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <Label htmlFor="reflection-note">What went well, and what didn&apos;t</Label>
        <textarea
          id="reflection-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Sleep, stress, a lift that moved, a session that didn't…"
          className="w-full resize-y rounded-md border border-line-strong bg-surface px-3 py-2.5 text-[16px] leading-relaxed text-ink placeholder:text-ink-3 focus:border-ink-2 focus:outline-none sm:text-[15px]"
        />
      </div>

      <div>
        <Label htmlFor="reflection-focus">One thing to focus on next week</Label>
        <Input
          id="reflection-focus"
          value={nextFocus}
          onChange={(e) => setNextFocus(e.target.value)}
          maxLength={200}
          placeholder="e.g. Get all four sessions in; slow the eccentric on squats"
        />
        <p className="mt-1.5 text-[12px] text-ink-3">It shows on Today all next week.</p>
      </div>

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? "Saving…" : initial ? "Save changes" : "Save reflection"}
        </Button>
        {status ? (
          <p role={status.tone === "error" ? "alert" : "status"} className={cn("text-sm", status.tone === "error" ? "text-clay" : "text-sage-deep")}>
            {status.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}
