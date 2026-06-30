/**
 * Audio state store.
 *
 * Zustand store holding the user-facing audio preferences: mute toggle and
 * master volume. The store is the single source of truth for the UI controls
 * and is kept in sync with the AudioEngine by the AudioManager component.
 */
import { create } from 'zustand';

/** Shape of the audio preference state plus mutating actions. */
export interface AudioState {
  /** Whether ambient audio is muted. */
  readonly muted: boolean;
  /** Master volume in the range [0, 1]. */
  readonly volume: number;
  /** Whether the user has interacted (audio unlocked by autoplay policy). */
  readonly unlocked: boolean;
  /** Transient flag set briefly when a year-change SFX fires (for UI pulse). */
  readonly sfxPulse: boolean;

  /** Toggle the mute state. */
  toggleMute: () => void;
  /** Explicitly set the mute state. */
  setMuted: (muted: boolean) => void;
  /** Set the master volume (clamped to [0, 1]). */
  setVolume: (volume: number) => void;
  /** Mark audio as unlocked after the first user gesture. */
  setUnlocked: (unlocked: boolean) => void;
  /** Fire / clear the SFX pulse indicator. */
  setSfxPulse: (pulse: boolean) => void;
}

/**
 * Zustand store creator. Exported for unit tests that need a fresh instance.
 */
export const createAudioStore = () =>
  create<AudioState>((set) => ({
    muted: false,
    volume: 0.6,
    unlocked: false,
    sfxPulse: false,

    toggleMute: () => set((state) => ({ muted: !state.muted })),
    setMuted: (muted) => set({ muted }),
    setVolume: (volume) =>
      set({ volume: Math.max(0, Math.min(1, volume)) }),
    setUnlocked: (unlocked) => set({ unlocked }),
    setSfxPulse: (sfxPulse) => set({ sfxPulse }),
  }));

/**
 * Shared singleton store consumed by React components via `useAudioStore`.
 */
export const useAudioStore = createAudioStore();
