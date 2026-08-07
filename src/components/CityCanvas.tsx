import { Canvas } from '@react-three/fiber';
import { ERA_REGISTRY } from '../contracts';
import { CameraRig } from './CameraRig';
import { Buildings } from '../buildings';
import { Vehicles } from '../vehicles';
import { StorefrontsAds } from '../storefronts';
import { Pedestrians } from '../pedestrians';
import { EffectsPipeline } from '../effects/EffectsPipeline';
import { TransitionManager } from '../transitions/TransitionManager';
import { useSceneTransition } from '../transitions/SceneTransitionContext';
import { EraCrossfade } from '../transitions/EraCrossfade';
import { BlendedStreetEnvironment } from '../transitions/BlendedStreetEnvironment';
import { lerpColor } from '../transitions/blend';

/** The base city block footprint: a flat, lit slab the city grows on. */
function BlockFootprint() {
  return (
    <mesh position={[0, -0.5, 0]} receiveShadow>
      <boxGeometry args={[10, 1, 10]} />
      <meshStandardMaterial color="#8a8f98" roughness={0.9} metalness={0.1} />
    </mesh>
  );
}

/**
 * Canvas-level background + fog colors blended between the source and target
 * era so the whole frame transforms during a morph.
 */
function SceneAtmosphere() {
  const { fromEra, toEra, progress } = useSceneTransition();
  const fromHints = ERA_REGISTRY[fromEra].lightingHints;
  const toHints = ERA_REGISTRY[toEra].lightingHints;

  return (
    <>
      <color
        attach="background"
        args={[lerpColor(fromHints.backgroundColor, toHints.backgroundColor, progress)]}
      />
      <fog
        attach="fog"
        args={[lerpColor(fromHints.fogColor, toHints.fogColor, progress), 24, 70]}
      />
    </>
  );
}

/**
 * All content modules composed around the block footprint. Each era-variant
 * layer is crossfaded between the outgoing and incoming eras, so selecting a
 * new era morphs buildings, vehicles, storefronts/ads and the crowd in front
 * of your eyes while the street/environment blends continuously.
 */
function SceneComposition() {
  const { transition, progress, fromEra, toEra } = useSceneTransition();

  return (
    <>
      <BlockFootprint />
      <BlendedStreetEnvironment />
      <EraCrossfade
        progress={progress}
        from={transition ? <Buildings era={fromEra} /> : null}
        to={<Buildings era={toEra} />}
      />
      <EraCrossfade
        progress={progress}
        from={transition ? <Vehicles era={fromEra} /> : null}
        to={<Vehicles era={toEra} />}
      />
      <EraCrossfade
        progress={progress}
        from={transition ? <StorefrontsAds era={fromEra} /> : null}
        to={<StorefrontsAds era={toEra} />}
      />
      <EraCrossfade
        progress={progress}
        from={transition ? <Pedestrians era={fromEra} /> : null}
        to={<Pedestrians era={toEra} />}
      />
    </>
  );
}

export interface CityCanvasProps {
  /**
   * Fired once the canvas has initialized and painted its first frame, used
   * by the app to dismiss the loading state.
   */
  onReady?: () => void;
}

/**
 * The main R3F scene: all content and system modules composed around the
 * block footprint, orchestrated by the transition manager so every era change
 * morphs the whole city in front of your eyes.
 */
export function CityCanvas({ onReady }: CityCanvasProps) {
  return (
    <Canvas
      shadows
      camera={{ position: [14, 12, 14], fov: 50, near: 0.1, far: 200 }}
      onCreated={() => {
        requestAnimationFrame(() => onReady?.());
      }}
    >
      <TransitionManager>
        <SceneAtmosphere />
        <SceneComposition />
        <EffectsPipeline />
        <CameraRig />
      </TransitionManager>
    </Canvas>
  );
}
