import AsyncStorage from '@react-native-async-storage/async-storage';

// The robot's mission API has no rename/delete/notes endpoints yet (see
// services/missions.ts). Until it does, those three things are kept
// per-device here: rename/hide overlay the server list, notes are
// device-only and never sent anywhere.

export interface MissionOverride {
  name?: string;
  hidden?: boolean;
}

const OVERRIDES_KEY = 'laika.missionOverrides';
const NOTES_PREFIX = 'laika.missionNotes.';

export async function getMissionOverrides(): Promise<Record<string, MissionOverride>> {
  try {
    const raw = await AsyncStorage.getItem(OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function setMissionOverride(id: string, patch: Partial<MissionOverride>): Promise<Record<string, MissionOverride>> {
  const all = await getMissionOverrides();
  all[id] = { ...all[id], ...patch };
  await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(all));
  return all;
}

export async function getMissionNotes(id: string): Promise<string> {
  try {
    return (await AsyncStorage.getItem(NOTES_PREFIX + id)) ?? '';
  } catch {
    return '';
  }
}

export async function setMissionNotes(id: string, text: string): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTES_PREFIX + id, text);
  } catch {
    // best-effort: notes are a nice-to-have, never block the UI on this
  }
}
