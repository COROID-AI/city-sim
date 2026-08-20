import type { EraSoundscape } from '../state/types';

/**
 * Procedural era soundscapes.
 *
 * Every era is synthesized with Web Audio primitives — no external assets.
 * Each soundscape is built from carefully-staged layers so the combined
 * output stays well below 0 dBFS (finding: thin/clipping audio):
 *   - wind wash (filtered noise)
 *   - tonal pad (two detuned oscillators + slow LFO)
 *   - traffic / crowd busyness (filtered noise + sub pulses)
 *   - era-specific detail (birds, hum, sweeps, weather)
 */

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private subMaster: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private currentEra = '';
  private started = false;
  private disposed = false;
  private volume = 0.8;

  /** Nodes currently producing sound for the active soundscape layer. */
  private activeSources = new Set<AudioScheduledSourceNode>();
  /** Cleanup timers for scheduled layer source stops (dropped on scene swap). */
  private sourceTimers = new Set<ReturnType<typeof setTimeout>>();

  /** Callback fired when the audio system is ready (after first gesture). */
  onReady: (() => void) | null = null;

  get isReady(): boolean {
    return !!this.ctx && this.started;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Initialize / resume on the first user gesture (autoplay policy). */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      if (!this.started) this.startGraph();
      return;
    }
    if (this.disposed) return;
    if (typeof window === 'undefined') return;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.startGraph();
  }

  private startGraph(): void {
    if (!this.ctx || this.started) return;
    const ctx = this.ctx;
    // Master chain with hard safety ceiling.
    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.12;
    this.master.connect(compressor).connect(ctx.destination);
    this.master.gain.setTargetAtTime(0.5, ctx.currentTime, 0.2);
    this.subMaster = ctx.createGain();
    this.subMaster.gain.value = 1;
    this.subMaster.connect(this.master);
    this.started = true;
    if (this.onReady) this.onReady();
  }

  /** Apply the era soundscape to the running graph. */
  setEra(era: EraSoundscape): void {
    if (!this.ctx || !this.started || !this.subMaster) return;
    if (era.tag === this.currentEra && this.currentEra !== '') return;
    this.currentEra = era.tag;
    this.applyScene(era);
  }

  /** Master mute without tearing down the graph. */
  setMuted(muted: boolean): void {
    if (!this.master) return;
    const t = this.ctx?.currentTime ?? 0;
    this.master.gain.setTargetAtTime(muted ? 0 : this.volume, t, 0.05);
  }

  /** Master volume in [0,1]. */
  setVolume(volume: number, muted: boolean): void {
    if (!this.master) return;
    const t = this.ctx?.currentTime ?? 0;
    this.volume = volume;
    this.master.gain.setTargetAtTime(muted ? 0 : volume, t, 0.05);
  }

  /** Short UI tick for slider interaction. */
  playTick(): void {
    if (!this.ctx || !this.started || !this.master) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 660;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
    g.connect(this.master);
    osc.connect(g);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.1);
  }

  /** Short swell used when the era changes. */
  playEraTransition(): void {
    if (!this.ctx || !this.started || !this.subMaster) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 180;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.1);
    g.connect(this.subMaster);
    osc.connect(g);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 1.2);
  }

  /** Tear down every node and mark disposed. */
  dispose(): void {
    this.disposed = true;
    this.clearBirdTimers();
    this.stopAllSources();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.master = null;
    this.subMaster = null;
  }

  /* ------------------------------------------------------------------ */
  /* Soundscape synthesis                                                */
  /* ------------------------------------------------------------------ */

  private applyScene(era: EraSoundscape): void {
    if (!this.ctx || !this.subMaster) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Stop any existing scene layers gracefully.
    this.master?.gain.setTargetAtTime(0, t, 0.1);

    // Halt every source node from the previous scene layer before spawning
    // new ones. Rapid era scrubbing would otherwise accumulate long-running
    // oscillators / buffer sources.
    this.stopAllSources();

    // Clear any previous bird timers.
    this.clearBirdTimers();

    // 1. Wind wash: noise -> bandpass -> gain.
    const noise = this.getNoise();
    if (noise) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = 320 + era.wind * 520;
      filt.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(0.05 + era.wind * 0.12, t + 0.4, 0.6);
      src.connect(filt).connect(g).connect(this.subMaster);
      src.start(t);
      this.trackSource(src);
      this.scheduleStop(src, 9000);
    }

    // 2. Tonal pad: two detuned sines through a lowpass.
    const padGain = ctx.createGain();
    padGain.gain.value = 0;
    padGain.gain.setTargetAtTime(0.03 + era.tonal * 0.1, t + 0.8, 0.8);
    const padFilt = ctx.createBiquadFilter();
    padFilt.type = 'lowpass';
    padFilt.frequency.value = 700 + era.mode * 300;
    padGain.connect(padFilt).connect(this.subMaster);
    const f0 = 110 * (era.mode === 0 ? 1 : era.mode === 1 ? 1.335 : 1.26);
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f0;
      o.detune.value = det;
      o.connect(padGain);
      o.start(t);
      this.trackSource(o);
      this.scheduleStop(o, 9000);
    }

    // 3. Traffic / crowd noise texture.
    const trafficG = ctx.createGain();
    trafficG.gain.value = 0;
    trafficG.gain.setTargetAtTime(
      0.02 + era.traffic * 0.1,
      t + 0.5,
      0.5,
    );
    const trafficSrc = ctx.createBufferSource();
    trafficSrc.buffer = noise;
    trafficSrc.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600 + era.traffic * 900;
    trafficSrc.connect(lp).connect(trafficG).connect(this.subMaster);
    trafficSrc.start(t);
    this.trackSource(trafficSrc);

    // Birds / insects sparkling.
    const birdG = ctx.createGain();
    birdG.gain.value = 0;
    birdG.gain.setTargetAtTime(0.02 + era.birds * 0.1, t + 1, 0.8);
    const birdTimer = setInterval(() => {
      if (!this.ctx || !this.subMaster) return;
      const b = ctx.createOscillator();
      b.type = 'sine';
      const bg = ctx.createGain();
      b.frequency.value = 1800 + Math.random() * 2400;
      bg.gain.setValueAtTime(0.0001, ctx.currentTime);
      bg.gain.exponentialRampToValueAtTime(
        birdG.gain.value * 0.4,
        ctx.currentTime + 0.01,
      );
      bg.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      b.connect(bg).connect(this.subMaster);
      this.trackSource(b);
      b.start(ctx.currentTime);
      b.stop(ctx.currentTime + 0.2);
    }, 1200 + Math.random() * 900);
    this.birdTimers.add(birdTimer);

    // 4. Neon hum (quiet 60Hz + saw bleed).
    const humG = ctx.createGain();
    humG.gain.value = 0;
    humG.gain.setTargetAtTime(0.004 + era.hum * 0.05, t + 0.6, 0.4);
    const hum = ctx.createOscillator();
    hum.type = 'triangle';
    hum.frequency.value = 60;
    hum.connect(humG).connect(this.subMaster);
    hum.start(t);
    this.trackSource(hum);

    // 5. Ethereal sweeps for later eras.
    const sweepG = ctx.createGain();
    sweepG.gain.value = 0;
    sweepG.gain.setTargetAtTime(0.002 + era.sweeps * 0.06, t + 1.5, 1.2);
    const sweepF = ctx.createBiquadFilter();
    sweepF.type = 'bandpass';
    sweepF.frequency.value = 700;
    sweepF.Q.value = 4;
    sweepG.connect(sweepF).connect(this.subMaster);
    const noise2 = ctx.createBufferSource();
    noise2.buffer = noise;
    noise2.loop = true;
    noise2.connect(sweepG);
    sweepG.connect(this.subMaster);
    // Modulate the filter slowly.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07 * era.lfoRate;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 500 + era.sweeps * 500;
    lfo.connect(lfoGain).connect(sweepF.frequency);
    lfo.start(t);
    noise2.start(t);
    this.trackSource(noise2);
    this.trackSource(lfo);

    // 6. Rain/storm when weather>0.
    if (era.weather > 0.01) {
      const rainG = ctx.createGain();
      rainG.gain.value = 0;
      rainG.gain.setTargetAtTime(0.01 + era.weather * 0.06, t + 2, 1.2);
      const rainSrc = ctx.createBufferSource();
      rainSrc.buffer = noise;
      rainSrc.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000;
      rainSrc.connect(hp).connect(rainG).connect(this.subMaster);
      rainSrc.start(t);
      this.trackSource(rainSrc);
    }
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const seconds = 2;
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate * seconds, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  getNoise(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noiseBuffer) this.noiseBuffer = this.makeNoise();
    return this.noiseBuffer;
  }

  /**
   * Register a running source node so it is stopped when the soundscape layer
   * is swapped or the manager is disposed. Rapid era scrubbing otherwise
   * accumulates long-running oscillators / buffer sources.
   */
  private trackSource(node: AudioScheduledSourceNode): void {
    this.activeSources.add(node);
    node.onended = () => {
      this.activeSources.delete(node);
    };
  }

  /** Stop every node from the previous scene layer before spawning new ones. */
  private stopAllSources(): void {
    for (const node of this.activeSources) {
      try {
        node.stop();
      } catch {
        // Already stopped or never started — nothing to clean up.
      }
    }
    this.activeSources.clear();
    for (const timer of this.sourceTimers) clearTimeout(timer);
    this.sourceTimers.clear();
  }

  /** Stop a source after a fixed lifetime, tolerating double-stops. */
  private scheduleStop(node: AudioScheduledSourceNode, ms: number): void {
    const timer = setTimeout(() => {
      this.sourceTimers.delete(timer);
      try {
        node.stop();
      } catch {
        // Already stopped by a scene swap / dispose.
      }
    }, ms);
    this.sourceTimers.add(timer);
  }

  private birdTimers = new Set<ReturnType<typeof setInterval>>();

  private clearBirdTimers(): void {
    for (const t of this.birdTimers) clearInterval(t);
    this.birdTimers.clear();
  }
}