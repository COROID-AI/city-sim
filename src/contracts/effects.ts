import type { EraId } from './era';

/** Bloom post-processing settings. */
export interface BloomConfig {
  enabled: boolean;
  intensity: number;
  threshold: number;
  radius: number;
}

/** Vignette post-processing settings. */
export interface VignetteConfig {
  enabled: boolean;
  darkness: number;
  offset: number;
}

/** Film-grain / noise post-processing settings. */
export interface NoiseConfig {
  enabled: boolean;
  opacity: number;
}

/** Chromatic aberration post-processing settings. */
export interface ChromaticAberrationConfig {
  enabled: boolean;
  /** Offset vector, e.g. [0.001, 0.0005]. */
  offset: [number, number];
}

/**
 * Post-processing / color-grade settings for a single era.
 * Consumed by the @react-three/postprocessing effect composer.
 */
export interface EffectsConfig {
  bloom: BloomConfig;
  vignette: VignetteConfig;
  noise: NoiseConfig;
  chromaticAberration: ChromaticAberrationConfig;
  /** Color grade: saturation multiplier (1 = neutral). */
  saturation: number;
  /** Color grade: contrast multiplier (1 = neutral). */
  contrast: number;
  /** Color grade: brightness multiplier (1 = neutral). */
  brightness: number;
}

/** Post-processing settings keyed by era id. */
export type EffectsConfigByEra = Record<EraId, EffectsConfig>;

/**
 * Default post-processing profile for every era. Placeholder values that
 * downstream modules may override per era.
 */
export const DEFAULT_EFFECTS_CONFIG: EffectsConfig = {
  bloom: { enabled: false, intensity: 1.0, threshold: 0.8, radius: 0.6 },
  vignette: { enabled: false, darkness: 0.6, offset: 0.2 },
  noise: { enabled: false, opacity: 0.05 },
  chromaticAberration: { enabled: false, offset: [0.001, 0.0005] },
  saturation: 1.0,
  contrast: 1.0,
  brightness: 1.0,
};
