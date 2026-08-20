import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioManager } from './AudioManager';
import { TIME_PERIODS } from '../state/timePeriods';

describe('AudioManager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes lifecycle guards without throwing when uninitialized', () => {
    // In a node environment there is no window.AudioContext, so the manager
    // must remain inert rather than throw.
    const audio = new AudioManager();
    expect(audio.isReady).toBe(false);
    expect(audio.context).toBeNull();
    expect(() => audio.init()).not.toThrow();
    expect(audio.isReady).toBe(false);
    audio.setEra(TIME_PERIODS[0]!.sounding);
    audio.setMuted(true);
    audio.setVolume(0.5, true);
    audio.playTick();
    audio.playEraTransition();
    expect(() => audio.dispose()).not.toThrow();
  });

  it('keeps era tags stable for the six eras', () => {
    const tags = TIME_PERIODS.map((p) => p.sounding.tag);
    expect(new Set(tags).size).toBe(TIME_PERIODS.length);
    expect(tags[0]).toBe('steam & soot');
    expect(tags[5]).toBe('electric hum');
  });
});