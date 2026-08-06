import { useEffect, useRef } from 'react';
import { useEraStore } from '../store/useEraStore';
import { audioManager } from '../audio/WebAudioManager';

/**
 * Glue between the era store and the {@link WebAudioManager}.
 *
 * - Unlocks the audio context on the first user gesture (pointer/keydown) to
 *   satisfy browser autoplay policies, then fades in the current era's bed.
 *
 * Transition audio (the time-shift SFX + ambience crossfade) is triggered by
 * the scene-side transition manager so a single orchestrator drives every
 * morph.
 *
 * Renders nothing; mount it once at the app root.
 */
export function AudioManagerBridge() {
  const currentEra = useEraStore((s) => s.currentEra);
  const currentEraRef = useRef(currentEra);
  currentEraRef.current = currentEra;

  const unlockedRef = useRef(false);

  // First-gesture unlock so audio starts only after a user interaction.
  useEffect(() => {
    const unlock = () => {
      if (unlockedRef.current) return;
      unlockedRef.current = true;
      void audioManager.unlock().then(() => {
        audioManager.crossfadeTo(currentEraRef.current, 800);
      });
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  return null;
}
