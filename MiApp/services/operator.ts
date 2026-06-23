import { inflate } from 'pako';
import { DOG_API_URL, DOG_ROBOT_ID, DOG_TOKEN, sendDogCommand } from './api';

export const DEFAULT_SPEED_PROFILES = {
  normal: {
    forward: 3.5,
    reverse: 2.3,
    lateral: 0.92,
    angular: 3.68,
  },
  max_api: {
    forward: 3.8,
    reverse: 2.5,
    lateral: 1.0,
    angular: 4.0,
  },
} as const;

export type SpeedProfileKey = keyof typeof DEFAULT_SPEED_PROFILES;

export const NETWORK_PROFILES = {
  weak: {
    label: 'DÉBIL',
    cameraFps: 12,
    cameraFormat: 'webp',
    cameraBitrateKbps: 700,
    cameraQuality: 55,
    cameraMinQuality: 34,
    cameraWidth: 640,
    lidarHz: 0.7,
    lidarMaxPoints: 2500,
    lidarCompression: 6,
    lidarQuantizationCm: 2.0,
    uplinkMaxKbps: 2200,
  },
  balanced: {
    label: 'BALANCE',
    cameraFps: 18,
    cameraFormat: 'webp',
    cameraBitrateKbps: 1500,
    cameraQuality: 62,
    cameraMinQuality: 38,
    cameraWidth: 960,
    lidarHz: 2,
    lidarMaxPoints: 8000,
    lidarCompression: 5,
    lidarQuantizationCm: 1.0,
    uplinkMaxKbps: 5000,
  },
  quality: {
    label: 'CALIDAD',
    cameraFps: 24,
    cameraFormat: 'webp',
    cameraBitrateKbps: 4000,
    cameraQuality: 68,
    cameraMinQuality: 45,
    cameraWidth: 1280,
    lidarHz: 5,
    lidarMaxPoints: 30000,
    lidarCompression: 3,
    lidarQuantizationCm: 0.5,
    uplinkMaxKbps: 12000,
  },
} as const;

export type NetworkProfileKey = keyof typeof NETWORK_PROFILES;

export interface DogMediaSettings {
  video: boolean;
  lidar: boolean;
  audio: boolean;
  profile: NetworkProfileKey;
  cameraFps: number;
  cameraQuality: number;
  cameraWidth: number;
  cameraBitrateKbps: number;
  audioEmitEvery: number;
  audioMaxBytes: number;
}

export interface ColorCalibration {
  enabled: boolean;
  fovDeg: number;
  pitchDeg: number;
  heightM: number;
  forwardM: number;
}

export interface DogCapabilities {
  role?: string;
  limits?: Record<string, number>;
  telemetry?: Record<string, unknown>;
  active_speed_profile?: string;
  speed_profiles?: {
    normal?: Partial<typeof DEFAULT_SPEED_PROFILES.normal>;
    max_api?: Partial<typeof DEFAULT_SPEED_PROFILES.max_api>;
  };
}

export interface DogFace {
  person_id: string;
  label?: string;
  known?: boolean;
  captures?: number;
  quality?: number;
}

export interface DogMapMetadata {
  map_id: string;
  point_count?: number;
  path_point_count?: number;
  created_at?: number;
  updated_at?: number;
  is_latest?: boolean;
}

export interface LoadedDogMap {
  metadata: DogMapMetadata;
  points: Float32Array;
  path: Float32Array;
}

export interface DogMeshSummary {
  vertexCount: number;
  faceCount: number;
}

function robotPath(path: string, robotId = DOG_ROBOT_ID) {
  return path.replace(':robotId', encodeURIComponent(robotId));
}

function dogUrl(path: string) {
  return `${DOG_API_URL}${path}`;
}

function authHeaders(json = false) {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${DOG_TOKEN}`,
  };
}

async function fetchDog(path: string, options: RequestInit = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(dogUrl(path), {
      ...options,
      signal: controller.signal,
      headers: {
        ...authHeaders(typeof options.body === 'string'),
        ...(options.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DOG API ${res.status}: ${text || res.statusText}`);
    }
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDogJson<T>(path: string, options: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  const res = await fetchDog(path, options, timeoutMs);
  return res.json() as Promise<T>;
}

export async function getDogCapabilities(robotId = DOG_ROBOT_ID): Promise<DogCapabilities> {
  return fetchDogJson<DogCapabilities>(robotPath('/api/robots/:robotId/capabilities', robotId));
}

export async function configureDogMedia(settings: DogMediaSettings): Promise<void> {
  const profile = NETWORK_PROFILES[settings.profile] ?? NETWORK_PROFILES.weak;
  const cameraFps = clamp(Math.round(settings.cameraFps), 1, 40);
  const cameraQuality = clamp(Math.round(settings.cameraQuality), 25, 90);
  const cameraWidth = clamp(Math.round(settings.cameraWidth), 320, 1920);
  const bitrate = clamp(Math.round(settings.cameraBitrateKbps), 100, 12000);
  const audioEmitEvery = clamp(Math.round(settings.audioEmitEvery), 1, 10);
  const audioMaxBytes = clamp(Math.round(settings.audioMaxBytes), 0, 262144);

  await sendDogCommand('set_camera_stream', {
    enabled: settings.video,
    emit_every: 1,
    format: profile.cameraFormat,
    bitrate_kbps: bitrate,
    jpeg_quality: cameraQuality,
    min_quality: profile.cameraMinQuality,
    target_fps: cameraFps,
    max_width: cameraWidth,
    uplink_max_kbps: profile.uplinkMaxKbps,
  }, 2000);

  await sendDogCommand('set_lidar_decoder', { decoder: 'native' }, 2000);
  await sendDogCommand('set_lidar', {
    enabled: settings.lidar,
    subscribe: true,
    media_hz: profile.lidarHz,
    max_points: profile.lidarMaxPoints,
    compression_level: profile.lidarCompression,
    quantization_cm: profile.lidarQuantizationCm,
  }, 2000);

  await sendDogCommand('set_audio', {
    enabled: settings.audio,
    emit_every: audioEmitEvery,
    max_bytes: audioMaxBytes,
  }, 2000);
}

export async function applyDogColorCalibration(settings: ColorCalibration): Promise<void> {
  await sendDogCommand('set_color', {
    enabled: settings.enabled,
    fov_deg: settings.fovDeg,
    pitch_deg: settings.pitchDeg,
    height_m: settings.heightM,
    forward_m: settings.forwardM,
  }, 2000);
}

export async function setDogGreeter(enabled: boolean, robotId = DOG_ROBOT_ID): Promise<{ enabled: boolean; available?: boolean }> {
  return fetchDogJson(robotPath('/api/robots/:robotId/greeter', robotId), {
    method: 'POST',
    body: JSON.stringify({ action: enabled ? 'start' : 'stop' }),
  });
}

export async function testDogGreeting(): Promise<void> {
  await sendDogCommand('play_audio', { force: true }, 3000);
}

export async function dogAutonomyAction(action: 'start' | 'stop' | 'estop', robotId = DOG_ROBOT_ID): Promise<Record<string, unknown>> {
  return fetchDogJson(robotPath('/api/robots/:robotId/autonomy', robotId), {
    method: 'POST',
    body: JSON.stringify({ action }),
  }, 12000);
}

export async function listDogFaces(robotId = DOG_ROBOT_ID): Promise<DogFace[]> {
  const data = await fetchDogJson<{ people?: DogFace[] }>(robotPath('/api/robots/:robotId/faces', robotId));
  return data.people ?? [];
}

export function dogFaceImageUrl(personId: string, robotId = DOG_ROBOT_ID) {
  return dogUrl(robotPath(`/api/robots/:robotId/faces/${encodeURIComponent(personId)}/image`, robotId)) + `?t=${Date.now()}`;
}

export async function updateDogFace(personId: string, label: string, known: boolean, robotId = DOG_ROBOT_ID): Promise<void> {
  await fetchDog(robotPath(`/api/robots/:robotId/faces/${encodeURIComponent(personId)}`, robotId), {
    method: 'POST',
    body: JSON.stringify({ label, known }),
  });
}

export async function purgeDogFaces(robotId = DOG_ROBOT_ID): Promise<void> {
  await fetchDog(robotPath('/api/robots/:robotId/faces', robotId), { method: 'DELETE' });
}

export async function getPerceptionCapabilities(): Promise<Record<string, any>> {
  return fetchDogJson('/api/perception/capabilities');
}

export async function listDogMaps(robotId = DOG_ROBOT_ID): Promise<DogMapMetadata[]> {
  const data = await fetchDogJson<{ maps?: DogMapMetadata[] }>(`/api/maps?robot_id=${encodeURIComponent(robotId)}`);
  return data.maps ?? [];
}

export async function saveDogMapSnapshot(robotId = DOG_ROBOT_ID): Promise<DogMapMetadata> {
  const data = await fetchDogJson<{ map?: DogMapMetadata }>(robotPath('/api/robots/:robotId/maps/snapshot', robotId), {
    method: 'POST',
  }, 20000);
  return data.map ?? { map_id: 'snapshot' };
}

export async function loadDogMap(mapId: string, robotId = DOG_ROBOT_ID): Promise<LoadedDogMap> {
  const payload = await fetchDogJson<{
    metadata?: DogMapMetadata;
    points_base64?: string;
    point_format?: string;
    point_count?: number;
    path_base64?: string;
    path_format?: string;
    path_point_count?: number;
  }>(
    `/api/maps/${encodeURIComponent(robotId)}/${encodeURIComponent(mapId)}?compressed=true`,
    {},
    30000
  );

  return {
    metadata: payload.metadata ?? { map_id: mapId },
    points: decodeFloatPayload(payload.points_base64, payload.point_format, 3, payload.point_count ?? 0),
    path: decodeFloatPayload(payload.path_base64, payload.path_format, 2, payload.path_point_count ?? 0),
  };
}

export async function rebuildDogMesh(robotId = DOG_ROBOT_ID): Promise<Record<string, unknown>> {
  return fetchDogJson(robotPath('/api/meshes/:robotId/rebuild', robotId), { method: 'POST' }, 180000);
}

export async function getDogMeshSummary(robotId = DOG_ROBOT_ID): Promise<DogMeshSummary> {
  const res = await fetchDog(robotPath('/api/meshes/:robotId/latest', robotId), {}, 120000);
  const compressed = new Uint8Array(await res.arrayBuffer());
  const raw = inflate(compressed);
  if (raw.byteLength < 12 || raw[0] !== 77 || raw[1] !== 83 || raw[2] !== 72 || raw[3] !== 49) {
    throw new Error('modelo con formato inválido');
  }
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  return {
    vertexCount: dv.getUint32(4, true),
    faceCount: dv.getUint32(8, true),
  };
}

export function formatDogMapLabel(map: DogMapMetadata) {
  const points = Number(map.point_count || 0).toLocaleString();
  const timestamp = map.is_latest ? map.updated_at : map.created_at;
  const when = timestamp ? new Date(Number(timestamp) * 1000).toLocaleString('es-AR') : 'fecha desconocida';
  return map.is_latest ? `Mapa actual · ${points} pts` : `${when} · ${points} pts`;
}

function decodeFloatPayload(base64 = '', format = '', components: number, count: number) {
  let bytes: Uint8Array<ArrayBufferLike> = base64ToBytes(base64);
  if (String(format).endsWith('_zlib')) {
    bytes = inflate(bytes);
  }
  const expected = Number(count || 0) * components * 4;
  if (expected === 0) return new Float32Array();
  if (bytes.byteLength !== expected || bytes.byteLength % 4 !== 0) {
    throw new Error('El mapa tiene una longitud inválida');
  }
  const aligned = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(aligned);
}

function base64ToBytes(base64: string) {
  const clean = String(base64 || '');
  const decoder = globalThis.atob;
  if (typeof decoder !== 'function') {
    throw new Error('Base64 no disponible en este entorno');
  }
  const bin = decoder(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
