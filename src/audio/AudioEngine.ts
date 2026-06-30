/**
 * AudioEngine
 *
 * Lightweight Web Audio API sound engine for the time-period city. All sounds
 * are synthesized at runtime — no audio files are shipped — so the bundle
 * stays tiny (well under the 100 KB budget). The engine provides:
 *
 *  - A continuous ambient city drone (low rumble + filtered noise "wind")
 *    whose character shifts subtly per era.
 *  - One-shot SFX: a period-appropriate year-change transition sweep, an
 *    occasional vehicle horn, and pedestrian chatter blips.
 *
 * Autoplay policy compliance: the AudioContext is created lazily and only
 * resumed inside a user-gesture handler (see `unlock()`). Nothing plays until
 * the user interacts with the page.
 */

/** Era-specific ambient tuning parameters. */
interface EraAmbientProfile {
  /** Base frequency of the low drone oscillator (Hz). */
  readonly droneFreq: number;
  /** Cutoff frequency for the filtered noise layer (Hz). */
  readonly noiseCutoff: number;
  /** Gain of the ambient layer for this era (0..1). */
  readonly ambientGain: number;
}

/** Maps each era to a distinct ambient character. */
const ERA_PROFILES: Record<string, EraAmbientProfile> = {
  postwar: { droneFreq: 55, noiseCutoff: 400, ambientGain: 0.12 },
  sixties: { droneFreq: 58, noiseCutoff: 500, ambientGain: 0.13 },
  eighties: { droneFreq: 62, noiseCutoff: 700, ambientGain: 0.14 },
  twothousands: { droneFreq: 66, noiseCutoff: 900, ambientGain: 0.15 },
  present: { droneFreq: 70, noiseCutoff: 1100, ambientGain: 0.16 },
};

/** Default profile used before an era is selected. */
const DEFAULT_PROFILE: EraAmbientProfile = ERA_PROFILES.present;

/**
 * Core audio engine. A single shared instance is exported for app-wide use.
 */
class AudioEngineClass {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Ambient layer nodes
  private ambientGain: GainNode | null = null;
  private droneOsc: OscillatorNode | null = null;
  private droneOsc2: OscillatorNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;

  private ambientStarted = false;
  private muted = false;
  private volume = 0.6;
  private currentEra: string | null = null;

  /**
 * Lazily create the AudioContext. Must be called from within a user
 * gesture to satisfy browser autoplay policies.
 */
  private ensureContext(): AudioContext | null {
    if (this.context) {
      return this.context;
    }
    const Ctor =
      typeof window !== 'undefined'
        ? window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        : undefined;
    if (!Ctor) {
      return null;
    }
    this.context = new Ctor();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = this.muted ? 0 : this.volume;
    this.masterGain.connect(this.context.destination);
    return this.context;
  }

  /**
   * Unlock / resume the audio context. Call from a click, keydown, or other
   * user-gesture handler. Returns true when audio is ready to play.
   */
  unlock(): boolean {
    const ctx = this.ensureContext();
    if (!ctx) {
      return false;
    }
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    return ctx.state === 'running' || ctx.state === 'suspended';
  }

  /** Whether the AudioContext has been created and unlocked. */
  get isUnlocked(): boolean {
    return this.context !== null;
  }

  /** Current mute state. */
  get isMuted(): boolean {
    return this.muted;
  }

  /** Current master volume (0..1). */
  get currentVolume(): number {
    return this.volume;
  }

  /**
   * Set master mute. When unmuting, also ensures the context is live.
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.context) {
      const now = this.context.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(
        muted ? 0 : this.volume,
        now + 0.15,
      );
    }
    if (!muted) {
      this.unlock();
    }
  }

  /**
   * Set the master volume (0..1) with a short ramp to avoid clicks.
   */
  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.volume = clamped;
    if (this.masterGain && this.context && !this.muted) {
      const now = this.context.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(clamped, now + 0.1);
    }
  }

  /**
   * Start the continuous ambient city drone. Safe to call multiple times —
   * it only starts once. The ambient layer respects the current mute/volume.
   */
  startAmbient(era: string): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.ambientStarted) {
      return;
    }
    this.currentEra = era;
    const profile = ERA_PROFILES[era] ?? DEFAULT_PROFILE;

    // Ambient bus gain
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = profile.ambientGain;
    this.ambientGain.connect(this.masterGain);

    // --- Low drone: two detuned sine oscillators ---
    this.droneOsc = ctx.createOscillator();
    this.droneOsc.type = 'sine';
    this.droneOsc.frequency.value = profile.droneFreq;
    this.droneOsc.connect(this.ambientGain);
    this.droneOsc.start();

    this.droneOsc2 = ctx.createOscillator();
    this.droneOsc2.type = 'sine';
    this.droneOsc2.frequency.value = profile.droneFreq * 1.5;
    this.droneOsc2.detune.value = 7;
    this.droneOsc2.connect(this.ambientGain);
    this.droneOsc2.start();

    // --- Filtered noise "wind / traffic" layer ---
    this.noiseSource = ctx.createBufferSource();
    this.noiseSource.buffer = this.createNoiseBuffer(ctx);
    this.noiseSource.loop = true;

    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'lowpass';
    this.noiseFilter.frequency.value = profile.noiseCutoff;
    this.noiseFilter.Q.value = 0.7;

    this.noiseSource.connect(this.noiseFilter);
    this.noiseFilter.connect(this.ambientGain);
    this.noiseSource.start();

    this.ambientStarted = true;
  }

  /**
   * Smoothly transition the ambient character to a new era. Called on year
   * change so the soundscape evolves with the timeline.
   */
  setEra(era: string): void {
    if (!this.context || this.currentEra === era) {
      this.currentEra = era;
      return;
    }
    this.currentEra = era;
    const profile = ERA_PROFILES[era] ?? DEFAULT_PROFILE;
    const now = this.context.currentTime;
    const ramp = 0.6;

    if (this.droneOsc) {
      this.droneOsc.frequency.cancelScheduledValues(now);
      this.droneOsc.frequency.setValueAtTime(
        this.droneOsc.frequency.value,
        now,
      );
      this.droneOsc.frequency.linearRampToValueAtTime(
        profile.droneFreq,
        now + ramp,
      );
    }
    if (this.droneOsc2) {
      this.droneOsc2.frequency.cancelScheduledValues(now);
      this.droneOsc2.frequency.setValueAtTime(
        this.droneOsc2.frequency.value,
        now,
      );
      this.droneOsc2.frequency.linearRampToValueAtTime(
        profile.droneFreq * 1.5,
        now + ramp,
      );
    }
    if (this.noiseFilter) {
      this.noiseFilter.frequency.cancelScheduledValues(now);
      this.noiseFilter.frequency.setValueAtTime(
        this.noiseFilter.frequency.value,
        now,
      );
      this.noiseFilter.frequency.linearRampToValueAtTime(
        profile.noiseCutoff,
        now + ramp,
      );
    }
    if (this.ambientGain) {
      this.ambientGain.gain.cancelScheduledValues(now);
      this.ambientGain.gain.setValueAtTime(this.ambientGain.gain.value, now);
      this.ambientGain.gain.linearRampToValueAtTime(
        profile.ambientGain,
        now + ramp,
      );
    }
  }

  /**
   * Play a short, period-appropriate year-change transition sweep. A rising
   * filtered blip that signals the timeline jump.
   */
  playYearChangeSfx(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.muted) {
      return;
    }
    const now = ctx.currentTime;

    // SFX bus
    const sfxGain = ctx.createGain();
    sfxGain.gain.setValueAtTime(0.0001, now);
    sfxGain.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
    sfxGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    sfxGain.connect(this.masterGain);

    // Rising sine sweep
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.35);
    osc.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.5);

    // Add a soft filtered noise burst for texture
    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(ctx, 0.4);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(800, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(3000, now + 0.3);
    noiseFilter.Q.value = 1.2;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.12, now + 0.03);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.45);
  }

  /**
   * Play a short vehicle horn one-shot. Two quick blips at a horn-like
   * frequency.
   */
  playHorn(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.muted) {
      return;
    }
    const now = ctx.currentTime;
    const hornFreq = 280;

    for (let i = 0; i < 2; i++) {
      const start = now + i * 0.18;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      gain.connect(this.masterGain);

      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hornFreq;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1200;
      osc.connect(filter);
      filter.connect(gain);
      osc.start(start);
      osc.stop(start + 0.16);
    }
  }

  /**
   * Play a short pedestrian chatter blip — a cluster of brief formant-ish
   * tones evoking distant voices.
   */
  playChatter(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.muted) {
      return;
    }
    const now = ctx.currentTime;
    const vowels = [420, 580, 720];

    for (let i = 0; i < 3; i++) {
      const start = now + i * 0.08;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.06, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
      gain.connect(this.masterGain);

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = vowels[i] ?? 500;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = vowels[i] ?? 500;
      filter.Q.value = 4;
      osc.connect(filter);
      filter.connect(gain);
      osc.start(start);
      osc.stop(start + 0.12);
    }
  }

  /**
   * Tear down all audio nodes and release the context. Mainly for tests.
   */
  dispose(): void {
    if (this.droneOsc) {
      try {
        this.droneOsc.stop();
      } catch {
        /* already stopped */
      }
      this.droneOsc = null;
    }
    if (this.droneOsc2) {
      try {
        this.droneOsc2.stop();
      } catch {
        /* already stopped */
      }
      this.droneOsc2 = null;
    }
    if (this.noiseSource) {
      try {
        this.noiseSource.stop();
      } catch {
        /* already stopped */
      }
      this.noiseSource = null;
    }
    this.noiseFilter = null;
    this.ambientGain = null;
    this.masterGain = null;
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
    this.ambientStarted = false;
  }

  /**
   * Create a short white-noise buffer for the ambient and SFX layers.
   * When `duration` is omitted a 2-second loopable buffer is produced.
   */
  private createNoiseBuffer(ctx: AudioContext, duration = 2): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}

/**
 * Shared singleton audio engine instance consumed across the app.
 */
export const AudioEngine = new AudioEngineClass();

export type { AudioEngineClass };
