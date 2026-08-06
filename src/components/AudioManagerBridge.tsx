import { useEffect, useRef } from 'react';
import { useEraStore } from '../store/useEraStore';
import { audioManager } from '../audio/WebAudioManager';

/**
 * Glue between the era store and the {@link WebAudioManager}.
 *
 * - Unlocks the audio context on the first user gesture (pointer/keydown) to
 *   satisfy browser autoplay policies, then fades in the current era's bed.
 * - On every era transition it plays the synthesized time-shift SFX and
 *   crossfades the ambience beds over the transition duration.
 *
 * Renders nothing; mount it once at the app root.
 */
export function AudioManagerBridge() {
  const transition = useEraStore((s) => s.transition);
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

  // Drive ambience crossfade + transition SFX on era change.
  useEffect(() => {
    if (!transition) return;
    // Ensure the context is unlocked even if the gesture listener was missed.
    void audioManager.unlock();
    audioManager.playTransitionSfx(transition.fromEra, transition.toEra);
    audioManager.crossfadeTo(transition.toEra, transition.durationMs);
  }, [transition]);

  return null;
}
