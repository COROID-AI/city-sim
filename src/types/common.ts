/**
 * Common shared types used across the city simulator.
 *
 * Kept dependency-free so the `systems/` and `entities/` layers can import
 * from `@/types/common` without pulling in React, the DOM, or the engine.
 */

/** 2D vector in world (tile) space. */
export interface Vector2 {
  x: number;
  y: number;
}

/** Numeric identifier branded to avoid accidental mixing with other ids. */
export type CitizenId = string & { readonly __brand: 'CitizenId' };
export type BuildingId = string & { readonly __brand: 'BuildingId' };
export type VehicleId = string & { readonly __brand: 'VehicleId' };
export type CompanyId = string & { readonly __brand: 'CompanyId' };

/**
 * Discrete activity a citizen can be doing at a given hour.
 * Modeled as a small union for exhaustiveness checks.
 */
export type ActivityId =
  | 'sleep'
  | 'work'
  | 'commute'
  | 'leisure'
  | 'eat'
  | 'socialize'
  | 'errand';

/** All known activity ids, in a stable order for iteration/tests. */
export const ACTIVITY_IDS: readonly ActivityId[] = [
  'sleep',
  'work',
  'commute',
  'leisure',
  'eat',
  'socialize',
  'errand',
] as const;

/**
 * Type guard that narrows `unknown` to `ActivityId`.
 * Used at the systems boundary where data may come from JSON storage.
 */
export function isActivityId(value: unknown): value is ActivityId {
  return typeof value === 'string' && (ACTIVITY_IDS as readonly string[]).includes(value);
}

/** Hours in a day. Used as the canonical length of a citizen schedule. */
export const HOURS_PER_DAY = 24 as const;

/** Clamp helper for need values which are always in [0, 100]. */
export function clampNeed(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}
