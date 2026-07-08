type SfxName = 'transition' | 'ambient' | 'click';

export class SFXManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private ambientSource: AudioBufferSourceNode | null = null;
  private muted = false;
  private started = false;

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  private resume(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  play(name: SfxName): void {
    if (this.muted) return;
    this.resume();
    if (!this.ctx || !this.master) return;
    if (name === 'transition') this.playTransitionSound();
    else if (name === 'click') this.playClick();
  }

  playClick(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.05);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  playTransitionSound(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime;

    // whoosh: filtered noise burst
    const dur = 1.6;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const env = Math.sin((i / data.length) * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(2400, t + dur * 0.6);
    filter.frequency.exponentialRampToValueAtTime(500, t + dur);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.22, t + 0.25);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    noise.connect(filter).connect(noiseGain).connect(this.master);
    noise.start(t);
    noise.stop(t + dur);

    // shimmer tone
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(660, t + dur * 0.8);
    oscGain.gain.setValueAtTime(0.0001, t);
    oscGain.gain.exponentialRampToValueAtTime(0.12, t + 0.3);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(oscGain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  // Procedural ambient city hum that loops gently.
  playAmbientSound(): void {
    if (this.started) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    this.resume();
    this.started = true;

    const base = ctx.createGain();
    base.gain.value = 0.0;
    base.gain.setTargetAtTime(this.muted ? 0 : 0.08, ctx.currentTime, 1.5);
    base.connect(this.master);

    const freqs = [55, 82.5, 110, 165];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = f;
      // slow LFO on gain for subtle movement
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.05 + i * 0.03;
      lfoGain.gain.value = 0.015;
      lfo.connect(lfoGain).connect(gain.gain);
      gain.gain.value = 0.03 - i * 0.005;
      osc.connect(gain).connect(base);
      osc.start();
      lfo.start();
      this.ambientNodes.push({ osc, gain });
      this.ambientNodes.push({ osc: lfo, gain: lfoGain });
    });

    this.baseAmbient = base;
  }

  private baseAmbient: GainNode | null = null;

  setPeriodTimbre(period: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.baseAmbient) return;
    // brighter, busier hum for modern eras
    const target = period <= 1945 ? 0.05 : period <= 1965 ? 0.065 : period <= 1985 ? 0.08 : period <= 2005 ? 0.095 : 0.11;
    this.baseAmbient.gain.setTargetAtTime(this.muted ? 0 : target, ctx.currentTime, 0.8);
  }

  dispose(): void {
    this.ambientNodes.forEach(({ osc }) => {
      try { osc.stop(); } catch { /* noop */ }
    });
    this.ambientNodes = [];
    if (this.ambientSource) {
      try { this.ambientSource.stop(); } catch { /* noop */ }
      this.ambientSource = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.master = null;
    this.baseAmbient = null;
    this.started = false;
  }
}
