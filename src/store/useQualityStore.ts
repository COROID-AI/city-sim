import { create } from 'zustand';

/** Quality tier controlling how heavy the post-processing pipeline is. */
export type EffectsQuality = 'high' | 'low';

interface QualityState {
  quality: EffectsQuality;
  setQuality: (quality: EffectsQuality) => void;
  toggleQuality: () => void;
}

/**
 * Global post-processing quality toggle.
 *
 * On `low` the heavy ambient-occlusion pass is disabled so lower-end devices
 * keep a playable framerate.
 */
export const useQualityStore = create<QualityState>((set, get) => ({
  quality: 'high',
  setQuality: (quality) => set({ quality }),
  toggleQuality: () => set({ quality: get().quality === 'high' ? 'low' : 'high' }),
}));
