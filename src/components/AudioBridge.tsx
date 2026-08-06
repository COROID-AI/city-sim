import { useEffect } from 'react';
import { useCityStore } from '../store/useCityStore';
import { audioManager } from '../audio';

/**
 * Wires the audio manager to user gestures and era transitions.
 *
 * - Unlocks audio on the first user gesture (pointer/key/touch) to satisfy
 *   browser autoplay policy.
 * - Loads the current era's ambient bed (gated until unlocked).
 * - On a transition request, plays the transition SFX and crossfades the
 *   destination era's ambient bed.
 */
export function AudioBridge() {
  const currentEra = useCityStore((s) => s.currentEra);
  const transitionRequest = useCityStore((s) => s.transitionRequest);
  const clearTransition = useCityStore((s) => s.clearTransition);

  useEffect(() => {
    const unlock = () => audioManager.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  // Load the current era's ambience; gated until the first gesture.
  useEffect(() => {
    void audioManager.loadEraAmbience(currentEra);
  }, [currentEra]);

  // React to era transitions: play SFX + crossfade the destination bed.
  useEffect(() => {
    if (transitionRequest) {
      audioManager.playTransitionSfx(
        transitionRequest.fromEra,
        transitionRequest.toEra,
      );
      void audioManager.loadEraAmbience(transitionRequest.toEra);
      clearTransition();
    }
  }, [transitionRequest, clearTransition]);

  return null;
}
