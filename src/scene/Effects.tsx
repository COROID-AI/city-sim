import { useMemo } from 'react';
import { EffectComposer, Bloom, Vignette, Noise } from '@react-three/postprocessing';
import { useSceneStore } from '../state/useSceneStore';

/**
 * Postprocessing stack. Bloom intensity ramps with nightfall and neon eras.
 * We rely on @react-three/postprocessing's declarative ownership (no direct
 * WebGLRenderer).
 */
export function Effects() {
  const bloomIntensity = useSceneStore((s) => s.current.neon);
  const dayTime = useSceneStore((s) => s.dayTime);

  const nightFactor = useMemo(() => {
    const sun = (dayTime - 0.5) * Math.PI * 2;
    return 1 - Math.max(0, Math.sin(sun));
  }, [dayTime]);

  const bloom = 0.35 + nightFactor * (0.25 + bloomIntensity * 0.7);
  const luminanceThreshold = 0.75 + (1 - nightFactor) * 0.18;

  return (
    <EffectComposer multisampling={4}>
      <Bloom
        intensity={bloom}
        luminanceThreshold={luminanceThreshold}
        luminanceSmoothing={0.24}
        mipmapBlur
        radius={0.72}
      />
      <Noise opacity={0.015 + nightFactor * 0.03} />
      <Vignette eskil={false} offset={0.22} darkness={0.62} />
    </EffectComposer>
  );
}