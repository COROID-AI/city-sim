import { useEffect, useRef } from 'react';
import { useSceneStore } from '../state/useSceneStore';
import { ERA_COUNT } from '../state/timePeriods';

/**
 * Auto-play timelapse: advances the era position continuously when playing,
 * looping through all eras. Also advances the day/night cycle so the sun keeps
 * moving during playback. Respects prefers-reduced-motion by still applying
 * final states but skipping autonomous frame advancement.
 */
export function useTimelapsePlayback() {
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number>(0);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      if (lastRef.current === 0) lastRef.current = now;
      const dt = Math.min(0.2, (now - lastRef.current) / 1000);
      lastRef.current = now;

      const s = useSceneStore.getState();
      if (s.playing) {
        if (reduced) {
          // Reduced motion: still cycle but at a sedate pace.
          useSceneStore.getState().scrubTo(
            (s.position + dt * 0.12 * (ERA_COUNT - 1)) % ERA_COUNT,
          );
          useSceneStore.getState().setDayTime((s.dayTime + dt * 0.01) % 1);
        } else {
          const speed = 0.16; // era per second, full loop ~37s
          useSceneStore.getState().scrubTo(
            (s.position + dt * speed * (ERA_COUNT - 1)) % ERA_COUNT,
          );
          useSceneStore.getState().setDayTime((s.dayTime + dt * 0.02) % 1);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);
}