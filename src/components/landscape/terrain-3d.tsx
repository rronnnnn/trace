"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { contourChains, evenLevels, resampleField } from "@/lib/landscape/contours";
import { edgeFalloff, riverMesh, SIZE_X, SIZE_Z, terrainMesh, toWorld, type MeshPalette } from "@/lib/landscape/mesh";
import { parseColor, treePositions, type RGB } from "@/lib/landscape/relief";
import type { RestSpan } from "@/lib/landscape/rest";
import { hashString, type Landmark, type Terrain } from "@/lib/landscape/terrain";
import { formatShortDate } from "@/lib/format";

export type Terrain3DHandle = { zoomIn: () => void; zoomOut: () => void; reset: () => void };

type Props = {
  terrain: Terrain;
  seed: string;
  timeZone: string;
  tilted: boolean;
  selectedId: string | null;
  theme: number;
  onSelectSession: (l: Landmark) => void;
  onSelectRest: (span: RestSpan) => void;
  onClearSelection: () => void;
};

const TILT_POLAR = 0.98; // radians from straight down, for the 3D view
const FLAT_POLAR = 0.0001;
const HOME_DISTANCE = 92;

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

/**
 * The Training Landscape as a real 3D scene: lit terrain mesh with shadows, draped contours,
 * a water surface for the river, instanced trees and standing pins for sessions. Labels are
 * HTML projected from 3D each frame, so text stays sharp at any zoom.
 */
export const Terrain3D = forwardRef<Terrain3DHandle, Props>(function Terrain3D(
  { terrain, seed, timeZone, tilted, selectedId, theme, onSelectSession, onSelectRest, onClearSelection },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const labelsHost = useRef<HTMLDivElement>(null);
  const api = useRef<{
    camera: THREE.PerspectiveCamera;
    controls: MapControls;
    invalidate: () => void;
    flyTo: (polar: number, distance: number, target?: THREE.Vector3) => void;
    setSelected: (id: string | null) => void;
  } | null>(null);
  const callbacks = useRef({ onSelectSession, onSelectRest, onClearSelection });
  useEffect(() => {
    callbacks.current = { onSelectSession, onSelectRest, onClearSelection };
  }, [onSelectSession, onSelectRest, onClearSelection]);

  // ── build the scene (once per terrain / theme) ─────────────────────────────
  useEffect(() => {
    const el = host.current;
    const labelEl = labelsHost.current;
    if (!el || !labelEl) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const paper = cssColor("--paper", [244, 241, 234]);
    scene.fog = new THREE.Fog(paper, 120, 260);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 800);
    const centre = new THREE.Vector3(SIZE_X / 2, 0, SIZE_Z / 2);

    // light from the north-west, the cartographic convention
    const dark =
      document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    scene.add(new THREE.HemisphereLight(dark ? 0xa9b2bd : 0xffffff, dark ? 0x1c1f1c : 0x8a826e, dark ? 1.9 : 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, dark ? 2.6 : 2.3);
    sun.position.set(-40, 70, -30);
    sun.target.position.copy(centre);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.05;
    scene.add(sun, sun.target);

    // terrain
    const pal = palette();
    const mesh = terrainMesh(terrain, pal, 16, 1.7);
    // vertex colours arrive as sRGB 0–1; linearise them like every other colour in the scene
    // ...and fade the terrain out at its borders (opacity, not colour: lighting would shift a
    // colour match), so the page shows through and the map has no edge at all
    const tmp = new THREE.Color();
    const rgba = new Float32Array((mesh.colors.length / 3) * 4);
    for (let v = 0; v < mesh.colors.length / 3; v++) {
      const k = v * 3;
      tmp.setRGB(mesh.colors[k], mesh.colors[k + 1], mesh.colors[k + 2], THREE.SRGBColorSpace);
      const f = edgeFalloff((v % mesh.cols) / (mesh.cols - 1), Math.floor(v / mesh.cols) / (mesh.rows - 1), 0.16);
      rgba.set([tmp.r, tmp.g, tmp.b, f * f], v * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(rgba, 4));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.96, metalness: 0 }),
    );
    ground.castShadow = true;
    ground.receiveShadow = true;
    scene.add(ground);

    // the ground beyond the map is the page itself: invisible except for the shadows cast on it
    const plain = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.ShadowMaterial({ opacity: dark ? 0.45 : 0.18 }));
    plain.rotation.x = -Math.PI / 2;
    plain.position.set(centre.x, -0.02, centre.z);
    plain.receiveShadow = true;
    scene.add(plain);

    // draped contours (every third level), subtle: the 3D form does the work now
    const cc = 180;
    const cr = Math.round((cc * SIZE_Z) / SIZE_X);
    const coarse = resampleField(terrain.field, terrain.cols, terrain.rows, cc, cr);
    const lines: number[] = [];
    for (const c of contourChains(coarse, cc, cr, 1, 1, evenLevels(18)).filter((_, i) => i % 2 === 1)) {
      for (const chain of c.chains) {
        for (let i = 0; i < chain.length - 1; i++) {
          if (edgeFalloff(chain[i][0], chain[i][1], 0.16) < 0.6) continue; // none in the faded rim
          const a = toWorld(chain[i][0], chain[i][1], mesh.heightAt, 0.06);
          const b = toWorld(chain[i + 1][0], chain[i + 1][1], mesh.heightAt, 0.06);
          lines.push(...a, ...b);
        }
      }
    }
    const contourGeo = new THREE.BufferGeometry();
    contourGeo.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    const contours = new THREE.LineSegments(
      contourGeo,
      new THREE.LineBasicMaterial({ color: cssColor("--contour-index", [94, 90, 80]), transparent: true, opacity: dark ? 0.32 : 0.28 }),
    );
    scene.add(contours);

    // river: a still water surface in the valley
    const river = riverMesh(terrain.water.river, mesh.heightAt, 0.3, 1.7, mesh.riverBed);
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
          emissive: cssColor("--water-edge", [127, 158, 168]),
          emissiveIntensity: dark ? 0.12 : 0.1,
          roughness: 0.18,
          metalness: 0.1,
          transparent: true,
          opacity: 0.94,
          side: THREE.DoubleSide,
        }),
      );
      water.receiveShadow = true;
      scene.add(water);
    }

    // trees: instanced low-poly conifers on the low, gentle ground
    const trees = treePositions(terrain, seed, 0.016, SIZE_X / SIZE_Z).filter(([x, y]) => edgeFalloff(x, y, 0.16) > 0.7);
    const treeGeo = new THREE.ConeGeometry(0.3, 1.05, 6);
    treeGeo.translate(0, 0.52, 0);
    const forest = new THREE.InstancedMesh(
      treeGeo,
      new THREE.MeshStandardMaterial({ color: cssColor("--tree", [111, 125, 87]), roughness: 0.9, flatShading: true }),
      trees.length,
    );
    const m4 = new THREE.Matrix4();
    trees.forEach(([x, y], i) => {
      const s = 0.65 + ((hashString(`${seed}${i}`) % 100) / 100) * 0.6;
      const p = toWorld(x, y, mesh.heightAt);
      m4.compose(new THREE.Vector3(...p), new THREE.Quaternion(), new THREE.Vector3(s, s * (0.9 + (i % 3) * 0.15), s));
      forest.setMatrixAt(i, m4);
    });
    forest.castShadow = true;
    scene.add(forest);

    // pins: a thin stem and a head standing on the terrain; records in sage
    const marks = terrain.landmarks;
    const stemGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6);
    stemGeo.translate(0, 1.1, 0);
    const headGeo = new THREE.SphereGeometry(0.55, 16, 12);
    const stems = new THREE.InstancedMesh(
      stemGeo,
      new THREE.MeshStandardMaterial({ color: cssColor("--ink-3", [106, 103, 95]) }),
      marks.length,
    );
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ roughness: 0.4 }), marks.length);
    // ink contrasts with the terrain in both themes (dark pins on pale ground, light on dark)
    const sessionColor = cssColor("--ink", [29, 28, 26]);
    const recordColor = cssColor("--sage", [93, 111, 80]);
    const pinBase: THREE.Vector3[] = [];
    marks.forEach((l, i) => {
      const p = new THREE.Vector3(...toWorld(l.x, l.y, mesh.heightAt));
      pinBase.push(p);
      m4.makeTranslation(p.x, p.y, p.z);
      stems.setMatrixAt(i, m4);
      m4.makeTranslation(p.x, p.y + 2.4, p.z);
      heads.setMatrixAt(i, m4);
      heads.setColorAt(i, l.session.prCount > 0 ? recordColor : sessionColor);
    });
    stems.castShadow = true;
    heads.castShadow = true;
    scene.add(stems, heads);

    // selection ring around the chosen pin's foot
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.09, 8, 48),
      new THREE.MeshBasicMaterial({ color: cssColor("--ink", [29, 28, 26]) }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    scene.add(ring);

    // ── camera & controls ───────────────────────────────────────────────────
    const controls = new MapControls(camera, renderer.domElement);
    controls.target.copy(centre);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.screenSpacePanning = false;
    controls.minDistance = 14;
    controls.maxDistance = 170;
    controls.zoomToCursor = true;
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };

    const place = (polar: number, distance: number, azimuth = 0) => {
      const offset = new THREE.Vector3().setFromSphericalCoords(distance, polar, azimuth);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
    };
    place(tilted ? TILT_POLAR : FLAT_POLAR, HOME_DISTANCE);
    const lockPolar = (polar: number | null) => {
      controls.minPolarAngle = polar ?? 0;
      controls.maxPolarAngle = polar ?? 1.32;
      controls.enableRotate = polar == null;
    };
    lockPolar(tilted ? null : FLAT_POLAR);

    // keep the camera over the map
    controls.addEventListener("change", () => {
      const t = controls.target;
      const cx = Math.min(SIZE_X + 10, Math.max(-10, t.x));
      const cz = Math.min(SIZE_Z + 10, Math.max(-10, t.z));
      if (cx !== t.x || cz !== t.z) {
        camera.position.x += cx - t.x;
        camera.position.z += cz - t.z;
        t.set(cx, 0, cz);
      }
    });

    // ── labels (HTML, projected) ────────────────────────────────────────────
    type Label = { el: HTMLDivElement; pos: THREE.Vector3; minZoom: number; maxDistance?: number };
    const labels: Label[] = [];
    const addLabel = (text: string, pos: THREE.Vector3, className: string, maxDistance?: number) => {
      const d = document.createElement("div");
      d.textContent = text;
      d.className = className;
      d.style.position = "absolute";
      d.style.left = "0";
      d.style.top = "0";
      d.style.willChange = "transform";
      labelEl.appendChild(d);
      labels.push({ el: d, pos, minZoom: 0, maxDistance });
    };
    const rangeClass =
      "pointer-events-none whitespace-nowrap text-[11px] sm:text-[12px] font-medium tracking-[0.04em] text-ink [text-shadow:0_0_6px_var(--paper),0_0_2px_var(--paper)]";
    for (const band of terrain.bands) {
      const ls = marks.filter((l) => l.session.templateKey === band);
      if (!ls.length) continue;
      const mid = ls.reduce((best, l) => (Math.abs(l.u - 0.5) < Math.abs(best.u - 0.5) ? l : best), ls[0]);
      addLabel(mid.session.label, new THREE.Vector3(...toWorld(mid.x, mid.y, mesh.heightAt, 5.2)), rangeClass);
    }
    const smallClass =
      "pointer-events-none whitespace-nowrap text-[10.5px] text-ink-2 num [text-shadow:0_0_5px_var(--paper),0_0_2px_var(--paper)]";
    marks.forEach((l, i) =>
      addLabel(formatShortDate(l.session.endedAt, timeZone), pinBase[i].clone().add(new THREE.Vector3(0, 3.6, 0)), smallClass, 42),
    );
    const waterClass =
      "pointer-events-none whitespace-nowrap text-[10.5px] italic text-[var(--water-edge)] [text-shadow:0_0_5px_var(--paper)]";
    for (const lake of terrain.water.lakes) {
      if (lake.span.days < 2) continue;
      addLabel(`${lake.span.days} days rest`, new THREE.Vector3(...toWorld(lake.x, lake.y, mesh.heightAt, 0.8)), waterClass, 60);
    }

    const v = new THREE.Vector3();
    const updateLabels = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const dist = camera.position.distanceTo(controls.target);
      for (const l of labels) {
        v.copy(l.pos).project(camera);
        const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && (l.maxDistance == null || dist < l.maxDistance);
        l.el.style.opacity = visible ? "1" : "0";
        if (visible) l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
      }
    };

    // ── render on demand ────────────────────────────────────────────────────
    let dirty = true;
    const invalidate = () => {
      dirty = true;
    };
    controls.addEventListener("change", invalidate);
    let raf = 0;
    let fly: ((now: number) => boolean) | null = null;
    const tick = (now: number) => {
      const flying = fly ? fly(now) : false;
      if (!flying) fly = null;
      const moved = controls.update();
      if (moved || dirty || flying) {
        renderer.render(scene, camera);
        updateLabels();
        dirty = false;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      invalidate();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const flyTo = (polar: number, distance: number, target?: THREE.Vector3) => {
      const fromTarget = controls.target.clone();
      const toTarget = target ?? fromTarget.clone();
      const off = camera.position.clone().sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(off);
      const from = { polar: sph.phi, dist: sph.radius, az: sph.theta };
      const to = { polar, dist: distance, az: polar === FLAT_POLAR ? 0 : from.az };
      const t0 = performance.now();
      const dur = reduced ? 0 : 520;
      fly = (now) => {
        const t = dur ? Math.min(1, (now - t0) / dur) : 1;
        const e = 1 - Math.pow(1 - t, 3);
        controls.target.lerpVectors(fromTarget, toTarget, e);
        const p = from.polar + (to.polar - from.polar) * e;
        const d = from.dist * Math.pow(to.dist / from.dist, e);
        const a = from.az + (to.az - from.az) * e;
        camera.position.copy(controls.target).add(new THREE.Vector3().setFromSphericalCoords(d, p, a));
        camera.lookAt(controls.target);
        return t < 1;
      };
    };

    // ── picking ─────────────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return void (down = null);
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(heads, false)[0];
      if (hit && hit.instanceId != null) {
        const l = marks[hit.instanceId];
        callbacks.current.onSelectSession(l);
        if (camera.position.distanceTo(controls.target) > 50)
          flyTo(tilted ? TILT_POLAR : FLAT_POLAR, 42, pinBase[hit.instanceId].clone().setY(0));
        return;
      }
      const wet = water ? raycaster.intersectObject(water, false)[0] : undefined;
      if (wet) {
        const nx = wet.point.x / SIZE_X;
        const lake = [...terrain.water.lakes].sort((a, b) => Math.abs(a.x - nx) - Math.abs(b.x - nx))[0];
        if (lake && Math.abs(lake.x - nx) < lake.rx * 1.5) return callbacks.current.onSelectRest(lake.span);
      }
      callbacks.current.onClearSelection();
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    api.current = {
      camera,
      controls,
      invalidate,
      flyTo,
      setSelected: (id) => {
        const i = id ? marks.findIndex((l) => l.session.id === id) : -1;
        ring.visible = i >= 0;
        if (i >= 0) ring.position.copy(pinBase[i]).add(new THREE.Vector3(0, 0.15, 0));
        invalidate();
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
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
    // tilted is applied by the effect below; rebuilding the scene for it would lose the camera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, seed, timeZone, theme]);

  // 2D ↔ 3D: fly the camera between top-down and tilted, keeping the place you're looking at
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const dist = a.camera.position.distanceTo(a.controls.target);
    a.controls.minPolarAngle = 0;
    a.controls.maxPolarAngle = 1.32;
    a.controls.enableRotate = tilted;
    a.flyTo(tilted ? TILT_POLAR : FLAT_POLAR, dist);
    const t = setTimeout(() => {
      if (!tilted) {
        a.controls.minPolarAngle = FLAT_POLAR;
        a.controls.maxPolarAngle = FLAT_POLAR;
      }
    }, 560);
    return () => clearTimeout(t);
  }, [tilted]);

  useEffect(() => {
    api.current?.setSelected(selectedId);
  }, [selectedId]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      const a = api.current;
      if (!a) return;
      const sph = new THREE.Spherical().setFromVector3(a.camera.position.clone().sub(a.controls.target));
      a.flyTo(sph.phi, Math.max(a.controls.minDistance, sph.radius / 1.6));
    },
    zoomOut: () => {
      const a = api.current;
      if (!a) return;
      const sph = new THREE.Spherical().setFromVector3(a.camera.position.clone().sub(a.controls.target));
      a.flyTo(sph.phi, Math.min(a.controls.maxDistance, sph.radius * 1.6));
    },
    reset: () => api.current?.flyTo(tilted ? TILT_POLAR : FLAT_POLAR, HOME_DISTANCE, new THREE.Vector3(SIZE_X / 2, 0, SIZE_Z / 2)),
  }));

  return (
    <div className="absolute inset-0">
      <div ref={host} className="absolute inset-0" />
      <div ref={labelsHost} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />
    </div>
  );
});
