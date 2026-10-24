import { contourLines, evenLevels } from "@/lib/landscape/contours";
import { buildTerrain } from "@/lib/landscape/terrain";

const W = 1000;
const H = 600;

/** Terrain with no data: the seeded base map. Used where a quiet brand surface is needed. */
export function ContourArt({ seed, className }: { seed: string; className?: string }) {
  const now = new Date("2026-01-01");
  const terrain = buildTerrain({ sessions: [], seed, start: now, end: now, cols: 110, rows: 66, aspect: W / H });
  const lines = contourLines(terrain.field, terrain.cols, terrain.rows, W, H, evenLevels(18));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
      {lines.map((l) => (
        <path
          key={l.level}
          d={l.d}
          fill="none"
          stroke={l.index ? "var(--contour-index)" : "var(--contour)"}
          strokeWidth={l.index ? 0.9 : 0.6}
          strokeOpacity={l.index ? 0.55 : 0.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
