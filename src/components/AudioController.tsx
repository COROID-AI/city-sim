import { useEffect, useRef } from 'react';
import type { EraId } from '../contracts';
import { audioManager } from '../audio';
import { useEraStore } from '../store/useEraStore';

/**
 * Headless component that wires the shared {@link audioManager} to the era
 * store:
 *
 * - Unlocks the AudioContext on the first user gesture (autoplay policy).
 * - On the first unlock, loads the current era's ambience.
 * - On every era change, plays the transition SFX and crossfades into the
 *   new era's ambience bed.
 *
 * Renders nothing.
 */
export function AudioController() {
  const currentEra = useEraStore((s) => s.currentEra);
  const prevEraRef = useRef<EraId | null>(null);

  // Unlock audio on the first user gesture (pointer or keyboard).
  useEffect(() => {
    const unlock = () => {
      audioManager.unlock();
      const era = useEraStore.getState().currentEra;
      void audioManager.loadEraAmbience(era);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // React to era changes after the initial mount.
  useEffect(() => {
    const prev = prevEraRef.current;
    prevEraRef.current = currentEra;
    if (prev === null || prev === currentEra) return;
    audioManager.playTransitionSfx(prev, currentEra);
    void audioManager.loadEraAmbience(currentEra);
  }, [currentEra]);

  return null;
}
