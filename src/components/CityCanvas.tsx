import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ERA_REGISTRY } from '../contracts';
import { useEraStore } from '../store/useEraStore';
import { EffectsPipeline } from '../effects/EffectsPipeline';

/** The base city block footprint: a flat, lit slab the city grows on. */
function BlockFootprint() {
  return (
    <mesh position={[0, -0.5, 0]} receiveShadow>
      <boxGeometry args={[10, 1, 10]} />
      <meshStandardMaterial color="#8a8f98" roughness={0.9} metalness={0.1} />
    </mesh>
  );
}

/** Per-era ambient + directional lighting driven by the era registry hints. */
function EraLighting() {
  const currentEra = useEraStore((s) => s.currentEra);
  const descriptor = ERA_REGISTRY[currentEra];

  return (
    <>
      <ambientLight intensity={descriptor.lightingHints.ambientIntensity} />
      <directionalLight
        position={[10, 18, 8]}
        intensity={descriptor.lightingHints.sunIntensity}
        castShadow
      />
    </>
  );
}

/**
 * Placeholder that stubs era switching.
 * For the scaffold this logs the pending transition; the real transition
 * system (authored by a later task) plugs in here.
 */
function EraTransitionStub() {
  const transition = useEraStore((s) => s.transition);

  useEffect(() => {
    if (transition) {
      console.log(
        `[transition] ${transition.fromEra} -> ${transition.toEra} ` +
          `(${transition.durationMs}ms)`,
      );
    }
  }, [transition]);

  return null;
}

/**
 * Base R3F canvas: lighting, the block footprint, a camera, orbit controls,
 * and the per-era post-processing pipeline.
 * Runs standalone so the app is usable before later modules land.
 */
export function CityCanvas() {
  const currentEra = useEraStore((s) => s.currentEra);
  const descriptor = ERA_REGISTRY[currentEra];

  return (
    <Canvas shadows camera={{ position: [14, 12, 14], fov: 50, near: 0.1, far: 200 }}>
      <color attach="background" args={[descriptor.lightingHints.backgroundColor]} />
      <fog attach="fog" args={[descriptor.lightingHints.fogColor, 24, 70]} />
      <EraLighting />
      <BlockFootprint />
      <EffectsPipeline />
      <EraTransitionStub />
      <OrbitControls makeDefault enableDamping />
    </Canvas>
  );
}
