'use client';

/**
 * Bloom post-processing effect.
 *
 * Wraps `@react-three/postprocessing`'s `EffectComposer` + `Bloom` to add a
 * glow around emissive surfaces (neon signs, vehicle lights, holograms).
 * Bloom intensity varies per era — strongest for the neon-soaked 1980s,
 * subtle for the steam-era 1940s.
 *
 * The effect can be toggled off via the effects store for performance.
 */
import { useMemo, type FC } from 'react';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { useYearStore } from '@/store/yearStore';
import { useEffectsStore } from '@/store/effectsStore';
import { getBloomIntensity } from '@/config/particleConfig';

const BloomEffect: FC = () => {
  const bloomEnabled = useEffectsStore((s) => s.bloomEnabled);
  const selectedYear = useYearStore((s) => s.selectedYear);

  const intensity = useMemo(
    () => getBloomIntensity(selectedYear),
    [selectedYear],
  );

  if (!bloomEnabled) return null;

  return (
    <EffectComposer data-testid="bloom-composer">
      <Bloom
        intensity={intensity}
        luminanceThreshold={0.4}
        luminanceSmoothing={0.9}
        mipmapBlur
      />
    </EffectComposer>
  );
};

export default BloomEffect;
