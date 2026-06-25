'use client';

import { useEffect, useRef, useState } from 'react';
import type { TimeSystem, SpeedMultiplier } from '@/systems/TimeSystem';

/**
 * TimeControls — bottom-center overlay for pause/play and speed selection.
 *
 * Spec §6.4: fixed bottom-center pill with pause/play + 1x/2x/5x buttons; the
 * active speed is highlighted with bg-blue-600.
 *
 * Canvas↔React bridge (spec §5.5):
 *  - Button clicks dispatch via the TimeSystem public API (setSpeed/pause).
 *  - No React state is mutated inside the rAF loop. The displayed "active"
 *    speed is polled at 2 Hz via setInterval so the highlight stays in sync
 *    with engine state without coupling React renders to the render loop.
 *
 * Pause/play semantics:
 *  - Pause sets speed to 0.
 *  - Play restores the last non-zero speed the user selected (default 1x),
 *    so resuming after pausing at 5x returns to 5x rather than dropping to 1x.
 */

/** Polling interval (ms) for syncing the active-speed highlight. 2 Hz. */
const POLL_INTERVAL_MS = 500;

interface TimeControlsProps {
  /** Engine time system. Dispatch is imperative via its public API. */
  timeSystem: TimeSystem;
}

export default function TimeControls({ timeSystem }: TimeControlsProps): JSX.Element {
  // Display-only mirror of engine speed. Updated exclusively by the 2 Hz poll,
  // never by the rAF loop (spec §5.5).
  const [displaySpeed, setDisplaySpeed] = useState<SpeedMultiplier>(
    timeSystem.getSpeed(),
  );

  // Last non-zero speed chosen by the user. Restored on play. Defaults to 1
  // (matching TimeSystem's initial speed) so play before any click resumes 1x.
  const lastNonZeroSpeed = useRef<SpeedMultiplier>(1);

  // Keep the highlight in sync with engine state at 2 Hz. Cleanup on unmount.
  useEffect(() => {
    const id = window.setInterval(() => {
      setDisplaySpeed(timeSystem.getSpeed());
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [timeSystem]);

  /** Select a non-zero speed and remember it for later play. */
  const handleSpeed = (multiplier: Exclude<SpeedMultiplier, 0>): void => {
    lastNonZeroSpeed.current = multiplier;
    timeSystem.setSpeed(multiplier);
    setDisplaySpeed(multiplier);
  };

  /** Toggle pause/play. Play restores the last non-zero speed. */
  const handleTogglePause = (): void => {
    if (timeSystem.isPaused()) {
      const restore = lastNonZeroSpeed.current;
      timeSystem.setSpeed(restore);
      setDisplaySpeed(restore);
    } else {
      timeSystem.pause();
      setDisplaySpeed(0);
    }
  };

  const paused = displaySpeed === 0;

  return (
    <div
      className="pointer-events-auto fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-slate-900/70 px-4 py-2 backdrop-blur"
      data-testid="time-controls"
    >
      <button
        type="button"
        onClick={handleTogglePause}
        aria-label={paused ? 'Play' : 'Pause'}
        data-testid="pause-play-button"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700/50 text-white transition hover:bg-slate-600"
      >
        {paused ? '▶' : '⏸'}
      </button>

      {([1, 2, 5] as const).map((mult) => {
        const active = displaySpeed === mult;
        return (
          <button
            key={mult}
            type="button"
            onClick={() => handleSpeed(mult)}
            aria-label={`Set speed ${mult}x`}
            aria-pressed={active}
            data-testid={`speed-${mult}x-button`}
            className={
              active
                ? 'rounded-full bg-blue-600 px-3 py-1 text-sm font-semibold text-white'
                : 'rounded-full bg-slate-700/50 px-3 py-1 text-sm font-medium text-white transition hover:bg-slate-600'
            }
          >
            {mult}x
          </button>
        );
      })}
    </div>
  );
}
