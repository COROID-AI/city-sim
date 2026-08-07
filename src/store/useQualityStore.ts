import { create } from 'zustand';

/** Render-quality preset. */
export type QualitySetting = 'high' | 'low';

/**
 * Global quality setting shared by every heavy effect. Lowering to `low`
 * disables expensive post-processing (notably screen-space ambient
 * occlusion) so the scene stays responsive on lower-end devices.
 */
export interface QualityStore {
  quality: QualitySetting;
  setQuality: (quality: QualitySetting) => void;
  toggleQuality: () => void;
}

export const useQualityStore = create<QualityStore>((set, get) => ({
  // Default to `high` so the full per-era post-processing stack (bloom,
  // vignette, screen-space ambient occlusion, chromatic aberration) is
  // visible and the scene reads as bright and detailed. `low` remains
  // available via the quality toggle for lower-end devices and software
  // WebGL renderers that cannot sustain the heavy multi-pass effects.
  quality: 'high',
  setQuality: (quality) => set({ quality }),
  toggleQuality: () =>
    set({ quality: get().quality === 'high' ? 'low' : 'high' }),
}));
