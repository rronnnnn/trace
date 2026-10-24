"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { contourLines, evenLevels, resampleField } from "@/lib/landscape/contours";
import { restSpans } from "@/lib/landscape/rest";
import { buildTerrain, type LandscapeSession } from "@/lib/landscape/terrain";
import { ContourLayer, MapTooltip, MarkerGlyph, markerLabel, ReliefLayer, VegetationLayer, WaterLayer } from "./landscape-parts";
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
  trainingDays = [],
  timeZone = "UTC",
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
  trainingDays?: number[];
  timeZone?: string;
}) {
  const titleId = useId();
  const { terrain, lines } = useMemo(() => {
    const s = new Date(start);
    const e = new Date(end);
    const terrain = buildTerrain({
      sessions,
      seed,
      start: s,
      end: e,
      cols: compact ? 130 : 190,
      rows: Math.round((compact ? 130 : 190) * (height / width)),
      aspect: width / height,
      rest: restSpans({ start: s, end: e, timeZone, trainingDays, sessionEndedAts: sessions.map((x) => x.endedAt) }),
    });
    const cc = compact ? 84 : 120;
    const cr = Math.round(cc * (height / width));
    const coarse = resampleField(terrain.field, terrain.cols, terrain.rows, cc, cr);
    return { terrain, lines: contourLines(coarse, cc, cr, width, height, evenLevels(levels)) };
  }, [sessions, seed, start, end, compact, width, height, levels, timeZone, trainingDays]);

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
        <ReliefLayer terrain={terrain} width={width} height={height} />
        <ContourLayer lines={lines} />
        <WaterLayer terrain={terrain} width={width} height={height} />
        <VegetationLayer terrain={terrain} seed={seed} width={width} height={height} />
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
