/**
 * Crowd simulation.
 *
 * A small set of closed sidewalk loops around the block plus two market strips
 * along the streets. Pedestrians steer along the loops with a cheap walk cycle,
 * queue at the kerb, and only step onto a crosswalk when the cross traffic has
 * a red light - so the crowds visibly obey the same intersection as the cars.
 *
 * The era tunes pace (1945 strollers vs 2025 phone-watching fast walkers) and
 * the sim pauses walkers when their rig carries a phone.
 */

import * as THREE from 'three';
import type { OutfitSpec } from '../config/types';
import type { IntersectionSignals } from './traffic';
import { FRONTAGE, LAYOUT } from '../world/roads';

/** Named parts of a pedestrian figure that the walk cycle drives. */
export interface PedestrianRig {
  root: THREE.Group;
  head: THREE.Object3D;
  torso: THREE.Object3D;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  height: number;
  /** Walk-cycle phase, radians. */
  phase: number;
  /** Forward lean applied to the torso. */
  lean: number;
  speed?: number;
  role?: 'walker' | 'idler';
}

export interface Waypoint {
  x: number;
  z: number;
}

export interface SidewalkRoute {
  id: string;
  points: Waypoint[];
  /** Cumulative arc length at each point. */
  cumulative: number[];
  length: number;
}

export interface CrowdMember {
  rig: PedestrianRig;
  outfit: OutfitSpec;
  routeIndex: number;
  /** Distance travelled along the route. */
  distance: number;
  speed: number;
  /** Seconds left of an idle pause (chatting, window shopping, phone). */
  idle: number;
  paused: boolean;
}

function makeRoute(id: string, points: Waypoint[]): SidewalkRoute {
  const cumulative: number[] = [0];
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(b.x - a.x, b.z - a.z);
    cumulative.push(total);
  }
  // Drop the duplicated final entry so cumulative[i] matches segment i.
  cumulative.pop();
  return { id, points, cumulative, length: total };
}

/** Sidewalk loops and market strips of the block. */
export function createSidewalkGraph(): SidewalkRoute[] {
  const inner = FRONTAGE + LAYOUT.sidewalkWidth * 0.5;
  const outer = FRONTAGE + LAYOUT.sidewalkWidth;
  const far = 78;
  const ring = (id: string, radius: number): SidewalkRoute =>
    makeRoute(id, [
      { x: -radius, z: -radius },
      { x: radius, z: -radius },
      { x: radius, z: radius },
      { x: -radius, z: radius },
    ]);

  return [
    ring('ring-inner', inner),
    ring('ring-outer', Math.max(inner + 0.9, LAYOUT.streetHalfWidth + 3)),
    // Market strips: up one side of the street and back down the other.
    makeRoute('strip-x', [
      { x: -far, z: inner },
      { x: far, z: inner },
      { x: far, z: outer },
      { x: -far, z: outer },
    ]),
    makeRoute('strip-z', [
      { x: -inner, z: -far },
      { x: -inner, z: far },
      { x: -outer, z: far },
      { x: -outer, z: -far },
    ]),
  ];
}

/** Sample a point + heading along a route. */
export function sampleRoute(route: SidewalkRoute, distance: number): { x: number; z: number; heading: number } {
  const t = ((distance % route.length) + route.length) % route.length;
  let segment = 0;
  for (let i = 0; i < route.points.length; i += 1) {
    const next = i + 1 < route.points.length ? route.cumulative[i + 1] : route.length;
    if (t >= route.cumulative[i] && t < next) {
      segment = i;
      break;
    }
    segment = i;
  }
  const a = route.points[segment];
  const b = route.points[(segment + 1) % route.points.length];
  const segStart = route.cumulative[segment];
  const segLength = Math.max(1e-4, (segment + 1 < route.points.length ? route.cumulative[segment + 1] : route.length) - segStart);
  const local = (t - segStart) / segLength;
  const x = a.x + (b.x - a.x) * local;
  const z = a.z + (b.z - a.z) * local;
  return { x, z, heading: Math.atan2(b.x - a.x, b.z - a.z) };
}

/** Intersection half-extent used for crosswalk gating. */
const CROSS_HALF = 14;

const WALK_CYCLE_RATE = 3.4;

export class CrowdSim {
  private readonly members: CrowdMember[];
  private readonly routes: SidewalkRoute[];
  private readonly paceFactor: number;
  private readonly crossingCount: number;
  private elapsed = 0;

  constructor(members: CrowdMember[], routes: SidewalkRoute[], paceFactor = 1) {
    this.members = members;
    this.routes = routes;
    this.paceFactor = paceFactor;
    this.crossingCount = members.filter((member) => member.paused).length;
  }

  get count(): number {
    return this.members.length;
  }

  /** Number of pedestrians currently waiting at a kerb. */
  get waiting(): number {
    return this.members.reduce((total, member) => total + (member.paused ? 1 : 0), 0);
  }

  get walking(): number {
    return this.members.length - this.waiting;
  }

  update(dt: number, signals: IntersectionSignals): void {
    const step = Math.min(Math.max(dt, 0), 0.1);
    this.elapsed += step;
    void this.crossingCount;

    this.members.forEach((member, index) => {
      const route = this.routes[member.routeIndex % this.routes.length];
      const sample = sampleRoute(route, member.distance);

      // Direction of travel decides which street they are crossing.
      const travellingAlongX = Math.abs(Math.cos(sample.heading)) > Math.abs(Math.sin(sample.heading));
      const insideCrossing = Math.abs(sample.x) < CROSS_HALF && Math.abs(sample.z) < CROSS_HALF;
      const permitted = travellingAlongX ? signals.z === 'red' : signals.x === 'red';

      if (member.idle > 0) {
        member.idle -= step;
        member.paused = true;
      } else if (insideCrossing && !permitted) {
        member.paused = true;
      } else {
        member.paused = false;
        // Phone-watchers and idlers pause now and then.
        if (member.outfit.accessory === 'phone' && this.hashChance(index, 0.004)) member.idle = 1.6 + this.hashChance(index, 0.5) * 2;
        else if (index % 7 === 0 && this.hashChance(index, 0.003)) member.idle = 2.2;
      }

      const speed = member.paused ? 0 : member.speed * this.paceFactor;
      member.distance += speed * step;

      const next = sampleRoute(route, member.distance);
      member.rig.root.position.set(next.x, LAYOUT.sidewalkY, next.z);
      member.rig.root.rotation.y = next.heading;

      // Walk cycle: legs and arms counter-swing, torso gently bobs.
      member.rig.phase += speed * step * WALK_CYCLE_RATE;
      const swing = Math.sin(member.rig.phase) * (speed > 0 ? 0.72 : 0.06);
      member.rig.leftLeg.rotation.x = swing;
      member.rig.rightLeg.rotation.x = -swing;
      member.rig.leftArm.rotation.x = -swing * 0.75;
      member.rig.rightArm.rotation.x = swing * 0.75;
      member.rig.torso.rotation.x = -member.rig.lean;
      member.rig.root.position.y = LAYOUT.sidewalkY + (speed > 0 ? Math.abs(Math.sin(member.rig.phase)) * 0.035 : 0);
      member.rig.root.updateMatrixWorld();
    });
  }

  /** Cheap deterministic per-member random in [0,1). */
  private hashChance(index: number, salt: number): number {
    const value = Math.sin((index + 1) * 12.9898 + this.elapsed * 0.37 + salt * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }
}
