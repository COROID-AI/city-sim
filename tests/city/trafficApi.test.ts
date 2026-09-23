/**
 * Chrono City — traffic composition suite.
 *
 * Proves the traffic task's contract end to end, without a GPU:
 *
 *  - the lane loop is *derived* from `BlockLayout` (every vertex on the asphalt
 *    ring, straights on the shared lane offsets, four corner arcs);
 *  - each era builds its authored fleet with modelled detail (wheels, chrome or
 *    painted brightwork, lamps, exhausts or charge ports, taxi sign, trolley
 *    pole, sensor crown) and the fleets really do swap per year;
 *  - vehicles circulate, spin their wheels, follow, stop at red signals and park
 *    beside the kerb, and never leave the road ring;
 *  - positional engine loops and horns reach the `AudioDirector` with live
 *    vehicle world positions (asserted through a stub Web Audio graph);
 *  - notable vehicles register in the `InspectionRegistry` with per-year names;
 *  - the whole thing is integrated through `createTrafficApi()`,
 *    `api.consume({ timeline, audio, registry })` and `api.integrate(context)`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import {
  CROSSWALK_ANCHORS,
  LANE_WIDTH,
  isInsideBlock,
  isOnRoad,
  isOnSidewalk,
  roadSegment,
} from '../../src/core/blockLayout';
import { ERA_IDS, type EraId } from '../../src/core/eraContracts';
import {
  createSceneContext,
  createSeededRng,
  type SceneContext,
} from '../../src/core/sceneContext';
import { createTimelineRuntime, type TimelineRuntime } from '../../src/era/timelineRuntime';
import {
  createAudioDirector,
  type AudioDirector,
  type AudioEngineContext,
} from '../../src/audio/audioDirector';
import { createSfxLibrary } from '../../src/audio/sfxSynth';
import { createInspectionRegistry, type InspectionRegistry } from '../../src/interaction/inspectionRegistry';
import { createMaterialLibrary, type MaterialLibrary } from '../../src/materials/materialLibrary';
import {
  TrafficApi,
  createTrafficApi,
  detachTrafficGlobal,
  getTrafficApi,
  TRAFFIC_GLOBAL_KEY,
} from '../../src/city/traffic/trafficApi';
import {
  CIRCULATION_ORDER,
  TrafficSystem,
  buildParkBays,
  buildTrafficLanePath,
  buildTrafficSignals,
  circulatingLane,
  engineEmitterId,
  signalIsRed,
} from '../../src/city/traffic/trafficSystem';
import {
  ERA_VEHICLE_MODELS,
  buildEraFleetPlan,
  createVehicleFactory,
  eraLightLevel,
  type VehicleModelSpec,
} from '../../src/city/traffic/vehicleFactory';

/* ------------------------------------------------------------------ */
/* Web Audio stub                                                      */
/* ------------------------------------------------------------------ */

/**
 * Minimal in-memory Web Audio graph: enough for the `AudioDirector` to build its
 * buses, render the traffic and horn cues, and expose the panner positions the
 * engine emitters drive. Nothing here touches a sound card.
 */
class StubParam {
  value: number;

  constructor(value = 0) {
    this.value = value;
  }

  setValueAtTime(value: number): this {
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number): this {
    this.value = value;
    return this;
  }

  exponentialRampToValueAtTime(value: number): this {
    this.value = value;
    return this;
  }

  setTargetAtTime(value: number): this {
    this.value = value;
    return this;
  }

  cancelScheduledValues(): this {
    return this;
  }

  cancelAndHoldAtTime(): this {
    return this;
  }

  setValueCurveAtTime(): this {
    return this;
  }
}

class StubNode {
  readonly outputs: StubNode[] = [];

  constructor(readonly kind: string) {}

  connect(target: unknown): void {
    if (target instanceof StubNode) this.outputs.push(target);
  }

  disconnect(): void {
    this.outputs.length = 0;
  }
}

class StubSource extends StubNode {
  onended: (() => void) | null = null;
  started = false;
  stopped = false;

  constructor(kind: string) {
    super(kind);
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'ended') this.onended = listener;
  }
}

class StubOscillator extends StubSource {
  readonly frequency = new StubParam(440);
  readonly detune = new StubParam(0);
  type = 'sine';

  constructor() {
    super('oscillator');
  }
}

class StubBufferSource extends StubSource {
  buffer: StubBuffer | null = null;
  readonly playbackRate = new StubParam(1);
  loop = false;

  constructor() {
    super('buffer-source');
  }
}

class StubFilter extends StubNode {
  readonly frequency = new StubParam(350);
  readonly Q = new StubParam(1);
  type = 'lowpass';

  constructor() {
    super('filter');
  }
}

class StubGain extends StubNode {
  readonly gain: StubParam;

  constructor(value = 1) {
    super('gain');
    this.gain = new StubParam(value);
  }
}

class StubPanner extends StubNode {
  panningModel = 'equalpower';
  distanceModel = 'inverse';
  refDistance = 1;
  maxDistance = 10_000;
  rolloffFactor = 1;
  coneInnerAngle = 360;
  coneOuterAngle = 360;
  coneOuterGain = 0;
  readonly positionX = new StubParam(0);
  readonly positionY = new StubParam(0);
  readonly positionZ = new StubParam(0);

  constructor() {
    super('panner');
  }
}

class StubBuffer {
  private readonly channels: Float32Array[];

  constructor(count: number, length: number, readonly sampleRate: number) {
    this.channels = Array.from({ length: count }, () => new Float32Array(length));
  }

  getChannelData(index: number): Float32Array {
    return this.channels[index] as Float32Array;
  }
}

class StubAudioContext {
  readonly destination = new StubNode('destination');
  readonly nodes: StubNode[] = [];
  state: AudioContextState = 'running';
  currentTime = 0;
  sampleRate = 44_100;

  createGain(): StubGain {
    return this.track(new StubGain());
  }

  createOscillator(): StubOscillator {
    return this.track(new StubOscillator());
  }

  createBiquadFilter(): StubFilter {
    return this.track(new StubFilter());
  }

  createBufferSource(): StubBufferSource {
    return this.track(new StubBufferSource());
  }

  createPanner(): StubPanner {
    return this.track(new StubPanner());
  }

  createBuffer(channels: number, length: number, sampleRate: number): StubBuffer {
    return new StubBuffer(channels, length, sampleRate);
  }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  byKind(kind: string): StubNode[] {
    return this.nodes.filter((node) => node.kind === kind);
  }

  private track<T extends StubNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

function createStubRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const stub = {
    domElement: canvas,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    render: () => undefined,
    setAnimationLoop: () => undefined,
    dispose: () => undefined,
  };
  return stub as unknown as THREE.WebGLRenderer;
}

interface Harness {
  readonly context: SceneContext;
  readonly timeline: TimelineRuntime;
  readonly registry: InspectionRegistry;
  readonly library: MaterialLibrary;
  readonly director: AudioDirector;
  readonly audio: StubAudioContext;
  readonly api: TrafficApi;
  /** Steps the `SceneContext` loop, which also drives the timeline and audio. */
  step(seconds: number, dt?: number): void;
  dispose(): void;
}

const openHarnesses: Harness[] = [];

function createHarness(
  options: {
    readonly initialEra?: EraId;
    readonly fleetSize?: number;
    readonly parkDwellMs?: readonly [number, number];
    readonly parking?: boolean;
  } = {},
): Harness {
  const seed = 20_250_101;
  const context = createSceneContext({
    createRenderer: createStubRenderer,
    seed,
    autoStart: false,
    autoResize: false,
  });
  const timeline = createTimelineRuntime({ initialEra: options.initialEra ?? '1985' });
  timeline.attach(context);

  const registry = createInspectionRegistry();
  const library = createMaterialLibrary({ random: createSeededRng(seed) });
  const audio = new StubAudioContext();
  const director = createAudioDirector({
    createAudioContext: () => audio as unknown as AudioEngineContext,
    documentRef: null,
  });
  director.registerCues(createSfxLibrary());
  director.attach(context);

  const api = createTrafficApi({
    library,
    seed,
    fleetSize: options.fleetSize ?? 8,
    initialEra: timeline.era,
    maxParked: 1,
    parkDwellMs: options.parkDwellMs ?? [1200, 2200],
    ...(options.parking === undefined ? {} : { parking: options.parking }),
  });
  api.consume({ timeline, registry, audio: director });
  api.integrate(context, { publish: false });

  const harness: Harness = {
    context,
    timeline,
    registry,
    library,
    director,
    audio,
    api,
    step(seconds: number, dt = 1 / 60): void {
      const frames = Math.max(1, Math.round(seconds / dt));
      for (let frame = 0; frame < frames; frame += 1) context.tick(dt);
    },
    dispose(): void {
      api.dispose();
      director.dispose();
      context.dispose();
    },
  };
  openHarnesses.push(harness);
  return harness;
}

afterEach(() => {
  while (openHarnesses.length > 0) openHarnesses.pop()?.dispose();
  detachTrafficGlobal();
});

const REQUIRED_MODELS: Readonly<Record<EraId, readonly string[]>> = Object.freeze({
  '1945': ['saloon-1945', 'flatbed-truck-1945', 'streetcar-1945'],
  '1965': ['muscle-coupe-1965', 'double-decker-bus-1965'],
  '1985': ['boxy-sedan-1985', 'yellow-cab-1985'],
  '2005': ['hybrid-sedan-2005', 'suv-2005'],
  '2025': ['ev-crossover-2025', 'autonomous-pod-2025'],
});

function modelById(id: string): VehicleModelSpec {
  for (const models of Object.values(ERA_VEHICLE_MODELS)) {
    const match = models.find((candidate) => candidate.id === id);
    if (match) return match;
  }
  throw new Error(`No authored model ${id}`);
}

/* ------------------------------------------------------------------ */
/* Lane spline                                                         */
/* ------------------------------------------------------------------ */

describe('traffic lane spline', () => {
  it('is derived from BlockLayout lane lines and stays on the asphalt ring', () => {
    const lane = buildTrafficLanePath();

    expect(lane.points.length).toBeGreaterThan(30);
    // Four straights and four corner arcs, in circulation order.
    expect(lane.runs.filter((run) => run.kind === 'straight').map((run) => run.id)).toEqual([
      ...CIRCULATION_ORDER,
    ]);
    expect(lane.runs.filter((run) => run.kind === 'arc')).toHaveLength(4);

    for (const point of lane.points) {
      expect(isOnRoad(point)).toBe(true);
      expect(isOnSidewalk(point)).toBe(false);
      expect(isInsideBlock(point)).toBe(false);
    }
    expect(lane.onRoad).toBe(true);

    // Every sample of the loop, not only the vertices, sits on the asphalt.
    for (const sample of lane.sampleByDistance(2)) {
      expect(isOnRoad({ x: sample.x, z: sample.z })).toBe(true);
    }
  });

  it('runs each straight on the shared lane offset of its road leg', () => {
    const lane = buildTrafficLanePath();
    for (const side of CIRCULATION_ORDER) {
      const run = lane.runs.find((candidate) => candidate.kind === 'straight' && candidate.id === side);
      if (!run) throw new Error(`No straight run for the ${side} leg.`);

      // The straight must sit exactly on the shared BlockLayout lane centre line
      // (`RoadSegment.center + RoadLane.offset`) — never on a private copy.
      const segment = roadSegment(side);
      const expectedCross = segment.center + circulatingLane(side).offset;

      for (let ratio = 0.1; ratio < 0.95; ratio += 0.1) {
        const point = lane.pointAt(run.start + run.length * ratio);
        const crossValue = segment.axis === 'x' ? point.z : point.x;
        expect(crossValue).toBeCloseTo(expectedCross, 4);
        expect(isOnRoad(point)).toBe(true);
      }
    }
  });

  it('keeps the heading continuous and one-way around the block', () => {
    const lane = buildTrafficLanePath();
    const samples = lane.sampleByDistance(2);
    let totalTurn = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const current = samples[index] as { headingRad: number };
      const next = samples[(index + 1) % samples.length] as { headingRad: number };
      let delta = next.headingRad - current.headingRad;
      while (delta <= -Math.PI) delta += Math.PI * 2;
      while (delta > Math.PI) delta -= Math.PI * 2;
      totalTurn += delta;
      // 2 m of arc at the 4 m turning radius is at most 0.5 rad of heading.
      expect(Math.abs(delta)).toBeLessThan(0.6);
    }
    // A closed one-way loop turns through exactly one full revolution.
    expect(Math.abs(Math.abs(totalTurn) - Math.PI * 2)).toBeLessThan(0.3);
  });

  it('places signals on the crosswalk approaches and bays on the straights', () => {
    const lane = buildTrafficLanePath();
    const signals = buildTrafficSignals(lane);
    expect(signals).toHaveLength(4);
    for (const signal of signals) {
      const anchor = CROSSWALK_ANCHORS.find(
        (candidate) => candidate.corner === signal.corner && candidate.road === signal.road,
      );
      expect(anchor).toBeDefined();
      const stopPoint = lane.pointAt(signal.stopDistance);
      // The stop line is on the road, just short of its crosswalk band.
      expect(isOnRoad(stopPoint)).toBe(true);
      const gap = Math.hypot(stopPoint.x - (anchor?.center.x ?? 0), stopPoint.z - (anchor?.center.z ?? 0));
      expect(gap).toBeLessThan(8);
    }

    // Red phases are staggered around the block, so some corners are always
    // green and at least one is red at any instant.
    const reds = [0, 2000, 4000, 8000, 12_000].map(
      (elapsed) => signals.filter((signal) => signalIsRed(signal, elapsed)).length,
    );
    expect(Math.min(...reds)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...reds)).toBeLessThanOrEqual(2);

    const bays = buildParkBays(lane);
    expect(bays).toHaveLength(8);
    for (const bay of bays) {
      const point = lane.pointAt(bay.distance);
      expect(isOnRoad(point)).toBe(true);
      expect(bay.lateral).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Era fleets and modelled detail                                      */
/* ------------------------------------------------------------------ */

describe('era vehicle fleets', () => {
  it('authored the required silhouettes for all five years', () => {
    for (const era of ERA_IDS) {
      const ids = ERA_VEHICLE_MODELS[era].map((model) => model.id);
      for (const required of REQUIRED_MODELS[era]) {
        expect(ids).toContain(required);
      }
      expect(buildEraFleetPlan(era, 12).size).toBe(12);
    }
  });

  it('models wheels, lamps, brightwork and era powertrain detail on every fleet', () => {
    for (const era of ERA_IDS) {
      const plan = buildEraFleetPlan(era, 12);
      for (const entry of plan.entries) {
        const spec = entry.spec;
        expect(spec.plan.wheelRadius).toBeGreaterThan(0.2);
        expect(spec.plan.length).toBeGreaterThan(3);
        expect(spec.details.chromeRatio).toBeGreaterThanOrEqual(0);
        expect(spec.details.chromeRatio).toBeLessThanOrEqual(1);
        expect(spec.horn.cue).toBe('horn');
        expect(['petrol', 'diesel', 'electric', 'tram']).toContain(spec.engine.kind);
      }
    }

    // Era-defining details are authored, not implied.
    expect(modelById('saloon-1945').plan.fenders).toBe('separate');
    expect(modelById('saloon-1945').details.chromeRatio).toBeGreaterThan(0.3);
    expect(modelById('flatbed-truck-1945').plan.wheelCount).toBe(6);
    expect(modelById('streetcar-1945').details.trolleyPole).toBe(true);
    expect(modelById('streetcar-1945').plan.sections).toBe(2);
    expect(modelById('muscle-coupe-1965').details.quadHeadlamps).toBe(true);
    expect(modelById('muscle-coupe-1965').details.exhaust).toBe('twin');
    expect(modelById('double-decker-bus-1965').plan.deckCount).toBe(2);
    expect(modelById('yellow-cab-1985').colour).toBe(0xf2c14e);
    expect(modelById('yellow-cab-1985').details.taxiSign).toBe(true);
    expect(modelById('hybrid-sedan-2005').details.ledStrip).toBe(true);
    expect(modelById('ev-crossover-2025').details.chargePort).toBe('flank');
    expect(modelById('ev-crossover-2025').details.exhaust).toBe('none');
    expect(modelById('autonomous-pod-2025').details.roofSensor).toBe(true);

    // The 1985 dusk makes lamps glow harder than the daylight eras do.
    expect(eraLightLevel('1985')).toBeGreaterThan(eraLightLevel('2005'));
    expect(eraLightLevel('1965')).toBeLessThan(0.05);
  });

  it('instantiates the authored models with meshes, wheels and lamps', () => {
    const harness = createHarness({ initialEra: '1985', fleetSize: 8, parking: false });
    const snapshot = harness.api.snapshot();
    expect(snapshot.fleetSize).toBe(8);

    const built = harness.api.vehicles;
    expect(built.length).toBeGreaterThan(0);
    for (const vehicle of built) {
      expect(vehicle.build.wheels.length).toBeGreaterThanOrEqual(4);
      expect(vehicle.build.lamps.length).toBeGreaterThanOrEqual(4);
      expect(vehicle.build.meshCount).toBeGreaterThan(20);
      expect(vehicle.build.meshCount).toBeLessThan(80);
      expect(vehicle.build.details).toContain('wheels');
      expect(vehicle.build.details).toContain('lamp:head');
      expect(vehicle.build.details).toContain('lamp:tail');
      expect(vehicle.build.root.parent).toBe(harness.api.group);
    }

    const taxi = built.find((vehicle) => vehicle.spec.id === 'yellow-cab-1985');
    if (taxi) {
      expect(taxi.build.details).toContain('roof-sign');
      expect(new THREE.Color(taxi.build.colour).getHex()).toBe(0xf2c14e);
    }

    const models = snapshot.models.map((entry) => entry.id);
    expect(models).toContain('boxy-sedan-1985');
  });

  it('bounds geometry allocation and reuses the pool across era cycles', () => {
    const harness = createHarness({ initialEra: '1945', fleetSize: 8, parking: false });
    const first = harness.api.factory.stats;

    for (const era of ERA_IDS) {
      harness.api.applyEra(era);
      harness.step(0.5);
    }
    const afterCycle = harness.api.factory.stats;
    expect(afterCycle.geometries).toBe(first.geometries);
    expect(afterCycle.geometries).toBe(4);

    // Second cycle through the same years must reuse pooled roots.
    for (const era of ERA_IDS) {
      harness.api.applyEra(era);
      harness.step(0.5);
    }
    const second = harness.api.factory.stats;
    expect(second.reused).toBeGreaterThan(afterCycle.reused);
    expect(second.geometries).toBe(4);
    expect(second.active).toBe(harness.api.vehicles.length);
    expect(second.meshCount).toBeLessThanOrEqual(second.active * 80);
  });
});

/* ------------------------------------------------------------------ */
/* Driving behaviour                                                   */
/* ------------------------------------------------------------------ */

describe('traffic circulation behaviour', () => {
  it('rotates every wheel exactly with the distance travelled', () => {
    const harness = createHarness({ initialEra: '1965', fleetSize: 4, parking: false });
    const laneLength = harness.api.lane.length;
    const vehicle = harness.api.vehicles[0];
    if (!vehicle) throw new Error('expected a built vehicle');
    const startSpin = vehicle.wheelsSpin;
    let travelled = 0;
    let previousS = vehicle.s;

    for (let frame = 0; frame < 300; frame += 1) {
      harness.context.tick(1 / 60);
      let delta = vehicle.s - previousS;
      if (delta < -laneLength / 2) delta += laneLength;
      if (delta > laneLength / 2) delta -= laneLength;
      travelled += delta;
      previousS = vehicle.s;
    }

    const spin = vehicle.wheelsSpin - startSpin;
    expect(spin).toBeGreaterThan(0);
    // Rolling without slipping: spin (rad) * radius (m) == distance (m).
    expect(spin * vehicle.spec.plan.wheelRadius).toBeCloseTo(travelled, 3);
    for (const candidate of harness.api.vehicles) {
      expect(candidate.wheelsSpin).toBeGreaterThan(0);
      for (const wheel of candidate.build.wheels) {
        expect(wheel.spinner.rotation.x).toBeCloseTo(candidate.wheelsSpin, 6);
      }
    }
  });

  it('lights lamps by the era lighting mood: 1985 dusk versus 2005 daylight', () => {
    const dusk = createHarness({ initialEra: '1985', fleetSize: 4, parking: false });
    dusk.step(1 / 60);
    const duskHead = dusk.api.vehicles[0]?.build.lamps.find((lamp) => lamp.kind === 'head');
    expect(duskHead?.mesh.material).toBe(duskHead?.lit);

    const day = createHarness({ initialEra: '2005', fleetSize: 4, parking: false });
    day.step(1 / 60);
    const dayHead = day.api.vehicles[0]?.build.lamps.find((lamp) => lamp.kind === 'head');
    expect(dayHead?.mesh.material).toBe(dayHead?.dim);
  });

  it('circulates 1985 traffic for 20 seconds: wheels turn, lanes hold, stops happen', () => {
    const harness = createHarness({ initialEra: '1985', fleetSize: 10, parking: false });
    const startSpin = new Map(harness.api.vehicles.map((vehicle) => [vehicle.id, vehicle.wheelsSpin]));
    const startS = new Map(harness.api.vehicles.map((vehicle) => [vehicle.id, vehicle.s]));

    let stopEvents = 0;
    let queueEvents = 0;
    let offLaneSamples = 0;
    let maxQueueGap = Number.POSITIVE_INFINITY;

    for (let frame = 0; frame < 20 * 60; frame += 1) {
      harness.context.tick(1 / 60);
      const snapshot = harness.api.snapshot();
      const signals = snapshot.signals;

      for (const vehicle of snapshot.vehicles) {
        if (!isOnRoad({ x: vehicle.x, z: vehicle.z })) offLaneSamples += 1;
        if (vehicle.speedKph < 1) {
          const nearestRed = signals
            .filter((signal) => signal.red)
            .map((signal) => {
              const raw = signal.stopDistance - vehicle.s;
              const wrapped = ((raw % snapshot.lanes.length) + snapshot.lanes.length) % snapshot.lanes.length;
              return Math.min(wrapped, snapshot.lanes.length - wrapped);
            })
            .sort((left, right) => left - right)[0];
          if (nearestRed !== undefined && nearestRed < 8) stopEvents += 1;
        }
      }

      for (let index = 0; index < snapshot.vehicles.length; index += 1) {
        const current = snapshot.vehicles[index] as (typeof snapshot.vehicles)[number];
        if (current.speedKph >= 3) continue;
        // Nearest vehicle ahead of this one, along the loop.
        let nearest = Number.POSITIVE_INFINITY;
        for (const other of snapshot.vehicles) {
          if (other.id === current.id) continue;
          const raw = other.s - current.s;
          const wrapped = ((raw % snapshot.lanes.length) + snapshot.lanes.length) % snapshot.lanes.length;
          nearest = Math.min(nearest, wrapped);
        }
        if (nearest < 6) {
          queueEvents += 1;
          maxQueueGap = Math.min(maxQueueGap, nearest);
        }
      }
    }

    expect(offLaneSamples).toBe(0);
    expect(stopEvents).toBeGreaterThan(0);
    expect(queueEvents).toBeGreaterThan(0);
    expect(maxQueueGap).toBeLessThan(6);

    for (const vehicle of harness.api.vehicles) {
      expect(vehicle.wheelsSpin).toBeGreaterThan(startSpin.get(vehicle.id) ?? 0);
      // No vehicle is still sitting where it started a full lap later.
      const travelled = Math.abs(vehicle.s - (startS.get(vehicle.id) ?? 0));
      expect(travelled).toBeGreaterThan(5);
      expect(vehicle.speed).toBeGreaterThanOrEqual(0);
    }

    // Lap progress proves the fleet goes round rather than shuttling.
    expect(harness.api.snapshot().counts.driving).toBeGreaterThan(0);
  });

  it('parks a vehicle beside the kerb, blocks its follower, then departs', () => {
    const harness = createHarness({ initialEra: '1985', fleetSize: 8, parkDwellMs: [4500, 6000] });
    const target = harness.api.vehicles.find((vehicle) => vehicle.spec.parkable);
    expect(target).toBeDefined();
    expect(harness.api.requestPark(target?.id as string)).toBe(target?.id);

    let sawParked = false;
    let sawQueuedBehind = false;
    let sawDeparted = false;
    let parkedLateral = 0;
    let maxOccupied = 0;

    for (let frame = 0; frame < 60 * 60; frame += 1) {
      harness.context.tick(1 / 60);
      const vehicle = harness.api.vehicles.find((candidate) => candidate.id === target?.id);
      if (!vehicle) break;
      // Keep insisting: a bay is released when another vehicle is already parked.
      if (vehicle.state === 'cruising' && vehicle.bay === null) {
        harness.api.requestPark(vehicle.id);
      }
      maxOccupied = Math.max(maxOccupied, harness.api.snapshot().parking.parked);
      if (vehicle.state === 'parked') {
        sawParked = true;
        parkedLateral = Math.max(parkedLateral, vehicle.lateral);
        expect(vehicle.speed).toBeLessThanOrEqual(0.01);
        expect(vehicle.engineOn).toBe(false);
        const parkedS = vehicle.s;
        const length = harness.api.lane.length;
        for (const candidate of harness.api.vehicles) {
          if (candidate.id === vehicle.id) continue;
          const raw = parkedS - candidate.s;
          const gap = ((raw % length) + length) % length;
          if (gap < 12 && candidate.speed < 2.5) sawQueuedBehind = true;
        }
      } else if (sawParked && vehicle.state === 'cruising') {
        sawDeparted = true;
        break;
      }
    }

    expect(sawParked).toBe(true);
    expect(parkedLateral).toBeGreaterThan(0.35);
    // The kerbside pull-in never pushes a vehicle past the sidewalk edge.
    expect(parkedLateral).toBeLessThan(LANE_WIDTH / 2);
    expect(sawQueuedBehind).toBe(true);
    expect(sawDeparted).toBe(true);
    // One vehicle parks or manoeuvres into a bay at a time on the single-lane loop.
    expect(maxOccupied).toBeLessThanOrEqual(1);
    const parking = harness.api.snapshot().parking;
    expect(parking.reserved).toBeLessThanOrEqual(parking.bays);
  });

  it('keeps every vehicle on the road ring while the era tween swaps fleets', () => {
    const harness = createHarness({ initialEra: '1945', fleetSize: 8, parking: false });
    harness.timeline.selectEra('2025');

    let sawBothFleets = false;
    let bothFleetFrames = 0;
    for (let frame = 0; frame < 240; frame += 1) {
      harness.context.tick(1 / 60);
      const snapshot = harness.api.snapshot();
      if (snapshot.activeEras.length === 2) {
        sawBothFleets = true;
        bothFleetFrames += 1;
      }
      for (const vehicle of snapshot.vehicles) {
        expect(isOnRoad({ x: vehicle.x, z: vehicle.z })).toBe(true);
      }
    }

    expect(sawBothFleets).toBe(true);
    expect(bothFleetFrames).toBeGreaterThan(1);
    const final = harness.api.snapshot();
    expect([...final.activeEras]).toEqual(['2025']);
    expect(final.transitioning).toBe(false);
    expect(harness.api.era).toBe('2025');
  });
});

/* ------------------------------------------------------------------ */
/* Audio wiring                                                        */
/* ------------------------------------------------------------------ */

describe('positional vehicle audio', () => {
  it('registers positional engine emitters bound to the live vehicles', async () => {
    const harness = createHarness({ initialEra: '1985', fleetSize: 6, parking: false });
    await harness.director.unlock();

    const snapshot = harness.api.snapshot();
    expect(snapshot.audio.directorAttached).toBe(true);
    expect(snapshot.audio.unlocked).toBe(true);
    expect(snapshot.audio.engineEmitters).toBe(snapshot.fleetSize);

    for (const vehicle of harness.api.vehicles) {
      const emitter = harness.director.getEmitter(engineEmitterId(vehicle.id));
      expect(emitter).toBeDefined();
      expect(emitter?.cue).toBe(vehicle.spec.engine.cue);
      expect(emitter?.bus).toBe('ambience');
    }

    // A few frames of driving: every engine loop is sounding and its panner
    // tracks the vehicle's world position.
    harness.step(1);
    const withVoices = harness.api.vehicles.filter(
      (vehicle) => harness.director.getEmitter(engineEmitterId(vehicle.id))?.handle != null,
    );
    expect(withVoices.length).toBeGreaterThan(0);

    for (const vehicle of withVoices) {
      const emitter = harness.director.getEmitter(engineEmitterId(vehicle.id));
      const panner = emitter?.handle?.panner;
      expect(panner).not.toBeNull();
      vehicle.build.root.getWorldPosition(vehicle.worldPosition);
      expect(panner?.positionX.value).toBeCloseTo(vehicle.worldPosition.x, 5);
      expect(panner?.positionZ.value).toBeCloseTo(vehicle.worldPosition.z, 5);
    }
    expect(harness.audio.byKind('panner').length).toBeGreaterThan(0);
  });

  it('fires the horn from the vehicle world position through the director', async () => {
    const harness = createHarness({ initialEra: '1985', fleetSize: 6, parking: false });
    await harness.director.unlock();
    const playSpy = vi.spyOn(harness.director, 'play');

    harness.step(0.5);
    const vehicle = harness.api.vehicles.find((candidate) => candidate.spec.horn.rate > 0);
    expect(vehicle).toBeDefined();
    const event = harness.api.honk(vehicle?.id, 'manual');

    expect(event).not.toBeNull();
    expect(event?.reason).toBe('manual');
    expect(event?.played).toBe(true);
    expect(event?.position.x).toBeCloseTo(vehicle?.worldPosition.x ?? Number.NaN, 6);
    expect(event?.position.z).toBeCloseTo(vehicle?.worldPosition.z ?? Number.NaN, 6);
    expect(event?.position.y).toBeCloseTo((vehicle?.worldPosition.y ?? 0) + 0.6, 6);
    expect(event?.rate).toBe(vehicle?.spec.horn.rate);

    const hornCall = playSpy.mock.calls.find((call) => call[0] === 'horn');
    expect(hornCall).toBeDefined();
    const options = hornCall?.[1] as { position?: { x: number; z: number }; era?: EraId } | undefined;
    expect(options?.era).toBe('1985');
    expect(options?.position?.x).toBeCloseTo(vehicle?.worldPosition.x ?? Number.NaN, 6);
    expect(options?.position?.z).toBeCloseTo(vehicle?.worldPosition.z ?? Number.NaN, 6);

    // The horn is a positional cue, so the graph really got a spatial node.
    expect(harness.audio.byKind('panner').length).toBeGreaterThan(0);
    expect(harness.director.snapshot().activeVoiceCount).toBeGreaterThan(0);
  });

  it('degrades gracefully when the platform has no audio at all', () => {
    const context = createSceneContext({
      createRenderer: createStubRenderer,
      seed: 7,
      autoStart: false,
      autoResize: false,
    });
    const library = createMaterialLibrary({ random: createSeededRng(7) });
    const director = createAudioDirector({ createAudioContext: () => null, documentRef: null });
    director.registerCues(createSfxLibrary());
    const api = createTrafficApi({ library, seed: 7, fleetSize: 4, initialEra: '1965' });
    api.consume({ audio: director });
    api.integrate(context, { publish: false });

    for (let frame = 0; frame < 120; frame += 1) context.tick(1 / 60);
    const snapshot = api.snapshot();
    expect(snapshot.fleetSize).toBe(4);
    expect(snapshot.audio.engineEmitters).toBe(4);
    expect(api.honk()?.played).toBe(false);

    api.dispose();
    director.dispose();
    context.dispose();
  });
});

/* ------------------------------------------------------------------ */
/* Inspection and integration                                          */
/* ------------------------------------------------------------------ */

describe('inspection and lifecycle integration', () => {
  it('registers one notable vehicle per era with per-year names', () => {
    const harness = createHarness({ initialEra: '1945', fleetSize: 8, parking: false });

    for (const era of ERA_IDS) {
      harness.api.applyEra(era);
      const id = harness.api.system.notableInspectableId(era);
      const resolved = harness.registry.resolve(id, era);
      expect(resolved).not.toBeNull();
      expect(resolved?.name.startsWith(era)).toBe(true);
      expect(resolved?.blurb.length).toBeGreaterThan(20);
      expect(resolved?.source).toBe('era');

      const notable = harness.api.system.notableVehicle;
      expect(notable?.spec.era).toBe(era);
      const record = harness.registry.get(id);
      expect(record?.object).toBe(notable?.build.root);
      // Exactly one traffic inspectable is live at a time.
      expect(harness.registry.ids().filter((candidate) => candidate.startsWith('traffic-vehicle-'))).toEqual([
        id,
      ]);
      // And it is pickable through the shared picking targets.
      expect(harness.registry.pickTargets()).toContain(record?.object);
    }
  });

  it('swaps fleets progressively through the TimelineRuntime', () => {
    const harness = createHarness({ initialEra: '1985', fleetSize: 8, parking: false });
    expect(harness.api.era).toBe('1985');
    expect(harness.api.snapshot().models.map((entry) => entry.id)).toContain('yellow-cab-1985');

    harness.timeline.selectEra('2025');
    harness.step(0.6);
    const mid = harness.api.snapshot();
    expect(mid.transitioning).toBe(true);
    expect(mid.activeEras.length).toBe(2);
    expect(mid.models.some((entry) => entry.id.includes('2025'))).toBe(true);
    expect(mid.models.some((entry) => entry.id.includes('1985'))).toBe(true);

    harness.step(1.2);
    const settled = harness.api.snapshot();
    expect(settled.era).toBe('2025');
    expect(settled.transitioning).toBe(false);
    expect([...settled.activeEras]).toEqual(['2025']);
    expect(settled.models.every((entry) => entry.id.includes('2025'))).toBe(true);
    expect(harness.registry.resolve('traffic-vehicle-2025-notable', '2025')?.name).toContain('2025');
    expect(harness.registry.has('traffic-vehicle-1985-notable')).toBe(false);
  });

  it('integrates as a scene system and publishes a browser-probeable handle', () => {
    const harness = createHarness({ initialEra: '2005', fleetSize: 6, parking: false });
    expect(harness.context.hasSystem('city-traffic')).toBe(true);
    expect(harness.context.scene.children).toContain(harness.api.group);

    const before = harness.api.snapshot().simTimeMs;
    harness.step(1);
    expect(harness.api.snapshot().simTimeMs).toBeGreaterThan(before);

    harness.api.publish();
    const published = getTrafficApi(TRAFFIC_GLOBAL_KEY);
    expect(published).toBe(harness.api);
    expect(published?.snapshot().era).toBe('2005');
    detachTrafficGlobal(TRAFFIC_GLOBAL_KEY, harness.api);
    expect(getTrafficApi(TRAFFIC_GLOBAL_KEY)).toBeNull();
  });

  it('adapts when the timeline adopts a different era immediately', () => {
    const harness = createHarness({ initialEra: '1945', fleetSize: 6, parking: false });
    harness.timeline.selectEra('1985', { immediate: true });
    const snapshot = harness.api.snapshot();
    expect(snapshot.era).toBe('1985');
    expect(snapshot.transitioning).toBe(false);
    expect(snapshot.activeEras).toEqual(['1985']);
    expect(snapshot.models.some((entry) => entry.id === 'yellow-cab-1985')).toBe(true);
    expect(snapshot.lanes.onRoad).toBe(true);
    expect(snapshot.audio.engineEmitters).toBeGreaterThan(0);
  });

  it('creates a traffic system directly with a seeded random source', () => {
    const library = createMaterialLibrary({ random: createSeededRng(99) });
    const factory = createVehicleFactory({ library });
    const system = new TrafficSystem({
      factory,
      random: createSeededRng(99),
      initialEra: '1965',
      fleetSize: 4,
    });

    expect(system.era).toBe('1965');
    expect(system.vehicles.length).toBe(4);
    expect(system.lane.onRoad).toBe(true);
    system.update(1 / 60);
    expect(system.simElapsedMs).toBeGreaterThan(0);

    const snapshot = system.snapshot();
    for (const vehicle of snapshot.vehicles) {
      expect(vehicle.details).toContain('wheels');
      expect(vehicle.meshCount).toBeGreaterThan(0);
    }

    system.dispose();
    factory.dispose();
    library.dispose();
  });
});
