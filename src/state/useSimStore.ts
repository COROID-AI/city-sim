import { create } from 'zustand';
import type { EraId, TransitionContext } from '../contracts';
import { DEFAULT_TRANSITION_DURATION_MS } from '../contracts';

/** The initial era shown when the app boots. */
export const INITIAL_ERA: EraId = '1945';

interface SimState {
  /** The era the scene is currently in (or morphing toward). */
  currentEra: EraId;
  /**
   * The in-flight cross-era transition, or null when idle.
   * Set by {@link requestTransition} and consumed by the renderer stub.
   */
  transition: TransitionContext | null;
  /** Request a morph to `toEra`. No-op when it equals the current era. */
  requestTransition: (toEra: EraId) => void;
  /** Advance the active transition's progress (clamped to [0, 1]). */
  setTransitionProgress: (progress: number) => void;
  /** Clear the active transition, marking the morph complete. */
  completeTransition: () => void;
}

export const useSimStore = create<SimState>((set, get) => ({
  currentEra: INITIAL_ERA,
  transition: null,

  requestTransition: (toEra) => {
    const { currentEra } = get();
    if (toEra === currentEra) return;
    set({
      currentEra: toEra,
      transition: {
        fromEra: currentEra,
        toEra,
        progress: 0,
        durationMs: DEFAULT_TRANSITION_DURATION_MS,
      },
    });
  },

  setTransitionProgress: (progress) => {
    const { transition } = get();
    if (!transition) return;
    const clamped = Math.min(1, Math.max(0, progress));
    set({ transition: { ...transition, progress: clamped } });
  },

  completeTransition: () => set({ transition: null }),
}));
