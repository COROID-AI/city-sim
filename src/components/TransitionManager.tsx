import { createContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EraId, TransitionContext } from '../contracts';
import { ERA_IDS } from '../contracts';
import { useCityStore } from '../store/useCityStore';

/**
 * Default duration of a cross-era morph, in milliseconds.
 *
 * Long enough to read as a deliberate cinematic transform, short enough to
 * stay responsive while the user scrubs the timeline.
 */
export const TRANSITION_DURATION_MS = 900;

/** Ease-in-out cubic so the morph accelerates and settles, not a linear wipe. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * React context exposing the active {@link TransitionContext}.
 *
 * Any consumer (an element layer, an effect, a HUD readout) can read the
 * in-flight morph without coupling to the store. Modules themselves are driven
 * by the `era` prop, so this context is the orchestration channel that the
 * transition manager "drives".
 */
export const EraTransitionContext = createContext<TransitionContext>({
  fromEra: ERA_IDS[0],
  toEra: ERA_IDS[0],
  progress: 1,
  durationMs: TRANSITION_DURATION_MS,
});

interface TransitionState {
  fromEra: EraId;
  toEra: EraId;
  /** True while a morph is in flight. */
  active: boolean;
}

/**
 * Applies a crossfade to every renderable descendant of a layer.
 *
 * - Standard (opaque) materials fade via `transparent` + `opacity`, preserving
 *   each material's authored base opacity (e.g. tinted shop windows).
 * - The procedural sky uses a custom ShaderMaterial with no opacity uniform,
 *   so it is crossfaded by swapping mesh visibility at the midpoint (masked by
 *   the half-blended geometry beneath it).
 * - Lights fade their intensity so lighting mood blends between the eras.
 *
 * `invert` makes the layer fade OUT (opacity 1 -> 0) as progress rises;
 * without it the layer fades IN (0 -> 1).
 */
function CrossfadeLayer({
  progressRef,
  invert = false,
  children,
}: {
  progressRef: { current: number };
  invert?: boolean;
  children: ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) {
      return;
    }
    const raw = invert ? 1 - progressRef.current : progressRef.current;
    const opacity = Math.max(0, Math.min(1, raw));

    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const material of materials) {
          const mat = material as THREE.Material & {
            isShaderMaterial?: boolean;
            transparent?: boolean;
            opacity?: number;
          };
          if (mat.isShaderMaterial) {
            // Sky (or any custom shader): no opacity uniform -> swap at midpoint.
            mesh.visible = invert ? opacity > 0.5 : opacity >= 0.5;
            continue;
          }
          if (mat.userData.baseOpacity === undefined) {
            mat.userData.baseOpacity = mat.opacity ?? 1;
          }
          if (!mat.transparent) {
            mat.transparent = true;
            mat.needsUpdate = true;
          }
          mat.opacity = (mat.userData.baseOpacity as number) * opacity;
        }
        return;
      }
      const light = object as THREE.Light;
      if (light.isLight && typeof light.intensity === 'number') {
        if (light.userData.baseIntensity === undefined) {
          light.userData.baseIntensity = light.intensity;
        }
        light.intensity = (light.userData.baseIntensity as number) * opacity;
      }
    });
  });

  return <group ref={groupRef}>{children}</group>;
}

/**
 * Orchestrates the cross-era morph.
 *
 * Watches the city store for a transition request and drives a
 * {@link TransitionContext} (fromEra, toEra, progress 0..1 over durationMs).
 * While a morph is active it renders BOTH eras' content and crossfades between
 * them, so the scene transforms in front of your eyes rather than popping.
 */
export function TransitionManager({
  children,
}: {
  children: (era: EraId) => ReactNode;
}) {
  const currentEra = useCityStore((s) => s.currentEra);
  const transitionRequest = useCityStore((s) => s.transitionRequest);

  const [state, setState] = useState<TransitionState>({
    fromEra: currentEra,
    toEra: currentEra,
    active: false,
  });
  const progressRef = useRef(1);
  const startRef = useRef(0);

  // Kick off a morph whenever the store requests an era change.
  useEffect(() => {
    if (!transitionRequest) {
      return;
    }
    progressRef.current = 0;
    startRef.current = performance.now();
    setState({
      fromEra: transitionRequest.fromEra,
      toEra: transitionRequest.toEra,
      active: true,
    });
  }, [transitionRequest, setState]);

  // Advance the morph progress each frame while active.
  useFrame(() => {
    if (!state.active) {
      return;
    }
    const elapsed = performance.now() - startRef.current;
    const t = Math.max(0, Math.min(1, elapsed / TRANSITION_DURATION_MS));
    progressRef.current = easeInOutCubic(t);
    if (t >= 1) {
      setState((prev) =>
        prev.active ? { ...prev, active: false, fromEra: prev.toEra } : prev,
      );
    }
  });

  const context: TransitionContext = {
    fromEra: state.fromEra,
    toEra: state.toEra,
    progress: state.active ? progressRef.current : 1,
    durationMs: TRANSITION_DURATION_MS,
  };

  if (!state.active) {
    return (
      <EraTransitionContext.Provider value={context}>
        <group>{children(currentEra)}</group>
      </EraTransitionContext.Provider>
    );
  }

  return (
    <EraTransitionContext.Provider value={context}>
      <CrossfadeLayer progressRef={progressRef} invert>
        {children(state.fromEra)}
      </CrossfadeLayer>
      <CrossfadeLayer progressRef={progressRef}>
        {children(state.toEra)}
      </CrossfadeLayer>
    </EraTransitionContext.Provider>
  );
}