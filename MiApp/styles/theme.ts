import { Platform } from 'react-native';

// Palette and type from the LAIKA design (PDF). Sizes elsewhere use `d()`
// (utils/scale): Figma px on a 844x390 landscape frame.
export const C = {
  red: '#E83D3D',
  redDark: '#9E2F2F',
  bg: '#282222',
  bgTop: '#5b4e4e',
  panel: '#2A2424',
  card: '#352D2D',
  input: '#262020',
  inputBorder: '#433939',
  control: '#302929',
  controlBar: '#231E1E',
  muted: '#4A4040',
  divider: '#5A4D4D',
  text: '#F8E3E3',
  textSoft: '#E8DADA',
  textDim: '#A89898',
  textFaint: '#8A7A7A',
  green: '#3CC46C',
  yellow: '#F5D20F',
  toast: '#F7E6E6',
  feedEmpty: '#857A79',
};

// Viga for the main titles/buttons; Helvetica for everything else.
// Expo loads it as "Viga_400Regular" (app/_layout.tsx, web and native); the
// Vite build gets "Viga" from Google Fonts (index.html).
export const VIGA = Platform.OS === 'web'
  ? 'Viga_400Regular, Viga, "Helvetica Neue", Helvetica, Arial, sans-serif'
  : 'Viga_400Regular';
export const HELV = Platform.OS === 'web' ? '"Helvetica Neue", Helvetica, Arial, sans-serif' : undefined;

/** Battery/connection colour: 65+ green, 35–64 yellow, below 35 red. */
export function levelColor(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return C.textFaint;
  if (value >= 65) return C.green;
  if (value >= 35) return C.yellow;
  return C.red;
}

export function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
