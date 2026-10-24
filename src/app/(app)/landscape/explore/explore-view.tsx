"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { LandscapeExplore } from "@/components/landscape/landscape-explore";

export function ExploreView(props: Omit<ComponentProps<typeof LandscapeExplore>, "onRangeChange">) {
  const router = useRouter();
  return (
    <LandscapeExplore
      key={props.range}
      {...props}
      onRangeChange={(r) => router.replace(r === "12w" ? "/landscape/explore" : `/landscape/explore?range=${r}`, { scroll: false })}
    />
  );
}
