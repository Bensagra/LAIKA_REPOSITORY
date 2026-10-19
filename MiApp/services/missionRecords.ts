import { supabase } from './supabase';

// Per-account mission metadata in Supabase: ownership, custom name, notes,
// hidden flag. Videos/photos/audios stay on the robot server (services/missions.ts)
// — this table never holds media, only strings tied to a mission_id.
// RLS (see supabase-mission-records.sql) restricts every row to its owner,
// which is what makes "Misiones y datos" private per account: a mission
// with no row for the signed-in user simply doesn't show up for them.

export interface MissionRecord {
  mission_id: string;
  user_id: string;
  custom_name: string | null;
  notes: string | null;
  hidden: boolean;
  created_at: string;
  updated_at: string;
}

/** RLS already limits this to the signed-in user's own rows. */
export async function listMyMissionRecords(): Promise<MissionRecord[]> {
  const { data, error } = await supabase.from('mission_records').select('*');
  if (error) throw error;
  return data ?? [];
}

export async function getMissionRecord(missionId: string): Promise<MissionRecord | null> {
  const { data, error } = await supabase
    .from('mission_records')
    .select('*')
    .eq('mission_id', missionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Call right after a mission starts recording, so its owner can see it later. */
export async function claimMission(missionId: string): Promise<void> {
  const { error } = await supabase.from('mission_records').upsert({ mission_id: missionId });
  if (error) throw error;
}

export async function setMissionOverride(
  missionId: string,
  patch: Partial<Pick<MissionRecord, 'custom_name' | 'hidden'>>,
): Promise<void> {
  const { error } = await supabase
    .from('mission_records')
    .upsert({ mission_id: missionId, ...patch, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function getMissionNotes(missionId: string): Promise<string> {
  const record = await getMissionRecord(missionId).catch(() => null);
  return record?.notes ?? '';
}

export async function setMissionNotes(missionId: string, notes: string): Promise<void> {
  const { error } = await supabase
    .from('mission_records')
    .upsert({ mission_id: missionId, notes, updated_at: new Date().toISOString() });
  if (error) throw error;
}
