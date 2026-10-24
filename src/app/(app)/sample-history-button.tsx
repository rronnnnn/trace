"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/dialog";
import { clearSampleHistory, generateSampleHistory } from "@/lib/sample";
import { supabaseBrowser } from "@/lib/supabase/client";

export function SampleHistoryButton({ uid, mode }: { uid: string; mode: "load" | "remove" }) {
  const router = useRouter();
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function load() {
    setError(null);
    setProgress("Preparing…");
    try {
      const { data } = await supabaseBrowser().from("profiles").select("training_days").eq("id", uid).single();
      await generateSampleHistory(uid, data?.training_days ?? [], (d, t) => setProgress(`Writing ${d} of ${t}…`));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create sample history.");
    } finally {
      setProgress(null);
    }
  }

  async function remove() {
    setError(null);
    setProgress("Removing…");
    try {
      await clearSampleHistory();
      setConfirm(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove sample history.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="shrink-0">
      <Button variant="secondary" onClick={mode === "load" ? load : () => setConfirm(true)} disabled={progress != null}>
        {progress ?? (mode === "load" ? "Load sample history" : "Remove sample data")}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-clay">
          {error}
        </p>
      ) : null}
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title="Remove sample data?"
        description="All sample sessions will be deleted. Your own sessions are not affected, and records are rebuilt from them."
        confirmLabel="Remove"
        tone="danger"
        busy={progress != null}
        onConfirm={remove}
      />
    </div>
  );
}
