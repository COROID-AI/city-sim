import type { EraId } from '../contracts';

/**
 * Pedestrians (crowd) configuration.
 *
 * This module is keyed off the shared era registry (EraId) and holds every
 * era-variant decision for the sidewalk crowd: density, outfit palettes,
 * figure heights, walking speeds and gait. It is intentionally self-contained
 * so it can be dropped into any R3F canvas without depending on other
 * modules.
 */

/**
 * A single pedestrian figure spec generated for an era.
 */
export interface PedestrianInstance {
  /** Which sidewalk loop the figure walks on. */
  loopIndex: number;
  /** 0..1 position along the loop at t = 0. */
  phase: number;
  /** Loop fraction travelled per second (walking speed). */
  speed: number;
  /** Direction around the loop. */
  direction: 1 | -1;
  /** Figure height in world units (scales the shared geometry). */
  height: number;
  /** Walk-cycle phase offset so the crowd isn't marching in lock step. */
  walkOffset: number;
  /** Coat / torso color. */
  coat: string;
  /** Pants color. */
  pants: string;
  /** Skin color. */
  skin: string;
  /** Whether the figure wears a period hat (1945). */
  hat: boolean;
}

/** Per-era crowd configuration. */
export interface PedestrianEraConfig {
  era: EraId;
  /** Number of figures on the sidewalks. */
  count: number;
  coatColors: string[];
  pantsColors: string[];
  skinColors: string[];
  /** Min/max figure height (world units). */
  heightMin: number;
  heightMax: number;
  /** Min/max walking speed (loop fraction per second). */
  speedMin: number;
  speedMax: number;
  /** Seconds per full walk cycle (drives leg-swing frequency). */
  strideSeconds: number;
  /** Whether figures wear hats. */
  hats: boolean;
  /** Short mood description for the module docs. */
  mood: string;
}

/**
 * Registry of pedestrian configuration keyed by EraId. Density and palette
 * evolve with the period: sparse muted crowds in 1945, pastels in 1965,
 * dense bright jackets in 1985, casual digital-era wear in 2005 and a
 * tech/athleisure crowd in 2025.
 */
export const ERA_PEDESTRIAN_CONFIG: Record<EraId, PedestrianEraConfig> = {
  '1945': {
    era: '1945',
    count: 10,
    coatColors: ['#5b5248', '#4a4a52', '#6b4f3a', '#3f3f45'],
    pantsColors: ['#3a3a3a', '#4d443c', '#2e2e33'],
    skinColors: ['#d9b48f', '#c49a6c', '#e8c39a'],
    heightMin: 1.55,
    heightMax: 1.78,
    speedMin: 0.006,
    speedMax: 0.01,
    strideSeconds: 1.15,
    hats: true,
    mood: 'Muted post-war coats and fedoras on sparse sidewalks',
  },
  '1965': {
    era: '1965',
    count: 16,
    coatColors: ['#7f9eb5', '#b58ba0', '#8fb08a', '#d9c07a'],
    pantsColors: ['#4a4a52', '#5b5b66', '#3a3a42'],
    skinColors: ['#e0b48f', '#c99b6e', '#8d6b4f'],
    heightMin: 1.58,
    heightMax: 1.82,
    speedMin: 0.007,
    speedMax: 0.011,
    strideSeconds: 1.05,
    hats: false,
    mood: 'Mid-century pastel outfits, busier streets',
  },
  '1985': {
    era: '1985',
    count: 26,
    coatColors: ['#c72f3f', '#2f6feb', '#e8842f', '#7a2fbf', '#e6e6e6'],
    pantsColors: ['#2e2e33', '#3a3a42', '#20242c'],
    skinColors: ['#e8c39a', '#d9b48f', '#a67c52', '#6b4f3a'],
    heightMin: 1.6,
    heightMax: 1.85,
    speedMin: 0.008,
    speedMax: 0.013,
    strideSeconds: 0.95,
    hats: false,
    mood: 'Dense bright jackets and neon accents',
  },
  '2005': {
    era: '2005',
    count: 34,
    coatColors: ['#5b6b7a', '#7a8a99', '#4a6b57', '#8a6b5b', '#e0e0e0'],
    pantsColors: ['#33353a', '#2a2c30', '#3d4046'],
    skinColors: ['#e8c39a', '#c99b6e', '#a67c52', '#7a5b3a', '#d9b48f'],
    heightMin: 1.6,
    heightMax: 1.88,
    speedMin: 0.009,
    speedMax: 0.014,
    strideSeconds: 0.9,
    hats: false,
    mood: 'Casual digital-era crowd, heads down in phones',
  },
  '2025': {
    era: '2025',
    count: 42,
    coatColors: ['#1f2a3a', '#2f6feb', '#7fd4ff', '#e8e8e8', '#4a4f5a', '#c72f3f'],
    pantsColors: ['#16181c', '#1f2228', '#2a2e36'],
    skinColors: ['#e8c39a', '#d9b48f', '#c99b6e', '#a67c52', '#8d6b4f', '#f0d5b0'],
    heightMin: 1.62,
    heightMax: 1.9,
    speedMin: 0.01,
    speedMax: 0.015,
    strideSeconds: 0.85,
    hats: false,
    mood: 'Dense tech/athleisure crowd, brisk pace',
  },
};

/**
 * Sidewalk loops around the block. Two concentric rings keep crowd members on
 * separate paths so they don't walk through each other. Corners are [x, z]
 * pairs in order, forming a closed loop.
 */
export const SIDEWALK_LOOPS: [number, number][][] = [
  [
    [-4.6, 17],
    [4.6, 17],
    [4.6, -17],
    [-4.6, -17],
  ],
  [
    [-4.6, 13],
    [4.6, 13],
    [4.6, -13],
    [-4.6, -13],
  ],
];

/** Simple string hash used to derive deterministic per-era seeds. */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32) so the crowd is stable per era. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate the era crowd deterministically: per-member loop, phase, speed,
 * direction, height, gait offset and outfit colors.
 */
export function generatePedestrians(era: EraId, seed?: number): PedestrianInstance[] {
  const cfg = ERA_PEDESTRIAN_CONFIG[era];
  const rand = mulberry32(seed ?? hashString(`pedestrians:${era}`));
  const out: PedestrianInstance[] = [];

  for (let i = 0; i < cfg.count; i++) {
    out.push({
      loopIndex: i % SIDEWALK_LOOPS.length,
      phase: rand(),
      speed: cfg.speedMin + rand() * (cfg.speedMax - cfg.speedMin),
      direction: rand() < 0.5 ? 1 : -1,
      height: cfg.heightMin + rand() * (cfg.heightMax - cfg.heightMin),
      walkOffset: rand() * Math.PI * 2,
      coat: cfg.coatColors[Math.floor(rand() * cfg.coatColors.length)],
      pants: cfg.pantsColors[Math.floor(rand() * cfg.pantsColors.length)],
      skin: cfg.skinColors[Math.floor(rand() * cfg.skinColors.length)],
      hat: cfg.hats && rand() < 0.45,
    });
  }

  return out;
}

/** Look up the crowd config for an era. */
export function getPedestrianConfig(era: EraId): PedestrianEraConfig {
  return ERA_PEDESTRIAN_CONFIG[era];
}
