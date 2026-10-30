import { HeadSkeleton, pageShell, RowsSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className={pageShell} aria-busy="true" aria-label="Loading">
      <HeadSkeleton />
      <RowsSkeleton rows={7} className="mt-12" />
    </main>
  );
}
