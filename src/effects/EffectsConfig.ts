import type { EffectsConfig, EffectsConfigByEra } from '../contracts';
import type { EraId } from '../contracts';

/**
 * Per-era post-processing grades.
 *
 * Values are tuned to reinforce each period's mood while staying temporally
 * plausible (no anachronistic grades):
 *  - 1945: warm, slightly desaturated sepia-ish grade with a soft vignette and
 *    subtle bloom on the period's early neon.
 *  - 1965: balanced saturation and a moderate bloom; optimistic mid-century.
 *  - 1985: hazy, higher-contrast grade with strong bloom on neon/backlit signage.
 *  - 2005: clean, bright grade with moderate bloom on early LEDs.
 *  - 2025: punchy, cool modern grade with strong bloom on LED/digital media
 *    facades and crisp ambient occlusion.
 */
export const EFFECTS_CONFIG_BY_ERA: EffectsConfigByEra = {
  1945: {
    bloom: { enabled: true, intensity: 0.35 },
    ambientOcclusion: { enabled: true, intensity: 0.55, radius: 0.5 },
    vignette: { enabled: true, darkness: 0.55 },
    brightness: 0.02,
    contrast: 0.08,
    saturation: -0.25,
    temperature: 0.45,
  },
  1965: {
    bloom: { enabled: true, intensity: 0.6 },
    ambientOcclusion: { enabled: true, intensity: 0.7, radius: 0.6 },
    vignette: { enabled: true, darkness: 0.4 },
    brightness: 0.05,
    contrast: 0.05,
    saturation: 0.05,
    temperature: 0.05,
  },
  1985: {
    bloom: { enabled: true, intensity: 1.1 },
    ambientOcclusion: { enabled: true, intensity: 0.8, radius: 0.7 },
    vignette: { enabled: true, darkness: 0.5 },
    brightness: 0.03,
    contrast: 0.18,
    saturation: 0.25,
    temperature: 0.0,
  },
  2005: {
    bloom: { enabled: true, intensity: 0.7 },
    ambientOcclusion: { enabled: true, intensity: 0.7, radius: 0.6 },
    vignette: { enabled: true, darkness: 0.3 },
    brightness: 0.08,
    contrast: 0.1,
    saturation: 0.0,
    temperature: -0.05,
  },
  2025: {
    bloom: { enabled: true, intensity: 1.3 },
    ambientOcclusion: { enabled: true, intensity: 1.0, radius: 0.8 },
    vignette: { enabled: true, darkness: 0.35 },
    brightness: 0.05,
    contrast: 0.22,
    saturation: 0.2,
    temperature: -0.1,
  },
};

/** Clamp a number into the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Linear interpolation between a and b by t (clamped to 0..1). */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Smoothly blend two era configs by progress (0 = from, 1 = to).
 * Used to cross-fade grades during era transitions.
 */
export function blendEffectsConfig(
  from: EffectsConfig,
  to: EffectsConfig,
  progress: number,
): EffectsConfig {
  const t = clamp(progress, 0, 1);
  return {
    bloom: {
      enabled: t < 0.5 ? from.bloom.enabled : to.bloom.enabled,
      intensity: lerp(from.bloom.intensity, to.bloom.intensity, t),
    },
    ambientOcclusion: {
      enabled: t < 0.5 ? from.ambientOcclusion.enabled : to.ambientOcclusion.enabled,
      intensity: lerp(from.ambientOcclusion.intensity, to.ambientOcclusion.intensity, t),
      radius: lerp(from.ambientOcclusion.radius, to.ambientOcclusion.radius, t),
    },
    vignette: {
      enabled: t < 0.5 ? from.vignette.enabled : to.vignette.enabled,
      darkness: lerp(from.vignette.darkness, to.vignette.darkness, t),
    },
    brightness: lerp(from.brightness, to.brightness, t),
    contrast: lerp(from.contrast, to.contrast, t),
    saturation: lerp(from.saturation, to.saturation, t),
    temperature: lerp(from.temperature, to.temperature, t),
  };
}

/** Get the effects config for a single era. */
export function getEffectsConfig(eraId: EraId): EffectsConfig {
  return EFFECTS_CONFIG_BY_ERA[eraId];
}
