import * as THREE from 'three';

/**
 * Procedural Web Audio SFX.
 * The browser blocks AudioContext until a user gesture; the UI calls unlock()
 * on the first pointer/keydown so sound reliably starts after interaction.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastAmbientTick = 0;

  /** Called from a user gesture. Creates/ resumes the context once. */
  unlock() {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      // 1s of white noise reused for whoosh/wind
      const len = Math.floor(this.ctx.sampleRate * 1);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private get ready() {
    return !!this.ctx && !!this.master;
  }

  /** short reactive tick used when the timeline scrubs/plays */
  click() {
    if (!this.ready) return;
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    const freq = 240 + Math.random() * 160;
    o.type = 'square';
    o.frequency.value = freq;
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.1);
  }

  /** soft movement from an era transition */
  whoosh(power = 1) {
    if (!this.ready || !this.noiseBuf) return;
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(200, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(1600, c.currentTime + 0.35);
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 * power, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    src.start(t);
    src.stop(t + 0.7);
  }

  /** quiet wind loop tied to the day/night cycle; call roughly every frame */
  wind(daylight: number, volume: number) {
    if (!this.ready || !this.noiseBuf) {
      this.lastAmbientTick = 0;
      return;
    }
    const c = this.ctx!;
    const now = performance.now();
    if (now - this.lastAmbientTick < 70) return;
    this.lastAmbientTick = now;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.5 + Math.random() * 0.25;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 320 + Math.random() * 260;
    const g = c.createGain();
    const lvl = 0.016 + 0.02 * daylight * volume;
    g.gain.setValueAtTime(lvl, c.currentTime + 0.02);
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    src.start(c.currentTime);
    src.stop(c.currentTime + 0.21);
  }
}

export const audioEngine = new AudioEngine();