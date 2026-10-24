"use client";

import { useEffect, useState } from "react";

/** Wall-clock time that ticks while `active`. Null until the first tick (keeps render pure). */
export function useNow(intervalMs: number, active = true) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [intervalMs, active]);
  return now;
}
