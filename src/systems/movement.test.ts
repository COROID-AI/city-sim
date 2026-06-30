/**
 * Unit tests for the movement system (src/systems/movement.ts).
 *
 * These tests exercise the pure path math — no WebGL / R3F required.
 */
import {
  SIDEWALK_PATH,
  ROAD_PATH,
  pathPerimeter,
  positionOnPath,
  headingOnPath,
  advanceProgress,
  createAgents,
  stepAgents,
  withLaneOffset,
} from './movement';

describe('movement system', () => {
  describe('pathPerimeter', () => {
    it('computes the perimeter of a rectangular loop', () => {
      // halfWidth=24, halfDepth=24, offset=0 → 2*(48+48)=192
      expect(pathPerimeter(SIDEWALK_PATH)).toBe(192);
    });

    it('accounts for lateral offset', () => {
      const path = { halfWidth: 10, halfDepth: 10, offset: 2 };
      // 2*(24+24) = 96
      expect(pathPerimeter(path)).toBe(96);
    });
  });

  describe('positionOnPath', () => {
    it('starts at the +X / +Z corner region', () => {
      const [x, y, z] = positionOnPath(SIDEWALK_PATH, 0);
      expect(x).toBeCloseTo(24);
      expect(y).toBe(0);
      expect(z).toBeCloseTo(24);
    });

    it('reaches the −Z edge at t=0.25', () => {
      const [x, , z] = positionOnPath(SIDEWALK_PATH, 0.25);
      expect(x).toBeCloseTo(24);
      expect(z).toBeCloseTo(-24);
    });

    it('reaches the −X / −Z corner at t=0.5', () => {
      const [x, , z] = positionOnPath(SIDEWALK_PATH, 0.5);
      expect(x).toBeCloseTo(-24);
      expect(z).toBeCloseTo(-24);
    });

    it('reaches the +Z edge at t=0.75', () => {
      const [x, , z] = positionOnPath(SIDEWALK_PATH, 0.75);
      expect(x).toBeCloseTo(-24);
      expect(z).toBeCloseTo(24);
    });

    it('wraps around at t=1.0 back to start', () => {
      const start = positionOnPath(ROAD_PATH, 0);
      const wrapped = positionOnPath(ROAD_PATH, 1);
      expect(wrapped[0]).toBeCloseTo(start[0]);
      expect(wrapped[2]).toBeCloseTo(start[2]);
    });

    it('handles negative progress by wrapping', () => {
      const pos = positionOnPath(ROAD_PATH, -0.25);
      const expected = positionOnPath(ROAD_PATH, 0.75);
      expect(pos[0]).toBeCloseTo(expected[0]);
      expect(pos[2]).toBeCloseTo(expected[2]);
    });
  });

  describe('headingOnPath', () => {
    it('faces −Z (PI) on the first segment', () => {
      expect(headingOnPath(SIDEWALK_PATH, 0.1)).toBeCloseTo(Math.PI);
    });

    it('faces −X on the second segment', () => {
      expect(headingOnPath(SIDEWALK_PATH, 0.3)).toBeCloseTo(-Math.PI / 2);
    });

    it('faces +Z (0) on the third segment', () => {
      expect(headingOnPath(SIDEWALK_PATH, 0.6)).toBeCloseTo(0);
    });

    it('faces +X on the fourth segment', () => {
      expect(headingOnPath(SIDEWALK_PATH, 0.8)).toBeCloseTo(Math.PI / 2);
    });
  });

  describe('advanceProgress', () => {
    it('advances progress proportionally to speed and perimeter', () => {
      // perimeter=100, speed=10, delta=1s → distance=10 → 0.1 progress
      const result = advanceProgress(0, 1, 10, 100);
      expect(result).toBeCloseTo(0.1);
    });

    it('wraps past 1.0', () => {
      const result = advanceProgress(0.95, 1, 20, 100);
      // 0.95 + 0.2 = 1.15 → wraps to 0.15
      expect(result).toBeCloseTo(0.15);
    });

    it('returns 0 for zero perimeter', () => {
      expect(advanceProgress(0.5, 1, 10, 0)).toBe(0);
    });
  });

  describe('createAgents', () => {
    it('creates the requested number of agents', () => {
      const agents = createAgents(5, [1, 2], 50);
      expect(agents).toHaveLength(5);
    });

    it('clamps to maxTotal', () => {
      const agents = createAgents(100, [1, 2], 10);
      expect(agents).toHaveLength(10);
    });

    it('distributes progress evenly', () => {
      const agents = createAgents(4, [1, 2], 50);
      expect(agents[0].progress).toBeCloseTo(0);
      expect(agents[1].progress).toBeCloseTo(0.25);
      expect(agents[2].progress).toBeCloseTo(0.5);
      expect(agents[3].progress).toBeCloseTo(0.75);
    });

    it('assigns speeds within the given range', () => {
      const agents = createAgents(3, [2, 4], 50);
      for (const a of agents) {
        expect(a.speed).toBeGreaterThanOrEqual(2);
        expect(a.speed).toBeLessThanOrEqual(4);
      }
    });

    it('returns empty array for count 0', () => {
      expect(createAgents(0, [1, 2], 50)).toHaveLength(0);
    });
  });

  describe('stepAgents', () => {
    it('advances all agents in place', () => {
      const agents = createAgents(3, [10, 10], 50);
      const before = agents.map((a) => a.progress);
      stepAgents(agents, 0.5, 100);
      // each moves 10*0.5/100 = 0.05 forward
      agents.forEach((a, i) => {
        expect(a.progress).toBeCloseTo(
          ((before[i] + 0.05) % 1 + 1) % 1,
        );
      });
    });
  });

  describe('withLaneOffset', () => {
    it('produces a path with increased offset', () => {
      const offset = withLaneOffset(SIDEWALK_PATH, 1.5);
      expect(offset.offset).toBe(1.5);
      expect(offset.halfWidth).toBe(SIDEWALK_PATH.halfWidth);
    });
  });
});
