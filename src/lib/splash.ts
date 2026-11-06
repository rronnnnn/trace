/**
 * Launch splash, after the "Trace Splash" design: a contoured mountain rises, the trail climbs to
 * the summit, the wordmark settles, then it all fades into the app.
 *
 * It runs as an inline script at the top of <body>, before React or any bundle has loaded, so it is
 * the first thing painted on a slow connection. It appends its own node to <body> (React 19 skips
 * unexpected body children while hydrating) and holds on the finished frame until the page has
 * loaded. It plays once per browsing session: every cold launch of the home-screen app, but not on
 * reloads in a tab.
 *
 * `runSplash` is serialised with toString(), so it must stay self-contained: no imports, no
 * references to anything outside its own body.
 */
function runSplash() {
  try {
    if (sessionStorage.getItem("trace:splash")) return;
    sessionStorage.setItem("trace:splash", "1");
  } catch {
    // storage blocked: play anyway
  }

  const NS = "http://www.w3.org/2000/svg";
  const W = 1080, H = 2340;
  const CX = 540, CY = 1240, PHI = 0.52, D = 2600, HMAX = 470, NR = 38, NA = 96;
  const BG = "#121211", INK = "#EDEBE5", SAGE = "#B9CBA6", LIME = "#CFD99A";
  // scene cues (seconds): Climb 0 → Mark 1.6 → Out 2.6 → end 3.0
  const MARK = 1.6, OUT = 2.6, END = 3.0;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const easeOutCubic = (t: number) => (t - 1) * (t - 1) * (t - 1) + 1;
  const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1);
  const easeOutBack = (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
  const tween = (ease: (t: number) => number, s: number, e: number) => (t: number) =>
    t <= s ? 0 : t >= e ? 1 : ease((t - s) / (e - s));
  const enter = (s: number, e: number) => tween(easeOutCubic, s, e);
  const draw_ = (s: number, e: number) => tween(easeInOutCubic, s, e);
  const pop = (s: number, e: number) => tween(easeOutBack, s, e);

  const R = (th: number) =>
    560 * (1 + 0.16 * Math.sin(2 * th + 0.6) + 0.08 * Math.sin(3 * th + 2) + 0.045 * Math.sin(5 * th + 1) + 0.02 * Math.sin(9 * th));
  // h(u) = (1 - u^1.4)^2: rounded summit, concave lower slopes
  const rAt = (th: number, q: number) => R(th) * Math.pow(Math.max(0, 1 - Math.sqrt(q)), 1 / 1.4);
  const world = (th: number, q: number, elev: number, rs: number) => {
    const r = rAt(th, q) * rs;
    return [-60 * q + Math.cos(th) * r, q * HMAX * elev, -40 * q + Math.sin(th) * r];
  };
  const project = (p: number[], yaw: number) => {
    const x = p[0], y = p[1], z = p[2];
    const xr = x * Math.cos(yaw) - z * Math.sin(yaw), zr = x * Math.sin(yaw) + z * Math.cos(yaw);
    const depth = zr * Math.cos(PHI) + y * Math.sin(PHI);
    const k = D / (D - depth);
    return [CX + xr * k, CY + (zr * Math.sin(PHI) - y * Math.cos(PHI)) * k];
  };
  const poly = (pts: number[][]) => "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L");

  const el = (tag: string, attrs: Record<string, string | number>, parent?: Element) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
    if (parent) parent.appendChild(n);
    return n;
  };

  const root = document.createElement("div");
  root.setAttribute("aria-hidden", "true");
  root.style.cssText = `position:fixed;inset:0;z-index:2147483000;background:${BG};overflow:hidden;pointer-events:none;transition:none`;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet", width: "100%", height: "100%" });
  svg.innerHTML = `<defs>
    <radialGradient id="ts-fog"><stop offset="0" stop-color="${SAGE}" stop-opacity="0.13"/><stop offset="0.6" stop-color="${SAGE}" stop-opacity="0.04"/><stop offset="1" stop-color="${SAGE}" stop-opacity="0"/></radialGradient>
    <radialGradient id="ts-glow"><stop offset="0" stop-color="${LIME}" stop-opacity="0.55"/><stop offset="1" stop-color="${LIME}" stop-opacity="0"/></radialGradient>
    <linearGradient id="ts-rock" gradientUnits="userSpaceOnUse" x1="${CX - 600}" y1="${CY - 500}" x2="${CX + 600}" y2="${CY + 300}"><stop offset="0" stop-color="#262a22"/><stop offset="0.5" stop-color="#1a1c18"/><stop offset="1" stop-color="#111210"/></linearGradient>
    <radialGradient id="ts-light"><stop offset="0" stop-color="#9fb08a" stop-opacity="0.12"/><stop offset="1" stop-color="#9fb08a" stop-opacity="0"/></radialGradient>
    <radialGradient id="ts-shadow"><stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <clipPath id="ts-massif"><path id="ts-base"/></clipPath>
  </defs>`;
  const base = svg.querySelector("#ts-base")!;
  const stage = el("g", {}, svg);
  const fog = el("ellipse", { cx: CX - 60, cy: CY - 260, rx: 760, ry: 640, fill: "url(#ts-fog)" }, stage);
  const land = el("g", {}, stage);
  const ground = [1.12, 1.32, 1.58, 1.9, 2.3].map((_, i) =>
    el("path", { fill: "none", stroke: `rgba(185,203,166,${0.09 - i * 0.015})`, "stroke-width": 1.4 }, land),
  );
  const SPECKS: number[][] = [];
  for (let i = 0; i < 46; i++) SPECKS.push([(i * 2.39996) % (Math.PI * 2), 0.02 + ((i * 0.618) % 1) * 0.42, 1.02 + ((i * 0.37) % 0.25)]);
  const specks = SPECKS.map(() => el("circle", { r: 2.6, fill: SAGE }, land));
  const rings: Element[] = [];
  for (let i = 0; i < NR; i++)
    rings.push(
      el("path", { fill: "url(#ts-rock)", stroke: `rgba(176,196,150,${0.1 + (0.22 * i) / NR})`, "stroke-width": 1.3, "stroke-linejoin": "round" }, land),
    );
  const shading = el("g", { "clip-path": "url(#ts-massif)" }, land);
  el("ellipse", { cx: CX - 220, cy: CY - 330, rx: 420, ry: 300, fill: "url(#ts-light)" }, shading);
  el("ellipse", { cx: CX + 300, cy: CY + 40, rx: 460, ry: 300, fill: "url(#ts-shadow)" }, shading);

  const LANDMARKS = [[1.25, 0.12], [2.35, 0.2], [0.55, 0.3], [1.9, 0.46], [2.7, 0.08], [0.9, 0.62]];
  const marks = LANDMARKS.map(() => {
    const g = el("g", {}, stage);
    return [
      g,
      el("circle", { fill: "url(#ts-glow)" }, g),
      el("circle", { fill: "none", stroke: LIME, "stroke-opacity": 0.55, "stroke-width": 2.5 }, g),
      el("circle", { fill: LIME }, g),
    ];
  });
  const trailPath = el("path", { fill: "none", stroke: SAGE, "stroke-width": 4.5, "stroke-linecap": "round", "stroke-linejoin": "round" }, stage);
  const STOPS = [0.22, 0.45, 0.66, 0.84];
  const stops = STOPS.map(() => el("circle", { fill: BG, stroke: INK, "stroke-width": 3.5 }, stage));
  const headG = el("g", {}, stage);
  const headGlow = el("circle", { r: 26, fill: "url(#ts-glow)" }, headG);
  const headDot = el("circle", { r: 8, fill: LIME }, headG);
  const summitG = el("g", {}, stage);
  const sGlow = el("circle", { fill: "url(#ts-glow)" }, summitG);
  const sHalo = el("circle", { fill: "none", stroke: LIME, "stroke-width": 3 }, summitG);
  const sRing = el("circle", { fill: "none", stroke: LIME, "stroke-opacity": 0.45, "stroke-width": 3 }, summitG);
  const sDot = el("circle", { fill: LIME }, summitG);
  const flag = el("g", {}, summitG);
  el("rect", { x: -1.5, y: -66, width: 3, height: 66, fill: INK }, flag);
  el("path", { d: "M1.5 -66 L38 -55 L1.5 -44 Z", fill: INK }, flag);
  const WM_W = 560, WM_H = (560 * 118) / 973;
  const word = el("image", { href: "/trace-wordmark.png", x: CX - WM_W / 2, y: 1640, width: WM_W, height: WM_H }, stage);
  root.appendChild(svg);
  // the design's vignette, as CSS so it reaches the screen edges beyond the artboard
  const vig = document.createElement("div");
  vig.style.cssText = "position:absolute;inset:0;background:radial-gradient(75% 60% at 50% 47%,rgba(0,0,0,0) 45%,rgba(0,0,0,.7) 100%)";
  root.appendChild(vig);
  document.body.appendChild(root);

  const frame = (T: number) => {
    const rise = enter(0, MARK + 0.2)(T);
    const elev = 0.55 + 0.45 * rise;
    const appear = enter(0, 0.6)(T);
    const draw = draw_(0.4, MARK)(T);
    const summit = pop(MARK - 0.05, MARK + 0.35)(T);
    const halo = enter(MARK, MARK + 0.9)(T);
    const mark = enter(MARK + 0.1, MARK + 0.8)(T);
    const out = 1 - enter(OUT, OUT + 0.4)(T);
    const drift = enter(0, OUT + 0.4)(T);
    const yaw = -0.28 + 0.3 * drift;

    // translateY then scale about (CX, CY - 300), as the design's CSS transform
    stage.setAttribute("transform", `translate(${CX} ${CY - 300 + 30 - 50 * drift}) scale(${0.96 + 0.06 * drift}) translate(${-CX} ${-(CY - 300)})`);
    root.style.opacity = String(out);
    fog.setAttribute("opacity", String(appear));
    land.setAttribute("opacity", String(appear));

    for (let i = 0; i < NR; i++) {
      const q = i / NR, pts: number[][] = [];
      for (let k = 0; k < NA; k++) {
        const th = (k / NA) * Math.PI * 2;
        const wob = 1 + 0.035 * Math.sin(7 * th + q * 9) + 0.02 * Math.sin(13 * th - q * 14);
        pts.push(project(world(th, q, elev, wob), yaw));
      }
      rings[i].setAttribute("d", poly(pts) + "Z");
    }
    const bpts: number[][] = [];
    for (let k = 0; k < NA; k++) bpts.push(project(world((k / NA) * Math.PI * 2, 0, elev, 1), yaw));
    base.setAttribute("d", poly(bpts) + "Z");
    [1.12, 1.32, 1.58, 1.9, 2.3].forEach((s, i) => {
      const pts: number[][] = [];
      for (let a = 0; a < 90; a++) {
        const th = (a / 90) * Math.PI * 2, r = R(th + i * 0.7) * s;
        pts.push(project([Math.cos(th) * r, 0, Math.sin(th) * r * 0.9], yaw));
      }
      ground[i].setAttribute("d", poly(pts) + "Z");
    });
    SPECKS.forEach((sp, i) => {
      const p = project(world(sp[0], sp[1], elev, sp[2]), yaw);
      specks[i].setAttribute("cx", p[0].toFixed(1));
      specks[i].setAttribute("cy", p[1].toFixed(1));
      specks[i].setAttribute("opacity", String(0.35 * enter(0.2 + (i % 10) * 0.04, 0.8 + (i % 10) * 0.04)(T)));
    });
    LANDMARKS.forEach((lm, i) => {
      const p = project(world(lm[0], lm[1], elev, 0.99), yaw);
      const s = pop(0.5 + i * 0.12, 0.85 + i * 0.12)(T);
      const m = marks[i];
      m[0].setAttribute("opacity", s > 0 ? "1" : "0");
      [34, 15, 7].forEach((r, j) => {
        m[j + 1].setAttribute("cx", p[0].toFixed(1));
        m[j + 1].setAttribute("cy", p[1].toFixed(1));
        m[j + 1].setAttribute("r", String(Math.max(0, r * s)));
      });
    });

    const trail: number[][] = [];
    for (let s = 0; s <= 90; s++) {
      const q = (s / 90) * 0.995;
      const th = Math.PI / 2 + 0.75 - 1.4 * q + 0.2 * Math.sin(q * 10);
      trail.push(project(world(th, q, elev, 0.995), yaw));
    }
    const n = Math.max(1, Math.round(draw * (trail.length - 1)));
    trailPath.setAttribute("d", draw > 0 ? poly(trail.slice(0, n + 1)) : "");
    STOPS.forEach((u, i) => {
      const p = trail[Math.round(u * 90)];
      const s = easeOutBack(Math.min(1, Math.max(0, (draw - u) / 0.08)));
      stops[i].setAttribute("cx", p[0].toFixed(1));
      stops[i].setAttribute("cy", p[1].toFixed(1));
      stops[i].setAttribute("r", String(Math.max(0, draw > u ? 7.5 * s : 0)));
    });
    const head = trail[n];
    headG.setAttribute("opacity", draw > 0 && draw < 1 ? "1" : "0");
    for (const c of [headGlow, headDot]) {
      c.setAttribute("cx", head[0].toFixed(1));
      c.setAttribute("cy", head[1].toFixed(1));
    }
    const peak = project(world(0, 1, elev, 1), yaw);
    summitG.setAttribute("opacity", summit > 0 ? "1" : "0");
    const radii: [Element, number][] = [[sGlow, 60 * summit], [sHalo, 18 + 80 * halo], [sRing, 26 * summit], [sDot, 12 * summit]];
    for (const [c, r] of radii) {
      c.setAttribute("cx", peak[0].toFixed(1));
      c.setAttribute("cy", peak[1].toFixed(1));
      c.setAttribute("r", String(Math.max(0, r)));
    }
    sHalo.setAttribute("opacity", String((1 - halo) * 0.7));
    flag.setAttribute("transform", `translate(${peak[0] + 3} ${peak[1] - 14}) scale(${Math.max(0, summit)})`);
    word.setAttribute("opacity", String(mark));
    word.setAttribute("transform", `translate(0 ${(1 - mark) * 28})`);
  };

  // Hold on the finished frame until the app has loaded; never longer than 8 s in all.
  let loaded = document.readyState === "complete";
  window.addEventListener("load", () => (loaded = true), { once: true });
  const t0 = performance.now();
  let T = reduced ? OUT : 0;
  let last = t0;
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const ready = loaded || now - t0 > 8000;
    T = T + dt < OUT || ready ? T + dt : OUT;
    if (T >= END) return void root.remove();
    frame(T);
    requestAnimationFrame(tick);
  };
  frame(T);
  requestAnimationFrame(tick);
}

export const splashScript = `(${runSplash.toString()})()`;
