import type { EraId } from './era';

/**
 * Contract for the audio subsystem.
 *
 * Downstream modules receive an `AudioManager` instance and drive all
 * ambience / SFX / volume through this interface, so the concrete audio
 * implementation can be swapped without touching consumers.
 */
export interface AudioManager {
  /** Load (and optionally start) the ambient loop for an era. */
  loadEraAmbience(era: EraId): Promise<void>;
  /** Stop the ambient loop for a specific era. */
  stopEraAmbience(era: EraId): void;
  /** Stop all currently playing ambience. */
  stopAllAmbience(): void;
  /** Play a short transition sound effect between two eras. */
  playTransitionSfx(fromEra: EraId, toEra: EraId): void;
  /** Set the master volume (0..1). */
  setVolume(volume: number): void;
  /** Get the current master volume (0..1). */
  getVolume(): number;
  /** Mute/unmute all audio. */
  setMuted(muted: boolean): void;
  /** Whether audio is currently muted. */
  isMuted(): boolean;
}
