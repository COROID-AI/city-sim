/**
 * Parametric vehicle builder.
 *
 * Every era's fleet is generated from its {@link VehicleSpec} list: rounded
 * pre-war sedans, checker cabs and flatbed trucks; streetcars on rails; V8
 * muscle cars and station wagons; boxy sedans, vans and hatchbacks; SUVs; and
 * finally EVs, robotaxis, cargo e-bikes and shared e-scooters.
 *
 * Shared parts: wheels with hubcaps, chrome brightwork, tinted glazing,
 * headlights / brake lights / turn-signal emissives (driven by the traffic sim),
 * roof racks, licence plates and exhaust stubs where the era calls for them.
 */

import * as THREE from 'three';
import type { VehicleSpec, VehicleType } from '../config/types';
import { createLaneGraph, type LanePath, type TrafficVehicle } from '../sim/traffic';
import type { WorldKit } from './textures';

export interface VehicleParts {
  group: THREE.Group;
  brakeLights: THREE.Mesh[];
  turnSignals: THREE.Mesh[];
  headlights: THREE.Mesh[];
  wheels: THREE.Object3D[];
}

interface Profile {
  /** Length of the cabin as a fraction of body length. */
  cabin: number;
  /** Cabin height as a fraction of body height. */
  cabinHeight: number;
  /** Cabin centre offset along the vehicle body, -0.5..0.5. */
  cabinOffset: number;
  wheelRadius: number;
  wheelCount: number;
  /** Extra body block (truck bed / box van / tram roof). */
  boxy?: boolean;
  /** Two-wheeled (bicycle / scooter). */
  twoWheel?: boolean;
  /** Rail vehicle: bogies, pantograph and no exhaust. */
  railed?: boolean;
  /** Windscreen rake, 0..1. */
  rake: number;
}

const PROFILES: Record<VehicleType, Profile> = {
  sedan: { cabin: 0.46, cabinHeight: 0.52, cabinOffset: -0.02, wheelRadius: 0.34, wheelCount: 4, rake: 0.2 },
  taxi: { cabin: 0.44, cabinHeight: 0.55, cabinOffset: -0.03, wheelRadius: 0.35, wheelCount: 4, rake: 0.15 },
  compact: { cabin: 0.44, cabinHeight: 0.5, cabinOffset: -0.02, wheelRadius: 0.3, wheelCount: 4, rake: 0.18 },
  hatchback: { cabin: 0.48, cabinHeight: 0.52, cabinOffset: -0.06, wheelRadius: 0.31, wheelCount: 4, rake: 0.26 },
  'muscle-car': { cabin: 0.4, cabinHeight: 0.42, cabinOffset: -0.02, wheelRadius: 0.35, wheelCount: 4, rake: 0.3 },
  'station-wagon': { cabin: 0.58, cabinHeight: 0.52, cabinOffset: -0.08, wheelRadius: 0.34, wheelCount: 4, rake: 0.12 },
  suv: { cabin: 0.5, cabinHeight: 0.48, cabinOffset: -0.02, wheelRadius: 0.4, wheelCount: 4, rake: 0.1 },
  ev: { cabin: 0.52, cabinHeight: 0.46, cabinOffset: 0, wheelRadius: 0.36, wheelCount: 4, rake: 0.34 },
  rideshare: { cabin: 0.48, cabinHeight: 0.46, cabinOffset: 0, wheelRadius: 0.34, wheelCount: 4, rake: 0.28 },
  van: { cabin: 0.72, cabinHeight: 0.78, cabinOffset: -0.05, wheelRadius: 0.36, wheelCount: 4, boxy: true, rake: 0.06 },
  truck: { cabin: 0.3, cabinHeight: 0.45, cabinOffset: 0.28, wheelRadius: 0.42, wheelCount: 6, boxy: true, rake: 0.05 },
  bus: { cabin: 0.92, cabinHeight: 0.86, cabinOffset: 0, wheelRadius: 0.44, wheelCount: 4, boxy: true, rake: 0.04 },
  streetcar: { cabin: 0.95, cabinHeight: 0.8, cabinOffset: 0, wheelRadius: 0.34, wheelCount: 8, boxy: true, railed: true, rake: 0.02 },
  bicycle: { cabin: 0.1, cabinHeight: 0.1, cabinOffset: 0, wheelRadius: 0.34, wheelCount: 2, twoWheel: true, rake: 0 },
  'cargo-bike': { cabin: 0.1, cabinHeight: 0.1, cabinOffset: -0.32, wheelRadius: 0.32, wheelCount: 3, twoWheel: true, boxy: true, rake: 0 },
  scooter: { cabin: 0.1, cabinHeight: 0.1, cabinOffset: 0, wheelRadius: 0.22, wheelCount: 2, twoWheel: true, rake: 0 },
};

/** Build a single vehicle. The model faces +Z. */
export function createVehicle(kit: WorldKit, spec: VehicleSpec, moving: boolean): VehicleParts {
  const profile = PROFILES[spec.kind];
  const group = new THREE.Group();
  group.name = `vehicle:${spec.id}`;
  const bodyMaterial = kit.library.flat(spec.body, { roughness: 0.38, metalness: 0.35 });
  const accentMaterial = kit.library.flat(spec.accent, { roughness: 0.45, metalness: 0.2 });
  const chromeMaterial = kit.library.metal('#c9ced6', 0.22);
  const glassMaterial = kit.library.glass('#1f2a33', 0.72);
  const rubberMaterial = kit.library.flat('#181a1c', { roughness: 0.95 });
  const headlightMaterial = kit.library.neon('#fff2cf', 1.4);
  // Brake and indicator materials are cloned per vehicle: the traffic sim dims
  // and blinks them individually, so they must not come from the shared cache.
  const brakeMaterial = kit.library.neon('#ff3a2f', 0.35).clone();
  const signalMaterial = kit.library.neon('#ffa32f', 0.2).clone();
  brakeMaterial.name = `brake:${spec.id}`;
  signalMaterial.name = `signal:${spec.id}`;

  const { length, width, height } = spec;
  const wheelRadius = profile.wheelRadius;
  const bodyHeight = height * (profile.boxy ? 0.74 : 0.56);
  const bodyY = wheelRadius + bodyHeight / 2;

  if (profile.twoWheel) {
    // Frame + handlebars + seat; the rider is a simple silhouette (2025 riders
    // wear era kit, but the rider-less bikes keep the lane count cheap).
    const frameMaterial = kit.library.metal(spec.body, 0.35);
    const bar = new THREE.Mesh(kit.geometry.box(length * 0.9, 0.1, 0.1), frameMaterial);
    bar.position.y = wheelRadius + 0.42;
    const seat = new THREE.Mesh(kit.geometry.box(length * 0.28, 0.12, width * 0.6), accentMaterial);
    seat.position.set(-length * 0.22, wheelRadius + 0.72, 0);
    const handle = new THREE.Mesh(kit.geometry.box(0.08, 0.5, width * 0.9), frameMaterial);
    handle.position.set(length * 0.38, wheelRadius + 0.8, 0);
    handle.rotation.z = -0.2;
    const stand = new THREE.Mesh(kit.geometry.cylinder(0.05, 0.05, height - wheelRadius, 6), frameMaterial);
    stand.position.set(length * 0.36, wheelRadius + (height - wheelRadius) / 2, 0);
    group.add(bar, seat, handle, stand);
    if (spec.kind === 'scooter') {
      const deck = new THREE.Mesh(kit.geometry.box(length * 0.5, 0.08, width * 0.5), accentMaterial);
      deck.position.set(-length * 0.05, wheelRadius + 0.12, 0);
      const stem = new THREE.Mesh(kit.geometry.box(0.07, 1.05, 0.07), kit.library.metal('#2f3238', 0.3));
      stem.position.set(length * 0.4, wheelRadius + 0.55, 0);
      group.add(deck, stem);
    }
    if (spec.kind === 'cargo-bike') {
      const crate = new THREE.Mesh(kit.geometry.box(length * 0.42, 0.5, width * 0.9), kit.library.flat(spec.accent, { roughness: 0.8 }));
      crate.position.set(-length * 0.32, wheelRadius + 0.42, 0);
      group.add(crate);
    }
  } else {
    // Main body.
    const body = new THREE.Mesh(kit.geometry.box(width, bodyHeight, length), bodyMaterial);
    body.position.y = bodyY;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Sill chrome / side trim.
    if (spec.kind !== 'streetcar' && spec.kind !== 'bus') {
      const trim = new THREE.Mesh(kit.geometry.box(width + 0.03, 0.07, length * 0.92), chromeMaterial);
      trim.position.y = bodyY - bodyHeight * 0.14;
      group.add(trim);
    }

    // Cabin / box.
    const cabinHeight = height * profile.cabinHeight * (profile.boxy ? 1.05 : 1);
    const cabinLength = length * profile.cabin;
    const cabin = new THREE.Mesh(kit.geometry.box(width * 0.94, cabinHeight, cabinLength), bodyMaterial);
    cabin.position.set(0, bodyY + bodyHeight / 2 + cabinHeight / 2 - 0.02, length * profile.cabinOffset);
    cabin.castShadow = true;
    group.add(cabin);

    if (profile.boxy) {
      // Window strip for buses / trams / vans.
      const windowStrip = new THREE.Mesh(kit.geometry.box(width * 0.97, cabinHeight * 0.5, cabinLength * 0.94), glassMaterial);
      windowStrip.position.copy(cabin.position);
      windowStrip.position.y += cabinHeight * 0.1;
      group.add(windowStrip);
      if (profile.railed) {
        const roof = new THREE.Mesh(kit.geometry.box(width * 0.86, 0.18, length * 0.9), accentMaterial);
        roof.position.set(0, bodyY + bodyHeight / 2 + cabinHeight + 0.08, 0);
        group.add(roof);
        // Pantograph.
        const arm = new THREE.Mesh(kit.geometry.box(0.07, 1.3, 0.07), chromeMaterial);
        arm.position.set(0, bodyY + bodyHeight / 2 + cabinHeight + 0.9, length * 0.24);
        arm.rotation.z = 0.25;
        const collector = new THREE.Mesh(kit.geometry.box(width * 0.8, 0.07, 0.07), chromeMaterial);
        collector.position.set(0, bodyY + bodyHeight / 2 + cabinHeight + 1.55, length * 0.3);
        group.add(arm, collector);
      }
    } else {
      // Windscreen and side glass.
      const screen = new THREE.Mesh(kit.geometry.box(width * 0.88, cabinHeight * 0.78, cabinLength * 0.96), glassMaterial);
      screen.position.copy(cabin.position);
      screen.position.z += cabinLength * 0.02;
      group.add(screen);
    }

    // Truck / van bed.
    if (profile.boxy && spec.kind === 'truck') {
      const bed = new THREE.Mesh(kit.geometry.box(width * 1.02, height * 0.62, length * 0.55), accentMaterial);
      bed.position.set(0, wheelRadius + height * 0.31 + 0.15, -length * 0.2);
      bed.castShadow = true;
      group.add(bed);
    }

    // Off-road / taxi roof kit.
    if (spec.kind === 'taxi') {
      const sign = new THREE.Mesh(kit.geometry.box(0.7, 0.24, 0.22), kit.library.neon('#ffe9a8', 1.2));
      sign.position.set(0, cabin.position.y + cabinHeight / 2 + 0.12, cabinLength * 0.1);
      group.add(sign);
    }
    if (spec.kind === 'suv' || spec.kind === 'van' || spec.kind === 'station-wagon') {
      const rack = new THREE.Mesh(kit.geometry.box(width * 0.8, 0.08, cabinLength * 0.7), chromeMaterial);
      rack.position.set(0, cabin.position.y + cabinHeight / 2 + 0.06, cabin.position.z);
      group.add(rack);
    }
    if (spec.kind === 'ev' || spec.kind === 'rideshare') {
      // Roof sensor pod - the modern-era tell.
      const pod = new THREE.Mesh(kit.geometry.box(width * 0.5, 0.16, 0.5), kit.library.neon('#7fd0ff', 0.9));
      pod.position.set(0, cabin.position.y + cabinHeight / 2 + 0.1, cabin.position.z + 0.2);
      group.add(pod);
    }
    if (spec.kind !== 'bus' && spec.kind !== 'streetcar' && spec.kind !== 'ev') {
      // Exhaust stub - absent on the 2025 EVs.
      const pipe = new THREE.Mesh(kit.geometry.cylinder(0.06, 0.06, 0.4, 8), chromeMaterial);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(-width * 0.3, wheelRadius + 0.1, -length / 2 - 0.1);
      group.add(pipe);
    }
  }

  // Wheels with hubcaps.
  const wheels: THREE.Object3D[] = [];
  const wheelGeometry = kit.geometry.cylinder(wheelRadius, wheelRadius, 0.22, 12);
  const hubGeometry = kit.geometry.cylinder(wheelRadius * 0.55, wheelRadius * 0.55, 0.24, 10);
  const axles = profile.wheelCount === 2 ? [length * 0.36, -length * 0.32] : profile.railed ? [-length * 0.32, length * 0.32] : [-length * 0.32, length * 0.3];
  const sides = profile.twoWheel || profile.railed ? [0] : [-1, 1];
  for (const axle of axles) {
    for (const side of sides) {
      const wheel = new THREE.Mesh(wheelGeometry, rubberMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * (width / 2 - 0.06), wheelRadius, axle);
      wheel.castShadow = true;
      const hub = new THREE.Mesh(hubGeometry, chromeMaterial);
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(wheel.position);
      hub.position.x += side * 0.03;
      group.add(wheel, hub);
      wheels.push(wheel);
    }
  }

  // Lights: head, brake, indicators.
  const headlights: THREE.Mesh[] = [];
  const brakeLights: THREE.Mesh[] = [];
  const turnSignals: THREE.Mesh[] = [];
  const lightY = profile.twoWheel ? wheelRadius + 0.85 : Math.max(wheelRadius + 0.25, bodyY - bodyHeight * 0.1);
  const frontZ = profile.twoWheel ? length * 0.42 : length / 2 + 0.02;
  const rearZ = profile.twoWheel ? -length * 0.34 : -length / 2 - 0.02;
  for (const side of profile.twoWheel ? [0] : [-1, 1]) {
    const head = new THREE.Mesh(kit.geometry.box(0.3, 0.18, 0.1), headlightMaterial);
    head.position.set(side * width * 0.3, lightY, frontZ);
    head.castShadow = false;
    group.add(head);
    headlights.push(head);

    const brake = new THREE.Mesh(kit.geometry.box(0.34, 0.16, 0.1), brakeMaterial);
    brake.position.set(side * width * 0.3, lightY, rearZ);
    brake.castShadow = false;
    group.add(brake);
    brakeLights.push(brake);

    const signal = new THREE.Mesh(kit.geometry.box(0.18, 0.12, 0.1), signalMaterial);
    signal.position.set(side * (width * 0.42), lightY + 0.16, frontZ);
    signal.castShadow = false;
    group.add(signal);
    turnSignals.push(signal);
    const rearSignal = new THREE.Mesh(kit.geometry.box(0.18, 0.12, 0.1), signalMaterial);
    rearSignal.position.set(side * (width * 0.42), lightY + 0.16, rearZ);
    rearSignal.castShadow = false;
    group.add(rearSignal);
    turnSignals.push(rearSignal);
  }

  // Licence plate.
  const plate = new THREE.Mesh(kit.geometry.box(width * 0.32, 0.16, 0.05), kit.library.flat('#e8e4d4', { roughness: 0.6 }));
  plate.position.set(0, wheelRadius + 0.28, rearZ - 0.02);
  group.add(plate);

  for (const light of brakeLights) light.visible = true;

  group.userData.focus = { kind: 'vehicle', label: spec.label, id: spec.id };
  group.userData.moving = moving;
  group.userData.brakeLights = brakeLights;
  group.userData.turnSignals = turnSignals;

  return { group, brakeLights, turnSignals, headlights, wheels };
}

export interface VehiclesBuild {
  group: THREE.Group;
  /** Moving vehicles, ready for the traffic sim. */
  traffic: TrafficVehicle[];
  parked: number;
  moving: number;
  total: number;
  /** Every vehicle, parked and moving (for focusing). */
  all: { spec: VehicleSpec; group: THREE.Group; moving: boolean }[];
}

const LANE_SPEED_MIN = 7;

/**
 * Place the whole era fleet: parked cars nosed into the kerbs, moving traffic
 * distributed across the lane graph (trams confined to the rail lanes).
 */
export function createVehicles(kit: WorldKit, lanes: LanePath[] = createLaneGraph()): VehiclesBuild {
  const group = new THREE.Group();
  group.name = 'vehicles';
  const traffic: TrafficVehicle[] = [];
  const all: VehiclesBuild['all'] = [];
  let parked = 0;

  const railLanes = lanes.filter((lane) => lane.kind === 'rail');
  const roadLanes = lanes.filter((lane) => lane.kind === 'road');
  let roadCursor = 0;

  for (const spec of kit.era.vehicles) {
    const movingCount = Math.round(spec.count * spec.movingRatio);
    for (let i = 0; i < spec.count; i += 1) {
      const isMoving = i < movingCount;
      const parts = createVehicle(kit, spec, isMoving);
      const { group: vehicle } = parts;

      if (isMoving) {
        const lanePool = (spec.kind === 'streetcar' || spec.kind === 'bus') && railLanes.length > 0 && spec.kind === 'streetcar'
          ? railLanes
          : roadLanes.length > 0
            ? roadLanes
            : lanes;
        const lane = lanePool[roadCursor % lanePool.length];
        roadCursor += 1;
        const offset = kit.rng.range(0, lane.length);
        vehicle.userData.laneId = lane.id;
        group.add(vehicle);
        traffic.push({
          object: vehicle,
          spec,
          laneId: lane.id,
          axis: lane.axis,
          direction: lane.direction,
          laneOffset: lane.offset,
          laneStart: lane.start,
          laneEnd: lane.end,
          distance: offset,
          laneLength: lane.length,
          speed: Math.max(LANE_SPEED_MIN, lane.speed * kit.era.trafficSpeed),
          baseSpeed: Math.max(LANE_SPEED_MIN, lane.speed * kit.era.trafficSpeed),
          braking: false,
          brakeLights: parts.brakeLights,
          turnSignals: parts.turnSignals,
        });
        all.push({ spec, group: vehicle, moving: true });
      } else {
        // Parked along the kerb, alternating side and street.
        const alongAxis = kit.rng.chance(0.5) ? 'x' : 'z';
        const sign = kit.rng.chance(0.5) ? 1 : -1;
        const kerb = 7.5 - spec.width / 2 - 0.5;
        const along = kit.rng.range(16, 88) * (kit.rng.chance(0.5) ? 1 : -1);
        vehicle.position.set(
          alongAxis === 'x' ? along : sign * kerb,
          0,
          alongAxis === 'x' ? sign * kerb : along,
        );
        vehicle.rotation.y =
          alongAxis === 'x'
            ? sign > 0
              ? Math.PI / 2
              : -Math.PI / 2
            : sign > 0
              ? Math.PI
              : 0;
        group.add(vehicle);
        parked += 1;
        all.push({ spec, group: vehicle, moving: false });
      }
    }
  }

  return { group, traffic, parked, moving: traffic.length, total: parked + traffic.length, all };
}
