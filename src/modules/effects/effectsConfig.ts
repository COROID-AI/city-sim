import type { EffectsConfig } from '../../contracts';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const pick = (a: boolean, b: boolean, t: number) => (t < 0.5 ? a : b);

/**
 * Linearly interpolate between two per-era effect configs.
 *
 * Continuous numeric fields (intensity, saturation, contrast, ...) blend
 * smoothly, while boolean toggles flip at the midpoint. Used to cross-fade
 * the effect stack during an era transition.
 */
export function interpolateEffects(
  from: EffectsConfig,
  to: EffectsConfig,
  t: number,
): EffectsConfig {
  const k = Math.min(Math.max(t, 0), 1);
  return {
    bloom: {
      enabled: pick(from.bloom.enabled, to.bloom.enabled, k),
      intensity: lerp(from.bloom.intensity, to.bloom.intensity, k),
      luminanceThreshold: lerp(
        from.bloom.luminanceThreshold,
        to.bloom.luminanceThreshold,
        k,
      ),
    },
    vignette: {
      enabled: pick(from.vignette.enabled, to.vignette.enabled, k),
      darkness: lerp(from.vignette.darkness, to.vignette.darkness, k),
    },
    chromaticAberration: {
      enabled: pick(
        from.chromaticAberration.enabled,
        to.chromaticAberration.enabled,
        k,
      ),
      offset: [
        lerp(
          from.chromaticAberration.offset[0],
          to.chromaticAberration.offset[0],
          k,
        ),
        lerp(
          from.chromaticAberration.offset[1],
          to.chromaticAberration.offset[1],
          k,
        ),
      ],
    },
    noise: {
      enabled: pick(from.noise.enabled, to.noise.enabled, k),
      opacity: lerp(from.noise.opacity, to.noise.opacity, k),
    },
    ambientOcclusion: {
      enabled: pick(
        from.ambientOcclusion.enabled,
        to.ambientOcclusion.enabled,
        k,
      ),
      intensity: lerp(
        from.ambientOcclusion.intensity,
        to.ambientOcclusion.intensity,
        k,
      ),
      radius: lerp(from.ambientOcclusion.radius, to.ambientOcclusion.radius, k),
    },
    brightness: lerp(from.brightness, to.brightness, k),
    contrast: lerp(from.contrast, to.contrast, k),
    saturation: lerp(from.saturation, to.saturation, k),
    temperature: lerp(from.temperature, to.temperature, k),
  };
}
