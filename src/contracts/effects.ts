import type { EraId } from './era';

/**
 * Post-processing / visual-effects settings for a single era.
 *
 * Later tasks map these onto @react-three/postprocessing passes.
 */
export interface EffectsConfig {
  bloom: {
    enabled: boolean;
    intensity: number;
  };
  vignette: {
    enabled: boolean;
    darkness: number;
  };
  saturation: number;
  contrast: number;
}

/** Post-processing settings keyed by era. */
export type EffectsConfigByEra = Record<EraId, EffectsConfig>;
