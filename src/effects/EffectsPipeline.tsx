import { useMemo } from 'react';
import {
  EffectComposer,
  Bloom,
  Vignette,
  Noise,
  N8AO,
  wrapEffect,
} from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { applyEffectsQuality, getEffectsConfig, interpolateEffectsConfig } from '../contracts';
import { useEraStore } from '../store/useEraStore';
import { useQualityStore } from '../store/useQualityStore';
import { useTransitionProgress } from '../hooks/useTransitionProgress';
import { ColorGradeEffect } from './ColorGradeEffect';

/** React wrapper exposing the custom color grade as a composable effect. */
const ColorGrade = wrapEffect(ColorGradeEffect);

/**
 * Post-processing pipeline.
 *
 * Composes bloom, ambient occlusion (N8AO), vignette, film grain and a custom
 * color grade, all driven by the per-era `EffectsConfig`. During era
 * transitions the config is interpolated between the source and target era so
 * the grade/bloom/AO blend smoothly. The heavy AO pass is dropped entirely on
 * low quality.
 *
 * Note: `useTransitionProgress` re-renders this component every frame while a
 * transition is active, so the props-driven effect uniforms animate
 * continuously without manual per-frame mutation.
 */
export function EffectsPipeline() {
  const currentEra = useEraStore((s) => s.currentEra);
  const quality = useQualityStore((s) => s.quality);
  const { transition, progress } = useTransitionProgress();

  // Resolve the effective per-era config, blending during transitions.
  const baseConfig = useMemo(() => {
    if (transition) {
      return interpolateEffectsConfig(
        getEffectsConfig(transition.fromEra),
        getEffectsConfig(transition.toEra),
        progress,
      );
    }
    return getEffectsConfig(currentEra);
  }, [transition, progress, currentEra]);

  const config = useMemo(() => applyEffectsQuality(baseConfig, quality), [baseConfig, quality]);

  return (
    <EffectComposer multisampling={quality === 'high' ? 4 : 0}>
      <Bloom
        intensity={config.bloom.enabled ? config.bloom.intensity : 0}
        luminanceThreshold={config.bloom.threshold}
        luminanceSmoothing={0.2}
        mipmapBlur
      />
      <>
        {config.ao.enabled ? (
          <N8AO
            intensity={config.ao.intensity}
            aoRadius={config.ao.radius}
            distanceFalloff={1}
            quality={quality === 'high' ? 'high' : 'low'}
            halfRes={quality === 'low'}
          />
        ) : null}
      </>
      <Vignette
        eskil={false}
        offset={0.3}
        darkness={config.vignette.enabled ? config.vignette.darkness : 0}
      />
      <Noise opacity={config.noise.enabled ? config.noise.opacity : 0} />
      <ColorGrade
        blendFunction={BlendFunction.NORMAL}
        brightness={config.colorGrade.brightness}
        contrast={config.colorGrade.contrast}
        saturation={config.colorGrade.saturation}
        temperature={config.colorGrade.temperature}
      />
    </EffectComposer>
  );
}
