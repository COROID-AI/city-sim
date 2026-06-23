/**
 * Citizen — a need-driven AI actor (spec §6.3).
 *
 * Each citizen has:
 *  - A stable identity and world position (via {@link Entity}).
 *  - A generated name (via {@link NameGenerator}).
 *  - A set of four needs (energy, hunger, fun, social) managed by
 *    {@link NeedSystem}.
 *  - A daily activity schedule resolved by {@link determineActivity}, which is
 *    a pure function of the current hour + employment status. This keeps the
 *    state-machine logic trivially testable without mocking TimeSystem.
 *
 * The `update()` method is intentionally lightweight: it derives the current
 * activity from the hour and applies need decay. Need-driven detours and
 * movement are handled by downstream systems (Pathfinder, movement) which read
 * `activity` and route accordingly.
 */
import type { CitizenState, Vector2 } from '@/engine/types';
import { Entity } from '@/entities/Entity';
import { NameGenerator } from '@/generation/NameGenerator';
import {
  NeedSystem,
  type Needs,
  type DestinationContext,
} from '@/systems/NeedSystem';

/** Hour at which the morning commute begins. */
export const COMMUTE_START_HOUR = 8;

/** Hour at which the work shift begins (commute ends). */
export const WORK_START_HOUR = 9;

/** Hour at which the work shift ends. */
export const WORK_END_HOUR = 17;

/** Hour at which the lunch break occurs. */
export const LUNCH_HOUR = 12;

/** Hour at which citizens go to sleep. */
export const SLEEP_HOUR = 22;

/** Hour at which citizens wake up. */
export const WAKE_HOUR = 6;

/** Evening entertainment window start. */
export const EVENING_ENTERTAINMENT_START = 18;

/** Evening entertainment window end (before sleep). */
export const EVENING_ENTERTAINMENT_END = 22;

export class Citizen extends Entity {
  /** Display name ("FirstName LastName"). */
  readonly name: string;

  /** Whether this citizen has a job. */
  readonly employed: boolean;

  /** Current activity state. */
  activity: CitizenState;

  /** Current need values (mutated by NeedSystem). */
  readonly needs: Needs;

  /** Owning NeedSystem instance used for decay/replenish. */
  private readonly needSystem: NeedSystem;

  /**
   * @param position Initial world position.
   * @param options  Optional configuration.
   */
  constructor(
    position: Vector2 = { x: 0, y: 0 },
    options: {
      id?: string;
      name?: string;
      employed?: boolean;
      needs?: Needs;
      needSystem?: NeedSystem;
    } = {},
  ) {
    super(position, options.id);
    this.name = options.name ?? NameGenerator.generate();
    this.employed = options.employed ?? true;
    this.needs = options.needs ?? NeedSystem.createDefaultNeeds();
    this.needSystem = options.needSystem ?? new NeedSystem();
    this.activity = 'sleeping';
  }

  /**
   * Resolve the canonical activity for a given hour and employment status.
   *
   * Pure function — no side effects, no time-system dependency. This is the
   * single source of truth for the daily schedule.
   *
   * Schedule (employed):
   *   00:00–07:59  sleeping
   *   08:00–08:59  commuting
   *   09:00–11:59  working
   *   12:00–12:59  eating
   *   13:00–16:59  working
   *   17:00–17:59  commuting
   *   18:00–21:59  entertaining
   *   22:00–23:59  sleeping
   *
   * Unemployed citizens wander during the day instead of working/commuting.
   */
  determineActivity(hour: number): CitizenState {
    const h = ((Math.floor(hour) % 24) + 24) % 24;

    // Night: everyone sleeps.
    if (h < WAKE_HOUR || h >= SLEEP_HOUR) {
      return 'sleeping';
    }

    // Unemployed citizens: eat at noon, entertain in the evening, wander.
    if (!this.employed) {
      if (h === LUNCH_HOUR) return 'eating';
      if (h >= EVENING_ENTERTAINMENT_START && h < EVENING_ENTERTAINMENT_END) {
        return 'entertaining';
      }
      return 'wandering';
    }

    // Employed schedule.
    // Between wake and commute (06:00–07:59): still sleeping (no activity yet).
    if (h < COMMUTE_START_HOUR) return 'sleeping';
    if (h === COMMUTE_START_HOUR) return 'commuting';
    if (h >= WORK_START_HOUR && h < LUNCH_HOUR) return 'working';
    if (h === LUNCH_HOUR) return 'eating';
    if (h > LUNCH_HOUR && h < WORK_END_HOUR) return 'working';
    if (h === WORK_END_HOUR) return 'commuting';
    if (h > WORK_END_HOUR && h < SLEEP_HOUR) return 'entertaining';

    // Fallback (should not be reachable given the guards above).
    return 'wandering';
  }

  /**
   * Map the current activity to a destination context for NeedSystem.
   */
  private activityToContext(activity: CitizenState): DestinationContext {
    switch (activity) {
      case 'sleeping':
        return 'home';
      case 'eating':
        return 'restaurant';
      case 'entertaining':
        return 'entertainment';
      default:
        return 'none';
    }
  }

  /**
   * Per-step update: derive activity from the hour and apply need decay.
   *
   * @param deltaSimMs Simulation milliseconds elapsed (compressed sim-time).
   * @param hour       Current simulation hour [0..23].
   */
  update(deltaSimMs: number, hour?: number): void {
    if (hour !== undefined) {
      this.activity = this.determineActivity(hour);
    }
    const context = this.activityToContext(this.activity);
    this.needSystem.update(this.needs, deltaSimMs, context);
  }
}
