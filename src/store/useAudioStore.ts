import { create } from 'zustand';
import { audioManager } from '../audio/WebAudioManager';

interface AudioState {
  /** Master volume (0..1). */
  volume: number;
  /** Whether all audio is muted. */
  muted: boolean;
  /** Set the master volume and mirror it to the audio manager. */
  setVolume: (volume: number) => void;
  /** Mute/unmute and mirror the state to the audio manager. */
  setMuted: (muted: boolean) => void;
  /** Toggle mute. */
  toggleMuted: () => void;
}

/**
 * UI-facing audio state (volume + mute), kept in sync with the shared
 * {@link WebAudioManager} singleton so the controls and the manager never
 * disagree about the current output level.
 */
export const useAudioStore = create<AudioState>((set, get) => ({
  volume: 0.8,
  muted: false,

  setVolume: (volume) => {
    const v = Math.min(1, Math.max(0, volume));
    audioManager.setVolume(v);
    set({ volume: v });
  },

  setMuted: (muted) => {
    audioManager.setMuted(muted);
    set({ muted });
  },

  toggleMuted: () => {
    const muted = !get().muted;
    audioManager.setMuted(muted);
    set({ muted });
  },
}));
