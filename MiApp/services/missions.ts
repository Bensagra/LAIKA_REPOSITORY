import { DOG_ROBOT_ID } from './api';
import { supabase } from './supabase';

// Mission storage lives directly in Supabase: `missions` + `mission_files`
// (Postgres, RLS scoped to owner_id = auth.uid()) for the metadata/timeline,
// `mission-media` Storage bucket (private, same RLS pattern via a storage
// policy keyed off the object path's <uid>/<mission_id>/ prefix) for the
// actual photo/video/audio bytes. No custom backend server involved — the
// app talks to Supabase the same way it already does for auth.
//
// Everything else robot-related (live status/video/commands) still goes
// straight to the robot's own server — see services/api.ts, operator.ts,
// robotSocket.ts. This file only ever touches Supabase.

export type MissionStatus = 'recording' | 'finalizing' | 'completed' | 'error' | 'interrupted';
export type MissionMediaKind = 'photo' | 'video' | 'audio' | 'other';

export interface ServerMission {
  mission_id: string;
  robot_id: string;
  name: string;
  started_by?: string;
  operator?: string | null;
  location?: string | null;
  started_at: number;
  ended_at?: number | null;
  status: MissionStatus;
  duration_s: number;
  notes: string;
  /** Filenames only — see listMissionFiles() for signed URLs/kind/size. */
  artifacts: string[];
}

export interface MissionFile {
  filename: string;
  kind: MissionMediaKind;
  /** Signed URL, valid for an hour — safe to use directly as an <Image>/<video> src. */
  url: string;
  mime_type?: string;
  size_bytes?: number;
  duration_ms?: number;
  captured_at: number | null;
}

export interface MissionEvent {
  offsetS: number;
  label: string;
}

export interface UploadedMissionMedia {
  filename: string;
  kind: MissionMediaKind;
  size_bytes?: number;
  mission_time_s?: number;
}

export const MISSION_STATUS_LABELS: Record<MissionStatus, string> = {
  recording: 'GRABANDO',
  finalizing: 'FINALIZANDO',
  completed: 'COMPLETA',
  error: 'CON ERROR',
  interrupted: 'INTERRUMPIDA',
};

/** Mission's own lifecycle hasn't finished yet. */
export const missionIsReady = (m: ServerMission) => m.status !== 'recording' && m.status !== 'finalizing';

export function formatMissionTime(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const BUCKET = 'mission-media';
const toUnixSeconds = (date: string | null | undefined): number | null =>
  date ? Math.floor(new Date(date).getTime() / 1000) : null;

interface MissionRow {
  id: string; owner_id: string; robot_id: string; name: string; status: string;
  operator: string | null; location: string | null;
  started_at: string; ended_at: string | null; duration_s: number; notes: string;
  mission_files?: { filename: string }[];
}

function toServerMission(row: MissionRow): ServerMission {
  return {
    mission_id: row.id,
    robot_id: row.robot_id,
    name: row.name,
    started_by: row.owner_id,
    operator: row.operator,
    location: row.location,
    started_at: toUnixSeconds(row.started_at) ?? 0,
    ended_at: toUnixSeconds(row.ended_at),
    status: row.status as MissionStatus,
    duration_s: row.duration_s,
    notes: row.notes ?? '',
    artifacts: (row.mission_files ?? []).map((f) => f.filename),
  };
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error('Necesitás iniciar sesión para guardar misiones.');
  return uid;
}

export async function startServerMission(
  name: string,
  extra?: { operator?: string; location?: string },
): Promise<ServerMission> {
  const ownerId = await currentUserId();
  const { data, error } = await supabase
    .from('missions')
    .insert({
      owner_id: ownerId,
      robot_id: DOG_ROBOT_ID,
      name,
      operator: extra?.operator ?? null,
      location: extra?.location ?? null,
      status: 'recording',
    })
    .select()
    .single();
  if (error) throw error;
  return toServerMission(data);
}

export async function listServerMissions(limit = 200): Promise<ServerMission[]> {
  const { data, error } = await supabase
    .from('missions')
    .select('*, mission_files(filename)')
    .eq('robot_id', DOG_ROBOT_ID)
    .eq('hidden', false)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(toServerMission);
}

export async function getServerMission(id: string): Promise<ServerMission> {
  const { data, error } = await supabase.from('missions').select('*, mission_files(filename)').eq('id', id).single();
  if (error) throw error;
  return toServerMission(data);
}

export async function stopServerMission(id: string): Promise<ServerMission> {
  const { data: existing, error: fetchErr } = await supabase.from('missions').select('started_at').eq('id', id).single();
  if (fetchErr) throw fetchErr;
  const durationS = Math.max(0, (Date.now() - new Date(existing.started_at).getTime()) / 1000);
  const { data, error } = await supabase
    .from('missions')
    .update({ status: 'completed', ended_at: new Date().toISOString(), duration_s: durationS })
    .eq('id', id)
    .select('*, mission_files(filename)')
    .single();
  if (error) throw error;
  return toServerMission(data);
}

export async function renameMission(id: string, name: string): Promise<ServerMission> {
  const { data, error } = await supabase
    .from('missions').update({ name }).eq('id', id).select('*, mission_files(filename)').single();
  if (error) throw error;
  return toServerMission(data);
}

export async function hideMission(id: string, hidden: boolean): Promise<ServerMission> {
  const { data, error } = await supabase
    .from('missions').update({ hidden }).eq('id', id).select('*, mission_files(filename)').single();
  if (error) throw error;
  return toServerMission(data);
}

export async function setMissionNotes(id: string, notes: string): Promise<ServerMission> {
  const { data, error } = await supabase
    .from('missions').update({ notes }).eq('id', id).select('*, mission_files(filename)').single();
  if (error) throw error;
  return toServerMission(data);
}

interface MissionFileRow {
  filename: string; kind: string; object_path: string; mime_type: string | null;
  size_bytes: number | null; duration_ms: number | null; captured_at: string | null;
}

export async function listMissionFiles(id: string): Promise<MissionFile[]> {
  const { data, error } = await supabase
    .from('mission_files').select('*').eq('mission_id', id).order('created_at', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as MissionFileRow[];
  const withUrls = await Promise.all(rows.map(async (f) => {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(f.object_path, 3600);
    return {
      filename: f.filename,
      kind: f.kind as MissionMediaKind,
      url: signed?.signedUrl ?? '',
      mime_type: f.mime_type ?? undefined,
      size_bytes: f.size_bytes ?? undefined,
      duration_ms: f.duration_ms ?? undefined,
      captured_at: toUnixSeconds(f.captured_at),
    };
  }));
  return withUrls;
}

/** Built client-side from the mission + its files (one entry per capture) —
 * there's no separate timeline endpoint since there's no backend. */
export async function getMissionTimeline(id: string): Promise<MissionEvent[]> {
  const mission = await getServerMission(id);
  const files = await listMissionFiles(id);
  const startedAtMs = mission.started_at * 1000;
  const events: MissionEvent[] = [{ offsetS: 0, label: 'Inicio de misión' }];
  for (const f of files) {
    const atMs = f.captured_at != null ? f.captured_at * 1000 : startedAtMs;
    const label = f.kind === 'photo' ? 'Foto capturada'
      : f.kind === 'video' ? 'Video capturado'
      : f.kind === 'audio' ? 'Audio grabado'
      : 'Archivo capturado';
    events.push({ offsetS: Math.max(0, (atMs - startedAtMs) / 1000), label: `${label}: ${f.filename}` });
  }
  if (missionIsReady(mission)) {
    events.push({
      offsetS: mission.duration_s,
      label: mission.status === 'error' || mission.status === 'interrupted' ? 'Misión interrumpida' : 'Fin de misión',
    });
  }
  return events.sort((a, b) => a.offsetS - b.offsetS);
}

/**
 * Uploads a photo, video clip or voice recording captured during the
 * mission straight to Supabase Storage (bucket "mission-media", path
 * <uid>/<mission_id>/<kind>-<timestamp>-<filename> — the storage policy on
 * storage.objects requires exactly that prefix), then records the pointer
 * (filename/kind/timestamp) in `mission_files`.
 */
export async function uploadMissionMedia(
  id: string,
  kind: MissionMediaKind,
  file: Blob,
  info: { filename: string; capturedAtMs: number; durationMs?: number },
): Promise<UploadedMissionMedia> {
  const ownerId = await currentUserId();
  const safeName = `${kind}-${info.capturedAtMs}-${info.filename}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const objectPath = `${ownerId}/${id}/${safeName}`;

  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(objectPath, file, {
    contentType: (file as { type?: string }).type || undefined,
  });
  if (uploadErr) throw uploadErr;

  const { data, error } = await supabase
    .from('mission_files')
    .insert({
      mission_id: id,
      owner_id: ownerId,
      object_path: objectPath,
      filename: info.filename,
      kind,
      mime_type: (file as { type?: string }).type || null,
      size_bytes: (file as { size?: number }).size ?? null,
      duration_ms: info.durationMs ?? null,
      captured_at: new Date(info.capturedAtMs).toISOString(),
    })
    .select()
    .single();
  if (error) throw error;

  return {
    filename: data.filename,
    kind: data.kind,
    size_bytes: data.size_bytes ?? undefined,
    mission_time_s: info.capturedAtMs / 1000,
  };
}

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|webm)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm)$/i;

// Voice recordings and screen clips can both be .webm; the kind prefix
// (photo-/video-/audio-, set by the upload itself) disambiguates first.
const isAudio = (a: string) => /(^|\/)audio-/i.test(a) || (AUDIO_EXT.test(a) && !/(^|\/)video-/i.test(a));

export const missionPhotoArtifacts = (m: ServerMission) => (m.artifacts ?? []).filter((a) => IMAGE_EXT.test(a));
export const missionAudioArtifacts = (m: ServerMission) => (m.artifacts ?? []).filter(isAudio);
export const missionVideoArtifacts = (m: ServerMission) => (m.artifacts ?? []).filter((a) => VIDEO_EXT.test(a) && !isAudio(a));

/** Client-side fallback (mission start/end only) for before
 * getMissionTimeline()'s richer per-file version has loaded. */
export function buildMissionTimeline(m: ServerMission): MissionEvent[] {
  const events: MissionEvent[] = [{ offsetS: 0, label: 'Inicio de misión' }];
  if (missionIsReady(m)) {
    events.push({
      offsetS: m.duration_s,
      label: m.status === 'error' || m.status === 'interrupted' ? 'Misión interrumpida' : 'Fin de misión',
    });
  }
  return events;
}
