import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-start px-6 pt-20 sm:pt-28">
      <p className="eyebrow">Not found</p>
      <h1 className="mt-3 font-serif text-[32px] leading-tight">There&apos;s nothing here.</h1>
      <p className="mt-3 text-ink-2">The page may have moved, or the session belongs to another account.</p>
      <Link href="/" className={`${buttonClass({ size: "lg" })} mt-8`}>
        Go to Today
      </Link>
    </main>
  );
}
