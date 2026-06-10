/**
 * Vehicle tests: creation defaults, advance (drive/wait/arrive), resume.
 */
import { createVehicle, advanceVehicle, type Vehicle } from '@/entities/Vehicle';
import type { VehicleId } from '@/types/common';

const id = 'veh-1' as VehicleId;

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return createVehicle({
    id,
    position: { x: 0, y: 0 },
    path: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
    ...overrides,
  } as Parameters<typeof createVehicle>[0]);
}

describe('createVehicle', () => {
  it('applies sensible defaults', () => {
    const v = createVehicle({ id, position: { x: 0, y: 0 } });
    expect(v.path).toEqual([]);
    expect(v.pathIndex).toBe(0);
    expect(v.status).toBe('driving');
    expect(v.speed).toBe(1);
  });

  it('clamps negative speed to 1', () => {
    const v = createVehicle({ id, position: { x: 0, y: 0 }, speed: -5 });
    expect(v.speed).toBe(1);
  });

  it('clamps a NaN speed to 1', () => {
    const v = createVehicle({ id, position: { x: 0, y: 0 }, speed: Number.NaN });
    expect(v.speed).toBe(1);
  });

  it('clamps an out-of-range pathIndex to valid range', () => {
    const v = createVehicle({
      id,
      position: { x: 5, y: 5 }, // not on the path
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      pathIndex: 99,
    });
    expect(v.pathIndex).toBe(1);
    const v2 = createVehicle({
      id,
      position: { x: 5, y: 5 },
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      pathIndex: -3,
    });
    expect(v2.pathIndex).toBe(0);
  });
});

describe('advanceVehicle', () => {
  it('progresses along the path one tile per tick when no red light', () => {
    let v = makeVehicle();
    expect(v.status).toBe('driving');
    // Initial pathIndex auto-skips the starting tile (which matches
    // position), so the first advance moves to path[1] = {1,0}.
    expect(v.pathIndex).toBe(1);
    v = advanceVehicle(v);
    expect(v.position).toEqual({ x: 1, y: 0 });
    expect(v.pathIndex).toBe(2);
    expect(v.status).toBe('driving');
    v = advanceVehicle(v);
    expect(v.position).toEqual({ x: 2, y: 0 });
    expect(v.pathIndex).toBe(3);
    expect(v.status).toBe('arrived');
  });

  it('does not move and transitions to "waiting" when the next tile is in redLightTiles', () => {
    let v = makeVehicle();
    const reds = new Set(['1,0']);
    v = advanceVehicle(v, { redLightTiles: reds });
    expect(v.position).toEqual({ x: 0, y: 0 });
    expect(v.pathIndex).toBe(1);
    expect(v.status).toBe('waiting');
  });

  it('stays in "waiting" while the red light persists', () => {
    let v = makeVehicle();
    const reds = new Set(['1,0']);
    v = advanceVehicle(v, { redLightTiles: reds });
    v = advanceVehicle(v, { redLightTiles: reds });
    expect(v.status).toBe('waiting');
    expect(v.position).toEqual({ x: 0, y: 0 });
  });

  it('resumes driving once the red light clears', () => {
    let v = makeVehicle();
    v = advanceVehicle(v, { redLightTiles: new Set(['1,0']) });
    expect(v.status).toBe('waiting');
    v = advanceVehicle(v, { redLightTiles: new Set() });
    expect(v.status).toBe('driving');
    expect(v.position).toEqual({ x: 1, y: 0 });
  });

  it('returns the same reference when status is "arrived" (no work to do)', () => {
    let v = makeVehicle();
    v = advanceVehicle(v);
    v = advanceVehicle(v);
    expect(v.status).toBe('arrived');
    const same = advanceVehicle(v);
    expect(same).toBe(v);
  });

  it('does not mutate the input vehicle (immutable advance)', () => {
    const v0 = makeVehicle();
    const snapshot = { ...v0 };
    advanceVehicle(v0);
    expect(v0).toEqual(snapshot);
  });
});
