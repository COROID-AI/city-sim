/**
 * src/world/animation/audio.js — compatibility surface for the café audio.
 *
 * This module used to host a second, independent WebAudio engine that called
 * non-existent APIs (AudioContext.createNoise) and fought the real engine in
 * src/audio/engine.js for the same mute/volume controls. It is now a thin
 * adapter: the timelapse controller (`audio.setEra` / `audio.update`) and the
 * app bootstrap (`setAudioMuted` / `setAudioVolume` / `isAudioMuted` /
 * `getAudioVolume`) all delegate to the single real engine, so era crossfades,
 * mute/volume persistence, and the era-specific music beds stay in sync.
 */
import { audioEngine } from '../../audio/engine.js';

export const audio = {
  /** Called by the timelapse controller when the era changes. */
  setEra(era) {
    const year = Number(era?.year ?? era);
    // applyYear() already drives the real engine on slider moves; skip the
    // duplicate call so the era crossfade is not restarted mid-transition.
    if (audioEngine.currentEra === year) return;
    audioEngine.switchEra(year);
  },
  /** The real engine drives its own per-frame panner updates. */
  update() {},
  setMuted(muted) {
    audioEngine.setMuted(Boolean(muted));
  },
  setVolume(volume) {
    audioEngine.setVolume(Number(volume));
  },
  toggleMuted() {
    return audioEngine.toggleMute();
  },
  get muted() {
    return audioEngine.muted;
  },
  get volume() {
    return audioEngine.volume;
  },
};

export function setAudioMuted(muted) { audio.setMuted(muted); }
export function setAudioVolume(volume) { audio.setVolume(volume); }
export function toggleAudioMuted() { return audio.toggleMuted(); }
export function isAudioMuted() { return audio.muted; }
export function getAudioVolume() { return audio.volume; }