/**
 * Citizen entity — runtime inhabitants of the city.
 *
 * This module is pure TypeScript. It must NOT import React, DOM globals,
 * or the `World` class.
 */

import type { Citizen, CitizenState, Vector2, Activity, Schedule } from '@/engine/types';

// Citizen schedule constants are part of the public API and are imported
// by systems/tests. They are intentionally defined here (not in systems)
// so the citizen activity picker stays the single source of truth.
export const SLEEP_START_HOUR = 22;
export const SLEEP_END_HOUR = 6;
export const MORNING_COMMUTE_START = 7;
export const MORNING_COMMUTE_END = 9;
export const EVENING_COMMUTE_START = 17;
export const EVENING_COMMUTE_END = 19;
export const EVENING_LEISURE_START = 19;
export const UNEMPLOYED_ERRAND_START = 10;
export const UNEMPLOYED_ERRAND_END = 13;
export const UNEMPLOYED_LEISURE_START = 13;
export const UNEMPLOYED_LEISURE_END = 20;
import { clamp01 } from '@/engine/utils';

export interface CreateCitizenOptions {
  /** Unique id; required. */
  readonly id: string;
  /** Display name; optional (defaults to the id). */
  readonly name?: string;
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

export function createCitizen(options: CreateCitizenOptions): Citizen {
  if (options == null) {
    throw new RangeError('createCitizen: options is required');
  }

  return {
    id: options.id,
    name: options.name ?? options.id,
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

function isCitizenState(v: string): v is CitizenState {
  return v === 'idle' || v === 'commuting' || v === 'working' || v === 'shopping' || v === 'resting' || v === 'leisure';
}

export function setState(citizen: Citizen, next: CitizenState | never): Citizen {
  if (!isCitizenState(next)) throw new RangeError(`setState: unknown CitizenState "${next}"`);
  citizen.state = next;
  return citizen;
}

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
    default: {
      // Ensures exhaustive handling if Activity is extended.
      const _exhaustive: never = activity;
      return _exhaustive;
    }
  }
}

// Re-export the Citizen shape type for consumers/tests.
export type { Citizen } from '@/engine/types';

// Re-export Activity so callers can reference it as `entities/Citizen`.
export type { Activity } from '@/engine/types';


export function pickActivityFor(
  hour: number,
  isEmployed: boolean,
  schedule: Schedule,
): Activity {
  if (!Number.isFinite(hour)) throw new RangeError(`pickActivityFor: hour must be a finite number (got ${hour})`);
  const h = ((hour % 24) + 24) % 24;

  // Unemployed: use the published constants + wrap-safe comparisons.
  if (!isEmployed) {
    if (isWithinWindow(h, SLEEP_START_HOUR, SLEEP_END_HOUR)) return 'sleeping';
    if (h >= UNEMPLOYED_ERRAND_START && h < UNEMPLOYED_ERRAND_END) return 'errand';
    if (h >= UNEMPLOYED_LEISURE_START && h < UNEMPLOYED_LEISURE_END) return 'leisure';
    // Remaining hours after the constant windows.
    return 'sleeping';
  }

  // Employed: work overrides other activities in its block.
  const work = schedule.work;
  if (work && h >= work.start && h < work.end) return 'working';

  // Commute windows.
  if (h >= MORNING_COMMUTE_START && h < MORNING_COMMUTE_END) return 'commuting';
  if (h >= EVENING_COMMUTE_START && h < EVENING_COMMUTE_END) return 'commuting';

  // Sleep window wraps midnight.
  if (isWithinWindow(h, SLEEP_START_HOUR, SLEEP_END_HOUR)) return 'sleeping';

  // Leisure during the remaining day.
  return 'leisure';
}

function isWithinWindow(hour: number, startHour: number, endHour: number): boolean {
  const h = hour;
  // If end is > start: normal window [start, end).
  if (endHour > startHour) return h >= startHour && h < endHour;
  // Otherwise window wraps midnight: [start, 24) ∪ [0, end).
  return h >= startHour || h < endHour;
}
