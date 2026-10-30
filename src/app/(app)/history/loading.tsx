import { Bone, pageShell, RowsSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className={pageShell.replace("max-w-[1120px]", "max-w-[880px]")} aria-busy="true" aria-label="Loading history">
      <Bone className="h-12 w-48" />
      <Bone className="mt-4 h-4 w-40" />
      <Bone className="mt-10 h-3 w-28" />
      <RowsSkeleton rows={7} className="mt-3" />
    </main>
  );
}
