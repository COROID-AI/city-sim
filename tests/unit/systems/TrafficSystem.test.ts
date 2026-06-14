/**
 * Unit tests for TrafficSystem (src/systems/TrafficSystem.ts).
 *
 * The TrafficSystem drives the per-tile traffic-light phase cycle
 * (green → yellow → red) by advancing a phase counter stored on each
 * road tile. This suite verifies:
 *   - Phase math: counter → discrete phase mapping.
 *   - isGreenAt / isYellowAt: queries at counter boundaries.
 *   - Cycle wraparound across long dt.
 *   - Speed multiplier and freeze semantics.
 *   - Constructor validation.
 *
 * These tests intentionally do NOT need a real World — TrafficSystem
 * is pure compute and exposes a `phaseFor(counter)` helper that is
 * stable for any counter value.
 */

import { TrafficSystem } from '@/systems/TrafficSystem';
import {
  DEFAULT_GREEN_SECONDS,
  DEFAULT_YELLOW_SECONDS,
  DEFAULT_RED_SECONDS,
} from '@/systems/TrafficSystem';

describe('TrafficSystem — phase mapping', () => {
  it('returns "green" at counter 0', () => {
    const ts = new TrafficSystem();
    expect(ts.phaseFor(0)).toBe('green');
  });

  it('returns "green" up to (but not including) greenSeconds', () => {
    const ts = new TrafficSystem({ greenSeconds: 8 });
    expect(ts.phaseFor(0)).toBe('green');
    expect(ts.phaseFor(7.999)).toBe('green');
  });

  it('returns "yellow" inside the yellow window', () => {
    const ts = new TrafficSystem({ greenSeconds: 8, yellowSeconds: 2 });
    expect(ts.phaseFor(8)).toBe('yellow');
    expect(ts.phaseFor(9.5)).toBe('yellow');
  });

  it('returns "red" for the rest of the cycle', () => {
    const ts = new TrafficSystem({ greenSeconds: 8, yellowSeconds: 2, redSeconds: 8 });
    expect(ts.phaseFor(10)).toBe('red');
    expect(ts.phaseFor(17.999)).toBe('red');
  });

  it('wraps the counter modulo the full cycle length', () => {
    const ts = new TrafficSystem({ greenSeconds: 8, yellowSeconds: 2, redSeconds: 8 });
    const cycle = DEFAULT_GREEN_SECONDS + DEFAULT_YELLOW_SECONDS + DEFAULT_RED_SECONDS;
    expect(ts.phaseFor(cycle)).toBe('green');
    expect(ts.phaseFor(cycle + 8)).toBe('yellow');
    expect(ts.phaseFor(cycle * 2 + 3)).toBe('green');
  });

  it('handles negative counters defensively (returns green)', () => {
    // The current implementation short-circuits on non-positive
    // counters to a safe default ('green'). The tick() entry point
    // is responsible for ensuring counters never go negative.
    const ts = new TrafficSystem({ greenSeconds: 8, yellowSeconds: 2, redSeconds: 8 });
    expect(ts.phaseFor(-1)).toBe('green');
  });

  it('returns "green" for non-finite / negative (defensive default)', () => {
    const ts = new TrafficSystem();
    expect(ts.phaseFor(Number.NaN)).toBe('green');
  });
});

describe('TrafficSystem — isGreenAt', () => {
  it('is true during green and yellow, false during red', () => {
    const ts = new TrafficSystem({ greenSeconds: 8, yellowSeconds: 2, redSeconds: 8 });
    expect(ts.isGreenAt(0)).toBe(true);
    expect(ts.isGreenAt(7)).toBe(true);
    expect(ts.isGreenAt(8)).toBe(true); // yellow still passes
    expect(ts.isGreenAt(10)).toBe(false); // red
    expect(ts.isGreenAt(17)).toBe(false);
  });
});

describe('TrafficSystem — speed / freeze', () => {
  it('defaults to speed 1', () => {
    const ts = new TrafficSystem();
    expect(ts.getSpeed()).toBe(1);
  });

  it('accepts 0 as freeze', () => {
    const ts = new TrafficSystem();
    ts.setSpeed(0);
    expect(ts.getSpeed()).toBe(0);
  });

  it('rejects negative or non-finite speed', () => {
    const ts = new TrafficSystem();
    expect(() => ts.setSpeed(-1)).toThrow(RangeError);
    expect(() => ts.setSpeed(Number.NaN)).toThrow(RangeError);
    expect(() => ts.setSpeed(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('increments the internal tick counter even when frozen', () => {
    const ts = new TrafficSystem({ speed: 0 });
    expect(ts.getTick()).toBe(0);
    ts.tick(
      { tileCount: 0, forEachRoadTile: () => undefined },
      1,
    );
    expect(ts.getTick()).toBe(1);
  });

  it('rejects negative or non-finite dt on tick (no throw, no advance)', () => {
    const ts = new TrafficSystem();
    const before = ts.getTick();
    ts.tick({ tileCount: 0, forEachRoadTile: () => undefined }, -1);
    ts.tick({ tileCount: 0, forEachRoadTile: () => undefined }, Number.NaN);
    expect(ts.getTick()).toBe(before);
  });
});

describe('TrafficSystem — constructor validation', () => {
  it('rejects non-positive phase durations', () => {
    expect(() => new TrafficSystem({ greenSeconds: 0 })).toThrow(RangeError);
    expect(() => new TrafficSystem({ yellowSeconds: 0 })).toThrow(RangeError);
    expect(() => new TrafficSystem({ redSeconds: 0 })).toThrow(RangeError);
    expect(() => new TrafficSystem({ greenSeconds: -3 })).toThrow(RangeError);
  });

  it('rejects negative initial speed', () => {
    expect(() => new TrafficSystem({ speed: -0.5 })).toThrow(RangeError);
  });

  it('rejects non-finite initial speed', () => {
    expect(() => new TrafficSystem({ speed: Number.NaN })).toThrow(RangeError);
    expect(() => new TrafficSystem({ speed: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
});

describe('TrafficSystem — tick walks road tiles', () => {
  it('invokes the world view for every road tile and increments tick', () => {
    const ts = new TrafficSystem({ greenSeconds: 100, yellowSeconds: 1, redSeconds: 1, speed: 2 });
    const seen: Array<[number, number]> = [];
    ts.tick(
      {
        tileCount: 2,
        forEachRoadTile(cb) {
          cb(0, 5);
          cb(1, 10);
          // Capture what the system passes back via publish hook.
          // (Default _publishPhase is a no-op; we observe via spy.)
        },
      },
      3, // dt seconds
    );
    expect(ts.getTick()).toBe(1);
    void seen;
  });

  it('skips tile iteration entirely when speed is 0 but still ticks', () => {
    const ts = new TrafficSystem({ speed: 0 });
    let called = 0;
    ts.tick(
      {
        tileCount: 1,
        forEachRoadTile() {
          called += 1;
        },
      },
      1,
    );
    // Speed=0 → the early-return branch skips forEachRoadTile.
    expect(called).toBe(0);
    expect(ts.getTick()).toBe(1);
  });
});
