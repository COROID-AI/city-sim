'use client';

/**
 * TransitionController
 *
 * Headless driver that advances the year-store's `transitionProgress` via a
 * `requestAnimationFrame` loop whenever a transition is in flight. It runs
 * entirely outside React's render cycle — the loop reads/writes store state
 * through Zustand's imperative API (`getState`/`subscribe`), so there are zero
 * React re-renders inside the animation loop.
 *
 * The transition completes after `TRANSITION_DURATION_MS` (1.5s) of wall-clock
 * time, at which point `completeTransition()` snaps `selectedYear` onto
 * `targetYear` and progress settles at 1.
 */
import { useEffect, type FC } from 'react';
import { useYearStore } from '@/store/yearStore';

/** Total duration of a year-to-year cross-fade, in milliseconds. */
export const TRANSITION_DURATION_MS = 1500;

/**
 * Minimum progress delta below which we consider the transition finished even
 * if a frame lands a hair early. Avoids a trailing frame of near-1 progress.
 */
const COMPLETION_THRESHOLD = 0.999;

const TransitionController: FC = () => {
  useEffect(() => {
    let frameId: number | null = null;
    // Wall-clock timestamp (ms) captured when a transition starts. Stored on
    // the store instance via a closure so the loop can compute elapsed time
    // without touching React state.
    let startTime: number | null = null;

    /**
     * The per-frame callback. Computes the eased progress from elapsed time and
     * pushes it into the store. When progress reaches 1 the transition is
     * committed and the loop stops.
     */
    const tick = (now: number) => {
      const state = useYearStore.getState();

      // If the transition was already completed (or never started), stop.
      if (state.transitionProgress >= 1) {
        frameId = null;
        startTime = null;
        return;
      }

      // Lazily capture the start timestamp on the first frame of this run.
      if (startTime === null) {
        startTime = now;
      }

      const elapsed = now - startTime;
      const rawProgress = Math.min(elapsed / TRANSITION_DURATION_MS, 1);

      // Advance the store. `tickTransition` expects a *delta* (the increment
      // since the last frame), so we derive it from the difference between the
      // newly computed progress and the store's current value.
      const delta = rawProgress - state.transitionProgress;
      if (delta > 0) {
        state.tickTransition(delta);
      }

      // Commit once we've crossed the finish line.
      if (rawProgress >= COMPLETION_THRESHOLD) {
        state.completeTransition();
        frameId = null;
        startTime = null;
        return;
      }

      frameId = requestAnimationFrame(tick);
    };

    /**
     * Subscribe to store changes. Whenever `transitionProgress` flips from 1
     * (at rest) to < 1 (a transition just started via `setYear`), kick off the
     * animation loop.
     */
    const unsubscribe = useYearStore.subscribe((current, previous) => {
      const justStarted =
        previous.transitionProgress >= 1 && current.transitionProgress < 1;

      if (justStarted && frameId === null) {
        startTime = null; // reset so the first frame seeds the clock
        frameId = requestAnimationFrame(tick);
      }
    });

    // If a transition is already in flight on mount (e.g. hot reload), start.
    if (useYearStore.getState().transitionProgress < 1 && frameId === null) {
      startTime = null;
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      unsubscribe();
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    };
  }, []);

  // This component renders nothing — it is a pure side-effect driver.
  return null;
};

export default TransitionController;
