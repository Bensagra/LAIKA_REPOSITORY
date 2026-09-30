import { inflate } from 'pako';
import { activateDogControl, DOG_API_URL, DOG_ROBOT_ID, DOG_TOKEN, sendDogCommandWithId, warnIfMixedContent } from './api';

export type VideoFrameCallback = (dataUri: string, encodedAtMs?: number) => void;
export type VideoTickCallback = (encodedAtMs?: number) => void;
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
// Server-side SenXor thermal frames (see the "Cámara térmica en vivo" contract):
// JPEG heat map with boxes already drawn, plus temperatures/detection in the header.
export type ThermalFrameMeta = {
  seq?: number;
  ts?: number;
  width?: number;
  height?: number;
  source_width?: number;
  source_height?: number;
  temperature?: { min_c?: number; max_c?: number; center_c?: number };
  detection?: {
    person_present?: boolean;
    regions?: { x: number; y: number; width: number; height: number; area?: number; max_c?: number }[];
  };
};
export type ThermalCallback = (meta: ThermalFrameMeta) => void;

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
let cbThermal: ThermalCallback | null = null;

// Confirmed commands (linterna/antichoque): resolved from the command_ack
// that arrives on this same /ws/live connection, matched by command_id.
type PendingAck = {
  resolve: (result: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
const pendingAcks = new Map<string, PendingAck>();
let commandSeq = 0;

function generateCommandId(): string {
  commandSeq += 1;
  return `web-${Date.now()}-${commandSeq}`;
}

/** Sends a command and waits for its command_ack (status executed/error/rejected) on /ws/live. Resolves with ack.result. */
export function sendConfirmedCommand(
  type: string,
  payload: Record<string, unknown>,
  timeoutMs = 8000,
  ttlMs = 3000
): Promise<Record<string, unknown>> {
  const commandId = generateCommandId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingAcks.delete(commandId);
      reject(new Error('Tiempo de espera agotado esperando confirmación del robot'));
    }, timeoutMs);
    pendingAcks.set(commandId, { resolve, reject, timer });
    sendDogCommandWithId(type, payload, commandId, ttlMs).catch((err) => {
      if (!pendingAcks.has(commandId)) return;
      pendingAcks.delete(commandId);
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error('No se pudo enviar el comando'));
    });
  });
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunk = 8192;
  let str = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    str += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(str);
}

const videoCanvases = new Set<HTMLCanvasElement>();
const thermalCanvases = new Set<HTMLCanvasElement>();

export function registerVideoCanvas(canvas: HTMLCanvasElement): () => void {
  videoCanvases.add(canvas);
  return () => { videoCanvases.delete(canvas); };
}

export function registerThermalCanvas(canvas: HTMLCanvasElement): () => void {
  thermalCanvases.add(canvas);
  return () => { thermalCanvases.delete(canvas); };
}

export function webCodecsAvailable(): boolean {
  const g = globalThis as any;
  return typeof g.VideoDecoder === 'function' && typeof g.EncodedVideoChunk === 'function';
}

function drawToCanvases(source: CanvasImageSource, w: number, h: number, canvases: Set<HTMLCanvasElement> = videoCanvases): void {
  canvases.forEach((canvas) => {
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
  // encoded_ts (ms) of each frame submitted to the decoder, FIFO-matched to
  // its decoded output so captureCanvas can reject stale frames (>3s old).
  pendingTimestamps: [] as number[],
};

function resetVideoDecoder(): void {
  if (videoDecoder.decoder) {
    try { videoDecoder.decoder.close(); } catch { }
  }
  videoDecoder.decoder = null;
  videoDecoder.configured = false;
  videoDecoder.codec = '';
  videoDecoder.needKeyframe = true;
  videoDecoder.frameCount = 0;
  videoDecoder.pendingTimestamps = [];
}

function handleDecodedVideoFrame(frame: any): void {
  const encodedAtMs = videoDecoder.pendingTimestamps.shift();
  try {
    const w = frame.displayWidth || frame.codedWidth;
    const h = frame.displayHeight || frame.codedHeight;
    drawToCanvases(frame, w, h);
    cbVideoTick?.(encodedAtMs);
  } catch {} finally {
    frame.close();
  }
}

function ensureVideoDecoder(codec: string): boolean {
  const vd = videoDecoder;
  if (vd.decoder && vd.configured && vd.codec === codec) return true;
  if (vd.decoder) {
    try { vd.decoder.close(); } catch {}
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

function decodeH264(header: Record<string, unknown>, bytes: Uint8Array, encodedAtMs?: number): void {
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
    vd.pendingTimestamps.push(encodedAtMs ?? Date.now());
  } catch {
    resetVideoDecoder();
  }
}

// One-frame queue per image stream: while a frame decodes, only the newest
// incoming frame is kept, so latency never builds up and nothing stale is drawn.
interface ImageJob { bytes: Uint8Array; mime: string; onDrawn?: () => void }
interface ImageQueue { canvases: Set<HTMLCanvasElement>; busy: boolean; pending: ImageJob | null; gen: number }

const videoQueue: ImageQueue = { canvases: videoCanvases, busy: false, pending: null, gen: 0 };
const thermalQueue: ImageQueue = { canvases: thermalCanvases, busy: false, pending: null, gen: 0 };

function runImageJob(queue: ImageQueue, job: ImageJob): void {
  queue.busy = true;
  const gen = queue.gen;
  createImageBitmap(new Blob([job.bytes as BlobPart], { type: job.mime }))
    .then((bmp) => {
      if (gen === queue.gen) {
        drawToCanvases(bmp, bmp.width, bmp.height, queue.canvases);
        job.onDrawn?.();
      }
      if (typeof bmp.close === 'function') bmp.close();
    })
    .catch(() => {})
    .finally(() => {
      queue.busy = false;
      const next = queue.pending;
      queue.pending = null;
      if (next && gen === queue.gen) runImageJob(queue, next);
    });
}

/** Returns false when there is no canvas to draw into (e.g. native). */
function enqueueImage(queue: ImageQueue, bytes: Uint8Array, mime: string, onDrawn?: () => void): boolean {
  if (queue.canvases.size === 0 || typeof createImageBitmap !== 'function') return false;
  const job = { bytes: bytes.slice(0), mime, onDrawn };
  if (queue.busy) queue.pending = job;
  else runImageJob(queue, job);
  return true;
}

// Drop queued frames on disconnect so nothing from the old session is drawn.
function invalidateImageQueues(): void {
  for (const queue of [videoQueue, thermalQueue]) {
    queue.gen++;
    queue.pending = null;
  }
}

function mimeFor(format: unknown): string {
  const fmt = String(format ?? '');
  return fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg';
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
      cbLidar?.(points, count || Math.floor(points.length / 3), {
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
  } catch {}
}

// header.encoded_ts / header.ts are Unix seconds from the edge; propagated via
// onVideoTick so mision.tsx can reject stale captures (foto button, >3s old).
function frameTimestampMs(header: Record<string, unknown>): number | undefined {
  const raw = header.encoded_ts ?? header.ts;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n * 1000 : undefined;
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

  if (header.robot_id && String(header.robot_id) !== DOG_ROBOT_ID) return;

  const stream = String(header.stream ?? '');
  const payload = new Uint8Array(buffer, 6 + headerLen);
  cbNetBytes?.(stream, buffer.byteLength);

  if (stream === 'video') {
    const encodedAtMs = frameTimestampMs(header);
    if (String(header.image_format ?? '') === 'h264') {
      decodeH264(header, payload, encodedAtMs);
      return;
    }
    const mime = mimeFor(header.image_format);
    // Web: frames go straight to the canvas; skip the costly base64 encode.
    if (enqueueImage(videoQueue, payload, mime, () => cbVideoTick?.(encodedAtMs))) return;
    cbVideo?.(`data:${mime};base64,${uint8ToBase64(payload)}`, encodedAtMs);
    return;
  }

  if (stream === 'thermal') {
    // Metadata is reported together with its decoded frame.
    const meta = header as ThermalFrameMeta;
    if (!enqueueImage(thermalQueue, payload, mimeFor(header.image_format), () => cbThermal?.(meta))) {
      cbThermal?.(meta);
    }
    return;
  }

  if (stream === 'lidar') {
    parseLidar(header, payload, buffer.byteLength);
  }
}

function handleMessage(data: unknown): void {
  if (data instanceof ArrayBuffer) {
    parseFrame(data);
    return;
  }
  if (typeof data === 'string') {
 
    if (data.startsWith('{') || data.startsWith('[')) {
      try {
        const msg = JSON.parse(data);
        handleJsonMessage(msg);
      } catch {}
      return;
    }
    try {
      const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      parseFrame(bin.buffer);
    } catch { }
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
    const data = (msg.data ?? {}) as Record<string, unknown>;
    cbCommandAck?.(data);
    cbEvent?.(type, msg.data ?? msg);
    const commandId = data.command_id ? String(data.command_id) : '';
    const status = String(data.status ?? '');
    const pending = commandId ? pendingAcks.get(commandId) : undefined;
    if (pending && (status === 'executed' || status === 'error' || status === 'rejected')) {
      pendingAcks.delete(commandId);
      clearTimeout(pending.timer);
      if (status === 'executed') {
        pending.resolve((data.result ?? {}) as Record<string, unknown>);
      } else {
        pending.reject(new Error(String(data.reason ?? data.error ?? 'El robot rechazó el comando')));
      }
    }
    return;
  }

  if (type === 'event' || type === 'prediction' || type === 'command_out' || type === 'speed_profile_status') {
    cbEvent?.(type, msg.data ?? msg);
  }
}

function buildWsUrl(): string {
  const base = DOG_API_URL.replace(/^http/, 'ws');
  const url = `${base}/ws/live?token=${encodeURIComponent(DOG_TOKEN)}`;
  warnIfMixedContent(url);
  return url;
}

function doConnect(gen: number): void {
  if (gen !== currentGen) return;
  // Claim control before opening the socket (as benyi2.html does), so the
  // server treats this connection as the operator and accepts drive ops.
  activateDogControl()
    .catch(() => {})
    .finally(() => openSocket(gen));
}

function openSocket(gen: number): void {
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
      try { handleMessage(event.data); } catch { }
    };

    socket.onclose = () => {
      invalidateImageQueues();
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
  onThermal?: ThermalCallback;
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
  cbThermal = opts.onThermal ?? null;

  doConnect(gen);

  return () => {
    currentGen++;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws?.close();
    ws = null;
    resetVideoDecoder();
    invalidateImageQueues();
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
    cbThermal = null;
  };
}

export function sendRobotWsMessage(message: Record<string, unknown>): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 64 * 1024) return false;
  ws.send(JSON.stringify(message));
  return true;
}

// The robot server orders drive messages by `sequence` and drops ones that
// lack it; mirrors the reference console (benyi2.html).
let driveSequence = 0;

export function sendRobotDrive(linearX: number, lateralY: number, angularZ: number, durationMs = 320): boolean {
  return sendRobotWsMessage({
    op: 'drive',
    robot_id: DOG_ROBOT_ID,
    sequence: ++driveSequence,
    payload: {
      linear_x: linearX,
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
    sequence: ++driveSequence,
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
