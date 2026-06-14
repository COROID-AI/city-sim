'use client';

/**
 * TimeControls - play/pause/speed UI for the simulation clock.
 * Client component: receives the TimeSystem via a ref-like controller so
 * the simulation layer (src/systems) never imports React.
 */

import * as React from 'react';

export type SimulationSpeed = 0 | 1 | 2 | 4;

export interface TimeController {
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  getSpeed(): SimulationSpeed;
  setSpeed(speed: SimulationSpeed): void;
}

export interface TimeControlsProps {
  readonly controller: TimeController;
}

const SPEED_OPTIONS: ReadonlyArray<{ label: string; value: SimulationSpeed }> = [
  { label: '1x', value: 1 },
  { label: '2x', value: 2 },
  { label: '4x', value: 4 },
];

export function TimeControls({ controller }: TimeControlsProps): React.JSX.Element {
  const [, force] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    const id = window.setInterval(force, 250);
    return () => window.clearInterval(id);
  }, []);

  const paused = controller.isPaused();
  const speed = controller.getSpeed();

  return (
    <div className="time-controls" data-testid="time-controls">
      <button
        type="button"
        aria-pressed={paused}
        onClick={() => controller.setPaused(!paused)}
        className="time-controls__play"
      >
        {paused ? 'Play' : 'Pause'}
      </button>
      <div className="time-controls__speeds" role="radiogroup" aria-label="Simulation speed">
        {SPEED_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={speed === opt.value}
            onClick={() => controller.setSpeed(opt.value)}
            className="time-controls__speed"
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default TimeControls;
