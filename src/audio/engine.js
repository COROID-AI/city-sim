import { profiles } from './eras/index.js';
import { playSfx, startAmbient, SFX_NAMES } from './sfx/index.js';

export const CROSSFADE_SECONDS = 2.5;
const SOURCE_NAMES = {
  1945: ['wireless', 'radio'], 1965: ['jukebox'], 1985: ['boombox'],
  2005: ['ipod', 'dock'], 2025: ['smart-speaker', 'smartphone'],
};
const SIGNATURES = {
  1945: ['radio-static'], 1965: ['jukebox-clunk', 'record-drop'],
  1985: ['cassette', 'tape-hiss'], 2005: ['click-wheel'], 2025: ['smart-chime', 'notification'],
};

function fade(param, value, at, seconds = 0) {
  try { param.cancelScheduledValues(at); param.setValueAtTime(param.value, at); param.linearRampToValueAtTime(value, at + seconds); } catch {}
}

export class AudioEngine {
  constructor() {
    const storage = globalThis.localStorage;
    this.context = null; this.master = null; this.musicBus = null; this.ambienceBus = null; this.sfxBus = null;
    this.volume = Number(storage?.getItem('cafe-audio-volume')) || .62;
    this.muted = storage?.getItem('cafe-audio-muted') === 'true';
    this.currentEra = null; this.player = null; this.ambience = null; this.scene = null; this.camera = null;
    this.ambiencePanner = null;
  }
  attach(ctx = {}) { this.scene = ctx.scene; this.camera = ctx.camera; return this; }
  _init() {
    if (this.context) return true;
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return false;
      const c = new AC(); this.context = c;
      this.master = c.createGain(); this.musicBus = c.createGain(); this.ambienceBus = c.createGain(); this.sfxBus = c.createGain();
      this.musicBus.connect(this.master); this.ambienceBus.connect(this.master); this.sfxBus.connect(this.master); this.master.connect(c.destination);
      this.master.gain.value = this.muted ? 0 : this.volume;
      if (this.currentEra) this._startEra(this.currentEra, 0);
      return true;
    } catch { this.context = null; return false; }
  }
  resume() { if (!this._init()) return false; try { if (this.context.state === 'suspended') this.context.resume(); } catch {} return true; }
  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, Number(value) || 0));
    try { globalThis.localStorage?.setItem('cafe-audio-volume', String(this.volume)); } catch {}
    if (this.master && !this.muted) fade(this.master.gain, this.volume, this.context.currentTime, .04);
  }
  setMuted(value = !this.muted) {
    this.muted = Boolean(value); try { globalThis.localStorage?.setItem('cafe-audio-muted', String(this.muted)); } catch {}
    if (this.master) fade(this.master.gain, this.muted ? 0 : this.volume, this.context.currentTime, .04);
    return this.muted;
  }
  toggleMute() { return this.setMuted(); }
  _source(year) {
    let result = null; const names = SOURCE_NAMES[year] || [];
    this.scene?.traverse?.((object) => { if (!result && names.some((n) => String(object.name || '').toLowerCase().includes(n))) result = object; });
    return result;
  }
  _startEra(year, seconds = CROSSFADE_SECONDS) {
    if (!this.context || !profiles[year]) return;
    const c = this.context, gain = c.createGain(); gain.gain.value = seconds ? .0001 : 1;
    const output = c.createStereoPanner ? c.createStereoPanner() : gain;
    gain.connect(output); if (output !== gain) output.connect(this.musicBus); else gain.connect(this.musicBus);
    const stop = profiles[year].start(c, gain);
    const old = this.player; this.player = { gain, output, stop, year };
    if (seconds) fade(gain.gain, 1, c.currentTime, seconds);
    if (old) { fade(old.gain.gain, .0001, c.currentTime, seconds); setTimeout(() => { try { old.stop(); old.gain.disconnect(); old.output.disconnect(); } catch {} }, seconds * 1000 + 100); }
    if (this.ambience) this.ambience.stop();
    // Ambience beds (murmur, machine hiss) live at the counter, so they get
    // their own panner that tracks the counter's screen-side position.
    if (c.createStereoPanner) {
      this.ambiencePanner = c.createStereoPanner();
      this.ambiencePanner.pan.value = this._panFor(this.counterX());
      this.ambiencePanner.connect(this.ambienceBus);
    }
    this.ambience = startAmbient(c, this.ambiencePanner || this.ambienceBus, profiles[year].ambience);
    for (const sfx of SIGNATURES[year] || []) setTimeout(() => this.playSfx(sfx), Math.min(500, seconds * 1000));
    this.sourceObject = this._source(year);
  }
  switchEra(year, duration = CROSSFADE_SECONDS) {
    const hadContext = Boolean(this.context);
    this.currentEra = Number(year); if (!this.resume()) return false;
    // _init starts the remembered boot era once the first gesture unlocks it.
    if (!hadContext) return true;
    playSfx(this.context, this.sfxBus, 'transition-swoosh'); this._startEra(this.currentEra, duration); return true;
  }
  playEra(year) { this.currentEra = Number(year); if (!this.resume()) return false; this._startEra(this.currentEra, .12); return true; }
  playSfx(name) { if (!SFX_NAMES.includes(name) || !this.resume()) return false; playSfx(this.context, this.sfxBus, name); return true; }
  setListener(camera) { this.camera = camera; }
  counterX() { return -2.9; }
  _panFor(worldX) {
    if (!this.camera) return -0.4;
    const dx = worldX - this.camera.position.x;
    return Math.max(-1, Math.min(1, dx / 3));
  }
  update() {
    if (!this.camera) return;
    // Music emanates from the era's physical source object as you orbit.
    if (this.sourceObject && this.player?.output?.pan) {
      this.player.output.pan.value = this._panFor(this.sourceObject.position.x);
    }
    // Murmur + machine hiss follow the counter's world-space position.
    if (this.ambiencePanner?.pan) {
      this.ambiencePanner.pan.value = this._panFor(this.counterX());
    }
  }
  api() {
    const engine = this;
    return { resume: () => engine.resume(), switchEra: (y) => engine.switchEra(y), playEra: (y) => engine.playEra(y), playSfx: (s) => engine.playSfx(s), setVolume: (v) => engine.setVolume(v), mute: () => engine.setMuted(true), unmute: () => engine.setMuted(false), profiles, sfx: SFX_NAMES, get available() { return Boolean(engine.context); } };
  }
}

export const audioEngine = new AudioEngine();
if (typeof window !== 'undefined') window.__cafeAudio = audioEngine.api();
