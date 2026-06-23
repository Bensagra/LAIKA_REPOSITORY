export enum OrientationLock {
  LANDSCAPE = 'LANDSCAPE',
}

export async function lockAsync() {
  const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
  if (document.fullscreenElement && orientation?.lock) {
    await orientation.lock('landscape').catch(() => undefined);
  }
}
