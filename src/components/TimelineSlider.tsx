import { useEraStore } from '../store/useEraStore';
import { ERA_IDS } from '../contracts';

/**
 * Top timeline slider exposing exactly the five era options
 * (1945, 1965, 1985, 2005, 2025). Writes selection to the shared zustand
 * store and is fully keyboard-accessible (arrow keys, Home/End, Enter).
 */
export function TimelineSlider() {
  const currentEra = useEraStore((s) => s.currentEra);
  const requestTransition = useEraStore((s) => s.requestTransition);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = ERA_IDS.indexOf(currentEra);
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp': {
        event.preventDefault();
        const next = Math.min(idx + 1, ERA_IDS.length - 1);
        requestTransition(ERA_IDS[next]);
        break;
      }
      case 'ArrowLeft':
      case 'ArrowDown': {
        event.preventDefault();
        const next = Math.max(idx - 1, 0);
        requestTransition(ERA_IDS[next]);
        break;
      }
      case 'Home': {
        event.preventDefault();
        requestTransition(ERA_IDS[0]);
        break;
      }
      case 'End': {
        event.preventDefault();
        requestTransition(ERA_IDS[ERA_IDS.length - 1]);
        break;
      }
      default:
        break;
    }
  };

  return (
    <div
      className="timeline-slider"
      role="group"
      aria-label="Time period timeline"
      onKeyDown={handleKeyDown}
    >
      {ERA_IDS.map((era) => {
        const active = era === currentEra;
        return (
          <button
            key={era}
            type="button"
            className={`era-option${active ? ' active' : ''}`}
            aria-pressed={active}
            aria-label={`Time period ${era}`}
            data-testid={`era-${era}`}
            onClick={() => requestTransition(era)}
          >
            <span className="era-year">{era}</span>
          </button>
        );
      })}
    </div>
  );
}
