import type { Metadata } from "next";
import { loadLandscape } from "../data";
import { ExploreView } from "./explore-view";

export const metadata: Metadata = { title: "Explore landscape" };

export default async function ExplorePage({ searchParams }: PageProps<"/landscape/explore">) {
  const sp = await searchParams;
  const { sessions, history, range, win, tz, userId, profile } = await loadLandscape(sp);
  const grew = typeof sp.grew === "string" && history.some((h) => h.id === sp.grew) ? sp.grew : null;
  return (
    <ExploreView
      sessions={sessions}
      history={history}
      grew={grew}
      range={range}
      window={win}
      timeZone={tz}
      seed={userId}
      unit={profile.unit}
      trainingDays={profile.training_days}
    />
  );
}
