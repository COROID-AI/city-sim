import type { AudioManager, EraId } from '../contracts';
import { DEFAULT_TRANSITION_DURATION_MS, ERA_ORDER } from '../contracts';
import { buildEraBed, createNoiseBuffer, type EraBed } from './synthesis';

/**
 * Web Audio API implementation of the {@link AudioManager} contract.
 *
 * - Lazily creates the {@link AudioContext} on the first user gesture
 *   ({@link unlock}) to respect browser autoplay policies.
 * - Builds each era's ambient bed procedurally (oscillators + noise buffers),
 *   then crossfades beds over the transition duration on era change.
 * - Synthesizes a short time-shift whoosh/sweep for transition SFX.
 * - Exposes master volume and mute, applied to a master gain bus.
 */
export class WebAudioManager implements AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private readonly beds = new Map<EraId, EraBed>();

  private volume = 0.8;
  private muted = false;

  /** Era whose bed is currently audible (crossfade target). */
  private activeEra: EraId | null = null;
  /** Era requested while the context was still locked; started on unlock. */
  private pendingEra: EraId | null = null;

  /**
   * Create/resume the audio context. Must be called from a user gesture to
   * satisfy browser autoplay policies. Safe to call multiple times.
   */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      this.createContext();
    }
    if (this.ctx!.state === 'suspended') {
      await this.ctx!.resume();
    }
    if (this.pendingEra) {
      const era = this.pendingEra;
      this.pendingEra = null;
      this.crossfadeTo(era, DEFAULT_TRANSITION_DURATION_MS);
    }
  }

  /** Create the context and gain routing bus (idempotent). */
  private createContext(): void {
    if (this.ctx) return;

    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.volume;
    master.connect(ctx.destination);

    const ambience = ctx.createGain();
    ambience.gain.value = 1;
    ambience.connect(master);

    const sfx = ctx.createGain();
    sfx.gain.value = 1;
    sfx.connect(master);

    this.ctx = ctx;
    this.masterGain = master;
    this.ambienceGain = ambience;
    this.sfxGain = sfx;
  }

  async loadEraAmbience(era: EraId): Promise<void> {
    if (!this.ctx) return;
    if (this.beds.has(era)) return;

    const bed = buildEraBed(this.ctx, era);
    bed.gain.connect(this.ambienceGain!);
    for (const source of bed.sources) {
      source.start();
    }
    this.beds.set(era, bed);
  }

  stopEraAmbience(era: EraId): void {
    const bed = this.beds.get(era);
    if (!bed) return;
    const t = this.ctx?.currentTime ?? 0;
    bed.gain.gain.cancelScheduledValues(t);
    bed.gain.gain.setValueAtTime(bed.gain.gain.value, t);
    bed.gain.gain.linearRampToValueAtTime(0, t + 0.25);
    bed.stop(t + 0.3);
    this.beds.delete(era);
    if (this.activeEra === era) this.activeEra = null;
  }

  stopAllAmbience(): void {
    for (const era of Array.from(this.beds.keys())) {
      this.stopEraAmbience(era);
    }
  }

  playTransitionSfx(fromEra: EraId, toEra: EraId): void {
    if (!this.ctx || !this.sfxGain) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 1.0;
    // Bias the sweep direction by time travel: forward in time sweeps up,
    // backward sweeps down.
    const forward = ERA_ORDER.indexOf(toEra) > ERA_ORDER.indexOf(fromEra);
    const startFreq = forward ? 300 : 2600;
    const midFreq = forward ? 4200 : 500;
    const endFreq = forward ? 180 : 2600;

    // Whoosh: white noise through a sweeping band-pass filter.
    const src = ctx.createBufferSource();
    src.buffer = createNoiseBuffer(ctx, 'white', 1.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(startFreq, t);
    bp.frequency.exponentialRampToValueAtTime(midFreq, t + dur * 0.5);
    bp.frequency.exponentialRampToValueAtTime(endFreq, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    src.connect(bp).connect(g).connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.1);

    // Pitch-sweeping tone for a "time shift" accent.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(forward ? 200 : 1200, t);
    osc.frequency.exponentialRampToValueAtTime(forward ? 1400 : 250, t + dur * 0.5);
    osc.frequency.exponentialRampToValueAtTime(forward ? 70 : 1400, t + dur);

    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.06, t + 0.1);
    og.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(og).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  /**
   * Crossfade the ambience from the currently active era to `toEra` over the
   * given duration. Extra to the base contract, used by the UI bridge so the
   * fade matches the visual transition length.
   */
  crossfadeTo(toEra: EraId, durationMs: number = DEFAULT_TRANSITION_DURATION_MS): void {
    if (!this.ctx) {
      this.pendingEra = toEra;
      return;
    }
    const ctx = this.ctx;
    void this.loadEraAmbience(toEra).then(() => {
      const t = ctx.currentTime;
      const dur = Math.max(0.05, durationMs / 1000);

      const prev = this.activeEra;
      if (prev && prev !== toEra) {
        const prevBed = this.beds.get(prev);
        if (prevBed) {
          prevBed.gain.gain.cancelScheduledValues(t);
          prevBed.gain.gain.setValueAtTime(prevBed.gain.gain.value, t);
          prevBed.gain.gain.linearRampToValueAtTime(0, t + dur);
        }
      }

      const bed = this.beds.get(toEra);
      if (bed) {
        bed.gain.gain.cancelScheduledValues(t);
        bed.gain.gain.setValueAtTime(0, t);
        bed.gain.gain.linearRampToValueAtTime(1, t + dur);
      }
      this.activeEra = toEra;
    });
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx!.currentTime);
    }
  }

  getVolume(): number {
    return this.volume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : this.volume, this.ctx!.currentTime);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Stop all sources and close the context (best-effort cleanup). */
  dispose(): void {
    this.stopAllAmbience();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.masterGain = null;
      this.ambienceGain = null;
      this.sfxGain = null;
    }
  }
}

/** Process-wide singleton used by the React bridge and UI controls. */
export const audioManager = new WebAudioManager();
