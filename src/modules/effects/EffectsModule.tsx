import { useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector2 } from 'three';
import {
  Bloom,
  BrightnessContrast,
  ChromaticAberration,
  EffectComposer,
  HueSaturation,
  Noise,
  SSAO,
  Vignette,
} from '@react-three/postprocessing';
import { useEraStore } from '../../store/useEraStore';
import { useQualityStore } from '../../store/useQualityStore';
import { EFFECTS_BY_ERA, type EffectsConfig } from '../../contracts';
import { interpolateEffects } from './effectsConfig';
import { Temperature } from './TemperatureEffect';

/**
 * Resolve the active effect config, blending between the source and target
 * era while a transition is in flight. When idle the config snaps to the
 * current era.
 */
function useResolvedEffectsConfig(): EffectsConfig {
  const era = useEraStore((s) => s.currentEra);
  const transitionRequest = useEraStore((s) => s.transitionRequest);

  const [progress, setProgress] = useState(1);
  useFrame(() => {
    if (!transitionRequest) {
      if (progress !== 1) setProgress(1);
      return;
    }
    const elapsed = Date.now() - transitionRequest.requestedAt;
    const next = Math.min(1, elapsed / transitionRequest.durationMs);
    if (next !== progress) setProgress(next);
  });

  return useMemo(() => {
    if (!transitionRequest) return EFFECTS_BY_ERA[era];
    return interpolateEffects(
      EFFECTS_BY_ERA[transitionRequest.fromEra],
      EFFECTS_BY_ERA[transitionRequest.toEra],
      progress,
    );
  }, [era, transitionRequest, progress]);
}

/**
 * Post-processing & effects module.
 *
 * Renders the per-era {@link EffectsConfig} stack (bloom, ambient
 * occlusion, color grading, and vignette) against the current era and
 * blends between configs during transitions. Heavy effects (AO) are gated
 * behind the quality toggle.
 */
export function EffectsModule() {
  const config = useResolvedEffectsConfig();
  const quality = useQualityStore((s) => s.quality);
  const enableAo = quality === 'high' && config.ambientOcclusion.enabled;

  const effects: JSX.Element[] = [];
  // On low quality we skip the expensive multi-pass effects (SSAO, bloom,
  // vignette, chromatic aberration, noise) so the software WebGL renderer can
  // sustain a responsive frame rate. The cheap single-pass color grading
  // (brightness/contrast/saturation/temperature) is still applied per era, so
  // the era-specific post-processing look remains visible.
  const cheap = quality === 'low';
  if (enableAo && !cheap) {
    effects.push(
      <SSAO
        key="ssao"
        radius={config.ambientOcclusion.radius}
        intensity={config.ambientOcclusion.intensity}
        bias={0.025}
        samples={quality === 'high' ? 16 : 8}
        rings={4}
        distanceScaling
        resolutionScale={0.5}
        worldDistanceThreshold={50}
        worldDistanceFalloff={1}
        worldProximityThreshold={0.1}
        worldProximityFalloff={1}
      />,
    );
  }
  if (config.bloom.enabled && !cheap) {
    effects.push(
      <Bloom
        key="bloom"
        intensity={config.bloom.intensity}
        luminanceThreshold={config.bloom.luminanceThreshold}
        luminanceSmoothing={0.9}
        mipmapBlur={quality === 'high'}
        radius={0.8}
      />,
    );
  }
  if (config.vignette.enabled && !cheap) {
    effects.push(
      <Vignette
        key="vignette"
        eskil={false}
        offset={0.3}
        darkness={config.vignette.darkness}
      />,
    );
  }
  if (config.chromaticAberration.enabled && !cheap) {
    effects.push(
      <ChromaticAberration
        key="chromaticAberration"
        offset={
          new Vector2(
            config.chromaticAberration.offset[0],
            config.chromaticAberration.offset[1],
          )
        }
        radialModulation
        modulationOffset={0.15}
      />,
    );
  }
  if (config.noise.enabled && !cheap) {
    effects.push(<Noise key="noise" opacity={config.noise.opacity} />);
  }
  effects.push(
    <BrightnessContrast
      key="brightnessContrast"
      brightness={config.brightness - 1}
      contrast={config.contrast - 1}
    />,
    <HueSaturation key="hueSaturation" saturation={config.saturation - 1} />,
    <Temperature key="temperature" temperature={config.temperature} />,
  );

  return (
    <EffectComposer
      multisampling={quality === 'high' ? 4 : 0}
      resolutionScale={quality === 'high' ? 1 : 0.6}
    >
      {effects}
    </EffectComposer>
  );
}
