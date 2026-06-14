/**
 * Unit tests for src/entities/Citizen.ts.
 *
 * Verifies the 5-state activity machine, the citizen factory, and the
 * state-transition helper. Pure functions; no engine runtime imports.
 */

import {
  createCitizen,
  setState,
  pickActivityFor,
  activityToState,
  SLEEP_START_HOUR,
  SLEEP_END_HOUR,
  MORNING_COMMUTE_START,
  MORNING_COMMUTE_END,
  EVENING_COMMUTE_START,
  EVENING_COMMUTE_END,
  UNEMPLOYED_ERRAND_START,
  type Activity,
} from '@/entities/Citizen';
import { createRng } from '@/generation/random';
import { generateSchedule, type Schedule } from '@/systems/ScheduleGenerator';

describe('createCitizen', () => {
  it('produces a citizen with sensible defaults', () => {
    const c = createCitizen({ id: 'c-1', name: 'Alex' });
    expect(c.id).toBe('c-1');
    expect(c.name).toBe('Alex');
    expect(c.homeId).toBeNull();
    expect(c.workId).toBeNull();
    expect(c.position).toEqual({ x: 0, y: 0 });
    expect(c.velocity).toEqual({ x: 0, y: 0 });
    expect(c.state).toBe('idle');
    expect(c.hunger).toBe(1);
    expect(c.energy).toBe(1);
    expect(c.fun).toBe(1);
  });

  it('clamps out-of-range needs to [0, 1]', () => {
    const high = createCitizen({ id: 'c-h', name: 'H', hunger: 5, energy: -2, fun: 1.4 });
    expect(high.hunger).toBe(1);
    expect(high.energy).toBe(0);
    expect(high.fun).toBe(1);
  });

  it('preserves the assigned home and work ids', () => {
    const c = createCitizen({
      id: 'c-w',
      name: 'Pat',
      homeId: 'home-1',
      workId: 'work-1',
      position: { x: 10, y: 20 },
    });
    expect(c.homeId).toBe('home-1');
    expect(c.workId).toBe('work-1');
    expect(c.position).toEqual({ x: 10, y: 20 });
  });
});

describe('setState', () => {
  it('mutates the citizen state and returns the citizen', () => {
    const c = createCitizen({ id: 'c-1', name: 'A' });
    const out = setState(c, 'working');
    expect(out).toBe(c);
    expect(c.state).toBe('working');
  });

  it('rejects unknown states with RangeError', () => {
    const c = createCitizen({ id: 'c-1', name: 'A' });
    expect(() => setState(c, 'flying' as never)).toThrow(RangeError);
  });
});

describe('activityToState', () => {
  it('maps the 5 activities to runtime CitizenState', () => {
    expect(activityToState('sleeping')).toBe('resting');
    expect(activityToState('commuting')).toBe('commuting');
    expect(activityToState('working')).toBe('working');
    expect(activityToState('leisure')).toBe('leisure');
    expect(activityToState('errand')).toBe('shopping');
  });
});

describe('pickActivityFor', () => {
  const unemployedSchedule: Schedule = { work: null, id: 'sched-u-1' };
  const employedSchedule: Schedule = {
    work: { start: 9, end: 17 },
    id: 'sched-e-1',
  };

  it('returns sleeping during the night window', () => {
    const h1 = SLEEP_START_HOUR + 0.5; // 22:30
    const h2 = 0; // midnight
    const h3 = SLEEP_END_HOUR - 0.5; // 06:30
    expect(pickActivityFor(h1, true, employedSchedule)).toBe('sleeping');
    expect(pickActivityFor(h2, false, unemployedSchedule)).toBe('sleeping');
    expect(pickActivityFor(h3, true, employedSchedule)).toBe('sleeping');
  });

  it('returns commuting during the morning window for employed', () => {
    const h = (MORNING_COMMUTE_START + MORNING_COMMUTE_END) / 2;
    expect(pickActivityFor(h, true, employedSchedule)).toBe('commuting');
  });

  it('returns commuting during the evening window for employed', () => {
    const h = (EVENING_COMMUTE_START + EVENING_COMMUTE_END) / 2;
    expect(pickActivityFor(h, true, employedSchedule)).toBe('commuting');
  });

  it('returns working during the schedule work block for employed', () => {
    expect(pickActivityFor(10, true, employedSchedule)).toBe('working');
    expect(pickActivityFor(16.5, true, employedSchedule)).toBe('working');
  });

  it('does not return working outside the schedule work block', () => {
    // 8:00 is the morning commute window, 18:00 is the evening commute
    // window, and 12:30 is in the working block.
    expect(pickActivityFor(8, true, employedSchedule)).toBe('commuting');
    expect(pickActivityFor(18, true, employedSchedule)).toBe('commuting');
    expect(pickActivityFor(12.5, true, employedSchedule)).toBe('working');
  });

  it('returns leisure in the evening after the commute window', () => {
    // 20:00 is after the evening commute window ends at 19:00.
    expect(pickActivityFor(20, true, employedSchedule)).toBe('leisure');
  });

  it('returns errand for unemployed in the late-morning slot', () => {
    const h = (UNEMPLOYED_ERRAND_START + 11) / 2;
    expect(pickActivityFor(h, false, unemployedSchedule)).toBe('errand');
  });

  it('returns leisure for unemployed in the afternoon block', () => {
    expect(pickActivityFor(14, false, unemployedSchedule)).toBe('leisure');
  });

  it('normalises out-of-range hours by wrapping', () => {
    expect(pickActivityFor(25, true, employedSchedule)).toBe(pickActivityFor(1, true, employedSchedule));
    expect(pickActivityFor(-1, false, unemployedSchedule)).toBe(pickActivityFor(23, false, unemployedSchedule));
  });

  it('rejects non-finite hours', () => {
    expect(() => pickActivityFor(Number.NaN, true, employedSchedule)).toThrow(RangeError);
    expect(() => pickActivityFor(Number.POSITIVE_INFINITY, true, employedSchedule)).toThrow(RangeError);
  });
});

describe('Citizen + Schedule integration', () => {
  it('uses the schedule start/end for activity picking', () => {
    const rng = createRng(123);
    const s = generateSchedule(rng, true);
    expect(s.work).not.toBeNull();
    const mid = (s.work!.start + s.work!.end) / 2;
    expect(pickActivityFor(mid, true, s)).toBe<Activity>('working');
  });
});
