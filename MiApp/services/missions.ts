import { DOG_API_URL, DOG_ROBOT_ID } from './api';
import { decodeFloatPayload, fetchDogJson } from './operator';

// Server-recorded missions (camera + thermal video, LiDAR map), per
// "Misiones: instalación, API e integración con otro frontend".

export type MissionStatus = 'recording' | 'finalizing' | 'completed' | 'error' | 'interrupted';

export interface MissionStreamStats {
  frames: number;
  first_at_s: number | null;
  last_at_s: number | null;
}

export interface ServerMission {
  mission_id: string;
  robot_id: string;
  name: string;
  started_by?: string;
  started_at: number;
  ended_at?: number | null;
  status: MissionStatus;
  error?: string;
  duration_s: number;
  streams?: Partial<Record<'camera' | 'thermal' | 'lidar', MissionStreamStats>>;
  lidar_points?: number;
  voxel_size_m?: number;
  skipped_camera_packets?: number;
  artifacts: string[];
  missing_streams?: string[];
}

export interface MissionVideoTrack {
  path: string;
  offset_s: number;
  last_at_s: number;
}

export interface MissionPlayback {
  mission: ServerMission;
  videos: Partial<Record<'camera' | 'thermal', MissionVideoTrack>>;
  expires_in_s: number;
  map_path: string | null;
}

// Finalizing and building the ZIP can take a while (doc suggests ~120 s).
const LONG_TIMEOUT_MS = 120000;

const robotPath = () => `/api/robots/${encodeURIComponent(DOG_ROBOT_ID)}/missions`;
const missionPath = (id: string) => `/api/missions/${encodeURIComponent(id)}`;

/** Paths returned by the server are app-relative; concatenate, never new URL(). */
export const missionFileUrl = (path: string) => DOG_API_URL + path;

/** Playback/download are refused (409) while the mission is still being written. */
export const missionIsReady = (m: ServerMission) => m.status !== 'recording' && m.status !== 'finalizing';

export async function listServerMissions(limit = 200): Promise<ServerMission[]> {
  const data = await fetchDogJson<{ missions?: ServerMission[] }>(`${robotPath()}?limit=${limit}`);
  return data.missions ?? [];
}

export function getServerMission(id: string): Promise<ServerMission> {
  return fetchDogJson<ServerMission>(missionPath(id));
}

export function startServerMission(name: string): Promise<ServerMission> {
  return fetchDogJson<ServerMission>(robotPath(), { method: 'POST', body: JSON.stringify({ name }) });
}

export function stopServerMission(id: string): Promise<ServerMission> {
  return fetchDogJson<ServerMission>(`${missionPath(id)}/stop`, { method: 'POST' }, LONG_TIMEOUT_MS);
}

export function openMissionPlayback(id: string): Promise<MissionPlayback> {
  return fetchDogJson<MissionPlayback>(`${missionPath(id)}/playback`, { method: 'POST' });
}

/** Accumulated mission map (XYZ only; the map endpoint carries no colours). */
export async function loadMissionMap(mapPath: string): Promise<Float32Array> {
  const map = await fetchDogJson<{ points_base64?: string; point_format?: string; point_count?: number }>(
    mapPath, {}, LONG_TIMEOUT_MS,
  );
  return decodeFloatPayload(map.points_base64, map.point_format, 3, map.point_count ?? 0);
}

/** Returns a 10-minute ticket URL for one file (mission.zip is built on request). */
export async function requestMissionDownload(id: string, filename: string): Promise<string> {
  const data = await fetchDogJson<{ path: string; expires_in_s: number }>(
    `${missionPath(id)}/download/${encodeURIComponent(filename)}`, { method: 'POST' }, LONG_TIMEOUT_MS,
  );
  return missionFileUrl(data.path);
}

export type MissionMediaKind = 'photo' | 'video' | 'audio';

export interface UploadedMissionMedia {
  filename: string;
  kind: MissionMediaKind;
  size_bytes?: number;
  mission_time_s?: number;
}

/**
 * Saves a photo, video clip or voice recording taken during the mission into
 * that mission on the server (POST /api/missions/{id}/media, multipart).
 * The filename prefix (foto-/video-/audio-) is what the gallery sorts by.
 */
export function uploadMissionMedia(
  id: string,
  kind: MissionMediaKind,
  file: Blob,
  info: { filename: string; capturedAtMs: number; durationMs?: number; source?: string },
): Promise<UploadedMissionMedia> {
  const form = new FormData();
  form.append('kind', kind);
  form.append('captured_at', String(info.capturedAtMs / 1000));
  if (info.durationMs != null) form.append('duration_s', String(info.durationMs / 1000));
  if (info.source) form.append('source', info.source);
  form.append('file', file, info.filename);
  return fetchDogJson<UploadedMissionMedia>(`${missionPath(id)}/media`, { method: 'POST', body: form }, LONG_TIMEOUT_MS);
}

// Descriptions from the "Qué queda guardado" table.
export const MISSION_FILE_LABELS: Record<string, string> = {
  'camera.mp4': 'Video de la cámara (H.264)',
  'thermal.mp4': 'Video térmico con detecciones',
  'thermal_detections.jsonl': 'Detecciones térmicas por cuadro',
  'frames.jsonl': 'Índice temporal de cuadros',
  'lidar_map.npz': 'Mapa LiDAR (NumPy: points + colors)',
  'lidar_map.ply': 'Mapa LiDAR con color (PLY, herramientas 3D)',
  'mission.json': 'Datos de la misión',
  'mission.zip': 'Todo junto (ZIP)',
};

export const MISSION_STATUS_LABELS: Record<MissionStatus, string> = {
  recording: 'GRABANDO',
  finalizing: 'FINALIZANDO',
  completed: 'COMPLETA',
  error: 'CON ERROR',
  interrupted: 'INTERRUMPIDA',
};

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm)$/i;

// Voice recordings come as .webm/.ogg too, so the "audio-" prefix decides first.
const isAudio = (a: string) => /(^|\/)audio-/i.test(a) || AUDIO_EXT.test(a);

export const missionPhotoArtifacts = (m: ServerMission) => (m.artifacts ?? []).filter((a) => IMAGE_EXT.test(a));
export const missionAudioArtifacts = (m: ServerMission) => (m.artifacts ?? []).filter(isAudio);
export const missionVideoArtifacts = (m: ServerMission) => (m.artifacts ?? []).filter((a) => VIDEO_EXT.test(a) && !isAudio(a));

// There is no event-log endpoint yet: this is built only from real,
// already-available fields (never invented data like "persona detectada").
export interface MissionEvent {
  offsetS: number;
  label: string;
}
const STREAM_LABEL: Record<string, string> = { camera: 'Cámara', thermal: 'Térmica', lidar: 'LiDAR' };
export function buildMissionTimeline(m: ServerMission): MissionEvent[] {
  const events: MissionEvent[] = [{ offsetS: 0, label: 'Inicio de misión' }];
  Object.entries(m.streams ?? {}).forEach(([key, stat]) => {
    if (stat?.first_at_s != null) {
      events.push({ offsetS: stat.first_at_s, label: `${STREAM_LABEL[key] ?? key}: primer cuadro` });
    }
  });
  if (missionIsReady(m)) {
    events.push({
      offsetS: m.duration_s,
      label: m.status === 'error' || m.status === 'interrupted'
        ? `Misión interrumpida${m.error ? ' — ' + m.error : ''}`
        : 'Fin de misión',
    });
  }
  return events.sort((a, b) => a.offsetS - b.offsetS);
}

export function formatMissionTime(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
