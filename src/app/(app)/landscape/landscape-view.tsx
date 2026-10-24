"use client";

import { useRouter } from "next/navigation";
import { useCallback, type ComponentProps } from "react";
import { LandscapeExplorer, type Selection } from "@/components/landscape/landscape-explorer";
import type { RangeId } from "@/lib/landscape/explore";

function toQuery(range: RangeId, s: Selection) {
  const q = new URLSearchParams();
  if (range !== "12w") q.set("range", range);
  if (s.templateId) q.set("workout", s.templateId);
  if (s.exerciseId) q.set("exercise", s.exerciseId);
  if (s.session) q.set("session", s.session);
  else if (s.week) q.set("week", s.week);
  const str = q.toString();
  return str ? `/landscape?${str}` : "/landscape";
}

/** Binds the explorer to the URL: selection is shareable and survives refresh; a new period refetches. */
export function LandscapeView(props: Omit<ComponentProps<typeof LandscapeExplorer>, "onRangeChange" | "onSelectionChange">) {
  const router = useRouter();
  const { range, initial } = props;
  const onSelectionChange = useCallback((s: Selection) => window.history.replaceState(null, "", toQuery(range, s)), [range]);
  const onRangeChange = useCallback(
    (r: RangeId) => router.push(toQuery(r, { ...initial, ...readSelection(), week: null, session: null }), { scroll: false }),
    [router, initial],
  );
  return <LandscapeExplorer key={range} {...props} onRangeChange={onRangeChange} onSelectionChange={onSelectionChange} />;
}

function readSelection(): Partial<Selection> {
  const q = new URLSearchParams(window.location.search);
  return { templateId: q.get("workout"), exerciseId: q.get("exercise") };
}
