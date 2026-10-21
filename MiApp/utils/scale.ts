import { Dimensions } from 'react-native';

const { width: rawW, height: rawH } = Dimensions.get('window');

// The app is locked to landscape, but on native `Dimensions.get('window')` is
// read at bundle-eval time, before `ScreenOrientation.lockAsync` takes effect —
// if the device happens to still be in portrait at that instant, W/H come back
// swapped and the whole absolute-positioned layout ends up wrong (e.g. the
// LAIKA logo on the home screen getting cut off). Always treat the longer side
// as width so the scale is correct regardless of orientation at load time.
const W = Math.max(rawW, rawH);
const H = Math.min(rawW, rawH);

const DW = 800;
const DH = 450;

const RAW = Math.min(W / DW, H / DH);
export const SCALE = Math.min(RAW, 1);

export const s = (n: number): number => Math.round(n * Math.max(SCALE, 0.8));

export const f = (n: number): number => Math.max(Math.round(n * Math.max(SCALE, 0.85)), 10);

// Figma frame for the redesigned screens (landscape phone, ~844x390).
// `d` maps Figma px to screen px, scaling up or down to fit the window.
const DESIGN_K = Math.min(W / 844, H / 390);
export const d = (n: number): number => Math.round(n * DESIGN_K);
