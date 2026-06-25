/**
 * Unit tests for the Vehicle entity (spec §5.3, §7.5).
 */
import type { RoadNode } from '@/engine/types';
import {
  DEFAULT_VEHICLE_SPEED,
  NODE_ARRIVAL_THRESHOLD,
  STOP_DISTANCE,
  Vehicle,
} from '@/entities/Vehicle';

/** Helper: build a road node. */
function node(
  id: string,
  x: number,
  y: number,
  kind: 'intersection' | 'entrance' = 'intersection',
): RoadNode {
  return { id, x, y, kind };
}

describe('Vehicle', () => {
  describe('construction', () => {
    it('defaults position to origin and speed to DEFAULT_VEHICLE_SPEED', () => {
      const v = new Vehicle();
      expect(v.getPosition()).toEqual({ x: 0, y: 0 });
      expect(v.speed).toBe(DEFAULT_VEHICLE_SPEED);
      expect(v.state).toBe('driving');
      expect(v.isStopped).toBe(false);
      expect(v.currentNodeIndex).toBe(0);
      expect(v.path).toEqual([]);
      expect(v.citizenId).toBeNull();
      expect(v.id).toBeTruthy();
    });

    it('accepts explicit options including path, speed, state, citizenId', () => {
      const path = [node('a', 0, 0), node('b', 5, 0)];
      const v = new Vehicle({ x: 1, y: 2 }, {
        id: 'veh-1',
        path,
        speed: 8,
        state: 'parked',
        isStopped: true,
        currentNodeIndex: 1,
        citizenId: 'cit-9',
      });
      expect(v.id).toBe('veh-1');
      expect(v.getPosition()).toEqual({ x: 1, y: 2 });
      expect(v.speed).toBe(8);
      expect(v.state).toBe('parked');
      expect(v.isStopped).toBe(true);
      expect(v.currentNodeIndex).toBe(1);
      expect(v.citizenId).toBe('cit-9');
      // path is copied, not referenced.
      expect(v.path).not.toBe(path);
      expect(v.path).toEqual(path);
    });
  });

  describe('path helpers', () => {
    it('hasArrived is true for empty path', () => {
      const v = new Vehicle();
      expect(v.hasArrived()).toBe(true);
      expect(v.targetNode()).toBeNull();
    });

    it('targetNode returns the node at currentNodeIndex', () => {
      const v = new Vehicle({ x: 0, y: 0 }, {
        path: [node('a', 0, 0), node('b', 5, 0)],
      });
      expect(v.targetNode()).toEqual(node('a', 0, 0));
      v.currentNodeIndex = 1;
      expect(v.targetNode()).toEqual(node('b', 5, 0));
      v.currentNodeIndex = 2;
      expect(v.hasArrived()).toBe(true);
      expect(v.targetNode()).toBeNull();
    });

    it('setPath resets progress and state', () => {
      const v = new Vehicle({ x: 0, y: 0 }, {
        path: [node('a', 0, 0)],
        currentNodeIndex: 1,
        isStopped: true,
        state: 'stopped',
      });
      v.setPath([node('b', 1, 1), node('c', 2, 2)]);
      expect(v.currentNodeIndex).toBe(0);
      expect(v.isStopped).toBe(false);
      expect(v.state).toBe('driving');
      expect(v.path).toHaveLength(2);
    });
  });

  describe('state transitions', () => {
    it('stop() sets isStopped and state', () => {
      const v = new Vehicle();
      v.stop();
      expect(v.isStopped).toBe(true);
      expect(v.state).toBe('stopped');
    });

    it('resume() clears isStopped and sets driving', () => {
      const v = new Vehicle({ x: 0, y: 0 }, { isStopped: true, state: 'stopped' });
      v.resume();
      expect(v.isStopped).toBe(false);
      expect(v.state).toBe('driving');
    });
  });

  describe('update hook', () => {
    it('is a no-op that satisfies the Entity contract', () => {
      const v = new Vehicle({ x: 3, y: 4 }, { path: [node('a', 10, 10)] });
      const before = v.getPosition();
      v.update(1000);
      expect(v.getPosition()).toEqual(before);
      expect(v.currentNodeIndex).toBe(0);
    });
  });

  describe('constants', () => {
    it('exposes spec-mandated constants', () => {
      expect(DEFAULT_VEHICLE_SPEED).toBe(5);
      expect(STOP_DISTANCE).toBe(2);
      // Node arrival threshold is small and positive.
      expect(NODE_ARRIVAL_THRESHOLD).toBeGreaterThan(0);
      expect(NODE_ARRIVAL_THRESHOLD).toBeLessThan(1);
    });
  });
});
