import type { EraId } from './era';

/**
 * Describes an in-flight cross-era morph.
 *
 * `progress` is a normalized value in the inclusive range [0, 1]:
 * - 0 => the scene is fully in the `fromEra` state
 * - 1 => the scene is fully in the `toEra` state
 *
 * Downstream modules (buildings, vehicles, storefronts, pedestrians,
 * lighting, audio) read this context each frame to interpolate their
 * per-era properties.
 */
export interface TransitionContext {
  /** Era the scene is morphing away from. */
  fromEra: EraId;
  /** Era the scene is morphing into. */
  toEra: EraId;
  /** Normalized morph progress in [0, 1]. */
  progress: number;
  /** Total intended duration of the morph in milliseconds. */
  durationMs: number;
}

/** Default transition duration used by the sim store when none is given. */
export const DEFAULT_TRANSITION_DURATION_MS = 2000;

/** Clamp a value to the inclusive [0, 1] range used by `progress`. */
export function clampProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}
