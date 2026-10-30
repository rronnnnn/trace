import { Bone, HeadSkeleton, pageShell, RowsSkeleton, StatsSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className={pageShell} aria-busy="true" aria-label="Loading the Atlas">
      <HeadSkeleton />
      <div className="mt-10">
        <StatsSkeleton count={5} />
      </div>
      <Bone className="mt-14 h-8 w-64" />
      <Bone className="mt-4 h-9 w-full max-w-lg rounded-md" />
      <Bone className="mt-4 h-[58dvh] min-h-[340px] w-full rounded-lg sm:h-[540px]" />
      <RowsSkeleton rows={4} className="mt-16" />
    </main>
  );
}
