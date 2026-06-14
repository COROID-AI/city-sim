/**
 * Unit tests for the headlight behavior helper on Vehicle.
 *
 * The dayPhase mapping is:
 *   - 6 <= hour <= 20 → no headlight (daytime)
 *   - everything else → headlight on (night)
 *
 * Plus the related state-machine assertions for an arrived vehicle.
 */

import {
  advanceVehicle,
  createVehicle,
  shouldRenderHeadlight,
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

class SetOccupancy implements OccupancySet {
  private readonly s = new Set<string>();
  has(c: TileCoord) { return this.s.has(`${c.x},${c.y}`); }
}

describe('shouldRenderHeadlight', () => {
  it('returns true outside 6..20 (inclusive)', () => {
    // Production contract: !(hour >= 6 && hour <= 20) → true only when
    // hour < 6 OR hour > 20.
    expect(shouldRenderHeadlight(0)).toBe(true);
    expect(shouldRenderHeadlight(3)).toBe(true);
    expect(shouldRenderHeadlight(5.99)).toBe(true);
    expect(shouldRenderHeadlight(20.01)).toBe(true);
    expect(shouldRenderHeadlight(20.5)).toBe(true);
    expect(shouldRenderHeadlight(23.99)).toBe(true);
  });

  it('returns false within 6..20 (inclusive of both endpoints)', () => {
    expect(shouldRenderHeadlight(6)).toBe(false);
    expect(shouldRenderHeadlight(12)).toBe(false);
    expect(shouldRenderHeadlight(19.99)).toBe(false);
    expect(shouldRenderHeadlight(20)).toBe(false);
  });
});

describe('Vehicle idle / arrived semantics', () => {
  it('an arrived vehicle blocks no tile', () => {
    const v = createVehicle({
      id: 'v-idle',
      startTile: { x: 0, y: 0 },
      path: [{ x: 0, y: 0 }],
    });
    const arrived: typeof v = { ...v, state: 'arrived', path: [] };
    expect(vehicleBlocksTile(arrived, { x: 0, y: 0 })).toBe(false);
  });

  it('an arrived vehicle is a no-op for advance', () => {
    const v = createVehicle({
      id: 'v-idle-2',
      startTile: { x: 0, y: 0 },
      path: [{ x: 0, y: 0 }],
    });
    const arrived: typeof v = { ...v, state: 'arrived', path: [] };
    const v2 = advanceVehicle(arrived, EMPTY_GRAPH, GREEN, new SetOccupancy());
    expect(v2.state).toBe('arrived');
  });
});

describe('Vehicle light behavior — manual override', () => {
  it('exposes the four documented states', () => {
    const v = createVehicle({
      id: 'v',
      startTile: { x: 0, y: 0 },
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    });
    expect(['driving', 'waiting_for_light', 'waiting_for_vehicle', 'arrived']).toContain(v.state);
  });

  it('a vehicle with a blocked next tile flips to waiting_for_vehicle (hazard intent)', () => {
    const v = createVehicle({
      id: 'v',
      startTile: { x: 0, y: 0 },
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    });
    const occ = new SetOccupancy();
    occ.has = (c) => c.x === 1 && c.y === 0;
    const v2 = advanceVehicle(v, EMPTY_GRAPH, GREEN, occ);
    expect(v2.state).toBe('waiting_for_vehicle');
  });
});
