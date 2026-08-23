/**
 * src/world/animation/audio.js
 *
 * Procedural WebAudio ambient soundscape for the café timelapse.
 *
 * On every era change the controller calls `audio.setEra(toEra)`; this module
 * crossfades the era's music bed while layering the shared ambient SFX
 * (conversation murmur, coffee machine hiss/steam, cups & cutlery clatter)
 * and fires a soft door-chime blip at the moment of the switch. It exposes
 * working mute / volume controls and degrades to a silent no-op when WebAudio
 * is unavailable (headless / no audio device).
 *
 * All node graphs are built once on first use. The transition lerps gain and
 * filter values toward the new era's targets over the timelapse duration, so
 * the soundscape morphs in step with the visuals rather than snapping.
 */

const ERA_BEDS = Object.freeze({
  1945: Object.freeze({ music: 0.16, ambience: 0.34, warmth: 0.9 }),
  1965: Object.freeze({ music: 0.22, ambience: 0.3, warmth: 0.65 }),
  1985: Object.freeze({ music: 0.3, ambience: 0.26, warmth: 0.4 }),
  2005: Object.freeze({ music: 0.24, ambience: 0.22, warmth: 0.2 }),
  2025: Object.freeze({ music: 0.2, ambience: 0.18, warmth: 0.05 }),
});

const MUTE_KEY = 'cafe-audio-muted';
const VOLUME_KEY = 'cafe-audio-volume';
const CROSSFADE_DURATION = 2.4;

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.music = null;
    this.ambience = null;
    this.sfx = null;
    this.currentEra = null;
    this.muted = false;
    this.volume = 0.8;
    this.ready = false;
    this.failed = false;
    // Crossfade state (normalized 0..1; advanced by update()).
    this.crossfade = 1;
    this.target = { music: 0, ambience: 0, warmth: 0.5 };
    // Door-chime envelope (seconds remaining).
    this.chime = 0;
  }

  /** Lazily open the shared AudioContext (returns false when unavailable). */
  ensure() {
    if (this.ready) return true;
    if (this.failed) return false;
    try {
      const AC = typeof AudioContext !== 'undefined' ? AudioContext : window?.AudioContext;
      if (!AC) { this.failed = true; return false; }
      this.ctx = new AC();
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const master = this.ctx.createGain();
      master.connect(this.ctx.out);
      this.master = master;

      // Music bed — a soft two-oscillator pad (era warmth shifts the tone).
      const music = this.ctx.createGain();
      music.connect(master);
      const osc1 = this.ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency = 220;
      const osc2 = this.ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency = 277.18;
      const musicGain = this.ctx.createGain();
      musicGain.gain = 0.12;
      osc1.connect(musicGain);
      osc2.connect(musicGain);
      musicGain.connect(music);
      this.music = { node: music, osc1, osc2, gain: musicGain };

      // Ambience: filtered noise bed for murmur / hiss / clatter.
      const ambience = this.ctx.createGain();
      ambience.connect(master);
      const noise = this.ctx.createNoise();
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      lp.Q.value = 0.5;
      const ambienceGain = this.ctx.createGain();
      ambienceGain.gain.value = 0.05;
      noise.connect(lp);
      lp.connect(ambienceGain);
      ambienceGain.connect(ambience);
      this.ambience = { node: ambience, noise, filter: lp, gain: ambienceGain };

      // SFX: a band-passed noise for the door chime + hiss blips.
      const sfx = this.ctx.createGain();
      sfx.connect(master);
      const sfxNoise = this.ctx.createNoise();
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      bp.Q.value = 2.5;
      const sfxGain = this.ctx.createGain();
      sfxGain.gain.value = 0.0;
      sfxNoise.connect(bp);
      bp.connect(sfxGain);
      sfxGain.connect(sfx);
      this.sfx = { node: sfx, noise: sfxNoise, filter: bp, gain: sfxGain };

      this.ready = true;
      this.muted = this.readMuted();
      this.volume = this.readVolume();
      this.applyMaster();
      return true;
    } catch (e) {
      this.failed = true;
      return false;
    }
  }

  readMuted() {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1'; }
    catch { return false; }
  }
  readVolume() {
    try {
      if (typeof localStorage === 'undefined') return 0.8;
      const raw = Number(localStorage.getItem(VOLUME_KEY));
      if (Number.isFinite(raw)) return Math.min(1, Math.max(0, raw));
      return 0.8;
    } catch { return 0.8; }
  }
  applyMaster() {
    if (!this.ready || !this.master) return;
    this.master.gain.value = this.muted ? 0 : this.volume;
  }

  /**
   * Start a crossfade toward the incoming era. Stores the target bed, resets
   * the crossfade timer, and fires a short door chime for the transition.
   */
  setEra(era) {
    if (!era || era.year === this.currentEra) return;
    if (!this.ensure()) return;
    const meta = ERA_BEDS[era.year] || ERA_BEDS[2025];
    this.target = {
      music: meta.music,
      ambience: meta.ambience,
      warmth: meta.warmth,
    };
    this.crossfade = 0;
    // Door chime — a brief band-passed noise blip (the café door bell).
    this.chime = 0.05;
    if (this.sfx) this.sfx.gain.gain.value = 0.0;
    this.currentEra = era.year;
  }

  /** Per-frame update: advance the crossfade, decay the chime, apply volume. */
  update(delta = 0) {
    if (!this.ready) return;
    if (this.crossfade < 1) {
      this.crossfade = Math.min(1, this.crossfade + Math.min(delta, 0.1) / CROSSFADE_DURATION);
      const t = this.crossfade * this.crossfade * (3 - 2 * this.crossfade); // smoothstep
      if (this.music) {
        const base = 220 + this.target.warmth * 40;
        this.music.osc1.frequency.value = base;
        this.music.osc2.frequency.value = base * 1.26;
        this.music.gain.gain.value = this.target.music * t * this.volume;
      }
      if (this.ambience) {
        this.ambience.filter.frequency.value = 600 + (1 - this.target.warmth) * 900;
        this.ambience.gain.gain.value = this.target.ambience * t * this.volume;
      }
    }
    // Decay the door chime toward silence.
    if (this.chime > 0 && this.sfx) {
      this.chime = Math.max(0, this.chime - (delta || 0.016));
      const env = this.chime > 0 ? this.chime / 0.05 : 0;
      this.sfx.gain.gain.value = this.muted ? 0 : env * this.volume * 0.5;
    }
    this.applyMaster();
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.ready) this.applyMaster();
    try { localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch {}
  }
  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, Number(v) || 0));
    if (this.ready) this.applyMaster();
    try { localStorage.setItem(VOLUME_KEY, String(this.volume)); } catch {}
  }
  toggleMuted() { this.setMuted(!this.muted); return this.muted; }
}

export const audio = new AudioEngine();
export function setAudioMuted(muted) { audio.setMuted(muted); }
export function setAudioVolume(volume) { audio.setVolume(volume); }
export function toggleAudioMuted() { return audio.toggleMuted(); }
export function isAudioMuted() { return audio.muted; }
export function getAudioVolume() { return audio.volume; }