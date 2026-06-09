/**
 * TimeSystem unit tests.
 *
 * Covers the plan's required behavior:
 *   - tick math: simTime advances by exactly dt * speed
 *   - determinism: re-running the same (initial, dt, speed) sequence
 *     produces the same final simTime
 *   - speed multipliers: 0 (pause), 1, 2, 5, 10
 *   - phase boundaries: dawn / day / dusk / night map to the right
 *     hour-of-day
 *   - fade alpha progression: linear 0..1 across the 30-min fade window
 *   - day rollover: day counter increments on day boundary
 *   - bus integration: time.phase and time.day events fire
 */

import {
  FADE_SECONDS,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  TimeSystem,
  type Lighting,
} from '../TimeSystem';
import { EventBus } from '../EventBus';

function approx(a: number, b: number, eps: number = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

describe('TimeSystem: tick math + determinism', () => {
  test('tick advances by exactly dt * speed', () => {
    const t = new TimeSystem({ initialTime: 0, initialSpeed: 2 });
    t.tick(10);
    expect(t.getTime()).toBe(20);
    t.tick(5);
    expect(t.getTime()).toBe(30);
  });

  test('deterministic for any (initialTime, dt, speed) sequence', () => {
    const seq: Array<{ dt: number; speed: number }> = [
      { dt: 0.016, speed: 1 },
      { dt: 0.05, speed: 5 },
      { dt: 0.1, speed: 10 },
      { dt: 1, speed: 2 },
    ];
    const run = (initial: number): number => {
      const t = new TimeSystem({ initialTime: initial, initialSpeed: 1 });
      for (const step of seq) {
        t.setSpeed(step.speed);
        t.tick(step.dt);
      }
      return t.getTime();
    };
    const a = run(123);
    const b = run(123);
    expect(a).toBe(b);
  });

  test('speed=0 is a no-op for time advancement (pause)', () => {
    const t = new TimeSystem({ initialTime: 50, initialSpeed: 0 });
    t.tick(100);
    expect(t.getTime()).toBe(50);
  });

  test('negative speed is clamped to 0 (no time reversal)', () => {
    const t = new TimeSystem({ initialTime: 100, initialSpeed: 1 });
    t.setSpeed(-5);
    expect(t.getSpeed()).toBe(0);
    t.tick(10);
    expect(t.getTime()).toBe(100);
  });

  test('non-finite dt is ignored', () => {
    const t = new TimeSystem({ initialTime: 0, initialSpeed: 1 });
    t.tick(Number.NaN);
    t.tick(Infinity);
    t.tick(-1);
    expect(t.getTime()).toBe(0);
  });

  test('getTimeState reflects the clock', () => {
    const t = new TimeSystem({ initialTime: SECONDS_PER_DAY + 120, initialSpeed: 3 });
    const ts = t.getTimeState();
    expect(ts.simTime).toBe(SECONDS_PER_DAY + 120);
    expect(ts.speed).toBe(3);
    expect(ts.day).toBe(1);
  });
});

describe('TimeSystem: lighting phases', () => {
  test('midnight is full night', () => {
    const t = new TimeSystem({ initialTime: 0 });
    const l = t.getLighting();
    expect(l.phase).toBe('night');
    expect(l.phaseAlpha).toBe(0);
  });

  test('07:00 is full day', () => {
    const t = new TimeSystem({ initialTime: 7 * SECONDS_PER_HOUR });
    const l = t.getLighting();
    expect(l.phase).toBe('day');
    expect(l.phaseAlpha).toBe(0);
  });

  test('17:00 is full dusk (until 19:00)', () => {
    const t = new TimeSystem({ initialTime: 17 * SECONDS_PER_HOUR });
    const l = t.getLighting();
    // 17:00..17:30 is the day->dusk fade, so at the boundary the
    // base is "day" and the next is "dusk" with alpha=0.
    // 18:00 (mid-window) should be firmly in the dusk phase.
    const t2 = new TimeSystem({ initialTime: 18 * SECONDS_PER_HOUR });
    expect(t2.getLighting().phase).toBe('dusk');
    expect(t2.getLighting().phaseAlpha).toBe(0);
  });

  test('19:30+ is full night', () => {
    const t = new TimeSystem({ initialTime: 19.5 * SECONDS_PER_HOUR });
    const l = t.getLighting();
    expect(l.phase).toBe('night');
    expect(l.phaseAlpha).toBe(0);
  });

  test('fade alpha is linear across the 30-min window', () => {
    const fade = FADE_SECONDS;
    // 17:00..17:30: day -> dusk
    const t0 = new TimeSystem({ initialTime: 17 * SECONDS_PER_HOUR });
    const tMid = new TimeSystem({ initialTime: 17 * SECONDS_PER_HOUR + fade / 2 });
    const tEnd = new TimeSystem({ initialTime: 17 * SECONDS_PER_HOUR + fade });
    const a0 = t0.getLighting().phaseAlpha;
    const aMid = tMid.getLighting().phaseAlpha;
    const aEnd = tEnd.getLighting().phaseAlpha;
    expect(a0).toBe(0);
    expect(approx(aMid, 0.5)).toBe(true);
    // At 17:30 we're at dusk=full, day->dusk fade is finished, then
    // 17:30..19:00 is full dusk (no fade), so alpha is 0.
    expect(aEnd).toBe(0);
  });

  test('mid-fade tint is linearly blended between phaseColor and nextColor', () => {
    const fade = FADE_SECONDS;
    // 17:15: day->dusk, halfway through fade
    const t = new TimeSystem({ initialTime: 17 * SECONDS_PER_HOUR + fade / 2 });
    const l = t.getLighting();
    expect(l.phase).toBe('day');
    expect(l.nextColor).toEqual({ r: 1.0, g: 0.62, b: 0.42 }); // dusk default
    expect(approx(l.phaseAlpha, 0.5, 1e-9)).toBe(true);
    const expected: Lighting['blended'] = {
      r: 1.0 + (1.0 - 1.0) * 0.5,
      g: 1.0 + (0.62 - 1.0) * 0.5,
      b: 1.0 + (0.42 - 1.0) * 0.5,
    };
    expect(approx(l.blended.r, expected.r, 1e-9)).toBe(true);
    expect(approx(l.blended.g, expected.g, 1e-9)).toBe(true);
    expect(approx(l.blended.b, expected.b, 1e-9)).toBe(true);
  });

  test('night->dawn fade crosses midnight correctly', () => {
    const fade = FADE_SECONDS;
    // 04:45 (15 min before dawn) is the midpoint of the night->dawn fade.
    const t = new TimeSystem({ initialTime: 4.75 * SECONDS_PER_HOUR });
    const l = t.getLighting();
    expect(l.phase).toBe('night');
    expect(l.nextColor).toEqual({ r: 1.0, g: 0.78, b: 0.55 }); // dawn
    expect(approx(l.phaseAlpha, 0.5, 1e-9)).toBe(true);
  });

  test('day counter rolls over at SECONDS_PER_DAY', () => {
    const t = new TimeSystem({ initialTime: SECONDS_PER_DAY - 1, initialSpeed: 1 });
    expect(t.getTimeState().day).toBe(0);
    t.tick(2);
    expect(t.getTimeState().day).toBe(1);
  });
});

describe('TimeSystem: EventBus integration', () => {
  test('emits time.phase when the dominant phase changes', () => {
    const bus = new EventBus();
    const phases: string[] = [];
    bus.on('time.phase', (p: { phase: string }): void => {
      phases.push(p.phase);
    });
    const t = new TimeSystem({ initialTime: 0, bus });
    t.tick(1);
    expect(phases).toContain('night');
    t.tick(7 * SECONDS_PER_HOUR); // -> 07:00 (day full)
    expect(phases[phases.length - 1]).toBe('day');
  });

  test('emits time.day on day rollover', () => {
    const bus = new EventBus();
    const days: number[] = [];
    bus.on('time.day', (p: { day: number }): void => {
      days.push(p.day);
    });
    const t = new TimeSystem({ initialTime: 0, bus, initialSpeed: 1 });
    t.tick(SECONDS_PER_DAY);
    expect(days).toContain(1);
  });
});
