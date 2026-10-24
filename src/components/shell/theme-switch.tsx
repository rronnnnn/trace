"use client";

import { useSyncExternalStore } from "react";
import { applyTheme, readTheme, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { id: ThemeChoice; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** System / Light / Dark. "System" follows the device and is the default. */
export function ThemeSwitch({ className }: { className?: string }) {
  const value = useSyncExternalStore(subscribe, readTheme, () => "system" as ThemeChoice);
  return (
    <div role="radiogroup" aria-label="Appearance" className={cn("inline-flex rounded-md border border-line p-0.5", className)}>
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => {
            applyTheme(o.id);
            listeners.forEach((l) => l());
          }}
          className={cn(
            "h-7 flex-1 rounded-[4px] px-2.5 text-[12px] transition-colors",
            value === o.id ? "bg-sunken font-medium text-ink" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
