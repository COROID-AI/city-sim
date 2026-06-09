/**
 * Citizen entity.
 *
 * Spec reference: §5.3 Entity Model, §7.2 Citizen Behaviour.
 *
 * Pure data + pure functions; no React, no DOM, no engine imports.
 * The render system, the NeedSystem, and the pathfinder all consume
 * this shape via the `@/entities` barrel to keep a single source of
 * truth for citizen ids and workplace contracts.
 */
import {
  ACTIVITY_IDS,
  type ActivityId,
  type BuildingId,
  type CitizenId,
  type Vector2,
  clampNeed,
  isActivityId,
} from '@/types/common';

/** A 24-entry activity schedule (one entry per hour of the day). */
export type Schedule = readonly ActivityId[];

/** Citizen needs. Each is a value in [0, 100]. */
export interface Needs {
  energy: number;
  hunger: number;
  fun: number;
  social: number;
}

export interface Citizen {
  /** Stable unique identifier (crypto.randomUUID under the hood). */
  id: CitizenId;
  /** World/tile position. */
  position: Vector2;
  /** Display name. */
  name: string;
  /** Current need values, always in [0, 100]. */
  needs: Needs;
  /** Activity the citizen is currently performing. */
  currentActivity: ActivityId;
  /**
   * Workplace building id, or null when unemployed.
   * Used by the pathfinder and by the renderer for routing/colour cues.
   */
  workplaceId: BuildingId | null;
  /** Home building id. */
  homeId: BuildingId;
  /** 24-entry activity plan, one ActivityId per hour 0..23. */
  schedule: Schedule;
}

/** Safe default needs (well-rested, fed, mildly bored, somewhat social). */
export const DEFAULT_NEEDS: Readonly<Needs> = Object.freeze({
  energy: 90,
  hunger: 85,
  fun: 60,
  social: 55,
});

/**
 * Build a fully-formed citizen. Validates the schedule and clamps needs so
 * downstream systems can assume the invariants in their hot paths.
 */
export function createCitizen(params: {
  id: CitizenId;
  position: Vector2;
  name: string;
  homeId: BuildingId;
  workplaceId: BuildingId | null;
  schedule: readonly ActivityId[];
  needs?: Partial<Needs>;
  currentActivity?: ActivityId;
}): Citizen {
  const schedule = assertSchedule(params.schedule);
  const needs = normalizeNeeds(params.needs);
  const currentActivity = params.currentActivity ?? schedule[0] ?? 'sleep';
  return {
    id: params.id,
    position: params.position,
    name: params.name,
    needs,
    currentActivity,
    workplaceId: params.workplaceId,
    homeId: params.homeId,
    schedule,
  };
}

/**
 * Look up the activity for a given hour.
 * Defensive: returns 'sleep' (the lowest-risk fallback) on out-of-range
 * values, so a buggy TimeSystem cannot crash the simulation.
 */
export function activityAtHour(citizen: Citizen, hour: number): ActivityId {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return 'sleep';
  }
  return citizen.schedule[hour] ?? 'sleep';
}

/**
 * Apply a delta map to a citizen's needs, clamping the result.
 * Returns a new Citizen (immutable update) for predictable React-style
 * consumers and easier diffing in tests.
 */
export function applyNeedDeltas(
  citizen: Citizen,
  deltas: Partial<Record<ActivityId, Partial<Needs>>>,
): Citizen {
  const matrix = deltas[citizen.currentActivity];
  if (!matrix) return citizen;
  const next: Needs = {
    energy: clampNeed(citizen.needs.energy + (matrix.energy ?? 0)),
    hunger: clampNeed(citizen.needs.hunger + (matrix.hunger ?? 0)),
    fun: clampNeed(citizen.needs.fun + (matrix.fun ?? 0)),
    social: clampNeed(citizen.needs.social + (matrix.social ?? 0)),
  };
  return { ...citizen, needs: next };
}

/** Type guard for Citizen (useful at serialization boundaries). */
export function isCitizen(value: unknown): value is Citizen {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string') return false;
  if (v.position === null || typeof v.position !== 'object') return false;
  const pos = v.position as Record<string, unknown>;
  if (typeof pos.x !== 'number' || typeof pos.y !== 'number') return false;
  if (typeof v.name !== 'string') return false;
  if (v.needs === null || typeof v.needs !== 'object') return false;
  const needs = v.needs as Record<string, unknown>;
  const needKeys: (keyof Needs)[] = ['energy', 'hunger', 'fun', 'social'];
  for (const key of needKeys) {
    if (typeof needs[key] !== 'number') return false;
  }
  if (!isActivityId(v.currentActivity)) return false;
  if (v.workplaceId !== null && typeof v.workplaceId !== 'string') return false;
  if (typeof v.homeId !== 'string') return false;
  if (!Array.isArray(v.schedule) || v.schedule.length !== 24) return false;
  for (const entry of v.schedule) {
    if (!isActivityId(entry)) return false;
  }
  return true;
}

// ---------- internal helpers ----------

function normalizeNeeds(partial: Partial<Needs> | undefined): Needs {
  return {
    energy: clampNeed(partial?.energy ?? DEFAULT_NEEDS.energy),
    hunger: clampNeed(partial?.hunger ?? DEFAULT_NEEDS.hunger),
    fun: clampNeed(partial?.fun ?? DEFAULT_NEEDS.fun),
    social: clampNeed(partial?.social ?? DEFAULT_NEEDS.social),
  };
}

function assertSchedule(schedule: readonly ActivityId[]): Schedule {
  if (schedule.length !== 24) {
    throw new Error(
      `Citizen schedule must have exactly 24 entries, got ${schedule.length}`,
    );
  }
  // Validate every entry is a known ActivityId. We don't accept unknown strings
  // because the schedule is used as a typed lookup table elsewhere.
  for (let i = 0; i < schedule.length; i += 1) {
    const entry = schedule[i];
    if (entry === undefined || !ACTIVITY_IDS.includes(entry)) {
      throw new Error(`Invalid activity at hour ${i}: ${String(entry)}`);
    }
  }
  return Object.freeze([...schedule]) as Schedule;
}
