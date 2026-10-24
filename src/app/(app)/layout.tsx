import { ActiveWorkoutBar } from "@/components/shell/active-workout-bar";
import { MobileTabs, Sidebar } from "@/components/shell/nav";
import { SyncAgent } from "@/components/shell/sync-agent";
import { TzSync } from "@/components/shell/tz-sync";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [{ userId, email, profile }, tz] = await Promise.all([requireProfile(), getTimeZone()]);
  return (
    <div className="flex min-h-dvh">
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-ink px-4 py-2 text-sm text-paper focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <Sidebar name={profile.display_name} email={email} />
      <div id="content" tabIndex={-1} className="min-w-0 flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] outline-none md:pb-0">
        {children}
      </div>
      <MobileTabs />
      <ActiveWorkoutBar uid={userId} />
      <SyncAgent uid={userId} />
      <TzSync serverTz={tz} />
    </div>
  );
}
