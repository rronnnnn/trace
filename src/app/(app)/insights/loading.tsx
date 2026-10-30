import { Bone, ColumnsSkeleton, HeadSkeleton, pageShell, RowsSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className={pageShell} aria-busy="true" aria-label="Loading insights">
      <HeadSkeleton action />
      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-5 border-t border-line pt-8 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Bone key={i} className="h-7 w-11/12" />
        ))}
      </div>
      <ColumnsSkeleton className="mt-10" />
      <Bone className="mt-16 h-8 w-48" />
      <RowsSkeleton rows={4} className="mt-6" />
    </main>
  );
}
