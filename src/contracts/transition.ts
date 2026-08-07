import type { EraId } from './era';

/**
 * Describes an in-flight (or requested) cross-era morph.
 *
 * `progress` is normalized 0..1 where 0 means the morph has not started
 * (still fully `fromEra`) and 1 means it has completed (fully `toEra`).
 */
export interface TransitionContext {
  /** The era being morphed away from. */
  fromEra: EraId;
  /** The era being morphed toward. */
  toEra: EraId;
  /** Normalized progress in the range 0..1. */
  progress: number;
  /** Total intended duration of the morph in milliseconds. */
  durationMs: number;
}

/** Build a fresh transition context at the start of a morph. */
export function createTransitionContext(
  fromEra: EraId,
  toEra: EraId,
  durationMs: number,
): TransitionContext {
  return { fromEra, toEra, progress: 0, durationMs };
}
