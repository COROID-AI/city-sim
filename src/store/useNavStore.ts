import { create } from 'zustand';

/** Camera navigation modes. */
export type NavMode = 'orbit' | 'fly';

interface NavState {
  /** Current camera navigation mode. */
  mode: NavMode;
  /** Switch the active camera navigation mode. */
  setMode: (mode: NavMode) => void;
}

/**
 * Shared navigation state so UI (outside the Canvas) and the camera rig
 * (inside the Canvas) agree on the active mode without prop drilling.
 */
export const useNavStore = create<NavState>((set) => ({
  mode: 'orbit',
  setMode: (mode) => set({ mode }),
}));
