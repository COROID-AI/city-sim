import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { ERA_ORDER, ERA_REGISTRY, type EraId } from '../contracts';
import { useEraStore } from '../store/useEraStore';

/**
 * Top timeline slider.
 *
 * Exposes exactly the five era options (1945, 1965, 1985, 2005, 2025) and
 * writes the selection into the shared era store as a transition request.
 * Implements WAI-ARIA radiogroup semantics with arrow-key navigation so it is
 * fully keyboard accessible.
 */
export function TimelineSlider() {
  const currentEra = useEraStore((s) => s.currentEra);
  const requestTransition = useEraStore((s) => s.requestTransition);
  const buttonRefs = useRef<Partial<Record<EraId, HTMLButtonElement | null>>>({});

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIndex = (index + 1) % ERA_ORDER.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIndex = (index - 1 + ERA_ORDER.length) % ERA_ORDER.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = ERA_ORDER.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    const nextEra = ERA_ORDER[nextIndex];
    buttonRefs.current[nextEra]?.focus();
    requestTransition(nextEra);
  };

  return (
    <div className="timeline" role="radiogroup" aria-label="Timeline era selector">
      {ERA_ORDER.map((era, index) => {
        const selected = era === currentEra;
        const descriptor = ERA_REGISTRY[era];
        return (
          <button
            key={era}
            ref={(node) => {
              buttonRefs.current[era] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`Era ${descriptor.label}`}
            className={`timeline-option${selected ? ' is-selected' : ''}`}
            onClick={() => requestTransition(era)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            {descriptor.label}
          </button>
        );
      })}
    </div>
  );
}
