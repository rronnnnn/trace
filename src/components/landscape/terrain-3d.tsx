"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { contourChains, evenLevels, resampleField } from "@/lib/landscape/contours";
import type { RegionSummary } from "@/lib/landscape/explore";
import {
  edgeFalloff,
  riverMesh,
  SIZE_X,
  SIZE_Z,
  smoothField,
  terrainMesh,
  toWorld,
  type MeshPalette,
} from "@/lib/landscape/mesh";
import { parseColor, type RGB } from "@/lib/landscape/relief";
import type { RestSpan } from "@/lib/landscape/rest";
import type { Landmark } from "@/lib/landscape/terrain";
import type { World } from "@/lib/landscape/world";
import { formatShortDate, formatVolume, plural } from "@/lib/format";

export type Terrain3DHandle = { zoomIn: () => void; zoomOut: () => void; reset: () => void; rotate: (radians: number) => void };

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
  onSelectSession: (l: Landmark) => void;
  onSelectRegion: (key: string) => void;
  onSelectRest: (span: RestSpan) => void;
  onClearSelection: () => void;
};

const TILT_POLAR = 0.95; // radians from straight down, for the 3D view
const HOME_DISTANCE = 96;
const ORTHO_HEIGHT = 74; // world units visible top-to-bottom in 2D at zoom 1
const CLOSE = 52; // camera distance under which every session shows

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
    zoom: (factor: number) => void;
    rotate: (radians: number) => void;
    reset: () => void;
  };
  const api = useRef<Api | null>(null);
  const callbacks = useRef({ onSelectSession, onSelectRegion, onSelectRest, onClearSelection, onGrowthDone });
  useEffect(() => {
    callbacks.current = { onSelectSession, onSelectRegion, onSelectRest, onClearSelection, onGrowthDone };
  }, [onSelectSession, onSelectRegion, onSelectRest, onClearSelection, onGrowthDone]);
  const initial = useRef({ tilted, selectedId, selectedRegion });
  useEffect(() => {
    initial.current = { tilted, selectedId, selectedRegion };
  }, [tilted, selectedId, selectedRegion]);

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
    renderer.toneMappingExposure = 1.22;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const paper = cssColor("--paper", [244, 241, 234]);
    scene.fog = new THREE.Fog(paper, 130, 280);
    const sage = cssColor("--sage", [93, 111, 80]);

    // soft, mostly ambient light; one low-intensity key from the north-west reveals the form
    scene.add(new THREE.HemisphereLight(dark ? 0xb4bcc4 : 0xffffff, dark ? 0x1a1d1a : 0x8f8774, dark ? 2.3 : 1.7));
    const centre = new THREE.Vector3(SIZE_X / 2, 0, SIZE_Z / 2);
    const sun = new THREE.DirectionalLight(0xffffff, dark ? 1.5 : 1.6);
    sun.position.set(-45, 60, -35);
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
      terrainMesh({ ...w, field: smoothField(w.field, w.cols, w.rows, 4), water: terrain.water }, pal, 15, 1.7);
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
    const growing =
      Boolean(from && from.cols === terrain.cols && from.rows === terrain.rows) && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
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
    const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.84, metalness: 0 });
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

    // beyond the map: only the shadows reach the page
    const plain = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.ShadowMaterial({ opacity: dark ? 0.35 : 0.14 }));
    plain.rotation.x = -Math.PI / 2;
    plain.position.set(centre.x, -0.02, centre.z);
    plain.receiveShadow = true;
    scene.add(plain);

    // ── contours: fine, many, sage-tinted; every fifth a little stronger ──────
    const cc = 200;
    const cr = Math.round((cc * SIZE_Z) / SIZE_X);
    // traced from the final surface (after the river's carve), so lines follow what you see
    const surface = mesh.heights.map((h) => h / mesh.heightScale);
    const contourField = resampleField(surface, mesh.cols, mesh.rows, cc, cr);
    // lines fade out with the terrain toward the rim (per-vertex alpha), never a hard cut
    const contourColor = cssColor("--contour-index", [94, 90, 80]).lerp(sage, 0.55);
    const lineSet = (opacity: number) => ({ pos: [] as number[], col: [] as number[], opacity });
    const fine = lineSet(dark ? 0.2 : 0.2);
    const index = lineSet(dark ? 0.4 : 0.36);
    for (const c of contourChains(contourField, cc, cr, 1, 1, evenLevels(48, 0.015, 1.25), 5)) {
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
      world.add(
        new THREE.LineSegments(
          bg,
          new THREE.LineBasicMaterial({ color: cssColor("--water-edge", [127, 158, 168]), transparent: true, opacity: 0.55 }),
        ),
      );
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

    // ── cameras & controls (perspective for 3D, orthographic for the flat 2D map) ─
    const persp = new THREE.PerspectiveCamera(40, 1, 0.5, 900);
    const ortho = new THREE.OrthographicCamera(-50, 50, 37, -37, 0.1, 1000);
    ortho.up.set(0, 0, -1); // north up
    let camera: THREE.Camera = persp;
    let controls: MapControls | null = null;
    const target = centre.clone();

    let dirty = true;
    const invalidate = () => {
      dirty = true;
    };
    const clampTarget = (c: MapControls) => {
      const x = Math.min(SIZE_X + 6, Math.max(-6, c.target.x));
      const z = Math.min(SIZE_Z + 6, Math.max(-6, c.target.z));
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
      c.dampingFactor = 0.09;
      c.screenSpacePanning = !is3D;
      c.zoomToCursor = true;
      c.enableRotate = is3D;
      c.minDistance = 14;
      c.maxDistance = 180;
      c.minZoom = 0.7;
      c.maxZoom = 7;
      c.maxPolarAngle = 1.3;
      c.touches = { ONE: THREE.TOUCH.PAN, TWO: is3D ? THREE.TOUCH.DOLLY_ROTATE : THREE.TOUCH.DOLLY_PAN };
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
      plain.visible = flat < 0.5;
    };

    const setMode = (is3D: boolean) => {
      controls?.dispose();
      if (is3D) {
        camera = persp;
        persp.position
          .copy(target)
          .add(new THREE.Vector3().setFromSphericalCoords(HOME_DISTANCE / Math.max(0.7, ortho.zoom), TILT_POLAR, 0));
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

    for (const band of terrain.bands) {
      const ls = marks.filter((l) => l.session.templateKey === band);
      if (!ls.length) continue;
      const top = ls.reduce((best, l) => (l.height > best.height ? l : best), ls[0]);
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
      stat.textContent = summary ? `${plural(summary.workouts, "workout")} · ${plural(summary.records, "PR")}` : "";
      text.append(title, stat);
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

    const selectedLabel = document.createElement("div");
    selectedLabel.className =
      "pointer-events-none whitespace-nowrap rounded-md bg-[var(--surface)] px-2 py-1 text-[11px] text-ink shadow-[var(--shadow)]";
    const selectedPos = new THREE.Vector3();
    addLabel(selectedLabel, selectedPos, () => selectedIndex >= 0);

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
          let rect = new DOMRect(x, y - bh, bw, bh);
          for (let tries = 0; tries < 4 && overlaps(rect); tries++) {
            y -= bh + 4;
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
    const tick = (now: number) => {
      const flying = fly ? fly(now) : false;
      if (!flying) fly = null;
      if (Math.abs(flat - flatTarget) > 0.001) {
        flat += (flatTarget - flat) * 0.18;
        if (Math.abs(flat - flatTarget) < 0.002) flat = flatTarget;
        applyFlat();
        dirty = true;
      }
      const moved = ctl().update();
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
      const halfH = ORTHO_HEIGHT / 2;
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
        const to = Math.min(7, Math.max(0.7, from * factor));
        return animate((e) => {
          ortho.zoom = from * Math.pow(to / from, e);
          ortho.updateProjectionMatrix();
          changed();
        });
      }
      const off = persp.position.clone().sub(ctl().target);
      const from = off.length();
      const to = Math.min(180, Math.max(14, from / factor));
      animate((e) => {
        persp.position.copy(ctl().target).add(off.clone().setLength(from * Math.pow(to / from, e)));
        changed();
      });
    };
    const flyToPoint = (p: THREE.Vector3) => {
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
      const d1 = Math.min(sph.radius, 44);
      animate((e) => {
        c.target.lerpVectors(fromT, toT, e);
        persp.position
          .copy(c.target)
          .add(new THREE.Vector3().setFromSphericalCoords(sph.radius * Math.pow(d1 / sph.radius, e), sph.phi, sph.theta));
        persp.lookAt(c.target);
        changed();
      });
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
              sph.radius + (HOME_DISTANCE - sph.radius) * e,
              sph.phi + (TILT_POLAR - sph.phi) * e,
              sph.theta * (1 - e),
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

    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return void (down = null);
      down = null;
      const hit = pickAt(e.clientX, e.clientY);
      if (hit?.kind === "session") {
        callbacks.current.onSelectSession(marks[hit.index]);
        flyToPoint(base[hit.index]);
      } else if (hit?.kind === "rest") callbacks.current.onSelectRest(hit.span);
      else if (hit?.kind === "region") callbacks.current.onSelectRegion(hit.key);
      else callbacks.current.onClearSelection();
    };
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
    const setRegion = (key: string | null) => {
      selectedRegionIndex = key ? (regionOf.get(key) ?? -1) : -1;
      regionUniforms.uSelected.value = selectedRegionIndex;
      refreshPoints();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    setMode(initial.current.tilted);
    flat = flatTarget;
    applyFlat();
    setSelected(initial.current.selectedId);
    setRegion(initial.current.selectedRegion);
    api.current = { setMode, zoom, reset, setSelected, setRegion };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(hoverFrame);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      controls?.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
      labelEl.replaceChildren();
      api.current = null;
    };
  }, [terrain, timeZone, unit, regions, theme]);

  useEffect(() => api.current?.setMode(tilted), [tilted]);
  useEffect(() => api.current?.setSelected(selectedId), [selectedId]);
  useEffect(() => api.current?.setRegion(selectedRegion), [selectedRegion]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => api.current?.zoom(1.6),
    zoomOut: () => api.current?.zoom(1 / 1.6),
    reset: () => api.current?.reset(),
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
