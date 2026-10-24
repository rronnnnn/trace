import { Wordmark } from "@/components/wordmark";
import { ContourArt } from "@/components/landscape/contour-art";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12 lg:px-16">
        <Wordmark />
        <div className="flex flex-1 items-center">
          <div className="w-full max-w-sm py-12">{children}</div>
        </div>
        <p className="text-xs text-ink-3">A personal record of becoming stronger.</p>
      </div>
      <div className="relative hidden overflow-hidden border-l border-line bg-surface lg:block">
        <ContourArt seed="trace" className="absolute inset-0 h-full w-full" />
      </div>
    </main>
  );
}
