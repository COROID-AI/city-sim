/**
 * ScheduleGenerator — builds a per-citizen daily schedule (spec §7.2).
 *
 * Each citizen gets a 24-entry {@link ScheduleEntry} array (one per hour)
 * whose activities mirror the canonical {@link Citizen.determineActivity}
 * state-machine, but with a per-citizen jitter offset (±30 min) so the
 * population doesn't all transition at the exact same minute.
 *
 * Design notes:
 *  - `determineActivity(hour)` remains the canonical pure fallback. The
 *    generated schedule is the *preferred* source; `getScheduleActivity(hour)`
 *    reads from it.
 *  - The generator accepts an optional seeded RNG (`rng`) so tests can assert
 *    determinism. Production code passes `Math.random` (the default).
 *  - Jitter is clamped to [-30, +30] minutes regardless of the RNG draw.
 */
import type { CitizenState, ScheduleEntry } from '@/engine/types';

/** Maximum absolute jitter (in minutes) applied to each schedule hour. */
export const MAX_JITTER_MINUTES = 30;

/** A function returning a float in [0, 1). */
export type RngFn = () => number;

/**
 * Resolve the canonical activity for a given hour and employment status.
 *
 * Pure function — mirrors {@link Citizen.determineActivity} so the schedule
 * generator does not need a Citizen instance. This is the single source of
 * truth for the *un-jittered* daily routine.
 *
 * Employed schedule:
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
export function canonicalActivity(hour: number, employed: boolean): CitizenState {
  const h = ((Math.floor(hour) % 24) + 24) % 24;

  // Night: everyone sleeps (00:00–05:59 and 22:00–23:59).
  if (h < 6 || h >= 22) {
    return 'sleeping';
  }

  // Unemployed citizens: eat at noon, entertain in the evening, wander.
  if (!employed) {
    if (h === 12) return 'eating';
    if (h >= 18 && h < 22) return 'entertaining';
    return 'wandering';
  }

  // Employed schedule.
  if (h < 8) return 'sleeping'; // 06:00–07:59 still sleeping
  if (h === 8) return 'commuting';
  if (h >= 9 && h < 12) return 'working';
  if (h === 12) return 'eating';
  if (h >= 13 && h < 17) return 'working';
  if (h === 17) return 'commuting';
  // 18:00–21:59 entertaining.
  return 'entertaining';
}

/**
 * Draw a jitter value in [-30, +30] minutes using the provided RNG.
 */
function drawJitter(rng: RngFn): number {
  // rng() in [0,1) -> scale to [-30, +30].
  return Math.floor(rng() * (2 * MAX_JITTER_MINUTES + 1)) - MAX_JITTER_MINUTES;
}

/**
 * Generate a full 24-hour schedule for a citizen.
 *
 * @param employed Whether the citizen is employed (drives work vs wander).
 * @param rng      Optional seeded RNG for deterministic jitter. Defaults to
 *                 `Math.random`.
 * @returns An array of exactly 24 {@link ScheduleEntry} objects, indexed by
 *          hour [0..23], each with `jitterMinutes` in [-30, +30].
 */
export function generateSchedule(
  employed: boolean,
  rng: RngFn = Math.random,
): ScheduleEntry[] {
  const schedule: ScheduleEntry[] = [];
  for (let hour = 0; hour < 24; hour++) {
    schedule.push({
      hour,
      activity: canonicalActivity(hour, employed),
      jitterMinutes: drawJitter(rng),
    });
  }
  return schedule;
}

/**
 * Look up the scheduled activity for a given hour.
 *
 * @param schedule The 24-entry schedule array.
 * @param hour     Hour of the day (wrapped modulo 24).
 * @returns The activity for that hour, or `wandering` if the schedule is
 *          somehow malformed (defensive fallback).
 */
export function getScheduleActivity(
  schedule: ScheduleEntry[],
  hour: number,
): CitizenState {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const entry = schedule[h];
  return entry ? entry.activity : 'wandering';
}
