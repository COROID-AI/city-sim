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
  // Default to `low` so the scene stays responsive on lower-end devices and
  // software WebGL renderers (e.g. SwiftShader). `high` remains available via
  // the quality toggle for capable GPUs.
  quality: 'low',
  setQuality: (quality) => set({ quality }),
  toggleQuality: () =>
    set({ quality: get().quality === 'high' ? 'low' : 'high' }),
}));
