import { create } from 'zustand';

/** Camera control mode. */
export type CameraMode = 'orbit' | 'fly';

/**
 * Global camera-control mode shared by the scene.
 *
 * - `orbit` — free orbit / look / zoom around the city (mouse drag, touch
 *   drag, scroll wheel, plus keyboard via OrbitControls).
 * - `fly` — first-person fly-through (WASD move, Q/E descend/ascend, Shift
 *   boost, mouse/touch drag to look).
 */
export interface CameraStore {
  mode: CameraMode;
  setMode: (mode: CameraMode) => void;
  toggleMode: () => void;
}

export const useCameraStore = create<CameraStore>((set, get) => ({
  mode: 'orbit',
  setMode: (mode) => set({ mode }),
  toggleMode: () =>
    set({ mode: get().mode === 'orbit' ? 'fly' : 'orbit' }),
}));
