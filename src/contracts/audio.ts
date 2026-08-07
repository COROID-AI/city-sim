import type { EraId } from './era';

/**
 * Contract for the audio subsystem.
 *
 * Downstream audio modules implement this interface; the rest of the app
 * depends only on this abstraction so era ambience and transition SFX can be
 * swapped or mocked freely.
 */
export interface AudioManager {
  /**
   * Begin playing ambient audio for an era. Implementations should load and
   * start the era's ambience (idempotent for the current era).
   */
  loadEraAmbience(era: EraId): Promise<void> | void;

  /** Stop and unload the ambience for an era. */
  stopEraAmbience(era: EraId): void;

  /** Play a short sound effect to accompany a cross-era transition. */
  playTransitionSfx(fromEra: EraId, toEra: EraId): void;

  /** Set the master volume in [0, 1]. */
  setVolume(volume: number): void;

  /** Mute (true) or unmute (false) all audio. */
  setMuted(muted: boolean): void;

  /** Current master volume in [0, 1]. */
  readonly volume: number;

  /** Whether all audio is currently muted. */
  readonly muted: boolean;
}
