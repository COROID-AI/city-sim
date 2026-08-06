import { useFrame } from '@react-three/fiber';
import {
  BlendFunction,
  Bloom,
  BrightnessContrast,
  EffectComposer,
  Saturation,
  SSAO,
  Vignette,
  wrapEffect,
} from '@react-three/postprocessing';
import { useRef, useState } from 'react';
import type { EffectsConfig } from '../contracts';
import { useCityStore } from '../store/useCityStore';
import { blendEffectsConfig, EFFECTS_CONFIG_BY_ERA } from './EffectsConfig';
import { TemperatureEffect } from './TemperatureEffect';

const Temperature = wrapEffect(TemperatureEffect);

export type EffectsQuality = 'high' | 'low';

export interface EffectsProps {
  /**
   * Quality level. 'low' disables the heavy screen-space ambient occlusion
   * pass for lower-end devices.
   * @default 'high'
   */
  quality?: EffectsQuality;
}

/** Deep-copy a config so the animated state can diverge from the target. */
function cloneConfig(config: EffectsConfig): EffectsConfig {
  return {
    bloom: { ...config.bloom },
    ambientOcclusion: { ...config.ambientOcclusion },
    vignette: { ...config.vignette },
    brightness: config.brightness,
    contrast: config.contrast,
    saturation: config.saturation,
    temperature: config.temperature,
  };
}

/** True when two configs are identical (used to stop animating). */
function configsEqual(a: EffectsConfig, b: EffectsConfig): boolean {
  return (
    a.bloom.enabled === b.bloom.enabled &&
    a.bloom.intensity === b.bloom.intensity &&
    a.ambientOcclusion.enabled === b.ambientOcclusion.enabled &&
    a.ambientOcclusion.intensity === b.ambientOcclusion.intensity &&
    a.ambientOcclusion.radius === b.ambientOcclusion.radius &&
    a.vignette.enabled === b.vignette.enabled &&
    a.vignette.darkness === b.vignette.darkness &&
    a.brightness === b.brightness &&
    a.contrast === b.contrast &&
    a.saturation === b.saturation &&
    a.temperature === b.temperature
  );
}

/**
 * Post-processing / effects pass stack.
 *
 * Self-contained module: reads the current era from the city store and applies
 * the matching per-era grade, smoothly blending values during era transitions.
 * Mount inside a <Canvas> (Phase 4 owns integration into the shared scene).
 */
export function Effects({ quality = 'high' }: EffectsProps) {
  const currentEra = useCityStore((s) => s.currentEra);
  const target = EFFECTS_CONFIG_BY_ERA[currentEra];

  // Animated (lerped) values so grade changes cross-fade instead of snapping.
  const [values, setValues] = useState<EffectsConfig>(() => cloneConfig(target));
  const targetRef = useRef<EffectsConfig>(target);
  targetRef.current = target;

  useFrame((_, delta) => {
    setValues((prev) => {
      const next = blendEffectsConfig(prev, targetRef.current, Math.min(1, delta * 5));
      return configsEqual(prev, next) ? prev : next;
    });
  });

  const highQuality = quality === 'high';
  const useAO = highQuality && values.ambientOcclusion.enabled;

  return (
    <EffectComposer>
      {useAO && (
        <SSAO
          intensity={values.ambientOcclusion.intensity}
          radius={values.ambientOcclusion.radius}
          samples={16}
          rings={4}
          distance={100}
          worldDistanceThreshold={50}
          worldDistanceFalloff={10}
          luminanceInfluence={0.4}
        />
      )}
      {values.bloom.enabled && (
        <Bloom
          intensity={values.bloom.intensity}
          luminanceThreshold={0.7}
          luminanceSmoothing={0.2}
          mipmapBlur
          radius={0.7}
        />
      )}
      <BrightnessContrast brightness={values.brightness} contrast={values.contrast} />
      <Saturation saturation={values.saturation} />
      <Temperature
        blendFunction={BlendFunction.NORMAL}
        temperature={values.temperature}
      />
      {values.vignette.enabled && (
        <Vignette offset={0.3} darkness={values.vignette.darkness} />
      )}
    </EffectComposer>
  );
}
