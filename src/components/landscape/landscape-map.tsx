"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { contourLines, evenLevels } from "@/lib/landscape/contours";
import { buildTerrain, type LandscapeSession } from "@/lib/landscape/terrain";
import { ContourLayer, MapTooltip, MarkerGlyph, markerLabel } from "./landscape-parts";
import { cn } from "@/lib/utils";

/**
 * Data-driven contour map of training history.
 * Compact preview: markers are focusable links into the full Landscape screen.
 */
export function LandscapeMap({
  sessions,
  seed,
  start,
  end,
  width = 1000,
  height = 600,
  levels = 16,
  compact = false,
  unit = "kg",
  className,
  label = "Training landscape",
  cover = false,
}: {
  sessions: LandscapeSession[];
  seed: string;
  start: string;
  end: string;
  width?: number;
  height?: number;
  levels?: number;
  compact?: boolean;
  unit?: string;
  className?: string;
  label?: string;
  /** Fill the parent (cropping edges) instead of keeping the full map visible. */
  cover?: boolean;
}) {
  const titleId = useId();
  const { terrain, lines } = useMemo(() => {
    const terrain = buildTerrain({
      sessions,
      seed,
      start: new Date(start),
      end: new Date(end),
      cols: compact ? 90 : 130,
      rows: compact ? 54 : 78,
      aspect: width / height,
    });
    return { terrain, lines: contourLines(terrain.field, terrain.cols, terrain.rows, width, height, evenLevels(levels)) };
  }, [sessions, seed, start, end, compact, width, height, levels]);

  const [active, setActive] = useState<string | null>(null);
  const activeMark = terrain.landmarks.find((l) => l.session.id === active);

  return (
    <div className={cn("relative", className)} style={cover ? undefined : { aspectRatio: `${width} / ${height}` }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio={cover ? "xMidYMid slice" : "xMidYMid meet"}
        className="block h-full w-full"
        role="group"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{`${label}: ${sessions.length} session${sessions.length === 1 ? "" : "s"}`}</title>
        <ContourLayer lines={lines} />
        {terrain.landmarks.map((l) => (
          <Link
            key={l.session.id}
            href={`/landscape?session=${l.session.id}`}
            onPointerEnter={() => setActive(l.session.id)}
            onPointerLeave={() => setActive((a) => (a === l.session.id ? null : a))}
            onFocus={() => setActive(l.session.id)}
            onBlur={() => setActive(null)}
            aria-label={markerLabel(l, unit)}
            className="outline-none"
          >
            <MarkerGlyph
              cx={l.x * width}
              cy={l.y * height}
              r={compact ? 3.2 : 4}
              record={l.session.prCount > 0}
              active={active === l.session.id}
            />
          </Link>
        ))}
        {activeMark ? <MapTooltip mark={activeMark} width={width} height={height} unit={unit} /> : null}
      </svg>
    </div>
  );
}
