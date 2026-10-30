import { Bone, ColumnsSkeleton, HeadSkeleton, pageShell, RowsSkeleton, StatsSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className={pageShell} aria-busy="true" aria-label="Loading runs">
      <HeadSkeleton action />
      <div className="mt-10">
        <StatsSkeleton />
      </div>
      <ColumnsSkeleton className="mt-12 h-32" />
      <Bone className="mt-12 h-3 w-28" />
      <RowsSkeleton rows={5} className="mt-3" />
    </main>
  );
}
