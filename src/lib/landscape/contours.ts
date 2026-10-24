/**
 * Marching squares → chained polylines → smoothed SVG path data.
 * Segments are joined through the grid edges they cross, so chaining is exact.
 */

type Pt = [number, number];

export type ContourLine = { level: number; index: boolean; d: string };

// Edge ids within a cell
const TOP = 0;
const RIGHT = 1;
const BOTTOM = 2;
const LEFT = 3;

// Segment table by case (tl=8, tr=4, br=2, bl=1); saddles (5, 10) are resolved at runtime.
const TABLE: Record<number, [number, number][]> = {
  1: [[LEFT, BOTTOM]],
  2: [[BOTTOM, RIGHT]],
  3: [[LEFT, RIGHT]],
  4: [[TOP, RIGHT]],
  6: [[TOP, BOTTOM]],
  7: [[LEFT, TOP]],
  8: [[LEFT, TOP]],
  9: [[TOP, BOTTOM]],
  11: [[TOP, RIGHT]],
  12: [[LEFT, RIGHT]],
  13: [[BOTTOM, RIGHT]],
  14: [[LEFT, BOTTOM]],
};

export function contourLines(
  field: Float32Array,
  cols: number,
  rows: number,
  width: number,
  height: number,
  levels: number[],
  indexEvery = 5,
): ContourLine[] {
  const sx = width / (cols - 1);
  const sy = height / (rows - 1);
  const v = (i: number, j: number) => field[j * cols + i];

  // Global edge key: horizontal edges even, vertical edges odd.
  const hKey = (i: number, j: number) => 2 * (j * cols + i);
  const vKey = (i: number, j: number) => 2 * (j * cols + i) + 1;

  return levels.map((level, li) => {
    const points = new Map<number, Pt>();
    const links = new Map<number, number[]>();

    const point = (key: number, a: Pt, b: Pt, va: number, vb: number) => {
      if (!points.has(key)) {
        const t = va === vb ? 0.5 : (level - va) / (vb - va);
        points.set(key, [(a[0] + (b[0] - a[0]) * t) * sx, (a[1] + (b[1] - a[1]) * t) * sy]);
      }
      return key;
    };
    const link = (a: number, b: number) => {
      (links.get(a) ?? links.set(a, []).get(a)!).push(b);
      (links.get(b) ?? links.set(b, []).get(b)!).push(a);
    };

    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const tl = v(i, j);
        const tr = v(i + 1, j);
        const br = v(i + 1, j + 1);
        const bl = v(i, j + 1);
        const c = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
        if (c === 0 || c === 15) continue;

        const edge = (e: number) => {
          switch (e) {
            case TOP:
              return point(hKey(i, j), [i, j], [i + 1, j], tl, tr);
            case RIGHT:
              return point(vKey(i + 1, j), [i + 1, j], [i + 1, j + 1], tr, br);
            case BOTTOM:
              return point(hKey(i, j + 1), [i, j + 1], [i + 1, j + 1], bl, br);
            default:
              return point(vKey(i, j), [i, j], [i, j + 1], tl, bl);
          }
        };

        let segs = TABLE[c];
        if (c === 5 || c === 10) {
          const centerHigh = (tl + tr + br + bl) / 4 >= level;
          segs =
            (c === 5) === centerHigh
              ? [
                  [LEFT, TOP],
                  [BOTTOM, RIGHT],
                ]
              : [
                  [LEFT, BOTTOM],
                  [TOP, RIGHT],
                ];
        }
        for (const [a, b] of segs) link(edge(a), edge(b));
      }
    }

    // Walk chains. Start from open ends first so open lines are not split.
    const visited = new Set<number>();
    const chains: Pt[][] = [];
    const walk = (startKey: number) => {
      const chain: Pt[] = [points.get(startKey)!];
      visited.add(startKey);
      let prev = -1;
      let cur = startKey;
      for (;;) {
        const nexts = links.get(cur)!;
        const nxt = nexts.find((n) => n !== prev && !visited.has(n));
        if (nxt === undefined) {
          // closed loop: reconnect to start
          if (nexts.includes(startKey) && chain.length > 2) chain.push(chain[0]);
          break;
        }
        visited.add(nxt);
        chain.push(points.get(nxt)!);
        prev = cur;
        cur = nxt;
      }
      if (chain.length > 2) chains.push(chain);
    };
    for (const [key, n] of links) if (n.length === 1 && !visited.has(key)) walk(key);
    for (const key of links.keys()) if (!visited.has(key)) walk(key);

    return { level, index: (li + 1) % indexEvery === 0, d: chains.map(smoothPath).join("") };
  });
}

/** Quadratic smoothing through segment midpoints. */
function smoothPath(pts: Pt[]): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  if (pts.length < 3) return `M${f(pts[0][0])} ${f(pts[0][1])}L${f(pts.at(-1)![0])} ${f(pts.at(-1)![1])}`;
  const closed = pts[0][0] === pts.at(-1)![0] && pts[0][1] === pts.at(-1)![1];
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d: string;
  if (closed) {
    const m0 = mid(pts[0], pts[1]);
    d = `M${f(m0[0])} ${f(m0[1])}`;
    for (let k = 1; k < pts.length - 1; k++) {
      const m = mid(pts[k], pts[k + 1]);
      d += `Q${f(pts[k][0])} ${f(pts[k][1])} ${f(m[0])} ${f(m[1])}`;
    }
    d += `Q${f(pts[0][0])} ${f(pts[0][1])} ${f(m0[0])} ${f(m0[1])}Z`;
  } else {
    d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let k = 1; k < pts.length - 1; k++) {
      const m = mid(pts[k], pts[k + 1]);
      d += `Q${f(pts[k][0])} ${f(pts[k][1])} ${f(m[0])} ${f(m[1])}`;
    }
    d += `L${f(pts.at(-1)![0])} ${f(pts.at(-1)![1])}`;
  }
  return d;
}

export function evenLevels(count: number, min = 0.04, max = 0.98) {
  return Array.from({ length: count }, (_, i) => min + ((max - min) * i) / (count - 1));
}
