import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useEraStore } from '../store/useEraStore';
import { clampProgress } from '../contracts';

export interface TransitionProgress {
  /**
   * The active transition request, or null when idle.
   * When null the scene is fully at `currentEra`.
   */
  transition: ReturnType<typeof useEraStore.getState>['transition'];
  /** 0..1 progress of the current morph (0 when idle). */
  progress: number;
}

/**
 * Drives era-to-era transitions inside the R3F frame loop.
 *
 * When the era store holds a pending transition this hook advances a 0..1
 * progress value over the requested duration and completes the transition once
 * it reaches 1, so downstream systems (post-processing, lighting) can blend
 * between the source and target era configs while the morph runs.
 */
export function useTransitionProgress(): TransitionProgress {
  const transition = useEraStore((s) => s.transition);
  const completeTransition = useEraStore((s) => s.completeTransition);
  const [progress, setProgress] = useState(0);
  const startRef = useRef<number>(0);

  // Reset the clock whenever a new transition is requested.
  useEffect(() => {
    startRef.current = performance.now();
    setProgress(0);
  }, [transition]);

  useFrame(() => {
    if (!transition) {
      if (progress !== 0) setProgress(0);
      return;
    }
    const elapsed = performance.now() - startRef.current;
    const next = clampProgress(elapsed / transition.durationMs);
    setProgress(next);
    if (next >= 1) {
      completeTransition();
    }
  });

  return { transition, progress };
}
