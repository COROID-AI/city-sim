import type { EraId } from './era';

/**
 * Contract for the audio manager that later modules implement.
 *
 * The base app ships with a no-op stub so the app runs standalone; a real
 * implementation (Web Audio / Howler) can be swapped in without changing
 * call sites.
 */
export interface AudioManager {
  /** Load (or begin) the ambient loop for a given era. Async by contract. */
  loadEraAmbience(era: EraId): Promise<void>;
  /** Stop any currently playing era ambience. */
  stopEraAmbience(): void;
  /** Play the transition sound effect between two eras. */
  playTransitionSfx(fromEra: EraId, toEra: EraId): void;
  /** Set the master volume in the range 0..1. */
  setVolume(volume: number): void;
  /** Read the current master volume (0..1). */
  getVolume(): number;
  /** Mute all audio. */
  mute(): void;
  /** Unmute all audio. */
  unmute(): void;
  /** Whether audio is currently muted. */
  isMuted(): boolean;
}

/** A no-op AudioManager used until a real implementation exists. */
export const createNoopAudioManager = (): AudioManager => ({
  async loadEraAmbience() {
    /* no-op */
  },
  stopEraAmbience() {
    /* no-op */
  },
  playTransitionSfx() {
    /* no-op */
  },
  setVolume() {
    /* no-op */
  },
  getVolume() {
    return 1;
  },
  mute() {
    /* no-op */
  },
  unmute() {
    /* no-op */
  },
  isMuted() {
    return false;
  },
});
