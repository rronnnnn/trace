"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Reports the browser timezone so server-rendered dates and weeks are local. */
export function TzSync({ serverTz }: { serverTz: string }) {
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== serverTz) {
      document.cookie = `trace_tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    }
  }, [serverTz, router]);
  return null;
}
