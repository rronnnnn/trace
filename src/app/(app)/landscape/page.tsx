import type { Metadata } from "next";
import Link from "next/link";
import { IconExpand } from "@/components/icons";
import { buttonClass } from "@/components/ui/button";
import { weekOfSession } from "@/lib/landscape/explore";
import { loadLandscape, param } from "./data";
import { LandscapeView } from "./landscape-view";

export const metadata: Metadata = { title: "Landscape" };

export default async function LandscapePage({ searchParams }: PageProps<"/landscape">) {
  const sp = await searchParams;
  const { sessions, range, win, tz, userId, profile, muscles, totalSessionsEver } = await loadLandscape(sp);
  const sessionId = param(sp.session);
  const linked = sessions.find((s) => s.id === sessionId);
  const week = typeof sp.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : null;

  return (
    <main className="mx-auto w-full max-w-[1440px] px-4 pb-20 pt-8 sm:px-8 md:pt-14 lg:px-12">
      <header className="relative">
        <Link
          href={`/landscape/explore${range !== "12w" ? `?range=${range}` : ""}`}
          className={buttonClass({ size: "lg", className: "mb-6 sm:absolute sm:right-0 sm:top-0 sm:mb-0" })}
        >
          <IconExpand /> Explore landscape
        </Link>
        <p className="eyebrow">Training landscape</p>
        <h1 className="mt-3 font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[52px]">Your training, mapped.</h1>
        <p className="mt-3 max-w-2xl text-[15px] text-ink-2">
          Each routine raises its own range, climbed session by session from its first workout to its latest. Every session builds it higher
          in proportion to its volume, and records stand as landmarks. The river runs through time, oldest on the left, and widens into
          lakes on your rest days.
        </p>
      </header>
      <LandscapeView
        sessions={sessions}
        range={range}
        window={win}
        timeZone={tz}
        seed={userId}
        unit={profile.unit}
        muscles={muscles}
        totalSessionsEver={totalSessionsEver}
        trainingDays={profile.training_days}
        initial={{
          templateId: param(sp.workout),
          exerciseId: param(sp.exercise),
          session: linked?.id ?? null,
          week: linked ? (weekOfSession(linked, win.weeks, tz)?.key ?? null) : win.weeks.some((w) => w.key === week) ? week : null,
        }}
      />
    </main>
  );
}
