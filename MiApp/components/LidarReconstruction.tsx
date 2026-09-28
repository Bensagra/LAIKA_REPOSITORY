import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Web-only live LiDAR map rendered as a continuous surface, not a point cloud.
//
// Map protocol (same as the reference console, benyi2.html):
//  - points arrive already in the map frame;
//  - header.mode "keyframe" = full map snapshot (replace), "delta" = new points (add);
//  - colors are RGBA per point, alpha 0 = no camera colour for that point;
//  - header.pose {x, y, yaw} is the robot pose, header.path its trail (keyframes).
//
// Realism: each occupied 5 cm cell becomes a "surfel" (small disc) oriented by
// the surface normal estimated from its neighbours (PCA), so walls and floors
// read as smooth lit surfaces. Isolated cells (sensor noise) are hidden, and
// ambient occlusion (GTAO) + filmic tone mapping give depth to corners.

const VOXEL_M = 0.05;
const SURFEL_RADIUS = VOXEL_M * 0.8; // > half the cell diagonal: discs overlap, no gaps
const MAX_CELLS = 150000;
const NOISE_FILTER_MIN_CELLS = 3000; // only drop isolated cells once the map is dense
const KEY_OFFSET = 1 << 15;
const KEY_SPAN = 1 << 16;
const BG = new THREE.Color('#1c1818');

// 3x3x3 neighbourhood as key deltas (keys are linear in ix, iy, iz).
const NEIGH_KEY: number[] = [];
const NEIGH_D: [number, number, number][] = [];
for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
  NEIGH_KEY.push((dx * KEY_SPAN + dy) * KEY_SPAN + dz);
  NEIGH_D.push([dx, dy, dz]);
}

const cellKey = (ix: number, iy: number, iz: number) =>
  ((ix + KEY_OFFSET) * KEY_SPAN + (iy + KEY_OFFSET)) * KEY_SPAN + (iz + KEY_OFFSET);

const PALETTE = [
  new THREE.Color('#4a3c3a'),
  new THREE.Color('#9a8680'),
  new THREE.Color('#efe4de'),
];

function heightColor(t: number, out: THREE.Color) {
  const c = Math.min(1, Math.max(0, t));
  if (c < 0.5) return out.copy(PALETTE[0]).lerp(PALETTE[1], c * 2);
  return out.copy(PALETTE[1]).lerp(PALETTE[2], (c - 0.5) * 2);
}

/** Eigenvector of the smallest eigenvalue of a symmetric 3x3 matrix (the plane normal). */
function smallestEigenvector(
  a00: number, a01: number, a02: number, a11: number, a12: number, a22: number, out: THREE.Vector3,
): boolean {
  const p1 = a01 * a01 + a02 * a02 + a12 * a12;
  let lambda: number;
  if (p1 < 1e-12) {
    lambda = Math.min(a00, a11, a22);
  } else {
    const q = (a00 + a11 + a22) / 3;
    const b00 = a00 - q, b11 = a11 - q, b22 = a22 - q;
    const p = Math.sqrt((b00 * b00 + b11 * b11 + b22 * b22 + 2 * p1) / 6);
    const det = (b00 * (b11 * b22 - a12 * a12) - a01 * (a01 * b22 - a12 * a02) + a02 * (a01 * a12 - b11 * a02)) / (p * p * p);
    const phi = Math.acos(Math.min(1, Math.max(-1, det / 2))) / 3;
    lambda = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  }
  // Rows of (A - λI) span the plane orthogonal to the eigenvector: cross two of them.
  const r0x = a00 - lambda, r0y = a01, r0z = a02;
  const r1x = a01, r1y = a11 - lambda, r1z = a12;
  const r2x = a02, r2y = a12, r2z = a22 - lambda;
  const c0x = r0y * r1z - r0z * r1y, c0y = r0z * r1x - r0x * r1z, c0z = r0x * r1y - r0y * r1x;
  const c1x = r0y * r2z - r0z * r2y, c1y = r0z * r2x - r0x * r2z, c1z = r0x * r2y - r0y * r2x;
  const c2x = r1y * r2z - r1z * r2y, c2y = r1z * r2x - r1x * r2z, c2z = r1x * r2y - r1y * r2x;
  const d0 = c0x * c0x + c0y * c0y + c0z * c0z;
  const d1 = c1x * c1x + c1y * c1y + c1z * c1z;
  const d2 = c2x * c2x + c2y * c2y + c2z * c2z;
  if (d0 >= d1 && d0 >= d2 && d0 > 1e-12) out.set(c0x, c0y, c0z);
  else if (d1 >= d2 && d1 > 1e-12) out.set(c1x, c1y, c1z);
  else if (d2 > 1e-12) out.set(c2x, c2y, c2z);
  else return false;
  out.normalize();
  return true;
}

export interface LidarPose { x: number; y: number; yaw: number }

export interface LidarSinkFrame {
  points: Float32Array;
  colors: Uint8Array | null;
  mode?: string;
  pose?: LidarPose | null;
  path?: [number, number][] | null;
}

/** Imperative input so no frame is lost to React batching (deltas must all land). */
export interface LidarSink {
  addFrame(frame: LidarSinkFrame): void;
  clear(): void;
}

interface Cell {
  ix: number; iy: number; iz: number;
  r: number; g: number; b: number; hasColor: boolean;
  /** Orientation of the surfel (disc +Z onto the surface normal). */
  q: THREE.Quaternion;
  neighbours: number;
}

interface MapState {
  cells: Map<number, Cell>; // insertion order doubles as recency (oldest first)
  normalsDirty: Set<number>;
  pose: LidarPose | null;
  path: [number, number][];
  dirty: boolean;
  userMoved: boolean;
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);

export default function LidarReconstruction({ sinkRef }: { sinkRef: React.MutableRefObject<LidarSink | null> }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = BG;
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 1000);
    camera.up.set(0, 0, 1);
    camera.position.set(6, -8, 9);

    const hemi = new THREE.HemisphereLight(0xfff4ee, 0x2a2020, 1.2);
    hemi.position.set(0, 0, 1);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(6, -4, 12);
    const fill = new THREE.DirectionalLight(0xffe8e0, 0.5);
    fill.position.set(-8, 6, 4);
    scene.add(hemi, sun, fill);

    const geometry = new THREE.CircleGeometry(SURFEL_RADIUS, 8);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.92, metalness: 0, side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_CELLS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CELLS * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);

    const grid = new THREE.GridHelper(60, 120, 0x4a3a3a, 0x2e2525);
    grid.rotation.x = Math.PI / 2;
    grid.visible = false;
    scene.add(grid);

    // Robot marker (points along its heading) and travelled path.
    const robotGeometry = new THREE.ConeGeometry(0.16, 0.45, 20);
    const robot = new THREE.Mesh(robotGeometry, new THREE.MeshStandardMaterial({ color: 0xe83d3d, emissive: 0x501010 }));
    robot.visible = false;
    scene.add(robot);

    const pathGeometry = new THREE.BufferGeometry();
    const pathLine = new THREE.Line(pathGeometry, new THREE.LineBasicMaterial({ color: 0xffd02e }));
    pathLine.frustumCulled = false;
    scene.add(pathLine);

    // Ambient occlusion + tone mapping. Falls back to a plain render if the
    // GPU can't run the pass.
    let composer: EffectComposer | null = null;
    let gtao: GTAOPass | null = null;
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      gtao = new GTAOPass(scene, camera, 512, 512);
      gtao.updateGtaoMaterial({ radius: 0.35, distanceFallOff: 1, thickness: 1, scale: 1.2 });
      gtao.blendIntensity = 1;
      composer.addPass(gtao);
      composer.addPass(new OutputPass());
    } catch {
      composer = null;
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;

    const map: MapState = {
      cells: new Map(), normalsDirty: new Set(), pose: null, path: [], dirty: false, userMoved: false,
    };
    let frameRequest = 0;

    const render = () => {
      if (composer) composer.render();
      else renderer.render(scene, camera);
    };
    controls.addEventListener('change', render);
    // Once the operator orbits/zooms, stop auto-following the robot.
    controls.addEventListener('start', () => { map.userMoved = true; });

    const normal = new THREE.Vector3();
    const updateNormal = (key: number, cell: Cell) => {
      // PCA over the occupied cells in the 3x3x3 neighbourhood.
      let n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, sxy = 0, sxz = 0, syy = 0, syz = 0, szz = 0;
      for (let j = 0; j < 27; j++) {
        if (!map.cells.has(key + NEIGH_KEY[j])) continue;
        const [dx, dy, dz] = NEIGH_D[j];
        n++; sx += dx; sy += dy; sz += dz;
        sxx += dx * dx; sxy += dx * dy; sxz += dx * dz; syy += dy * dy; syz += dy * dz; szz += dz * dz;
      }
      cell.neighbours = n - 1;
      if (n >= 3) {
        const mx = sx / n, my = sy / n, mz = sz / n;
        const ok = smallestEigenvector(
          sxx / n - mx * mx, sxy / n - mx * my, sxz / n - mx * mz,
          syy / n - my * my, syz / n - my * mz, szz / n - mz * mz, normal,
        );
        if (ok) { cell.q.setFromUnitVectors(Z_AXIS, normal); return; }
      }
      cell.q.identity(); // too few neighbours: face up
    };

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    const color = new THREE.Color();

    const rebuild = () => {
      frameRequest = 0;
      if (!map.dirty) return;
      map.dirty = false;

      for (const key of map.normalsDirty) {
        const cell = map.cells.get(key);
        if (cell) updateNormal(key, cell);
      }
      map.normalsDirty.clear();

      let minZ = Infinity, maxZ = -Infinity, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of map.cells.values()) {
        if (c.iz < minZ) minZ = c.iz; if (c.iz > maxZ) maxZ = c.iz;
        if (c.ix < minX) minX = c.ix; if (c.ix > maxX) maxX = c.ix;
        if (c.iy < minY) minY = c.iy; if (c.iy > maxY) maxY = c.iy;
      }
      minZ *= VOXEL_M; maxZ *= VOXEL_M; minX *= VOXEL_M; maxX *= VOXEL_M; minY *= VOXEL_M; maxY *= VOXEL_M;
      const zSpan = Math.max(maxZ - minZ, 0.001);

      const filterNoise = map.cells.size > NOISE_FILTER_MIN_CELLS;
      const matrices = mesh.instanceMatrix.array as Float32Array;
      const colors = mesh.instanceColor!.array as Float32Array;
      let i = 0;
      for (const c of map.cells.values()) {
        // Real surfaces have several occupied neighbours; 0-1 is sensor noise
        // (a thin pole still keeps the cells above and below it).
        if (filterNoise && c.neighbours < 2) continue;
        position.set(c.ix * VOXEL_M, c.iy * VOXEL_M, c.iz * VOXEL_M);
        matrix.compose(position, c.q, scale);
        matrix.toArray(matrices, i * 16);
        if (c.hasColor) color.setRGB(c.r / 255, c.g / 255, c.b / 255, THREE.SRGBColorSpace);
        else heightColor((c.iz * VOXEL_M - minZ) / zSpan, color);
        colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
        i++;
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;

      const count = map.cells.size;
      const floorZ = count ? minZ : 0;
      grid.visible = count > 0;
      grid.position.z = floorZ - VOXEL_M;

      if (map.pose) {
        robot.visible = true;
        robot.position.set(map.pose.x, map.pose.y, floorZ + 0.3);
        // Cone axis is +Y; rotate it onto the heading in the XY plane.
        robot.rotation.set(0, 0, map.pose.yaw - Math.PI / 2);
      } else {
        robot.visible = false;
      }

      const pathPositions = new Float32Array(map.path.length * 3);
      map.path.forEach(([px, py], k) => {
        pathPositions[k * 3] = px; pathPositions[k * 3 + 1] = py; pathPositions[k * 3 + 2] = floorZ + 0.05;
      });
      pathGeometry.setAttribute('position', new THREE.BufferAttribute(pathPositions, 3));
      pathGeometry.setDrawRange(0, map.path.length);

      if (!map.userMoved && count) {
        // Follow the robot (or the map centre) at a distance that fits the map.
        const radius = Math.max(Math.hypot(maxX - minX, maxY - minY, zSpan) / 2, 2);
        const target = map.pose
          ? new THREE.Vector3(map.pose.x, map.pose.y, (minZ + maxZ) / 2)
          : new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        const dist = Math.min(Math.max(radius * 1.5, 4), 60);
        controls.target.copy(target);
        camera.position.set(target.x + dist * 0.35, target.y - dist * 0.5, target.z + dist * 0.8);
        controls.update();
      }
      render();
    };

    const scheduleRebuild = () => {
      map.dirty = true;
      if (!frameRequest) frameRequest = requestAnimationFrame(rebuild);
    };

    sinkRef.current = {
      addFrame({ points, colors, mode, pose, path }) {
        const keyframe = mode === 'keyframe';
        // On a keyframe, rebuild the map but reuse cells (and their normals)
        // that are still present, so only real changes cost normal updates.
        const previous = keyframe ? map.cells : null;
        if (keyframe) {
          map.cells = new Map();
          if (Array.isArray(path)) map.path = path.map((p) => [Number(p[0]), Number(p[1])] as [number, number]);
        }
        const cells = map.cells;
        const changed: number[] = [];
        const inv = 1 / VOXEL_M;
        const n = Math.floor(points.length / 3);
        const hasRgba = !!colors && colors.length >= n * 4;

        for (let i = 0; i < n; i++) {
          const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
          const ix = Math.round(x * inv), iy = Math.round(y * inv), iz = Math.round(z * inv);
          const key = cellKey(ix, iy, iz);
          let cell = cells.get(key);
          if (cell) {
            cells.delete(key); // refresh recency
          } else if (!(previous && (cell = previous.get(key)))) {
            cell = { ix, iy, iz, r: 0, g: 0, b: 0, hasColor: false, q: new THREE.Quaternion(), neighbours: 0 };
            changed.push(key);
          }
          // Keep the last known camera colour when this observation has none.
          if (hasRgba && colors![i * 4 + 3] !== 0) {
            cell.r = colors![i * 4]; cell.g = colors![i * 4 + 1]; cell.b = colors![i * 4 + 2]; cell.hasColor = true;
          }
          cells.set(key, cell);
        }
        if (previous) {
          for (const key of previous.keys()) if (!cells.has(key)) changed.push(key);
        }
        // Over budget: forget the cells not seen for the longest time.
        while (cells.size > MAX_CELLS) {
          const oldest = cells.keys().next().value!;
          cells.delete(oldest);
          changed.push(oldest);
        }
        // A cell's normal depends on its neighbours: refresh around every change.
        for (const key of changed) {
          for (let j = 0; j < 27; j++) {
            const nk = key + NEIGH_KEY[j];
            if (cells.has(nk)) map.normalsDirty.add(nk);
          }
        }

        if (pose && Number.isFinite(pose.x) && Number.isFinite(pose.y)) {
          map.pose = { x: pose.x, y: pose.y, yaw: Number.isFinite(pose.yaw) ? pose.yaw : 0 };
          if (!keyframe) {
            const last = map.path[map.path.length - 1];
            if (!last || Math.hypot(map.pose.x - last[0], map.pose.y - last[1]) >= 0.05) {
              map.path.push([map.pose.x, map.pose.y]);
              if (map.path.length > 4000) map.path.shift();
            }
          }
        }
        scheduleRebuild();
      },
      clear() {
        map.cells.clear();
        map.normalsDirty.clear();
        map.path = [];
        map.pose = null;
        map.userMoved = false;
        scheduleRebuild();
      },
    };

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      composer?.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    return () => {
      sinkRef.current = null;
      if (frameRequest) cancelAnimationFrame(frameRequest);
      observer.disconnect();
      controls.dispose();
      gtao?.dispose();
      composer?.dispose();
      geometry.dispose();
      material.dispose();
      robotGeometry.dispose();
      mesh.dispose();
      pathGeometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [sinkRef]);

  return React.createElement('div', {
    ref: hostRef,
    style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, touchAction: 'none' },
  });
}
