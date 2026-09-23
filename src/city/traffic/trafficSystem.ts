/**
 * Chrono City — traffic system: lane spline, driving behaviour and era fleets.
 *
 * The lane geometry is *derived* from the shared `BlockLayout` constants, never
 * copied: the circulating lane of each road leg is read from `ROADS`, and the
 * closed loop is assembled from those lane centre lines plus a 4 m turning arc
 * at every block corner (the arc radius is the parameter that keeps the whole
 * centre line on the asphalt ring while still turning like a real intersection).
 * Everything the system drives on is therefore guaranteed to sit between the
 * sidewalk edge and the storefront kerb that `environment-street-dressing`
 * builds its streetscape on.
 *
 * Behaviour, all deterministic and frame-rate independent:
 *   * car following — safe-distance controller with a headway, so a stopped or
 *     parking vehicle produces a queue that dissipates again;
 *   * signals — one stop line per block corner on the circulating lane, driven
 *     by a deterministic cycle, so vehicles stop before the crosswalks;
 *   * parking — parkable vehicles pull into a kerbside bay (the lane is a single
 *     4 m carriageway, so followers queue and often honk, then it departs);
 *   * wheels — every wheel spins at `speed / radius` and the spin is exposed in
 *     the snapshot so the browser harness can assert it;
 *   * lamps — head/tail lamps follow the era's lighting mood, brake lamps light
 *     under deceleration and indicators blink while parking or departing.
 *
 * Era blending: the system is an `EraBlendable`. When the timeline moves it
 * retires and spawns vehicles *progressively* across the tween — every spawn
 * and retire carries a deterministic threshold, so mid-transition both fleets
 * are on the street and the swap reads as traffic turning over.
 *
 * Lifecycle:
 *   create    → the system is built by the `TrafficApi` with a `VehicleFactory`,
 *               a seeded `RandomSource` and optional audio / registry handles.
 *   consume   → `setEra` / `updateEraTransition` take the timeline's era calls,
 *               `update(deltaSeconds)` advances one frame.
 *   integrate → the `TrafficApi` adds `group` to the scene, registers the tick
 *               and publishes the snapshot for HUD and browser probes.
 */

import * as THREE from 'three';

import {
  clamp01,
  type EraBlendable,
  type EraId,
  type EraTransitionInfo,
  type EraTransitionOptions,
} from '../../core/eraContracts';
import {
  CROSSWALK_ANCHORS,
  LANE_WIDTH,
  ROAD_CENTER_X,
  ROAD_CENTER_Z,
  ROAD_INNER_X,
  ROAD_INNER_Z,
  isOnRoad,
  roadSegment,
  type BlockCornerId,
  type BlockSide,
  type RoadLane,
  type Vec2,
} from '../../core/blockLayout';
import type { RandomSource } from '../../core/sceneContext';
import { getEraDescriptor } from '../../era/eraDescriptors';
import type { AudioDirector, PositionalEmitter } from '../../audio/audioDirector';
import type { InspectionRegistry } from '../../interaction/inspectionRegistry';
import {
  DEFAULT_FLEET_SIZE,
  MAX_FLEET_SIZE,
  MIN_FLEET_SIZE,
  buildEraFleetPlan,
  eraLightLevel,
  type EraFleetPlan,
  type VehicleBuild,
  type VehicleFactory,
  type VehicleModelSpec,
} from './vehicleFactory';

export const TRAFFIC_SYSTEM_VERSION = 1;

/** Turning radius used at every block corner (metres). */
export const LANE_TURN_RADIUS = LANE_WIDTH;

/** Polyline samples per corner arc; the straights are single segments. */
export const ARC_SAMPLES = 8;

/** Ticker the traffic system registers on the `SceneContext`. */
export const TRAFFIC_SYSTEM_ID = 'city-traffic';

/** Runs just after the era timeline (-1000) so it sees fresh progress. */
export const TRAFFIC_SYSTEM_ORDER = -100;

/** Stop line stand-off before a crosswalk band (metres). */
export const STOP_MARGIN = 0.6;

/** Standstill gap between queued vehicles (metres). */
export const MIN_FOLLOW_GAP = 2.2;

/** Following headway: one extra second of gap per m/s of speed. */
export const FOLLOW_TIME_HEADWAY = 1.1;

/** Signal cycle: four staggered phases, red for six seconds each. */
export const SIGNAL_CYCLE_MS = 16_000;
export const SIGNAL_RED_MS = 6_000;

/** How long a blocked driver waits before leaning on the horn. */
export const HORN_PATIENCE_MS = 1_400;
export const HORN_COOLDOWN_MS = 5_500;

/** Kerbside pull-in a parked vehicle aims for, before width clamping. */
export const PARK_LATERAL = 1.2;

/** Default dwell bounds for a parked vehicle (milliseconds). */
export const PARK_DWELL_MIN_MS = 3_500;
export const PARK_DWELL_MAX_MS = 8_500;

/** Indicator blink half-period. */
const BLINK_MS = 400;

/* ------------------------------------------------------------------------- *
 * Lane spline
 * ------------------------------------------------------------------------- */

/** The leg a vehicle arrives on when it reaches a corner (clockwise loop). */
export const CORNER_APPROACH: Readonly<Record<BlockCornerId, BlockSide>> = Object.freeze({
  northEast: 'north',
  southEast: 'east',
  southWest: 'south',
  northWest: 'west',
});

/** Leg order of the circulating loop. */
export const CIRCULATION_ORDER: readonly BlockSide[] = Object.freeze([
  'north',
  'east',
  'south',
  'west',
]);

/** Heading a leg's circulating lane travels along. */
export const CIRCULATION_HEADING: Readonly<Record<BlockSide, BlockSide>> = Object.freeze({
  north: 'east',
  east: 'south',
  south: 'west',
  west: 'north',
});

/** The lane of one leg that carries the clockwise circulation. */
export function circulatingLane(side: BlockSide): RoadLane {
  const segment = roadSegment(side);
  const wanted = CIRCULATION_HEADING[side];
  const lane = segment.lanes.find((candidate) => candidate.heading === wanted);
  if (!lane) throw new RangeError(`Road leg ${side} has no circulating lane.`);
  return lane;
}

/** One straight or arc run of the loop, in arc-length coordinates. */
export interface LaneRun {
  readonly kind: 'straight' | 'arc';
  /** Road leg for straights, block corner for arcs. */
  readonly id: BlockSide | BlockCornerId;
  readonly start: number;
  readonly end: number;
  readonly length: number;
}

export interface LaneSample {
  readonly x: number;
  readonly z: number;
  readonly headingRad: number;
}

/** A closed lane centre line, sampled by arc length. */
export class LanePath {
  /** Loop vertices; the loop closes from the last vertex back to the first. */
  readonly points: readonly Vec2[];
  readonly runs: readonly LaneRun[];
  readonly length: number;
  readonly turnRadius: number;
  /** `true` when every vertex of the centre line sits on the asphalt ring. */
  readonly onRoad: boolean;
  private readonly cumulative: readonly number[];

  constructor(points: readonly Vec2[], runs: readonly LaneRun[], turnRadius: number) {
    if (points.length < 4) throw new RangeError('LanePath needs at least four points.');
    this.points = Object.freeze(points.map((point) => Object.freeze({ x: point.x, z: point.z })));
    this.runs = Object.freeze(runs);
    this.turnRadius = turnRadius;

    const cumulative: number[] = [0];
    let total = 0;
    for (let index = 0; index < this.points.length; index += 1) {
      const from = this.points[index] as Vec2;
      const to = this.points[(index + 1) % this.points.length] as Vec2;
      total += Math.hypot(to.x - from.x, to.z - from.z);
      cumulative.push(total);
    }
    this.length = total;
    this.cumulative = Object.freeze(cumulative);
    this.onRoad = this.points.every((point) => isOnRoad(point));
  }

  /** Wraps an arc length into `[0, length)`. */
  wrap(distance: number): number {
    const wrapped = distance % this.length;
    return wrapped < 0 ? wrapped + this.length : wrapped;
  }

  /** Position on the loop `distance` metres from the start. */
  pointAt(distance: number): Vec2 {
    const target = this.wrap(distance);
    const index = this.segmentIndex(target);
    const from = this.points[index] as Vec2;
    const to = this.points[(index + 1) % this.points.length] as Vec2;
    const start = this.cumulative[index] as number;
    const span = Math.hypot(to.x - from.x, to.z - from.z);
    const ratio = span === 0 ? 0 : (target - start) / span;
    return { x: from.x + (to.x - from.x) * ratio, z: from.z + (to.z - from.z) * ratio };
  }

  /** Unit tangent (direction of travel) at an arc length. */
  tangentAt(distance: number): Vec2 {
    const index = this.segmentIndex(this.wrap(distance));
    const from = this.points[index] as Vec2;
    const to = this.points[(index + 1) % this.points.length] as Vec2;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const span = Math.hypot(dx, dz);
    return span === 0 ? { x: 0, z: 1 } : { x: dx / span, z: dz / span };
  }

  /**
   * Heading in radians for a three.js Y rotation: the vehicle's local `+Z`
   * points along the tangent, so `rotation.y = headingAt(s)`.
   */
  headingAt(distance: number): number {
    const tangent = this.tangentAt(distance);
    return Math.atan2(tangent.x, tangent.z);
  }

  /**
   * Unit normal pointing **towards the kerb** (the block side of the lane), so a
   * positive lateral offset pulls a vehicle to the kerb and never past it.
   */
  normalAt(distance: number): Vec2 {
    const tangent = this.tangentAt(distance);
    return { x: -tangent.z, z: tangent.x };
  }

  /** Arc length of the loop point closest to `point`. */
  project(point: Vec2): number {
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestAlong = 0;
    for (let index = 0; index < this.points.length; index += 1) {
      const from = this.points[index] as Vec2;
      const to = this.points[(index + 1) % this.points.length] as Vec2;
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const spanSquared = dx * dx + dz * dz;
      const start = this.cumulative[index] as number;
      let ratio = 0;
      if (spanSquared > 0) {
        ratio = ((point.x - from.x) * dx + (point.z - from.z) * dz) / spanSquared;
        ratio = Math.min(1, Math.max(0, ratio));
      }
      const px = from.x + dx * ratio;
      const pz = from.z + dz * ratio;
      const distance = Math.hypot(point.x - px, point.z - pz);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestAlong = start + Math.sqrt(spanSquared) * ratio;
      }
    }
    return this.wrap(bestAlong);
  }

  /** Evenly spaced samples of the loop, for evidence and tests. */
  sampleByDistance(step = 4): readonly LaneSample[] {
    const samples: LaneSample[] = [];
    const count = Math.max(4, Math.round(this.length / Math.max(0.5, step)));
    for (let index = 0; index < count; index += 1) {
      const distance = (index / count) * this.length;
      const point = this.pointAt(distance);
      samples.push(Object.freeze({ x: point.x, z: point.z, headingRad: this.headingAt(distance) }));
    }
    return Object.freeze(samples);
  }

  private segmentIndex(distance: number): number {
    for (let index = 0; index < this.cumulative.length - 1; index += 1) {
      if (distance <= (this.cumulative[index + 1] as number)) return index;
    }
    return this.points.length - 1;
  }
}

function arcPoints(
  centre: Vec2,
  radius: number,
  from: Vec2,
  to: Vec2,
  samples: number,
): readonly Vec2[] {
  const startAngle = Math.atan2(from.z - centre.z, from.x - centre.x);
  const endAngle = Math.atan2(to.z - centre.z, to.x - centre.x);
  let sweep = endAngle - startAngle;
  while (sweep <= -Math.PI) sweep += Math.PI * 2;
  while (sweep > Math.PI) sweep -= Math.PI * 2;

  const points: Vec2[] = [];
  for (let index = 0; index < samples; index += 1) {
    const angle = startAngle + (sweep * index) / samples;
    points.push({ x: centre.x + radius * Math.cos(angle), z: centre.z + radius * Math.sin(angle) });
  }
  return points;
}

/**
 * Builds the circulating lane loop straight off `BlockLayout`:
 * each leg contributes its lane centre line between the two corner arcs, and
 * every corner contributes a quarter arc around the kerb corner. The arc centre
 * is offset from both lane lines by the turn radius, which is what keeps the
 * whole loop inside the asphalt ring.
 */
export function buildTrafficLanePath(turnRadius: number = LANE_TURN_RADIUS): LanePath {
  const legs = CIRCULATION_ORDER.map((side) => {
    const segment = roadSegment(side);
    const lane = circulatingLane(side);
    return {
      side,
      axis: segment.axis,
      cross: segment.center + lane.offset,
      dir: lane.direction,
      corners: CROSSWALK_ANCHORS,
    };
  });

  // Arc per corner between leg `index` and leg `index + 1`.
  const arcs = legs.map((leg, index) => {
    const next = legs[(index + 1) % legs.length] as (typeof legs)[number];
    const thisAlongX = leg.axis === 'x';
    const nextAlongX = next.axis === 'x';
    // Right-hand normal component along each leg's cross axis.
    const centreCrossThis = leg.cross + turnRadius * (thisAlongX ? leg.dir : -leg.dir);
    const centreCrossNext = next.cross + turnRadius * (nextAlongX ? next.dir : -next.dir);
    const centre: Vec2 = thisAlongX
      ? { x: centreCrossNext, z: centreCrossThis }
      : { x: centreCrossThis, z: centreCrossNext };
    const from: Vec2 = thisAlongX ? { x: centreCrossNext, z: leg.cross } : { x: leg.cross, z: centreCrossNext };
    const to: Vec2 = nextAlongX ? { x: centreCrossThis, z: next.cross } : { x: next.cross, z: centreCrossThis };
    const id = (Object.keys(CORNER_APPROACH) as BlockCornerId[]).find(
      (corner) => CORNER_APPROACH[corner] === leg.side,
    ) as BlockCornerId;
    return { id, centre, from, to, radius: turnRadius };
  });

  const points: Vec2[] = [];
  const runs: LaneRun[] = [];
  let cursor = 0;

  legs.forEach((leg, index) => {
    const arc = arcs[index] as (typeof arcs)[number];
    const previousArc = arcs[(index - 1 + arcs.length) % arcs.length] as (typeof arcs)[number];
    const straightStart = previousArc.to;
    const straightEnd = arc.from;
    points.push({ x: straightStart.x, z: straightStart.z });
    const straightLength = Math.hypot(straightEnd.x - straightStart.x, straightEnd.z - straightStart.z);
    runs.push({
      kind: 'straight',
      id: leg.side,
      start: cursor,
      end: cursor + straightLength,
      length: straightLength,
    });
    cursor += straightLength;

    const arcRadius = Math.hypot(arc.to.x - arc.centre.x, arc.to.z - arc.centre.z);
    const arcLength = Math.abs(arcRadius * Math.PI * 0.5);
    for (const point of arcPoints(arc.centre, arc.radius, arc.from, arc.to, ARC_SAMPLES)) {
      points.push(point);
    }
    runs.push({ kind: 'arc', id: arc.id, start: cursor, end: cursor + arcLength, length: arcLength });
    cursor += arcLength;
  });

  return new LanePath(points, runs, turnRadius);
}

/* ------------------------------------------------------------------------- *
 * Signals and bays
 * ------------------------------------------------------------------------- */

export interface TrafficSignal {
  readonly corner: BlockCornerId;
  readonly road: BlockSide;
  /** Arc length of the stop line on the circulating lane. */
  readonly stopDistance: number;
  readonly offsetMs: number;
}

/** One stop line per block corner, on the leg a vehicle arrives from. */
export function buildTrafficSignals(path: LanePath): readonly TrafficSignal[] {
  const signals: TrafficSignal[] = [];
  (Object.keys(CORNER_APPROACH) as BlockCornerId[]).forEach((corner, index) => {
    const road = CORNER_APPROACH[corner];
    const anchor = CROSSWALK_ANCHORS.find(
      (candidate) => candidate.corner === corner && candidate.road === road,
    );
    if (!anchor) return;
    const centre = path.project(anchor.center);
    const stopDistance = path.wrap(centre - anchor.width / 2 - STOP_MARGIN);
    signals.push(
      Object.freeze({ corner, road, stopDistance, offsetMs: Math.round((index * SIGNAL_CYCLE_MS) / 4) }),
    );
  });
  return Object.freeze(signals);
}

/** `true` while the given corner's approach has a red. */
export function signalIsRed(signal: TrafficSignal, elapsedMs: number): boolean {
  const phase = (((elapsedMs + signal.offsetMs) % SIGNAL_CYCLE_MS) + SIGNAL_CYCLE_MS) % SIGNAL_CYCLE_MS;
  return phase < SIGNAL_RED_MS;
}

/** A kerbside bay on one leg, expressed in lane coordinates. */
export interface ParkBay {
  readonly id: string;
  readonly side: BlockSide;
  readonly distance: number;
  /** Desired pull-in towards the kerb (metres), clamped per vehicle width. */
  readonly lateral: number;
  occupiedBy: string | null;
}

/** Two bays per leg, at 30% and 70% of each straight. */
export function buildParkBays(path: LanePath): readonly ParkBay[] {
  const bays: ParkBay[] = [];
  for (const run of path.runs) {
    if (run.kind !== 'straight') continue;
    for (const fraction of [0.3, 0.7]) {
      bays.push({
        id: `bay-${run.id}-${Math.round(fraction * 100)}`,
        side: run.id as BlockSide,
        distance: path.wrap(run.start + run.length * fraction),
        lateral: PARK_LATERAL,
        occupiedBy: null,
      });
    }
  }
  return Object.freeze(bays);
}

/* ------------------------------------------------------------------------- *
 * Runtime vehicles
 * ------------------------------------------------------------------------- */

export type VehicleState = 'cruising' | 'parking' | 'parked' | 'departing';

/** One circulating vehicle. */
export interface TrafficVehicle {
  readonly id: string;
  readonly era: EraId;
  readonly spec: VehicleModelSpec;
  readonly build: VehicleBuild;
  /** Arc length of the reference point on the lane loop. */
  s: number;
  /** Metres per second. */
  speed: number;
  lateral: number;
  targetLateral: number;
  state: VehicleState;
  stateMs: number;
  wheelsSpin: number;
  engineOn: boolean;
  braking: boolean;
  bay: ParkBay | null;
  hornCooldownMs: number;
  /** Countdown before a cruisng parkable vehicle looks for a bay again. */
  bayRetryMs: number;
  blockedMs: number;
  notable: boolean;
  readonly worldPosition: THREE.Vector3;
  emitter: PositionalEmitter | null;
}

export interface TrafficHornEvent {
  readonly vehicleId: string;
  readonly era: EraId;
  readonly model: string;
  readonly reason: 'blocked' | 'manual';
  readonly atMs: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly rate: number;
  readonly gain: number;
  /** `true` when the AudioDirector actually synthesized a voice. */
  readonly played: boolean;
  readonly voiceId: number | null;
}

export interface TrafficVehicleSnapshot {
  readonly id: string;
  readonly era: EraId;
  readonly model: string;
  readonly label: string;
  readonly vehicleClass: string;
  readonly colour: string;
  readonly state: VehicleState;
  readonly speedKph: number;
  readonly s: number;
  readonly lateral: number;
  readonly x: number;
  readonly z: number;
  readonly headingDeg: number;
  readonly wheelsSpin: number;
  readonly details: readonly string[];
  readonly notable: boolean;
  readonly engineOn: boolean;
  readonly meshCount: number;
}

export interface TrafficSnapshot {
  readonly version: number;
  readonly era: EraId;
  readonly targetEra: EraId;
  readonly transitioning: boolean;
  readonly lightLevel: number;
  readonly fleetSize: number;
  readonly activeEras: readonly EraId[];
  readonly models: readonly { readonly id: string; readonly count: number }[];
  readonly counts: {
    readonly total: number;
    readonly driving: number;
    readonly stopped: number;
    readonly parked: number;
  };
  readonly vehicles: readonly TrafficVehicleSnapshot[];
  readonly signals: readonly {
    readonly corner: BlockCornerId;
    readonly red: boolean;
    readonly stopDistance: number;
  }[];
  readonly lanes: {
    readonly length: number;
    readonly points: number;
    readonly turnRadius: number;
    readonly onRoad: boolean;
    readonly straights: readonly { readonly side: string; readonly start: number; readonly length: number }[];
  };
  readonly audio: {
    readonly directorAttached: boolean;
    readonly unlocked: boolean;
    readonly engineEmitters: number;
    readonly hornCount: number;
    readonly lastHorn: TrafficHornEvent | null;
  };
  readonly inspection: {
    readonly registryAttached: boolean;
    readonly notableId: string | null;
    readonly notableModel: string | null;
    readonly registeredIds: readonly string[];
  };
  readonly parking: {
    readonly bays: number;
    /** Bays reserved by a vehicle heading for them. */
    readonly reserved: number;
    /** Vehicles currently parked or manoeuvring into a bay. */
    readonly parked: number;
  };
  readonly simTimeMs: number;
}

export interface TrafficSystemOptions {
  readonly factory: VehicleFactory;
  readonly random: RandomSource;
  /** Lane loop; defaults to the shared `BlockLayout` derivation. */
  readonly lane?: LanePath;
  readonly fleetSize?: number;
  readonly initialEra?: EraId;
  readonly audio?: AudioDirector | null;
  readonly registry?: InspectionRegistry | null;
  readonly group?: THREE.Group | null;
  /** Enables kerbside parking behaviour (on by default). */
  readonly parking?: boolean;
  /** Caps how many vehicles may be parked at once (default `1`). */
  readonly maxParked?: number;
  /** Enables the corner signals (on by default). */
  readonly signals?: boolean;
  readonly parkDwellMs?: readonly [number, number];
}

/* ------------------------------------------------------------------------- *
 * System
 * ------------------------------------------------------------------------- */

interface SwapItem {
  readonly kind: 'retire' | 'spawn';
  readonly threshold: number;
  vehicle: TrafficVehicle | null;
  readonly spec: VehicleModelSpec;
  readonly colour: number;
  done: boolean;
}

const DEFAULT_PARK_DWELL: readonly [number, number] = [PARK_DWELL_MIN_MS, PARK_DWELL_MAX_MS];

let vehicleSequence = 0;

/**
 * The traffic simulation. One instance owns the lane loop, the active fleet, the
 * signals, the bays, the audio emitters and the notable-vehicle registration.
 */
export class TrafficSystem implements EraBlendable {
  readonly version = TRAFFIC_SYSTEM_VERSION;

  readonly lane: LanePath;
  readonly signals: readonly TrafficSignal[];
  readonly bays: readonly ParkBay[];
  readonly group: THREE.Group;

  private readonly factory: VehicleFactory;
  private readonly random: RandomSource;
  private readonly fleetRandom: RandomSource;
  private audio: AudioDirector | null;
  private registry: InspectionRegistry | null;
  private readonly fleetSize: number;
  private readonly parkingEnabled: boolean;
  private readonly signalsEnabled: boolean;
  private readonly maxParked: number;
  private readonly dwellRange: readonly [number, number];
  private readonly ownedGroup: boolean;

  private readonly active: TrafficVehicle[] = [];
  private readonly orderBuffer: TrafficVehicle[] = [];
  private readonly hornLog: TrafficHornEvent[] = [];

  private currentEra: EraId;
  private targetEra: EraId;
  private plan: EraFleetPlan;
  private swap: SwapItem[] | null = null;
  private swapIndex = 0;
  private simTimeMs = 0;
  private hornCount = 0;
  private notableVehicleId: string | null = null;
  private notableInspectable: string | null = null;
  private disposed = false;

  constructor(options: TrafficSystemOptions) {
    if (!options?.factory) throw new TypeError('TrafficSystem needs a VehicleFactory.');
    if (!options.random) throw new TypeError('TrafficSystem needs a seeded RandomSource.');

    this.factory = options.factory;
    this.random = options.random;
    this.fleetRandom = options.random.fork('traffic-fleet');
    this.audio = options.audio ?? null;
    this.registry = options.registry ?? null;
    this.fleetSize = Math.max(
      MIN_FLEET_SIZE,
      Math.min(MAX_FLEET_SIZE, Math.round(options.fleetSize ?? DEFAULT_FLEET_SIZE)),
    );
    this.parkingEnabled = options.parking ?? true;
    this.signalsEnabled = options.signals ?? true;
    this.maxParked = Math.max(0, Math.round(options.maxParked ?? 1));
    this.dwellRange = options.parkDwellMs ?? DEFAULT_PARK_DWELL;

    this.lane = options.lane ?? buildTrafficLanePath();
    this.signals = buildTrafficSignals(this.lane);
    this.bays = buildParkBays(this.lane);

    this.ownedGroup = !options.group;
    this.group = options.group ?? new THREE.Group();
    this.group.name = 'city-traffic';

    this.currentEra = options.initialEra ?? '2025';
    this.targetEra = this.currentEra;
    this.plan = buildEraFleetPlan(this.currentEra, this.fleetSize);
    this.applyEraImmediately(this.currentEra);
  }

  /* ---------------- state accessors ---------------- */

  get era(): EraId {
    return this.currentEra;
  }

  get transitioning(): boolean {
    return this.swap !== null;
  }

  get vehicles(): readonly TrafficVehicle[] {
    return this.active;
  }

  get fleetPlan(): EraFleetPlan {
    return this.plan;
  }

  get simElapsedMs(): number {
    return this.simTimeMs;
  }

  get hornEvents(): readonly TrafficHornEvent[] {
    return this.hornLog;
  }

  /** The vehicle registered for inspection in the current era, if any. */
  get notableVehicle(): TrafficVehicle | null {
    return this.active.find((vehicle) => vehicle.notable) ?? null;
  }

  /** Inspection id of the current era's notable vehicle. */
  notableInspectableId(era: EraId = this.currentEra): string {
    return `traffic-vehicle-${era}-notable`;
  }

  /* ---------------- era blending ---------------- */

  /**
   * Starts (or snaps) a move to `era`. An immediate switch swaps the whole fleet
   * in one step; otherwise a swap plan is laid out and consumed progressively by
   * `updateEraTransition()`.
   */
  setEra(era: EraId, options: EraTransitionOptions = {}): void {
    if (this.disposed) return;
    const immediate = options.immediate === true || options.durationMs === 0;
    this.targetEra = era;
    if (era === this.currentEra && !immediate) return;
    if (immediate) {
      this.swap = null;
      this.applyEraImmediately(era);
      return;
    }
    this.beginProgressiveSwap(era);
  }

  /** Per-frame tween hook: retires and spawns as progress crosses thresholds. */
  updateEraTransition(progress: number, transition: EraTransitionInfo): void {
    if (this.disposed) return;
    const target = transition.to ?? this.targetEra;
    this.targetEra = target;
    if (!this.swap) {
      if (progress >= 1 && !transition.active) this.finishSwap(target);
      return;
    }
    const clamped = clamp01(progress);
    for (const item of this.swap) {
      if (item.done) continue;
      if (!transition.active || clamped >= item.threshold) {
        this.commitSwapItem(item);
      }
    }
    if (!transition.active || clamped >= 1) this.finishSwap(target);
  }

  /** Applies one era's fleet at full strength (used by immediate switches). */
  applyEraImmediately(era: EraId): void {
    for (const vehicle of [...this.active]) this.retireVehicle(vehicle);
    this.currentEra = era;
    this.targetEra = era;
    this.plan = buildEraFleetPlan(era, this.fleetSize);
    this.swapIndex = 0;
    const colours = this.plan.entries.flatMap((entry) => Array.from({ length: entry.count }, () => entry.spec));
    colours.forEach((spec) => {
      this.spawnVehicle(spec, this.pickColour(spec));
    });
    this.syncNotable();
  }

  private beginProgressiveSwap(era: EraId): void {
    const plan = buildEraFleetPlan(era, this.fleetSize);
    const desired = plan.entries.flatMap((entry) =>
      Array.from({ length: entry.count }, () => entry.spec),
    );
    const retiring = [...this.active];
    const pairs = Math.max(retiring.length, desired.length, 1);
    const random = this.fleetRandom.fork(`swap-${era}-${retiring.length}-${desired.length}`);

    const items: SwapItem[] = [];
    for (let index = 0; index < pairs; index += 1) {
      const threshold = clamp01((index + random.float(0.05, 0.6)) / pairs);
      const retireVehicle = retiring[index];
      if (retireVehicle) {
        items.push({
          kind: 'retire',
          threshold,
          vehicle: retireVehicle,
          spec: retireVehicle.spec,
          colour: retireVehicle.build.colour,
          done: false,
        });
      }
      const spec = desired[index];
      if (spec) {
        items.push({
          kind: 'spawn',
          threshold,
          vehicle: null,
          spec,
          colour: this.pickColour(spec),
          done: false,
        });
      }
    }
    items.sort((left, right) => left.threshold - right.threshold);
    this.plan = plan;
    this.swap = items;
    this.swapIndex = 0;
  }

  private commitSwapItem(item: SwapItem): void {
    item.done = true;
    if (item.kind === 'retire') {
      if (item.vehicle) this.retireVehicle(item.vehicle);
      return;
    }
    this.spawnVehicle(item.spec, item.colour);
  }

  private finishSwap(era: EraId): void {
    if (this.swap) {
      for (const item of this.swap) {
        if (!item.done) this.commitSwapItem(item);
      }
    }
    this.swap = null;
    this.currentEra = era;
    this.targetEra = era;
    this.swapIndex = 0;
    this.syncNotable();
  }

  /* ---------------- fleet lifecycle ---------------- */

  private pickColour(spec: VehicleModelSpec): number {
    if (spec.colour !== undefined) return spec.colour;
    const palette = getEraDescriptor(spec.era).vehicles.dominantColors;
    if (palette.length === 0) return 0x8f979f;
    const index = Math.floor(this.fleetRandom.float(0, palette.length)) % palette.length;
    return palette[index] as number;
  }

  private spawnVehicle(spec: VehicleModelSpec, colour: number): TrafficVehicle {
    const build = this.factory.create(spec, colour, eraLightLevel(spec.era));
    this.group.add(build.root);

    const spacing = this.lane.length / Math.max(1, this.plan.size);
    const base = (this.swapIndex % Math.max(1, this.plan.size)) * spacing;
    this.swapIndex += 1;
    const offset = this.fleetRandom.float(0, spacing * 0.3);
    let s = this.lane.wrap(base + offset);
    // Never spawn on top of a live vehicle: walk forward until the slot is clear.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const closest = this.closestGap(s);
      if (closest > 6) break;
      s = this.lane.wrap(s + spacing / 2);
    }

    const vehicle: TrafficVehicle = {
      id: `traffic-${spec.era}-${vehicleSequence++}`,
      era: spec.era,
      spec,
      build,
      s,
      speed: Math.max(2, spec.cruiseKph / 3.6 / 2),
      lateral: 0,
      targetLateral: 0,
      state: 'cruising',
      stateMs: 0,
      wheelsSpin: 0,
      engineOn: true,
      braking: false,
      bay: null,
      hornCooldownMs: 0,
      bayRetryMs: 1_500 + this.fleetRandom.float(0, 1_500),
      blockedMs: 0,
      notable: false,
      worldPosition: new THREE.Vector3(0, 0, 0),
      emitter: null,
    };

    this.assignBay(vehicle);
    this.active.push(vehicle);
    this.registerEmitter(vehicle);
    this.applyTransforms(vehicle);
    return vehicle;
  }

  private retireVehicle(vehicle: TrafficVehicle): void {
    const index = this.active.indexOf(vehicle);
    if (index >= 0) this.active.splice(index, 1);
    if (vehicle.bay && vehicle.bay.occupiedBy === vehicle.id) vehicle.bay.occupiedBy = null;
    this.unregisterEmitter(vehicle);
    if (vehicle.notable) {
      vehicle.notable = false;
      this.notableVehicleId = null;
      this.clearNotableRegistration();
    }
    this.factory.release(vehicle.build);
  }

  /** Distance to the nearest vehicle ahead of `distance` on the loop. */
  private closestGap(distance: number): number {
    let closest = Number.POSITIVE_INFINITY;
    for (const vehicle of this.active) {
      const gap = this.lane.wrap(vehicle.s - distance);
      if (gap < closest) closest = gap;
    }
    return closest;
  }

  /** Vehicles currently parked or manoeuvring into a bay. */
  private parkedCount(): number {
    let count = 0;
    for (const vehicle of this.active) {
      if (vehicle.state === 'parked' || vehicle.state === 'parking') count += 1;
    }
    return count;
  }

  private assignBay(vehicle: TrafficVehicle): void {    if (!this.parkingEnabled || !vehicle.spec.parkable) return;
    const parked = this.active.filter(
      (candidate) => candidate.state === 'parked' || candidate.state === 'parking',
    ).length;
    if (parked >= this.maxParked) return;
    if (!this.fleetRandom.bool(vehicle.spec.parkChance)) return;
    const free = this.bays.filter((candidate) => candidate.occupiedBy === null);
    if (free.length === 0) return;
    const bay = free[Math.floor(this.fleetRandom.float(0, free.length)) % free.length] as ParkBay;
    bay.occupiedBy = `reserved:${vehicle.id}`;
    vehicle.bay = bay;
  }

  /** Forces a vehicle to take the next free bay (use for demonstrations/tests). */
  requestPark(vehicleId?: string): string | null {
    const vehicle = vehicleId
      ? this.active.find((candidate) => candidate.id === vehicleId)
      : this.active.find((candidate) => candidate.spec.parkable && candidate.bay === null);
    if (!vehicle || !vehicle.spec.parkable) return null;
    const free = this.bays.filter((candidate) => candidate.occupiedBy === null);
    if (free.length === 0) return null;
    const nearest = free
      .map((bay) => ({ bay, gap: this.lane.wrap(bay.distance - vehicle.s) }))
      .sort((left, right) => left.gap - right.gap)[0];
    if (!nearest) return null;
    nearest.bay.occupiedBy = `reserved:${vehicle.id}`;
    vehicle.bay = nearest.bay;
    vehicle.state = 'cruising';
    return vehicle.id;
  }

  /* ---------------- late-bound dependencies ---------------- */

  /**
   * Late-binds (or clears) the audio director. Engine emitters are registered for
   * every live vehicle, so a director that arrives after `create` still receives
   * positional engine loops from the whole fleet.
   */
  attachAudio(director: AudioDirector | null): void {
    if (this.audio === director) return;
    if (this.audio) {
      for (const vehicle of this.active) this.unregisterEmitter(vehicle);
    }
    this.audio = director;
    if (director) {
      for (const vehicle of this.active) this.registerEmitter(vehicle);
    }
  }

  /**
   * Late-binds (or clears) the inspection registry and re-syncs the notable
   * vehicle of the current era.
   */
  attachRegistry(registry: InspectionRegistry | null): void {
    if (this.registry === registry) return;
    if (this.registry) this.clearNotableRegistration();
    this.registry = registry;
    this.syncNotable();
  }

  /* ---------------- audio ---------------- */

  private registerEmitter(vehicle: TrafficVehicle): void {
    const director = this.audio;
    if (!director) return;
    const id = engineEmitterId(vehicle.id);
    if (director.getEmitter(id)) return;
    try {
      vehicle.emitter = director.registerEmitter({
        id,
        cue: vehicle.spec.engine.cue,
        bus: vehicle.spec.engine.bus,
        object: vehicle.build.root,
        gain: vehicle.spec.engine.gain,
        rate: vehicle.spec.engine.rate,
        era: vehicle.spec.era,
      });
    } catch (error) {
      vehicle.emitter = null;
      void error;
    }
  }

  private unregisterEmitter(vehicle: TrafficVehicle): void {
    const director = this.audio;
    const emitter = vehicle.emitter;
    vehicle.emitter = null;
    if (!director || !emitter) return;
    director.unregisterEmitter(emitter.id);
  }

  private updateEngineAudio(vehicle: TrafficVehicle): void {
    const director = this.audio;
    const emitter = vehicle.emitter;
    if (!director || !emitter) return;
    if (!vehicle.engineOn) {
      emitter.stop();
      return;
    }
    if (emitter.handle === null && director.isUnlocked) emitter.play();
  }

  /**
   * Fires the vehicle's horn from its live world position through the
   * `AudioDirector`. Returns the recorded event (also kept in `hornEvents`).
   */
  honk(vehicleId?: string, reason: 'blocked' | 'manual' = 'manual'): TrafficHornEvent | null {
    const vehicle =
      (vehicleId ? this.active.find((candidate) => candidate.id === vehicleId) : undefined) ??
      this.mostBlockedVehicle();
    if (!vehicle) return null;

    vehicle.build.root.getWorldPosition(vehicle.worldPosition);
    const position = {
      x: vehicle.worldPosition.x,
      y: vehicle.worldPosition.y + 0.6,
      z: vehicle.worldPosition.z,
    };
    let played = false;
    let voiceId: number | null = null;
    if (this.audio) {
      const handle = this.audio.play(vehicle.spec.horn.cue, {
        position,
        gain: vehicle.spec.horn.gain,
        rate: vehicle.spec.horn.rate,
        era: vehicle.spec.era,
      });
      played = handle !== null;
      voiceId = handle?.id ?? null;
    }

    const event: TrafficHornEvent = Object.freeze({
      vehicleId: vehicle.id,
      era: vehicle.era,
      model: vehicle.spec.id,
      reason,
      atMs: this.simTimeMs,
      position: Object.freeze(position),
      rate: vehicle.spec.horn.rate,
      gain: vehicle.spec.horn.gain,
      played,
      voiceId,
    });
    this.hornLog.push(event);
    if (this.hornLog.length > 16) this.hornLog.shift();
    this.hornCount += 1;
    vehicle.hornCooldownMs = HORN_COOLDOWN_MS;
    return event;
  }

  private mostBlockedVehicle(): TrafficVehicle | null {
    let best: TrafficVehicle | null = null;
    for (const vehicle of this.active) {
      if (!best || vehicle.blockedMs > best.blockedMs) best = vehicle;
    }
    return best;
  }

  /* ---------------- inspection ---------------- */

  private syncNotable(): void {
    const registry = this.registry;
    if (!registry) return;
    const wanted = this.notableInspectableId(this.currentEra);
    let vehicle = this.notableVehicle;

    if (!vehicle) {
      vehicle = this.active.find((candidate) => candidate.spec.notable) ?? this.active[0] ?? null;
      if (!vehicle) {
        this.clearNotableRegistration();
        return;
      }
      vehicle.notable = true;
      this.notableVehicleId = vehicle.id;
    }

    if (this.notableInspectable === wanted && this.notableVehicleId === vehicle.id) return;
    this.clearNotableRegistration();
    try {
      registry.register({
        id: wanted,
        object: vehicle.build.root,
        copy: {
          [vehicle.era]: { name: vehicle.spec.label, blurb: vehicle.spec.blurb },
        },
        fallbackCopy: { name: vehicle.spec.label, blurb: vehicle.spec.blurb },
        label: vehicle.spec.label,
        highlight: { emissive: 0xffd28a, emissiveIntensity: 1.1, outline: true },
        data: {
          kind: 'vehicle',
          era: vehicle.era,
          model: vehicle.spec.id,
          vehicleClass: vehicle.spec.vehicleClass,
          colour: `#${new THREE.Color(vehicle.build.colour).getHexString()}`,
          details: vehicle.build.details,
          topSpeedKph: vehicle.spec.horn.rate > 0 ? vehicle.spec.cruiseKph * 2 : vehicle.spec.cruiseKph,
        },
      });
      this.notableInspectable = wanted;
      this.notableVehicleId = vehicle.id;
    } catch (error) {
      this.notableInspectable = null;
      void error;
    }
  }

  private clearNotableRegistration(): void {
    if (!this.registry || !this.notableInspectable) {
      this.notableInspectable = null;
      return;
    }
    this.registry.deregister(this.notableInspectable);
    this.notableInspectable = null;
  }

  /* ---------------- simulation ---------------- */

  /** Advances the simulation by `deltaSeconds` (clamped to 100 ms per step). */
  update(deltaSeconds: number): void {
    if (this.disposed) return;
    const dt = Math.min(Math.max(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0), 0.1);
    this.simTimeMs += dt * 1000;

    this.orderBuffer.length = 0;
    for (const vehicle of this.active) this.orderBuffer.push(vehicle);
    this.orderBuffer.sort((left, right) => left.s - right.s);

    for (let index = 0; index < this.orderBuffer.length; index += 1) {
      const vehicle = this.orderBuffer[index] as TrafficVehicle;
      const leader = this.orderBuffer[(index + 1) % this.orderBuffer.length] as TrafficVehicle;
      this.stepVehicle(vehicle, leader, dt);
    }
    for (const vehicle of this.orderBuffer) {
      this.advanceVehicle(vehicle, dt);
    }
  }

  private stepVehicle(vehicle: TrafficVehicle, leader: TrafficVehicle, dt: number): void {
    const spec = vehicle.spec;
    const cruise = spec.cruiseKph / 3.6;
    const gap =
      this.orderBuffer.length > 1
        ? this.lane.wrap(leader.s - vehicle.s) - (leader.spec.plan.length + spec.plan.length) / 2
        : Number.POSITIVE_INFINITY;

    vehicle.hornCooldownMs = Math.max(0, vehicle.hornCooldownMs - dt * 1000);

    if (vehicle.state === 'parked') {
      vehicle.speed = 0;
      vehicle.braking = false;
      vehicle.stateMs -= dt * 1000;
      if (vehicle.stateMs <= 0) {
        vehicle.state = 'departing';
        vehicle.stateMs = 1_600;
        vehicle.engineOn = true;
      }
      this.handleHorn(vehicle, gap, leader, dt);
      return;
    }
    if (vehicle.state === 'departing') {
      vehicle.targetLateral = 0;
      vehicle.stateMs -= dt * 1000;
      const clear = Math.abs(vehicle.lateral) <= 0.08;
      if (vehicle.stateMs <= 0 && clear) {
        vehicle.state = 'cruising';
        if (vehicle.bay) {
          vehicle.bay.occupiedBy = null;
          vehicle.bay = null;
        }
        this.assignBay(vehicle);
      }
    }

    // Cruising vehicles look for a kerbside bay every few seconds, so parking
    // happens organically all round the block rather than only at spawn time.
    if (vehicle.state === 'cruising' && vehicle.bay === null) {
      vehicle.bayRetryMs -= dt * 1000;
      if (vehicle.bayRetryMs <= 0) {
        vehicle.bayRetryMs = 3_000;
        this.assignBay(vehicle);
      }
    } else {
      vehicle.bayRetryMs = 3_000;
    }

    // Parking approach: slow to the bay, then stop beside the kerb. Only one
    // vehicle may be parked or parking at a time on the single-lane loop, so a
    // vehicle that arrives while a bay is already busy gives its bay up and
    // tries again on the next lap.
    let parkTarget = Number.POSITIVE_INFINITY;
    if (
      vehicle.bay &&
      (vehicle.state === 'cruising' || vehicle.state === 'parking') &&
      vehicle.bay.occupiedBy === `reserved:${vehicle.id}`
    ) {
      const bayGap = this.lane.wrap(vehicle.bay.distance - vehicle.s);
      const atCapacity = this.parkedCount() >= this.maxParked;
      if (vehicle.state === 'cruising' && atCapacity) {
        vehicle.bay.occupiedBy = null;
        vehicle.bay = null;
      } else if (bayGap < 16) {
        vehicle.state = 'parking';
        const lateralLimit = Math.max(
          0.2,
          LANE_WIDTH / 2 - spec.plan.width / 2 - 0.1,
        );
        vehicle.targetLateral = Math.min(vehicle.bay.lateral, lateralLimit);
        parkTarget = Math.max(0, (bayGap - 0.3) / 1.2);
        if (bayGap <= 0.5 && vehicle.speed <= 0.4) {
          vehicle.state = 'parked';
          vehicle.speed = 0;
          vehicle.engineOn = false;
          vehicle.stateMs =
            this.dwellRange[0] +
            this.fleetRandom.float(0, Math.max(0, this.dwellRange[1] - this.dwellRange[0]));
          vehicle.braking = false;
          return;
        }
      }
    } else if (vehicle.state === 'parking') {
      // Bay lost (era swap or cancellation): merge back into the lane.
      vehicle.state = 'departing';
      vehicle.stateMs = 1_400;
      vehicle.targetLateral = 0;
      if (vehicle.bay) {
        vehicle.bay.occupiedBy = null;
        vehicle.bay = null;
      }
    }

    // Following: standstill gap plus a headway of speed.
    let followTarget = Number.POSITIVE_INFINITY;
    if (Number.isFinite(gap)) {
      followTarget = Math.max(0, leader.speed + (gap - MIN_FOLLOW_GAP) / FOLLOW_TIME_HEADWAY);
    }

    // Signals: stop before the nearest red stop line.
    let signalTarget = Number.POSITIVE_INFINITY;
    if (this.signalsEnabled) {
      let stopGap = Number.POSITIVE_INFINITY;
      for (const signal of this.signals) {
        if (!signalIsRed(signal, this.simTimeMs)) continue;
        const distance = this.lane.wrap(signal.stopDistance - vehicle.s);
        if (distance < stopGap) stopGap = distance;
      }
      if (stopGap < 20) signalTarget = Math.max(0, (stopGap - STOP_MARGIN) / FOLLOW_TIME_HEADWAY);
    }

    const target = Math.min(cruise, followTarget, signalTarget, parkTarget);
    const delta = target - vehicle.speed;
    const rate = delta >= 0 ? spec.accel : spec.brake;
    const step = Math.max(-rate * dt, Math.min(rate * dt, delta));
    vehicle.braking = step < -0.15 || (vehicle.speed < 0.6 && target < 0.4);
    vehicle.speed = Math.max(0, vehicle.speed + step);

    if (vehicle.state === 'cruising' && vehicle.speed < 0.15 && !Number.isFinite(parkTarget)) {
      // Waiting on a red or a queue: keep the brake lamps lit.
      vehicle.braking = true;
    }

    this.handleHorn(vehicle, gap, leader, dt);
  }

  private handleHorn(vehicle: TrafficVehicle, gap: number, leader: TrafficVehicle, dt: number): void {
    const blocked = vehicle.speed < 0.5 && Number.isFinite(gap) && gap < 5 && leader.speed < 0.5;
    if (!blocked) {
      vehicle.blockedMs = 0;
      return;
    }
    vehicle.blockedMs += dt * 1000;
    if (vehicle.blockedMs < HORN_PATIENCE_MS) return;
    if (vehicle.hornCooldownMs > 0) return;
    this.honk(vehicle.id, 'blocked');
  }

  private advanceVehicle(vehicle: TrafficVehicle, dt: number): void {
    const lateralRate = vehicle.targetLateral !== vehicle.lateral ? 0.9 : 0;
    if (lateralRate > 0) {
      const delta = vehicle.targetLateral - vehicle.lateral;
      const step = Math.max(-lateralRate * dt, Math.min(lateralRate * dt, delta));
      vehicle.lateral += step;
    }

    vehicle.s = this.lane.wrap(vehicle.s + vehicle.speed * dt);
    vehicle.wheelsSpin += (vehicle.speed / Math.max(0.1, vehicle.spec.plan.wheelRadius)) * dt;
    this.applyTransforms(vehicle);
    this.applyLamps(vehicle);
    this.updateEngineAudio(vehicle);
  }

  /** Places the root and every articulated section along the lane spline. */
  applyTransforms(vehicle: TrafficVehicle): void {
    const heading = this.lane.headingAt(vehicle.s);
    const normal = this.lane.normalAt(vehicle.s);
    const point = this.lane.pointAt(vehicle.s);
    const rootX = point.x + normal.x * vehicle.lateral;
    const rootZ = point.z + normal.z * vehicle.lateral;

    vehicle.build.root.position.set(rootX, 0, rootZ);
    vehicle.build.root.rotation.y = heading;
    vehicle.worldPosition.set(rootX, 0, rootZ);

    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    for (const section of vehicle.build.sections) {
      const distance = vehicle.s + section.offset;
      const sectionPoint = this.lane.pointAt(distance);
      const sectionNormal = this.lane.normalAt(distance);
      const dx = sectionPoint.x + sectionNormal.x * vehicle.lateral - rootX;
      const dz = sectionPoint.z + sectionNormal.z * vehicle.lateral - rootZ;
      section.node.position.set(dx * cos - dz * sin, 0, dx * sin + dz * cos);
      section.node.rotation.y = this.lane.headingAt(distance) - heading;
    }

    for (const wheel of vehicle.build.wheels) {
      wheel.spinner.rotation.x = vehicle.wheelsSpin;
    }
  }

  /** Swaps lamp materials for the era's mood, braking and indicator blinks. */
  applyLamps(vehicle: TrafficVehicle): void {
    const night = eraLightLevel(vehicle.era) >= 0.3;
    const blinkOn = Math.floor(this.simTimeMs / BLINK_MS) % 2 === 0;
    const turning = vehicle.state === 'parking' || vehicle.state === 'departing';
    const parked = vehicle.state === 'parked';

    for (const lamp of vehicle.build.lamps) {
      switch (lamp.kind) {
        case 'head':
          // Headlights glow with the era's mood; a parked vehicle keeps them on.
          lamp.mesh.material = night || parked ? lamp.lit : lamp.dim;
          break;
        case 'tail':
          lamp.mesh.material = vehicle.braking || parked || night ? lamp.lit : lamp.dim;
          break;
        case 'brake':
          lamp.mesh.material = vehicle.braking || parked ? lamp.lit : lamp.dim;
          break;
        case 'indicator':
          lamp.mesh.material = turning && blinkOn ? lamp.lit : lamp.dim;
          break;
        case 'beacon':
          // Roof signs and destination boards read best at dusk.
          lamp.mesh.material = night || (vehicle.spec.details.taxiSign && blinkOn)
            ? lamp.lit
            : lamp.dim;
          break;
      }
    }
  }

  /* ---------------- reporting ---------------- */

  snapshot(): TrafficSnapshot {
    const eras = [...new Set(this.active.map((vehicle) => vehicle.era))];
    const modelCounts = new Map<string, number>();
    for (const vehicle of this.active) {
      modelCounts.set(vehicle.spec.id, (modelCounts.get(vehicle.spec.id) ?? 0) + 1);
    }
    const driving = this.active.filter((vehicle) => vehicle.speed > 0.5).length;
    const parked = this.active.filter((vehicle) => vehicle.state === 'parked').length;

    return Object.freeze({
      version: this.version,
      era: this.currentEra,
      targetEra: this.targetEra,
      transitioning: this.swap !== null,
      lightLevel: eraLightLevel(this.currentEra),
      fleetSize: this.active.length,
      activeEras: Object.freeze(eras),
      models: Object.freeze(
        [...modelCounts.entries()].map(([id, count]) => Object.freeze({ id, count })),
      ),
      counts: Object.freeze({
        total: this.active.length,
        driving,
        stopped: this.active.length - driving,
        parked,
      }),
      vehicles: Object.freeze(
        this.active.map((vehicle) => this.vehicleSnapshot(vehicle)),
      ),
      signals: Object.freeze(
        this.signals.map((signal) =>
          Object.freeze({
            corner: signal.corner,
            red: signalIsRed(signal, this.simTimeMs),
            stopDistance: signal.stopDistance,
          }),
        ),
      ),
      lanes: Object.freeze({
        length: this.lane.length,
        points: this.lane.points.length,
        turnRadius: this.lane.turnRadius,
        onRoad: this.lane.onRoad,
        straights: Object.freeze(
          this.lane.runs
            .filter((run) => run.kind === 'straight')
            .map((run) =>
              Object.freeze({ side: String(run.id), start: run.start, length: run.length }),
            ),
        ),
      }),
      audio: Object.freeze({
        directorAttached: this.audio !== null,
        unlocked: this.audio?.isUnlocked ?? false,
        engineEmitters: this.active.filter((vehicle) => vehicle.emitter !== null).length,
        hornCount: this.hornCount,
        lastHorn: this.hornLog.length > 0 ? (this.hornLog[this.hornLog.length - 1] as TrafficHornEvent) : null,
      }),
      inspection: Object.freeze({
        registryAttached: this.registry !== null,
        notableId: this.notableInspectable,
        notableModel: this.notableVehicle?.spec.id ?? null,
        registeredIds: Object.freeze(this.registry ? [...this.registry.ids()] : []),
      }),
      parking: Object.freeze({
        bays: this.bays.length,
        reserved: this.bays.filter((bay) => bay.occupiedBy !== null).length,
        parked: this.parkedCount(),
      }),
      simTimeMs: this.simTimeMs,
    });
  }

  private vehicleSnapshot(vehicle: TrafficVehicle): TrafficVehicleSnapshot {
    return Object.freeze({
      id: vehicle.id,
      era: vehicle.era,
      model: vehicle.spec.id,
      label: vehicle.spec.label,
      vehicleClass: vehicle.spec.vehicleClass,
      colour: `#${new THREE.Color(vehicle.build.colour).getHexString()}`,
      state: vehicle.state,
      speedKph: vehicle.speed * 3.6,
      s: vehicle.s,
      lateral: vehicle.lateral,
      x: vehicle.worldPosition.x,
      z: vehicle.worldPosition.z,
      headingDeg: (this.lane.headingAt(vehicle.s) * 180) / Math.PI,
      wheelsSpin: vehicle.wheelsSpin,
      details: vehicle.build.details,
      notable: vehicle.notable,
      engineOn: vehicle.engineOn,
      meshCount: vehicle.build.meshCount,
    });
  }

  /** Releases every vehicle, emitter and registration this system owns. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const vehicle of [...this.active]) this.retireVehicle(vehicle);
    this.active.length = 0;
    this.clearNotableRegistration();
    if (this.ownedGroup) {
      for (const child of [...this.group.children]) this.group.remove(child);
      this.group.clear();
    }
  }

  /** Injected random source, exposed for HUD/demo systems that want the stream. */
  get randomSource(): RandomSource {
    return this.random;
  }
}

/** Emitter id a vehicle's engine loop is registered under. */
export function engineEmitterId(vehicleId: string): string {
  return `${vehicleId}-engine`;
}

/** Road geometry constant re-exported for consumers that reason about the loop. */
export const LANE_RING = Object.freeze({
  innerX: ROAD_INNER_X,
  innerZ: ROAD_INNER_Z,
  centerX: ROAD_CENTER_X,
  centerZ: ROAD_CENTER_Z,
  laneWidth: LANE_WIDTH,
});
