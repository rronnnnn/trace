"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";

/** Shared fallback for route errors: honest, recoverable, and reminds that logged sets are safe. */
export function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    console.error(error);
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [error]);
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";

  return (
    <main className="mx-auto flex max-w-md flex-col items-start px-6 pt-20 sm:pt-28" role="alert">
      <p className="eyebrow">{offline ? "You're offline" : "Something went wrong"}</p>
      <h1 className="mt-3 font-serif text-[32px] leading-tight">
        {offline ? "This page needs a connection." : "This page couldn't load."}
      </h1>
      <p className="mt-3 text-ink-2">
        {offline
          ? "Reconnect and try again. A workout in progress and any finished sessions are kept on this device."
          : "Your data is safe. Try again, and if it keeps happening, go back to Today."}
      </p>
      <div className="mt-8 flex gap-3">
        <Button size="lg" onClick={() => retry()}>
          Try again
        </Button>
        <Link href="/" className={buttonClass({ variant: "secondary", size: "lg" })}>
          Go to Today
        </Link>
      </div>
      {digest ? <p className="num mt-8 text-xs text-ink-3">Reference {digest}</p> : null}
    </main>
  );
}
