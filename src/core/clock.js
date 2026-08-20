/**
 * Fixed-timestep real-time simulation clock.
 *
 * The clock advances sim-hours based on real elapsed time at a tunable rate
 * (SECONDS_PER_SIM_HOUR). It exposes the current sim-hour, sim-day, and a
 * normalized day/night phase (0-1), and lets modules subscribe to receive a
 * tick callback every sim-hour — economy and agent updates hook in here.
 */

import { CONFIG } from './config.js';

export class SimClock {
  /**
   * @param {object} config  Tunables (see src/core/config.js).
   * @param {number} startHour  Initial sim-hour of the day.
   */
  constructor(config = CONFIG, startHour = 6) {
    this._config = config;
    this._simHour = startHour;
    this._simDay = 1;
    this._accumMs = 0;
    this._lastMs = null;
    this._subscribers = new Set();
    this._hourMs = config.SECONDS_PER_SIM_HOUR * 1000;
  }

  /**
   * Start the clock from a real-time reference point.
   * @param {number} nowMs Real elapsed milliseconds (e.g. performance.now()).
   */
  start(nowMs) {
    this._lastMs = nowMs;
    this._accumMs = 0;
  }

  /**
   * Advance the clock by the real elapsed time since the last tick. Called
   * once per frame from the render loop. Emits a subscriber callback for each
   * completed sim-hour boundary.
   * @param {number} nowMs Real elapsed milliseconds.
   */
  tick(nowMs) {
    if (this._lastMs === null) {
      this.start(nowMs);
      return;
    }
    const elapsed = nowMs - this._lastMs;
    this._lastMs = nowMs;
    if (elapsed < 0) return;

    this._accumMs += elapsed;
    while (this._accumMs >= this._hourMs) {
      this._accumMs -= this._hourMs;
      this._simHour++;
      if (this._simHour >= this._config.SIM_HOURS_PER_DAY) {
        this._simHour = 0;
        this._simDay++;
      }
      for (const cb of this._subscribers) cb(this);
    }
  }

  /** Subscribe to a per-sim-hour tick. @param {(clock: SimClock) => void} cb */
  subscribe(cb) {
    this._subscribers.add(cb);
    return () => this._subscribers.delete(cb);
  }

  /** @returns {number} Current hour of the day, 0-23. */
  get simHour() {
    return this._simHour;
  }

  /** @returns {number} 1-based day number. */
  get simDay() {
    return this._simDay;
  }

  /** @returns {number} Normalized day/night phase 0-1 (0=midnight, 0.5=noon). */
  get dayPhase() {
    return this._simHour / this._config.SIM_HOURS_PER_DAY;
  }

  /** @returns {SimTime} Snapshot of the current simulation time. */
  get simTime() {
    return {
      simHour: this._simHour,
      simDay: this._simDay,
      dayPhase: this.dayPhase,
    };
  }
}