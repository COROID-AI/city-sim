import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEraStore } from '../store/useEraStore';
import { useQualityStore } from '../store/useQualityStore';
import { getEraDescriptor, type EraId } from '../contracts';
import { Buildings } from '../modules/buildings';
import { StorefrontsAds } from '../modules/storefronts';
import { StreetEnvironment, SkyDome, STREET_BY_ERA } from '../modules/street';
import type { EraSkyConfig } from '../modules/street';
import { EffectsModule } from '../modules/effects';
import { Vehicles } from './vehicles';
import { Pedestrians } from './pedestrians';
import { TransitionManager, useTransition } from './TransitionManager';
import { CameraControls } from './CameraControls';

/** Props for the composed main scene. */
export interface CitySceneProps {
  /** Called once the WebGL canvas + first frame are ready. */
  onReady?: () => void;
}

/**
 * Main composed scene.
 *
 * Integrates every content module (Buildings, Vehicles, StorefrontsAds,
 * Pedestrians, StreetEnvironment) plus the post-processing EffectsModule and
 * the era transition orchestrator around the shared block footprint. On a
 * timeline change the {@link TransitionManager} drives a TransitionContext and
 * the scene swaps the era-variant geometry while blending the lighting mood,
 * sky, fog, and effects so the change reads as a cinematic morph rather than a
 * jarring pop.
 */

/** Linearly interpolate two hex colors. */
function lerpColor(a: string, b: string, t: number): string {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getStyle();
}

/** Blend two era sky configs by progress t (0..1). */
function interpolateSky(fromEra: EraId, toEra: EraId, t: number): EraSkyConfig {
  const a = STREET_BY_ERA[fromEra].sky;
  const b = STREET_BY_ERA[toEra].sky;
  return {
    topColor: lerpColor(a.topColor, b.topColor, t),
    horizonColor: lerpColor(a.horizonColor, b.horizonColor, t),
    bottomColor: lerpColor(a.bottomColor, b.bottomColor, t),
    haze: a.haze + (b.haze - a.haze) * t,
    sunDirection: a.sunDirection.map(
      (v, i) => v + (b.sunDirection[i] - v) * t,
    ) as [number, number, number],
    sunIntensity: a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t,
    sunColor: lerpColor(a.sunColor, b.sunColor, t),
    ambientIntensity: a.ambientIntensity + (b.ambientIntensity - a.ambientIntensity) * t,
    fogColor: lerpColor(a.fogColor, b.fogColor, t),
    fogDensity: a.fogDensity + (b.fogDensity - a.fogDensity) * t,
  };
}

/** Lighting mood blended between the source and target era. */
function EraLighting({ fromEra, toEra, progress }: { fromEra: EraId; toEra: EraId; progress: number }) {
  const a = getEraDescriptor(fromEra).lighting;
  const b = getEraDescriptor(toEra).lighting;
  const quality = useQualityStore((s) => s.quality);
  const shadowMapSize = quality === 'high' ? 2048 : 1024;
  return (
    <>
      <ambientLight intensity={a.ambientIntensity + (b.ambientIntensity - a.ambientIntensity) * progress} />
      <directionalLight
        position={[8, 12, 6]}
        intensity={a.sunIntensity + (b.sunIntensity - a.sunIntensity) * progress}
        color={lerpColor(a.sunColor, b.sunColor, progress)}
        castShadow={quality === 'high'}
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
      />
    </>
  );
}

/** Atmospheric fog blended between the source and target era. */
function EraFog({ fromEra, toEra, progress }: { fromEra: EraId; toEra: EraId; progress: number }) {
  const sky = interpolateSky(fromEra, toEra, progress);
  return <fogExp2 attach="fog" args={[sky.fogColor, sky.fogDensity]} />;
}

/** All era-variant content modules for a single era. */
function EraContent({ era }: { era: EraId }) {
  return (
    <>
      <Buildings era={era} includeLighting={false} />
      <StorefrontsAds era={era} includeLighting={false} />
      <Vehicles era={era} />
      <Pedestrians era={era} />
    </>
  );
}

/** The composed scene body — swaps content and blends atmosphere on a morph. */
function SceneContent() {
  const era = useEraStore((s) => s.currentEra);
  const transition = useTransition();

  // Idle: render the current era once, with its own sky + lighting.
  if (!transition) {
    const sky = STREET_BY_ERA[era].sky;
    return (
      <>
        <EraLighting fromEra={era} toEra={era} progress={1} />
        <fogExp2 attach="fog" args={[sky.fogColor, sky.fogDensity]} />
        <SkyDome config={sky} />
        <StreetEnvironment era={era} includeLighting={false} />
        <EraContent era={era} />
      </>
    );
  }

  const { fromEra, toEra, progress } = transition;
  return (
    <>
      <EraLighting fromEra={fromEra} toEra={toEra} progress={progress} />
      <EraFog fromEra={fromEra} toEra={toEra} progress={progress} />
      <SkyDome config={interpolateSky(fromEra, toEra, progress)} />

      {/* During a morph we render only the target era's geometry (1×) so the
          transition stays affordable on software WebGL renderers. The sky,
          lighting, fog, and post-processing still blend from the source to the
          target era, so the change still reads as a cinematic morph rather than
          a jarring pop — without doubling the geometry cost. */}
      <StreetEnvironment era={toEra} includeLighting={false} />
      <EraContent era={toEra} />
    </>
  );
}

/** Signals readiness after the first rendered frame. */
function ReadySignal({ onReady }: { onReady?: () => void }) {
  const fired = useRef(false);
  useEffect(() => {
    if (!fired.current) {
      fired.current = true;
      onReady?.();
    }
  }, [onReady]);
  return null;
}

/**
 * Keeps the demand-driven render loop alive only while a cross-era morph is
 * in flight. With `frameloop="demand"` the Canvas renders on mount and on
 * React state changes (era selection), but otherwise stays idle so the main
 * thread remains responsive on software WebGL renderers. During a transition
 * this invalidates every frame so the morph animates smoothly.
 */
function TransitionInvalidator() {
  const invalidate = useThree((s) => s.invalidate);
  const transitionRequest = useEraStore((s) => s.transitionRequest);
  useFrame(() => {
    if (transitionRequest) invalidate();
  });
  return null;
}

export function CityScene({ onReady }: CitySceneProps) {
  const quality = useQualityStore((s) => s.quality);
  return (
    <Canvas
      shadows
      frameloop="demand"
      camera={{ position: [14, 14, 14], fov: 50 }}
      className="city-canvas"
      dpr={quality === 'high' ? [1, 2] : [0.6, 0.6]}
      gl={{ antialias: quality === 'high', powerPreference: 'high-performance' }}
      onCreated={() => onReady?.()}
    >
      <color attach="background" args={['#0b0e14']} />
      <TransitionManager>
        <SceneContent />
      </TransitionManager>
      <EffectsModule />
      <TransitionInvalidator />
      <ReadySignal onReady={onReady} />
      <CameraControls />
    </Canvas>
  );
}
