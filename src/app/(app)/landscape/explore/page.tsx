import type { Metadata } from "next";
import { loadLandscape } from "../data";
import { ExploreView } from "./explore-view";

export const metadata: Metadata = { title: "Explore landscape" };

export default async function ExplorePage({ searchParams }: PageProps<"/landscape/explore">) {
  const sp = await searchParams;
  const { sessions, history, range, win, tz, userId, profile } = await loadLandscape(sp);
  const focus = typeof sp.place === "string" && /^(landmark:[\w:.-]{1,120}|summit:\d{1,2})$/.test(sp.place) ? (sp.place as `landmark:${string}`) : null;
  const grew = typeof sp.grew === "string" && history.some((h) => h.id === sp.grew) ? sp.grew : null;
  return (
    <ExploreView
      sessions={sessions}
      history={history}
      grew={grew}
      focus={focus}
      range={range}
      window={win}
      timeZone={tz}
      seed={userId}
      unit={profile.unit}
      trainingDays={profile.training_days}
    />
  );
}
