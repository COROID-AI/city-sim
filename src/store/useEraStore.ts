import { create } from 'zustand';
import type { EraId } from '../contracts';
import { ERA_IDS } from '../contracts';

/** Default duration of a cross-era transition in milliseconds. */
export const DEFAULT_TRANSITION_DURATION_MS = 150;

/** A request to morph the scene from one era to another. */
export interface TransitionRequest {
  fromEra: EraId;
  toEra: EraId;
  durationMs: number;
  /** Epoch ms when the transition was requested. */
  requestedAt: number;
}

/**
 * Global era state shared by the timeline slider, the 3D scene, and any
 * downstream module (audio, effects, buildings, vehicles, ...).
 */
export interface EraStore {
  /** The currently selected era. */
  currentEra: EraId;
  /** The latest transition request, or null when idle. */
  transitionRequest: TransitionRequest | null;
  /** Set the current era directly (no transition bookkeeping). */
  setEra: (era: EraId) => void;
  /**
   * Select a new era and record a transition request. No-ops when the
   * target era is already current.
   */
  requestTransition: (toEra: EraId, durationMs?: number) => void;
  /** Clear the pending transition request (morph finished / consumed). */
  clearTransition: () => void;
}

export const useEraStore = create<EraStore>((set, get) => ({
  currentEra: ERA_IDS[0],
  transitionRequest: null,

  setEra: (era) => set({ currentEra: era }),

  requestTransition: (toEra, durationMs = DEFAULT_TRANSITION_DURATION_MS) => {
    const { currentEra } = get();
    if (currentEra === toEra) return;

    set({
      currentEra: toEra,
      transitionRequest: {
        fromEra: currentEra,
        toEra,
        durationMs,
        requestedAt: Date.now(),
      },
    });
  },

  clearTransition: () => set({ transitionRequest: null }),
}));
