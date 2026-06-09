/**
 * NeedSystem.
 *
 * Spec reference: §7.2 Citizen Behaviour.
 *
 * Pure TypeScript, framework-agnostic. Reads the current hour from a
 * `TimeProvider` (default: `TimeSystem`) and advances each citizen's
 * `currentActivity` from their `schedule`. Need values drift according
 * to an activity -> delta matrix, and are clamped to [0, 100].
 *
 * The system exposes only pure functions plus a small `NeedSystem` class
 * that holds mutable citizen state, so it can be driven by either the
 * engine or unit tests with a fake TimeProvider.
 */
import { type Citizen, type Needs, activityAtHour, createCitizen } from '@/entities';
import type { ActivityId } from '@/types/common';
import { clampNeed } from '@/types/common';
import type { TimeProvider } from './TimeSystem';
import { TimeSystem } from './TimeSystem';

/**
 * Default per-hour need deltas for each activity. Tuned for a 24h cycle:
 *   - sleep restores ~4 energy/hour (full night ~= 36 energy delta on top of decay)
 *   - work drains energy, social, fun
 *   - commute drains energy and fun
 *   - leisure restores fun and social
 *   - eat restores hunger
 *   - socialize restores social
 *   - errand drains fun
 */
export const DEFAULT_ACTIVITY_DELTAS: Readonly<
  Record<ActivityId, Readonly<Needs>>
> = Object.freeze({
  sleep: { energy: +4, hunger: -1, fun: -0.5, social: -0.5 },
  work: { energy: -2, hunger: -2, fun: -1.5, social: -0.5 },
  commute: { energy: -1, hunger: -0.5, fun: -1, social: 0 },
  leisure: { energy: -0.5, hunger: -1, fun: +3, social: +1 },
  eat: { energy: +1, hunger: +4, fun: +0.5, social: +0.5 },
  socialize: { energy: -0.5, hunger: -1, fun: +1, social: +3 },
  errand: { energy: -1, hunger: -1, fun: -1, social: +0.5 },
});

/**
 * NeedSystem holds the mutable citizen list. Stateless callers can use
 * the `advanceNeeds` / `advanceSchedule` free functions on plain arrays.
 */
export class NeedSystem {
  private readonly time: TimeProvider;
  private readonly deltas: Readonly<Record<ActivityId, Readonly<Needs>>>;
  // (kept as full-record; partial deltas are only used by tests/free fns)
  private citizens: Citizen[];

  constructor(
    initialCitizens: readonly Citizen[],
    options: {
      timeProvider?: TimeProvider;
      activityDeltas?: Readonly<Record<ActivityId, Readonly<Needs>>>;
    } = {},
  ) {
    this.citizens = [...initialCitizens];
    this.time = options.timeProvider ?? new TimeSystem();
    this.deltas = options.activityDeltas ?? DEFAULT_ACTIVITY_DELTAS;
  }

  /** Read-only view of the current citizen list. */
  getCitizens(): readonly Citizen[] {
    return this.citizens;
  }

  /**
   * Advance both schedule and need deltas in one call. Safe to invoke
   * once per render frame; the internal `hasHourChanged()` flag on the
   * TimeProvider gates schedule transitions.
   */
  update(): void {
    if (this.time.hasHourChanged()) {
      this.citizens = advanceSchedule(this.citizens, this.time.getCurrentHour());
    }
    this.citizens = advanceNeeds(this.citizens, this.deltas);
  }

  /** Replace the citizen list (used after CityGenerator changes the world). */
  setCitizens(citizens: readonly Citizen[]): void {
    this.citizens = [...citizens];
  }
}

// ---------- free functions (testable in isolation) ----------

/**
 * Advance every citizen to the activity scheduled for `hour`. Returns a
 * new array; original objects are not mutated.
 */
export function advanceSchedule(
  citizens: readonly Citizen[],
  hour: number,
): Citizen[] {
  return citizens.map((citizen) => {
    const next = activityAtHour(citizen, hour);
    if (next === citizen.currentActivity) return citizen;
    return { ...citizen, currentActivity: next };
  });
}

/**
 * Apply the activity -> need delta matrix to every citizen and clamp
 * the resulting needs. Returns a new array.
 */
export function advanceNeeds(
  citizens: readonly Citizen[],
  deltas: Readonly<Record<ActivityId, Readonly<Needs>>> = DEFAULT_ACTIVITY_DELTAS,
): Citizen[] {
  return citizens.map((citizen) => applyActivityDeltas(citizen, deltas));
}

/**
 * Apply a single tick of the delta matrix to one citizen. Exposed for
 * unit tests that want to assert behaviour at the entity level.
 */
export function applyActivityDeltas(
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

// Re-export the create helper so callers can stay in the systems namespace
// when constructing test citizens.
export { createCitizen };
