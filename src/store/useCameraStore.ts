import { create } from 'zustand';

/** The two camera navigation modes. */
export type CameraMode = 'orbit' | 'fly';

/**
 * Shared camera-navigation state. Persisted here (rather than local React
 * state) so it can be read both by the HUD buttons rendered outside the
 * Canvas and by the in-scene {@link CameraControls} rig.
 */
export interface CameraStore {
  /** Current navigation mode. */
  mode: CameraMode;
  /** Switch to a specific mode. */
  setMode: (mode: CameraMode) => void;
  /** Toggle between orbit and fly mode. */
  toggleMode: () => void;
  /** Monotonic counter bumped when the user asks to reset the view. */
  resetSignal: number;
  /** Request a camera reset to the default framing. */
  requestReset: () => void;
}

export const useCameraStore = create<CameraStore>((set, get) => ({
  mode: 'orbit',
  setMode: (mode) => set({ mode }),
  toggleMode: () => set({ mode: get().mode === 'orbit' ? 'fly' : 'orbit' }),
  resetSignal: 0,
  requestReset: () => set((s) => ({ resetSignal: s.resetSignal + 1 })),
}));
