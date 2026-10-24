"use client";

import * as D from "@radix-ui/react-dialog";
import * as A from "@radix-ui/react-alert-dialog";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const overlay =
  "fixed inset-0 z-50 bg-[#1d1c1a]/25 data-[state=open]:animate-[fade-in_160ms_ease-out] data-[state=closed]:animate-[fade-out_120ms_ease-in]";

/** Centered on desktop, bottom sheet on mobile. */
const panel = cn(
  "fixed z-50 bg-surface shadow-[0_24px_60px_-20px_rgba(29,28,26,0.35)] focus:outline-none",
  "inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-xl border-t border-line pb-[env(safe-area-inset-bottom)]",
  "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(92vw,440px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border",
  "data-[state=open]:animate-[sheet-in_240ms_var(--ease-out)]",
);

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content className={cn(panel, className)} aria-describedby={description ? undefined : undefined}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <D.Title className="text-[15px] font-medium">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-[13px] text-ink-3">{description}</D.Description> : null}
            </div>
            <D.Close className="-mr-2 -mt-1 rounded-md p-2 text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 2l10 10M12 2L2 12" />
              </svg>
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Confirm({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onCancel,
  busy,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  /** Runs only when the cancel button itself is pressed (not on Escape / outside click). */
  onCancel?: () => void;
  busy?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <A.Root open={open} onOpenChange={onOpenChange}>
      <A.Portal>
        <A.Overlay className={overlay} />
        <A.Content className={cn(panel, "p-5 sm:p-6")}>
          <A.Title className="font-serif text-[22px] leading-tight">{title}</A.Title>
          <A.Description asChild>
            <div className="mt-2 text-sm text-ink-2">{description}</div>
          </A.Description>
          {children}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <A.Cancel asChild>
              <Button variant="secondary" size="lg" className="sm:h-10 sm:text-sm" onClick={onCancel}>
                {cancelLabel}
              </Button>
            </A.Cancel>
            <Button
              variant={tone === "danger" ? "danger" : "primary"}
              size="lg"
              className="sm:h-10 sm:text-sm"
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? "Saving…" : confirmLabel}
            </Button>
          </div>
        </A.Content>
      </A.Portal>
    </A.Root>
  );
}
