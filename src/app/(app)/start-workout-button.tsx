"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconArrowRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/dialog";
import { buildWorkoutFromTemplate } from "@/lib/workout/start";
import { useActiveWorkout } from "@/lib/workout/use-active-workout";

export function StartWorkoutButton({
  uid,
  templateId,
  templateName,
  variant = "primary",
  label = "Start workout",
}: {
  uid: string;
  templateId: string;
  templateName: string;
  variant?: "primary" | "secondary";
  label?: string;
}) {
  const router = useRouter();
  const { workout, loaded, replace } = useActiveWorkout(uid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const resumable = workout?.templateId === templateId;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const w = await buildWorkoutFromTemplate(uid, templateId);
      await replace(w);
      router.push("/workout");
    } catch (e) {
      setError(navigator.onLine ? "Couldn't load this routine. Try again." : "You're offline. Starting a workout needs a connection.");
      console.error(e);
      setBusy(false);
    }
  }

  function onClick() {
    if (resumable) return router.push("/workout");
    if (workout) return setConfirmReplace(true);
    void start();
  }

  return (
    <div>
      <Button
        variant={variant}
        size="lg"
        onClick={onClick}
        disabled={!loaded || busy}
        className={variant === "primary" ? "min-w-44" : "min-w-28"}
        aria-label={resumable ? `Resume ${templateName}` : `${label}: ${templateName}`}
      >
        {busy ? "Preparing…" : resumable ? "Resume workout" : label}
        <IconArrowRight />
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-clay">
          {error}
        </p>
      ) : null}
      <Confirm
        open={confirmReplace}
        onOpenChange={setConfirmReplace}
        title="A workout is in progress"
        description={
          <>
            <strong className="font-medium text-ink">{workout?.templateName}</strong> is still open. Resume it, or discard it and start{" "}
            {templateName}.
          </>
        }
        cancelLabel="Discard & start new"
        confirmLabel="Resume"
        onConfirm={() => router.push("/workout")}
        onCancel={() => void start()}
      />
    </div>
  );
}
