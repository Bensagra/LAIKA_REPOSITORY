import { useEffect, useState } from 'react';
import * as Battery from 'expo-battery';

// Phone/tablet battery level, 0-100 or null if unavailable. On native this is
// expo-battery for real; on web it's aliased (vite.config.ts) to a shim over
// the browser's Battery Status API (Chrome/Edge/Android — Safari and Firefox
// don't expose it, so this stays null there too).
export function useDeviceBattery(): number | null {
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    Battery.getBatteryLevelAsync()
      .then((value) => { if (alive && value >= 0) setLevel(Math.round(value * 100)); })
      .catch(() => {});
    const sub = Battery.addBatteryLevelListener(({ batteryLevel }) => {
      if (alive) setLevel(Math.round(batteryLevel * 100));
    });
    return () => { alive = false; sub.remove(); };
  }, []);
  return level;
}

export async function readDeviceBattery(): Promise<number | null> {
  try {
    const value = await Battery.getBatteryLevelAsync();
    return value >= 0 ? Math.round(value * 100) : null;
  } catch {
    return null;
  }
}

/** Microphone + speaker present, from the device list (no permission prompt). */
export async function hasMicAndSpeaker(): Promise<boolean | null> {
  const devices = (globalThis as any).navigator?.mediaDevices;
  if (typeof devices?.enumerateDevices !== 'function') return null;
  try {
    const list: { kind: string }[] = await devices.enumerateDevices();
    // Only the microphone is checked: Firefox and Safari don't list audio
    // outputs at all, so a missing speaker entry can't be told apart.
    return list.some((d) => d.kind === 'audioinput');
  } catch {
    return null;
  }
}
