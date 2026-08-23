/* Procedural WebAudio engine.
 *
 * Autoplay-policy safety (handoff finding: browsers block WebAudio until a
 * user gesture): the AudioContext is created lazily inside unlock(), which is
 * only ever called from real user gestures (pointerdown / keydown / touch).
 * resume() is retried whenever it is still suspended, every SFX guards on
 * ready(), and nothing throws if audio is unavailable or blocked.
 */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.muted = false;
    this.ambientOn = false;
    this.laserNodes = null;
    this.holeNodes = null;
  }

  /* Called from user-gesture handlers only. Safe to call repeatedly. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 12;
        comp.ratio.value = 6;
        comp.connect(this.ctx.destination);
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        this.master.connect(comp);
        const len = this.ctx.sampleRate * 2;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      if (!this.ambientOn && this.ctx.state === 'running') {
        this.startAmbient();
      }
    } catch (e) {
      /* audio is optional; never break gameplay */
    }
  }

  ready() {
    if (!this.ctx || !this.master) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx.state === 'running';
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, t, 0.03);
    }
  }

  _noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    return src;
  }

  startAmbient() {
    if (!this.ready() || this.ambientOn) return;
    this.ambientOn = true;
    const t = this.ctx.currentTime;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 0.4;
    const lfo = this.ctx.createOscillator();
    const lfoG = this.ctx.createGain();
    lfo.frequency.value = 0.06;
    lfoG.gain.value = 90;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start(t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.055, t + 3);
    lp.connect(g).connect(this.master);
    for (const [f, vol] of [[54, 1], [54.6, 1], [108.4, 0.28]]) {
      const o = this.ctx.createOscillator();
      o.type = f > 100 ? 'sine' : 'triangle';
      o.frequency.value = f;
      const og = this.ctx.createGain();
      og.gain.value = 0.34 * vol;
      o.connect(og).connect(lp);
      o.start(t);
    }
    this.ambientGain = g;
  }

  duckAmbient(duck) {
    if (this.ambientGain && this.ctx) {
      this.ambientGain.gain.setTargetAtTime(duck ? 0.015 : 0.055, this.ctx.currentTime, 0.25);
    }
  }

  explosion(size = 1) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const dur = Math.min(0.6 + size * 0.55, 3);
    const src = this._noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(2400 + size * 700, 4200), t);
    lp.frequency.exponentialRampToValueAtTime(60, t + dur);
    const g = this.ctx.createGain();
    const peak = Math.min(0.35 + size * 0.22, 0.85);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(Math.min(50 + size * 30, 110), t);
    sub.frequency.exponentialRampToValueAtTime(24, t + dur * 0.85);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(Math.min(0.3 + size * 0.18, 0.7), t + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(sg).connect(this.master);
    sub.start(t);
    sub.stop(t + dur + 0.05);
  }

  rumble(duration = 2, intensity = 0.6) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const src = this._noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 68;
    lp.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(Math.min(intensity * 0.5, 0.65), t + duration * 0.18);
    g.gain.linearRampToValueAtTime(0.0001, t + duration);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.1);
  }

  riser(duration = 3.2) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const src = this._noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(180, t);
    bp.frequency.exponentialRampToValueAtTime(2100, t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + duration);
    g.gain.linearRampToValueAtTime(0.0001, t + duration + 0.08);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.15);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(46, t);
    o.frequency.exponentialRampToValueAtTime(190, t + duration);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.16, t + duration);
    og.gain.linearRampToValueAtTime(0.0001, t + duration + 0.08);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.15);
  }

  detonation() {
    this.explosion(3);
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(64, t);
    sub.frequency.exponentialRampToValueAtTime(15, t + 3.6);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.75, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 3.8);
    sub.connect(sg).connect(this.master);
    sub.start(t);
    sub.stop(t + 4);
    setTimeout(() => this.rumble(5.5, 0.9), 250);
  }

  railgun() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(170, t + 0.1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
    const src = this._noiseSource();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2800;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.18, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(hp).connect(ng).connect(this.master);
    src.start(t);
    src.stop(t + 0.1);
  }

  uiClick(freq = 640) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.06);
  }

  nukeExtra() {
    setTimeout(() => { this.explosion(1.7); }, 230);
    setTimeout(() => { this.rumble(3.8, 0.85); }, 480);
  }

  startLaser() {
    if (!this.ready() || this.laserNodes) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.05);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 1.6;
    const o1 = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'sawtooth';
    o1.frequency.value = 620; o2.frequency.value = 629;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 11;
    const lg = this.ctx.createGain();
    lg.gain.value = 140;
    lfo.connect(lg);
    lg.connect(o1.frequency); lg.connect(o2.frequency);
    o1.connect(bp); o2.connect(bp);
    bp.connect(g).connect(this.master);
    o1.start(t); o2.start(t); lfo.start(t);
    this.laserNodes = { o1, o2, lfo, g };
  }

  stopLaser() {
    if (!this.laserNodes) return;
    const { o1, o2, lfo, g } = this.laserNodes;
    this.laserNodes = null;
    try {
      const t = this.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0.0001, t, 0.03);
      o1.stop(t + 0.15); o2.stop(t + 0.15); lfo.stop(t + 0.15);
    } catch (e) { /* already stopped */ }
  }

  startBlackHole(lifeSec = 4.5) {
    if (!this.ready() || this.holeNodes) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(330, t);
    o.frequency.exponentialRampToValueAtTime(36, t + lifeSec);
    const trem = this.ctx.createOscillator();
    trem.frequency.value = 6.5;
    const tg = this.ctx.createGain();
    tg.gain.value = 0.09;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.4);
    trem.connect(tg).connect(g.gain);
    o.connect(g).connect(this.master);
    o.start(t); trem.start(t);
    const src = this._noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.08, t + 0.6);
    src.connect(lp).connect(ng).connect(this.master);
    src.start(t);
    this.holeNodes = { o, trem, g, ng, src };
  }

  collapseBlackHole() {
    if (!this.holeNodes) return;
    const { o, trem, g, ng, src } = this.holeNodes;
    this.holeNodes = null;
    try {
      const t = this.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0.0001, t, 0.04);
      ng.gain.cancelScheduledValues(t);
      ng.gain.setTargetAtTime(0.0001, t, 0.04);
      o.stop(t + 0.25); trem.stop(t + 0.25); src.stop(t + 0.25);
    } catch (e) { /* already stopped */ }
  }
}
