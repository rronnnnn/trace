"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { logRun } from "./actions";

const pad = (n: number) => String(n).padStart(2, "0");
const localNow = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Logging a run by hand: a treadmill session, or a run recorded on another device. */
export function LogRun() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"treadmill" | "outdoor">("treadmill");
  const [when, setWhen] = useState(localNow);
  const [km, setKm] = useState("");
  const [min, setMin] = useState("");
  const [sec, setSec] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Log a run
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="Log a run" description="For a treadmill run, or one recorded somewhere else. It has no route.">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              // the browser's local time, sent as an instant
              const r = await logRun({ kind, startedAt: new Date(when).toISOString(), distanceKm: Number(km.replace(",", ".")), minutes: Number(min || 0), seconds: Number(sec || 0), title });
              if ("error" in r) return setError(r.error);
              setOpen(false);
              router.push(`/runs/${r.id}`);
            });
          }}
        >
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-ink-2">Where</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {(["treadmill", "outdoor"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={cn("h-11 rounded-md border text-[14px] transition-colors", kind === k ? "border-ink bg-ink text-paper" : "border-line-strong text-ink-2 hover:border-ink-3")}
                >
                  {k === "treadmill" ? "Treadmill" : "Outdoors"}
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <Label htmlFor="log-when">Started</Label>
            <Input id="log-when" type="datetime-local" value={when} max={localNow()} onChange={(e) => setWhen(e.target.value)} required />
          </div>
          <div className="grid grid-cols-[1fr_1fr_1fr] gap-3">
            <div>
              <Label htmlFor="log-km">Distance (km)</Label>
              <Input id="log-km" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} required placeholder="5.0" />
            </div>
            <div>
              <Label htmlFor="log-min">Minutes</Label>
              <Input id="log-min" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} required placeholder="28" />
            </div>
            <div>
              <Label htmlFor="log-sec">Seconds</Label>
              <Input id="log-sec" inputMode="numeric" value={sec} onChange={(e) => setSec(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="30" />
            </div>
          </div>
          <div>
            <Label htmlFor="log-title">Title (optional)</Label>
            <Input id="log-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-clay">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Save run"}
          </Button>
        </form>
      </Sheet>
    </>
  );
}
