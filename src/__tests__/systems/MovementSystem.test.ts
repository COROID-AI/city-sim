/**
 * Unit tests for MovementSystem (spec §7.2).
 *
 * Covers:
 *  - Walking speed (2 tiles / sim-second).
 *  - Target snapping within ARRIVAL_THRESHOLD (0.5 tiles).
 *  - Commute vehicle threshold (>20 tiles sets commuteMode='vehicle').
 *  - distance() and buildingCenter() helpers.
 *  - Citizens without a target are skipped.
 */
import { Citizen } from '@/entities/Citizen';
import {
  ARRIVAL_THRESHOLD,
  buildingCenter,
  distance,
  MovementSystem,
  updateMovement,
  VEHICLE_DISTANCE_THRESHOLD,
  WALK_SPEED,
} from '@/systems/MovementSystem';
import { mulberry32 } from '@/generation/BuildingPlacer';

describe('distance', () => {
  it('computes Euclidean distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5, 5);
    expect(distance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
  });
});

describe('buildingCenter', () => {
  it('returns the center of a building footprint', () => {
    const center = buildingCenter({
      id: 'b1',
      type: 'house',
      zone: 'residential',
      x: 2,
      y: 4,
      width: 4,
      height: 6,
      def: {} as never,
    });
    expect(center).toEqual({ x: 4, y: 7 });
  });

  it('returns null for undefined building', () => {
    expect(buildingCenter(undefined)).toBeNull();
  });
});

describe('updateMovement', () => {
  const emptyBuildings = new Map();

  it('moves a citizen towards the target at 2 tiles/sim-second', () => {
    const c = new Citizen({ x: 0, y: 0 }, { rng: mulberry32(1) });
    c.setTarget({ x: 10, y: 0 });
    // 1 sim-second => 2 tiles of movement.
    updateMovement([c], 1000, { buildings: emptyBuildings });
    const pos = c.getPosition();
    expect(pos.x).toBeCloseTo(WALK_SPEED, 5);
    expect(pos.y).toBeCloseTo(0, 5);
  });

  it('moves diagonally towards the target (normalized)', () => {
    const c = new Citizen({ x: 0, y: 0 }, { rng: mulberry32(2) });
    c.setTarget({ x: 10, y: 10 });
    // 1 sim-second => 2 tiles along the diagonal direction.
    updateMovement([c], 1000, { buildings: emptyBuildings });
    const pos = c.getPosition();
    // Direction is (1,1)/sqrt(2); step = 2 tiles.
    expect(pos.x).toBeCloseTo(2 / Math.sqrt(2), 5);
    expect(pos.y).toBeCloseTo(2 / Math.sqrt(2), 5);
  });

  it('snaps to target and clears targetPosition when within 0.5 tiles', () => {
    const c = new Citizen({ x: 9.8, y: 0 }, { rng: mulberry32(3) });
    c.setTarget({ x: 10, y: 0 });
    // Distance is 0.2 (< 0.5) => snap.
    updateMovement([c], 1000, { buildings: emptyBuildings });
    expect(c.getPosition()).toEqual({ x: 10, y: 0 });
    expect(c.targetPosition).toBeNull();
  });

  it('does not overshoot the target', () => {
    const c = new Citizen({ x: 9, y: 0 }, { rng: mulberry32(4) });
    c.setTarget({ x: 10, y: 0 });
    // 1 sim-second would move 2 tiles, but distance is only 1 => clamp.
    updateMovement([c], 1000, { buildings: emptyBuildings });
    expect(c.getPosition()).toEqual({ x: 10, y: 0 });
    expect(c.targetPosition).toBeNull();
  });

  it('skips citizens without a targetPosition', () => {
    const c = new Citizen({ x: 5, y: 5 }, { rng: mulberry32(5) });
    expect(c.targetPosition).toBeNull();
    updateMovement([c], 1000, { buildings: emptyBuildings });
    expect(c.getPosition()).toEqual({ x: 5, y: 5 });
  });

  it('sets commuteMode=vehicle when commuting and distance > 20 tiles', () => {
    const c = new Citizen({ x: 0, y: 0 }, { rng: mulberry32(6) });
    c.activity = 'commuting';
    c.setTarget({ x: 30, y: 0 }); // distance 30 > 20
    updateMovement([c], 1000, { buildings: emptyBuildings });
    expect(c.commuteMode).toBe('vehicle');
  });

  it('keeps commuteMode=foot when commuting and distance <= 20 tiles', () => {
    const c = new Citizen({ x: 0, y: 0 }, { rng: mulberry32(7) });
    c.activity = 'commuting';
    c.setTarget({ x: 15, y: 0 }); // distance 15 <= 20
    updateMovement([c], 1000, { buildings: emptyBuildings });
    expect(c.commuteMode).toBe('foot');
  });

  it('does not set vehicle mode for non-commuting activities even if far', () => {
    const c = new Citizen({ x: 0, y: 0 }, { rng: mulberry32(8) });
    c.activity = 'wandering';
    c.setTarget({ x: 40, y: 0 });
    updateMovement([c], 1000, { buildings: emptyBuildings });
    expect(c.commuteMode).toBe('foot');
  });

  it('no-op when deltaSimMs <= 0', () => {
    const c = new Citizen({ x: 0, y: 0 }, { rng: mulberry32(9) });
    c.setTarget({ x: 10, y: 0 });
    updateMovement([c], 0, { buildings: emptyBuildings });
    expect(c.getPosition()).toEqual({ x: 0, y: 0 });
    expect(c.targetPosition).not.toBeNull();
  });
});

describe('MovementSystem (class wrapper)', () => {
  it('delegates to updateMovement', () => {
    const sys = new MovementSystem();
    const c = new Citizen({ x: 0, y: 0 }, { rng: mulberry32(10) });
    c.setTarget({ x: 10, y: 0 });
    sys.update([c], 1000, { buildings: new Map() });
    expect(c.getPosition().x).toBeCloseTo(WALK_SPEED, 5);
  });
});

describe('constants', () => {
  it('exposes the spec values', () => {
    expect(WALK_SPEED).toBe(2);
    expect(ARRIVAL_THRESHOLD).toBe(0.5);
    expect(VEHICLE_DISTANCE_THRESHOLD).toBe(20);
  });
});
