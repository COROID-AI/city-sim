/**
 * TimeSystem.
 *
 * Single source of truth for the in-game clock. The NeedSystem and the
 * renderer both read hour-of-day (0..23) from this system to drive
 * schedule transitions and lighting, so we keep the interface narrow and
 * side-effect free where possible.
 *
 * No React, no DOM, no engine coupling — just a pure tick model.
 */

import { HOURS_PER_DAY } from '@/types/common';

export interface TimeProvider {
  /** Current hour of the day, integer in [0, 23]. */
  getCurrentHour(): number;
  /** Current minute of the hour, integer in [0, 59]. */
  getCurrentMinute(): number;
  /** Total elapsed in-game minutes since game start. */
  getElapsedMinutes(): number;
  /** Returns true if the hour changed since the last call (for tick listeners). */
  hasHourChanged(): boolean;
}

export class TimeSystem implements TimeProvider {
  private elapsedMinutes = 0;
  private lastReportedHour = -1;

  /**
   * Advance the clock. `realDeltaMs` is the wall-clock time elapsed
   * since the previous tick; the simulation can be sped up or slowed
   * down via `timeScale` (e.g. 60 = 1 real second = 1 in-game minute).
   */
  tick(realDeltaMs: number, timeScale = 60): void {
    if (!Number.isFinite(realDeltaMs) || realDeltaMs < 0) return;
    const minutes = (realDeltaMs / 1000) * timeScale;
    this.elapsedMinutes += minutes;
  }

  getCurrentHour(): number {
    return Math.floor((this.elapsedMinutes / 60) % HOURS_PER_DAY);
  }

  getCurrentMinute(): number {
    return Math.floor(this.elapsedMinutes % 60);
  }

  getElapsedMinutes(): number {
    return this.elapsedMinutes;
  }

  /**
   * Returns true exactly once per hour transition. Callers can use this
   * to drive NeedSystem schedule changes without recomputing on every
   * render frame.
   */
  hasHourChanged(): boolean {
    const current = this.getCurrentHour();
    if (current !== this.lastReportedHour) {
      this.lastReportedHour = current;
      return true;
    }
    return false;
  }
}
