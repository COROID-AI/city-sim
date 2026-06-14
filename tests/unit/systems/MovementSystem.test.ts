/**
 * Tests for src/systems/MovementSystem.ts.
 *
 * Pure logic: 1 citizen, fixed dt, fixed target, no obstacles. We
 * assert position, velocity, and arrival.
 */

import {
  MovementSystem,
  MOVEMENT_ARRIVAL_TOLERANCE,
  MOVEMENT_TILES_PER_SECOND,
} from '@/systems/MovementSystem';
import { createCitizen, type Citizen } from '@/entities/Citizen';
import type { Citizen as CitizenType } from '@/engine/types';
import type { MovementSystemWorldView } from '@/systems/MovementSystem';

/** Build a minimal MovementSystemWorldView from a list of citizens. */
function makeWorld(citizens: Citizen[]): MovementSystemWorldView {
  return {
    citizens_() {
      let i = 0;
      const it: IterableIterator<CitizenType> = {
        next() {
          if (i < citizens.length) {
            return { value: citizens[i++] as CitizenType, done: false };
          }
          return { value: undefined as unknown as CitizenType, done: true };
        },
        [Symbol.iterator]() {
          return this;
        },
      };
      return it;
    },
  };
}

describe('MovementSystem', () => {
  test('exports sensible constants', () => {
    expect(MOVEMENT_TILES_PER_SECOND).toBe(2);
    expect(MOVEMENT_ARRIVAL_TOLERANCE).toBeGreaterThan(0);
  });

  test('rejects bad constructor options', () => {
    expect(() => new MovementSystem({ tilesPerSecond: 0 })).toThrow(RangeError);
    expect(() => new MovementSystem({ tilesPerSecond: -1 })).toThrow(RangeError);
    expect(() => new MovementSystem({ tilesPerSecond: Number.NaN })).toThrow(RangeError);
    expect(() => new MovementSystem({ arrivalTolerance: -1 })).toThrow(RangeError);
  });

  test('a single citizen walks to its target at 2 tiles/s', () => {
    const c = createCitizen({ id: 'c1', position: { x: 0, y: 0 } });
    const sys = new MovementSystem();
    sys.setTarget(c, 10, 0);
    sys.update(makeWorld([c]), 1); // 1s → 2 tiles
    expect(c.position.x).toBeCloseTo(2, 5);
    expect(c.position.y).toBeCloseTo(0, 5);
    expect(c.velocity.x).toBeCloseTo(2, 5);
    expect(c.velocity.y).toBeCloseTo(0, 5);
  });

  test('velocity magnitude is exactly tilesPerSecond when in motion', () => {
    const c = createCitizen({ id: 'c1', position: { x: 0, y: 0 } });
    const sys = new MovementSystem();
    sys.setTarget(c, 3, 4); // distance = 5
    sys.update(makeWorld([c]), 0.5);
    const speed = Math.hypot(c.velocity.x, c.velocity.y);
    expect(speed).toBeCloseTo(2, 5);
  });

  test('arrives within tolerance and zeros velocity', () => {
    const c = createCitizen({ id: 'c1', position: { x: 0, y: 0 } });
    const sys = new MovementSystem();
    sys.setTarget(c, 1, 0); // 1 tile away
    sys.update(makeWorld([c]), 10); // far more than needed
    expect(c.position.x).toBeCloseTo(1, 5);
    expect(c.position.y).toBeCloseTo(0, 5);
    expect(Math.hypot(c.velocity.x, c.velocity.y)).toBe(0);
  });

  test('citizens without a target have zero velocity', () => {
    const c = createCitizen({ id: 'c1', position: { x: 0, y: 0 } });
    const sys = new MovementSystem();
    sys.update(makeWorld([c]), 1);
    expect(c.velocity.x).toBe(0);
    expect(c.velocity.y).toBe(0);
  });

  test('clearTarget stops the citizen', () => {
    const c = createCitizen({ id: 'c1', position: { x: 0, y: 0 } });
    const sys = new MovementSystem();
    sys.setTarget(c, 10, 0);
    sys.update(makeWorld([c]), 0.5);
    expect(Math.hypot(c.velocity.x, c.velocity.y)).toBeCloseTo(2, 5);
    sys.clearTarget(c);
    sys.update(makeWorld([c]), 0.5);
    expect(c.velocity.x).toBe(0);
    expect(c.velocity.y).toBe(0);
  });

  test('diagonal walk normalises correctly', () => {
    const c = createCitizen({ id: 'c1', position: { x: 0, y: 0 } });
    const sys = new MovementSystem();
    sys.setTarget(c, 10, 10);
    sys.update(makeWorld([c]), 1);
    // Step = 2; distance = sqrt(200) ≈ 14.142; ux = uy = 1/sqrt(2)
    expect(c.position.x).toBeCloseTo(2 / Math.SQRT2, 5);
    expect(c.position.y).toBeCloseTo(2 / Math.SQRT2, 5);
  });

  test('rejects bad dt', () => {
    const c = createCitizen({ id: 'c1', position: { x: 0, y: 0 } });
    const sys = new MovementSystem();
    sys.setTarget(c, 10, 0);
    expect(() => sys.update(makeWorld([c]), -1)).toThrow(RangeError);
    expect(() => sys.update(makeWorld([c]), Number.NaN)).toThrow(RangeError);
  });

  test('rejects bad setTarget coords', () => {
    const c = createCitizen({ id: 'c1' });
    const sys = new MovementSystem();
    expect(() => sys.setTarget(c, Number.NaN, 0)).toThrow(RangeError);
    expect(() => sys.setTarget(c, 0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
