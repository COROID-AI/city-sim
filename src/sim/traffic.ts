/**
 * Traffic simulation.
 *
 * A lane graph of two crossing streets (plus tram/rail lanes for the eras that
 * still run streetcars) is driven by a signalised intersection. Vehicles
 * accelerate toward their era-tuned cruise speed, brake behind the vehicle
 * ahead, stop at a red light, then flow smoothly around the loop by wrapping
 * their lane distance. Brake lights and turn signals animate accordingly.
 *
 * Pure three.js + maths: no DOM, no renderer, safe to import in Node.
 */

import * as THREE from 'three';
import type { VehicleSpec } from '../config/types';

export type LaneKind = 'road' | 'rail';

export interface LanePath {
  id: string;
  kind: LaneKind;
  axis: 'x' | 'z';
  direction: 1 | -1;
  /** Fixed coordinate of the lane centreline (z for x-axis lanes, x for z-axis). */
  offset: number;
  /** Along-axis bounds of the lane. */
  start: number;
  end: number;
  length: number;
  /** Free-flow speed in metres per second. */
  speed: number;
}

export interface TrafficVehicle {
  object: THREE.Object3D;
  spec: VehicleSpec;
  laneId: string;
  axis: 'x' | 'z';
  direction: 1 | -1;
  laneOffset: number;
  laneStart: number;
  laneEnd: number;
  /** Distance travelled along the lane, 0..laneLength. */
  distance: number;
  laneLength: number;
  speed: number;
  baseSpeed: number;
  braking: boolean;
  brakeLights?: THREE.Mesh[];
  turnSignals?: THREE.Mesh[];
}

export type SignalPhase = 'green' | 'amber' | 'red';

export interface IntersectionSignals {
  x: SignalPhase;
  z: SignalPhase;
}

export const LANE_BOUND = 96;

/** The eight lanes of the block: four road lanes, four rail lanes. */
export function createLaneGraph(): LanePath[] {
  const lane = (
    id: string,
    kind: LaneKind,
    axis: 'x' | 'z',
    direction: 1 | -1,
    offset: number,
    speed: number,
  ): LanePath => ({
    id,
    kind,
    axis,
    direction,
    offset,
    start: -LANE_BOUND,
    end: LANE_BOUND,
    length: LANE_BOUND * 2,
    speed,
  });

  return [
    lane('road-x-out', 'road', 'x', 1, -4.4, 11.5),
    lane('road-x-in', 'road', 'x', -1, 4.4, 11.5),
    lane('road-z-out', 'road', 'z', 1, 4.4, 11),
    lane('road-z-in', 'road', 'z', -1, -4.4, 11),
    lane('rail-x-out', 'rail', 'x', 1, -2.3, 8.4),
    lane('rail-x-in', 'rail', 'x', -1, 2.3, 8.4),
    lane('rail-z-out', 'rail', 'z', 1, 2.3, 8),
    lane('rail-z-in', 'rail', 'z', -1, -2.3, 8),
  ];
}

/** Half-extent of the signalised intersection box. */
const INTERSECTION_HALF = 12;
/** How far before the stop line vehicles begin to slow for a red. */
const APPROACH = 42;
/** Minimum bumper-to-bumper gap. */
const MIN_GAP = 9;
const SIGNAL_CYCLE = 16;

function phaseAt(clock: number): IntersectionSignals {
  const t = clock % SIGNAL_CYCLE;
  if (t < 6.5) return { x: 'green', z: 'red' };
  if (t < 7.8) return { x: 'amber', z: 'red' };
  if (t < 8.4) return { x: 'red', z: 'red' };
  if (t < 14.5) return { x: 'red', z: 'green' };
  return { x: 'red', z: 'amber' };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export class TrafficSim {
  private clock = 0;
  private readonly vehicles: TrafficVehicle[];
  private readonly byLane = new Map<string, TrafficVehicle[]>();

  constructor(vehicles: TrafficVehicle[] = [], startClock = 3) {
    this.vehicles = vehicles;
    this.clock = startClock;
    for (const vehicle of vehicles) {
      const bucket = this.byLane.get(vehicle.laneId);
      if (bucket) bucket.push(vehicle);
      else this.byLane.set(vehicle.laneId, [vehicle]);
    }
  }

  get count(): number {
    return this.vehicles.length;
  }

  get signals(): IntersectionSignals {
    return phaseAt(this.clock);
  }

  /** Where a vehicle sits along its lane axis, in world coordinates. */
  static worldAlong(vehicle: TrafficVehicle): number {
    return vehicle.direction > 0
      ? vehicle.laneStart + vehicle.distance
      : vehicle.laneEnd - vehicle.distance;
  }

  /** Distance to the stop line; negative once inside the intersection. */
  private stopDistance(vehicle: TrafficVehicle, along: number): number {
    return vehicle.direction > 0 ? -INTERSECTION_HALF - along : along - INTERSECTION_HALF;
  }

  update(dt: number): void {
    const step = Math.min(Math.max(dt, 0), 0.1);
    this.clock += step;
    const signals = this.signals;

    // Space vehicles out within each lane, sorted by distance.
    const aheadGap = new Map<TrafficVehicle, number>();
    for (const bucket of this.byLane.values()) {
      if (bucket.length < 2) continue;
      const sorted = bucket.slice().sort((a, b) => a.distance - b.distance);
      for (let i = 0; i < sorted.length; i += 1) {
        const current = sorted[i];
        const next = sorted[(i + 1) % sorted.length];
        const gap = next.distance > current.distance
          ? next.distance - current.distance
          : current.laneLength - current.distance + next.distance;
        aheadGap.set(current, gap);
      }
    }

    for (const vehicle of this.vehicles) {
      const along = TrafficSim.worldAlong(vehicle);
      let target = vehicle.baseSpeed;
      let braking = false;

      const phase = vehicle.axis === 'x' ? signals.x : signals.z;
      const toStop = this.stopDistance(vehicle, along);
      const approaching = toStop > -1 && toStop < APPROACH;

      if (approaching && phase !== 'green') {
        // Ease down to the stop line; amber allows a committed vehicle through.
        const allowed = phase === 'amber' && toStop < 6;
        if (!allowed) {
          target = Math.min(target, Math.max(0, toStop * 0.55));
          braking = toStop < APPROACH * 0.7;
        }
      }

      const gap = aheadGap.get(vehicle);
      if (gap !== undefined && gap < MIN_GAP) {
        target = Math.min(target, vehicle.baseSpeed * clamp((gap - 2) / MIN_GAP, 0, 1));
        braking = true;
      }

      vehicle.speed += (target - vehicle.speed) * Math.min(1, 3.4 * step);
      if (vehicle.speed < 0.02) vehicle.speed = 0;
      vehicle.braking = braking || vehicle.speed < vehicle.baseSpeed * 0.6;

      vehicle.distance += vehicle.speed * step;
      if (vehicle.distance >= vehicle.laneLength) vehicle.distance -= vehicle.laneLength;
      if (vehicle.distance < 0) vehicle.distance += vehicle.laneLength;

      const nextAlong = TrafficSim.worldAlong(vehicle);
      if (vehicle.axis === 'x') vehicle.object.position.set(nextAlong, 0, vehicle.laneOffset);
      else vehicle.object.position.set(vehicle.laneOffset, 0, nextAlong);

      vehicle.object.rotation.y =
        vehicle.axis === 'x'
          ? vehicle.direction > 0
            ? Math.PI / 2
            : -Math.PI / 2
          : vehicle.direction > 0
            ? 0
            : Math.PI;

      this.animateLights(vehicle, nextAlong, braking);
    }
  }

  private animateLights(vehicle: TrafficVehicle, along: number, braking: boolean): void {
    const blink = Math.floor(this.clock * 3.2) % 2 === 0;
    const inIntersectionZone = Math.abs(along) < 40;
    if (vehicle.brakeLights) {
      for (const light of vehicle.brakeLights) {
        const material = light.material as THREE.MeshStandardMaterial;
        if (material && 'emissiveIntensity' in material) {
          material.emissiveIntensity = braking ? 2.8 : 0.3;
        }
      }
    }
    if (vehicle.turnSignals) {
      for (const light of vehicle.turnSignals) {
        const material = light.material as THREE.MeshStandardMaterial;
        if (material && 'emissiveIntensity' in material) {
          material.emissiveIntensity = inIntersectionZone && blink ? 2.2 : 0.15;
        }
      }
    }
  }
}
