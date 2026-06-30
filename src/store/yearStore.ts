/**
 * Year state store.
 *
 * Single source of truth for the active time period and the cross-fade
 * transition animation that plays when the user switches eras. Built with
 * Zustand so it can be consumed via the `useStore` hook inside React Three
 * Fiber without provoking re-render storms.
 */
import { create } from 'zustand';
import {
  DEFAULT_ERA,
  getYearConfig,
  getNextYearConfig,
  type EraId,
  type YearConfig,
} from '@/config/years';

/**
 * Shape of the year/transition state plus the actions that mutate it.
 */
export interface YearState {
  /** Era currently rendered (the "settled" period). */
  readonly selectedYear: EraId;
  /** Era the city is transitioning towards; equals `selectedYear` at rest. */
  readonly targetYear: EraId;
  /** Transition progress in the range [0, 1]; 0 means just started. */
  readonly transitionProgress: number;

  /**
   * Begin a transition to a new era. Updates `targetYear` and resets progress
   * to 0. Calling with the current `selectedYear` is a no-op (avoids spurious
   * transitions) unless a transition is already in flight toward a different
   * target, in which case it retargets.
   */
  setYear: (year: EraId) => void;
  /** Advance the transition progress by `delta` (clamped to [0, 1]). */
  tickTransition: (delta: number) => void;
 /**
   * Commit the transition: copies `targetYear` into `selectedYear` and snaps
   * progress to 1. Called by the animation loop once progress reaches 1.
   */
  completeTransition: () => void;
}

/**
 * Zustand store creator. Exported for unit tests that need a fresh instance.
 */
export const createYearStore = () =>
  create<YearState>((set, get) => ({
    selectedYear: DEFAULT_ERA,
    targetYear: DEFAULT_ERA,
    transitionProgress: 1,

    setYear: (year) => {
      const { selectedYear, targetYear } = get();
      // No-op when already at rest on the requested era.
      if (selectedYear === year && targetYear === year) {
        return;
      }
      set({ targetYear: year, transitionProgress: 0 });
    },

    tickTransition: (delta) =>
      set((state) => ({
        transitionProgress: clamp01(state.transitionProgress + delta),
      })),

    completeTransition: () =>
      set((state) => ({
        selectedYear: state.targetYear,
        transitionProgress: 1,
      })),
  }));

/**
 * Shared singleton store instance consumed by React components via
 * `useYearStore`. Using a single instance keeps state coherent across the
 * whole R3F tree.
 */
export const useYearStore = createYearStore();

/* -------------------------------------------------------------------------- */
/* Selectors                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Selector returning the config for the currently settled era, or `undefined`
 * if the era id is somehow unknown.
 */
export const selectCurrentYearConfig = (
  state: YearState,
): YearConfig | undefined => getYearConfig(state.selectedYear);

/**
 * Selector returning the config for the era being transitioned towards. While
 * at rest this equals the current config.
 */
export const selectNextYearConfig = (
  state: YearState,
): YearConfig | undefined => getYearConfig(state.targetYear);

/**
 * Selector returning the chronologically-next config after the target era.
 * Useful for UI affordances that preview the upcoming period.
 */
export const selectUpcomingYearConfig = (
  state: YearState,
): YearConfig | undefined => getNextYearConfig(state.targetYear);

/**
 * Selector returning `true` while a transition is in progress (progress in the
 * half-open range [0, 1)).
 */
export const selectIsTransitioning = (state: YearState): boolean =>
  state.transitionProgress < 1;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Clamp a number into the inclusive [0, 1] range. */
function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
