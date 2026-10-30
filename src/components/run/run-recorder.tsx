"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { IconArrowLeft } from "@/components/icons";
import {
  activeTime,
  currentPace,
  formatClockTime,
  formatKm,
  formatPace,
  movingTime,
  paceOf,
  runReducer,
  startRun,
  toRow,
  type RunEvent,
  type RunKind,
  type RunState,
} from "@/lib/run/recorder";
import { flushRuns, saveRun } from "@/lib/run/sync";
import { activeRunStore } from "@/lib/workout/storage";
import { cn } from "@/lib/utils";
import { RouteTrace } from "./route-trace";

type Phase = "loading" | "ready" | "recording" | "summary";

const reducer = (s: RunState | null, e: RunEvent | { type: "load"; run: RunState | null }) => (e.type === "load" ? e.run : s ? runReducer(s, e) : s);

/**
 * Recording a run. Location is asked for only when an outdoor run starts. The run is written to
 * the device every few seconds and whenever the page is hidden, so a reload or a closed tab
 * picks up where it left off.
 */
export function RunRecorder({ uid }: { uid: string }) {
  const router = useRouter();
  const [run, dispatch] = useReducer(reducer, null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [recovered, setRecovered] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [title, setTitle] = useState("");
  const [km, setKm] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const watch = useRef<number | null>(null);
  const wake = useRef<WakeLockSentinel | null>(null);
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  }, [run]);

  // ── location ──────────────────────────────────────────────────────────
  const stopWatching = useCallback(() => {
    if (watch.current != null) navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
  }, []);
  const startWatching = useCallback(() => {
    if (!("geolocation" in navigator)) {
      dispatch({ type: "gps", status: "unavailable" });
      setProblem("This browser can't share your location. Time keeps running; you can add the distance when you finish, or record it as a treadmill run.");
      return;
    }
    stopWatching();
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        setProblem(null);
        dispatch({
          type: "fix",
          fix: { lat: p.coords.latitude, lng: p.coords.longitude, t: p.timestamp || Date.now(), accuracy: p.coords.accuracy, altitude: p.coords.altitude, altitudeAccuracy: p.coords.altitudeAccuracy },
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          dispatch({ type: "gps", status: "denied" });
          setProblem("Location is off for TRACE. Allow it in your browser's site settings to record the route; the time is still running.");
          stopWatching();
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          dispatch({ type: "gps", status: "unavailable" });
          setProblem("No GPS signal yet. Open sky helps; the time is still running.");
        }
        // TIMEOUT: keep waiting, the next fix may come
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }, [stopWatching]);

  const keepAwake = useCallback(async () => {
    try {
      wake.current = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      wake.current = null;
    }
  }, []);

  // ── recovery and persistence ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void flushRuns(uid).catch(() => {});
    activeRunStore.load<RunState>(uid).then((saved) => {
      if (cancelled) return;
      if (saved && saved.ownerId === uid) {
        dispatch({ type: "load", run: saved });
        setRecovered(true);
        setPhase(saved.status === "finished" ? "summary" : "recording");
      } else setPhase("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const recording = phase === "recording";
  useEffect(() => {
    if (!recording || !run) return;
    if (run.kind === "outdoor" && run.gps !== "denied" && watch.current == null) startWatching();
    void keepAwake();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
    // start the watch once per recording, not on every state change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);
  useEffect(() => () => stopWatching(), [stopWatching]);

  const lastSaved = useRef(0);
  useEffect(() => {
    if (!run || phase === "loading" || phase === "ready") return;
    const t = Date.now();
    if (t - lastSaved.current < 3000 && run.status === "running") return;
    lastSaved.current = t;
    void activeRunStore.save(uid, run);
  }, [run, phase, uid]);
  useEffect(() => {
    const flush = () => {
      if (latest.current) void activeRunStore.save(uid, latest.current);
    };
    const onVisible = () => {
      if (document.visibilityState === "hidden") flush();
      else if (latest.current?.status !== "finished") void keepAwake();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", flush);
      // leaving the screen inside the app (no pagehide): keep the latest state
      if (latest.current && latest.current.status !== "finished") flush();
    };
  }, [uid, keepAwake]);

  // ── controls ──────────────────────────────────────────────────────────
  const start = (kind: RunKind) => {
    const r = startRun({ id: crypto.randomUUID(), ownerId: uid, kind, t: Date.now() });
    dispatch({ type: "load", run: r });
    void activeRunStore.save(uid, r);
    setNow(Date.now());
    setPhase("recording");
    if (kind === "outdoor") startWatching();
  };
  const pause = () => dispatch({ type: "pause", t: Date.now() });
  const resume = () => dispatch({ type: "resume", t: Date.now() });
  const finish = () => {
    dispatch({ type: "finish", t: Date.now() });
    stopWatching();
    void wake.current?.release().catch(() => {});
    setPhase("summary");
  };
  const discard = async () => {
    stopWatching();
    await activeRunStore.clear(uid);
    dispatch({ type: "load", run: null });
    setConfirmDiscard(false);
    setPhase("ready");
  };
  const save = async () => {
    if (!run) return;
    const manualKm = Number(km.replace(",", "."));
    const needsDistance = run.kind === "treadmill" || run.points.length < 2;
    if (needsDistance && !(manualKm > 0 && manualKm <= 500)) {
      setSaveNote({ tone: "error", text: "Add the distance you ran (from the treadmill's display), in kilometres." });
      return;
    }
    setSaving(true);
    setSaveNote(null);
    const row = toRow(run, { title, distanceOverride: needsDistance ? manualKm * 1000 : null });
    const r = await saveRun(uid, row);
    setSaving(false);
    if (r.status === "rejected") return setSaveNote({ tone: "error", text: `The run couldn't be saved: ${r.reason}. It is still on this device.` });
    await activeRunStore.clear(uid);
    if (r.status === "queued") {
      setSaveNote({ tone: "info", text: r.reason });
      return;
    }
    router.push(`/runs/${row.id}`);
  };

  // ── view ──────────────────────────────────────────────────────────────
  if (phase === "loading") return <div className="fixed inset-0 z-40 bg-paper" aria-busy="true" />;

  if (phase === "ready" || !run)
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-paper px-6 pb-[calc(env(safe-area-inset-bottom)+28px)] pt-[calc(env(safe-area-inset-top)+16px)]">
        <Link href="/runs" className="flex w-fit items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
          <IconArrowLeft /> Runs
        </Link>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
          <p className="eyebrow">Run</p>
          <h1 className="mt-3 font-serif text-[40px] leading-[1.05] tracking-[-0.02em]">Ready when you are.</h1>
          <p className="mt-3 text-[15px] text-ink-2">
            Outdoor runs use your location to measure distance and draw the route. It stays private to you.
          </p>
          <div className="mt-8 grid gap-3">
            <Button size="lg" className="h-14 text-[16px]" onClick={() => start("outdoor")}>
              Start outdoor run
            </Button>
            <Button size="lg" variant="secondary" className="h-14 text-[16px]" onClick={() => start("treadmill")}>
              Start treadmill run
            </Button>
          </div>
          <details className="mt-8 text-[13px] text-ink-3">
            <summary className="cursor-pointer text-ink-2 hover:text-ink">What a browser can and can&apos;t track</summary>
            <p className="mt-2">
              Keep TRACE open with the screen on; TRACE asks the screen to stay awake where the browser allows it. If the screen locks or you
              switch apps, most browsers pause location. The time keeps running, and when you come back the route joins up with a straight
              line, so distance over a long gap may be short. Nothing is recorded while paused.
            </p>
          </details>
        </div>
      </div>
    );

  const active = activeTime(run, run.finishedAt ?? now);
  const pace = run.status === "running" ? currentPace(run.points, now) : null;
  const moving = movingTime(run.points);
  const avg = paceOf(moving / 1000, run.distance);
  const outdoor = run.kind === "outdoor";

  if (phase === "summary") {
    const needsDistance = run.kind === "treadmill" || run.points.length < 2;
    return (
      <div className="fixed inset-0 z-40 overflow-y-auto bg-paper px-6 pb-[calc(env(safe-area-inset-bottom)+28px)] pt-[calc(env(safe-area-inset-top)+20px)]">
        <div className="mx-auto w-full max-w-md">
          <p className="eyebrow">{outdoor ? "Outdoor run" : "Treadmill run"} · finished</p>
          <dl className="num mt-6 grid grid-cols-2 gap-x-6 gap-y-6">
            <Stat label="Time" value={formatClockTime(active)} />
            <Stat label="Distance" value={needsDistance ? "—" : `${formatKm(run.distance)} km`} />
            {!needsDistance ? <Stat label="Average pace" value={`${formatPace(avg)} /km`} /> : null}
            <Stat label="Elapsed" value={formatClockTime((run.finishedAt ?? now) - run.startedAt)} small />
          </dl>
          {run.points.length >= 2 ? <RouteTrace points={run.points} width={320} height={180} className="mt-6 w-full" label="Your route" /> : null}
          {outdoor && (run.dropped.jump > 0 || run.longestGap > 30000) ? (
            <p className="mt-4 text-[12px] text-ink-3">
              {run.dropped.jump ? `${run.dropped.jump} GPS jump${run.dropped.jump === 1 ? " was" : "s were"} left out. ` : ""}
              {run.longestGap > 30000 ? `Location paused for up to ${Math.round(run.longestGap / 1000)} s; that stretch is a straight line.` : ""}
            </p>
          ) : null}
          <form
            className="mt-8 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {needsDistance ? (
              <div>
                <Label htmlFor="run-km">Distance (km)</Label>
                <Input id="run-km" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} placeholder="e.g. 5.2" aria-describedby="run-km-note" />
                <p id="run-km-note" className="mt-1.5 text-[12px] text-ink-3">
                  {outdoor ? "No route was recorded, so add the distance yourself." : "From the treadmill's display."}
                </p>
              </div>
            ) : null}
            <div>
              <Label htmlFor="run-title">Title (optional)</Label>
              <Input id="run-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Morning run" />
            </div>
            {saveNote ? (
              <p role={saveNote.tone === "error" ? "alert" : "status"} className={cn("text-sm", saveNote.tone === "error" ? "text-clay" : "text-ink-2")}>
                {saveNote.text}
                {saveNote.tone === "info" ? (
                  <Link href="/runs" className="ml-1 underline underline-offset-4">
                    Go to runs
                  </Link>
                ) : null}
              </p>
            ) : null}
            <div className="grid gap-2">
              <Button type="submit" size="lg" className="h-14 text-[16px]" disabled={saving || saveNote?.tone === "info"}>
                {saving ? "Saving…" : "Save run"}
              </Button>
              <Button variant="ghost" size="lg" onClick={() => setConfirmDiscard(true)} disabled={saving}>
                Discard
              </Button>
            </div>
          </form>
        </div>
        <DiscardConfirm open={confirmDiscard} onOpenChange={setConfirmDiscard} onConfirm={discard} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-paper px-6 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+14px)]">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">{outdoor ? "Outdoor run" : "Treadmill run"}</p>
        {outdoor ? <GpsBadge status={run.gps} accuracy={run.accuracy} /> : null}
      </div>
      {recovered ? (
        <p role="status" className="mt-3 rounded-md bg-sunken px-3 py-2 text-[13px] text-ink-2">
          Your run was recovered. The clock kept time while TRACE was closed.
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-3 rounded-md border border-line-strong px-3 py-2 text-[13px] text-ink-2">
          {problem}
        </p>
      ) : null}

      <div className="flex flex-1 flex-col items-center justify-center gap-7 text-center" aria-live="off">
        <Big label="Time" value={formatClockTime(active)} paused={run.status === "paused"} />
        {outdoor ? (
          <>
            <Big label="Distance" value={`${formatKm(run.distance)}`} unit="km" />
            <div className="num grid w-full max-w-sm grid-cols-2 gap-6">
              <div>
                <p className="text-[12px] uppercase tracking-[0.14em] text-ink-3">Pace now</p>
                <p className="mt-1 text-[32px] font-medium leading-none tracking-[-0.01em]">{formatPace(pace)}</p>
              </div>
              <div>
                <p className="text-[12px] uppercase tracking-[0.14em] text-ink-3">Average</p>
                <p className="mt-1 text-[32px] font-medium leading-none tracking-[-0.01em] text-ink-2">{formatPace(avg)}</p>
              </div>
            </div>
            <RouteTrace points={run.points} width={200} height={110} />
          </>
        ) : (
          <p className="max-w-xs text-[14px] text-ink-3">The treadmill measures your distance; add it when you finish.</p>
        )}
      </div>

      <div className="mx-auto grid w-full max-w-sm gap-3">
        {run.status === "running" ? (
          <Button size="lg" className="h-16 rounded-full text-[17px]" onClick={pause}>
            Pause
          </Button>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Button size="lg" className="h-16 rounded-full text-[17px]" onClick={resume}>
                Resume
              </Button>
              <Button size="lg" variant="secondary" className="h-16 rounded-full text-[17px]" onClick={finish}>
                Finish
              </Button>
            </div>
            <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>
              Discard run
            </Button>
          </>
        )}
      </div>
      <DiscardConfirm open={confirmDiscard} onOpenChange={setConfirmDiscard} onConfirm={discard} />
    </div>
  );
}

function DiscardConfirm({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (v: boolean) => void; onConfirm: () => void }) {
  return (
    <Confirm
      open={open}
      onOpenChange={onOpenChange}
      title="Discard this run?"
      description="The time, distance and route are deleted from this device. This can't be undone."
      confirmLabel="Discard run"
      cancelLabel="Keep it"
      tone="danger"
      onConfirm={onConfirm}
    />
  );
}

function Big({ label, value, unit, paused }: { label: string; value: string; unit?: string; paused?: boolean }) {
  return (
    <div>
      <p className="text-[12px] uppercase tracking-[0.16em] text-ink-3">
        {label}
        {paused ? <span className="ml-2 text-ink-2">· Paused</span> : null}
      </p>
      <p className={cn("num mt-1 text-[72px] font-medium leading-none tracking-[-0.03em] sm:text-[88px]", paused && "text-ink-3")}>
        {value}
        {unit ? <span className="ml-2 text-[28px] font-normal text-ink-3">{unit}</span> : null}
      </p>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className={cn("mt-1 font-medium leading-none", small ? "text-[20px] text-ink-2" : "text-[32px]")}>{value}</dd>
    </div>
  );
}

function GpsBadge({ status, accuracy }: { status: RunState["gps"]; accuracy: number | null }) {
  const text =
    status === "good"
      ? `GPS ±${Math.round(accuracy ?? 0)} m`
      : status === "weak"
        ? `Weak GPS${accuracy ? ` ±${Math.round(accuracy)} m` : ""}`
        : status === "acquiring"
          ? "Finding GPS…"
          : status === "denied"
            ? "Location off"
            : status === "unavailable"
              ? "No GPS"
              : "";
  return (
    <span role="status" className="num flex items-center gap-2 rounded-full border border-line-strong px-3 py-1 text-[12px] text-ink-2">
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          status === "good" ? "bg-sage" : status === "weak" || status === "acquiring" ? "animate-pulse bg-ink-4" : "border border-ink-3",
        )}
      />
      {text}
    </span>
  );
}
