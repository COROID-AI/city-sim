import { useCallback, useRef } from 'react';
import { ERA_IDS, ERA_REGISTRY } from '../contracts/era';
import type { EraId } from '../contracts/era';
import { useCityStore } from '../store/useCityStore';

/**
 * Top timeline slider exposing exactly the five era options (1945, 1965,
 * 1985, 2005, 2025). Keyboard accessible: each option is a focusable button
 * (Tab to reach, Enter/Space to activate) and arrow keys move between eras.
 */
export function TimelineSlider() {
  const currentEra = useCityStore((s) => s.currentEra);
  const requestTransition = useCityStore((s) => s.requestTransition);
  const buttonRefs = useRef<Record<EraId, HTMLButtonElement | null>>({
    1945: null,
    1965: null,
    1985: null,
    2005: null,
    2025: null,
  });

  const focusEra = useCallback((era: EraId) => {
    buttonRefs.current[era]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const index = ERA_IDS.indexOf(currentEra);
      let nextIndex = -1;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = index + 1;
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = index - 1;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = ERA_IDS.length - 1;
      }

      if (nextIndex >= 0 && nextIndex < ERA_IDS.length) {
        event.preventDefault();
        const nextEra = ERA_IDS[nextIndex];
        if (nextEra !== currentEra) {
          requestTransition(nextEra);
        }
        focusEra(nextEra);
      }
    },
    [currentEra, requestTransition, focusEra],
  );

  return (
    <div
      className="timeline"
      role="toolbar"
      aria-label="Time period timeline"
      onKeyDown={handleKeyDown}
    >
      {ERA_IDS.map((era) => {
        const descriptor = ERA_REGISTRY[era];
        const active = era === currentEra;
        return (
          <button
            key={era}
            ref={(node) => {
              buttonRefs.current[era] = node;
            }}
            type="button"
            className={`timeline-option${active ? ' is-active' : ''}`}
            aria-pressed={active}
            onClick={() => requestTransition(era)}
          >
            <span className="timeline-year">{descriptor.year}</span>
            <span className="timeline-label">{descriptor.label}</span>
          </button>
        );
      })}
    </div>
  );
}
