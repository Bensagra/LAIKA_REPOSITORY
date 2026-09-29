import { useEffect, useState } from 'react';

// Phone/tablet battery via the Battery Status API (Chrome/Edge/Android).
// Returns null where the browser doesn't expose it (Safari, Firefox, native).
export function useDeviceBattery(): number | null {
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    const nav = (globalThis as any).navigator;
    if (typeof nav?.getBattery !== 'function') return;
    let battery: any = null;
    const update = () => setLevel(Math.round(battery.level * 100));
    nav.getBattery().then((b: any) => {
      battery = b;
      update();
      b.addEventListener('levelchange', update);
    }).catch(() => {});
    return () => battery?.removeEventListener('levelchange', update);
  }, []);
  return level;
}

export async function readDeviceBattery(): Promise<number | null> {
  const nav = (globalThis as any).navigator;
  if (typeof nav?.getBattery !== 'function') return null;
  try {
    const b = await nav.getBattery();
    return Math.round(b.level * 100);
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
