import { inflate } from 'pako';
import { DOG_API_URL, DOG_ROBOT_ID, DOG_TOKEN } from './api';

export type VideoFrameCallback = (dataUri: string) => void;
export type VideoTickCallback = () => void;
export type TelemetryCallback = (data: Record<string, unknown>) => void;
export type StatusCallback = (connected: boolean) => void;
export type LidarFrameMeta = {
  header: Record<string, unknown>;
  colors: Uint8Array | null;
  receivedAt: number;
  byteLength: number;
};
export type LidarCallback = (points: Float32Array, count: number, meta?: LidarFrameMeta) => void;
export type OnOpenCallback = () => void;
export type RobotEventCallback = (type: string, data: unknown) => void;
export type AutonomyCallback = (message: Record<string, any>) => void;
export type MeshReadyCallback = (data: Record<string, unknown>) => void;
export type CommandAckCallback = (data: Record<string, unknown>) => void;
export type AudioCallback = (data: Record<string, unknown>) => void;
export type NetBytesCallback = (stream: string, bytes: number) => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentGen = 0;

let cbVideo: VideoFrameCallback | null = null;
let cbVideoTick: VideoTickCallback | null = null;
let cbTelemetry: TelemetryCallback | null = null;
let cbStatus: StatusCallback | null = null;
let cbLidar: LidarCallback | null = null;
let cbOpen: OnOpenCallback | null = null;
let cbEvent: RobotEventCallback | null = null;
let cbAutonomy: AutonomyCallback | null = null;
let cbMeshReady: MeshReadyCallback | null = null;
let cbCommandAck: CommandAckCallback | null = null;
let cbAudio: AudioCallback | null = null;
let cbNetBytes: NetBytesCallback | null = null;

function uint8ToBase64(bytes: Uint8Array): string {
  const chunk = 8192;
  let str = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    str += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(str);
}

// ─── Video: canvas sinks + decodificación H.264 (WebCodecs) ──────────────────
// El edge transmite H.264 Annex-B (keyframe cada GOP + deltas). El navegador lo
// decodifica por hardware con VideoDecoder y lo pintamos en cada <canvas>
// registrado. webp/jpeg (fallback MJPEG) también se pinta en esos canvas.
const videoCanvases = new Set<HTMLCanvasElement>();

export function registerVideoCanvas(canvas: HTMLCanvasElement): () => void {
  videoCanvases.add(canvas);
  return () => { videoCanvases.delete(canvas); };
}

export function webCodecsAvailable(): boolean {
  const g = globalThis as any;
  return typeof g.VideoDecoder === 'function' && typeof g.EncodedVideoChunk === 'function';
}

function drawToCanvases(source: CanvasImageSource, w: number, h: number): void {
  videoCanvases.forEach((canvas) => {
    if (w && h && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true } as any) as CanvasRenderingContext2D | null;
    if (ctx) ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  });
}

const videoDecoder = {
  decoder: null as any,
  codec: '',
  configured: false,
  needKeyframe: true,
  frameCount: 0,
  unsupportedLogged: false,
};

function resetVideoDecoder(): void {
  if (videoDecoder.decoder) {
    try { videoDecoder.decoder.close(); } catch { /* ignore */ }
  }
  videoDecoder.decoder = null;
  videoDecoder.configured = false;
  videoDecoder.codec = '';
  videoDecoder.needKeyframe = true;
  videoDecoder.frameCount = 0;
}

function handleDecodedVideoFrame(frame: any): void {
  try {
    const w = frame.displayWidth || frame.codedWidth;
    const h = frame.displayHeight || frame.codedHeight;
    drawToCanvases(frame, w, h);
    cbVideoTick?.();
  } catch { /* ignore */ } finally {
    frame.close();
  }
}

function ensureVideoDecoder(codec: string): boolean {
  const vd = videoDecoder;
  if (vd.decoder && vd.configured && vd.codec === codec) return true;
  if (vd.decoder) {
    try { vd.decoder.close(); } catch { /* ignore */ }
  }
  const VideoDecoderCtor = (globalThis as any).VideoDecoder;
  vd.decoder = new VideoDecoderCtor({
    output: handleDecodedVideoFrame,
    error: () => resetVideoDecoder(),
  });
  try {
    vd.decoder.configure({ codec, optimizeForLatency: true });
  } catch {
    resetVideoDecoder();
    return false;
  }
  vd.codec = codec;
  vd.configured = true;
  vd.needKeyframe = true;
  vd.frameCount = 0;
  return true;
}

function decodeH264(header: Record<string, unknown>, bytes: Uint8Array): void {
  if (!webCodecsAvailable()) {
    if (!videoDecoder.unsupportedLogged) {
      videoDecoder.unsupportedLogged = true;
      cbEvent?.('video_unsupported', 'WebCodecs no disponible: usá Chrome/Edge para ver H.264');
    }
    return;
  }
  const codec = String((header.codec as string) || 'avc1.42e01e');
  if (!ensureVideoDecoder(codec)) return;

  const vd = videoDecoder;
  const isKey = !!header.key;
  if (vd.needKeyframe) {
    // No se puede arrancar (ni resincronizar) en un delta: esperá un keyframe.
    if (!isKey) return;
    vd.needKeyframe = false;
  }
  if (!bytes || !bytes.length) return;

  const fps = Math.max(1, Number(header.target_fps) || 30);
  const timestamp = Math.round((vd.frameCount++ * 1e6) / fps);
  const EncodedVideoChunkCtor = (globalThis as any).EncodedVideoChunk;
  try {
    vd.decoder.decode(new EncodedVideoChunkCtor({
      type: isKey ? 'key' : 'delta',
      timestamp,
      data: bytes,
    }));
  } catch {
    resetVideoDecoder();
  }
}

// webp/jpeg/png entregado como bytes crudos → pintar en los canvas (web).
function drawImageBytesToCanvases(bytes: Uint8Array, mime: string): void {
  if (videoCanvases.size === 0 || typeof createImageBitmap !== 'function') return;
  const copy = bytes.slice(0);
  createImageBitmap(new Blob([copy], { type: mime }))
    .then((bmp) => {
      drawToCanvases(bmp, bmp.width, bmp.height);
      cbVideoTick?.();
      if (typeof bmp.close === 'function') bmp.close();
    })
    .catch(() => { /* ignore bad frame */ });
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

function parseLidar(header: Record<string, unknown>, payload: Uint8Array, frameByteLength: number): void {
  try {
    const fmt = String(header.fmt ?? 'i16_xyz_zlib');
    const count = Number(header.count ?? 0);
    const scale = Number(header.scale ?? 0.001);
    const offset = (header.offset as number[]) ?? [0, 0, 0];
    const emit = (points: Float32Array, colors: Uint8Array | null = null) => {
      cbLidar?.(points, count, {
        header,
        colors,
        receivedAt: Date.now(),
        byteLength: frameByteLength,
      });
    };

    if (fmt === 'i16_xyz_zlib') {
      const raw = inflate(payload);
      const points = i16ToPoints(raw, count, scale, offset);
      emit(points);
    } else if (fmt === 'f32_xyz_zlib') {
      const raw = inflate(payload);
      const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      emit(new Float32Array(buf));
    } else if (fmt === 'i16_xyz_rgb_zlib') {
      if (payload.byteLength < 4) return;
      const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const geomLen = dv.getUint32(0, true);
      if (4 + geomLen > payload.byteLength) return;
      const raw = inflate(payload.subarray(4, 4 + geomLen));
      const colorPayload = payload.subarray(4 + geomLen);
      const colors = colorPayload.byteLength ? inflate(colorPayload) : null;
      const points = i16ToPoints(raw, count, scale, offset);
      emit(points, colors);
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
  cbNetBytes?.(stream, buffer.byteLength);

  if (stream === 'video') {
    const fmt = String(header.image_format ?? '');
    if (fmt === 'h264') {
      decodeH264(header, payload);
      return;
    }
    const mime = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg';
    // En web pintamos en el canvas; el data URI sólo lo necesita el <Image> de nativo.
    drawImageBytesToCanvases(payload, mime);
    cbVideo?.(`data:${mime};base64,${uint8ToBase64(payload)}`);
    return;
  }

  if (stream === 'lidar') {
    parseLidar(header, payload, buffer.byteLength);
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
        handleJsonMessage(msg);
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

function handleJsonMessage(msg: any): void {
  const type = String(msg?.type ?? '');
  const robotId = msg?.robot_id ? String(msg.robot_id) : '';
  if (robotId && robotId !== DOG_ROBOT_ID) return;

  if (type === 'telemetry' || msg?.telemetry) {
    cbTelemetry?.((msg.data ?? msg.telemetry ?? msg) as Record<string, unknown>);
    return;
  }

  if (type === 'autonomy') {
    cbAutonomy?.(msg as Record<string, any>);
    cbEvent?.('autonomy', msg.data ?? msg);
    return;
  }

  if (type === 'media') {
    const stream = String(msg.stream ?? '');
    if (stream === 'audio') {
      const payload = (msg.data ?? {}) as Record<string, unknown>;
      cbNetBytes?.('audio', JSON.stringify(payload).length);
      cbAudio?.(payload);
    }
    return;
  }

  if (type === 'mesh_ready') {
    cbMeshReady?.((msg.data ?? {}) as Record<string, unknown>);
    cbEvent?.('mesh_ready', msg.data ?? msg);
    return;
  }

  if (type === 'command_ack') {
    cbCommandAck?.((msg.data ?? {}) as Record<string, unknown>);
    cbEvent?.(type, msg.data ?? msg);
    return;
  }

  if (type === 'event' || type === 'prediction' || type === 'command_out' || type === 'speed_profile_status') {
    cbEvent?.(type, msg.data ?? msg);
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
      resetVideoDecoder();
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
  onVideoTick?: VideoTickCallback;
  onTelemetry?: TelemetryCallback;
  onStatus?: StatusCallback;
  onLidar?: LidarCallback;
  onOpen?: OnOpenCallback;
  onEvent?: RobotEventCallback;
  onAutonomy?: AutonomyCallback;
  onMeshReady?: MeshReadyCallback;
  onCommandAck?: CommandAckCallback;
  onAudio?: AudioCallback;
  onNetBytes?: NetBytesCallback;
}): () => void {
  const gen = ++currentGen;
  cbVideo = opts.onVideoFrame ?? null;
  cbVideoTick = opts.onVideoTick ?? null;
  cbTelemetry = opts.onTelemetry ?? null;
  cbStatus = opts.onStatus ?? null;
  cbLidar = opts.onLidar ?? null;
  cbOpen = opts.onOpen ?? null;
  cbEvent = opts.onEvent ?? null;
  cbAutonomy = opts.onAutonomy ?? null;
  cbMeshReady = opts.onMeshReady ?? null;
  cbCommandAck = opts.onCommandAck ?? null;
  cbAudio = opts.onAudio ?? null;
  cbNetBytes = opts.onNetBytes ?? null;

  doConnect(gen);

  return () => {
    currentGen++;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws?.close();
    ws = null;
    resetVideoDecoder();
    cbVideo = null;
    cbVideoTick = null;
    cbTelemetry = null;
    cbStatus = null;
    cbLidar = null;
    cbOpen = null;
    cbEvent = null;
    cbAutonomy = null;
    cbMeshReady = null;
    cbCommandAck = null;
    cbAudio = null;
    cbNetBytes = null;
  };
}

export function sendRobotWsMessage(message: Record<string, unknown>): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 64 * 1024) return false;
  ws.send(JSON.stringify(message));
  return true;
}

export function sendRobotDrive(linearX: number, lateralY: number, angularZ: number, durationMs = 320): boolean {
  return sendRobotWsMessage({
    op: 'drive',
    robot_id: DOG_ROBOT_ID,
    payload: {
      linear_x: linearX,
      linear_y: lateralY,
      lateral_y: lateralY,
      angular_z: angularZ,
      duration_ms: durationMs,
    },
  });
}

export function sendRobotDriveStop(): boolean {
  return sendRobotWsMessage({
    op: 'drive_stop',
    robot_id: DOG_ROBOT_ID,
  });
}

export function sendRobotHeartbeat(): boolean {
  return sendRobotWsMessage({
    op: 'heartbeat',
    robot_id: DOG_ROBOT_ID,
  });
}

export function requestRobotSpeedProfile(profile: 'normal' | 'max_api'): boolean {
  return sendRobotWsMessage({
    op: 'set_speed_profile',
    robot_id: DOG_ROBOT_ID,
    profile,
  });
}
