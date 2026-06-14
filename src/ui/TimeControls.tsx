/**
 * TimeControls — fixed-position HUD overlay that drives the TimeSystem.
 *
 * Controlled component: state lives in the parent (CitySimPage). The
 * parent passes the current `paused` flag and `speed` multiplier; the
 * parent wires the buttons to TimeSystem.setSpeed / pause / resume.
 *
 * Renders one pause/play button plus four speed multipliers (1×, 2×,
 * 4×, 8×). The currently selected speed is highlighted.
 *
 * 'use client' is required because we forward DOM event handlers.
 */

'use client';

import { type ReactNode } from 'react';

export const TIME_CONTROL_SPEEDS: readonly number[] = [1, 2, 4, 8] as const;

export interface TimeControlsProps {
  /** Whether the simulation is currently paused. */
  paused: boolean;
  /** Current speed multiplier (one of TIME_CONTROL_SPEEDS or 0). */
  speed: number;
  /** Current in-world hour (0..24, may be fractional). */
  hour: number;
  /** Current in-world day number, starting at 1. */
  day: number;
  /** Invoked when the user toggles pause. */
  onTogglePause: () => void;
  /** Invoked when the user picks a new speed multiplier. */
  onSetSpeed: (multiplier: number) => void;
}

/**
 * Render the time-control HUD. The component is intentionally
 * presentation-only — it never holds simulation state itself.
 */
export function TimeControls(props: TimeControlsProps): ReactNode {
  const { paused, speed, hour, day, onTogglePause, onSetSpeed } = props;
  return (
    <div
      role="toolbar"
      aria-label="Time controls"
      data-testid="time-controls"
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderRadius: 8,
        background: 'rgba(11, 18, 32, 0.78)',
        color: '#e6ecf5',
        font: '13px/1.2 system-ui, -apple-system, Segoe UI, sans-serif',
        backdropFilter: 'blur(6px)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
        userSelect: 'none',
      }}
    >
      <ClockReadout hour={hour} day={day} />
      <Divider />
      <IconButton
        label={paused ? 'Resume' : 'Pause'}
        onClick={onTogglePause}
        testId="time-pause"
      >
        {paused ? <PlayIcon /> : <PauseIcon />}
      </IconButton>
      <Divider />
      {TIME_CONTROL_SPEEDS.map((s) => (
        <SpeedButton
          key={s}
          multiplier={s}
          active={!paused && speed === s}
          onClick={() => onSetSpeed(s)}
        />
      ))}
    </div>
  );
}

function ClockReadout({ hour, day }: { hour: number; day: number }): ReactNode {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - h) * 60) % 60;
  const hh = h.toString().padStart(2, '0');
  const mm = m.toString().padStart(2, '0');
  return (
    <div
      data-testid="time-readout"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        marginRight: 4,
        minWidth: 64,
      }}
    >
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        {hh}:{mm}
      </span>
      <span style={{ fontSize: 11, opacity: 0.7 }}>Day {day}</span>
    </div>
  );
}

function Divider(): ReactNode {
  return (
    <span
      aria-hidden
      style={{
        width: 1,
        alignSelf: 'stretch',
        background: 'rgba(255,255,255,0.12)',
        margin: '0 4px',
      }}
    />
  );
}

function IconButton({
  label,
  onClick,
  children,
  testId,
}: {
  label: string;
  onClick: () => void;
  children?: ReactNode;
  testId?: string;
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid={testId}
      style={btnStyle(false)}
    >
      {children}
    </button>
  );
}

function SpeedButton({
  multiplier,
  active,
  onClick,
}: {
  multiplier: number;
  active: boolean;
  onClick: () => void;
  /**
   * React `key` is a reserved prop that is not part of the component's
   * own props, but TypeScript requires us to declare it in the props
   * object shape so JSX <SpeedButton key={s} …/> typechecks. We never
   * read it inside the component.
   */
  key?: React.Key;
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={`Speed ${multiplier}×`}
      aria-pressed={active}
      data-testid={`time-speed-${multiplier}`}
      onClick={onClick}
      style={btnStyle(active)}
    >
      {multiplier}×
    </button>
  );
}

function btnStyle(active: boolean): React.CSSProperties {
  return {
    appearance: 'none',
    border: '1px solid rgba(255,255,255,0.18)',
    background: active ? 'rgba(58,160,255,0.25)' : 'rgba(255,255,255,0.06)',
    color: '#e6ecf5',
    borderRadius: 6,
    padding: '4px 10px',
    minWidth: 32,
    cursor: 'pointer',
    font: 'inherit',
    fontWeight: active ? 600 : 500,
  };
}

function PlayIcon(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M2 1.5 L10 6 L2 10.5 Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <rect x="2" y="2" width="3" height="8" fill="currentColor" />
      <rect x="7" y="2" width="3" height="8" fill="currentColor" />
    </svg>
  );
}
