import { create } from 'zustand';
import type { EraId } from '../contracts/era';
import { ERA_IDS } from '../contracts/era';

/** A requested (not yet consumed) era change. */
export interface TransitionRequest {
  fromEra: EraId;
  toEra: EraId;
  requestedAt: number;
}

interface CityState {
  /** The era currently selected on the timeline. */
  currentEra: EraId;
  /** The most recent transition request, or null when none is pending. */
  transitionRequest: TransitionRequest | null;
  /** Directly set the current era (no transition request). */
  setEra: (era: EraId) => void;
  /** Request a transition to the given era, recording the from->to pair. */
  requestTransition: (toEra: EraId) => void;
  /** Consume the pending transition request. */
  clearTransition: () => void;
}

export const useCityStore = create<CityState>((set, get) => ({
  currentEra: ERA_IDS[0],
  transitionRequest: null,
  setEra: (era) => set({ currentEra: era }),
  requestTransition: (toEra) => {
    const { currentEra } = get();
    if (toEra === currentEra) {
      return;
    }
    set({
      currentEra: toEra,
      transitionRequest: { fromEra: currentEra, toEra, requestedAt: Date.now() },
    });
  },
  clearTransition: () => set({ transitionRequest: null }),
}));
