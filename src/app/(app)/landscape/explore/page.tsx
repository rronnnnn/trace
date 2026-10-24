import type { Metadata } from "next";
import { loadLandscape } from "../data";
import { ExploreView } from "./explore-view";

export const metadata: Metadata = { title: "Explore landscape" };

export default async function ExplorePage({ searchParams }: PageProps<"/landscape/explore">) {
  const { sessions, range, win, tz, userId, profile } = await loadLandscape(await searchParams);
  return (
    <ExploreView
      sessions={sessions}
      range={range}
      window={win}
      timeZone={tz}
      seed={userId}
      unit={profile.unit}
      trainingDays={profile.training_days}
    />
  );
}
