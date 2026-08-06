import type { EraId } from './era';

/**
 * Describes an in-flight cross-era morph.
 *
 * All consuming systems (buildings, vehicles, audio, effects) read this to
 * interpolate their state during a transition.
 */
export interface TransitionContext {
  /** Era the scene is morphing away from. */
  fromEra: EraId;
  /** Era the scene is morphing toward. */
  toEra: EraId;
  /** Normalized progress of the morph, 0 (at fromEra) .. 1 (at toEra). */
  progress: number;
  /** Total duration of the morph in milliseconds. */
  durationMs: number;
}
