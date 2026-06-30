/**
 * Unit tests for the audio preference store.
 *
 * Uses the global Jest API (no @jest/globals import) consistent with the
 * rest of the suite. The shared store is reset between tests to avoid
 * cross-test state leakage.
 */
import { useAudioStore } from '@/store/audioStore';

function resetStore() {
  useAudioStore.setState({
    muted: false,
    volume: 0.6,
    unlocked: false,
    sfxPulse: false,
  });
}

describe('audioStore', () => {
  beforeEach(() => {
    resetStore();
  });

  it('starts unmuted with default volume', () => {
    const state = useAudioStore.getState();
    expect(state.muted).toBe(false);
    expect(state.volume).toBeCloseTo(0.6);
    expect(state.unlocked).toBe(false);
  });

  it('toggleMute flips the muted flag', () => {
    useAudioStore.getState().toggleMute();
    expect(useAudioStore.getState().muted).toBe(true);
    useAudioStore.getState().toggleMute();
    expect(useAudioStore.getState().muted).toBe(false);
  });

  it('setMuted sets an explicit value', () => {
    useAudioStore.getState().setMuted(true);
    expect(useAudioStore.getState().muted).toBe(true);
    useAudioStore.getState().setMuted(false);
    expect(useAudioStore.getState().muted).toBe(false);
  });

  it('setVolume clamps into [0, 1]', () => {
    useAudioStore.getState().setVolume(2);
    expect(useAudioStore.getState().volume).toBe(1);
    useAudioStore.getState().setVolume(-1);
    expect(useAudioStore.getState().volume).toBe(0);
    useAudioStore.getState().setVolume(0.3);
    expect(useAudioStore.getState().volume).toBeCloseTo(0.3);
  });

  it('setUnlocked updates the unlocked flag', () => {
    useAudioStore.getState().setUnlocked(true);
    expect(useAudioStore.getState().unlocked).toBe(true);
  });

  it('setSfxPulse updates the pulse flag', () => {
    useAudioStore.getState().setSfxPulse(true);
    expect(useAudioStore.getState().sfxPulse).toBe(true);
    useAudioStore.getState().setSfxPulse(false);
    expect(useAudioStore.getState().sfxPulse).toBe(false);
  });
});
