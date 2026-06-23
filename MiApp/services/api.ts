// IP de tu laptop (donde corre el backend Express + servidor IA).
// Configurable desde la app → ajustes ⚙
let _backendHost = '10.40.5.11';
export function setBackendHost(ip: string) { _backendHost = ip.trim().replace(/\/$/, ''); }
export function getBackendHost() { return _backendHost; }
const bUrl = () => `http://${_backendHost}:3000`;
const dUrl = () => `http://${_backendHost}:3001`;

// API fija del perro (IP fija, no cambia).
export const DOG_API_URL = 'http://10.40.5.4:8000';
export const DOG_TOKEN = 'dev-operator-token';
export const DOG_ROBOT_ID = 'go2_01';

const DOG_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${DOG_TOKEN}`,
};

export interface RobotStatus {
  battery: number;
  speed: number;
  status: string;
}

async function fetchDog(path: string, options: RequestInit = {}) {
  const res = await fetch(`${DOG_API_URL}${path}`, {
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

async function activateDogControl() {
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

export async function configureDogVisualStreams(cameraEnabled = true, lidarEnabled = true): Promise<void> {
  await activateDogControl();
  await sendDogCommand('set_camera_stream', {
    enabled: cameraEnabled,
    emit_every: 1,
    jpeg_quality: 80,
  }, 2000);
  await sendDogCommand('set_lidar', {
    enabled: lidarEnabled,
    subscribe: true,
  }, 2000);
}

export async function getRobotStatus(): Promise<RobotStatus> {
  const res = await fetchDog(`/api/robots/${DOG_ROBOT_ID}/capabilities`, {
    headers: { Authorization: `Bearer ${DOG_TOKEN}` },
  });
  const json = await res.json().catch(() => ({}));
  return {
    battery: Number(json?.telemetry?.battery ?? json?.battery ?? 85),
    speed: Number(json?.limits?.max_linear_speed ?? 0),
    status: 'connected',
  };
}

// speedFactor: 0–1 (default 0.5 = 50% of max API speed)
export async function moveRobot(
  direction: 'forward' | 'backward' | 'left' | 'right' | 'strafeL' | 'strafeR' | 'stop',
  speedFactor = 0.5
): Promise<void> {
  if (direction === 'stop') {
    await sendDogCommand('move', { linear_x: 0, linear_y: 0, angular_z: 0, duration_ms: 100 }).catch(() => {});
    return;
  }
  await activateDogControl();
  const spd = Math.max(0.1, Math.min(1, speedFactor));
  const payloadByDirection: Record<string, object> = {
    forward:  { linear_x:  3.5 * spd, linear_y: 0, angular_z: 0,         duration_ms: 520 },
    backward: { linear_x: -2.3 * spd, linear_y: 0, angular_z: 0,         duration_ms: 520 },
    left:     { linear_x: 0,          linear_y: 0, angular_z:  3.68 * spd, duration_ms: 460 },
    right:    { linear_x: 0,          linear_y: 0, angular_z: -3.68 * spd, duration_ms: 460 },
    strafeL:  { linear_x: 0,          linear_y:  0.92 * spd, angular_z: 0, duration_ms: 460 },
    strafeR:  { linear_x: 0,          linear_y: -0.92 * spd, angular_z: 0, duration_ms: 460 },
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
    await sendDogCommand('move', { linear_x: 0, linear_y: 0, angular_z: 0, duration_ms: 100 }).catch(() => {});
    return;
  }
  await activateDogControl();
  await sendDogCommand('move', { linear_x: linearX, linear_y: linearY, angular_z: angularZ, duration_ms: durationMs });
}

export async function emergencyStop(): Promise<void> {
  await sendDogCommand('stop_emergency', {}, 2000).catch(() => {});
}

export async function autonomousStart(): Promise<void> {
  await activateDogControl();
  await sendDogCommand('autonomous_start', { mode: 'explore' }, 3000);
}

export async function autonomousStop(): Promise<void> {
  await sendDogCommand('autonomous_stop', {}, 2000).catch(() => {});
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

export interface MisionResumen {
  id_mision: number;
  nombre: string;
  estado_mision: string;
  descripcion: string | null;
  created_at: string;
}

const MISIONES_STORAGE_KEY = 'laika.misiones';

function canUseLocalStorage() {
  return typeof globalThis !== 'undefined' && 'localStorage' in globalThis;
}

function getMisionesLocales(): MisionResumen[] {
  if (!canUseLocalStorage()) return [];
  try {
    const raw = globalThis.localStorage.getItem(MISIONES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setMisionesLocales(misiones: MisionResumen[]) {
  if (!canUseLocalStorage()) return;
  globalThis.localStorage.setItem(MISIONES_STORAGE_KEY, JSON.stringify(misiones));
}

function upsertMisionLocal(mision: MisionResumen) {
  const misiones = getMisionesLocales();
  const index = misiones.findIndex((m) => m.id_mision === mision.id_mision);
  if (index >= 0) misiones[index] = mision;
  else misiones.unshift(mision);
  setMisionesLocales(misiones);
}

function crearMisionLocal(nombre: string): MisionResumen {
  return {
    id_mision: Date.now(),
    nombre,
    estado_mision: 'activa',
    descripcion: null,
    created_at: new Date().toISOString(),
  };
}

export async function crearMision(nombre: string, id_usuario?: number): Promise<MisionResumen> {
  try {
  const res = await fetch(`${bUrl()}/misiones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, id_usuario }),
  });
  if (!res.ok) throw new Error('No se pudo crear la misión');
  const mision = await res.json();
  upsertMisionLocal(mision);
  return mision;
  } catch {
    const mision = crearMisionLocal(nombre);
    upsertMisionLocal(mision);
    return mision;
  }
}

export async function getMisiones(): Promise<MisionResumen[]> {
  const locales = getMisionesLocales();
  try {
  const res = await fetch(`${bUrl()}/misiones`);
  if (!res.ok) throw new Error('No se pudieron obtener las misiones');
  const remotas: MisionResumen[] = await res.json();
  const porId = new Map<number, MisionResumen>();
  [...locales, ...remotas].forEach((mision) => porId.set(mision.id_mision, mision));
  const combinadas = Array.from(porId.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  setMisionesLocales(combinadas);
  return combinadas;
  } catch {
    return locales;
  }
}

export async function finalizarMision(id: number, edificios: any[]): Promise<void> {
  const misiones = getMisionesLocales();
  const index = misiones.findIndex((m) => m.id_mision === id);
  if (index >= 0) {
    misiones[index] = {
      ...misiones[index],
      estado_mision: 'finalizada',
      descripcion: JSON.stringify(edificios),
    };
    setMisionesLocales(misiones);
  }

  try {
  await fetch(`${bUrl()}/misiones/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edificios }),
  });
  } catch {}
}

export async function eliminarMision(id: number): Promise<void> {
  setMisionesLocales(getMisionesLocales().filter((m) => m.id_mision !== id));
  try {
  await fetch(`${bUrl()}/misiones/${id}`, { method: 'DELETE' });
  } catch {}
}

export async function renombrarMision(id: number, nombre: string): Promise<void> {
  setMisionesLocales(
    getMisionesLocales().map((m) => (m.id_mision === id ? { ...m, nombre } : m))
  );
  try {
  await fetch(`${bUrl()}/misiones/${id}/nombre`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre }),
  });
  } catch {}
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
