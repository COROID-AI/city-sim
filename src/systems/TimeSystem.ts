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
import type { CityEventMap, EventBus } from './EventBus';

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
  private lastDay = 0;
  private bus: EventBus<CityEventMap> | null = null;

  /**
   * Wire an EventBus to this TimeSystem. When a bus is wired,
   * the system emits a `new_day` event on the hour transition
   * from 23 -> 0. The wiring is one-way: re-wiring replaces the
   * previous bus.
   */
  setBus(bus: EventBus<CityEventMap>): void {
    this.bus = bus;
  }

  /**
   * Advance the clock. `realDeltaMs` is the wall-clock time elapsed
   * since the previous tick; the simulation can be sped up or slowed
   * down via `timeScale` (e.g. 60 = 1 real second = 1 in-game minute).
   */
  tick(realDeltaMs: number, timeScale = 60): void {
    if (!Number.isFinite(realDeltaMs) || realDeltaMs < 0) return;
    const minutes = (realDeltaMs / 1000) * timeScale;
    this.elapsedMinutes += minutes;
    // Day-wrap detection: when the in-game day counter changes, fire
    // `new_day`. The wrap occurs at minute N*24*60.
    const newDay = Math.floor(this.elapsedMinutes / (24 * 60));
    if (newDay > this.lastDay) {
      this.lastDay = newDay;
      this.bus?.emit('new_day', {
        day: newDay,
        totalMinutes: Math.floor(this.elapsedMinutes),
      });
    }
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
