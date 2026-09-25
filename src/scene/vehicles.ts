import * as THREE from "three";

import {
  ERAS,
  clampBlend,
  type EraAware,
  type EraConfig,
  type EraId,
  type EraUpdateContext,
  type SceneSystem,
  type VehicleClass,
  type VehicleShare,
} from "../era/eraTypes";
import { CITY_LAYOUT, type CityLayout, type VehicleLaneLoop, type WorldPoint } from "./layout";
import { createVehicleModel, type VehicleModel, type VehicleModelStyle } from "./vehicleModels";

/** Public, observable state for a traffic participant. */
export interface VehicleActor {
  readonly id: string;
  readonly era: EraId;
  readonly kind: string;
  readonly laneId: string;
  readonly group: THREE.Group;
  /** Current segment within the ordered layout waypoints. */
  waypointIndex: number;
  /** Actual distance travelled on the lane's closed route, in metres. */
  distance: number;
  /** Measured speed after following-distance constraints, in metres/second. */
  speed: number;
  /** Number of times this actor has smoothly passed the loop's origin. */
  laps: number;
  /** True while the rounded steering direction is blending across a waypoint. */
  turning: boolean;
}

export interface VehicleSystemOptions {
  readonly layout?: CityLayout;
  readonly seed?: number;
  /** Number of simultaneously moving vehicles, distributed across lane loops. */
  readonly vehicleCount?: number;
  /** 0..1 headlight/tail-light night intensity. */
  readonly nightMood?: number;
}

interface Route {
  readonly lane: VehicleLaneLoop;
  readonly points: readonly WorldPoint[];
  readonly segmentLengths: readonly number[];
  readonly starts: readonly number[];
  readonly length: number;
}

interface TrafficState {
  readonly id: string;
  readonly route: Route;
  readonly slot: number;
  readonly slotCount: number;
  readonly phase: number;
  readonly maxLength: number;
  distance: number;
  laps: number;
  speed: number;
}

interface Fleet {
  readonly era: EraConfig;
  readonly group: THREE.Group;
  readonly actors: VehicleActor[];
  readonly models: VehicleModel[];
  readonly shares: VehicleShare[];
}

const DEFAULT_SEED = 0x4348524f;
const MIN_FOLLOWING_GAP = 2.6;
const TURN_BLEND_DISTANCE = 2.25;
const clamp01 = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/**
 * Procedural, deterministic traffic system for the shared city layout.
 *
 * The 1945 fleet is mounted initially. During an era transition a second,
 * co-located fleet crossfades over it; traffic phases are shared, and the
 * outgoing fleet is disposed only once the incoming fleet is fully visible.
 * This preserves vehicle positions through the complete 0..1 blend.
 */
export class VehicleSystem implements SceneSystem, EraAware {
  readonly id = "vehicles";
  readonly group = new THREE.Group();
  readonly layout: CityLayout;
  readonly seed: number;
  readonly vehicleCount: number;

  private readonly routes: readonly Route[];
  private readonly states: TrafficState[];
  private readonly fleets = new Map<EraId, Fleet>();
  private sourceEra: EraId = "1945";
  private targetEra: EraId = "1945";
  private blend = 1;
  private nightMood: number;
  private disposed = false;

  constructor(options: VehicleSystemOptions = {}) {
    this.layout = options.layout ?? CITY_LAYOUT;
    this.seed = (options.seed ?? DEFAULT_SEED) >>> 0;
    this.vehicleCount = Math.max(this.layout.vehicleLanes.length, Math.floor(options.vehicleCount ?? 12));
    this.nightMood = clamp01(options.nightMood ?? 0);
    if (this.layout.vehicleLanes.length === 0) {
      throw new Error("VehicleSystem requires at least one vehicle lane loop.");
    }
    this.routes = this.layout.vehicleLanes.map(makeRoute);
    this.states = makeTrafficStates(this.routes, this.vehicleCount);
    const initial = this.createFleet("1945");
    this.fleets.set("1945", initial);
    this.group.name = "era-vehicle-traffic";
    this.group.add(initial.group);
  }

  /** Currently dominant era, suitable for scene/status inspection. */
  get activeEra(): EraId {
    return this.blend >= 0.5 ? this.targetEra : this.sourceEra;
  }

  /** Era currently being blended towards. */
  get transitionTarget(): EraId {
    return this.targetEra;
  }

  /** Current progress through the era transition. */
  get transitionBlend(): number {
    return this.blend;
  }

  /** Actors in the currently dominant fleet. */
  get vehicles(): readonly VehicleActor[] {
    return this.fleets.get(this.activeEra)?.actors ?? [];
  }

  /** Read a mounted fleet without making its actor collection mutable. */
  getFleet(era: EraId): readonly VehicleActor[] {
    return this.fleets.get(era)?.actors ?? [];
  }

  /**
   * Crossfade to `era`; values are clamped and repeated calls are idempotent.
   * A new target interrupts an in-flight transition at its visually dominant
   * era, releasing the abandoned fleet before creating the replacement.
   */
  applyEra(era: EraId, blend: number): void {
    this.assertLive();
    const progress = clampBlend(blend);
    if (era !== this.targetEra) {
      const dominant = this.activeEra;
      this.releaseExcept(dominant);
      this.sourceEra = dominant;
      this.targetEra = era;
      if (!this.fleets.has(era)) this.fleets.set(era, this.createFleet(era));
      const sourceFleet = this.fleets.get(this.sourceEra);
      const targetFleet = this.fleets.get(era)!;
      if (sourceFleet && sourceFleet !== targetFleet) this.group.add(targetFleet.group);
    }
    this.blend = progress;
    const source = this.fleets.get(this.sourceEra);
    const target = this.fleets.get(this.targetEra);
    if (source) setFleetOpacity(source, this.sourceEra === this.targetEra ? 1 : 1 - progress);
    if (target) setFleetOpacity(target, this.sourceEra === this.targetEra ? 1 : progress);
    if (progress >= 1) {
      this.sourceEra = era;
      this.targetEra = era;
      this.releaseExcept(era);
      const settled = this.fleets.get(era);
      if (settled) setFleetOpacity(settled, 1);
    }
  }

  /** Drive each lane deterministically, enforcing a non-overlap constraint. */
  update(context: EraUpdateContext): void {
    this.assertLive();
    const delta = Number.isFinite(context.delta) ? Math.max(0, Math.min(context.delta, 0.25)) : 0;
    const sourceEra = this.fleets.get(this.sourceEra)?.era;
    const targetEra = this.fleets.get(this.targetEra)?.era;
    const blend = this.sourceEra === this.targetEra ? 1 : this.blend;
    const proposals = new Map<TrafficState, number>();

    for (const state of this.states) {
      const sourceSpeed = sourceEra ? this.desiredSpeed(sourceEra, state) : 0;
      const targetSpeed = targetEra ? this.desiredSpeed(targetEra, state) : sourceSpeed;
      proposals.set(state, (sourceSpeed + (targetSpeed - sourceSpeed) * blend) * delta);
    }

    if (delta > 0) this.enforceSpacing(proposals);
    for (const state of this.states) {
      const movement = proposals.get(state) ?? 0;
      const previousLap = Math.floor(state.distance / state.route.length);
      state.distance += movement;
      state.laps += Math.floor(state.distance / state.route.length) - previousLap;
      state.speed = delta > 0 ? movement / delta : 0;
      const sample = sampleRoute(state.route, state.distance);
      const routeActors = this.fleets.values();
      for (const fleet of routeActors) {
        const actor = fleet.actors.find(({ id }) => id === state.id);
        if (!actor) continue;
        actor.distance = state.distance;
        actor.laps = state.laps;
        actor.speed = state.speed;
        actor.waypointIndex = sample.segmentIndex;
        actor.turning = sample.turning;
        actor.group.position.set(sample.position.x, sample.position.y, sample.position.z);
        actor.group.rotation.y = sample.heading;
      }
    }
  }

  /** Adjust all era models together so the crossfade shares night conditions. */
  setNightMood(mood: number): void {
    this.assertLive();
    this.nightMood = clamp01(mood);
    for (const fleet of this.fleets.values()) {
      for (const model of fleet.models) model.setNightMood(this.nightMood);
    }
  }

  getPickables(): readonly THREE.Object3D[] {
    return this.vehicles.map(({ group }) => group);
  }

  dispose(): void {
    if (this.disposed) return;
    for (const fleet of this.fleets.values()) disposeFleet(fleet);
    this.fleets.clear();
    this.group.clear();
    this.disposed = true;
  }

  private createFleet(eraId: EraId): Fleet {
    const era = ERAS.find(({ id }) => id === eraId);
    if (!era) throw new Error(`Unknown Chrono City era "${String(eraId)}".`);
    const fleetGroup = new THREE.Group();
    fleetGroup.name = `fleet-${eraId}`;
    fleetGroup.userData.era = eraId;
    const actors: VehicleActor[] = [];
    const models: VehicleModel[] = [];
    const shares: VehicleShare[] = [];
    const mandatory = requiredStyles(eraId);
    const styleById = new Map(this.states.map((state, index) => [state.id, mandatory[index]]));

    this.states.forEach((state, index) => {
      const styleOverride = styleById.get(state.id);
      const share = styleOverride ? findShare(era, styleOverride.shareKind) : weightedShare(era, this.seed, eraId, index);
      const style = styleOverride?.style ?? "stock";
      const model = createVehicleModel(era, share, {
        style,
        plateNumber: seededHash(this.seed, `${eraId}:${state.id}:plate`) % 1000,
        nightMood: this.nightMood,
      });
      const actor: VehicleActor = {
        id: state.id,
        era: eraId,
        kind: styleOverride?.kind ?? share.kind,
        laneId: state.route.lane.id,
        group: model.group,
        waypointIndex: sampleRoute(state.route, state.distance).segmentIndex,
        distance: state.distance,
        speed: state.speed,
        laps: state.laps,
        turning: false,
      };
      fleetGroup.add(model.group);
      actors.push(actor);
      models.push(model);
      shares.push(share);
      (actor.group.userData as Record<string, unknown>).vehicleLength = share.length;
      (actor.group.userData as Record<string, unknown>).vehicleWidth = share.width;
      (actor.group.userData as Record<string, unknown>).laneId = actor.laneId;
      const sample = sampleRoute(state.route, state.distance);
      actor.group.position.set(sample.position.x, sample.position.y, sample.position.z);
      actor.group.rotation.y = sample.heading;
    });
    return { era, group: fleetGroup, actors, models, shares };
  }

  private desiredSpeed(era: EraConfig, state: TrafficState): number {
    const fleet = this.fleets.get(era.id);
    const index = this.states.indexOf(state);
    const share = fleet?.shares[index];
    if (!share) return era.vehicles.speedLimit;
    const variation = 0.86 + seededFraction(this.seed, `${era.id}:${state.id}:speed`) * 0.28;
    const laneLimit = state.route.lane.waypoints.reduce((limit, waypoint) => Math.min(limit, waypoint.speedKph / 3.6), Infinity);
    return Math.min(share.speed * variation, era.vehicles.speedLimit, laneLimit);
  }

  private enforceSpacing(proposals: Map<TrafficState, number>): void {
    const lanes = new Map<Route, TrafficState[]>();
    for (const state of this.states) {
      const laneStates = lanes.get(state.route) ?? [];
      laneStates.push(state);
      lanes.set(state.route, laneStates);
    }
    for (const [route, laneStates] of lanes) {
      laneStates.sort((a, b) => a.distance - b.distance);
      for (let pass = 0; pass < laneStates.length + 1; pass += 1) {
        let changed = false;
        for (let index = 0; index < laneStates.length; index += 1) {
          const follower = laneStates[index]!;
          const leader = laneStates[(index + 1) % laneStates.length]!;
          if (follower === leader) continue;
          const gap = positiveModulo(leader.distance - follower.distance, route.length);
          const effectiveLength = Math.max(follower.maxLength, leader.maxLength);
          const minimumCenterGap = effectiveLength + MIN_FOLLOWING_GAP;
          const allowed = Math.max(0, gap - minimumCenterGap + (proposals.get(leader) ?? 0));
          const current = proposals.get(follower) ?? 0;
          if (current > allowed + 1e-9) {
            proposals.set(follower, allowed);
            changed = true;
          }
        }
        if (!changed) break;
      }
    }
  }

  private releaseExcept(era: EraId): void {
    for (const [id, fleet] of this.fleets) {
      if (id === era) continue;
      this.group.remove(fleet.group);
      disposeFleet(fleet);
      this.fleets.delete(id);
    }
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("VehicleSystem has been disposed.");
  }
}

/** Factory with the real shared block layout selected by default. */
export function createVehicleSystem(options: VehicleSystemOptions = {}): VehicleSystem {
  return new VehicleSystem(options);
}

function makeRoute(lane: VehicleLaneLoop): Route {
  const points = lane.waypoints.map(({ position }) => position);
  if (points.length < 2) throw new Error(`Vehicle lane "${lane.id}" needs at least two ordered waypoints.`);
  const segmentLengths: number[] = [];
  const starts: number[] = [];
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index]!;
    const current = points[index + 1]!;
    const segmentLength = Math.hypot(current.x - previous.x, current.z - previous.z);
    if (segmentLength <= 0) continue;
    starts.push(length);
    segmentLengths.push(segmentLength);
    length += segmentLength;
  }
  if (lane.closed && (points[0]!.x !== points.at(-1)!.x || points[0]!.z !== points.at(-1)!.z)) {
    const last = points.at(-1)!;
    const first = points[0]!;
    const segmentLength = Math.hypot(first.x - last.x, first.z - last.z);
    starts.push(length);
    segmentLengths.push(segmentLength);
    length += segmentLength;
  }
  if (!Number.isFinite(length) || length <= 0) throw new Error(`Vehicle lane "${lane.id}" has no driveable length.`);
  return { lane, points, segmentLengths, starts, length };
}

function makeTrafficStates(routes: readonly Route[], count: number): TrafficState[] {
  const counts = routes.map((_, index) => Math.floor(count / routes.length) + (index < count % routes.length ? 1 : 0));
  const states: TrafficState[] = [];
  routes.forEach((route, routeIndex) => {
    const slotCount = counts[routeIndex]!;
    for (let slot = 0; slot < slotCount; slot += 1) {
      const phase = (slot + 0.5) / slotCount;
      states.push({
        id: `${route.lane.id}:${slot}`,
        route,
        slot,
        slotCount,
        phase,
        maxLength: 12.5,
        distance: phase * route.length,
        laps: 0,
        speed: 0,
      });
    }
  });
  return states;
}

function requiredStyles(era: EraId): readonly { kind: string; style: VehicleModelStyle; shareKind: VehicleClass }[] {
  switch (era) {
    case "1945":
      return [
        { kind: "sedan", style: "stock", shareKind: "sedan" },
        { kind: "truck", style: "stock", shareKind: "truck" },
        { kind: "streetcar", style: "stock", shareKind: "streetcar" },
      ];
    case "1965":
      return [
        { kind: "tailfin-sedan", style: "tailfin-sedan", shareKind: "sedan" },
        { kind: "bus", style: "stock", shareKind: "bus" },
      ];
    case "1985":
      return [
        { kind: "boxy-sedan", style: "boxy-sedan", shareKind: "sedan" },
        { kind: "taxi", style: "stock", shareKind: "taxi" },
      ];
    case "2005":
      return [
        { kind: "suv", style: "stock", shareKind: "suv" },
        { kind: "hybrid-sedan", style: "hybrid-sedan", shareKind: "compact" },
      ];
    case "2025":
      return [
        { kind: "ev-hatchback", style: "stock", shareKind: "ev-hatchback" },
        { kind: "autonomous-pod", style: "autonomous-pod", shareKind: "ev-hatchback" },
      ];
  }
}

function findShare(era: EraConfig, kind: VehicleClass): VehicleShare {
  const match = era.vehicles.mix.find((share) => share.kind === kind);
  if (match) return match;
  const fallback = era.vehicles.mix[0];
  if (!fallback) throw new Error(`Era ${era.id} has no vehicle model recipes.`);
  return fallback;
}

function weightedShare(era: EraConfig, seed: number, eraId: EraId, index: number): VehicleShare {
  const total = era.vehicles.mix.reduce((sum, share) => sum + share.share, 0);
  let selection = seededFraction(seed, `${eraId}:${index}:kind`) * total;
  for (const share of era.vehicles.mix) {
    selection -= share.share;
    if (selection < 0) return share;
  }
  return era.vehicles.mix.at(-1)!;
}

function sampleRoute(route: Route, distance: number): {
  position: WorldPoint;
  heading: number;
  segmentIndex: number;
  turning: boolean;
} {
  const traveled = positiveModulo(distance, route.length);
  let segmentIndex = route.segmentLengths.length - 1;
  for (let index = 0; index < route.segmentLengths.length; index += 1) {
    if (traveled < route.starts[index]! + route.segmentLengths[index]! || index === route.segmentLengths.length - 1) {
      segmentIndex = index;
      break;
    }
  }
  const startDistance = route.starts[segmentIndex]!;
  const segmentLength = route.segmentLengths[segmentIndex]!;
  const amount = Math.max(0, Math.min(1, (traveled - startDistance) / segmentLength));
  const from = route.points[segmentIndex]!;
  const to = route.points[segmentIndex + 1] ?? route.points[0]!;
  const x = from.x + (to.x - from.x) * amount;
  const z = from.z + (to.z - from.z) * amount;
  const currentHeading = Math.atan2(to.x - from.x, to.z - from.z);
  const previousIndex = (segmentIndex - 1 + route.segmentLengths.length) % route.segmentLengths.length;
  const nextIndex = (segmentIndex + 1) % route.segmentLengths.length;
  const previousHeading = headingForSegment(route, previousIndex);
  const nextHeading = headingForSegment(route, nextIndex);
  const distanceFromStart = traveled - startDistance;
  const distanceToEnd = segmentLength - distanceFromStart;
  let heading = currentHeading;
  let turning = false;
  if (distanceFromStart < TURN_BLEND_DISTANCE) {
    const weight = smoothstep(1 - distanceFromStart / TURN_BLEND_DISTANCE);
    heading = lerpAngle(previousHeading, currentHeading, weight);
    turning = true;
  } else if (distanceToEnd < TURN_BLEND_DISTANCE) {
    const weight = smoothstep(1 - distanceToEnd / TURN_BLEND_DISTANCE);
    heading = lerpAngle(currentHeading, nextHeading, weight);
    turning = true;
  }
  const y = from.y + (to.y - from.y) * amount;
  return { position: { x, y, z }, heading, segmentIndex, turning };
}

function headingForSegment(route: Route, index: number): number {
  const from = route.points[index]!;
  const to = route.points[index + 1] ?? route.points[0]!;
  return Math.atan2(to.x - from.x, to.z - from.z);
}

function setFleetOpacity(fleet: Fleet, opacity: number): void {
  const weight = clamp01(opacity);
  fleet.group.visible = weight > 0;
  fleet.group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const item of materials) {
      if (!(item instanceof THREE.Material)) continue;
      const basic = item as THREE.Material & { opacity: number; transparent: boolean; depthWrite: boolean; userData: Record<string, unknown> };
      if (basic.userData.baseOpacity === undefined) basic.userData.baseOpacity = basic.opacity;
      if (basic.userData.baseTransparent === undefined) basic.userData.baseTransparent = basic.transparent;
      if (basic.userData.baseDepthWrite === undefined) basic.userData.baseDepthWrite = basic.depthWrite;
      basic.opacity = Number(basic.userData.baseOpacity) * weight;
      basic.transparent = weight < 1 || Boolean(basic.userData.baseTransparent);
      basic.depthWrite = weight >= 1 ? Boolean(basic.userData.baseDepthWrite) : false;
      basic.needsUpdate = true;
    }
  });
}

function disposeFleet(fleet: Fleet): void {
  for (const model of fleet.models) model.dispose();
  fleet.group.clear();
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function seededHash(seed: number, value: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function seededFraction(seed: number, value: string): number {
  return seededHash(seed, value) / 0x100000000;
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function lerpAngle(from: number, to: number, amount: number): number {
  let delta = (to - from + Math.PI) % (Math.PI * 2);
  if (delta < 0) delta += Math.PI * 2;
  delta -= Math.PI;
  return from + delta * amount;
}
