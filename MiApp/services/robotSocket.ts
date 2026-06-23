import { inflate } from 'pako';
import { DOG_API_URL, DOG_TOKEN } from './api';

export type VideoFrameCallback = (dataUri: string) => void;
export type TelemetryCallback = (data: Record<string, unknown>) => void;
export type StatusCallback = (connected: boolean) => void;
export type LidarCallback = (points: Float32Array, count: number) => void;
export type OnOpenCallback = () => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentGen = 0;

let cbVideo: VideoFrameCallback | null = null;
let cbTelemetry: TelemetryCallback | null = null;
let cbStatus: StatusCallback | null = null;
let cbLidar: LidarCallback | null = null;
let cbOpen: OnOpenCallback | null = null;

function uint8ToBase64(bytes: Uint8Array): string {
  const chunk = 8192;
  let str = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    str += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(str);
}

function i16ToPoints(raw: Uint8Array, count: number, scale: number, offset: number[]): Float32Array {
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const i16 = new Int16Array(buf);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3]     = i16[i * 3]     * scale + (offset[0] ?? 0);
    out[i * 3 + 1] = i16[i * 3 + 1] * scale + (offset[1] ?? 0);
    out[i * 3 + 2] = i16[i * 3 + 2] * scale + (offset[2] ?? 0);
  }
  return out;
}

function parseLidar(header: Record<string, unknown>, payload: Uint8Array): void {
  try {
    const fmt = String(header.fmt ?? 'i16_xyz_zlib');
    const count = Number(header.count ?? 0);
    const scale = Number(header.scale ?? 0.001);
    const offset = (header.offset as number[]) ?? [0, 0, 0];

    if (fmt === 'i16_xyz_zlib') {
      const raw = inflate(payload);
      const points = i16ToPoints(raw, count, scale, offset);
      cbLidar?.(points, count);
    } else if (fmt === 'f32_xyz_zlib') {
      const raw = inflate(payload);
      const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      cbLidar?.(new Float32Array(buf), count);
    } else if (fmt === 'i16_xyz_rgb_zlib') {
      if (payload.byteLength < 4) return;
      const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const geomLen = dv.getUint32(0, true);
      if (4 + geomLen > payload.byteLength) return;
      const raw = inflate(payload.subarray(4, 4 + geomLen));
      const points = i16ToPoints(raw, count, scale, offset);
      cbLidar?.(points, count);
    }
  } catch { /* ignore bad frames */ }
}

function parseFrame(buffer: ArrayBuffer): void {
  if (buffer.byteLength < 6) return;
  const view = new DataView(buffer);
  if (view.getUint8(0) !== 0xa7 || view.getUint8(1) !== 1) return;

  const headerLen = view.getUint32(2, true);
  if (6 + headerLen > buffer.byteLength) return;

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 6, headerLen)));
  } catch { return; }

  const stream = String(header.stream ?? '');
  const payload = new Uint8Array(buffer, 6 + headerLen);

  if (stream === 'video') {
    const fmt = String(header.image_format ?? '');
    if (fmt === 'h264') return;
    const mime = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg';
    cbVideo?.(`data:${mime};base64,${uint8ToBase64(payload)}`);
    return;
  }

  if (stream === 'lidar') {
    parseLidar(header, payload);
  }
}

// React Native may deliver binary as base64 string instead of ArrayBuffer
function handleMessage(data: unknown): void {
  if (data instanceof ArrayBuffer) {
    parseFrame(data);
    return;
  }
  if (typeof data === 'string') {
    // Try JSON telemetry first
    if (data.startsWith('{') || data.startsWith('[')) {
      try {
        const msg = JSON.parse(data);
        const tel = msg?.telemetry ?? (msg?.type === 'telemetry' ? msg : null);
        if (tel) cbTelemetry?.(tel as Record<string, unknown>);
      } catch { /* ignore */ }
      return;
    }
    // Try base64-encoded binary frame (React Native fallback)
    try {
      const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      parseFrame(bin.buffer);
    } catch { /* ignore */ }
  }
}

function buildWsUrl(): string {
  const base = DOG_API_URL.replace(/^http/, 'ws');
  return `${base}/ws/live?token=${encodeURIComponent(DOG_TOKEN)}`;
}

function doConnect(gen: number): void {
  if (gen !== currentGen) return;
  try {
    const socket = new WebSocket(buildWsUrl());
    socket.binaryType = 'arraybuffer';
    ws = socket;

    socket.onopen = () => {
      if (gen !== currentGen) return;
      cbStatus?.(true);
      cbOpen?.();
    };

    socket.onmessage = (event) => {
      if (gen !== currentGen) return;
      try { handleMessage(event.data); } catch { /* ignore */ }
    };

    socket.onclose = () => {
      cbStatus?.(false);
      if (gen === currentGen) {
        reconnectTimer = setTimeout(() => doConnect(gen), 3000);
      }
    };

    socket.onerror = () => { cbStatus?.(false); };
  } catch {
    cbStatus?.(false);
    if (gen === currentGen) {
      reconnectTimer = setTimeout(() => doConnect(gen), 3000);
    }
  }
}

export function connectRobotWS(opts: {
  onVideoFrame?: VideoFrameCallback;
  onTelemetry?: TelemetryCallback;
  onStatus?: StatusCallback;
  onLidar?: LidarCallback;
  onOpen?: OnOpenCallback;
}): () => void {
  const gen = ++currentGen;
  cbVideo = opts.onVideoFrame ?? null;
  cbTelemetry = opts.onTelemetry ?? null;
  cbStatus = opts.onStatus ?? null;
  cbLidar = opts.onLidar ?? null;
  cbOpen = opts.onOpen ?? null;

  doConnect(gen);

  return () => {
    currentGen++;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws?.close();
    ws = null;
    cbVideo = null;
    cbTelemetry = null;
    cbStatus = null;
    cbLidar = null;
    cbOpen = null;
  };
}
