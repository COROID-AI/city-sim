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
  /** Global saturation (1 = neutral). */
  saturation: number;
  /** Global contrast (1 = neutral). */
  contrast: number;
}

/** Neutral default effect settings. */
export const DEFAULT_EFFECTS_CONFIG: EffectsConfig = {
  bloom: { enabled: false, intensity: 0.6, luminanceThreshold: 1 },
  vignette: { enabled: false, darkness: 0.5 },
  chromaticAberration: { enabled: false, offset: [0.0005, 0.0005] },
  noise: { enabled: false, opacity: 0.05 },
  saturation: 1,
  contrast: 1,
};

/** Effects configuration keyed by era (placeholder values). */
export const EFFECTS_BY_ERA: Record<EraId, EffectsConfig> = {
  1945: {
    ...DEFAULT_EFFECTS_CONFIG,
    bloom: { ...DEFAULT_EFFECTS_CONFIG.bloom, enabled: false },
    vignette: {
      ...DEFAULT_EFFECTS_CONFIG.vignette,
      enabled: true,
      darkness: 0.7,
    },
    noise: { ...DEFAULT_EFFECTS_CONFIG.noise, enabled: true, opacity: 0.18 },
    saturation: 0.7,
    contrast: 0.9,
  },
  1965: {
    ...DEFAULT_EFFECTS_CONFIG,
    bloom: { ...DEFAULT_EFFECTS_CONFIG.bloom, enabled: false },
    saturation: 1.1,
    contrast: 1.05,
  },
  1985: {
    ...DEFAULT_EFFECTS_CONFIG,
    bloom: { ...DEFAULT_EFFECTS_CONFIG.bloom, enabled: true, intensity: 1.2 },
    vignette: {
      ...DEFAULT_EFFECTS_CONFIG.vignette,
      enabled: true,
      darkness: 0.4,
    },
    chromaticAberration: {
      ...DEFAULT_EFFECTS_CONFIG.chromaticAberration,
      enabled: true,
    },
    saturation: 1.4,
    contrast: 1.15,
  },
  2005: {
    ...DEFAULT_EFFECTS_CONFIG,
    bloom: { ...DEFAULT_EFFECTS_CONFIG.bloom, enabled: true, intensity: 0.8 },
    saturation: 1.05,
    contrast: 1,
  },
  2025: {
    ...DEFAULT_EFFECTS_CONFIG,
    bloom: { ...DEFAULT_EFFECTS_CONFIG.bloom, enabled: true, intensity: 1.0 },
    saturation: 1.2,
    contrast: 1.1,
  },
};
