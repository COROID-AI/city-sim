/**
 * Unit tests for TrafficSystem (spec §7.5).
 */
import type { RoadGraph, RoadNode } from '@/engine/types';
import {
  lightStateForDirection,
  MAX_VEHICLES,
  phaseForElapsed,
  TrafficSystem,
} from '@/systems/TrafficSystem';
import { Vehicle } from '@/entities/Vehicle';

/** Helper: build a road node. */
function node(
  id: string,
  x: number,
  y: number,
  kind: 'intersection' | 'entrance' = 'intersection',
): RoadNode {
  return { id, x, y, kind };
}

/** Helper: build a minimal graph containing the given nodes. */
function graphOf(nodes: RoadNode[]): RoadGraph {
  const nodeMap = new Map<string, RoadNode>();
  for (const n of nodes) nodeMap.set(n.id, n);
  return { nodes: nodeMap, edges: new Map() };
}

const SECOND = 1000;

describe('TrafficSystem — phase cycling', () => {
  it('starts in ns-green at elapsed 0', () => {
    expect(phaseForElapsed(0)).toBe('ns-green');
  });

  it('cycles ns-green(30s) -> ns-yellow(5s) -> ew-green(30s) -> ew-yellow(5s)', () => {
    expect(phaseForElapsed(0)).toBe('ns-green');
    expect(phaseForElapsed(29 * SECOND)).toBe('ns-green');
    expect(phaseForElapsed(30 * SECOND)).toBe('ns-yellow');
    expect(phaseForElapsed(34 * SECOND)).toBe('ns-yellow');
    expect(phaseForElapsed(35 * SECOND)).toBe('ew-green');
    expect(phaseForElapsed(64 * SECOND)).toBe('ew-green');
    expect(phaseForElapsed(65 * SECOND)).toBe('ew-yellow');
    expect(phaseForElapsed(69 * SECOND)).toBe('ew-yellow');
    // Wraps back to ns-green at 70s.
    expect(phaseForElapsed(70 * SECOND)).toBe('ns-green');
  });

  it('getPhase reflects the current elapsed time after updates', () => {
    const ts = new TrafficSystem();
    expect(ts.getPhase()).toBe('ns-green');
    ts.update(30 * SECOND);
    expect(ts.getPhase()).toBe('ns-yellow');
    ts.update(5 * SECOND);
    expect(ts.getPhase()).toBe('ew-green');
    ts.update(30 * SECOND);
    expect(ts.getPhase()).toBe('ew-yellow');
    ts.update(5 * SECOND);
    expect(ts.getPhase()).toBe('ns-green');
  });
});

describe('TrafficSystem — lightStateForDirection', () => {
  it('ns sees green/yellow during ns phases, red during ew phases', () => {
    expect(lightStateForDirection('ns-green', 'ns')).toBe('green');
    expect(lightStateForDirection('ns-yellow', 'ns')).toBe('yellow');
    expect(lightStateForDirection('ew-green', 'ns')).toBe('red');
    expect(lightStateForDirection('ew-yellow', 'ns')).toBe('red');
  });

  it('ew sees green/yellow during ew phases, red during ns phases', () => {
    expect(lightStateForDirection('ew-green', 'ew')).toBe('green');
    expect(lightStateForDirection('ew-yellow', 'ew')).toBe('yellow');
    expect(lightStateForDirection('ns-green', 'ew')).toBe('red');
    expect(lightStateForDirection('ns-yellow', 'ew')).toBe('red');
  });
});

describe('TrafficSystem — TrafficLightProvider interface', () => {
  const intersection = node('i1', 10, 10, 'intersection');
  const entrance = node('e1', 0, 0, 'entrance');
  const graph = graphOf([intersection, entrance]);

  it('getLight returns null for unknown / non-intersection nodes', () => {
    const ts = new TrafficSystem({ graph });
    expect(ts.getLight('does-not-exist')).toBeNull();
    expect(ts.getLight('e1')).toBeNull();
  });

  it('getLight returns the right-of-way state for an intersection', () => {
    const ts = new TrafficSystem({ graph, initialElapsedMs: 0 });
    // ns-green phase -> green.
    expect(ts.getLight('i1')).toBe('green');
    ts.update(30 * SECOND); // -> ns-yellow
    expect(ts.getLight('i1')).toBe('yellow');
    ts.update(5 * SECOND); // -> ew-green
    expect(ts.getLight('i1')).toBe('green');
    ts.update(30 * SECOND); // -> ew-yellow
    expect(ts.getLight('i1')).toBe('yellow');
  });

  it('getLightForDirection returns per-direction state', () => {
    const ts = new TrafficSystem({ graph, initialElapsedMs: 0 });
    // ns-green: ns green, ew red.
    expect(ts.getLightForDirection('i1', 'ns')).toBe('green');
    expect(ts.getLightForDirection('i1', 'ew')).toBe('red');
    ts.update(35 * SECOND); // -> ew-green
    expect(ts.getLightForDirection('i1', 'ns')).toBe('red');
    expect(ts.getLightForDirection('i1', 'ew')).toBe('green');
  });
});

describe('TrafficSystem — vehicle management', () => {
  it('addVehicle enforces MAX_VEHICLES cap', () => {
    const ts = new TrafficSystem();
    for (let i = 0; i < MAX_VEHICLES; i++) {
      expect(ts.addVehicle(new Vehicle())).toBe(true);
    }
    expect(ts.vehicleCount()).toBe(MAX_VEHICLES);
    // Cap reached: further additions rejected.
    expect(ts.addVehicle(new Vehicle())).toBe(false);
    expect(ts.vehicleCount()).toBe(MAX_VEHICLES);
  });

  it('addVehicle is idempotent for the same vehicle instance', () => {
    const ts = new TrafficSystem();
    const v = new Vehicle();
    expect(ts.addVehicle(v)).toBe(true);
    expect(ts.addVehicle(v)).toBe(true);
    expect(ts.vehicleCount()).toBe(1);
  });

  it('removeVehicle removes a tracked vehicle', () => {
    const ts = new TrafficSystem();
    const v = new Vehicle();
    ts.addVehicle(v);
    ts.removeVehicle(v);
    expect(ts.vehicleCount()).toBe(0);
  });
});

describe('TrafficSystem — vehicle movement', () => {
  it('moves a vehicle towards the next path node at its speed', () => {
    // First target node is ahead of the vehicle (not at its position).
    const path = [node('a', 10, 0)];
    const v = new Vehicle({ x: 0, y: 0 }, { path, speed: 5 });
    const ts = new TrafficSystem();
    ts.addVehicle(v);
    // 1 sim-second -> 5 tiles.
    ts.update(1 * SECOND);
    expect(v.getPosition().x).toBeCloseTo(5, 5);
    expect(v.getPosition().y).toBeCloseTo(0, 5);
    expect(v.state).toBe('driving');
    expect(v.isStopped).toBe(false);
  });

  it('snaps to node centre and advances currentNodeIndex on arrival', () => {
    const path = [node('a', 5, 0)];
    const v = new Vehicle({ x: 4, y: 0 }, { path, speed: 5 });
    const ts = new TrafficSystem();
    ts.addVehicle(v);
    // 1 sim-second covers 5 tiles: 4 -> 5 (arrive at a).
    ts.update(1 * SECOND);
    // Should have arrived at node 'a' (index 0) and advanced.
    expect(v.currentNodeIndex).toBe(1);
    expect(v.getPosition()).toEqual({ x: 5, y: 0 });
  });

  it('does not move a parked or departed vehicle', () => {
    const path = [node('a', 10, 0)];
    const parked = new Vehicle({ x: 0, y: 0 }, { path, state: 'parked' });
    const departing = new Vehicle({ x: 0, y: 0 }, { path, state: 'departing' });
    const ts = new TrafficSystem();
    ts.addVehicle(parked);
    ts.addVehicle(departing);
    ts.update(1 * SECOND);
    expect(parked.getPosition()).toEqual({ x: 0, y: 0 });
    expect(departing.getPosition()).toEqual({ x: 0, y: 0 });
  });
});

describe('TrafficSystem — traffic light enforcement', () => {
  /**
   * Build a vertical (NS) approach: vehicle south of an intersection,
   * travelling north towards it. During an EW-green phase the NS direction
   * is red, so the vehicle must stop within 2 tiles.
   */
  it('stops a vehicle approaching a red light within 2 tiles', () => {
    const intersection = node('i1', 10, 10, 'intersection');
    const start = node('s1', 10, 12, 'entrance');
    const graph = graphOf([intersection, start]);
    // EW-green phase: NS direction is red.
    const ts = new TrafficSystem({ graph, initialElapsedMs: 35 * SECOND });
    expect(ts.getPhase()).toBe('ew-green');

    // Vehicle 1 tile south of the intersection, heading north (NS).
    const path = [start, intersection];
    const v = new Vehicle({ x: 10, y: 11 }, { path, speed: 5 });
    ts.addVehicle(v);
    ts.update(1 * SECOND);
    expect(v.isStopped).toBe(true);
    expect(v.state).toBe('stopped');
    // Position unchanged (stopped before moving).
    expect(v.getPosition()).toEqual({ x: 10, y: 11 });
  });

  it('does not stop a vehicle that is more than 2 tiles from the light', () => {
    const intersection = node('i1', 10, 10, 'intersection');
    const start = node('s1', 10, 20, 'entrance');
    const graph = graphOf([intersection, start]);
    const ts = new TrafficSystem({ graph, initialElapsedMs: 35 * SECOND });

    // Vehicle 5 tiles south of the intersection: outside STOP_DISTANCE.
    const path = [start, intersection];
    const v = new Vehicle({ x: 10, y: 15 }, { path, speed: 5 });
    ts.addVehicle(v);
    ts.update(1 * SECOND);
    expect(v.isStopped).toBe(false);
    expect(v.state).toBe('driving');
  });

  it('lets a vehicle on a green light path proceed without stopping', () => {
    const intersection = node('i1', 10, 10, 'intersection');
    const graph = graphOf([intersection]);
    // ns-green phase: NS direction is green.
    const ts = new TrafficSystem({ graph, initialElapsedMs: 0 });
    expect(ts.getPhase()).toBe('ns-green');

    // Vehicle heads directly towards the intersection (first target).
    const path = [intersection];
    const v = new Vehicle({ x: 10, y: 12 }, { path, speed: 5 });
    ts.addVehicle(v);
    ts.update(1 * SECOND);
    expect(v.isStopped).toBe(false);
    expect(v.state).toBe('driving');
    // Vehicle moved towards the intersection (y decreased).
    expect(v.getPosition().y).toBeLessThan(12);
  });

  it('resumes a stopped vehicle when the light turns green', () => {
    const intersection = node('i1', 10, 10, 'intersection');
    const start = node('s1', 10, 12, 'entrance');
    const graph = graphOf([intersection, start]);
    // Start in EW-green (NS red).
    const ts = new TrafficSystem({ graph, initialElapsedMs: 35 * SECOND });

    const path = [start, intersection];
    const v = new Vehicle({ x: 10, y: 11 }, { path, speed: 5 });
    ts.addVehicle(v);
    ts.update(1 * SECOND);
    expect(v.isStopped).toBe(true);

    // Advance the clock into the next ns-green phase (after ew-yellow).
    // From 36s: need to reach 70s (next ns-green) = +34s.
    ts.update(34 * SECOND);
    expect(ts.getPhase()).toBe('ns-green');
    // Now the vehicle should resume driving on the next update.
    ts.update(1 * SECOND);
    expect(v.isStopped).toBe(false);
    expect(v.state).toBe('driving');
  });

  it('stops for a yellow light within 2 tiles', () => {
    const intersection = node('i1', 10, 10, 'intersection');
    const start = node('s1', 10, 12, 'entrance');
    const graph = graphOf([intersection, start]);
    // ns-yellow phase: NS direction is yellow.
    const ts = new TrafficSystem({ graph, initialElapsedMs: 30 * SECOND });
    expect(ts.getPhase()).toBe('ns-yellow');

    const path = [start, intersection];
    const v = new Vehicle({ x: 10, y: 11 }, { path, speed: 5 });
    ts.addVehicle(v);
    ts.update(1 * SECOND);
    expect(v.isStopped).toBe(true);
    expect(v.state).toBe('stopped');
  });
});
