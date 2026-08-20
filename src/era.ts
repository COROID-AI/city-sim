import * as THREE from 'three';

/**
 * Per-era color palette for the whole scene, plus the sub-blend between
 * "day" and "night" done via the day/night clock in the scene. Each era has a
 * complete set of fields so interpolation is trivial.
 */
export interface EraPalette {
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  fog: string;
  sun: string;
  sunIntensity: number;
  moon: string;
  hemi: string;
  hemiIntensity: number;
  ambient: string;
  ambientIntensity: number;
  ground: string;
  park: string;
  road: string;
  sidewalk: string;
  buildingA: string;
  buildingB: string;
  windowDay: string;
  windowNight: string;
  lamp: string;
  lampIntensity: number;
  neon: string;
  cloud: string;
  cloudOpacity: number;
  haze: number;
  bloom: number;
}

export const ERA_VISUALS: EraPalette[] = [
  // 1850 — frontier dusk, wood and oil lamps
  { skyTop: '#3a3128', skyMid: '#8a5c38', skyBottom: '#b3845c',
    fog: '#8a6a4a', sun: '#ffd8a0', sunIntensity: 2.2, moon: '#e8e4dc',
    hemi: '#ffd8a8', hemiIntensity: 0.9, ambient: '#5c3f26', ambientIntensity: 0.35,
    ground: '#5f4a36', park: '#4c6b3a', road: '#54463a', sidewalk: '#8a7a68',
    buildingA: '#9d5c34', buildingB: '#7a4a2e', windowDay: '#5c442c', windowNight: '#ff9a4a',
    lamp: '#ffbe6e', lampIntensity: 0.9, neon: '#ff7a3c',
    cloud: '#8a7a68', cloudOpacity: 0.5, haze: 0.3, bloom: 0.18 },
  // 1890 — Victorian amber
  {
    skyTop: '#453a52', skyMid: '#a86a3c', skyBottom: '#c9a24a',
    fog: '#a87a4a', sun: '#ffd895', sunIntensity: 2.4, moon: '#e8e4dc',
    hemi: '#ffe0b0', hemiIntensity: 0.95, ambient: '#6a4a2c', ambientIntensity: 0.38,
    ground: '#5f4e3a', park: '#8a9442', road: '#5f5040', sidewalk: '#947a5c',
    buildingA: '#b07a42', buildingB: '#8a5c34', windowDay: '#6a4a30', windowNight: '#ffc46e',
    lamp: '#ffbe6e', lampIntensity: 1.1, neon: '#ff8a4a',
    cloud: '#a89a80', cloudOpacity: 0.55, haze: 0.35, bloom: 0.2 },
  // 1910 — steel & streetcars, blue-gray
  {
    skyTop: '#4a5a70', skyMid: '#98b0c0', skyBottom: '#b8c4d4',
    fog: '#9aa8b8', sun: '#f5f2e8', sunIntensity: 2.6, moon: '#e8e4dc',
    hemi: '#d8ecff', hemiIntensity: 1.0, ambient: '#5c6a7a', ambientIntensity: 0.34,
    ground: '#5e6468', park: '#5a7a4a', road: '#565d5f', sidewalk: '#9a9a92',
    buildingA: '#8a7a72', buildingB: '#6e5f58', windowDay: '#d0dce4', windowNight: '#ffd27a',
    lamp: '#ffd27a', lampIntensity: 1.3, neon: '#ffc96e',
    cloud: '#c7d4de', cloudOpacity: 0.6, haze: 0.38, bloom: 0.14 },
  // 1930 — art deco sunset
  {
    skyTop: '#20303c', skyMid: '#7c2448', skyBottom: '#e8af5c',
    fog: '#b88a5c', sun: '#ffcf7a', sunIntensity: 2.8, moon: '#f2ead8',
    hemi: '#ffc894', hemiIntensity: 1.1, ambient: '#8a6a3a', ambientIntensity: 0.42,
    ground: '#767c68', park: '#5e8450', road: '#6b7270', sidewalk: '#c2b28c',
    buildingA: '#b88a4a', buildingB: '#8a6a3a', windowDay: '#f0c070', windowNight: '#ffd27a',
    lamp: '#ffd27a', lampIntensity: 1.45, neon: '#ffb84a',
    cloud: '#c8b894', cloudOpacity: 0.5, haze: 0.32, bloom: 0.3 },
  // 1950 — mid-century pastel
  {
    skyTop: '#bfe0d8', skyMid: '#b8e0f0', skyBottom: '#d8f0ec',
    fog: '#c8ece4', sun: '#fff6e0', sunIntensity: 3.0, moon: '#f0f0ec',
    hemi: '#e8fff6', hemiIntensity: 1.15, ambient: '#8aa8a0', ambientIntensity: 0.3,
    ground: '#90a098', park: '#5aa86a', road: '#606868', sidewalk: '#d8d2c4',
    buildingA: '#cfc0a0', buildingB: '#b4a278', windowDay: '#f4f8f0', windowNight: '#ffd88a',
    lamp: '#ffd88a', lampIntensity: 1.6, neon: '#9aff9a',
    cloud: '#f0f6f2', cloudOpacity: 0.7, haze: 0.42, bloom: 0.22 },
  // 1970 — heavy concrete sunset
  {
    skyTop: '#b85c2c', skyMid: '#d8a048', skyBottom: '#ffd08a',
    fog: '#e0a060', sun: '#ffe8b0', sunIntensity: 2.6, moon: '#e8f0f0',
    hemi: '#ffd8a8', hemiIntensity: 1.0, ambient: '#9a7a6a', ambientIntensity: 0.3,
    ground: '#8a8a84', park: '#6a8a5a', road: '#56565a', sidewalk: '#c8c8c0',
    buildingA: '#9a8a82', buildingB: '#b0a498', windowDay: '#ffe8c0', windowNight: '#ffce8a',
    lamp: '#ffce8a', lampIntensity: 1.5, neon: '#ff8a6a',
    cloud: '#c8a280', cloudOpacity: 0.5, haze: 0.35, bloom: 0.26 },
  // 1990 — glass towers bright day
  {
    skyTop: '#2e4f7a', skyMid: '#7fb0dc', skyBottom: '#cfe0f0',
    fog: '#a8c8e8', sun: '#fff6d8', sunIntensity: 3.0, moon: '#e8f4ff',
    hemi: '#d8f4ff', hemiIntensity: 1.15, ambient: '#8aa0bc', ambientIntensity: 0.32,
    ground: '#8b8b93', park: '#4f9e6a', road: '#3f4a52', sidewalk: '#b4bcc8',
    buildingA: '#b8c4d4', buildingB: '#8fa8c0', windowDay: '#d8e4f0', windowNight: '#ffe9a8',
    lamp: '#ffd8a0', lampIntensity: 1.7, neon: '#4affff',
    cloud: '#f4faff', cloudOpacity: 0.72, haze: 0.48, bloom: 0.3 },
  // 2010 — LED night skyline
  {
    skyTop: '#101c30', skyMid: '#1e3250', skyBottom: '#2c4a78',
    fog: '#24384e', sun: '#ffd587', sunIntensity: 2.2, moon: '#e8eef8',
    hemi: '#3a6090', hemiIntensity: 0.6, ambient: '#182438', ambientIntensity: 0.5,
    ground: '#2a3040', park: '#3a6a4a', road: '#262c34', sidewalk: '#5a6478',
    buildingA: '#42516a', buildingB: '#324058', windowDay: '#a0b8cc', windowNight: '#ffe9b0',
    lamp: '#ffedb0', lampIntensity: 2.2, neon: '#ff4aa8',
    cloud: '#3a4a6a', cloudOpacity: 0.35, haze: 0.55, bloom: 0.6 },
  // 2025 — LED night bloom
  {
    skyTop: '#0f1430', skyMid: '#141a40', skyBottom: '#262e58',
    fog: '#1c2860', sun: '#ffcf90', sunIntensity: 2.0, moon: '#dfe8ff',
    hemi: '#405078', hemiIntensity: 0.62, ambient: '#0f1628', ambientIntensity: 0.6,
    ground: '#1e2438', park: '#2e5a4a', road: '#141a2a', sidewalk: '#464e72',
    buildingA: '#4a5478', buildingB: '#39405c', windowDay: '#dce8f4', windowNight: '#ffe8b0',
    lamp: '#ffe8a8', lampIntensity: 2.4, neon: '#ff4aa2',
    cloud: '#2a3a58', cloudOpacity: 0.3, haze: 0.62, bloom: 0.85 },
  // 2035 — neon future
  {
    skyTop: '#05070f', skyMid: '#0c1030', skyBottom: '#101a3c',
    fog: '#0a1030', sun: '#ffd0a0', sunIntensity: 1.8, moon: '#e8f0ff',
    hemi: '#3050a8', hemiIntensity: 0.7, ambient: '#0a1030', ambientIntensity: 0.65,
    ground: '#0e1430', park: '#1a4a5a', road: '#0a0e28', sidewalk: '#28345c',
    buildingA: '#33406a', buildingB: '#263054', windowDay: '#d8e4f8', windowNight: '#ffe9a8',
    lamp: '#ffcc7a', lampIntensity: 2.6, neon: '#ff4ab8',
    cloud: '#1c2a4a', cloudOpacity: 0.25, haze: 0.6, bloom: 1.0 },
];

/** Short utility to blend two palette colors efficiently. */
const c = new THREE.Color();

export function lerpHex(a: string, b: string, t: number): string {
  return `#${c.lerpColors(new THREE.Color(a), new THREE.Color(b), t).getHexString()}`;
}

export function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface EraLerp {
  /** interpolated drawing palette */
  p: EraPalette;
  /** dominant era index after rounding (for labels) */
  idx: number;
}

/**
 * Blend two adjacent era palettes by a normalized timeline position `t` (0..1).
 * Returns the interpolated drawing palette and the nearest floor era index.
 */
export function blendEra(t: number): EraLerp {
  const n = ERA_VISUALS.length - 1;
  const scaled = Math.max(0, Math.min(n, t * n));
  const i = Math.min(n - 1, Math.floor(scaled));
  const frac = scaled - i;
  const a = ERA_VISUALS[i];
  const b = ERA_VISUALS[i + 1];
  const p = {} as Record<string, string | number>;
  (Object.keys(a) as (keyof EraPalette)[]).forEach((k) => {
    const av = a[k];
    const bv = b[k];
    if (typeof av === 'number' && typeof bv === 'number') {
      p[k] = lerpNum(av, bv, frac);
    } else {
      p[k] = lerpHex(av as string, bv as string, frac);
    }
  });
  return { p: p as unknown as EraPalette, idx: i };
}