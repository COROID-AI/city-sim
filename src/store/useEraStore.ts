import { create } from 'zustand';
import type { EraId, TransitionRequest } from '../contracts';
import { DEFAULT_TRANSITION_DURATION_MS } from '../contracts';

interface EraState {
  /** The era currently displayed by the scene. */
  currentEra: EraId;
  /** Pending era transition, or null when idle. */
  transition: TransitionRequest | null;
  /** Directly set the current era (used internally / on transition completion). */
  setEra: (era: EraId) => void;
  /**
   * Request a cross-era transition. If the target equals the current era this
   * is a no-op. Writes the transition request into the store for consumers.
   */
  requestTransition: (toEra: EraId, durationMs?: number) => void;
  /** Mark the active transition complete (moves currentEra to the target). */
  completeTransition: () => void;
}

export const useEraStore = create<EraState>((set, get) => ({
  currentEra: '1945',
  transition: null,

  setEra: (era) => set({ currentEra: era }),

  requestTransition: (toEra, durationMs = DEFAULT_TRANSITION_DURATION_MS) => {
    const { currentEra, transition } = get();
    if (toEra === currentEra) return;
    // Preserve any in-flight transition's origin so we always morph from the
    // last requested source rather than the committed current era.
    const fromEra = transition ? transition.fromEra : currentEra;
    set({ transition: { fromEra, toEra, durationMs } });
  },

  completeTransition: () => {
    const { transition } = get();
    if (!transition) return;
    set({ currentEra: transition.toEra, transition: null });
  },
}));
