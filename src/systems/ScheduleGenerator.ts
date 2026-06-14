/**
 * ScheduleGenerator — produces a per-citizen daily `Schedule` from a
 * deterministic seeded `Rng`.
 *
 * A schedule is a list of named time blocks (e.g. work, errands). The
 * 5-state activity machine in `@/entities/Citizen` reads the schedule
 * to decide what the citizen is doing at any given hour.
 *
 * Spec (7.2):
 *  - Employed: has a `work` block aligned to the typical office day
 *    (9:00–17:00 by default). The exact start/end is jittered by
 *    ±30 min so the city isn't perfectly synchronised.
 *  - Unemployed: no work block. The rest of the day is filled by the
 *    activity picker's defaults.
 *
 * Determinism: with the same `rng` (mulberry32 seeded externally) and
 * the same `isEmployed` flag, `generateSchedule` returns a structurally
 * identical schedule. Two `generateSchedule(rng, true)` calls on the
 * same Rng MUST be byte-equal.
 */

import type { Rng } from '@/generation/random';

/* -------------------------------------------------------------------------- */
/* Schedule shape                                                             */
/* -------------------------------------------------------------------------- */

/** A single time block on a 24-hour clock. `start` and `end` are
 *  half-open intervals in hours, e.g. `{ start: 9, end: 17 }` means
 *  the block covers hours [9, 17). */
export interface ScheduleBlock {
  readonly start: number;
  readonly end: number;
}

/** A citizen's daily schedule. Only `work` is currently defined; the
 *  shape is open-ended so leisure / errand blocks can be added later
 *  without breaking consumers. */
export interface Schedule {
  readonly work: ScheduleBlock | null;
  /** Stable id derived from the rng sequence; useful for snapshot
   *  tests that compare schedules across runs. */
  readonly id: string;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Default work start (9am). */
export const DEFAULT_WORK_START_HOUR = 9;
/** Default work end (5pm). */
export const DEFAULT_WORK_END_HOUR = 17;
/** Maximum jitter (in hours) applied to a work block's start and end. */
export const WORK_JITTER_HOURS = 0.5;

/* -------------------------------------------------------------------------- */
/* Generator                                                                  */
/* -------------------------------------------------------------------------- */

export interface GenerateScheduleOptions {
  /** Override the default work start hour. */
  readonly workStartHour?: number;
  /** Override the default work end hour. */
  readonly workEndHour?: number;
  /** Override the per-block jitter, in hours. */
  readonly jitterHours?: number;
}

/**
 * Generate a schedule for a single citizen. Pure function: same
 * inputs → same output. The `rng` is consumed in a fixed order so
 * two RNGs that produce the same sequence produce the same schedule.
 */
export function generateSchedule(
  rng: Rng,
  isEmployed: boolean,
  options: GenerateScheduleOptions = {},
): Schedule {
  if (!rng) throw new RangeError('generateSchedule: rng is required');
  if (typeof isEmployed !== 'boolean') {
    throw new RangeError('generateSchedule: isEmployed must be a boolean');
  }

  const workStartBase = options.workStartHour ?? DEFAULT_WORK_START_HOUR;
  const workEndBase = options.workEndHour ?? DEFAULT_WORK_END_HOUR;
  const jitter = options.jitterHours ?? WORK_JITTER_HOURS;

  if (!Number.isFinite(workStartBase) || workStartBase < 0 || workStartBase >= 24) {
    throw new RangeError(
      `generateSchedule: workStartHour must be in [0, 24) (got ${workStartBase})`,
    );
  }
  if (!Number.isFinite(workEndBase) || workEndBase <= 0 || workEndBase > 24) {
    throw new RangeError(
      `generateSchedule: workEndHour must be in (0, 24] (got ${workEndBase})`,
    );
  }
  if (!(workEndBase > workStartBase)) {
    throw new RangeError(
      `generateSchedule: workEndHour (${workEndBase}) must be > workStartHour (${workStartBase})`,
    );
  }
  if (!Number.isFinite(jitter) || jitter < 0) {
    throw new RangeError(`generateSchedule: jitterHours must be >= 0 (got ${jitter})`);
  }

  // Schedule id derived from the rng sequence; deterministic.
  const idSalt = rng.int(0, 0xffff).toString(36);

  if (!isEmployed) {
    return { work: null, id: `sched-u-${idSalt}` };
  }

  // Jitter the start and end by ±jitter hours, but clamp to a
  // 30-minute minimum shift so the block is non-empty. The rng
  // consumption order is fixed: start jitter, then end jitter.
  const startJitter = (rng.next() * 2 - 1) * jitter;
  const endJitter = (rng.next() * 2 - 1) * jitter;
  const start = roundHour(workStartBase + startJitter, workStartBase, jitter);
  const end = roundHour(workEndBase + endJitter, workEndBase, jitter);

  if (!(end > start)) {
    // Defensive: if jitter collapsed the block, fall back to defaults.
    return {
      work: { start: workStartBase, end: workEndBase },
      id: `sched-e-${idSalt}`,
    };
  }

  return {
    work: { start, end },
    id: `sched-e-${idSalt}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Clamp a jittered hour to the legal interval, then round to the
 * nearest 0.25h (15 min) so the schedule reads cleanly in the UI.
 */
function roundHour(v: number, base: number, jitter: number): number {
  const lo = Math.max(0, Math.min(24, base - jitter));
  const hi = Math.max(0, Math.min(24, base + jitter));
  const clamped = Math.min(hi, Math.max(lo, v));
  return Math.round(clamped * 4) / 4;
}
