/**
 * NeedSystem — drives the need-based citizen AI (spec §6.3).
 *
 * Responsibilities:
 *  1. Decay citizen needs every simulation minute.
 *  2. Replenish needs when a citizen is at a relevant destination.
 *  3. Flag a detour intent when any need drops below the threshold.
 *
 * TIME INTEGRATION (CRITICAL):
 *  `update(deltaSimMs)` receives SIMULATION milliseconds — i.e. the
 *  compressed time delta produced by TimeSystem (NOT raw GameLoop real-time).
 *  Internally the delta is converted to simulation minutes via
 *  `deltaSimMs / MS_PER_MINUTE`. This keeps NeedSystem pure and testable:
 *  tests pass explicit sim-ms values and assert exact decay/replenish amounts.
 */
import type { CitizenState } from '@/engine/types';
import { MS_PER_MINUTE } from '@/systems/TimeSystem';

/**
 * Per-minute decay rates for each need (spec §6.3).
 * Values are subtracted from the need every simulation minute.
 */
export const DECAY_RATES = {
  energy: 0.15,
  hunger: 0.2,
  fun: 0.1,
  social: 0.08,
} as const;

/**
 * Per-minute replenish rates by destination context (spec §6.3).
 * Only the needs relevant to the current context are replenished.
 */
export const REPLENISH_RATES = {
  /** Sleeping at home restores energy. */
  home: { energy: 2.0 },
  /** Eating at a restaurant (or home) restores hunger. */
  restaurant: { hunger: 1.5 },
  /** Entertainment venues and parks restore fun. */
  entertainment: { fun: 1.0 },
  /** Parks also restore fun. */
  park: { fun: 1.0 },
  /** Proximity to other citizens restores social. */
  social: { social: 0.5 },
} as const;

/**
 * Below this value a need is considered critical and triggers a detour.
 */
export const NEED_THRESHOLD = 30;

/** Minimum/maximum bounds for every need value. */
export const NEED_MIN = 0;
export const NEED_MAX = 100;

/** The four tracked citizen needs, all in the range [0, 100]. */
export interface Needs {
  energy: number;
  hunger: number;
  fun: number;
  social: number;
}

/**
 * Destination context that determines which needs are replenished.
 * Mirrors the keys of {@link REPLENISH_RATES} (minus `social`, which is
 * proximity-driven rather than destination-driven).
 */
export type DestinationContext =
  | 'home'
  | 'restaurant'
  | 'entertainment'
  | 'park'
  | 'none';

/**
 * Result returned by {@link NeedSystem.update} describing the detour intent,
 * if any, that the caller (movement/pathfinding) should act on.
 */
export interface DetourIntent {
  /** The need that dropped below {@link NEED_THRESHOLD}. */
  need: keyof Needs;
  /** The activity the citizen should switch to in order to satisfy the need. */
  activity: CitizenState;
  /** The destination context the citizen should head towards. */
  destination: Exclude<DestinationContext, 'none'>;
}

/** Clamp a value to the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Clamp every need to [NEED_MIN, NEED_MAX]. Returns the same object. */
function clampNeeds(needs: Needs): Needs {
  needs.energy = clamp(needs.energy, NEED_MIN, NEED_MAX);
  needs.hunger = clamp(needs.hunger, NEED_MIN, NEED_MAX);
  needs.fun = clamp(needs.fun, NEED_MIN, NEED_MAX);
  needs.social = clamp(needs.social, NEED_MIN, NEED_MAX);
  return needs;
}

/** Map a critical need to the activity + destination that satisfies it. */
const NEED_TO_DETOUR: Record<
  keyof Needs,
  { activity: CitizenState; destination: Exclude<DestinationContext, 'none'> }
> = {
  hunger: { activity: 'eating', destination: 'restaurant' },
  energy: { activity: 'sleeping', destination: 'home' },
  fun: { activity: 'entertaining', destination: 'entertainment' },
  social: { activity: 'wandering', destination: 'park' },
};

export class NeedSystem {
  /**
   * Apply per-minute decay to a set of needs.
   *
   * @param needs      The needs object to mutate in place.
   * @param deltaSimMs Simulation milliseconds elapsed.
   * @returns The mutated needs object (clamped to [0, 100]).
   */
  decay(needs: Needs, deltaSimMs: number): Needs {
    const minutes = deltaSimMs / MS_PER_MINUTE;
    needs.energy -= DECAY_RATES.energy * minutes;
    needs.hunger -= DECAY_RATES.hunger * minutes;
    needs.fun -= DECAY_RATES.fun * minutes;
    needs.social -= DECAY_RATES.social * minutes;
    return clampNeeds(needs);
  }

  /**
   * Apply per-minute replenishment based on the citizen's current destination.
   *
   * @param needs        The needs object to mutate in place.
   * @param deltaSimMs   Simulation milliseconds elapsed.
   * @param context      Where the citizen currently is.
   * @param nearOthers   Whether the citizen is in proximity to other citizens
   *                     (restores social need). Defaults to false.
   * @returns The mutated needs object (clamped to [0, 100]).
   */
  replenish(
    needs: Needs,
    deltaSimMs: number,
    context: DestinationContext,
    nearOthers = false,
  ): Needs {
    const minutes = deltaSimMs / MS_PER_MINUTE;

    if (context === 'home') {
      needs.energy += REPLENISH_RATES.home.energy * minutes;
      // Eating at home also restores hunger (spec: restaurant/home).
      needs.hunger += REPLENISH_RATES.restaurant.hunger * minutes;
    } else if (context === 'restaurant') {
      needs.hunger += REPLENISH_RATES.restaurant.hunger * minutes;
    } else if (context === 'entertainment') {
      needs.fun += REPLENISH_RATES.entertainment.fun * minutes;
    } else if (context === 'park') {
      needs.fun += REPLENISH_RATES.park.fun * minutes;
    }

    if (nearOthers) {
      needs.social += REPLENISH_RATES.social.social * minutes;
    }

    return clampNeeds(needs);
  }

  /**
   * Full per-step update: decay first, then replenish based on context.
   *
   * Convenience method combining {@link decay} and {@link replenish} so the
   * GameLoop can call a single function per citizen per step.
   *
   * @returns The mutated needs object (clamped to [0, 100]).
   */
  update(
    needs: Needs,
    deltaSimMs: number,
    context: DestinationContext = 'none',
    nearOthers = false,
  ): Needs {
    this.decay(needs, deltaSimMs);
    this.replenish(needs, deltaSimMs, context, nearOthers);
    return needs;
  }

  /**
   * Determine whether any need has dropped below {@link NEED_THRESHOLD} and, if
   * so, return the detour intent the caller should act on.
   *
   * Needs are evaluated in priority order: hunger > energy > fun > social.
   *
   * @returns The highest-priority detour intent, or `null` if all needs are
   *   above the threshold.
   */
  getDetourIntent(needs: Needs): DetourIntent | null {
    const order: Array<keyof Needs> = ['hunger', 'energy', 'fun', 'social'];
    for (const need of order) {
      if (needs[need] < NEED_THRESHOLD) {
        const detour = NEED_TO_DETOUR[need];
        return {
          need,
          activity: detour.activity,
          destination: detour.destination,
        };
      }
    }
    return null;
  }

  /**
   * Create a fresh set of needs, all initialised to the maximum value.
   */
  static createDefaultNeeds(): Needs {
    return {
      energy: NEED_MAX,
      hunger: NEED_MAX,
      fun: NEED_MAX,
      social: NEED_MAX,
    };
  }
}
