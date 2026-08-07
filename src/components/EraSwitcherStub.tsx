import { useEffect } from 'react';
import { useSimStore } from '../state/useSimStore';

/**
 * Placeholder that stubs era switching.
 *
 * This scaffold does not yet implement real cross-era morphs — later tasks
 * author those modules against the shared contracts. For now, whenever a
 * transition is requested and stored, this stub logs the transition path so
 * the app demonstrably runs standalone.
 */
export function EraSwitcherStub() {
  const transition = useSimStore((s) => s.transition);
  const currentEra = useSimStore((s) => s.currentEra);

  useEffect(() => {
    if (transition) {
      console.log(
        `[transition] ${transition.fromEra} -> ${transition.toEra} ` +
          `progress=${transition.progress.toFixed(2)} ` +
          `durationMs=${transition.durationMs}`,
      );
    }
  }, [transition]);

  useEffect(() => {
    console.log(`[era] current era: ${currentEra}`);
  }, [currentEra]);

  return null;
}
