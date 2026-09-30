
// Same idea as DOG_API_URL above: EXPO_PUBLIC_BACKEND_HOST overrides this
// default, which is a LAN address and unreachable once this runs outside
// that network (e.g. deployed on Vercel). Also overridable at runtime from
// the login screen (see setBackendHost / BACKEND_IP_KEY in app/index.tsx).
let _backendHost = process.env.EXPO_PUBLIC_BACKEND_HOST || '10.4.13.35';
export function setBackendHost(ip: string) { _backendHost = ip.trim().replace(/\/$/, ''); }
export function getBackendHost() { return _backendHost; }
const bUrl = () => `http://${_backendHost}:3000`;
const dUrl = () => `http://${_backendHost}:3001`;

// Configurable via EXPO_PUBLIC_* env vars: MiApp/.env(.local) for local dev,
// Vercel Project Settings > Environment Variables for the deployed build.
// The literals below are only the dev fallback used when nothing is set.
export const DOG_API_URL = process.env.EXPO_PUBLIC_DOG_API_URL || 'http://181.93.94.107:8000';
export const DOG_TOKEN = process.env.EXPO_PUBLIC_DOG_TOKEN || 'dev-operator-token';
export const DOG_ROBOT_ID = process.env.EXPO_PUBLIC_DOG_ROBOT_ID || 'go2_01';

const DOG_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${DOG_TOKEN}`,
};

export interface RobotStatus {
  battery: number | null;
  speed: number;
  status: string;
}

// Unreachable hosts otherwise hang for the OS TCP timeout (20s+) and block
// the browser's per-host connection pool.
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDog(path: string, options: RequestInit = {}) {
  const res = await fetchWithTimeout(`${DOG_API_URL}${path}`, {
    ...options,
    headers: {
      ...DOG_HEADERS,
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DOG API ${res.status}: ${text || res.statusText}`);
  }

  return res;
}

export async function activateDogControl() {
  await fetchDog(`/api/robots/${DOG_ROBOT_ID}/control/activate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DOG_TOKEN}` },
  });
}

export function getDogLiveWsUrl() {
  const url = new URL(DOG_API_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws/live';
  url.search = `token=${encodeURIComponent(DOG_TOKEN)}`;
  return url.toString();
}

export function formatDogImageUri(data: any): string | null {
  if (!data?.image_base64) return null;
  const format = String(data.image_format ?? 'jpg').toLowerCase();
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${data.image_base64}`;
}

export async function sendDogCommand(type: string, payload: Record<string, unknown> = {}, ttlMs = 1200): Promise<void> {
  await fetchDog(`/api/robots/${DOG_ROBOT_ID}/commands`, {
    method: 'POST',
    body: JSON.stringify({
      type,
      payload,
      ttl_ms: ttlMs,
    }),
  });
}

/** Same as sendDogCommand but with a caller-chosen command_id, so the reply can be matched to a command_ack on /ws/live. */
export async function sendDogCommandWithId(
  type: string,
  payload: Record<string, unknown> = {},
  commandId: string,
  ttlMs = 3000
): Promise<void> {
  await fetchDog(`/api/robots/${DOG_ROBOT_ID}/commands`, {
    method: 'POST',
    body: JSON.stringify({
      command_id: commandId,
      type,
      payload,
      ttl_ms: ttlMs,
    }),
  });
}

export async function configureDogVisualStreams(cameraEnabled = true, lidarEnabled = true): Promise<void> {
  await activateDogControl();
  await sendDogCommand('set_camera_stream', {
    enabled: cameraEnabled,
    emit_every: 1,
    format: 'webp',
    target_fps: 12,
    jpeg_quality: 70,
    max_width: 960,
    bitrate_kbps: 900,
  }, 2000);
  await sendDogCommand('set_lidar_decoder', {
    decoder: 'native',
  }, 2000);
  await sendDogCommand('set_lidar', {
    enabled: lidarEnabled,
    subscribe: true,
    media_hz: 2,
    max_points: 8000,
  }, 2000);
}

export async function getRobotStatus(): Promise<RobotStatus> {
  const res = await fetchDog(`/api/robots/${DOG_ROBOT_ID}/capabilities`, {
    headers: { Authorization: `Bearer ${DOG_TOKEN}` },
  });
  const json = await res.json().catch(() => ({}));
  // No made-up default: an unknown battery must not show up as a healthy one.
  const battery = Number(json?.telemetry?.battery ?? json?.battery);
  return {
    battery: Number.isFinite(battery) ? battery : null,
    speed: Number(json?.limits?.max_linear_speed ?? 0),
    status: 'connected',
  };
}

export async function moveRobot(
  direction: 'forward' | 'backward' | 'left' | 'right' | 'strafeL' | 'strafeR' | 'stop',
  speedFactor = 0.5
): Promise<void> {
  if (direction === 'stop') {
    await sendDogCommand('move', { linear_x: 0, angular_z: 0, duration_ms: 100 }).catch(() => {});
    return;
  }
  await activateDogControl();
  const spd = Math.max(0.1, Math.min(1, speedFactor));
  const payloadByDirection: Record<string, Record<string, unknown>> = {
    forward:  { linear_x:  3.5 * spd, angular_z: 0,         duration_ms: 520 },
    backward: { linear_x: -2.3 * spd, angular_z: 0,         duration_ms: 520 },
    left:     { linear_x: 0,          angular_z:  3.68 * spd, duration_ms: 460 },
    right:    { linear_x: 0,          angular_z: -3.68 * spd, duration_ms: 460 },
    strafeL:  { linear_x: 0, lateral_y:  0.92 * spd, duration_ms: 520 },
    strafeR:  { linear_x: 0, lateral_y: -0.92 * spd, duration_ms: 520 },
  };
  await sendDogCommand('move', payloadByDirection[direction]);
}

export async function moveRobotAxes(
  linearX: number,
  linearY: number,
  angularZ: number,
  durationMs = 350
): Promise<void> {
  if (linearX === 0 && linearY === 0 && angularZ === 0) {
    await sendDogCommand('move', { linear_x: 0, angular_z: 0, duration_ms: 100 }).catch(() => {});
    return;
  }
  await activateDogControl();
  await sendDogCommand('move', {
    linear_x: linearX,
    lateral_y: linearY,
    angular_z: angularZ,
    duration_ms: durationMs,
  });
}

export async function emergencyStop(): Promise<void> {
  await sendDogCommand('stop_emergency', {}, 2000).catch(() => {});
}

export async function autonomousStart(): Promise<void> {
  await activateDogControl();
  try {
    await fetchDog(`/api/robots/${DOG_ROBOT_ID}/autonomy`, {
      method: 'POST',
      body: JSON.stringify({ action: 'start' }),
    });
  } catch {
    await sendDogCommand('autonomous_start', { mode: 'explore' }, 3000);
  }
}

export async function autonomousStop(): Promise<void> {
  try {
    await fetchDog(`/api/robots/${DOG_ROBOT_ID}/autonomy`, {
      method: 'POST',
      body: JSON.stringify({ action: 'stop' }),
    });
  } catch {
    await sendDogCommand('autonomous_stop', {}, 2000).catch(() => {});
  }
}

export async function registerUser(gmail: string, contrasena: string): Promise<void> {
  const res = await fetch(`${bUrl()}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gmail, username: gmail.split('@')[0], contrasena }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || 'Error al registrar');
  }
}

export interface DañoDetectado {
  tipo: string;
  severidad: number;
  grado: string;
  descripcion: string;
}

export interface AnalysisResult {
  tiene_daños: boolean;
  nivel_severidad_general: number;
  grado_general: string;
  daños_detectados: DañoDetectado[];
  resumen: string;
}

export async function analyzeBuilding(imageFile: File | { uri: string; type: string; name: string }): Promise<AnalysisResult> {
  const formData = new FormData();
  formData.append('image', imageFile as any);
  const res = await fetch(`${dUrl()}/analyze`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Error al analizar la imagen');
  return res.json();
}

export interface Perro {
  id_perro: number;
  nombre: string;
  estado_operativo: string;
  token_acceso: string;
}

export async function getPerros(): Promise<Perro[]> {
  const res = await fetch(`${bUrl()}/perros`);
  if (!res.ok) throw new Error('No se pudieron obtener los perros');
  return res.json();
}

export async function crearPerro(nombre: string): Promise<Perro> {
  const res = await fetch(`${bUrl()}/perros`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || 'No se pudo crear el perro');
  }
  return res.json();
}

export async function loginUser(gmail: string, contrasena: string): Promise<void> {
  const res = await fetch(`${bUrl()}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gmail, contrasena }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || 'Credenciales incorrectas');
  }
}
