import { describe, expect, it } from "vitest";

import {
  BUILDING_LOTS,
  CAMERA_LANDMARKS,
  CENTRAL_BLOCK,
  CITY_LAYOUT,
  CROSSWALKS,
  PEDESTRIAN_PATHS,
  PERIMETER_STREETS,
  PROP_SLOTS,
  VEHICLE_LANE_LOOPS,
  type BuildingLot,
  type PedestrianPath,
  type WorldPoint,
} from "../src/scene/layout";

function overlaps(a: BuildingLot, b: BuildingLot): boolean {
  return a.bounds.minX < b.bounds.maxX && a.bounds.maxX > b.bounds.minX
    && a.bounds.minZ < b.bounds.maxZ && a.bounds.maxZ > b.bounds.minZ;
}

function segments(path: PedestrianPath): readonly (readonly [WorldPoint, WorldPoint])[] {
  const result: (readonly [WorldPoint, WorldPoint])[] = [];
  for (let index = 1; index < path.waypoints.length; index += 1) {
    result.push([path.waypoints[index - 1]!, path.waypoints[index]!]);
  }
  if (path.closed && path.waypoints.length > 1) {
    result.push([path.waypoints[path.waypoints.length - 1]!, path.waypoints[0]!]);
  }
  return result;
}

function segmentIntersectsLot([a, b]: readonly [WorldPoint, WorldPoint], lot: BuildingLot): boolean {
  if (a.x === b.x) {
    return a.x >= lot.bounds.minX && a.x <= lot.bounds.maxX
      && Math.max(Math.min(a.z, b.z), lot.bounds.minZ) <= Math.min(Math.max(a.z, b.z), lot.bounds.maxZ);
  }
  if (a.z === b.z) {
    return a.z >= lot.bounds.minZ && a.z <= lot.bounds.maxZ
      && Math.max(Math.min(a.x, b.x), lot.bounds.minX) <= Math.min(Math.max(a.x, b.x), lot.bounds.maxX);
  }
  // The contract intentionally uses axis-aligned pedestrian routes only.
  return true;
}

const expectedFacing = {
  north: { x: 0, z: -1 },
  east: { x: 1, z: 0 },
  south: { x: 0, z: 1 },
  west: { x: -1, z: 0 },
} as const;

describe("city block layout contract", () => {
  it("defines a single block ringed by four complete streets, curbs, sidewalks and marked crossings", () => {
    expect(CITY_LAYOUT.units).toBe("metres");
    expect(CENTRAL_BLOCK.id).toBe("central-block");
    expect(PERIMETER_STREETS.map((street) => street.side).sort()).toEqual(["east", "north", "south", "west"]);
    expect(PERIMETER_STREETS).toHaveLength(4);
    for (const street of PERIMETER_STREETS) {
      expect(street.width).toBeGreaterThan(0);
      expect(street.curbs).toHaveLength(2);
      expect(street.sidewalks).toHaveLength(2);
      expect(street.crosswalkIds).toContain(`${street.side}-crosswalk`);
    }
    expect(CROSSWALKS).toHaveLength(4);
    for (const crosswalk of CROSSWALKS) {
      expect(crosswalk.stripeCount).toBeGreaterThanOrEqual(5);
      expect(crosswalk.stripeWidth).toBeGreaterThan(0);
    }
  });

  it("places non-overlapping building lots on valid street frontages facing toward their street", () => {
    expect(BUILDING_LOTS.length).toBeGreaterThanOrEqual(14);
    for (const lot of BUILDING_LOTS) {
      expect(lot.footprint.width).toBeGreaterThan(0);
      expect(lot.footprint.depth).toBeGreaterThan(0);
      expect(lot.frontageWidth).toBeGreaterThan(0);
      const frontageDirection = lot.frontage === "inner" ? 1 : -1;
      const outward = expectedFacing[lot.streetSide];
      expect(lot.facing).toEqual({ x: outward.x * frontageDirection, z: outward.z * frontageDirection });
      expect(Math.hypot(lot.facing.x, lot.facing.z)).toBeCloseTo(1);
      // Each lot explicitly addresses one of the four perimeter streets and is
      // assigned to the corresponding side of that street.
      expect(PERIMETER_STREETS.some((street) => street.side === lot.streetSide)).toBe(true);
      const street = PERIMETER_STREETS.find(({ side }) => side === lot.streetSide)!;
      const towardStreet = (street.center.x - lot.center.x) * lot.facing.x
        + (street.center.z - lot.center.z) * lot.facing.z;
      expect(towardStreet).toBeGreaterThan(0);
      if (lot.frontage === "inner") {
        const coordinate = lot.streetSide === "north" ? lot.center.z
          : lot.streetSide === "south" ? -lot.center.z
            : lot.streetSide === "east" ? -lot.center.x : lot.center.x;
        expect(coordinate).toBeLessThan(0);
      } else {
        const coordinate = lot.streetSide === "north" ? lot.center.z
          : lot.streetSide === "south" ? lot.center.z
            : lot.streetSide === "east" ? lot.center.x : lot.center.x;
        expect(Math.abs(coordinate)).toBeGreaterThan(26);
      }
    }
    for (let left = 0; left < BUILDING_LOTS.length; left += 1) {
      for (let right = left + 1; right < BUILDING_LOTS.length; right += 1) {
        expect(overlaps(BUILDING_LOTS[left]!, BUILDING_LOTS[right]!)).toBe(false);
      }
    }
    expect(new Set(BUILDING_LOTS.map((lot) => lot.frontage)).size).toBe(2);
  });

  it("provides closed, ordered vehicle lane circuits with continuous driveable segments", () => {
    expect(VEHICLE_LANE_LOOPS.length).toBeGreaterThanOrEqual(1);
    for (const loop of VEHICLE_LANE_LOOPS) {
      expect(loop.closed).toBe(true);
      expect(loop.waypoints.length).toBeGreaterThanOrEqual(5);
      expect(loop.waypoints[0]!.position).toEqual(loop.waypoints[loop.waypoints.length - 1]!.position);
      expect(loop.waypoints.map(({ order }) => order)).toEqual(loop.waypoints.map((_, index) => index));
      for (let index = 1; index < loop.waypoints.length; index += 1) {
        const previous = loop.waypoints[index - 1]!.position;
        const current = loop.waypoints[index]!.position;
        expect(previous.x === current.x || previous.z === current.z).toBe(true);
      }
      for (const { position } of loop.waypoints) {
        expect(Math.abs(position.x) === 20.8 || Math.abs(position.x) === 23.2
          || Math.abs(position.z) === 20.8 || Math.abs(position.z) === 23.2).toBe(true);
      }
    }
  });

  it("routes pedestrian circuits and crossings clear of every building footprint", () => {
    expect(PEDESTRIAN_PATHS.some((path) => path.kind === "sidewalk-loop" && path.closed)).toBe(true);
    expect(PEDESTRIAN_PATHS.filter((path) => path.kind === "crossing")).toHaveLength(4);
    for (const path of PEDESTRIAN_PATHS) {
      expect(path.waypoints.length).toBeGreaterThanOrEqual(2);
      if (path.kind === "crossing") {
        expect(CROSSWALKS.some((crosswalk) => crosswalk.id === path.crosswalkId)).toBe(true);
      }
      for (const segment of segments(path)) {
        for (const lot of BUILDING_LOTS) {
          expect(segmentIntersectsLot(segment, lot), `${path.id} intersects ${lot.id}`).toBe(false);
          const clearanceLot: BuildingLot = {
            ...lot,
            bounds: {
              minX: lot.bounds.minX - 1,
              maxX: lot.bounds.maxX + 1,
              minZ: lot.bounds.minZ - 1,
              maxZ: lot.bounds.maxZ + 1,
            },
          };
          expect(segmentIntersectsLot(segment, clearanceLot), `${path.id} is too close to ${lot.id}`).toBe(false);
        }
      }
    }
  });

  it("exposes typed, anchored placement slots and named navigable camera landmarks", () => {
    const requiredTypes = ["lamp", "tree", "bench", "hydrant", "bus-stop", "signage"];
    for (const type of requiredTypes) {
      expect(PROP_SLOTS.some((slot) => slot.type === type), `missing ${type} slot`).toBe(true);
    }
    const adSlots = PROP_SLOTS.filter((slot) => slot.type === "signage" && slot.signageKind === "advertisement");
    expect(adSlots.length).toBeGreaterThanOrEqual(12);
    for (const slot of PROP_SLOTS) {
      expect(slot.id).toBeTruthy();
      expect(Number.isFinite(slot.anchor.position.x)).toBe(true);
      expect(Number.isFinite(slot.anchor.position.y)).toBe(true);
      expect(Number.isFinite(slot.anchor.position.z)).toBe(true);
      expect(slot.anchor.scale.x).toBeGreaterThan(0);
    }
    for (const slot of adSlots) {
      expect(slot.displaySize?.width).toBeGreaterThan(0);
      expect(slot.displaySize?.height).toBeGreaterThan(0);
    }

    expect(CAMERA_LANDMARKS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(CAMERA_LANDMARKS.map((landmark) => landmark.name)).size).toBe(CAMERA_LANDMARKS.length);
    for (const landmark of CAMERA_LANDMARKS) {
      expect(landmark.name.length).toBeGreaterThan(0);
      expect(landmark.position).not.toEqual(landmark.target);
    }
  });
});
