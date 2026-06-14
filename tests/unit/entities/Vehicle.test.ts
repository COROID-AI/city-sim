/**
 * Unit tests for the Vehicle entity (src/entities/Vehicle.ts).
 *
 * Path semantics (from Vehicle.ts):
 *  - path[0] is the tile the vehicle is CURRENTLY in.
 *  - path[1] is the next tile to enter.
 *  - When the path is reduced to a single entry, the vehicle has arrived.
 *
 * Happy path: createVehicle builds a sensible default; advanceVehicle
 * steps one tile at a time along the path; vehicleBlocksTile reports
 * occupancy.
 * Failure path: a vehicle with a blocked next tile enters
 * 'waiting_for_vehicle' instead of advancing; a red intersection puts
 * it into 'waiting_for_light'.
 */

import {
  advanceVehicle,
  createVehicle,
  vehicleBlocksTile,
  type OccupancySet,
  type TrafficSnapshot,
} from '@/entities/Vehicle';
import type { RoadGraph, TileCoord } from '@/engine/types';

const EMPTY_GRAPH: RoadGraph = {
  nodes: [],
  adjacency: [],
  indexByCoord: new Map(),
  size: 0,
};

const GREEN: TrafficSnapshot = {
  isGreenAt: () => true,
  isIntersection: () => false,
};

const RED_AT: (c: TileCoord) => TrafficSnapshot = (c) => ({
  isGreenAt: (cc) => !(cc.x === c.x && cc.y === c.y),
  isIntersection: (cc) => cc.x === c.x && cc.y === c.y,
});

class SetOccupancy implements OccupancySet {
  private readonly s = new Set<string>();
  static key(c: TileCoord): string { return `${c.x},${c.y}`; }
  has(c: TileCoord) { return this.s.has(SetOccupancy.key(c)); }
  add(c: TileCoord) { this.s.add(SetOccupancy.key(c)); }
  get size() { return this.s.size; }
}

describe('createVehicle', () => {
  it('builds a sensible default vehicle with state "driving" for a non-trivial path', () => {
    const v = createVehicle({
      id: 'v1',
      ownerId: 'c1',
      destinationId: 'work',
      startTile: { x: 0, y: 0 },
      // path[0] = current, path[1..] = remaining tiles to enter.
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    });
    expect(v.id).toBe('v1');
    expect(v.ownerId).toBe('c1');
    expect(v.destinationId).toBe('work');
    expect(v.state).toBe('driving');
    expect(v.position).toEqual({ x: 0.5, y: 0.5 });
    expect(v.path.length).toBe(3);
  });

  it('produces a "driving" vehicle with a path of one (the current tile) but advance consumes it', () => {
    const v = createVehicle({
      id: 'v2',
      startTile: { x: 5, y: 5 },
      path: [{ x: 5, y: 5 }],
    });
    expect(v.state).toBe('driving');
    // advance consumes the last entry → arrived.
    const occ = new SetOccupancy();
    const v2 = advanceVehicle(v, EMPTY_GRAPH, GREEN, occ);
    expect(v2.state).toBe('arrived');
  });

  it('throws when id or startTile is missing', () => {
    expect(() => createVehicle({ id: '', startTile: { x: 0, y: 0 }, path: [] })).toThrow(RangeError);
    // @ts-expect-error intentional bad call
    expect(() => createVehicle({ id: 'v', path: [] })).toThrow(RangeError);
  });
});

describe('advanceVehicle', () => {
  it('advances one tile along a clear path', () => {
    const v = createVehicle({
      id: 'v1',
      startTile: { x: 0, y: 0 },
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    });
    const occ = new SetOccupancy();
    const v2 = advanceVehicle(v, EMPTY_GRAPH, GREEN, occ);
    // We were at path[0]=(0,0); we entered path[1]=(1,0).
    expect(v2.position).toEqual({ x: 1.5, y: 0.5 });
    // Path drops the consumed entry; (1,0) is now path[0].
    expect(v2.path).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
    expect(v2.state).toBe('driving');
  });

  it('arrives when the last tile is consumed', () => {
    // path = [current, next]. After advancing we have consumed the
    // only `next`; what remains is path[0] = destination, so the
    // vehicle has arrived.
    const v = createVehicle({
      id: 'v1',
      startTile: { x: 0, y: 0 },
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    });
    const occ = new SetOccupancy();
    const v2 = advanceVehicle(v, EMPTY_GRAPH, GREEN, occ);
    expect(v2.state).toBe('arrived');
    expect(v2.path).toEqual([{ x: 1, y: 0 }]);
    // Position should be at the destination tile centre.
    expect(v2.position).toEqual({ x: 1.5, y: 0.5 });
  });

  it('remains driving when the path has 3+ entries', () => {
    const v = createVehicle({
      id: 'v1',
      startTile: { x: 0, y: 0 },
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
    });
    const occ = new SetOccupancy();
    const v2 = advanceVehicle(v, EMPTY_GRAPH, GREEN, occ);
    expect(v2.state).toBe('driving');
    expect(v2.path.length).toBe(3);
  });

  it('enters waiting_for_vehicle when the next tile is blocked', () => {
    const v = createVehicle({
      id: 'v1',
      startTile: { x: 0, y: 0 },
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    });
    const occ = new SetOccupancy();
    occ.add({ x: 1, y: 0 }); // block the next tile
    // Use a non-empty traffic snapshot so isIntersection is well-defined.
    const v2 = advanceVehicle(v, EMPTY_GRAPH, { isGreenAt: () => true, isIntersection: () => false }, occ);
    expect(v2.state).toBe('waiting_for_vehicle');
    expect(v2.position).toEqual(v.position);
    expect(v2.path).toEqual(v.path);
  });

  it('enters waiting_for_light at a red intersection', () => {
    const v = createVehicle({
      id: 'v1',
      startTile: { x: 0, y: 0 },
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    });
    const occ = new SetOccupancy();
    const v2 = advanceVehicle(v, EMPTY_GRAPH, RED_AT({ x: 1, y: 0 }), occ);
    expect(v2.state).toBe('waiting_for_light');
  });

  it('is a no-op when the vehicle has already arrived', () => {
    const v = createVehicle({
      id: 'v1',
      startTile: { x: 0, y: 0 },
      path: [{ x: 0, y: 0 }],
    });
    // Force arrived.
    const arrived: typeof v = { ...v, state: 'arrived', path: [] };
    const occ = new SetOccupancy();
    const v2 = advanceVehicle(arrived, EMPTY_GRAPH, GREEN, occ);
    expect(v2.state).toBe('arrived');
  });
});

describe('vehicleBlocksTile', () => {
  it('reports the head of the path as blocked', () => {
    const v = createVehicle({
      id: 'v1',
      startTile: { x: 0, y: 0 },
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    });
    // path[0] is the current tile.
    expect(vehicleBlocksTile(v, { x: 0, y: 0 })).toBe(true);
    expect(vehicleBlocksTile(v, { x: 1, y: 0 })).toBe(false);
  });

  it('does not block any tile when the vehicle is arrived', () => {
    const v = createVehicle({
      id: 'v1',
      startTile: { x: 0, y: 0 },
      path: [{ x: 0, y: 0 }],
    });
    const arrived: typeof v = { ...v, state: 'arrived', path: [] };
    expect(vehicleBlocksTile(arrived, { x: 0, y: 0 })).toBe(false);
  });
});
