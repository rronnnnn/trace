import { Bone, pageShell, StatsSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className={pageShell} aria-busy="true" aria-label="Loading run">
      <Bone className="h-4 w-14" />
      <Bone className="mt-6 h-3 w-36" />
      <Bone className="mt-4 h-12 w-72 max-w-full" />
      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-8 border-t border-line pt-8 md:grid-cols-[5fr_4fr]">
        <div className="space-y-6">
          {Array.from({ length: 3 }, (_, i) => (
            <Bone key={i} className="h-14 w-56" />
          ))}
        </div>
        <Bone className="aspect-[4/3] w-full max-w-sm justify-self-center" />
      </div>
      <div className="mt-10">
        <StatsSkeleton count={5} />
      </div>
      <Bone className="mt-12 aspect-[8/5] w-full rounded-lg" />
    </main>
  );
}
