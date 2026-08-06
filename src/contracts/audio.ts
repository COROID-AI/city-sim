import type { EraId } from './era';

/**
 * Audio management contract.
 *
 * Later tasks provide a concrete Web Audio implementation; the rest of the
 * app only depends on this interface.
 */
export interface AudioManager {
  /** Load (and start) the ambient soundscape for the given era. */
  loadEraAmbience(eraId: EraId): Promise<void>;
  /** Stop any currently playing era ambience. */
  stopEraAmbience(): void;
  /** Play the transition / whoosh SFX for a from->to era change. */
  playTransitionSfx(fromEra: EraId, toEra: EraId): void;
  /** Set the master volume in the range 0..1. */
  setVolume(volume: number): void;
  /** Mute/unmute all audio. */
  setMuted(muted: boolean): void;
}
