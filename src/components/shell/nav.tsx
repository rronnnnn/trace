"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconExercises, IconHistory, IconLandscape, IconReflection, IconToday, IconTrain } from "@/components/icons";
import { Wordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";

const PRIMARY = [
  { href: "/", label: "Today", icon: IconToday },
  { href: "/train", label: "Train", icon: IconTrain },
  { href: "/landscape", label: "Landscape", icon: IconLandscape },
  { href: "/history", label: "History", icon: IconHistory },
] as const;

// Phase 2 destinations: visible so the product's shape is legible, but honestly inert.
const UPCOMING = [
  { label: "Exercises", icon: IconExercises },
  { label: "Reflections", icon: IconReflection },
] as const;

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`) || (href === "/train" && path === "/workout");
}

export function Sidebar({ name, email }: { name: string | null; email: string | null }) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-[216px] shrink-0 flex-col border-r border-line px-4 py-7 md:flex">
      <Wordmark className="px-3" />
      <nav className="mt-10 flex flex-col gap-0.5" aria-label="Main">
        {PRIMARY.map(({ href, label, icon: Icon }) => {
          const active = isActive(path, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-3 rounded-md px-3 text-[14px] transition-colors",
                active ? "bg-sunken text-ink" : "text-ink-2 hover:bg-sunken/60 hover:text-ink",
              )}
            >
              <Icon className={active ? "text-ink" : "text-ink-3"} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-8 px-3">
        <p className="eyebrow">Coming next</p>
        <ul className="mt-2 flex flex-col gap-0.5">
          {UPCOMING.map(({ label, icon: Icon }) => (
            <li key={label} className="flex h-9 items-center gap-3 text-[14px] text-ink-4">
              <Icon />
              {label}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-auto border-t border-line px-3 pt-4">
        <p className="truncate text-[13px] font-medium">{name ?? "Your account"}</p>
        {email ? <p className="truncate text-xs text-ink-3">{email}</p> : null}
        <form action="/auth/sign-out" method="post">
          <button className="mt-2 text-xs text-ink-3 underline-offset-4 hover:text-ink hover:underline">Sign out</button>
        </form>
      </div>
    </aside>
  );
}

export function MobileTabs() {
  const path = usePathname();
  if (path === "/workout") return null;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto flex max-w-md">
        {PRIMARY.map(({ href, label, icon: Icon }) => {
          const active = isActive(path, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn("flex h-14 flex-col items-center justify-center gap-1 text-[11px]", active ? "text-ink" : "text-ink-3")}
              >
                <Icon />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
