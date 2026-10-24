"use client";

import { forwardRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Numeric field that keeps the user's in-progress text ("102.") while committing
 * parsed values upward on every keystroke. Placeholder shows the suggested value.
 */
export const NumberInput = forwardRef<
  HTMLInputElement,
  {
    value: number | null;
    onValue: (v: number | null) => void;
    decimal?: boolean;
    placeholder?: string;
    label: string;
    className?: string;
    onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
    disabled?: boolean;
    /** The set to log next: shows a visible field instead of bare text. */
    emphasized?: boolean;
  }
>(function NumberInput({ value, onValue, decimal, placeholder, label, className, onKeyDown, disabled, emphasized }, ref) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value == null ? "" : String(value));
  }, [value, focused]);

  return (
    <input
      ref={ref}
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      enterKeyHint="next"
      autoComplete="off"
      aria-label={label}
      disabled={disabled}
      value={draft}
      placeholder={placeholder}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onBlur={() => {
        setFocused(false);
        setDraft(value == null ? "" : String(value));
      }}
      onChange={(e) => {
        const raw = e.target.value.replace(",", ".");
        const pattern = decimal ? /^\d{0,4}(\.\d{0,2})?$/ : /^\d{0,3}$/;
        if (!pattern.test(raw)) return;
        setDraft(raw);
        if (raw === "" || raw === ".") onValue(null);
        else {
          const n = Number(raw);
          if (Number.isFinite(n)) onValue(n);
        }
      }}
      onKeyDown={onKeyDown}
      className={cn(
        "num h-11 w-full rounded-md border px-2 text-center text-[19px] font-medium tracking-[-0.01em] text-ink transition-colors",
        "placeholder:font-normal placeholder:text-ink-3 focus:border-ink focus:bg-white focus:outline-none focus-visible:outline-none",
        emphasized ? "border-line-strong bg-white/70 placeholder:text-ink-3" : "border-transparent bg-transparent hover:border-line",
        "disabled:text-ink-3",
        className,
      )}
    />
  );
});
