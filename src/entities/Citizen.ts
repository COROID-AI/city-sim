/**
 * Citizen entity — runtime inhabitants of the city.
 *
 * The `Citizen` interface itself lives in `@/engine/types` (the single
 * source of truth, per `engine_types_for_generation`). This module:
 *
 *  1. Re-exports `Citizen` and `CitizenState` for downstream consumers
 *     that import from `@/entities` (the entities layer is the public
 *     surface for game-logic-facing shapes).
 *  2. Adds an `Activity` union (5-state activity machine) and
 *     `pickActivityFor(hour, isEmployed, schedule)` which decides which
 *     broad activity a citizen is engaged in given the current hour and
 *     their per-day schedule. This is the function the rest of the
 *     simulation calls to update `Citizen.state`.
 *  3. Provides a `createCitizen(opts)` factory used by `CityGenerator`
 *     and tests.
 *  4. Provides `setState(citizen, next)` — a pure helper that performs
 *     a state transition with input validation.
 *
 * Layer rule: this module is pure TypeScript. It must NOT import React,
 * DOM globals, or the `World` class. It may import engine *types* via
 * `@/engine` (structural, erased at runtime), but it does not even need
 * to — it uses the local `Citizen`/`CitizenState` re-exports and a
 * structurally-compatible shape.
 */

import type { Citizen, CitizenState, Vector2 } from '@/engine/types';
import type { Schedule } from '@/systems/ScheduleGenerator';

/* -------------------------------------------------------------------------- */
/* Re-exports                                                                 */
/* -------------------------------------------------------------------------- */

export type { Citizen, CitizenState } from '@/engine/types';

/* -------------------------------------------------------------------------- */
/* Activity union (5-state activity machine)                                  */
/* -------------------------------------------------------------------------- */

/**
 * The 5-state activity machine, distinct from the lower-level
 * `CitizenState` runtime flag. Activities describe *what* the citizen is
 * doing this hour; `CitizenState` is the system's view of the same
 * information (a slightly coarser label used by the renderer).
 *
 * The two are 1:1 (except for a small `idle` fallback) so that
 * `setState` can always go from activity → CitizenState without losing
 * information.
 */
export type Activity = 'sleeping' | 'commuting' | 'working' | 'leisure' | 'errand';

/* -------------------------------------------------------------------------- */
/* State mapping                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Map an `Activity` to the lower-level `CitizenState` runtime flag.
 * Centralised so the renderer, tooltip, and renderer tests agree on
 * the mapping.
 */
export function activityToState(activity: Activity): CitizenState {
  switch (activity) {
    case 'sleeping':
      return 'resting';
    case 'commuting':
      return 'commuting';
    case 'working':
      return 'working';
    case 'leisure':
      return 'leisure';
    case 'errand':
      return 'shopping';
  }
}

/* -------------------------------------------------------------------------- */
/* Citizen factory                                                            */
/* -------------------------------------------------------------------------- */

export interface CreateCitizenOptions {
  /** Unique id; required. */
  readonly id: string;
  /** Display name; required. */
  readonly name: string;
  /** Home building id, if any. */
  readonly homeId?: string | null;
  /** Workplace building id, if any. */
  readonly workId?: string | null;
  /** Initial world position in world units. Defaults to (0, 0). */
  readonly position?: Vector2;
  /** Initial needs. Defaults to 1 (fully replenished). */
  readonly hunger?: number;
  readonly energy?: number;
  readonly fun?: number;
}

/**
 * Build a new Citizen with sensible defaults. Pure function — no
 * side effects, no time, no RNG.
 */
export function createCitizen(options: CreateCitizenOptions): Citizen {
  return {
    id: options.id,
    name: options.name,
    homeId: options.homeId ?? null,
    workId: options.workId ?? null,
    position: options.position ?? { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    state: 'idle',
    hunger: clamp01(options.hunger ?? 1),
    energy: clamp01(options.energy ?? 1),
    fun: clamp01(options.fun ?? 1),
  };
}

/* -------------------------------------------------------------------------- */
/* State transition helper                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Set the runtime state on a citizen, with input validation. Mutates
 * and returns the same citizen (for fluent use in systems).
 *
 * Throws `RangeError` if `next` is not a valid `CitizenState`.
 */
export function setState(citizen: Citizen, next: CitizenState): Citizen {
  if (!isCitizenState(next)) {
    throw new RangeError(`setState: unknown CitizenState "${next}"`);
  }
  citizen.state = next;
  return citizen;
}

function isCitizenState(v: string): v is CitizenState {
  return (
    v === 'idle' ||
    v === 'commuting' ||
    v === 'working' ||
    v === 'shopping' ||
    v === 'resting' ||
    v === 'leisure'
  );
}

/* -------------------------------------------------------------------------- */
/* Activity picker                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Decide which broad activity a citizen is doing at the given hour.
 *
 * The logic mirrors the schedule shape generated by
 * `ScheduleGenerator`:
 *  - Employed citizens have a `work` block that overlaps the day's
 *    working window (8–17 by default). Outside the work block they
 *    follow a simple life pattern: sleep at night, leisure in the
 *    evening, commute in the morning/evening.
 *  - Unemployed citizens have no `work` block: they sleep at night,
 *    take a midday "errand" slot, and spend the rest of the day on
 *    leisure.
 *
 * `hour` is in the [0, 24) range, matching `CityTime.hour`. The result
 * is deterministic for a given (hour, isEmployed, schedule) triple,
 * which is what the renderer / tooltip need for snapshots.
 */
export function pickActivityFor(
  hour: number,
  isEmployed: boolean,
  schedule: Schedule,
): Activity {
  if (!Number.isFinite(hour)) {
    throw new RangeError(`pickActivityFor: hour must be a finite number (got ${hour})`);
  }
  // Normalise negative / out-of-range hours by wrapping. This is
  // permissive: CityTime.hour should already be in [0, 24) but the
  // simulation can call us from tests with arbitrary values.
  const h = ((hour % 24) + 24) % 24;

  // Night: sleep from SLEEP_START_HOUR to SLEEP_END_HOUR.
  if (h >= SLEEP_START_HOUR || h < SLEEP_END_HOUR) return 'sleeping';

  // Commute: morning (right before work) and evening (right after work).
  if (isEmployed) {
    if (h >= MORNING_COMMUTE_START && h < MORNING_COMMUTE_END) return 'commuting';
    if (h >= EVENING_COMMUTE_START && h < EVENING_COMMUTE_END) return 'commuting';
  }

  // Employed citizens: work during the work block.
  if (isEmployed && schedule.work) {
    const { start, end } = schedule.work;
    if (h >= start && h < end) return 'working';
  }

  // Unemployed citizens: take an errand slot in the late morning and
  // a leisure block in the afternoon.
  if (!isEmployed) {
    if (h >= UNEMPLOYED_ERRAND_START && h < UNEMPLOYED_ERRAND_END) return 'errand';
    if (h >= UNEMPLOYED_LEISURE_START && h < UNEMPLOYED_LEISURE_END) return 'leisure';
  }

  // Employed citizens: evening leisure block.
  if (isEmployed && h >= EVENING_LEISURE_START && h < SLEEP_START_HOUR) {
    return 'leisure';
  }

  // Default: catch-all leisure so the citizen is never "idle" in the
  // activity sense. The lower-level `state` will still flip to `idle`
  // at the system layer when nothing else applies.
  return 'leisure';
}

/* -------------------------------------------------------------------------- */
/* Activity bounds                                                            */
/* -------------------------------------------------------------------------- */

/** Hour of day at which citizens go to sleep. */
export const SLEEP_START_HOUR = 22;
/** Hour of day at which citizens wake up. */
export const SLEEP_END_HOUR = 7;
/** Morning commute window — citizens in transit just before work. */
export const MORNING_COMMUTE_START = 7;
export const MORNING_COMMUTE_END = 9;
/** Evening commute window — citizens in transit just after work. */
export const EVENING_COMMUTE_START = 17;
export const EVENING_COMMUTE_END = 19;
/** Evening leisure block for employed citizens. */
export const EVENING_LEISURE_START = 19;
/** Unemployed errand slot. */
export const UNEMPLOYED_ERRAND_START = 10;
export const UNEMPLOYED_ERRAND_END = 12;
/** Unemployed afternoon leisure block. */
export const UNEMPLOYED_LEISURE_START = 12;
export const UNEMPLOYED_LEISURE_END = 18;

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 1;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
