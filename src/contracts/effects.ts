import type { EraId } from './era';

/** Bloom post-processing settings. */
export interface BloomSettings {
  enabled: boolean;
  intensity: number;
  threshold: number;
}

/** Vignette post-processing settings. */
export interface VignetteSettings {
  enabled: boolean;
  darkness: number;
}

/** Film-grain / noise post-processing settings. */
export interface NoiseSettings {
  enabled: boolean;
  opacity: number;
}

/** Color-grading post-processing settings. */
export interface ColorGradeSettings {
  saturation: number;
  contrast: number;
  brightness: number;
}

/**
 * Per-era post-processing configuration.
 * Downstream effects module reads this map to configure the render pipeline.
 */
export interface EffectsConfig {
  bloom: BloomSettings;
  vignette: VignetteSettings;
  noise: NoiseSettings;
  colorGrade: ColorGradeSettings;
}

/** Neutral baseline effects config (no post-processing). */
export const DEFAULT_EFFECTS_CONFIG: EffectsConfig = {
  bloom: { enabled: false, intensity: 0, threshold: 0.8 },
  vignette: { enabled: false, darkness: 0 },
  noise: { enabled: false, opacity: 0 },
  colorGrade: { saturation: 1, contrast: 1, brightness: 1 },
};

/**
 * Effects configuration keyed by era.
 * Values are placeholder hints for the scaffold; the effects module refines them.
 */
export const ERA_EFFECTS_CONFIG: Record<EraId, EffectsConfig> = {
  '1945': {
    bloom: { enabled: false, intensity: 0, threshold: 0.8 },
    vignette: { enabled: true, darkness: 0.6 },
    noise: { enabled: true, opacity: 0.25 },
    colorGrade: { saturation: 0.1, contrast: 1.1, brightness: 0.9 },
  },
  '1965': {
    bloom: { enabled: false, intensity: 0, threshold: 0.8 },
    vignette: { enabled: false, darkness: 0 },
    noise: { enabled: false, opacity: 0 },
    colorGrade: { saturation: 1.1, contrast: 1, brightness: 1 },
  },
  '1985': {
    bloom: { enabled: true, intensity: 1.4, threshold: 0.6 },
    vignette: { enabled: true, darkness: 0.35 },
    noise: { enabled: false, opacity: 0 },
    colorGrade: { saturation: 1.4, contrast: 1.05, brightness: 0.95 },
  },
  '2005': {
    bloom: { enabled: true, intensity: 0.8, threshold: 0.7 },
    vignette: { enabled: false, darkness: 0 },
    noise: { enabled: false, opacity: 0 },
    colorGrade: { saturation: 1.2, contrast: 1, brightness: 1 },
  },
  '2025': {
    bloom: { enabled: true, intensity: 1.1, threshold: 0.65 },
    vignette: { enabled: false, darkness: 0 },
    noise: { enabled: false, opacity: 0 },
    colorGrade: { saturation: 1.25, contrast: 1.05, brightness: 1.05 },
  },
};

/** Look up the effects config for an era. */
export function getEffectsConfig(era: EraId): EffectsConfig {
  return ERA_EFFECTS_CONFIG[era];
}
