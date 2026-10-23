// Web stand-in for expo-battery (its real package resolves to the native
// build under Vite — no Metro-style .web.js auto-resolution here — so it'd
// try to reach a native module that doesn't exist in the browser). Backed by
// the browser's Battery Status API, same as utils/device.ts used to do
// directly before this module existed.
type BatteryLevelEvent = { batteryLevel: number };
type Subscription = { remove: () => void };

function nav(): any {
  return (globalThis as any).navigator;
}

export async function getBatteryLevelAsync(): Promise<number> {
  if (typeof nav()?.getBattery !== 'function') return -1;
  try {
    const battery = await nav().getBattery();
    return battery.level;
  } catch {
    return -1;
  }
}

export function addBatteryLevelListener(listener: (event: BatteryLevelEvent) => void): Subscription {
  let battery: any = null;
  let removed = false;
  const update = () => {
    if (!removed && battery) listener({ batteryLevel: battery.level });
  };
  if (typeof nav()?.getBattery === 'function') {
    nav().getBattery().then((b: any) => {
      if (removed) return;
      battery = b;
      b.addEventListener('levelchange', update);
    }).catch(() => {});
  }
  return {
    remove: () => {
      removed = true;
      battery?.removeEventListener('levelchange', update);
    },
  };
}
