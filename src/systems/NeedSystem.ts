/**
 * NeedSystem — decays and replenishes citizen needs (hunger, energy, fun).
 *
 * Spec (7.3):
 *  - Hunger, energy, and fun are continuous values in [0, 1].
 *  - Each tick (driven by `dtHours`, in in-world hours) every need
 *    decays by `NEED_DECAY_PER_HOUR` (when not in a replenishing state)
 *    or replenishes by `NEED_REPLENISH_PER_HOUR` (when in a state
 *    that addresses that need).
 *  - Values are clamped to [0, 1].
 *
 * Decay/replenish matrix (per hour, at the default rate):
 *
 *                      | hunger  | energy  | fun
 *  -------------------+---------+---------+------
 *   sleeping          |  -0.02  |  +0.30  |  -0.02
 *   commuting         |  -0.10  |  -0.10  |  -0.05
 *   working           |  -0.15  |  -0.15  |  -0.10
 *   leisure           |  -0.05  |  -0.05  |  +0.30
 *   errand            |  -0.20  |  -0.05  |  -0.05
 *   shopping          |  -0.20  |  -0.05  |  +0.05
 *   idle / unknown    |  -0.05  |  -0.05  |  -0.05
 *
 * Layer rule: this module is pure TypeScript. It must NOT import React,
 * DOM globals, or the `World` class. It receives `world` as a parameter
 * and uses the `World.citizens_()` iterator (the structural interface
 * is enough — TypeScript erases it at runtime). It also reads each
 * citizen's schedule via the `schedules` map.
 */

import type { Citizen } from '@/engine/types';
import type { Rng } from '@/generation/random';
import { pickActivityFor, type Activity } from '@/entities/Citizen';
import type { Schedule } from './ScheduleGenerator';

/* -------------------------------------------------------------------------- */
/* Tunables                                                                   */
/* -------------------------------------------------------------------------- */

/** Default per-hour decay for an unaddressed need. */
export const NEED_DECAY_PER_HOUR = 0.1;
/** Default per-hour replenish for an addressed need. */
export const NEED_REPLENISH_PER_HOUR = 0.3;

/* -------------------------------------------------------------------------- */
/* Decay / replenish matrix                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Per-activity, per-need delta (per hour). Values are deltas — positive
 * means replenish, negative means decay. The table is exported so
 * tests and the UI can inspect the constants without re-deriving them.
 */
export const NEED_DELTAS: Readonly<Record<Activity, Readonly<Record<'hunger' | 'energy' | 'fun', number>>>> = {
  sleeping: { hunger: -0.02, energy: 0.3, fun: -0.02 },
  commuting: { hunger: -0.1, energy: -0.1, fun: -0.05 },
  working: { hunger: -0.15, energy: -0.15, fun: -0.1 },
  leisure: { hunger: -0.05, energy: -0.05, fun: 0.3 },
  errand: { hunger: -0.2, energy: -0.05, fun: -0.05 },
};

/* -------------------------------------------------------------------------- */
/* Minimal world view                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The structural shape NeedSystem needs from the world. Declared as
 * an interface (not a class import) so the systems layer doesn't
 * pull in the engine module. `World` already implements this exact
 * shape — it exposes `citizens_(): IterableIterator<Citizen>`.
 */
export interface NeedSystemWorldView {
  citizens_(): IterableIterator<Citizen>;
}

/* -------------------------------------------------------------------------- */
/* Schedule view                                                              */
/* -------------------------------------------------------------------------- */

/** Per-citizen schedule. Keys are citizen ids. */
export type ScheduleMap = ReadonlyMap<string, Schedule>;

/* -------------------------------------------------------------------------- */
/* NeedSystem                                                                 */
/* -------------------------------------------------------------------------- */

export interface NeedSystemOptions {
  /** Override the default decay rate. */
  readonly decayPerHour?: number;
  /** Override the default replenish rate. */
  readonly replenishPerHour?: number;
}

/**
 * Stateless need computer. The simulation is expected to call
 * `tick(world, dtHours, schedules)` once per fixed step, then read
 * the (mutated) needs off each citizen.
 *
 * The system is intentionally side-effect-only on the citizens
 * themselves — it never reads the clock. Callers pass the elapsed
 * in-world hours directly, keeping the system trivially testable.
 */
export class NeedSystem {
  private readonly decayPerHour: number;
  private readonly replenishPerHour: number;

  constructor(options: NeedSystemOptions = {}) {
    const decay = options.decayPerHour ?? NEED_DECAY_PER_HOUR;
    const replenish = options.replenishPerHour ?? NEED_REPLENISH_PER_HOUR;
    if (!Number.isFinite(decay) || decay < 0) {
      throw new RangeError(`NeedSystem: decayPerHour must be >= 0 (got ${decay})`);
    }
    if (!Number.isFinite(replenish) || replenish < 0) {
      throw new RangeError(`NeedSystem: replenishPerHour must be >= 0 (got ${replenish})`);
    }
    this.decayPerHour = decay;
    this.replenishPerHour = replenish;
  }

  /**
   * Apply need deltas to every citizen in `world` over `dtHours`
   * in-world hours. `schedules` is keyed by citizen id; missing
   * entries fall back to an empty schedule (treated as unemployed).
   * `now` is the current in-world hour of day (0..24) used to look
   * up the citizen's activity.
   */
  tick(
    world: NeedSystemWorldView,
    dtHours: number,
    schedules: ScheduleMap,
    now: number,
  ): void {
    if (!Number.isFinite(dtHours) || dtHours < 0) {
      throw new RangeError(`NeedSystem.tick: dtHours must be >= 0 (got ${dtHours})`);
    }
    if (dtHours === 0) return;

    for (const citizen of world.citizens_()) {
      const schedule = schedules.get(citizen.id) ?? { work: null, id: `sched-fallback-${citizen.id}` };
      const isEmployed = schedule.work !== null;
      const activity = pickActivityFor(now, isEmployed, schedule);
      const deltas = NEED_DELTAS[activity];
      // Scale by dtHours so the per-hour rate is honoured for any tick size.
      // We interpolate between the table's actual value and the default
      // rate so the system stays tunable without re-deriving the matrix.
      const dh = deltas.hunger * dtHours;
      const de = deltas.energy * dtHours;
      const df = deltas.fun * dtHours;
      citizen.hunger = clamp01(citizen.hunger + this.scaledDelta(dh));
      citizen.energy = clamp01(citizen.energy + this.scaledDelta(de));
      citizen.fun = clamp01(citizen.fun + this.scaledDelta(df));
    }
  }

  /**
   * Scale a per-hour delta by the configured decay/replenish rates.
   * Decay magnitudes shrink towards the configured `decayPerHour`
   * floor; replenish magnitudes scale up to the configured
   * `replenishPerHour` ceiling. This keeps the matrix tunable
   * from a single knob without losing the per-activity variance.
   */
  private scaledDelta(delta: number): number {
    if (delta >= 0) {
      // Positive deltas are replenishment. Normalise to the
      // configured replenish rate so the strongest activity
      // (sleeping for energy) is `replenishPerHour` per hour.
      return delta === 0 ? 0 : (delta / 0.3) * this.replenishPerHour;
    }
    // Negative deltas are decay. Use the most-negative table entry
    // (working.hunger = -0.15) as the reference; scale everything
    // relative to the configured decay rate. The sign stays negative.
    return -(Math.abs(delta) / 0.15) * this.decayPerHour;
  }
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/* -------------------------------------------------------------------------- */
/* Optional explicit-rate variant                                             */
/* -------------------------------------------------------------------------- */

/**
 * Compute a single need's new value given the activity, current
 * value, and elapsed hours. Pure function for unit tests; the
 * `NeedSystem.tick` path uses the matrix directly.
 */
export function computeNeed(
  need: 'hunger' | 'energy' | 'fun',
  activity: Activity,
  current: number,
  dtHours: number,
  decayPerHour: number = NEED_DECAY_PER_HOUR,
  replenishPerHour: number = NEED_REPLENISH_PER_HOUR,
): number {
  if (!Number.isFinite(dtHours) || dtHours < 0) {
    throw new RangeError(`computeNeed: dtHours must be >= 0 (got ${dtHours})`);
  }
  const raw = NEED_DELTAS[activity][need] * dtHours;
  const scaled =
    raw >= 0
      ? (raw / 0.3) * replenishPerHour
      : -(Math.abs(raw) / 0.15) * decayPerHour;
  return clamp01(current + scaled);
}

// Re-export Rng type-only for consumers that want to construct a
// schedule for testing without pulling in the generation barrel.
export type { Rng };
