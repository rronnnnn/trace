import Link from "next/link";
import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("inline-block text-[13px] font-semibold tracking-[0.42em] text-ink", className)} aria-label="TRACE home">
      TRACE
    </Link>
  );
}
