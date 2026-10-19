import React, { useEffect, useRef } from 'react';
import type { LidarPose, LidarSink, LidarSinkFrame } from './LidarReconstruction';

// Web-only live LiDAR floor plan: a top-down occupancy grid drawn as wall
// outlines (lines where there's an object, open space where there isn't),
// not a camera angle on the same 3D point cloud — that reads as "just a
// photo of accumulating points" and is harder to parse at a glance than an
// actual walk/don't-walk map. Plain 2D canvas, no Three.js/WebGL needed.
//
// Same LidarSink/LidarSinkFrame contract as LidarReconstruction so both can
// be fed from the same onLidar handler independently — each keeps its own
// accumulated state, so toggling between the two views never resets either.

const CELL_M = 0.15; // coarser than the 3D voxel size: a map reads better as blocky wall segments
const KEY_OFFSET = 1 << 15;
const KEY_SPAN = 1 << 16;
const BG = '#1c1818';
const WALL = '#efe4de';
const PATH_COLOR = '#ffd02e';
const ROBOT_COLOR = '#e83d3d';
const MIN_SPAN_M = 3;
const MAX_SPAN_M = 120;

const cellKey = (ix: number, iy: number) => (ix + KEY_OFFSET) * KEY_SPAN + (iy + KEY_OFFSET);
const NEIGHBOURS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

interface GridState {
  occupied: Set<number>;
  pose: LidarPose | null;
  path: [number, number][];
  dirty: boolean;
  userMoved: boolean;
}

export default function LidarFloorPlan({ sinkRef, cellSize = CELL_M }: {
  sinkRef: React.MutableRefObject<LidarSink | null>;
  /** Grid cell size in metres. Coarser than the 3D voxel size on purpose. */
  cellSize?: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const grid: GridState = { occupied: new Set(), pose: null, path: [], dirty: false, userMoved: false };
    let frameRequest = 0;
    let cssW = 0, cssH = 0, dpr = 1;
    // View transform: `scale` px per metre, (originX, originY) is the world
    // point drawn at the canvas centre.
    let scale = 20;
    let originX = 0, originY = 0;

    const worldToScreen = (x: number, y: number): [number, number] => [
      cssW / 2 + (x - originX) * scale,
      cssH / 2 - (y - originY) * scale,
    ];

    const draw = () => {
      frameRequest = 0;
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, cssW, cssH);

      if (!grid.occupied.size) {
        ctx.fillStyle = 'rgba(248,227,227,0.4)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Esperando datos del LiDAR…', cssW / 2, cssH / 2);
        return;
      }

      if (!grid.userMoved) autoFit();

      const half = cellSize / 2;
      ctx.strokeStyle = WALL;
      ctx.lineWidth = Math.max(1.5, scale * cellSize * 0.9);
      ctx.lineCap = 'square';
      ctx.beginPath();
      for (const key of grid.occupied) {
        const ix = Math.floor(key / KEY_SPAN) - KEY_OFFSET;
        const iy = (key - (ix + KEY_OFFSET) * KEY_SPAN) - KEY_OFFSET;
        const cx = ix * cellSize, cy = iy * cellSize;
        for (const [dx, dy] of NEIGHBOURS) {
          if (grid.occupied.has(cellKey(ix + dx, iy + dy))) continue; // shared wall: only draw the outer face
          const ex = dx !== 0 ? cx + dx * half : cx;
          const ey = dy !== 0 ? cy + dy * half : cy;
          const [ax, ay] = dx !== 0
            ? worldToScreen(ex, ey - half)
            : worldToScreen(ex - half, ey);
          const [bx, by] = dx !== 0
            ? worldToScreen(ex, ey + half)
            : worldToScreen(ex + half, ey);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
      }
      ctx.stroke();

      if (grid.path.length > 1) {
        ctx.strokeStyle = PATH_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        grid.path.forEach(([px, py], i) => {
          const [sx, sy] = worldToScreen(px, py);
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
      }

      if (grid.pose) {
        const [sx, sy] = worldToScreen(grid.pose.x, grid.pose.y);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(-grid.pose.yaw + Math.PI / 2);
        ctx.fillStyle = ROBOT_COLOR;
        ctx.beginPath();
        ctx.moveTo(0, -11);
        ctx.lineTo(7, 8);
        ctx.lineTo(-7, 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    };

    const scheduleDraw = () => {
      grid.dirty = true;
      if (!frameRequest) frameRequest = requestAnimationFrame(draw);
    };

    // Follow the robot (or the map centre) at a span that fits what's mapped.
    const autoFit = () => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const key of grid.occupied) {
        const ix = Math.floor(key / KEY_SPAN) - KEY_OFFSET;
        const iy = (key - (ix + KEY_OFFSET) * KEY_SPAN) - KEY_OFFSET;
        const x = ix * cellSize, y = iy * cellSize;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      const target = grid.pose ? [grid.pose.x, grid.pose.y] : [(minX + maxX) / 2, (minY + maxY) / 2];
      originX = target[0];
      originY = target[1];
      const span = Math.min(Math.max(Math.max(maxX - minX, maxY - minY) * 1.3, MIN_SPAN_M), MAX_SPAN_M);
      scale = Math.min(cssW, cssH) / span;
    };

    sinkRef.current = {
      addFrame({ points, mode, pose, path }: LidarSinkFrame) {
        const keyframe = mode === 'keyframe';
        if (keyframe) {
          grid.occupied.clear();
          if (Array.isArray(path)) grid.path = path.map((p) => [Number(p[0]), Number(p[1])] as [number, number]);
        }
        const inv = 1 / cellSize;
        const n = Math.floor(points.length / 3);
        for (let i = 0; i < n; i++) {
          const x = points[i * 3], y = points[i * 3 + 1];
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          grid.occupied.add(cellKey(Math.round(x * inv), Math.round(y * inv)));
        }
        if (pose && Number.isFinite(pose.x) && Number.isFinite(pose.y)) {
          grid.pose = { x: pose.x, y: pose.y, yaw: Number.isFinite(pose.yaw) ? pose.yaw : 0 };
          if (!keyframe) {
            const last = grid.path[grid.path.length - 1];
            if (!last || Math.hypot(grid.pose.x - last[0], grid.pose.y - last[1]) >= 0.05) {
              grid.path.push([grid.pose.x, grid.pose.y]);
              if (grid.path.length > 4000) grid.path.shift();
            }
          }
        }
        scheduleDraw();
      },
      clear() {
        grid.occupied.clear();
        grid.path = [];
        grid.pose = null;
        grid.userMoved = false;
        scheduleDraw();
      },
    };

    const resize = () => {
      cssW = host.clientWidth;
      cssH = host.clientHeight;
      if (!cssW || !cssH) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      scheduleDraw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    // Pan (drag) and zoom (wheel): once used, auto-follow stops until clear().
    let dragging = false, lastX = 0, lastY = 0;
    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      originX -= (e.clientX - lastX) / scale;
      originY += (e.clientY - lastY) / scale;
      lastX = e.clientX; lastY = e.clientY;
      grid.userMoved = true;
      scheduleDraw();
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.001);
      scale = Math.min(Math.max(scale * factor, 2), 400);
      grid.userMoved = true;
      scheduleDraw();
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      sinkRef.current = null;
      if (frameRequest) cancelAnimationFrame(frameRequest);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.remove();
    };
  }, [sinkRef, cellSize]);

  return React.createElement('div', {
    ref: hostRef,
    style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, touchAction: 'none' },
  });
}
