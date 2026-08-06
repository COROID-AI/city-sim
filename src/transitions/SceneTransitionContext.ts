import { createContext, useContext } from 'react';
import { useEraStore } from '../store/useEraStore';
import type { EraId, TransitionContext } from '../contracts';

/** Scene-wide morph state provided to every composed module. */
export interface SceneTransitionValue {
  /**
   * The active morph, or null when the scene is fully at `currentEra`.
   * `fromEra` / `toEra` / `progress` / `durationMs` drive the crossfades.
   */
  transition: TransitionContext | null;
  /** 0..1 morph progress; 1 when idle. */
  progress: number;
}

/** Convenience data for consumers: resolved era pair + progress. */
export interface SceneTransitionData extends SceneTransitionValue {
  /** Era currently committed by the store (the morph target once finished). */
  currentEra: EraId;
  /** Era the scene is morphing away from. */
  fromEra: EraId;
  /** Era the scene is morphing toward. */
  toEra: EraId;
}

export const SceneTransitionContext = createContext<SceneTransitionValue>({
  transition: null,
  progress: 1,
});

/**
 * Read the scene morph state. `fromEra` / `toEra` fall back to `currentEra`
 * when idle so consumers can always resolve a valid single era.
 */
export function useSceneTransition(): SceneTransitionData {
  const { transition, progress } = useContext(SceneTransitionContext);
  const currentEra = useEraStore((s) => s.currentEra);

  return {
    transition,
    progress,
    currentEra,
    fromEra: transition?.fromEra ?? currentEra,
    toEra: transition?.toEra ?? currentEra,
  };
}
