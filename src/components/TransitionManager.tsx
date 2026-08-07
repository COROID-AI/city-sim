import { createContext, useContext, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { useEraStore } from '../store/useEraStore';
import type { TransitionContext } from '../contracts';

/**
 * React context that carries the live {@link TransitionContext} to every
 * scene module so they can crossfade / blend during an era morph. It is
 * `null` while the scene is idle (fully in the current era).
 */
const TransitionContextCtx = createContext<TransitionContext | null>(null);

/** Read the live transition context (null when no morph is in flight). */
export function useTransition(): TransitionContext | null {
  return useContext(TransitionContextCtx);
}

/**
 * Transition orchestrator.
 *
 * Lives inside the Canvas and watches the era store for a transition
 * request. While one is in flight it drives a {@link TransitionContext}
 * (fromEra, toEra, progress 0..1 over durationMs) on every frame and exposes
 * it via context so the scene can crossfade/swap every element. When the
 * morph completes it clears the request and the scene settles back to the
 * current (target) era.
 */
export function TransitionManager({ children }: { children: ReactNode }) {
  const transitionRequest = useEraStore((s) => s.transitionRequest);
  const clearTransition = useEraStore((s) => s.clearTransition);
  const [transition, setTransition] = useState<TransitionContext | null>(null);

  useFrame(() => {
    if (!transitionRequest) {
      if (transition !== null) setTransition(null);
      return;
    }

    const elapsed = Date.now() - transitionRequest.requestedAt;
    const progress = Math.min(1, elapsed / transitionRequest.durationMs);
    setTransition({
      fromEra: transitionRequest.fromEra,
      toEra: transitionRequest.toEra,
      progress,
      durationMs: transitionRequest.durationMs,
    });

    if (progress >= 1) clearTransition();
  });

  return (
    <TransitionContextCtx.Provider value={transition}>
      {children}
    </TransitionContextCtx.Provider>
  );
}
