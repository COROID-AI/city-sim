import { create } from 'zustand';

/** Camera navigation modes. */
export type CameraMode = 'orbit' | 'fly';

interface CameraState {
  /** Active camera mode: orbit/look (default) or free fly. */
  mode: CameraMode;
  setMode: (mode: CameraMode) => void;
  toggleMode: () => void;
}

/**
 * Global camera-mode store shared by the in-canvas {@link CameraRig} and the
 * header toggle button so both stay in sync.
 */
export const useCameraStore = create<CameraState>((set, get) => ({
  mode: 'orbit',
  setMode: (mode) => set({ mode }),
  toggleMode: () => set({ mode: get().mode === 'orbit' ? 'fly' : 'orbit' }),
}));
