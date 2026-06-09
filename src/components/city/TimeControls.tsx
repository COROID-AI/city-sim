'use client';

/**
 * TimeControls — compact HUD overlay for the simulation clock.
 *
 * Anchored to the top-right of the city view. Renders a pause/play
 * toggle and a row of speed presets ({0, 1, 2, 5, 10}). All
 * interactions dispatch through the engine's `setSpeed` / `pause` /
 * `resume` API, so the controls never mutate simulation state
 * directly.
 *
 * Visual direction: dark, translucent, pill-shaped, icon + numeric
 * label. Styled to match the city palette (`bg-surface/70`,
 * `text-foreground`, `border-foreground/10`).
 */

import { useEffect, useState, type Ref } from 'react';
import { SPEED_PRESETS, type TimeState } from '@/systems';
import type { CityViewEngineHandle } from './CityView';

export interface TimeControlsProps {
  /** Ref to the CityView engine handle. Optional — controls are inert if null. */
  engineRef: Ref<CityViewEngineHandle | null> | undefined;
  /** Optional additional class for the outer pill. */
  className?: string;
}

const BASE_BTN =
  'inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md ' +
  'px-2 text-xs font-medium tabular-nums transition-colors ' +
  'border border-foreground/10 bg-surface/40 text-foreground/80 ' +
  'hover:bg-surface/70 hover:text-foreground focus:outline-none ' +
  'focus-visible:ring-1 focus-visible:ring-accent';
const ACTIVE_BTN =
  'inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md ' +
  'px-2 text-xs font-semibold tabular-nums transition-colors ' +
  'border border-accent/60 bg-accent/20 text-foreground ' +
  'shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]';
const PAUSE_BTN =
  'inline-flex h-7 w-7 items-center justify-center rounded-md ' +
  'border border-foreground/10 bg-surface/40 text-foreground/90 ' +
  'hover:bg-surface/70 focus:outline-none focus-visible:ring-1 ' +
  'focus-visible:ring-accent';

export function TimeControls({ engineRef, className }: TimeControlsProps): JSX.Element {
  // The engine handle is a ref object (current is mutable). We track
  // the speed locally so the UI updates on click, and we poll the
  // engine state for cross-component changes (e.g. from elsewhere).
  const [speed, setSpeed] = useState<number>(1);
  const [paused, setPaused] = useState<boolean>(false);
  const [simTimeLabel, setSimTimeLabel] = useState<string>('00:00');

  // Read the engine's state at mount and whenever our ref object is
  // (re)assigned. We don't poll the engine every frame; the UI is
  // event-driven via the buttons.
  useEffect(() => {
    const handle = readEngine(engineRef);
    if (handle === null) return;
    const ts: TimeState = handle.getTimeState();
    setSpeed(ts.speed);
    setPaused(ts.speed === 0);
    setSimTimeLabel(formatSimTime(ts.simTime));
  }, [engineRef]);

  const onTogglePause = (): void => {
    const handle = readEngine(engineRef);
    if (handle === null) return;
    if (paused) {
      handle.resume();
      setPaused(false);
    } else {
      handle.pause();
      setPaused(true);
    }
  };

  const onPickSpeed = (next: number): void => {
    const handle = readEngine(engineRef);
    if (handle === null) return;
    handle.setSpeed(next);
    setSpeed(next);
    setPaused(next === 0);
  };

  return (
    <div
      data-time-controls
      data-no-pan="true"
      className={
        'pointer-events-auto inline-flex items-center gap-1 rounded-full ' +
        'border border-foreground/10 bg-surface/70 px-2 py-1 ' +
        'backdrop-blur-sm shadow-lg ' +
        (className ?? '')
      }
    >
      <button
        type="button"
        aria-label={paused ? 'Resume simulation' : 'Pause simulation'}
        data-no-pan="true"
        className={PAUSE_BTN}
        onClick={onTogglePause}
      >
        {paused ? (
          // Play triangle
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden={true}>
            <path d="M4 3 L13 8 L4 13 Z" fill="currentColor" />
          </svg>
        ) : (
          // Pause bars
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden={true}>
            <rect x="4" y="3" width="3" height="10" fill="currentColor" />
            <rect x="9" y="3" width="3" height="10" fill="currentColor" />
          </svg>
        )}
      </button>
      <span
        aria-hidden={true}
        className="mx-1 h-4 w-px bg-foreground/15"
      />
      {SPEED_PRESETS.map((preset) => {
        const active = !paused && Math.abs(speed - preset) < 1e-9;
        return (
          <button
            type="button"
            aria-label={`Set speed ${preset}x`}
            aria-pressed={active}
            data-no-pan="true"
            className={active ? ACTIVE_BTN : BASE_BTN}
            onClick={(): void => onPickSpeed(preset)}
          >
            {preset}×
          </button>
        );
      })}
      <span
        aria-hidden={true}
        className="mx-1 h-4 w-px bg-foreground/15"
      />
      <span
        data-time-readout
        className="px-1.5 text-[10px] font-mono tabular-nums text-foreground/70"
      >
        {simTimeLabel}
      </span>
    </div>
  );
}

function readEngine(
  ref: Ref<CityViewEngineHandle | null> | undefined,
): CityViewEngineHandle | null {
  if (ref === undefined || ref === null) return null;
  // A Ref<T> in our react-stub.d.ts is { current: T | null }.
  if (typeof ref !== 'object' || ref === null) return null;
  const r = ref as { current: CityViewEngineHandle | null | undefined };
  return r.current ?? null;
}

/** Format sim-seconds as HH:MM (24h). */
function formatSimTime(simTime: number): string {
  const total = Math.max(0, Math.floor(simTime));
  const hours = Math.floor(total / 3600) % 24;
  const minutes = Math.floor(total / 60) % 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default TimeControls;
