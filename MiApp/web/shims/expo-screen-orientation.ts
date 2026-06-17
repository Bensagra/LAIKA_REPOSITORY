export enum OrientationLock {
  LANDSCAPE = 'LANDSCAPE',
}

export async function lockAsync() {
  if (document.fullscreenElement && screen.orientation?.lock) {
    await screen.orientation.lock('landscape').catch(() => undefined);
  }
}
