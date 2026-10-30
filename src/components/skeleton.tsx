import { cn } from "@/lib/utils";

/**
 * Loading placeholders shaped like the content they stand for: the same widths, heights and
 * rhythm, so nothing jumps when the page arrives. Quiet pulse, no spinners.
 */
export function Bone({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-sunken", className)} />;
}

/** The standard page head: eyebrow, serif title, one line of description. */
export function HeadSkeleton({ action = false }: { action?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="w-full max-w-xl">
        <Bone className="h-3 w-24" />
        <Bone className="mt-4 h-10 w-80 max-w-full sm:h-12" />
        <Bone className="mt-4 h-4 w-full max-w-md" />
      </div>
      {action ? <Bone className="h-10 w-32 rounded-md" /> : null}
    </div>
  );
}

export function RowsSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("border-t border-line", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-line py-4">
          <Bone className="h-4 w-14" />
          <div className="flex-1 space-y-2">
            <Bone className="h-4 w-1/2" />
            <Bone className="h-3 w-1/3 bg-sunken/70" />
          </div>
          <Bone className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-6 border-y border-line py-6 sm:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <Bone className="h-7 w-20" />
          <Bone className="mt-2 h-3 w-16 bg-sunken/70" />
        </div>
      ))}
    </div>
  );
}

export function ColumnsSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-28 items-end gap-[2px]", className)}>
      {Array.from({ length: 16 }, (_, i) => (
        <Bone key={i} className="flex-1 rounded-b-none" />
      ))}
    </div>
  );
}

export const pageShell = "mx-auto w-full max-w-[1120px] px-5 pb-20 pt-8 sm:px-8 md:pt-14 lg:px-14";
