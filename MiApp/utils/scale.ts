import { Dimensions } from 'react-native';

const { width: W, height: H } = Dimensions.get('window');

// Referencia: celular horizontal típico (800×450)
// En web más grande queda igual (capeado en 1.0)
const DW = 800;
const DH = 450;

const RAW = Math.min(W / DW, H / DH);
export const SCALE = Math.min(RAW, 1);

// Escala tamaños — mínimo 80% para que nada quede ilegible
export const s = (n: number): number => Math.round(n * Math.max(SCALE, 0.8));

// Escala fuentes — mínimo 85% y nunca menos de 10px
export const f = (n: number): number => Math.max(Math.round(n * Math.max(SCALE, 0.85)), 10);
