"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { Sheet } from "@/components/ui/dialog";
import { ThemeSwitch } from "./theme-switch";

/** Mobile has no sidebar: account, appearance and sign-out live behind this button. */
export function MobileAccount({ name, email }: { name: string | null; email: string | null }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  if (path === "/workout" || path.startsWith("/landscape/explore")) return null;
  const initial = (name ?? email ?? "?").trim().charAt(0).toUpperCase();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Account and appearance"
        className="absolute right-4 top-4 z-20 flex size-9 items-center justify-center rounded-full border border-line-strong bg-surface text-[13px] font-medium text-ink-2 md:hidden"
      >
        {initial}
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={name ?? "Your account"} description={email ?? undefined}>
        <div className="space-y-6 p-5">
          <div>
            <p className="eyebrow mb-2">Appearance</p>
            <ThemeSwitch className="w-full" />
          </div>
          <form action="/auth/sign-out" method="post">
            <button className="h-11 w-full rounded-md border border-line-strong text-sm text-ink-2 hover:text-ink">Sign out</button>
          </form>
        </div>
      </Sheet>
    </>
  );
}
