import type { EraId } from './era';

/** Post-processing effect settings for a single era. */
export interface EffectsConfig {
  /** Bloom settings. */
  bloom: {
    enabled: boolean;
    intensity: number;
    luminanceThreshold: number;
  };
  /** Vignette settings. */
  vignette: {
    enabled: boolean;
    darkness: number;
  };
  /** Chromatic aberration settings. */
  chromaticAberration: {
    enabled: boolean;
    /** Normalized offset (x, y). */
    offset: [number, number];
  };
  /** Film-grain noise settings. */
  noise: {
    enabled: boolean;
    opacity: number;
  };
  /**
   * Screen-space ambient occlusion (a heavy effect — gated by the
   * quality toggle so it can be disabled on lower-end devices).
   */
  ambientOcclusion: {
    enabled: boolean;
    intensity: number;
    /** Occlusion radius in world units. */
    radius: number;
  };
  /**
   * Global color grading.
   *
   * `brightness`, `contrast`, and `saturation` are multipliers where
   * 1 is neutral. `temperature` is also centered on 1, where values
   * below 1 grade cooler (blue) and values above 1 grade warmer
   * (sepia/orange).
   */
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
}

/** Neutral default effect settings. */
export const DEFAULT_EFFECTS_CONFIG: EffectsConfig = {
  bloom: { enabled: false, intensity: 0.6, luminanceThreshold: 1 },
  vignette: { enabled: false, darkness: 0.5 },
  chromaticAberration: { enabled: false, offset: [0.0005, 0.0005] },
  noise: { enabled: false, opacity: 0.05 },
  ambientOcclusion: { enabled: false, intensity: 1, radius: 0.5 },
  brightness: 1,
  contrast: 1,
  saturation: 1,
  temperature: 1,
};

/**
 * Effects configuration keyed by era, tuned to reinforce each era's mood.
 *
 * - 1945: warm sepia-ish grade, soft vignette, subtle bloom on period neon.
 * - 1965: balanced saturation, moderate bloom.
 * - 1985: hazy contrast with bloom on neon/backlit signage.
 * - 2005: clean bright grade, moderate bloom on LEDs.
 * - 2025: punchy modern grade with strong bloom on LED/digital media
 *   facades and crisp ambient occlusion.
 */
export const EFFECTS_BY_ERA: Record<EraId, EffectsConfig> = {
  1945: {
    ...DEFAULT_EFFECTS_CONFIG,
    bloom: {
      ...DEFAULT_EFFECTS_CONFIG.bloom,
      enabled: true,
      intensity: 0.45,
      luminanceThreshold: 1,
    },
    vignette: {
      ...DEFAULT_EFFECTS_CONFIG.vignette,
      enabled: true,
      darkness: 0.6,
    },
    noise: { ...DEFAULT_EFFECTS_CONFIG.noise, enabled: true, opacity: 0.16 },
    saturation: 0.75,
    contrast: 0.9,
    brightness: 0.96,
    temperature: 1.1,
  },
  1965: {
    ...DEFAULT_EFFECTS_CONFIG,
    bloom: {
      ...DEFAULT_EFFECTS_CONFIG.bloom,
      enabled: true,
      intensity: 0.75,
      luminanceThreshold: 0.9,
    },
    saturation: 1.1,
    contrast: 1.05,
    brightness: 1,
    temperature: 1.02,
  },
  1985: {
    ...DEFAULT_EFFECTS_CONFIG,
    bloom: {
      ...DEFAULT_EFFECTS_CONFIG.bloom,
      enabled: true,
      intensity: 1.25,
      luminanceThreshold: 0.75,
    },
    vignette: {
      ...DEFAULT_EFFECTS_CONFIG.vignette,
      enabled: true,
      darkness: 0.4,
    },
    chromaticAberration: {
      ...DEFAULT_EFFECTS_CONFIG.chromaticAberration,
      enabled: true,
    },
    noise: { ...DEFAULT_EFFECTS_CONFIG.noise, enabled: true, opacity: 0.08 },
    saturation: 1.45,
    contrast: 1.18,
    brightness: 1,
    temperature: 0.92,
  },
  2005: {
    ...DEFAULT_EFFECTS_CONFIG,
    bloom: {
      ...DEFAULT_EFFECTS_CONFIG.bloom,
      enabled: true,
      intensity: 0.8,
      luminanceThreshold: 0.85,
    },
    saturation: 1.05,
    contrast: 1,
    brightness: 1.05,
    temperature: 1,
  },
  2025: {
    ...DEFAULT_EFFECTS_CONFIG,
    bloom: {
      ...DEFAULT_EFFECTS_CONFIG.bloom,
      enabled: true,
      intensity: 1.5,
      luminanceThreshold: 0.7,
    },
    vignette: {
      ...DEFAULT_EFFECTS_CONFIG.vignette,
      enabled: true,
      darkness: 0.3,
    },
    ambientOcclusion: {
      ...DEFAULT_EFFECTS_CONFIG.ambientOcclusion,
      enabled: true,
      intensity: 1.2,
      radius: 0.5,
    },
    saturation: 1.2,
    contrast: 1.15,
    brightness: 1.05,
    temperature: 1,
  },
};
