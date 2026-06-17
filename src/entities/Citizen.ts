/**
 * Citizen entity — runtime inhabitants of the city.
 *
 * This module is pure TypeScript. It must NOT import React, DOM globals,
 * or the `World` class.
 */

import type { Citizen, CitizenState, Vector2, Schedule, Activity } from '@/engine/types';
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
  }
}

export function pickActivityFor(
  hour: number,
  isEmployed: boolean,
  schedule: Schedule,
): Activity {
  if (!Number.isFinite(hour)) throw new RangeError(`pickActivityFor: hour must be a finite number (got ${hour})`);
  const h = ((hour % 24) + 24) % 24;

  // schedule is expected to have either a work window or be empty.
  if (isEmployed) {
    // Work window overlaps schedule.work.{start,end}
    const work = schedule.work;
    if (work && h >= work.start && h < work.end) return 'working';

    // Simple fallback life cycle.
    if (h >= 6 && h < 9) return 'commuting';
    if (h >= 17 && h < 20) return 'commuting';
    if (h >= 20 || h < 6) return 'sleeping';
    return 'leisure';
  }

  // Unemployed: midday errand slot + leisure evenings.
  if (h >= 10 && h < 13) return 'errand';
  if (h >= 20 || h < 6) return 'sleeping';
  return 'leisure';
}
