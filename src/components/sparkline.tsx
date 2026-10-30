/** Recent values at a glance: the history in ink, the latest point as a sage dot. No axes. */
export function Sparkline({ values, className, label }: { values: number[]; className?: string; label: string }) {
  const w = 120;
  const h = 28;
  if (values.length < 2) return <span className={className} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => [2 + (i / (values.length - 1)) * (w - 6), h - 4 - ((v - min) / (max - min || 1)) * (h - 8)]);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className} role="img" aria-label={label}>
      <polyline
        points={pts.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke="var(--ink-3)"
        strokeOpacity={0.55}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lx} cy={ly} r={3} fill="var(--sage)" stroke="var(--paper)" strokeWidth={1.5} />
    </svg>
  );
}
