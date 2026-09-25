import { describe, expect, it, vi } from "vitest";

import * as THREE from "three";

import { ERAS, type EraId, type EraUpdateContext } from "../src/era/eraTypes";
import { BUILDING_LOTS, CITY_LAYOUT, VEHICLE_LANE_LOOPS } from "../src/scene/layout";
import { createVehicleSystem } from "../src/scene/vehicles";

const frame = (delta = 1 / 30, elapsed = 0): EraUpdateContext => ({
  era: "1945",
  from: "1945",
  blend: 1,
  weights: { "1945": 1, "1965": 0, "1985": 0, "2005": 0, "2025": 0 },
  delta,
  elapsed,
});

function cyclicGap(from: number, to: number, length: number): number {
  return ((to - from) % length + length) % length;
}

function lengthOf(actor: { group: THREE.Group }): number {
  return Number(actor.group.userData.vehicleLength);
}

function expectSafeSpacing(system: ReturnType<typeof createVehicleSystem>): void {
  for (const lane of VEHICLE_LANE_LOOPS) {
    const actors = [...system.vehicles]
      .filter((actor) => actor.laneId === lane.id)
      .sort((a, b) => a.distance - b.distance);
    const routeLength = lane.waypoints.slice(1).reduce((sum, waypoint, index) => {
      const previous = lane.waypoints[index]!.position;
      return sum + Math.hypot(waypoint.position.x - previous.x, waypoint.position.z - previous.z);
    }, 0);
    for (let index = 0; index < actors.length; index += 1) {
      const follower = actors[index]!;
      const leader = actors[(index + 1) % actors.length]!;
      const gap = cyclicGap(follower.distance, leader.distance, routeLength);
      expect(gap).toBeGreaterThanOrEqual((lengthOf(follower) + lengthOf(leader)) / 2 + 2.59);
    }
  }
}

describe("era vehicle fleets and lane traffic", () => {
  it("builds distinct, detailed vehicle models from each real era descriptor", () => {
    const system = createVehicleSystem({ layout: CITY_LAYOUT, seed: 29, vehicleCount: 12 });
    const requiredKinds: Readonly<Record<EraId, readonly string[]>> = {
      "1945": ["sedan", "truck", "streetcar"],
      "1965": ["tailfin-sedan", "bus"],
      "1985": ["boxy-sedan", "taxi"],
      "2005": ["suv", "hybrid-sedan"],
      "2025": ["ev-hatchback", "autonomous-pod"],
    };

    expect(system.vehicles).toHaveLength(12);
    for (const era of ERAS) {
      system.applyEra(era.id, 1);
      const fleet = system.getFleet(era.id);
      expect(fleet).toHaveLength(12);
      for (const kind of requiredKinds[era.id]) {
        expect(fleet.some((vehicle) => vehicle.kind === kind), `${era.id} missing ${kind}`).toBe(true);
      }
      expect(new Set(fleet.map(({ kind }) => kind)).size).toBeGreaterThan(1);
      for (const vehicle of fleet) {
        expect(vehicle.group.userData.era).toBe(era.id);
        expect(vehicle.group.getObjectByName("wheel-hub")).toBeInstanceOf(THREE.Mesh);
        expect(vehicle.group.getObjectByName("glazed-cabin")).toBeInstanceOf(THREE.Mesh);
        expect(vehicle.group.getObjectByName("front-chrome-bumper")).toBeInstanceOf(THREE.Mesh);
        expect(vehicle.group.getObjectByName("rear-license-plate")).toBeInstanceOf(THREE.Mesh);
        expect(vehicle.group.getObjectByName("emissive-headlight")).toBeInstanceOf(THREE.Mesh);
        expect(vehicle.group.getObjectByName("emissive-taillight")).toBeInstanceOf(THREE.Mesh);
      }
    }
    system.dispose();
  });

  it("follows the real ordered lane loops deterministically with variation and safe spacing", () => {
    const first = createVehicleSystem({ layout: CITY_LAYOUT, seed: 351, vehicleCount: 12 });
    const replay = createVehicleSystem({ layout: CITY_LAYOUT, seed: 351, vehicleCount: 12 });
    const initialDistances = first.vehicles.map(({ distance }) => distance);
    const laneSpeeds = new Set<number>();

    for (let index = 0; index < 3000; index += 1) {
      first.update(frame(0.1, index * 0.1));
      replay.update(frame(0.1, index * 0.1));
      if (index % 300 === 0) expectSafeSpacing(first);
    }
    const replayActors = replay.vehicles;
    expect(first.vehicles.map(({ kind }) => kind)).toEqual(replayActors.map(({ kind }) => kind));
    expect(first.vehicles.map(({ distance }) => distance)).toEqual(replayActors.map(({ distance }) => distance));
    expect(first.vehicles.some((vehicle, index) => vehicle.distance !== initialDistances[index])).toBe(true);
    expect(first.vehicles.some(({ laps }) => laps > 0)).toBe(true);

    for (const actor of first.vehicles) {
      laneSpeeds.add(Math.round(actor.speed * 10) / 10);
      expect(VEHICLE_LANE_LOOPS.some((lane) => lane.id === actor.laneId)).toBe(true);
      expect(Math.abs(actor.group.position.x) === 20.8 || Math.abs(actor.group.position.x) === 23.2
        || Math.abs(actor.group.position.z) === 20.8 || Math.abs(actor.group.position.z) === 23.2).toBe(true);
      expect(Number.isFinite(actor.group.rotation.y)).toBe(true);
      for (const lot of BUILDING_LOTS) {
        const position = actor.group.position;
        expect(position.x < lot.bounds.minX || position.x > lot.bounds.maxX
          || position.z < lot.bounds.minZ || position.z > lot.bounds.maxZ).toBe(true);
      }
    }
    expect(laneSpeeds.size).toBeGreaterThan(1);
    expectSafeSpacing(first);
    first.dispose();
    replay.dispose();
  });

  it("crossfades on shared lane phases, lights at night and disposes retired geometry", () => {
    const system = createVehicleSystem({ layout: CITY_LAYOUT, seed: 5, nightMood: 0 });
    const oldFleet = system.getFleet("1945");
    const sampleGeometry = oldFleet[0]!.group.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
    const disposeGeometry = vi.spyOn(sampleGeometry.geometry, "dispose");

    system.setNightMood(0.8);
    const headlightLight = oldFleet[0]!.group.getObjectByName("headlight-beam") as THREE.PointLight;
    expect(headlightLight.intensity).toBeGreaterThan(0);
    system.applyEra("2025", 0);
    const incoming = system.getFleet("2025");
    expect(system.group.children).toHaveLength(2);
    expect(incoming).toHaveLength(oldFleet.length);
    expect(incoming.map(({ distance }) => distance)).toEqual(oldFleet.map(({ distance }) => distance));
    system.applyEra("2025", 0.5);
    expect(oldFleet[0]!.group.visible).toBe(true);
    expect(incoming[0]!.group.visible).toBe(true);
    expect(incoming[0]!.group.position.toArray()).toEqual(oldFleet[0]!.group.position.toArray());
    system.update(frame(0.1));
    expect(incoming[0]!.distance).toBe(oldFleet[0]!.distance);
    system.applyEra("2025", 1);
    expect(system.group.children).toHaveLength(1);
    expect(system.getFleet("1945")).toHaveLength(0);
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(system.activeEra).toBe("2025");

    system.dispose();
    expect(system.group.children).toHaveLength(0);
    expect(() => system.update(frame())).toThrow(/disposed/);
  });
});
