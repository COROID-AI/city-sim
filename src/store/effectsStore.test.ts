/**
 * Unit tests for the effects preference store.
 *
 * Verifies initial state, toggle actions, and explicit setters. The shared
 * store is reset between tests to avoid cross-test state leakage.
 */
import { createEffectsStore, useEffectsStore } from '@/store/effectsStore';

function resetStore() {
  useEffectsStore.setState({
    particlesEnabled: true,
    bloomEnabled: true,
  });
}

describe('effectsStore', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('initial state', () => {
    it('starts with particles and bloom enabled', () => {
      const store = createEffectsStore();
      const state = store.getState();
      expect(state.particlesEnabled).toBe(true);
      expect(state.bloomEnabled).toBe(true);
    });
  });

  describe('toggleParticles', () => {
    it('flips particlesEnabled from true to false', () => {
      useEffectsStore.getState().toggleParticles();
      expect(useEffectsStore.getState().particlesEnabled).toBe(false);
    });

    it('flips particlesEnabled from false back to true', () => {
      useEffectsStore.getState().toggleParticles();
      useEffectsStore.getState().toggleParticles();
      expect(useEffectsStore.getState().particlesEnabled).toBe(true);
    });
  });

  describe('toggleBloom', () => {
    it('flips bloomEnabled from true to false', () => {
      useEffectsStore.getState().toggleBloom();
      expect(useEffectsStore.getState().bloomEnabled).toBe(false);
    });

    it('flips bloomEnabled from false back to true', () => {
      useEffectsStore.getState().toggleBloom();
      useEffectsStore.getState().toggleBloom();
      expect(useEffectsStore.getState().bloomEnabled).toBe(true);
    });
  });

  describe('setParticlesEnabled', () => {
    it('explicitly sets particlesEnabled to false', () => {
      useEffectsStore.getState().setParticlesEnabled(false);
      expect(useEffectsStore.getState().particlesEnabled).toBe(false);
    });

    it('explicitly sets particlesEnabled to true', () => {
      useEffectsStore.getState().setParticlesEnabled(false);
      useEffectsStore.getState().setParticlesEnabled(true);
      expect(useEffectsStore.getState().particlesEnabled).toBe(true);
    });
  });

  describe('setBloomEnabled', () => {
    it('explicitly sets bloomEnabled to false', () => {
      useEffectsStore.getState().setBloomEnabled(false);
      expect(useEffectsStore.getState().bloomEnabled).toBe(false);
    });

    it('explicitly sets bloomEnabled to true', () => {
      useEffectsStore.getState().setBloomEnabled(false);
      useEffectsStore.getState().setBloomEnabled(true);
      expect(useEffectsStore.getState().bloomEnabled).toBe(true);
    });
  });
});
