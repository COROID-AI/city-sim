import type { EraId } from './era';

/**
 * Default duration (ms) of a single era-to-era morph.
 * Downstream transition systems use this when no explicit duration is given.
 */
export const DEFAULT_TRANSITION_DURATION_MS = 1200;

/**
 * Snapshot of an in-flight cross-era morph.
 *
 * - `progress` runs from 0 (fully at `fromEra`) to 1 (fully at `toEra`).
 * - `durationMs` is the total planned duration of the morph.
 */
export interface TransitionContext {
  fromEra: EraId;
  toEra: EraId;
  /** 0..1 */
  progress: number;
  /** Total planned duration of the morph in milliseconds. */
  durationMs: number;
}

/** A pending request to morph from one era to another. */
export interface TransitionRequest {
  fromEra: EraId;
  toEra: EraId;
  /** Total planned duration of the morph in milliseconds. */
  durationMs: number;
}

/** Convenience factory for building a transition context. */
export function createTransitionContext(
  fromEra: EraId,
  toEra: EraId,
  progress: number,
  durationMs: number = DEFAULT_TRANSITION_DURATION_MS,
): TransitionContext {
  return { fromEra, toEra, progress, durationMs };
}

/** Clamp a progress value into the valid 0..1 range. */
export function clampProgress(progress: number): number {
  if (Number.isNaN(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}
