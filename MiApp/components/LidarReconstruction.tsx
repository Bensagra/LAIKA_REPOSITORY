import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Web-only live LiDAR map rendered as solid voxels (not a point cloud).
// Follows the server's map protocol, same as the reference console (benyi2.html):
//  - points arrive already in the map frame;
//  - header.mode "keyframe" = full map snapshot (replace), "delta" = new points (add);
//  - colors are RGBA per point, alpha 0 = no camera colour for that point;
//  - header.pose {x, y, yaw} is the robot pose, header.path its trail (keyframes).

const VOXEL_M = 0.08;
const MAX_VOXELS = 130000;
const KEY_OFFSET = 1 << 15;
const KEY_SPAN = 1 << 16;

const PALETTE = [
  new THREE.Color('#3a2d2d'),
  new THREE.Color('#8a7470'),
  new THREE.Color('#f2e3dc'),
];

function heightColor(t: number, out: THREE.Color) {
  const c = Math.min(1, Math.max(0, t));
  if (c < 0.5) return out.copy(PALETTE[0]).lerp(PALETTE[1], c * 2);
  return out.copy(PALETTE[1]).lerp(PALETTE[2], (c - 0.5) * 2);
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

// Voxel entry: [x, y, z, r, g, b, hasColor]
type Voxel = [number, number, number, number, number, number, number];

interface MapState {
  voxels: Map<number, Voxel>;
  pose: LidarPose | null;
  path: [number, number][];
  dirty: boolean;
  userMoved: boolean;
}

export default function LidarReconstruction({ sinkRef }: { sinkRef: React.MutableRefObject<LidarSink | null> }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 1000);
    camera.up.set(0, 0, 1);
    camera.position.set(6, -8, 9);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2020, 1.1);
    hemi.position.set(0, 0, 1);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(6, -4, 12);
    scene.add(hemi, sun);

    // Voxels: one instanced cube per occupied cell. Matrices are written
    // straight into the instance buffer (only the translation changes).
    const geometry = new THREE.BoxGeometry(VOXEL_M, VOXEL_M, VOXEL_M);
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_VOXELS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const matrices = mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < MAX_VOXELS; i++) {
      matrices[i * 16] = 1; matrices[i * 16 + 5] = 1; matrices[i * 16 + 10] = 1; matrices[i * 16 + 15] = 1;
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_VOXELS * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);

    const grid = new THREE.GridHelper(60, 120, 0x4a3a3a, 0x2e2525);
    grid.rotation.x = Math.PI / 2;
    grid.visible = false;
    scene.add(grid);

    // Robot marker (points along its heading) and travelled path.
    const robot = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.5, 16),
      new THREE.MeshLambertMaterial({ color: 0xe83d3d, emissive: 0x401010 }),
    );
    robot.visible = false;
    scene.add(robot);

    const pathGeometry = new THREE.BufferGeometry();
    const pathLine = new THREE.Line(pathGeometry, new THREE.LineBasicMaterial({ color: 0xffd02e }));
    pathLine.frustumCulled = false;
    scene.add(pathLine);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;

    const map: MapState = { voxels: new Map(), pose: null, path: [], dirty: false, userMoved: false };
    let frameRequest = 0;

    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    // Once the operator orbits/zooms, stop auto-following the robot.
    controls.addEventListener('start', () => { map.userMoved = true; });

    const color = new THREE.Color();

    const rebuild = () => {
      frameRequest = 0;
      if (!map.dirty) return;
      map.dirty = false;

      const count = map.voxels.size;
      let minZ = Infinity, maxZ = -Infinity;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const v of map.voxels.values()) {
        if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
        if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
      }
      const zSpan = Math.max(maxZ - minZ, 0.001);
      const colors = mesh.instanceColor!.array as Float32Array;
      let i = 0;
      for (const v of map.voxels.values()) {
        const m = i * 16;
        matrices[m + 12] = v[0]; matrices[m + 13] = v[1]; matrices[m + 14] = v[2];
        if (v[6]) color.setRGB(v[3] / 255, v[4] / 255, v[5] / 255, THREE.SRGBColorSpace);
        else heightColor((v[2] - minZ) / zSpan, color);
        colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
        i++;
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;

      const floorZ = count ? minZ : 0;
      grid.visible = count > 0;
      grid.position.z = floorZ - VOXEL_M / 2;

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
        const vox = map.voxels;
        if (mode === 'keyframe') {
          vox.clear();
          if (Array.isArray(path)) map.path = path.map((p) => [Number(p[0]), Number(p[1])] as [number, number]);
        }
        const inv = 1 / VOXEL_M;
        const n = Math.floor(points.length / 3);
        const hasRgba = !!colors && colors.length >= n * 4;
        for (let i = 0; i < n; i++) {
          const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
          const ix = Math.round(x * inv), iy = Math.round(y * inv), iz = Math.round(z * inv);
          const key = ((ix + KEY_OFFSET) * KEY_SPAN + (iy + KEY_OFFSET)) * KEY_SPAN + (iz + KEY_OFFSET);
          let r = 0, g = 0, b = 0, has = 0;
          if (hasRgba && colors![i * 4 + 3] !== 0) {
            r = colors![i * 4]; g = colors![i * 4 + 1]; b = colors![i * 4 + 2]; has = 1;
          }
          const existing = vox.get(key);
          if (existing) {
            vox.delete(key); // re-insert: Map order doubles as recency (oldest first)
            if (!has && existing[6]) { r = existing[3]; g = existing[4]; b = existing[5]; has = 1; }
          }
          // Snap to the cell centre so neighbouring cubes form flush surfaces.
          vox.set(key, [ix * VOXEL_M, iy * VOXEL_M, iz * VOXEL_M, r, g, b, has]);
        }
        // Over budget: forget the cells not seen for the longest time.
        while (vox.size > MAX_VOXELS) vox.delete(vox.keys().next().value!);

        if (pose && Number.isFinite(pose.x) && Number.isFinite(pose.y)) {
          map.pose = { x: pose.x, y: pose.y, yaw: Number.isFinite(pose.yaw) ? pose.yaw : 0 };
          if (mode !== 'keyframe') {
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
        map.voxels.clear();
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
      geometry.dispose();
      material.dispose();
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
