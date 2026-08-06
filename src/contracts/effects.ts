import type { EraId } from './era';

/** Bloom post-processing settings. */
export interface BloomSettings {
  enabled: boolean;
  intensity: number;
  threshold: number;
}

/** Ambient occlusion (AO) post-processing settings. */
export interface AoSettings {
  enabled: boolean;
  intensity: number;
  /** Radius of the occlusion sample in world units. */
  radius: number;
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

/**
 * Color-grading post-processing settings.
 *
 * `temperature` shifts the white balance: positive values warm the image
 * (toward orange), negative values cool it (toward blue). The scale is
 * roughly -1..+1.
 */
export interface ColorGradeSettings {
  saturation: number;
  contrast: number;
  brightness: number;
  temperature: number;
}

/**
 * Per-era post-processing configuration.
 * Downstream effects module reads this map to configure the render pipeline.
 */
export interface EffectsConfig {
  bloom: BloomSettings;
  ao: AoSettings;
  vignette: VignetteSettings;
  noise: NoiseSettings;
  colorGrade: ColorGradeSettings;
}

/** Neutral baseline effects config (no post-processing). */
export const DEFAULT_EFFECTS_CONFIG: EffectsConfig = {
  bloom: { enabled: false, intensity: 0, threshold: 0.8 },
  ao: { enabled: false, intensity: 0, radius: 1 },
  vignette: { enabled: false, darkness: 0 },
  noise: { enabled: false, opacity: 0 },
  colorGrade: { saturation: 1, contrast: 1, brightness: 1, temperature: 0 },
};

/**
 * Effects configuration keyed by era.
 *
 * Tuned per era to reinforce mood:
 * - 1945: warm sepia-ish grade, soft vignette, subtle bloom on period neon.
 * - 1965: balanced saturation, moderate bloom.
 * - 1985: hazy contrast with bloom on neon / backlit signage.
 * - 2005: clean bright grade, moderate bloom on LEDs.
 * - 2025: punchy modern grade with strong bloom on LED/digital media facades
 *   and crisp AO.
 */
export const ERA_EFFECTS_CONFIG: Record<EraId, EffectsConfig> = {
  '1945': {
    bloom: { enabled: true, intensity: 0.35, threshold: 0.65 },
    ao: { enabled: false, intensity: 0, radius: 2 },
    vignette: { enabled: true, darkness: 0.55 },
    noise: { enabled: true, opacity: 0.22 },
    colorGrade: { saturation: 0.35, contrast: 1.12, brightness: 0.92, temperature: 0.3 },
  },
  '1965': {
    bloom: { enabled: true, intensity: 0.7, threshold: 0.7 },
    ao: { enabled: true, intensity: 0.8, radius: 1.6 },
    vignette: { enabled: false, darkness: 0 },
    noise: { enabled: false, opacity: 0 },
    colorGrade: { saturation: 1.05, contrast: 1.0, brightness: 1.0, temperature: 0 },
  },
  '1985': {
    bloom: { enabled: true, intensity: 1.3, threshold: 0.55 },
    ao: { enabled: true, intensity: 1.1, radius: 1.4 },
    vignette: { enabled: true, darkness: 0.32 },
    noise: { enabled: true, opacity: 0.1 },
    colorGrade: { saturation: 1.5, contrast: 1.1, brightness: 0.95, temperature: -0.12 },
  },
  '2005': {
    bloom: { enabled: true, intensity: 0.9, threshold: 0.65 },
    ao: { enabled: true, intensity: 0.9, radius: 1.5 },
    vignette: { enabled: false, darkness: 0 },
    noise: { enabled: false, opacity: 0 },
    colorGrade: { saturation: 1.15, contrast: 1.02, brightness: 1.05, temperature: 0 },
  },
  '2025': {
    bloom: { enabled: true, intensity: 1.6, threshold: 0.5 },
    ao: { enabled: true, intensity: 1.3, radius: 1.2 },
    vignette: { enabled: false, darkness: 0 },
    noise: { enabled: false, opacity: 0 },
    colorGrade: { saturation: 1.3, contrast: 1.15, brightness: 1.1, temperature: 0 },
  },
};

/** Look up the effects config for an era. */
export function getEffectsConfig(era: EraId): EffectsConfig {
  return ERA_EFFECTS_CONFIG[era];
}

/** Linear interpolation helper between two numbers. */
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Blend two effects configs by a 0..1 progress value.
 *
 * Numeric fields are linearly interpolated. Boolean `enabled` flags are OR'd
 * during a transition so an effect that either era wants stays active for the
 * whole morph (avoids popping on/off mid-blend).
 */
export function interpolateEffectsConfig(
  from: EffectsConfig,
  to: EffectsConfig,
  progress: number,
): EffectsConfig {
  const t = Math.min(1, Math.max(0, progress));
  return {
    bloom: {
      enabled: from.bloom.enabled || to.bloom.enabled,
      intensity: lerp(from.bloom.intensity, to.bloom.intensity, t),
      threshold: lerp(from.bloom.threshold, to.bloom.threshold, t),
    },
    ao: {
      enabled: from.ao.enabled || to.ao.enabled,
      intensity: lerp(from.ao.intensity, to.ao.intensity, t),
      radius: lerp(from.ao.radius, to.ao.radius, t),
    },
    vignette: {
      enabled: from.vignette.enabled || to.vignette.enabled,
      darkness: lerp(from.vignette.darkness, to.vignette.darkness, t),
    },
    noise: {
      enabled: from.noise.enabled || to.noise.enabled,
      opacity: lerp(from.noise.opacity, to.noise.opacity, t),
    },
    colorGrade: {
      saturation: lerp(from.colorGrade.saturation, to.colorGrade.saturation, t),
      contrast: lerp(from.colorGrade.contrast, to.colorGrade.contrast, t),
      brightness: lerp(from.colorGrade.brightness, to.colorGrade.brightness, t),
      temperature: lerp(from.colorGrade.temperature, to.colorGrade.temperature, t),
    },
  };
}

/**
 * Resolve a config for the requested quality tier.
 *
 * On `low` quality the heavy ambient-occlusion pass is disabled outright so
 * lower-end devices skip the most expensive effect.
 */
export function applyEffectsQuality(config: EffectsConfig, quality: 'high' | 'low'): EffectsConfig {
  if (quality === 'high') return config;
  return {
    ...config,
    ao: { ...config.ao, enabled: false },
  };
}
