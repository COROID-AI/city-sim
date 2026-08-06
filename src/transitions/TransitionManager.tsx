import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTransitionProgress } from '../hooks/useTransitionProgress';
import { audioManager } from '../audio/WebAudioManager';
import { SceneTransitionContext } from './SceneTransitionContext';
import type { SceneTransitionValue } from './SceneTransitionContext';

/**
 * Era-transition orchestrator.
 *
 * Drives a {@link TransitionContext} (fromEra -> toEra, progress 0..1 over
 * durationMs) from the era store's pending transition request and publishes it
 * to every composed module through React context. Also triggers the transition
 * SFX and crossfades the era ambience through the shared Web Audio manager so
 * audio stays in lock step with the visual morph.
 */
export function TransitionManager({ children }: { children: ReactNode }) {
  const { transition, progress } = useTransitionProgress();

  const value = useMemo<SceneTransitionValue>(() => {
    if (!transition) {
      return { transition: null, progress: 1 };
    }
    return {
      transition: {
        fromEra: transition.fromEra,
        toEra: transition.toEra,
        progress,
        durationMs: transition.durationMs,
      },
      progress,
    };
  }, [transition, progress]);

  // Trigger transition SFX + ambience crossfade for every new morph request.
  useEffect(() => {
    if (!transition) return;
    void audioManager.unlock();
    audioManager.playTransitionSfx(transition.fromEra, transition.toEra);
    audioManager.crossfadeTo(transition.toEra, transition.durationMs);
  }, [transition]);

  return (
    <SceneTransitionContext.Provider value={value}>{children}</SceneTransitionContext.Provider>
  );
}
