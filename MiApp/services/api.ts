// Cambiá esta IP por la de tu máquina si usás dispositivo físico (ej: http://192.168.1.x:3000)
export const BASE_URL = 'http://localhost:3000';

// Servidor de análisis de daños — corré con: PORT=3001 node server.js
export const DANOS_URL = 'http://localhost:3001';

export interface RobotStatus {
  battery: number;
  speed: number;
  status: string;
}

export async function getRobotStatus(): Promise<RobotStatus> {
  const res = await fetch(`${BASE_URL}/robot`);
  if (!res.ok) throw new Error('No se pudo obtener el estado del robot');
  return res.json();
}

export async function moveRobot(direction: 'forward' | 'backward' | 'left' | 'right'): Promise<void> {
  await fetch(`${BASE_URL}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  });
}

export async function registerUser(gmail: string, contrasena: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/register`, {
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

export async function analyzeBuilding(imageFile: File): Promise<AnalysisResult> {
  const formData = new FormData();
  formData.append('image', imageFile);
  const res = await fetch(`${DANOS_URL}/analyze`, {
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

export async function crearMision(nombre: string, id_usuario?: number): Promise<MisionResumen> {
  const res = await fetch(`${BASE_URL}/misiones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, id_usuario }),
  });
  if (!res.ok) throw new Error('No se pudo crear la misión');
  return res.json();
}

export async function getMisiones(): Promise<MisionResumen[]> {
  const res = await fetch(`${BASE_URL}/misiones`);
  if (!res.ok) throw new Error('No se pudieron obtener las misiones');
  return res.json();
}

export async function finalizarMision(id: number, edificios: any[]): Promise<void> {
  await fetch(`${BASE_URL}/misiones/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edificios }),
  });
}

export async function eliminarMision(id: number): Promise<void> {
  await fetch(`${BASE_URL}/misiones/${id}`, { method: 'DELETE' });
}

export async function renombrarMision(id: number, nombre: string): Promise<void> {
  await fetch(`${BASE_URL}/misiones/${id}/nombre`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre }),
  });
}

export async function loginUser(gmail: string, contrasena: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gmail, contrasena }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || 'Credenciales incorrectas');
  }
}
