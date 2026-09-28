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

export function formatMissionTime(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
