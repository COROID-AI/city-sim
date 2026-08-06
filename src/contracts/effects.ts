import type { EraId } from './era';

/**
 * Post-processing / visual-effects settings for a single era.
 *
 * The effects module maps these onto @react-three/postprocessing passes.
 */
export interface EffectsConfig {
  bloom: {
    enabled: boolean;
    /** Bloom strength. Scales with the era's signage (neon / LED). */
    intensity: number;
  };
  /** Screen-space ambient occlusion. Heavy effect; disabled on low quality. */
  ambientOcclusion: {
    enabled: boolean;
    /** Occlusion strength. */
    intensity: number;
    /** Occlusion radius in world units. */
    radius: number;
  };
  vignette: {
    enabled: boolean;
    /** Vignette darkness (0..1). */
    darkness: number;
  };
  /** Color-grading brightness in the normalized -1..1 range. */
  brightness: number;
  /** Color-grading contrast in the normalized -1..1 range. */
  contrast: number;
  /** Color-grading saturation in the normalized -1..1 range. */
  saturation: number;
  /** Color temperature: negative = cool, positive = warm (normalized -1..1). */
  temperature: number;
}

/** Post-processing settings keyed by era. */
export type EffectsConfigByEra = Record<EraId, EffectsConfig>;
