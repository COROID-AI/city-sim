import { create } from 'zustand';

/** Camera navigation modes offered to the user. */
export type NavMode = 'orbit' | 'fly';

interface NavState {
  /**
   * Current camera navigation mode.
   *
   * - `orbit`: drei OrbitControls — orbit / pan / zoom with mouse + touch.
   * - `fly`  : a custom first-person fly/walk controller driven by keyboard
   *            (WASD / arrows) and drag-to-look.
   */
  mode: NavMode;
  /** Explicitly set the navigation mode. */
  setMode: (mode: NavMode) => void;
  /** Toggle between orbit and fly. */
  toggleMode: () => void;
}

/**
 * UI-facing camera navigation state shared between the header toggle button
 * and the in-canvas {@link CameraRig} so the two always agree.
 */
export const useNavStore = create<NavState>((set, get) => ({
  mode: 'orbit',

  setMode: (mode) => set({ mode }),

  toggleMode: () => set({ mode: get().mode === 'orbit' ? 'fly' : 'orbit' }),
}));
