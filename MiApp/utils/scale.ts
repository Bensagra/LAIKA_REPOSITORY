import { Dimensions } from 'react-native';

const { width: W, height: H } = Dimensions.get('window');

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
