import type { AudioManager, EraId } from '../contracts';
import { buildEraAmbience } from './ambience';
import { playTransitionSfx } from './transitionSfx';

/** Options for constructing a {@link WebAudioManager}. */
export interface WebAudioManagerOptions {
  /** Crossfade duration between ambient beds, in seconds. */
  crossfadeDuration?: number;
}

/**
 * A Web Audio API implementation of the {@link AudioManager} contract.
 *
 * - Builds per-era ambient beds procedurally (oscillators/noise/buffers).
 * - Crossfades between beds when the era changes.
 * - Plays a synthesized transition whoosh/sweep on era change.
 * - Respects browser autoplay policies: the context is only created/resumed
 *   from a user gesture via {@link unlock}.
 */
export class WebAudioManager implements AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private currentBedGain: GainNode | null = null;
  private readonly crossfadeDuration: number;
  private volume = 1;
  private muted = false;

  constructor(options: WebAudioManagerOptions = {}) {
    this.crossfadeDuration = options.crossfadeDuration ?? 1.2;
  }

  /**
   * Lazily create (and resume) the AudioContext. Safe to call from a user
   * gesture. Returns null when audio is unavailable (e.g. no DOM).
   */
  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Unlock audio from a user gesture (autoplay policy). Safe and idempotent.
   * Also (re)loads the current era's ambience once the context is live.
   */
  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume();
    }
  }

  async loadEraAmbience(era: EraId): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const newBed = buildEraAmbience(ctx, era);
    newBed.connect(this.masterGain);
    const now = ctx.currentTime;

    // Fade the new bed in.
    newBed.gain.setValueAtTime(0, now);
    newBed.gain.linearRampToValueAtTime(1, now + this.crossfadeDuration);

    // Fade the previous bed out, then disconnect it.
    const oldBed = this.currentBedGain;
    if (oldBed && oldBed !== newBed) {
      oldBed.gain.cancelScheduledValues(now);
      oldBed.gain.setValueAtTime(oldBed.gain.value, now);
      oldBed.gain.linearRampToValueAtTime(0, now + this.crossfadeDuration);
      window.setTimeout(
        () => {
          try {
            oldBed.disconnect();
          } catch {
            /* already disconnected */
          }
        },
        (this.crossfadeDuration + 0.1) * 1000,
      );
    }

    this.currentBedGain = newBed;
  }

  stopEraAmbience(): void {
    const ctx = this.ctx;
    const bed = this.currentBedGain;
    if (!ctx || !bed) return;
    const now = ctx.currentTime;
    bed.gain.cancelScheduledValues(now);
    bed.gain.setValueAtTime(bed.gain.value, now);
    bed.gain.linearRampToValueAtTime(0, now + 0.3);
    const toDisconnect = bed;
    window.setTimeout(() => {
      try {
        toDisconnect.disconnect();
      } catch {
        /* already disconnected */
      }
    }, 400);
    this.currentBedGain = null;
  }

  playTransitionSfx(fromEra: EraId, toEra: EraId): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    playTransitionSfx(
      ctx,
      fromEra,
      toEra,
      this.masterGain,
      this.muted ? 0 : this.volume,
    );
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.02,
      );
    }
  }

  getVolume(): number {
    return this.volume;
  }

  mute(): void {
    this.muted = true;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    }
  }

  unmute(): void {
    this.muted = false;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.volume,
        this.ctx.currentTime,
        0.02,
      );
    }
  }

  isMuted(): boolean {
    return this.muted;
  }
}

/** Create a new Web Audio manager instance. */
export function createWebAudioManager(
  options?: WebAudioManagerOptions,
): WebAudioManager {
  return new WebAudioManager(options);
}
