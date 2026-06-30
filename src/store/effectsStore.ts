/**
 * Visual effects state store.
 *
 * Zustand store holding the user-facing effects preferences: particle toggle
 * and bloom toggle. Both default to enabled but can be disabled for
 * performance on lower-end devices.
 */
import { create } from 'zustand';

/** Shape of the effects preference state plus mutating actions. */
export interface EffectsState {
  /** Whether particle systems are enabled. */
  readonly particlesEnabled: boolean;
  /** Whether bloom post-processing is enabled. */
  readonly bloomEnabled: boolean;

  /** Toggle particle systems on/off. */
  toggleParticles: () => void;
  /** Toggle bloom post-processing on/off. */
  toggleBloom: () => void;
  /** Explicitly set particle state. */
  setParticlesEnabled: (enabled: boolean) => void;
  /** Explicitly set bloom state. */
  setBloomEnabled: (enabled: boolean) => void;
}

/**
 * Zustand store creator. Exported for unit tests that need a fresh instance.
 */
export const createEffectsStore = () =>
  create<EffectsState>((set) => ({
    particlesEnabled: true,
    bloomEnabled: true,

    toggleParticles: () => set((state) => ({ particlesEnabled: !state.particlesEnabled })),
    toggleBloom: () => set((state) => ({ bloomEnabled: !state.bloomEnabled })),
    setParticlesEnabled: (enabled) => set({ particlesEnabled: enabled }),
    setBloomEnabled: (enabled) => set({ bloomEnabled: enabled }),
  }));

/**
 * Shared singleton store consumed by React components via `useEffectsStore`.
 */
export const useEffectsStore = createEffectsStore();
