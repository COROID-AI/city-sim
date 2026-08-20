import { useEffect } from 'react';
import { useSceneStore } from '../state/useSceneStore';
import { ERA_COUNT, ERA_LABELS } from '../state/timePeriods';

/**
 * Global keyboard controls:
 *  - ArrowLeft/ArrowRight: move one era (looping)
 *  - Space: toggle auto-play
 *  - R: reset camera / timeline to start
 *  - M: toggle mute
 *  - +/-: raise/lower volume
 *  - Up/Down: day/night scrub (hold to scrub)
 */
export function useKeyboardControls() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in an input.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const s = useSceneStore.getState();
      switch (e.key) {
        case 'ArrowLeft': {
          e.preventDefault();
          const next = (s.position - 1 + ERA_COUNT) % ERA_COUNT;
          s.scrubTo(next);
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const next = (s.position + 1) % ERA_COUNT;
          s.scrubTo(next);
          break;
        }
        case ' ':
        case 'Spacebar': {
          e.preventDefault();
          s.togglePlayback();
          break;
        }
        case 'r':
        case 'R': {
          s.scrubTo(0);
          s.setDayTime(0.72);
          s.setCameraDistance(19);
          break;
        }
        case 'm':
        case 'M': {
          s.toggleMute();
          break;
        }
        case '+':
        case '=': {
          e.preventDefault();
          s.setVolume(Math.min(1, s.volume + 0.1));
          break;
        }
        case '-':
        case '_': {
          e.preventDefault();
          s.setVolume(Math.max(0, s.volume - 0.1));
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          s.setDayTime(s.dayTime + 0.02);
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          s.setDayTime(s.dayTime - 0.02);
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}