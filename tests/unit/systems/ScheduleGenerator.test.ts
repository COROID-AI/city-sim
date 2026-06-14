/**
 * Unit tests for src/systems/ScheduleGenerator.ts.
 *
 * Verifies that schedules for employed vs unemployed citizens have the
 * expected shape, that jitter is applied, and that the same seed
 * produces identical schedules.
 */

import { createRng } from '@/generation/random';
import {
  generateSchedule,
  DEFAULT_WORK_START_HOUR,
  DEFAULT_WORK_END_HOUR,
  WORK_JITTER_HOURS,
  type Schedule,
} from '@/systems/ScheduleGenerator';

describe('generateSchedule', () => {
  it('returns a schedule with no work block for unemployed', () => {
    const rng = createRng(1);
    const s = generateSchedule(rng, false);
    expect(s.work).toBeNull();
    expect(s.id).toMatch(/^sched-u-/);
  });

  it('returns a schedule with a work block for employed', () => {
    const rng = createRng(1);
    const s = generateSchedule(rng, true);
    expect(s.work).not.toBeNull();
    expect(s.work!.start).toBeGreaterThan(0);
    expect(s.work!.end).toBeGreaterThan(s.work!.start);
    expect(s.id).toMatch(/^sched-e-/);
  });

  it('is deterministic across two RNGs seeded identically', () => {
    const a = generateSchedule(createRng(42), true);
    const b = generateSchedule(createRng(42), true);
    expect(a).toEqual(b);

    const c = generateSchedule(createRng(42), false);
    const d = generateSchedule(createRng(42), false);
    expect(c).toEqual(d);
  });

  it('produces different schedules for different seeds', () => {
    const a = generateSchedule(createRng(1), true);
    const b = generateSchedule(createRng(2), true);
    // Either the id or the work block should differ; compare both.
    const sameId = a.id === b.id;
    const sameWork = a.work?.start === b.work?.start && a.work?.end === b.work?.end;
    expect(sameId && sameWork).toBe(false);
  });

  it('jitter keeps the work block within ±jitterHours of the defaults', () => {
    const rng = createRng(7);
    const s = generateSchedule(rng, true);
    expect(s.work).not.toBeNull();
    const startDelta = Math.abs(s.work!.start - DEFAULT_WORK_START_HOUR);
    const endDelta = Math.abs(s.work!.end - DEFAULT_WORK_END_HOUR);
    // Allow a tiny floating-point margin.
    expect(startDelta).toBeLessThanOrEqual(WORK_JITTER_HOURS + 0.01);
    expect(endDelta).toBeLessThanOrEqual(WORK_JITTER_HOURS + 0.01);
  });

  it('honours custom workStartHour / workEndHour / jitterHours', () => {
    const rng = createRng(0);
    const s = generateSchedule(rng, true, {
      workStartHour: 8,
      workEndHour: 16,
      jitterHours: 0,
    });
    expect(s.work).toEqual({ start: 8, end: 16 });
  });

  it('falls back to defaults when jitter collapses the block', () => {
    const rng = createRng(0);
    // 24h work block with huge jitter: a particularly unlucky rng
    // could push end < start, but the generator must still return a
    // non-empty block.
    const s = generateSchedule(rng, true, {
      workStartHour: 0.1,
      workEndHour: 0.2,
      jitterHours: 5,
    });
    expect(s.work).not.toBeNull();
    expect(s.work!.end).toBeGreaterThan(s.work!.start);
  });

  it('rejects invalid workStartHour', () => {
    const rng = createRng(0);
    expect(() => generateSchedule(rng, true, { workStartHour: -1 })).toThrow(RangeError);
    expect(() => generateSchedule(rng, true, { workStartHour: 24 })).toThrow(RangeError);
  });

  it('rejects invalid workEndHour', () => {
    const rng = createRng(0);
    expect(() => generateSchedule(rng, true, { workStartHour: 5, workEndHour: 0 })).toThrow(RangeError);
    expect(() => generateSchedule(rng, true, { workStartHour: 5, workEndHour: 5 })).toThrow(RangeError);
  });

  it('rejects negative jitter', () => {
    const rng = createRng(0);
    expect(() => generateSchedule(rng, true, { jitterHours: -0.1 })).toThrow(RangeError);
  });

  it('rejects non-boolean isEmployed', () => {
    const rng = createRng(0);
    // @ts-expect-error testing runtime guard
    expect(() => generateSchedule(rng, 'yes')).toThrow(RangeError);
  });
});

describe('Schedule shape', () => {
  it('is structurally compatible with the engine consumer', () => {
    const rng = createRng(0);
    const s: Schedule = generateSchedule(rng, true);
    // Both fields should be readonly and non-undefined.
    expect(typeof s.id).toBe('string');
    expect(s.work === null || typeof s.work.start === 'number').toBe(true);
  });
});
