/** Shown while a page's data loads: the page's rhythm in placeholder form, no spinner. */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 pt-8 sm:px-8 md:pt-14 lg:px-14" aria-busy="true" aria-label="Loading">
      <div className="h-3 w-32 animate-pulse rounded bg-sunken" />
      <div className="mt-4 h-10 w-72 max-w-full animate-pulse rounded bg-sunken" />
      <div className="mt-12 border-t border-line pt-8">
        <div className="grid gap-10 md:grid-cols-[5fr_7fr]">
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-sunken/80" />
            ))}
          </div>
          <div className="aspect-[6/5] animate-pulse rounded-md bg-sunken/60" />
        </div>
      </div>
    </main>
  );
}
