"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { contourChains, evenLevels, resampleField } from "@/lib/landscape/contours";
import type { LiftTrail, RegionSummary } from "@/lib/landscape/explore";
import { FRONTIER, type SummitSpot, type frontierGrid } from "@/lib/landscape/frontier";
import type { LandmarkCategory, Summit, WorldLandmark } from "@/lib/landscape/landmarks";
import { edgeFalloff, riverMesh, SIZE_X, SIZE_Z, terrainMesh, toWorld, type MeshPalette } from "@/lib/landscape/mesh";
import { parseColor, type RGB } from "@/lib/landscape/relief";
import type { RestSpan } from "@/lib/landscape/rest";
import { hashString, type Landmark } from "@/lib/landscape/terrain";
import type { World } from "@/lib/landscape/world";
import { formatShortDate, formatVolume, formatWeight, plural } from "@/lib/format";

export type Terrain3DHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  /** play the landmark-unlock sequence on a place; returns its length in ms (0 if not found) */
  unlock: (key: PlaceKey, info: { stats: string; accent: string | null }) => number;
};

/**
 * Landmark unlock, after the "Landmark Unlock" design: three beats on one authored time axis (s).
 * Approach: the camera drifts in while the locked marker pulses and contracts. Rise: the marker
 * pops in accent, two ripples spread and the landmark rises out of the ground. Reveal: a leader
 * line, the stats and the name settle in. Then it holds, and fades back into the world.
 */
export const UNLOCK = { rise: 0.8, reveal: 1.8, end: 3.0, hold: 2.6, fade: 0.6 };
const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
};
/** from → to between authored times a and b, eased */
const tween = (e: (t: number) => number) => (from: number, to: number, a: number, b: number) => (T: number) =>
  from + (to - from) * e(Math.min(1, Math.max(0, (T - a) / (b - a))));
const enter = tween(ease.outCubic);
const draw = tween(ease.inOutCubic);
const pop = tween(ease.outBack);

/** The unexplored world around the map, and the summits on it (see lib/landscape/frontier). */
export type FrontierScene = {
  grid: ReturnType<typeof frontierGrid>;
  spots: SummitSpot[];
  summits: Summit[];
};

/** A landmark where it stands on the map (normalised, beside the session that earned it). */
export type LandmarkSpot = { landmark: WorldLandmark; x: number; y: number };

/** What the scene can select besides sessions, rest and regions: `landmark:<id>` or `summit:<slot>`. */
export type PlaceKey = `landmark:${string}` | `summit:${number}`;

type Props = {
  terrain: World;
  /** an earlier state of the same world; when given, the terrain grows from it into `terrain` */
  from?: World | null;
  onGrowthDone?: () => void;
  timeZone: string;
  unit: string;
  tilted: boolean;
  selectedId: string | null;
  selectedRegion: string | null;
  regions: RegionSummary[];
  theme: number;
  frontier?: FrontierScene | null;
  landmarks?: LandmarkSpot[];
  /** the selected landmark or summit */
  selectedPlace?: PlaceKey | null;
  /** fly to this place once the scene is built (e.g. "locate" from the Atlas) */
  focusPlace?: PlaceKey | null;
  onSelectPlace?: (key: PlaceKey) => void;
  /** the scene is built and can play (e.g. an unlock) */
  onReady?: () => void;
  onSelectSession: (l: Landmark) => void;
  onSelectRegion: (key: string) => void;
  onSelectRest: (span: RestSpan) => void;
  onClearSelection: () => void;
};

const TILT_POLAR = 0.95; // radians from straight down, for the 3D view
const TILT_PORTRAIT = 0.78; // steadier on a tall screen: less sky, more ground
const HOME_DISTANCE = 96;
const ORTHO_HEIGHT = 74; // world units visible top-to-bottom in 2D at zoom 1
const CLOSE = 52; // camera distance under which every session shows
const MAX_TILT = 1.3; // radians from straight down: never quite to the horizon

/** CSS tokens are sRGB; three.js works in linear light, so convert on the way in. */
function cssColor(name: string, fallback: RGB): THREE.Color {
  const [r, g, b] = parseColor(getComputedStyle(document.documentElement).getPropertyValue(name), fallback);
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}

function palette(): MeshPalette {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string, f: RGB) => parseColor(css.getPropertyValue(n), f);
  return {
    low: v("--terrain-low", [158, 153, 132]),
    mid: v("--terrain-mid", [217, 212, 195]),
    high: v("--terrain-high", [247, 245, 239]),
    vegetation: v("--terrain-vegetation", [180, 187, 155]),
  };
}

const MIN_STOPS = 8;
const MAX_STOPS = 12;

/**
 * Waypoints up a range, foot to summit: `t` is the share of the climb (0 = the first session,
 * 1 = today's best). With a lift trail, each stop is a weight level and when it was first reached;
 * with fewer new bests than stops, the levels are spaced evenly between the first and the best.
 * Without a lift, the stops count workouts instead.
 */
export function progressStops(trail: LiftTrail | null, sessions: number, unit: string, timeZone: string) {
  const stops: { t: number; text: string }[] = [];
  if (trail) {
    const steps = trail.steps;
    const w0 = steps[0].weight;
    const span = Math.max(1e-6, steps.at(-1)!.weight - w0);
    const withDate = (w: number, at: string, first: boolean) =>
      `${formatWeight(w)} ${unit}${first ? ` · ${formatShortDate(at, timeZone)}` : ""}`;
    if (steps.length >= MIN_STOPS) {
      const every = Math.ceil(steps.length / MAX_STOPS);
      const keep = steps.filter((_, i) => i % every === 0 || i === steps.length - 1);
      keep.forEach((s, i) => stops.push({ t: (s.weight - w0) / span, text: withDate(s.weight, s.endedAt, i === 0) }));
    } else {
      for (let i = 0; i < MIN_STOPS; i++) {
        const t = i / (MIN_STOPS - 1);
        const level = i === MIN_STOPS - 1 ? steps.at(-1)!.weight : Math.round((w0 + span * t) * 2) / 2;
        const reached = steps.find((s) => s.weight >= level - 1e-9) ?? steps.at(-1)!;
        stops.push({ t, text: withDate(level, reached.endedAt, i === 0) });
      }
    }
  } else if (sessions >= 2) {
    let shown = 0;
    for (let i = 0; i < MIN_STOPS; i++) {
      const t = i / (MIN_STOPS - 1);
      const n = Math.round(1 + (sessions - 1) * t);
      // a dot for every stop; a label only where the count moves on
      stops.push({ t, text: n > shown ? (n === 1 ? "1st workout" : plural(n, "workout")) : "" });
      shown = n;
    }
  }
  return stops;
}

/** Soft round glow for data points, drawn as screen-sized sprites. */
const markerShader = {
  vertexShader: /* glsl */ `
    attribute float size;
    attribute float alpha;
    attribute vec3 tint;
    varying float vAlpha;
    varying vec3 vTint;
    uniform float uPixelRatio;
    void main() {
      vAlpha = alpha;
      vTint = tint;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * uPixelRatio;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    varying float vAlpha;
    varying vec3 vTint;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c) * 2.0;
      if (d > 1.0) discard;
      float core = smoothstep(0.42, 0.28, d);
      float glow = (1.0 - d) * 0.55;
      gl_FragColor = vec4(vTint, (core + glow * (1.0 - core)) * vAlpha);
    }`,
};

/**
 * The Training Landscape as a sculpted 3D scene: smoothed terrain with soft light, fine draped
 * contours, a muted river in its valley, and quiet data points (records in sage; other
 * sessions appear up close or with their region). 2D is a true orthographic, flat map of the
 * same scene. Labels are HTML projected from 3D, so text stays sharp at any zoom.
 */
export const Terrain3D = forwardRef<Terrain3DHandle, Props>(function Terrain3D(
  {
    terrain,
    from,
    onGrowthDone,
    timeZone,
    unit,
    tilted,
    selectedId,
    selectedRegion,
    regions,
    theme,
    frontier = null,
    landmarks = [],
    selectedPlace = null,
    focusPlace = null,
    onSelectPlace,
    onReady,
    onSelectSession,
    onSelectRegion,
    onSelectRest,
    onClearSelection,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const labelsHost = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  type Api = {
    setMode: (tilted: boolean) => void;
    setSelected: (id: string | null) => void;
    setRegion: (key: string | null) => void;
    setPlace: (key: PlaceKey | null) => void;
    unlock: (key: PlaceKey, info: { stats: string; accent: string | null }) => number;
    zoom: (factor: number) => void;
    reset: () => void;
  };
  const api = useRef<Api | null>(null);
  const callbacks = useRef({ onSelectSession, onSelectRegion, onSelectRest, onClearSelection, onGrowthDone, onSelectPlace, onReady });
  useEffect(() => {
    callbacks.current = { onSelectSession, onSelectRegion, onSelectRest, onClearSelection, onGrowthDone, onSelectPlace, onReady };
  }, [onSelectSession, onSelectRegion, onSelectRest, onClearSelection, onGrowthDone, onSelectPlace, onReady]);
  const initial = useRef({ tilted, selectedId, selectedRegion, from, selectedPlace, focusPlace });
  useEffect(() => {
    // `from` is read once, when the scene is built: clearing it after the growth must not rebuild
    initial.current = { tilted, selectedId, selectedRegion, from, selectedPlace, focusPlace };
  }, [tilted, selectedId, selectedRegion, from, selectedPlace, focusPlace]);

  useEffect(() => {
    const el = host.current;
    const labelEl = labelsHost.current;
    const tipEl = tip.current;
    if (!el || !labelEl || !tipEl) return;
    const root = document.documentElement;
    const dark = root.dataset.theme === "dark" || (!root.dataset.theme && window.matchMedia?.("(prefers-color-scheme: dark)").matches);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    // phones and tablets: lighter rendering (no shadow pass, capped pixel ratio), same scene
    const touch = Boolean(window.matchMedia?.("(pointer: coarse)").matches);
    const portrait = el.clientHeight > el.clientWidth * 1.1;
    const dpr = Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2);
    renderer.setPixelRatio(dpr);
    renderer.shadowMap.enabled = !touch;
    renderer.shadowMap.type = THREE.VSMShadowMap; // soft, blurred shadows rather than hard black patches
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = touch ? 1.4 : 1.22;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const paper = cssColor("--paper", [244, 241, 234]);
    scene.fog = new THREE.Fog(paper, 130, 280);
    const sage = cssColor("--sage", [93, 111, 80]);

    // soft, mostly ambient light; one low-intensity key from the north-west reveals the form
    // touch renders without shadows, so it gets more fill to keep slopes readable
    const fill = touch ? 1.3 : 1;
    scene.add(new THREE.HemisphereLight(dark ? 0xb4bcc4 : 0xffffff, dark ? 0x2a2e2a : 0x8f8774, (dark ? 2.3 : 1.7) * fill));
    const centre = new THREE.Vector3(SIZE_X / 2, 0, SIZE_Z / 2);
    const sun = new THREE.DirectionalLight(0xffffff, (dark ? 1.5 : 1.6) * fill);
    // portrait turns the map a quarter; the sun turns with it, so the lit faces still face the viewer
    const homeAz = portrait ? Math.PI / 2 : 0;
    sun.position.copy(centre).add(new THREE.Vector3(-45, 60, -35).sub(centre).applyAxisAngle(new THREE.Vector3(0, 1, 0), homeAz));
    sun.target.position.copy(centre);
    sun.castShadow = !touch;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 60, bottom: -60 });
    sun.shadow.radius = 7;
    sun.shadow.blurSamples = 12;
    sun.shadow.bias = -0.0006;
    sun.shadow.intensity = 0.55; // shadows suggest form, never black out a slope
    scene.add(sun, sun.target);

    // everything that has height lives in one group, so 2D can flatten it into a true map
    const world = new THREE.Group();
    scene.add(world);

    // ── terrain ───────────────────────────────────────────────────────────
    const pal = palette();
    const meshOf = (w: World) =>
      // the "before" world is carved along today's river, so both states share one channel
      terrainMesh({ ...w, water: terrain.water }, pal, 15, 1.7);
    const mesh = meshOf(terrain);
    const tmp = new THREE.Color();
    const rgbaOf = (m: typeof mesh) => {
      const out = new Float32Array((m.colors.length / 3) * 4);
      for (let v = 0; v < m.colors.length / 3; v++) {
        const k = v * 3;
        tmp.setRGB(m.colors[k], m.colors[k + 1], m.colors[k + 2], THREE.SRGBColorSpace);
        // fade to transparent at the borders: the page shows through, the map has no edge
        const f = edgeFalloff((v % m.cols) / (m.cols - 1), Math.floor(v / m.cols) / (m.rows - 1), 0.22);
        out.set([tmp.r, tmp.g, tmp.b, f * f * f], v * 4);
      }
      return out;
    };
    const rgba = rgbaOf(mesh);
    // growth: start from the earlier world (same grid) and morph into today's
    const from = initial.current.from;
    const growing =
      Boolean(from && from.cols === terrain.cols && from.rows === terrain.rows) &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const startMesh = growing ? meshOf(from!) : null;
    const endY = new Float32Array(mesh.cols * mesh.rows);
    const startY = new Float32Array(mesh.cols * mesh.rows);
    for (let v = 0; v < endY.length; v++) {
      endY[v] = mesh.positions[v * 3 + 1];
      startY[v] = startMesh ? startMesh.positions[v * 3 + 1] : endY[v];
    }
    const endRgba = rgba.slice();
    const startRgba = startMesh ? rgbaOf(startMesh) : endRgba;
    if (startMesh) {
      for (let v = 0; v < endY.length; v++) mesh.positions[v * 3 + 1] = startY[v];
      rgba.set(startRgba);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(rgba, 4));
    // regions come from the world itself, so a region is the same ground in every period and mode
    geo.setAttribute("region", new THREE.BufferAttribute(terrain.regionIndex, 1));
    geo.setAttribute("regionStrength", new THREE.BufferAttribute(terrain.regionStrength, 1));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geo.computeVertexNormals();

    const regionUniforms = { uHover: { value: -1 }, uSelected: { value: -1 }, uSage: { value: sage } };
    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      roughness: 0.9,
      metalness: 0,
      // smooth normals: the crags are in the geometry itself; flat facets showed the mesh grid
    });
    terrainMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, regionUniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float region;\nattribute float regionStrength;\nvarying float vRegion;\nvarying float vStrength;",
        )
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRegion = region;\nvStrength = regionStrength;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vRegion;\nvarying float vStrength;\nuniform float uHover;\nuniform float uSelected;\nuniform vec3 uSage;",
        )
        .replace(
          "#include <dithering_fragment>",
          `#include <dithering_fragment>
           float lit = (uHover >= 0.0 && abs(vRegion - uHover) < 0.5 ? 0.55 : 0.0) + (uSelected >= 0.0 && abs(vRegion - uSelected) < 0.5 ? 1.0 : 0.0);
           gl_FragColor.rgb += uSage * 0.3 * min(lit, 1.0) * vStrength;`,
        );
    };
    const ground = new THREE.Mesh(geo, terrainMat);
    ground.castShadow = true;
    ground.receiveShadow = true;
    world.add(ground);

    // ── the frontier: distant ranges beyond the developed map, rising out of mist at its edge.
    // A separate mesh around the map; the developed terrain above is untouched by it.
    if (frontier) {
      const g = frontier.grid;
      const fp = new Float32Array(g.cols * g.rows * 3);
      const fc = new Float32Array(g.cols * g.rows * 4);
      const mistTone = cssColor("--paper", [244, 241, 234]);
      const lo = new THREE.Color().setRGB(...(pal.low.map((c) => c / 255) as [number, number, number]), THREE.SRGBColorSpace);
      const mi = new THREE.Color().setRGB(...(pal.mid.map((c) => c / 255) as [number, number, number]), THREE.SRGBColorSpace);
      const hi = new THREE.Color().setRGB(...(pal.high.map((c) => c / 255) as [number, number, number]), THREE.SRGBColorSpace);
      const c = new THREE.Color();
      for (let j = 0; j < g.rows; j++)
        for (let i = 0; i < g.cols; i++) {
          const k = j * g.cols + i;
          const h = g.heights[k];
          fp.set([FRONTIER.minX + i * FRONTIER.step, h, FRONTIER.minZ + j * FRONTIER.step], k * 3);
          const t = Math.min(1, h / 14);
          if (t < 0.5) c.copy(lo).lerp(mi, t * 2);
          else c.copy(mi).lerp(hi, (t - 0.5) * 2);
          c.lerp(mistTone, g.mist[k] * 0.85);
          fc.set([c.r, c.g, c.b, g.alpha[k] * (1 - 0.5 * g.mist[k])], k * 4);
        }
      const fi: number[] = [];
      for (let j = 0; j < g.rows - 1; j++)
        for (let i = 0; i < g.cols - 1; i++) {
          const a = j * g.cols + i;
          // skip cells that are wholly invisible (the developed map itself, the far horizon)
          if (g.alpha[a] + g.alpha[a + 1] + g.alpha[a + g.cols] + g.alpha[a + g.cols + 1] < 0.004) continue;
          fi.push(a, a + g.cols, a + 1, a + 1, a + g.cols, a + g.cols + 1);
        }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.BufferAttribute(fp, 3));
      fg.setAttribute("color", new THREE.BufferAttribute(fc, 4));
      fg.setIndex(fi);
      fg.computeVertexNormals();
      const frontierMesh = new THREE.Mesh(
        fg,
        new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, alphaTest: 0.02, roughness: 0.95, metalness: 0 }),
      );
      frontierMesh.renderOrder = -1;
      world.add(frontierMesh);
    }

    // ── contours: dense, sage-tinted; every fifth a little stronger ───────────
    const cc = 200;
    const cr = Math.round((cc * SIZE_Z) / SIZE_X);
    // traced from the final surface (after the river's carve), so lines follow what you see
    const surface = mesh.heights.map((h) => h / mesh.heightScale);
    const contourField = resampleField(surface, mesh.cols, mesh.rows, cc, cr);
    // lines fade out with the terrain toward the rim (per-vertex alpha), never a hard cut
    const contourColor = cssColor("--contour-index", [94, 90, 80]).lerp(sage, 0.55);
    const lineSet = (opacity: number) => ({ pos: [] as number[], col: [] as number[], opacity });
    // few and faint: they hint at the form without laying a net over the rock
    const fine = lineSet(dark ? 0.12 : 0.1);
    const index = lineSet(dark ? 0.3 : 0.26);
    const tallest = surface.reduce((m, h) => Math.max(m, h), 0.2);
    for (const c of contourChains(contourField, cc, cr, 1, 1, evenLevels(40, 0.02, tallest * 0.97), 5)) {
      const set = c.index ? index : fine;
      for (const chain of c.chains)
        for (let i = 0; i < chain.length - 1; i++) {
          const a = edgeFalloff(chain[i][0], chain[i][1], 0.22);
          const b = edgeFalloff(chain[i + 1][0], chain[i + 1][1], 0.22);
          if (a + b < 0.02) continue;
          set.pos.push(
            ...toWorld(chain[i][0], chain[i][1], mesh.heightAt, 0.05),
            ...toWorld(chain[i + 1][0], chain[i + 1][1], mesh.heightAt, 0.05),
          );
          set.col.push(
            contourColor.r,
            contourColor.g,
            contourColor.b,
            a * a * set.opacity,
            contourColor.r,
            contourColor.g,
            contourColor.b,
            b * b * set.opacity,
          );
        }
    }
    const contourObjects: THREE.LineSegments[] = [];
    for (const set of [fine, index]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(set.pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(set.col, 4));
      const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
      contourObjects.push(lines);
      world.add(lines);
    }

    // ── river: muted, matte, with a faint bank line ─────────────────────────
    const river = riverMesh(terrain.water.river, mesh.heightAt, 0.3, 1.5, mesh.riverBed);
    const startRiver = startMesh ? riverMesh(terrain.water.river, startMesh.heightAt, 0.3, 1.5, startMesh.riverBed) : null;
    const riverEnd = river ? river.positions.slice() : null;
    if (river && startRiver && startRiver.positions.length === river.positions.length) river.positions.set(startRiver.positions);
    let water: THREE.Mesh | null = null;
    let bankLines: THREE.LineSegments | null = null;
    if (river) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute("position", new THREE.BufferAttribute(river.positions, 3));
      wg.setIndex(new THREE.BufferAttribute(river.indices, 1));
      wg.computeVertexNormals();
      water = new THREE.Mesh(
        wg,
        new THREE.MeshStandardMaterial({
          color: cssColor("--water", [184, 205, 211]),
          emissive: cssColor("--water", [184, 205, 211]),
          emissiveIntensity: dark ? 0.22 : 0.06,
          roughness: 0.5,
          metalness: 0,
          side: THREE.DoubleSide,
        }),
      );
      water.receiveShadow = true;
      world.add(water);
      // banks: the two outer edges of the strip, drawn as thin lines for a quiet separation
      const banks: number[] = [];
      const p = river.positions;
      for (let i = 0; i < p.length / 6 - 1; i++)
        for (const side of [0, 3])
          banks.push(
            p[i * 6 + side],
            p[i * 6 + side + 1] + 0.02,
            p[i * 6 + side + 2],
            p[(i + 1) * 6 + side],
            p[(i + 1) * 6 + side + 1] + 0.02,
            p[(i + 1) * 6 + side + 2],
          );
      const bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.Float32BufferAttribute(banks, 3));
      bankLines = new THREE.LineSegments(
        bg,
        new THREE.LineBasicMaterial({ color: cssColor("--water-edge", [127, 158, 168]), transparent: true, opacity: 0.55 }),
      );
      world.add(bankLines);
    }

    // ── data points ─────────────────────────────────────────────────────────
    const marks = terrain.landmarks;
    const regionOf = new Map(terrain.bands.map((b, i) => [b, i]));
    const base = marks.map((l) => new THREE.Vector3(...toWorld(l.x, l.y, mesh.heightAt, 0.35)));
    const pg = new THREE.BufferGeometry();
    pg.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        base.flatMap((v) => [v.x, v.y, v.z]),
        3,
      ),
    );
    const sizes = new Float32Array(marks.length);
    const alphas = new Float32Array(marks.length);
    const tints = new Float32Array(marks.length * 3);
    const sessionTint = cssColor("--ink-2", [85, 82, 75]);
    marks.forEach((l, i) => (l.session.prCount > 0 ? sage : sessionTint).toArray(tints, i * 3));
    pg.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    pg.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));
    pg.setAttribute("tint", new THREE.BufferAttribute(tints, 3));
    const points = new THREE.Points(
      pg,
      new THREE.ShaderMaterial({ ...markerShader, uniforms: { uPixelRatio: { value: dpr } }, transparent: true, depthWrite: false }),
    );
    points.renderOrder = 5;
    world.add(points);

    // selection: a soft halo and a thin leader line rising from the point
    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    haloGeo.setAttribute("size", new THREE.Float32BufferAttribute([34], 1));
    haloGeo.setAttribute("alpha", new THREE.Float32BufferAttribute([0.55], 1));
    haloGeo.setAttribute("tint", new THREE.Float32BufferAttribute(sage.toArray(), 3));
    const halo = new THREE.Points(
      haloGeo,
      new THREE.ShaderMaterial({ ...markerShader, uniforms: { uPixelRatio: { value: dpr } }, transparent: true, depthWrite: false }),
    );
    halo.visible = false;
    halo.renderOrder = 4;
    const leader = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 7, 0)]),
      new THREE.LineBasicMaterial({ color: sage, transparent: true, opacity: 0.8 }),
    );
    leader.visible = false;
    world.add(halo, leader);

    // ── landmarks: slim flags beside the sessions that earned them, and on the summits reached.
    // A hairline pole and a thin, unlit pennant (no shading, so nothing looks moulded); one
    // pennant shape per kind; sage, brighter when selected. They keep a modest size on screen:
    // zoomed in, they shrink rather than fill the view.
    type Place = {
      key: PlaceKey;
      pos: THREE.Vector3;
      /** the flag's top, kept in step with its on-screen scale (picking, labels) */
      top: THREE.Vector3;
      label: THREE.Vector3;
      height: number;
      object: THREE.Object3D;
      title: string;
      sub: string;
    };
    const places: Place[] = [];
    const placeGroup = new THREE.Group();
    world.add(placeGroup);
    const poleMat = new THREE.MeshBasicMaterial({ color: cssColor("--ink-2", [85, 82, 75]) });
    const flagMat = new THREE.MeshBasicMaterial({ color: sage, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    const flagLit = new THREE.MeshBasicMaterial({ color: sage.clone().lerp(new THREE.Color(1, 1, 1), dark ? 0.35 : 0.12), side: THREE.DoubleSide });
    const footMat = new THREE.MeshBasicMaterial({ color: sage, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
    const pennant = (kind: LandmarkCategory | "summit") => {
      const w = kind === "summit" ? 0.9 : 0.62;
      const h = kind === "summit" ? 0.5 : 0.36;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      if (kind === "journey" || kind === "running") {
        shape.lineTo(w, -h / 2); // a simple pennant
        shape.lineTo(0, -h);
      } else if (kind === "strength" || kind === "summit") {
        shape.lineTo(w, 0); // swallowtail
        shape.lineTo(w * 0.72, -h / 2);
        shape.lineTo(w, -h);
        shape.lineTo(0, -h);
      } else {
        shape.lineTo(w, -0.03); // consistency: a plain flag, the fly edge drooping a touch
        shape.lineTo(w, -h - 0.03);
        shape.lineTo(0, -h);
      }
      shape.closePath();
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), flagMat);
      m.userData.flag = true;
      return m;
    };
    const flag = (kind: LandmarkCategory | "summit", height: number, turn: number) => {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, height, 6), poleMat);
      pole.position.y = height / 2;
      const p = pennant(kind);
      p.position.set(0.02, height - 0.02, 0);
      g.add(pole, p);
      g.rotation.y = turn; // facing the viewer, give or take: never seen edge-on from home
      return g;
    };
    const foot = (r: number) => {
      // a faint ring on the ground, so the place still reads in the flat map
      const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.6, r, 24), footMat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.05;
      return m;
    };
    const turnOf = (key: string) => ((hashString(key) % 1000) / 1000 - 0.5) * 0.7;
    const addPlace = (key: PlaceKey, pos: THREE.Vector3, g: THREE.Object3D, height: number, title: string, sub: string) => {
      g.position.copy(pos);
      placeGroup.add(g);
      places.push({ key, pos, top: pos.clone().add(new THREE.Vector3(0, height, 0)), label: pos.clone().add(new THREE.Vector3(0, height + 1.2, 0)), height, object: g, title, sub });
    };
    for (const { landmark: l, x, y } of landmarks) {
      const g = new THREE.Group();
      g.add(flag(l.category, 1.7, turnOf(l.id)), foot(0.38));
      addPlace(`landmark:${l.id}`, new THREE.Vector3(...toWorld(x, y, mesh.heightAt, 0)), g, 1.7, l.title, formatShortDate(l.at, timeZone));
    }
    if (frontier) {
      for (const s of frontier.summits) {
        const spot = frontier.spots[s.slot];
        if (!spot) continue;
        const g = new THREE.Group();
        if (s.landmark) g.add(flag("summit", 2.4, turnOf(s.id)), foot(0.55));
        addPlace(
          `summit:${s.slot}`,
          new THREE.Vector3(spot.x, frontier.grid.heightAt(spot.x, spot.z), spot.z),
          g,
          s.landmark ? 2.4 : 0.6,
          s.name ?? "Uncharted summit",
          s.landmark ? formatShortDate(s.landmark.at, timeZone) : "Not yet reached",
        );
      }
    }
    // the flags' size on screen: full size from the home view, smaller as the camera comes close
    let placeScale = 1;
    let unlockingObject: THREE.Object3D | null = null;
    const rescalePlaces = (d: number) => {
      const next = Math.min(1, Math.max(0.4, d / 80));
      if (Math.abs(next - placeScale) < 0.01) return;
      placeScale = next;
      for (const p of places) {
        if (p.object !== unlockingObject) p.object.scale.setScalar(placeScale);
        p.top.copy(p.pos).add(new THREE.Vector3(0, p.height * placeScale, 0));
        p.label.copy(p.pos).add(new THREE.Vector3(0, p.height * placeScale + 1.2, 0));
      }
    };
    let selectedPlaceIndex = -1;
    const paintPlaces = () => {
      places.forEach((p, i) =>
        p.object.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.userData.flag) m.material = i === selectedPlaceIndex ? flagLit : flagMat;
        }),
      );
    };

    // ── cameras & controls (perspective for 3D, orthographic for the flat 2D map) ─
    const persp = new THREE.PerspectiveCamera(40, 1, 0.5, 900);
    const ortho = new THREE.OrthographicCamera(-50, 50, 37, -37, 0.1, 1000);
    // portrait: turn the map so its long axis runs up the screen instead of shrinking it to fit
    const homeDist = portrait ? 134 : HOME_DISTANCE;
    const homeTilt = portrait ? TILT_PORTRAIT : TILT_POLAR;
    if (portrait) ortho.up.set(-1, 0, 0);
    else ortho.up.set(0, 0, -1); // north up
    let camera: THREE.Camera = persp;
    let controls: MapControls | null = null;
    const target = centre.clone();

    let dirty = true;
    const invalidate = () => {
      dirty = true;
    };
    const clampTarget = (c: MapControls) => {
      // a little beyond the map, and out to the frontier's summits when there is a frontier
      const m = frontier ? 28 : 6;
      const x = Math.min(SIZE_X + m, Math.max(-m, c.target.x));
      const z = Math.min(SIZE_Z + (frontier ? 14 : 6), Math.max(-m, c.target.z));
      if (x !== c.target.x || z !== c.target.z) {
        camera.position.x += x - c.target.x;
        camera.position.z += z - c.target.z;
        c.target.set(x, 0, z);
      }
      target.copy(c.target);
    };
    const makeControls = (cam: THREE.Camera, is3D: boolean) => {
      const c = new MapControls(cam, renderer.domElement);
      c.target.copy(target);
      c.enableDamping = true;
      c.dampingFactor = touch ? 0.16 : 0.09;
      c.panSpeed = touch ? 1.15 : 1;
      c.zoomSpeed = touch ? 1.1 : 1;
      c.screenSpacePanning = !is3D;
      c.zoomToCursor = true;
      c.enableRotate = is3D;
      c.minDistance = 14;
      c.maxDistance = homeDist;
      c.minZoom = 1;
      c.maxZoom = 7;
      c.maxPolarAngle = MAX_TILT;
      // mouse: drag pans, right-drag turns and tilts, the wheel zooms (toward the cursor).
      // Touch never reaches the controls: the gesture handler below owns every finger.
      c.addEventListener("change", () => {
        clampTarget(c);
        invalidate();
      });
      return c;
    };

    // flatten / raise the world between modes
    let flat = 0; // 0 = full height, 1 = flat map
    let flatTarget = 0;
    const applyFlat = () => {
      world.scale.y = 1 - 0.995 * flat;
      sun.castShadow = !touch && flat < 0.5;
    };

    const setMode = (is3D: boolean) => {
      controls?.dispose();
      if (is3D) {
        camera = persp;
        persp.position.copy(target).add(new THREE.Vector3().setFromSphericalCoords(homeDist / Math.max(1, ortho.zoom), homeTilt, homeAz));
        persp.lookAt(target);
      } else {
        camera = ortho;
        ortho.position.set(target.x, 300, target.z);
        ortho.lookAt(target);
      }
      controls = makeControls(camera, is3D);
      flatTarget = is3D ? 0 : 1;
      invalidate();
    };
    const ctl = () => controls!;

    // ── labels: region callouts, the selected session, and rest at close range ─
    type Label = { el: HTMLElement; pos: THREE.Vector3; show: () => boolean; region?: string };
    const labels: Label[] = [];
    const addLabel = (node: HTMLElement, pos: THREE.Vector3, show: () => boolean, region?: string) => {
      node.style.position = "absolute";
      node.style.left = "0";
      node.style.top = "0";
      node.style.willChange = "transform, opacity";
      node.style.transition = "opacity 160ms ease-out";
      labelEl.appendChild(node);
      labels.push({ el: node, pos, show, region });
    };
    const distance = () => (camera === persp ? persp.position.distanceTo(ctl().target) : 100 / ortho.zoom);

    let hoverRegion = -1;
    let selectedRegionIndex = -1;
    let selectedIndex = -1;

    // which points show: records always (quietly); sessions up close, or with their region
    const refreshPoints = () => {
      const close = distance() < CLOSE;
      marks.forEach((l, i) => {
        const region = regionOf.get(l.session.templateKey) ?? -1;
        const active = region === hoverRegion || region === selectedRegionIndex;
        const record = l.session.prCount > 0;
        const selected = i === selectedIndex;
        alphas[i] = selected ? 1 : record ? 1 : close || active ? 0.8 : 0;
        sizes[i] = selected ? 14 : record ? (active ? 13 : 11) : 7;
      });
      pg.attributes.alpha.needsUpdate = true;
      pg.attributes.size.needsUpdate = true;
      invalidate();
    };
    const setHoverRegion = (region: number) => {
      if (region === hoverRegion) return;
      hoverRegion = region;
      regionUniforms.uHover.value = region;
      refreshPoints();
    };

    // a callout stands on each range's real summit (from the world, so the same in every period)
    for (const region of terrain.regions) {
      const band = region.key;
      const top = { x: region.peakX, y: region.peakY, session: { label: region.label } };
      const summary = regions.find((r) => r.key === band);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "group flex items-stretch gap-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-[var(--sage)]";
      const line = document.createElement("span");
      line.className =
        "h-9 w-px shrink-0 bg-[var(--ink-3)] opacity-70 transition-colors group-hover:bg-[var(--sage)] group-data-[active=true]:bg-[var(--sage)] group-data-[active=true]:opacity-100";
      const text = document.createElement("span");
      text.className = "pb-0.5";
      const title = document.createElement("span");
      title.className = "block whitespace-nowrap text-[12px] font-medium leading-tight text-ink sm:text-[13px]";
      title.textContent = top.session.label;
      const stat = document.createElement("span");
      stat.className = "num block whitespace-nowrap text-[11px] leading-tight text-ink-3";
      stat.textContent = summary
        ? `${plural(summary.workouts, "workout")} · ${plural(summary.records, "PR")}`
        : `${plural(region.sessions, "workout")} in all`;
      text.append(title, stat);
      const best = summary?.trail?.steps.at(-1);
      if (best) {
        const pr = document.createElement("span");
        pr.className = "num block whitespace-nowrap text-[11px] font-medium leading-tight text-[var(--sage-deep)]";
        pr.textContent = `${summary!.trail!.exerciseName} ${formatWeight(best.weight)} ${unit}`;
        text.append(pr);
      }
      btn.append(line, text);
      btn.setAttribute("aria-label", `${top.session.label}: ${stat.textContent}`);
      btn.style.textShadow = "0 0 8px var(--paper), 0 0 3px var(--paper)";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        callbacks.current.onSelectRegion(band);
      });
      btn.addEventListener("pointerenter", () => setHoverRegion(regionOf.get(band) ?? -1));
      btn.addEventListener("pointerleave", () => setHoverRegion(-1));
      addLabel(btn, new THREE.Vector3(...toWorld(top.x, top.y, mesh.heightAt, 2.2)), () => true, band);
    }

    // ── progress trails: each range's main lift, from the first session at the foot to today's best
    // at the summit; at least eight waypoints, each standing as high on the slope as its share of
    // the climb (the lowest is the least progress)
    const trailGroup = new THREE.Group();
    world.add(trailGroup);
    const trailInk = cssColor("--ink-2", [70, 68, 62]);
    for (const region of terrain.regions) {
      const trail = regions.find((r) => r.key === region.key)?.trail ?? null;
      const ri = regionOf.get(region.key) ?? -1;
      const stops = progressStops(trail, region.sessions, unit, timeZone);
      if (ri < 0 || !stops.length) continue;
      // walk down from the summit, mostly downhill and a little toward the viewer, until the foot
      const path: [number, number, number][] = [[region.peakX, region.peakY, mesh.heightAt(region.peakX, region.peakY)]];
      const top = path[0][2];
      const e = 0.004;
      for (let n = 0; n < 160; n++) {
        const [x, y, h] = path.at(-1)!;
        let gx = (mesh.heightAt(x + e, y) - mesh.heightAt(x - e, y)) / (2 * e);
        let gy = (mesh.heightAt(x, y + e) - mesh.heightAt(x, y - e)) / (2 * e);
        const g = Math.hypot(gx, gy) || 1;
        gx = -gx / g;
        gy = -gy / g + 0.45;
        const d = Math.hypot(gx, gy) || 1;
        const nx = Math.min(0.94, Math.max(0.06, x + (gx / d) * 0.005));
        const ny = Math.min(0.94, Math.max(0.06, y + (gy / d) * 0.005));
        const nh = mesh.heightAt(nx, ny);
        path.push([nx, ny, Math.min(h, nh)]);
        if (nh < top * 0.14 || (nx === x && ny === y)) break;
      }
      path.reverse(); // foot → summit
      const foot = path[0][2];
      const at = (t: number) => {
        const target = foot + (top - foot) * t;
        return path.find((p) => p[2] >= target - 1e-6) ?? path.at(-1)!;
      };
      // the line itself, laid on the ground
      const pts = path.map(([x, y]) => new THREE.Vector3(...toWorld(x, y, mesh.heightAt, 0.18)));
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(
        lineGeo,
        new THREE.LineDashedMaterial({ color: trailInk, dashSize: 0.9, gapSize: 0.6, transparent: true, opacity: 0.85, depthWrite: false }),
      );
      line.computeLineDistances();
      trailGroup.add(line);
      // waypoints: label the foot and the summit always; the climb between with the region or up close
      stops.forEach((stop, i) => {
        const last = i === stops.length - 1;
        const first = i === 0;
        const [x, y] = last ? path.at(-1)! : at(stop.t);
        const pos = new THREE.Vector3(...toWorld(x, y, mesh.heightAt, 0.35));
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(last ? 0.7 : first ? 0.5 : 0.4, 12, 8),
          new THREE.MeshBasicMaterial({ color: last ? sage : trailInk }),
        );
        dot.position.copy(pos);
        trailGroup.add(dot);
        if (last || !stop.text) return; // the summit callout carries today's best
        const tag = document.createElement("div");
        tag.className = "num pointer-events-none whitespace-nowrap text-[10.5px] leading-tight text-ink-2";
        tag.style.textShadow = "0 0 6px var(--paper), 0 0 2px var(--paper)";
        tag.textContent = stop.text;
        addLabel(
          tag,
          pos.clone().add(new THREE.Vector3(0, 1.2, 0)),
          () => !growth && (first || distance() < CLOSE + 20 || ri === selectedRegionIndex || ri === hoverRegion),
        );
      });
    }

    const selectedLabel = document.createElement("div");
    selectedLabel.className =
      "pointer-events-none whitespace-nowrap rounded-md bg-[var(--surface)] px-2 py-1 text-[11px] text-ink shadow-[var(--shadow)]";
    const selectedPos = new THREE.Vector3();
    addLabel(selectedLabel, selectedPos, () => selectedIndex >= 0 || selectedPlaceIndex >= 0);

    // reached summits carry their name, quietly, like a place name on a map
    for (const p of places) {
      if (!p.key.startsWith("summit:") || p.title === "Uncharted summit") continue;
      const tag = document.createElement("div");
      tag.className = "pointer-events-none whitespace-nowrap font-serif text-[12px] italic leading-none text-ink-2";
      tag.style.textShadow = "0 0 6px var(--paper), 0 0 2px var(--paper)";
      tag.textContent = p.title;
      addLabel(tag, p.label, () => !growth && selectedPlaceIndex !== places.indexOf(p));
    }

    for (const lake of terrain.water.lakes) {
      if (lake.span.days < 2) continue;
      const d = document.createElement("div");
      d.textContent = `${lake.span.days} days rest`;
      d.className = "pointer-events-none whitespace-nowrap text-[10.5px] italic text-[var(--water-edge)]";
      d.style.textShadow = "0 0 5px var(--paper)";
      addLabel(d, new THREE.Vector3(...toWorld(lake.x, lake.y, mesh.heightAt, 0.9)), () => distance() < CLOSE + 10);
    }

    const v = new THREE.Vector3();
    const updateLabels = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const placed: DOMRect[] = [];
      for (const l of labels) {
        v.copy(l.pos);
        v.y *= world.scale.y;
        v.project(camera);
        const visible = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && l.show();
        l.el.style.opacity = visible ? "1" : "0";
        l.el.style.pointerEvents = visible && l.region ? "auto" : "none";
        if (!visible) continue;
        let x = ((v.x + 1) / 2) * w;
        let y = ((1 - v.y) / 2) * h;
        if (l.region) {
          // callouts stand on their summit; nudge up past any callout they would overlap,
          // and stay inside the screen (narrow phones especially)
          const bw = l.el.offsetWidth || 120;
          const bh = l.el.offsetHeight || 36;
          x = Math.min(Math.max(8, x), w - bw - 8);
          y = Math.max(bh + 56, y);
          const overlaps = (r: DOMRect) =>
            placed.some((p) => !(r.right < p.left || r.left > p.right || r.bottom < p.top || r.top > p.bottom));
          // try the summit first, then step up and down alternately, never under the top bar
          const base = y;
          let rect = new DOMRect(x, y - bh, bw, bh);
          for (const k of [-1, 1, -2, 2, -3, 3]) {
            if (!overlaps(rect)) break;
            y = Math.min(h - 72, Math.max(bh + 56, base + k * (bh + 4)));
            rect = new DOMRect(x, y - bh, bw, bh);
          }
          placed.push(rect);
          l.el.style.transform = `translate(${x}px, ${y}px) translate(0, -100%)`;
          const r = regionOf.get(l.region);
          l.el.dataset.active = String(r === selectedRegionIndex || r === hoverRegion);
        } else {
          l.el.style.transform = `translate(${Math.round(x)}px, ${y}px) translate(-50%, -100%)`;
        }
      }
    };

    // ── render on demand ────────────────────────────────────────────────────
    let lastClose = false;
    let raf = 0;
    let fly: ((now: number) => boolean) | null = null;
    // growth: hold the earlier world for a moment, then let it rise into today's
    let growth: { t0: number; dur: number; frame: number } | null = startMesh ? { t0: performance.now() + 700, dur: 2600, frame: 0 } : null;
    const showDetail = (on: boolean) => {
      for (const c of contourObjects) c.visible = on;
      points.visible = on;
      if (bankLines) bankLines.visible = on;
      trailGroup.visible = on;
      placeGroup.visible = on;
    };
    if (growth) showDetail(false);
    const stepGrowth = (now: number) => {
      if (!growth) return false;
      const t = Math.min(1, Math.max(0, (now - growth.t0) / growth.dur));
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const pos = geo.attributes.position.array as Float32Array;
      const col = geo.attributes.color.array as Float32Array;
      for (let v = 0; v < endY.length; v++) pos[v * 3 + 1] = startY[v] + (endY[v] - startY[v]) * e;
      for (let k = 0; k < col.length; k++) col[k] = startRgba[k] + (endRgba[k] - startRgba[k]) * e;
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      if (growth.frame++ % 2 === 0 || t === 1) geo.computeVertexNormals();
      if (water && riverEnd && startRiver && startRiver.positions.length === riverEnd.length) {
        const wp = water.geometry.attributes.position.array as Float32Array;
        for (let k = 1; k < wp.length; k += 3) wp[k] = startRiver.positions[k] + (riverEnd[k] - startRiver.positions[k]) * e;
        water.geometry.attributes.position.needsUpdate = true;
      }
      if (t === 1) {
        growth = null;
        showDetail(true);
        refreshPoints();
        callbacks.current.onGrowthDone?.();
      }
      return true;
    };
    const tick = (now: number) => {
      const grew = stepGrowth(now);
      if (grew) dirty = true;
      if (unlocking) {
        if (!unlocking.step((now - unlocking.t0) / 1000)) unlocking = null;
        dirty = true;
      }
      const flew = fly ? fly(now) : false;
      if (!flew) fly = null;
      const flying = glide() || flew;
      if (Math.abs(flat - flatTarget) > 0.001) {
        flat += (flatTarget - flat) * 0.18;
        if (Math.abs(flat - flatTarget) < 0.002) flat = flatTarget;
        applyFlat();
        dirty = true;
      }
      const moved = ctl().update();
      rescalePlaces(distance());
      const close = distance() < CLOSE;
      if (close !== lastClose) {
        lastClose = close;
        refreshPoints();
      }
      if (moved || dirty || flying) {
        renderer.render(scene, camera);
        updateLabels();
        dirty = false;
      }
      raf = requestAnimationFrame(tick);
    };

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      persp.aspect = w / h;
      persp.updateProjectionMatrix();
      const halfH = (portrait ? 112 : ORTHO_HEIGHT) / 2;
      Object.assign(ortho, { left: -halfH * (w / h), right: halfH * (w / h), top: halfH, bottom: -halfH });
      ortho.updateProjectionMatrix();
      invalidate();
    };

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const animate = (step: (e: number) => void, dur = 480) => {
      const t0 = performance.now();
      fly = (now) => {
        const t = reduced ? 1 : Math.min(1, (now - t0) / dur);
        step(1 - Math.pow(1 - t, 3));
        return t < 1;
      };
    };
    const changed = () => ctl().dispatchEvent({ type: "change" });
    const zoom = (factor: number) => {
      if (camera === ortho) {
        const from = ortho.zoom;
        const to = Math.min(7, Math.max(1, from * factor));
        return animate((e) => {
          ortho.zoom = from * Math.pow(to / from, e);
          ortho.updateProjectionMatrix();
          changed();
        });
      }
      const off = persp.position.clone().sub(ctl().target);
      const from = off.length();
      const to = Math.min(homeDist, Math.max(14, from / factor));
      animate((e) => {
        persp.position.copy(ctl().target).add(off.clone().setLength(from * Math.pow(to / from, e)));
        changed();
      });
    };
    const flyToPoint = (p: THREE.Vector3, dur = 480, close = 44) => {
      const c = ctl();
      const fromT = c.target.clone();
      const toT = new THREE.Vector3(p.x, 0, p.z);
      if (camera === ortho) {
        const z0 = ortho.zoom;
        const z1 = Math.max(z0, 2.2);
        return animate((e) => {
          c.target.lerpVectors(fromT, toT, e);
          ortho.position.set(c.target.x, 300, c.target.z);
          ortho.zoom = z0 + (z1 - z0) * e;
          ortho.updateProjectionMatrix();
          changed();
        });
      }
      const sph = new THREE.Spherical().setFromVector3(persp.position.clone().sub(c.target));
      const d1 = Math.min(sph.radius, close);
      animate((e) => {
        c.target.lerpVectors(fromT, toT, e);
        persp.position
          .copy(c.target)
          .add(new THREE.Vector3().setFromSphericalCoords(sph.radius * Math.pow(d1 / sph.radius, e), sph.phi, sph.theta));
        persp.lookAt(c.target);
        changed();
      }, dur);
    };
    const reset = () => {
      const c = ctl();
      const from = c.target.clone();
      if (camera === ortho) {
        const z0 = ortho.zoom;
        return animate((e) => {
          c.target.lerpVectors(from, centre, e);
          ortho.position.set(c.target.x, 300, c.target.z);
          ortho.zoom = z0 + (1 - z0) * e;
          ortho.updateProjectionMatrix();
          changed();
        });
      }
      const sph = new THREE.Spherical().setFromVector3(persp.position.clone().sub(c.target));
      animate((e) => {
        c.target.lerpVectors(from, centre, e);
        persp.position
          .copy(c.target)
          .add(
            new THREE.Vector3().setFromSphericalCoords(
              sph.radius + (homeDist - sph.radius) * e,
              sph.phi + (homeTilt - sph.phi) * e,
              sph.theta + (homeAz - sph.theta) * e,
            ),
          );
        persp.lookAt(c.target);
        changed();
      });
    };

    // ── picking: points first, then water, then a region ────────────────────
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pickAt = (clientX: number, clientY: number) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      // screen-space test against the visible points (more forgiving than a ray on tiny sprites)
      let best = -1;
      let bestD = 18;
      marks.forEach((_, i) => {
        if (alphas[i] <= 0) return;
        v.copy(base[i]);
        v.y *= world.scale.y;
        v.project(camera);
        const d = Math.hypot(((v.x + 1) / 2) * r.width - (clientX - r.left), ((1 - v.y) / 2) * r.height - (clientY - r.top));
        if (v.z < 1 && d < bestD) {
          bestD = d;
          best = i;
        }
      });
      // landmarks and summits: their stone, or the summit's peak
      let place = -1;
      let placeD = 20;
      places.forEach((p, i) => {
        for (const at of [p.pos, p.top]) {
          v.copy(at);
          v.y *= world.scale.y;
          v.project(camera);
          const d = Math.hypot(((v.x + 1) / 2) * r.width - (clientX - r.left), ((1 - v.y) / 2) * r.height - (clientY - r.top));
          if (v.z < 1 && d < placeD && d < bestD) {
            placeD = d;
            place = i;
          }
        }
      });
      if (place >= 0 && placeGroup.visible) return { kind: "place" as const, index: place };
      if (best >= 0) return { kind: "session" as const, index: best };
      const wet = water ? raycaster.intersectObject(water, false)[0] : undefined;
      if (wet) {
        const nx = wet.point.x / SIZE_X;
        const lake = [...terrain.water.lakes].sort((a, b) => Math.abs(a.x - nx) - Math.abs(b.x - nx))[0];
        if (lake && Math.abs(lake.x - nx) < lake.rx * 1.5) return { kind: "rest" as const, span: lake.span };
      }
      const hit = raycaster.intersectObject(ground, false)[0];
      if (hit) {
        const i = Math.round((hit.point.x / SIZE_X) * (mesh.cols - 1));
        const j = Math.round((hit.point.z / SIZE_Z) * (mesh.rows - 1));
        const region = (geo.attributes.region.array as Float32Array)[j * mesh.cols + i];
        if (region >= 0) return { kind: "region" as const, key: terrain.bands[region] };
      }
      return null;
    };

    const selectAt = (clientX: number, clientY: number) => {
      const hit = pickAt(clientX, clientY);
      if (hit?.kind === "place") {
        callbacks.current.onSelectPlace?.(places[hit.index].key);
        flyToPoint(places[hit.index].pos);
      } else if (hit?.kind === "session") {
        callbacks.current.onSelectSession(marks[hit.index]);
        flyToPoint(base[hit.index]);
      } else if (hit?.kind === "rest") callbacks.current.onSelectRest(hit.span);
      else if (hit?.kind === "region") callbacks.current.onSelectRegion(hit.key);
      else callbacks.current.onClearSelection();
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return void (down = null);
      down = null;
      selectAt(e.clientX, e.clientY);
    };

    // ── touch: one finger pans (the ground stays under it), two fingers pinch to zoom and twist
    // to turn, both at once; two fingers sliding up or down together tilt. A tap selects.
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const groundAt = (clientX: number, clientY: number) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
    };
    const shift = (d: THREE.Vector3) => {
      d.y = 0;
      ctl().target.add(d);
      camera.position.add(d);
    };
    const settle = () => {
      if (camera === persp) persp.lookAt(ctl().target);
      else ortho.position.set(ctl().target.x, 300, ctl().target.z);
      changed();
    };
    /** move the camera so that the ground point `from` ends up under the screen point (x, y) */
    const keepUnder = (from: THREE.Vector3 | null, x: number, y: number) => {
      const to = groundAt(x, y);
      if (from && to) shift(from.clone().sub(to));
    };
    const fingers = new Map<number, { x: number; y: number }>();
    let tap: { x: number; y: number; t: number } | null = null;
    let twoMode: "pending" | "map" | "tilt" = "pending";
    let twoTravel = { a: 0, b: 0, ay: 0, by: 0, pinch: 0 };
    const coast = new THREE.Vector3();
    let lastPan = 0;
    const pair = () => {
      const [a, b] = [...fingers.values()];
      return { a, b, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    const onTouchDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      e.stopPropagation(); // the map controls and the mouse picking never see touches
      el.setPointerCapture?.(e.pointerId);
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      coast.set(0, 0, 0);
      fly = null;
      tap = fingers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
      if (fingers.size === 2) {
        twoMode = "pending";
        twoTravel = { a: 0, b: 0, ay: 0, by: 0, pinch: pair().dist };
      }
    };
    const onTouchMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !fingers.has(e.pointerId)) return;
      e.stopPropagation();
      const prev = fingers.get(e.pointerId)!;
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap = null;
      if (fingers.size === 1) {
        const from = groundAt(prev.x, prev.y);
        fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (tap) return;
        const before = ctl().target.clone();
        keepUnder(from, e.clientX, e.clientY);
        // remember the motion, so a flick keeps gliding after the finger lifts
        const now = performance.now();
        const moved = ctl().target.clone().sub(before);
        coast.lerp(moved.divideScalar(Math.max(8, now - lastPan) / 16), 0.5);
        lastPan = now;
        settle();
        return;
      }
      if (fingers.size !== 2) return void fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p0 = pair();
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p1 = pair();
      if (twoMode === "pending") {
        // decide once, from the first few pixels: both fingers sliding the same way vertically,
        // side by side, is a tilt; anything else is pinch / twist / pan together
        const first = e.pointerId === [...fingers.keys()][0];
        const dx = Math.abs(e.clientX - prev.x);
        const dy = e.clientY - prev.y;
        if (first) Object.assign(twoTravel, { a: twoTravel.a + dx, ay: twoTravel.ay + dy });
        else Object.assign(twoTravel, { b: twoTravel.b + dx, by: twoTravel.by + dy });
        const t = twoTravel;
        const travelled = Math.max(t.a, t.b, Math.abs(t.ay), Math.abs(t.by), Math.abs(p1.dist - t.pinch));
        if (travelled < 10) return;
        const tilt =
          camera === persp &&
          Math.abs(t.ay) > 6 &&
          Math.abs(t.by) > 6 &&
          Math.sign(t.ay) === Math.sign(t.by) &&
          Math.abs(t.ay) > 2 * t.a &&
          Math.abs(t.by) > 2 * t.b &&
          Math.abs(p1.dist - t.pinch) < 12 &&
          Math.abs(p1.b.x - p1.a.x) > Math.abs(p1.b.y - p1.a.y);
        twoMode = tilt ? "tilt" : "map";
      }
      if (twoMode === "tilt") {
        if (camera !== persp) return;
        const c = ctl();
        const sph = new THREE.Spherical().setFromVector3(persp.position.clone().sub(c.target));
        sph.phi = Math.min(MAX_TILT, Math.max(0.12, sph.phi - (p1.my - p0.my) * 0.006));
        persp.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(sph));
        settle();
        return;
      }
      const anchor = groundAt(p0.mx, p0.my);
      if (!anchor) return;
      const c = ctl();
      // pinch: zoom about the point between the fingers
      const ratio = p1.dist / Math.max(1, p0.dist);
      if (camera === persp) {
        const off = persp.position.clone().sub(c.target);
        const d = Math.min(homeDist, Math.max(14, off.length() / ratio));
        const k = d / off.length();
        c.target.sub(anchor).multiplyScalar(k).add(anchor);
        persp.position.sub(anchor).multiplyScalar(k).add(anchor);
        // twist: turn the world about that same point
        const turn = p1.angle - p0.angle;
        const da = Math.atan2(Math.sin(turn), Math.cos(turn));
        if (Math.abs(da) > 1e-4) {
          const axis = new THREE.Vector3(0, 1, 0);
          c.target.sub(anchor).applyAxisAngle(axis, da).add(anchor);
          persp.position.sub(anchor).applyAxisAngle(axis, da).add(anchor);
        }
        persp.lookAt(c.target);
      } else {
        ortho.zoom = Math.min(7, Math.max(1, ortho.zoom * ratio));
        ortho.updateProjectionMatrix();
      }
      // and the ground under the fingers follows them (pan)
      keepUnder(anchor, p1.mx, p1.my);
      settle();
    };
    const onTouchUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !fingers.has(e.pointerId)) return;
      e.stopPropagation();
      fingers.delete(e.pointerId);
      if (e.type === "pointerup" && tap && performance.now() - tap.t < 450 && fingers.size === 0) selectAt(e.clientX, e.clientY);
      tap = null;
      if (fingers.size === 1) twoMode = "pending";
      // a flick glides on and slows; a slow lift stops where it is
      if (fingers.size > 0 || performance.now() - lastPan > 80 || coast.length() < 0.05) coast.set(0, 0, 0);
    };
    const glide = () => {
      if (fingers.size || coast.lengthSq() < 1e-4) return false;
      shift(coast.clone());
      coast.multiplyScalar(0.92);
      settle();
      return true;
    };
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", onTouchDown, true);
    el.addEventListener("pointermove", onTouchMove, true);
    el.addEventListener("pointerup", onTouchUp, true);
    el.addEventListener("pointercancel", onTouchUp, true);
    // hover (mouse only; touch selects on tap): tooltip on points, region highlight on ground
    let hoverFrame = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons) return;
      cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => {
        const hit = pickAt(e.clientX, e.clientY);
        const r = el.getBoundingClientRect();
        if (hit?.kind === "session") {
          const l = marks[hit.index];
          const a = document.createElement("div");
          a.className = "text-[12px] font-medium";
          a.textContent = l.session.label;
          const b = document.createElement("div");
          b.className = "num text-[11px] opacity-70";
          b.textContent = `${formatShortDate(l.session.endedAt, timeZone)} · ${formatVolume(l.session.volume, unit)}${l.session.prCount ? ` · ${plural(l.session.prCount, "record")}` : ""}`;
          tipEl.replaceChildren(a, b);
          tipEl.style.opacity = "1";
          tipEl.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 14}px)`;
          renderer.domElement.style.cursor = "pointer";
        } else if (hit?.kind === "place") {
          const p = places[hit.index];
          const a = document.createElement("div");
          a.className = "text-[12px] font-medium";
          a.textContent = p.title;
          const b = document.createElement("div");
          b.className = "num text-[11px] opacity-70";
          b.textContent = p.sub;
          tipEl.replaceChildren(a, b);
          tipEl.style.opacity = "1";
          tipEl.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 14}px)`;
          renderer.domElement.style.cursor = "pointer";
        } else {
          tipEl.style.opacity = "0";
          renderer.domElement.style.cursor = hit ? "pointer" : "grab";
        }
        setHoverRegion(
          hit?.kind === "region"
            ? (regionOf.get(hit.key) ?? -1)
            : hit?.kind === "session"
              ? (regionOf.get(marks[hit.index].session.templateKey) ?? -1)
              : -1,
        );
      });
    };
    const onLeave = () => {
      tipEl.style.opacity = "0";
      setHoverRegion(-1);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    const setSelected = (id: string | null) => {
      selectedIndex = id ? marks.findIndex((l) => l.session.id === id) : -1;
      halo.visible = leader.visible = selectedIndex >= 0;
      if (selectedIndex >= 0) {
        const p = base[selectedIndex];
        halo.position.copy(p);
        leader.position.copy(p);
        selectedPos.copy(p).add(new THREE.Vector3(0, 7.4, 0));
        const l = marks[selectedIndex];
        selectedLabel.textContent = `${formatShortDate(l.session.endedAt, timeZone)} · ${l.session.label}`;
      }
      refreshPoints();
    };
    const setPlace = (key: PlaceKey | null) => {
      selectedPlaceIndex = key ? places.findIndex((p) => p.key === key) : -1;
      paintPlaces();
      if (selectedPlaceIndex >= 0) {
        const p = places[selectedPlaceIndex];
        selectedPos.copy(p.top).add(new THREE.Vector3(0, 1.6, 0));
        selectedLabel.textContent = `${p.sub} · ${p.title}`;
      }
      invalidate();
    };
    const setRegion = (key: string | null) => {
      selectedRegionIndex = key ? (regionOf.get(key) ?? -1) : -1;
      regionUniforms.uSelected.value = selectedRegionIndex;
      refreshPoints();
    };

    // ── landmark unlock (see UNLOCK) ─────────────────────────────────────────
    const unlockFx = new THREE.Group();
    world.add(unlockFx);
    const ringGeo = new THREE.RingGeometry(0.93, 1, 64);
    const fxPoint = (size: number, color: THREE.Color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
      g.setAttribute("size", new THREE.Float32BufferAttribute([size], 1));
      g.setAttribute("alpha", new THREE.Float32BufferAttribute([0], 1));
      g.setAttribute("tint", new THREE.Float32BufferAttribute(color.toArray(), 3));
      const p = new THREE.Points(
        g,
        new THREE.ShaderMaterial({ ...markerShader, uniforms: { uPixelRatio: { value: dpr } }, transparent: true, depthWrite: false, depthTest: false }),
      );
      p.renderOrder = 8;
      return p;
    };
    const setPoint = (p: THREE.Points, size: number, alpha: number) => {
      (p.geometry.attributes.size.array as Float32Array)[0] = size;
      (p.geometry.attributes.alpha.array as Float32Array)[0] = alpha;
      p.geometry.attributes.size.needsUpdate = true;
      p.geometry.attributes.alpha.needsUpdate = true;
    };
    const inkTone = cssColor("--ink", [40, 39, 36]);
    let unlocking: { t0: number; step: (T: number) => boolean } | null = null;
    const unlock = (key: PlaceKey, info: { stats: string; accent: string | null }) => {
      const i = places.findIndex((p) => p.key === key);
      if (i < 0 || unlocking) return 0;
      const p = places[i];
      const reducedMotion = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
      const { rise: R0, reveal: V, end: END, hold, fade } = UNLOCK;
      const total = END + hold + fade;
      // Approach: drift toward the place
      flyToPoint(p.pos, reducedMotion ? 1 : R0 * 1000, 40);
      // the locked marker (a quiet ring that pulses, then contracts), glow and two ripples
      const locked = fxPoint(18, inkTone);
      const pulse = fxPoint(18, inkTone);
      const glow = fxPoint(90, sage);
      for (const q of [locked, pulse, glow]) q.position.copy(p.pos).add(new THREE.Vector3(0, 0.4, 0));
      const ripples = [0.02, 0.28].map((delay) => {
        const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: sage, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
        m.rotation.x = -Math.PI / 2;
        m.position.copy(p.pos).add(new THREE.Vector3(0, 0.12, 0));
        m.renderOrder = 7;
        return { m, delay };
      });
      unlockFx.add(locked, pulse, glow, ...ripples.map((r) => r.m));
      // the stats beside the peak, on a leader line
      const tag = document.createElement("div");
      tag.className = "pointer-events-none flex flex-col gap-0.5 whitespace-nowrap";
      tag.style.textShadow = "0 0 8px var(--paper), 0 0 2px var(--paper)";
      const a = document.createElement("div");
      a.className = "num text-[13px] text-ink-3";
      a.textContent = info.stats;
      tag.append(a);
      if (info.accent) {
        const b = document.createElement("div");
        b.className = "num text-[13px] font-medium text-sage-deep";
        b.textContent = info.accent;
        tag.append(b);
      }
      const tagPos = p.top.clone().add(new THREE.Vector3(0, 7.6, 0));
      let tagOn = false;
      addLabel(tag, tagPos, () => tagOn);
      const lines = [...tag.children] as HTMLElement[];
      const object = p.object;
      const prevSelected = selectedPlaceIndex;
      selectedPlaceIndex = i; // the marker pops in accent
      const T0 = performance.now();
      const step = (T: number) => {
        // Approach
        const shrink = T < R0 ? draw(1, 0.7, R0 - 0.35, R0)(T) : 0;
        const pul = T < R0 ? 1 + 0.5 * enter(0, 1, 0.15, R0 - 0.35)(T) : 1;
        setPoint(locked, 18 * shrink, shrink > 0 ? 0.9 : 0);
        setPoint(pulse, 18 * pul, T < R0 ? Math.max(0, 0.35 * (1.5 - pul) * 2) : 0);
        if (T < R0 && selectedPlaceIndex === i) {
          selectedPlaceIndex = -1;
          paintPlaces();
        }
        // Rise: the marker pops, ripples spread, the landmark rises out of the ground
        const lift = pop(0, 1, R0 + 0.05, R0 + 0.8)(T);
        object.scale.set(placeScale, placeScale * Math.max(0.001, lift), placeScale);
        if (T >= R0 && selectedPlaceIndex !== i) {
          selectedPlaceIndex = i;
          paintPlaces();
        }
        for (const r of ripples) {
          const start = R0 + r.delay;
          const q = enter(0, 1, start, start + 0.95)(T);
          r.m.scale.setScalar(0.6 + q * 13);
          (r.m.material as THREE.MeshBasicMaterial).opacity = T < start ? 0 : (1 - q) * 0.8;
        }
        const out = 1 - enter(0, 1, END + hold, total)(T);
        setPoint(glow, 90, enter(0, 1, R0, R0 + 0.3)(T) * (0.75 + 0.15 * Math.sin(T * 5)) * 0.6 * out);
        // Reveal: leader line, then the stats
        const lead = draw(0, 1, V - 0.25, V + 0.15)(T);
        leader.visible = lead > 0 && out > 0;
        leader.position.copy(p.top);
        leader.scale.y = Math.max(0.001, lead);
        (leader.material as THREE.LineBasicMaterial).opacity = 0.8 * out;
        tagOn = T >= V;
        lines.forEach((el, k) => {
          const d = V + 0.05 + k * 0.1;
          el.style.opacity = String(enter(0, 1, d, d + 0.35)(T) * out);
          el.style.transform = `translateY(${enter(18, 0, d, d + 0.45)(T)}px)`;
        });
        if (T < total) return true;
        // back to the world as it was: the landmark stands, selection restored
        object.scale.setScalar(placeScale);
        unlockingObject = null;
        leader.visible = false;
        leader.scale.y = 1;
        (leader.material as THREE.LineBasicMaterial).opacity = 0.8;
        selectedPlaceIndex = prevSelected;
        paintPlaces();
        tag.remove();
        labels.splice(labels.findIndex((l) => l.el === tag), 1);
        for (const o of [...unlockFx.children]) {
          unlockFx.remove(o);
          const m = o as THREE.Mesh;
          if (m.geometry !== ringGeo) m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
        return false;
      };
      if (reducedMotion) {
        // no motion: the landmark is simply there, with its stats for the length of the hold
        unlocking = { t0: T0 - END * 1000, step };
      } else {
        object.scale.set(placeScale, 0.001, placeScale);
        unlockingObject = object;
        unlocking = { t0: T0, step };
      }
      invalidate();
      return Math.round((reducedMotion ? hold + fade : total) * 1000);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    setMode(initial.current.tilted);
    flat = flatTarget;
    applyFlat();
    setSelected(initial.current.selectedId);
    setRegion(initial.current.selectedRegion);
    setPlace(initial.current.selectedPlace);
    const focus = initial.current.focusPlace ? places.find((p) => p.key === initial.current.focusPlace) : undefined;
    if (focus) flyToPoint(focus.pos);
    api.current = { setMode, zoom, reset, setSelected, setRegion, setPlace, unlock };
    callbacks.current.onReady?.();
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(hoverFrame);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onTouchDown, true);
      el.removeEventListener("pointermove", onTouchMove, true);
      el.removeEventListener("pointerup", onTouchUp, true);
      el.removeEventListener("pointercancel", onTouchUp, true);
      controls?.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      renderer.dispose();
      // release the GPU context now, not at garbage collection: the scene is rebuilt on every
      // period or theme change, and leaked contexts get WebGL blocked for the site
      renderer.forceContextLoss();
      renderer.domElement.remove();
      labelEl.replaceChildren();
      api.current = null;
    };
  }, [terrain, timeZone, unit, regions, theme, frontier, landmarks]);

  useEffect(() => api.current?.setMode(tilted), [tilted]);
  useEffect(() => api.current?.setSelected(selectedId), [selectedId]);
  useEffect(() => api.current?.setRegion(selectedRegion), [selectedRegion]);
  useEffect(() => api.current?.setPlace(selectedPlace), [selectedPlace]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => api.current?.zoom(1.6),
    zoomOut: () => api.current?.zoom(1 / 1.6),
    reset: () => api.current?.reset(),
    unlock: (key, info) => api.current?.unlock(key, info) ?? 0,
  }));

  return (
    <div className="absolute inset-0">
      <div ref={host} className="absolute inset-0" />
      <div ref={labelsHost} className="pointer-events-none absolute inset-0 overflow-hidden" />
      <div
        ref={tip}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 rounded-md bg-ink px-2.5 py-1.5 text-paper opacity-0 shadow-[var(--shadow)] transition-opacity duration-100"
      />
    </div>
  );
});
