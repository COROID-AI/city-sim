/**
 * Chrono City — era vehicle fleet factory.
 *
 * The single authored source of truth for *what each era's vehicles look like*:
 * twenty modelled silhouettes across the five years (1945 saloon / delivery van
 * / flatbed truck / streetcar, 1965 muscle coupe / compact / double-decker bus /
 * panel van, 1985 boxy sedan / yellow cab / wedge coupe / minivan / articulated
 * bus, 2005 hybrid / SUV / city bus / parcel van, 2025 EV crossover /
 * autonomous pod / electric bus), each with wheels, glass, chrome or painted
 * brightwork, head and tail lamps, exhausts or charge ports and the era's own
 * engines and horns.
 *
 * The mesh builders are deliberately *bounded*: one shared unit box, one unit
 * cylinder, one unit sphere and one pre-rotated wheel blank back every vehicle
 * in every era, so no era can allocate unbounded unique geometry. Vehicles are
 * pooled per `(model, colour)`, which is what keeps an era swap (and a slider
 * scrub back and forth) allocation-free once the fleet has been built.
 *
 * Lifecycle:
 *   create    → `createVehicleFactory()` holds the shared `MaterialLibrary`,
 *               the pooled roots and the per-era material sets.
 *   consume   → `buildEraFleetPlan()` resolves one year's fleet from the era
 *               descriptor, `create()` checks a vehicle out of the pool and
 *               `release()` returns it.
 *   integrate → the traffic system drives the builds along the lane spline, the
 *               audio director binds engine emitters to each `root`, and the
 *               inspection registry picks the era's notable vehicle.
 */

import * as THREE from 'three';

import { clamp01, type EraId } from '../../core/eraContracts';
import {
  getEraDescriptor,
  type EraVehicleClass,
  type EraVehicleMix,
} from '../../era/eraDescriptors';
import {
  MaterialLibrary,
  type MaterialRequest,
} from '../../materials/materialLibrary';

export const VEHICLE_FACTORY_VERSION = 1;

/** Vehicles built for one era by default: enough traffic to read as a street. */
export const DEFAULT_FLEET_SIZE = 12;

/** Smallest / largest useful fleet (kept bounded so the 60 fps budget holds). */
export const MIN_FLEET_SIZE = 4;
export const MAX_FLEET_SIZE = 24;

/** Body underside height above the road for the thinnest sills. */
const MIN_RIDE_HEIGHT = 0.18;

/**
 * Everything the factory can build. `profile` drives the silhouette; the plan
 * numbers are metres in vehicle space (origin on the road, nose towards +Z).
 */
export type VehicleProfile =
  | 'saloon'
  | 'coupe'
  | 'truck'
  | 'van'
  | 'bus'
  | 'tram'
  | 'pod'
  | 'suv';

export type VehicleRoofKind = 'flat' | 'arched' | 'domed' | 'split-level' | 'double-deck';

export type VehicleFenderKind = 'integrated' | 'separate' | 'flared';

export type VehicleNoseKind = 'long' | 'medium' | 'short' | 'blunt';

export type VehicleExhaustKind = 'none' | 'single' | 'twin' | 'stack' | 'side';

export type VehicleChargePortKind = 'none' | 'flank' | 'nose';

export interface VehicleBodyPlan {
  readonly profile: VehicleProfile;
  /** Bumper-to-bumper length. */
  readonly length: number;
  readonly width: number;
  /** Main body band height above `rideHeight`. */
  readonly bodyHeight: number;
  /** Greenhouse length; `0` for vehicles without a stepped cabin. */
  readonly cabinLength: number;
  readonly cabinHeight: number;
  /** Longitudinal centre of the greenhouse relative to the vehicle centre. */
  readonly cabinOffset: number;
  readonly wheelRadius: number;
  readonly wheelbase: number;
  readonly wheelCount: 4 | 6;
  /** `2` builds an articulated vehicle that bends through the block corners. */
  readonly sections: 1 | 2;
  /** Share of the length taken by the front section of an articulated vehicle. */
  readonly sectionSplit: number;
  readonly roof: VehicleRoofKind;
  readonly fenders: VehicleFenderKind;
  readonly nose: VehicleNoseKind;
  readonly windowBands: number;
  readonly deckCount: 1 | 2;
  readonly rideHeight: number;
}

/** Era-authentic detail flags, all visible in the built mesh. */
export interface VehicleDetailSpec {
  /** `0` = body-coloured brightwork, `1` = fully chromed. */
  readonly chromeRatio: number;
  readonly exhaust: VehicleExhaustKind;
  readonly chargePort: VehicleChargePortKind;
  readonly taxiSign: boolean;
  readonly trolleyPole: boolean;
  readonly pantograph: boolean;
  readonly ledStrip: boolean;
  readonly roofSensor: boolean;
  readonly roofRack: boolean;
  readonly tailFins: boolean;
  readonly vinylRoof: boolean;
  readonly wireWheels: boolean;
  readonly mudFlaps: boolean;
  readonly quadHeadlamps: boolean;
  readonly spotlights: 0 | 1 | 2;
  /** Accent colour used for livery stripes and destination boards. */
  readonly livery: string;
  readonly notes: string;
}

export type VehicleEngineKind = 'petrol' | 'diesel' | 'electric' | 'tram';

/** How a vehicle sounds: cue, pitch and level handed to the AudioDirector. */
export interface VehicleEngineSpec {
  readonly kind: VehicleEngineKind;
  /** Registered cue the positional engine loop plays. */
  readonly cue: string;
  readonly bus: 'ambience' | 'sfx';
  /** Pitch multiplier: low for vintage four-strokes, high for EV inverters. */
  readonly rate: number;
  readonly gain: number;
  readonly note: string;
}

export interface VehicleHornSpec {
  readonly cue: string;
  readonly rate: number;
  readonly gain: number;
  readonly tone: string;
}

/** One fully authored model: the unit the fleet plan and the factory share. */
export interface VehicleModelSpec {
  /** Stable id, e.g. `yellow-cab-1985`. */
  readonly id: string;
  readonly era: EraId;
  /** Year-prefixed display name used on the info card. */
  readonly label: string;
  readonly blurb: string;
  readonly vehicleClass: EraVehicleClass;
  /** Guaranteed a seat in the era's fleet. */
  readonly signature: boolean;
  /** Registered in the `InspectionRegistry` while its era is active. */
  readonly notable: boolean;
  /** Authored paint override (the yellow cab keeps its livery). */
  readonly colour?: number;
  readonly plan: VehicleBodyPlan;
  readonly details: VehicleDetailSpec;
  readonly engine: VehicleEngineSpec;
  readonly horn: VehicleHornSpec;
  readonly cruiseKph: number;
  /** Acceleration in m/s². */
  readonly accel: number;
  /** Service braking in m/s². */
  readonly brake: number;
  readonly parkable: boolean;
  /** Probability this vehicle takes a kerbside bay instead of driving on. */
  readonly parkChance: number;
}

/* ------------------------------------------------------------------------- *
 * Authored catalogue
 * ------------------------------------------------------------------------- */

interface EraDefaults {
  readonly chromeRatio: number;
  readonly cruiseKph: number;
  readonly accel: number;
  readonly brake: number;
  readonly engine: VehicleEngineSpec;
  readonly horn: VehicleHornSpec;
  readonly parkChance: number;
  readonly livery: string;
}

const ERA_VEHICLE_DEFAULTS: Readonly<Record<EraId, EraDefaults>> = Object.freeze({
  '1945': {
    chromeRatio: 0.35,
    cruiseKph: 26,
    accel: 1.0,
    brake: 3.0,
    engine: {
      kind: 'petrol',
      cue: 'traffic',
      bus: 'ambience',
      rate: 0.62,
      gain: 0.55,
      note: 'slow flathead four, visible exhaust puff',
    },
    horn: { cue: 'horn', rate: 1.24, gain: 0.62, tone: 'brass bulb horn' },
    parkChance: 0.4,
    livery: '#4a4436',
  },
  '1965': {
    chromeRatio: 0.8,
    cruiseKph: 42,
    accel: 1.9,
    brake: 4.2,
    engine: {
      kind: 'petrol',
      cue: 'traffic',
      bus: 'ambience',
      rate: 0.84,
      gain: 0.72,
      note: 'V8 rumble with a hard cam lope',
    },
    horn: { cue: 'horn', rate: 1.0, gain: 0.78, tone: 'twin electric trumpet' },
    parkChance: 0.32,
    livery: '#f0efe6',
  },
  '1985': {
    chromeRatio: 0.25,
    cruiseKph: 48,
    accel: 2.1,
    brake: 4.6,
    engine: {
      kind: 'petrol',
      cue: 'traffic',
      bus: 'ambience',
      rate: 1.0,
      gain: 0.66,
      note: 'fuel-injected four with a hollow mid-range',
    },
    horn: { cue: 'horn', rate: 1.06, gain: 0.72, tone: 'plastic-body two-tone' },
    parkChance: 0.26,
    livery: '#e8e2d0',
  },
  '2005': {
    chromeRatio: 0.1,
    cruiseKph: 45,
    accel: 2.2,
    brake: 5.0,
    engine: {
      kind: 'petrol',
      cue: 'traffic',
      bus: 'ambience',
      rate: 1.12,
      gain: 0.5,
      note: 'quiet hybrid Atkinson cycle over an electric whine',
    },
    horn: { cue: 'horn', rate: 1.1, gain: 0.68, tone: 'compact disc horn' },
    parkChance: 0.28,
    livery: '#7f8b96',
  },
  '2025': {
    chromeRatio: 0.05,
    cruiseKph: 50,
    accel: 2.6,
    brake: 5.4,
    engine: {
      kind: 'electric',
      cue: 'traffic',
      bus: 'ambience',
      rate: 1.46,
      gain: 0.34,
      note: 'inverter whine with a faint pedestrian-warning tone',
    },
    horn: { cue: 'horn', rate: 1.18, gain: 0.6, tone: 'synthetic two-tone chirp' },
    parkChance: 0.3,
    livery: '#4f7f6f',
  },
});

interface ModelInput {
  readonly id: string;
  readonly label: string;
  readonly blurb: string;
  readonly vehicleClass: EraVehicleClass;
  readonly profile: VehicleProfile;
  readonly length: number;
  readonly width: number;
  readonly bodyHeight: number;
  readonly wheelRadius: number;
  readonly wheelbase: number;
  readonly cabin?: readonly [length: number, height: number, offset: number];
  readonly wheelCount?: 4 | 6;
  readonly sections?: 1 | 2;
  readonly sectionSplit?: number;
  readonly roof?: VehicleRoofKind;
  readonly fenders?: VehicleFenderKind;
  readonly nose?: VehicleNoseKind;
  readonly windowBands?: number;
  readonly deckCount?: 1 | 2;
  readonly rideHeight?: number;
  readonly signature?: boolean;
  readonly notable?: boolean;
  readonly colour?: number;
  readonly cruiseKph?: number;
  readonly accel?: number;
  readonly brake?: number;
  readonly parkChance?: number;
  readonly parkable?: boolean;
  readonly details?: Partial<VehicleDetailSpec>;
  readonly engine?: Partial<VehicleEngineSpec>;
  readonly horn?: Partial<VehicleHornSpec>;
}

/** Turns a terse authoring record into a fully defaulted model spec. */
function defineModel(era: EraId, input: ModelInput): VehicleModelSpec {
  const defaults = ERA_VEHICLE_DEFAULTS[era];
  const cabin = input.cabin ?? [0, 0, 0];
  const detailDefaults: VehicleDetailSpec = {
    chromeRatio: defaults.chromeRatio,
    exhaust: input.vehicleClass === 'tram' ? 'none' : 'single',
    chargePort: 'none',
    taxiSign: false,
    trolleyPole: false,
    pantograph: false,
    ledStrip: false,
    roofSensor: false,
    roofRack: false,
    tailFins: false,
    vinylRoof: false,
    wireWheels: false,
    mudFlaps: input.vehicleClass !== 'tram',
    quadHeadlamps: false,
    spotlights: 0,
    livery: defaults.livery,
    notes: '',
  };

  return Object.freeze({
    id: input.id,
    era,
    label: input.label,
    blurb: input.blurb,
    vehicleClass: input.vehicleClass,
    signature: input.signature ?? false,
    notable: input.notable ?? false,
    ...(input.colour === undefined ? {} : { colour: input.colour }),
    plan: Object.freeze({
      profile: input.profile,
      length: input.length,
      width: input.width,
      bodyHeight: input.bodyHeight,
      cabinLength: cabin[0],
      cabinHeight: cabin[1],
      cabinOffset: cabin[2],
      wheelRadius: input.wheelRadius,
      wheelbase: input.wheelbase,
      wheelCount: input.wheelCount ?? 4,
      sections: input.sections ?? 1,
      sectionSplit: input.sectionSplit ?? 0.5,
      roof: input.roof ?? 'arched',
      fenders: input.fenders ?? 'integrated',
      nose: input.nose ?? 'medium',
      windowBands: input.windowBands ?? 1,
      deckCount: input.deckCount ?? 1,
      rideHeight: Math.max(MIN_RIDE_HEIGHT, input.rideHeight ?? input.wheelRadius * 0.72),
    }),
    details: Object.freeze({ ...detailDefaults, ...(input.details ?? {}) }),
    engine: Object.freeze({ ...defaults.engine, ...(input.engine ?? {}) }),
    horn: Object.freeze({ ...defaults.horn, ...(input.horn ?? {}) }),
    cruiseKph: input.cruiseKph ?? defaults.cruiseKph,
    accel: input.accel ?? defaults.accel,
    brake: input.brake ?? defaults.brake,
    parkable: input.parkable ?? (input.vehicleClass === 'car' || input.vehicleClass === 'truck'),
    parkChance: input.parkChance ?? defaults.parkChance,
  });
}

const MODELS_1945: readonly VehicleModelSpec[] = [
  defineModel('1945', {
    id: 'saloon-1945',
    label: '1945 Wilkes Deluxe Saloon',
    blurb:
      'A tall, narrow post-war saloon with separate cycle fenders, running boards and a single tailpipe. Rationed olive paint, chrome only where it survived the war.',
    vehicleClass: 'car',
    profile: 'saloon',
    length: 4.7,
    width: 1.84,
    bodyHeight: 0.8,
    cabin: [1.95, 0.74, -0.2],
    wheelRadius: 0.34,
    wheelbase: 2.75,
    roof: 'arched',
    fenders: 'separate',
    nose: 'long',
    signature: true,
    notable: true,
    details: {
      chromeRatio: 0.4,
      exhaust: 'single',
      spotlights: 2,
      wireWheels: false,
      mudFlaps: true,
      notes: 'split windscreen, running boards, chrome radiator shell, whitewall tyres',
    },
    engine: { rate: 0.6, gain: 0.58, note: 'flathead four with a slow chuff' },
  }),
  defineModel('1945', {
    id: 'delivery-van-1945',
    label: '1945 Bakery Delivery Van',
    blurb:
      'A short-wheelbase panel van painted with a hand-lettered bakery livery: flat glass, exposed hinges and a sliding side door.',
    vehicleClass: 'truck',
    profile: 'van',
    length: 4.6,
    width: 1.9,
    bodyHeight: 1.45,
    cabin: [1.3, 0.6, 1.5],
    wheelRadius: 0.35,
    wheelbase: 2.9,
    roof: 'flat',
    nose: 'short',
    details: {
      exhaust: 'single',
      mudFlaps: true,
      livery: '#6b2f2b',
      notes: 'panel livery, roof vent, sliding door, single rear lamp',
    },
  }),
  defineModel('1945', {
    id: 'flatbed-truck-1945',
    label: '1945 Ration-Run Flatbed Truck',
    blurb:
      'A six-wheel flatbed still hauling reconstruction loads, with a stake bed, an upright exhaust stack and a spare wheel bolted to the headboard.',
    vehicleClass: 'truck',
    profile: 'truck',
    length: 6.3,
    width: 2.12,
    bodyHeight: 0.95,
    cabin: [1.7, 1.0, 1.75],
    wheelRadius: 0.45,
    wheelbase: 3.7,
    wheelCount: 6,
    roof: 'flat',
    fenders: 'separate',
    nose: 'medium',
    signature: true,
    details: {
      chromeRatio: 0.12,
      exhaust: 'stack',
      mudFlaps: true,
      livery: '#4a4436',
      notes: 'stake bed, headboard, canvas tilt, twin rear axles',
    },
    cruiseKph: 22,
    accel: 0.8,
    brake: 2.8,
  }),
  defineModel('1945', {
    id: 'streetcar-1945',
    label: '1945 Municipal Streetcar, Route 7',
    blurb:
      'A two-section city streetcar on steel rails: trolley pole up to the overhead wire, lit destination board, wooden benches and a brass gong for a horn.',
    vehicleClass: 'tram',
    profile: 'tram',
    length: 8.8,
    width: 2.44,
    bodyHeight: 1.35,
    wheelRadius: 0.34,
    wheelbase: 5.6,
    sections: 2,
    roof: 'arched',
    nose: 'blunt',
    windowBands: 2,
    rideHeight: 0.34,
    signature: true,
    parkable: false,
    details: {
      chromeRatio: 0.25,
      exhaust: 'none',
      trolleyPole: true,
      spotlights: 1,
      mudFlaps: false,
      livery: '#6b2f2b',
      notes: 'trolley pole, lit destination board, folding doors, rail wheels',
    },
    engine: { kind: 'tram', rate: 0.5, gain: 0.62, note: 'traction motor whine and rail clatter' },
    horn: { rate: 0.86, gain: 0.7, tone: 'brass foot gong' },
    cruiseKph: 24,
    accel: 1.2,
    brake: 3.4,
  }),
];

const MODELS_1965: readonly VehicleModelSpec[] = [
  defineModel('1965', {
    id: 'muscle-coupe-1965',
    label: '1965 Vantage 442 Muscle Coupe',
    blurb:
      'A chrome-laden tail-fin coupe with quad headlamps, a bonnet scoop, twin exhausts and enough motor to chirp the rear tyres off the line.',
    vehicleClass: 'car',
    profile: 'coupe',
    length: 5.1,
    width: 1.94,
    bodyHeight: 0.74,
    cabin: [1.65, 0.6, -0.4],
    wheelRadius: 0.36,
    wheelbase: 2.95,
    roof: 'flat',
    nose: 'long',
    signature: true,
    notable: true,
    details: {
      chromeRatio: 0.85,
      exhaust: 'twin',
      quadHeadlamps: true,
      tailFins: true,
      spotlights: 2,
      mudFlaps: false,
      livery: '#f0efe6',
      notes: 'tail fins, quad lamps, bonnet scoop, chrome side spear, whitewall tyres',
    },
    engine: { rate: 0.86, gain: 0.8, note: 'big-block V8 with a hard cam lope' },
    horn: { rate: 0.98, gain: 0.82 },
    cruiseKph: 44,
  }),
  defineModel('1965', {
    id: 'compact-runabout-1965',
    label: '1965 Compact Runabout',
    blurb:
      'A cheap flat-glass compact with painted steel wheels and a single tailpipe, the car the muscle coupe keeps overtaking.',
    vehicleClass: 'car',
    profile: 'saloon',
    length: 4.25,
    width: 1.72,
    bodyHeight: 0.72,
    cabin: [1.7, 0.62, -0.1],
    wheelRadius: 0.32,
    wheelbase: 2.5,
    roof: 'flat',
    nose: 'medium',
    details: {
      chromeRatio: 0.55,
      exhaust: 'single',
      mudFlaps: true,
      notes: 'round lamps, dog-dish hubcaps, chrome side mirror',
    },
  }),
  defineModel('1965', {
    id: 'double-decker-bus-1965',
    label: '1965 Routemaster Double-Decker Bus',
    blurb:
      'Two decks of passengers behind a half-cab, with a rear open platform, a lit destination blind and a radiator grille full of chrome.',
    vehicleClass: 'bus',
    profile: 'bus',
    length: 8.4,
    width: 2.44,
    bodyHeight: 2.55,
    sections: 2,
    sectionSplit: 0.42,
    roof: 'double-deck',
    deckCount: 2,
    windowBands: 2,
    wheelRadius: 0.46,
    wheelbase: 5.1,
    rideHeight: 0.36,
    signature: true,
    parkable: false,
    details: {
      chromeRatio: 0.7,
      exhaust: 'single',
      spotlights: 2,
      mudFlaps: true,
      livery: '#c74c3c',
      notes: 'two decks, open rear platform, destination blind, chrome grille',
    },
    engine: { kind: 'diesel', rate: 0.68, gain: 0.8, note: 'underfloor diesel clatter' },
    horn: { rate: 0.92, gain: 0.8 },
    cruiseKph: 30,
    accel: 1.1,
    brake: 3.6,
  }),
  defineModel('1965', {
    id: 'panel-van-1965',
    label: '1965 Panel Delivery Van',
    blurb:
      'A chrome-fronted panel van with a ribbed body, flat windscreen pillars and a driver sitting over the front axle.',
    vehicleClass: 'truck',
    profile: 'van',
    length: 5.3,
    width: 2.0,
    bodyHeight: 1.6,
    cabin: [1.4, 0.62, 1.75],
    wheelRadius: 0.36,
    wheelbase: 3.0,
    roof: 'flat',
    nose: 'short',
    details: {
      exhaust: 'single',
      mudFlaps: true,
      livery: '#2f8f6f',
      notes: 'corrugated panels, twin round lamps, chrome bumper bars',
    },
    cruiseKph: 34,
  }),
];

const MODELS_1985: readonly VehicleModelSpec[] = [
  defineModel('1985', {
    id: 'boxy-sedan-1985',
    label: '1985 Fairmont Boxy Sedan',
    blurb:
      'Three boxes, four square lamps and a vinyl roof: the family sedan of the decade, with sealed-beam quads and a single tailpipe.',
    vehicleClass: 'car',
    profile: 'saloon',
    length: 4.75,
    width: 1.8,
    bodyHeight: 0.78,
    cabin: [1.9, 0.68, -0.05],
    wheelRadius: 0.34,
    wheelbase: 2.8,
    roof: 'flat',
    nose: 'short',
    signature: true,
    notable: true,
    details: {
      chromeRatio: 0.2,
      exhaust: 'single',
      quadHeadlamps: true,
      vinylRoof: true,
      mudFlaps: true,
      notes: 'vinyl roof, sealed-beam quads, black bumpers, chrome wheel trims',
    },
    engine: { rate: 1.0, gain: 0.64, note: 'fuel-injected four, hollow mid-range' },
  }),
  defineModel('1985', {
    id: 'yellow-cab-1985',
    label: '1985 Checker Yellow Cab',
    blurb:
      'A checker-striped hack with a lit roof sign, a partition behind the driver and a meter bolted to the dash. Never out of service.',
    vehicleClass: 'car',
    profile: 'saloon',
    length: 4.95,
    width: 1.86,
    bodyHeight: 0.82,
    cabin: [1.95, 0.7, 0.05],
    wheelRadius: 0.35,
    wheelbase: 2.9,
    roof: 'flat',
    nose: 'short',
    colour: 0xf2c14e,
    signature: true,
    details: {
      chromeRatio: 0.3,
      exhaust: 'single',
      taxiSign: true,
      ledStrip: false,
      mudFlaps: true,
      livery: '#1b1b1e',
      notes: 'yellow livery, lit roof sign, checker stripe, partition, dash meter',
    },
    horn: { rate: 1.14, gain: 0.84, tone: 'twin horn, constantly used' },
    parkChance: 0.18,
  }),
  defineModel('1985', {
    id: 'wedge-coupe-1985',
    label: '1985 Aero Wedge Sports Coupe',
    blurb:
      'A pop-up-lamp wedge with a spoiler, wide tyres and a low nose that barely clears the kerb.',
    vehicleClass: 'car',
    profile: 'coupe',
    length: 4.4,
    width: 1.82,
    bodyHeight: 0.62,
    cabin: [1.5, 0.56, -0.35],
    wheelRadius: 0.32,
    wheelbase: 2.55,
    roof: 'flat',
    nose: 'long',
    details: {
      chromeRatio: 0.15,
      exhaust: 'twin',
      mudFlaps: false,
      notes: 'pop-up lamps, rear spoiler, wide alloys, black window trim',
    },
    engine: { rate: 1.08, gain: 0.7 },
    cruiseKph: 54,
  }),
  defineModel('1985', {
    id: 'minivan-1985',
    label: '1985 Dustbuster Minivan',
    blurb:
      'A sliding-door people mover in matt plastic cladding, with a sloped nose, roof rails and three rows of seats.',
    vehicleClass: 'truck',
    profile: 'van',
    length: 5.0,
    width: 1.9,
    bodyHeight: 1.25,
    cabin: [1.8, 0.85, 0.85],
    wheelRadius: 0.34,
    wheelbase: 3.0,
    roof: 'split-level',
    nose: 'short',
    details: {
      exhaust: 'single',
      roofRack: true,
      ledStrip: false,
      mudFlaps: true,
      livery: '#141418',
      notes: 'sliding door, roof rails, plastic cladding, sloped nose',
    },
  }),
  defineModel('1985', {
    id: 'articulated-bus-1985',
    label: '1985 Articulated City Bus',
    blurb:
      'A bendy bus with a concertina joint, four big road wheels and a lit route number over the windscreen.',
    vehicleClass: 'bus',
    profile: 'bus',
    length: 9.6,
    width: 2.44,
    bodyHeight: 1.6,
    sections: 2,
    sectionSplit: 0.55,
    roof: 'arched',
    windowBands: 1,
    wheelRadius: 0.45,
    wheelbase: 6.0,
    rideHeight: 0.32,
    signature: true,
    parkable: false,
    details: {
      chromeRatio: 0.1,
      exhaust: 'side',
      ledStrip: false,
      mudFlaps: true,
      livery: '#1f6fd8',
      notes: 'concertina joint, lit route number, stripes, tinted windows',
    },
    engine: { kind: 'diesel', rate: 0.94, gain: 0.78 },
    horn: { rate: 1.02, gain: 0.76 },
    cruiseKph: 32,
    accel: 1.2,
    brake: 3.8,
  }),
];

const MODELS_2005: readonly VehicleModelSpec[] = [
  defineModel('2005', {
    id: 'hybrid-sedan-2005',
    label: '2005 Halcyon Hybrid Sedan',
    blurb:
      'A bubble-bodied hybrid with a battery badge on the boot, LED tail lamps and a petrol engine that cuts out at every red light.',
    vehicleClass: 'car',
    profile: 'saloon',
    length: 4.65,
    width: 1.82,
    bodyHeight: 0.76,
    cabin: [2.15, 0.68, -0.1],
    wheelRadius: 0.33,
    wheelbase: 2.7,
    roof: 'arched',
    nose: 'short',
    signature: true,
    notable: true,
    details: {
      chromeRatio: 0.12,
      exhaust: 'single',
      chargePort: 'none',
      ledStrip: true,
      mudFlaps: true,
      livery: '#4f7f6f',
      notes: 'hybrid badge, LED tail lamps, engine stop-start, alloy wheel covers',
    },
    engine: { rate: 1.12, gain: 0.46, note: 'quiet Atkinson four over an electric whine' },
  }),
  defineModel('2005', {
    id: 'suv-2005',
    label: '2005 Trailhead SUV',
    blurb:
      'A body-on-frame SUV with flared arches, roof rails, a low-range transfer case and a big square shoulder line.',
    vehicleClass: 'car',
    profile: 'suv',
    length: 4.95,
    width: 1.96,
    bodyHeight: 1.02,
    cabin: [2.4, 0.82, -0.15],
    wheelRadius: 0.4,
    wheelbase: 2.9,
    roof: 'arched',
    fenders: 'flared',
    nose: 'medium',
    signature: true,
    details: {
      chromeRatio: 0.14,
      exhaust: 'single',
      ledStrip: true,
      roofRack: true,
      mudFlaps: true,
      livery: '#b03a34',
      notes: 'roof rails, flared arches, tow hitch, LED tails, side steps',
    },
    cruiseKph: 42,
    accel: 2.0,
  }),
  defineModel('2005', {
    id: 'city-bus-2005',
    label: '2005 Low-Floor City Bus',
    blurb:
      'A kneeling low-floor bus with a lit route sign, tinted windows and a bendy joint mid-way down the body.',
    vehicleClass: 'bus',
    profile: 'bus',
    length: 9.4,
    width: 2.44,
    bodyHeight: 1.7,
    sections: 2,
    sectionSplit: 0.55,
    roof: 'arched',
    windowBands: 1,
    wheelRadius: 0.43,
    wheelbase: 5.9,
    rideHeight: 0.3,
    signature: true,
    parkable: false,
    details: {
      chromeRatio: 0.08,
      exhaust: 'single',
      ledStrip: true,
      mudFlaps: true,
      livery: '#2f5fa8',
      notes: 'low floor, lit route sign, tinted glass, kneeling suspension',
    },
    engine: { kind: 'diesel', rate: 1.05, gain: 0.72 },
    cruiseKph: 34,
    accel: 1.3,
    brake: 4.0,
  }),
  defineModel('2005', {
    id: 'parcel-van-2005',
    label: '2005 Parcel Delivery Van',
    blurb:
      'A high-roof parcel van in corporate livery with a rear roller shutter, reversing sensors and a sliding cab door.',
    vehicleClass: 'truck',
    profile: 'van',
    length: 5.8,
    width: 2.05,
    bodyHeight: 1.7,
    cabin: [1.5, 0.7, 1.95],
    wheelRadius: 0.37,
    wheelbase: 3.4,
    roof: 'arched',
    nose: 'short',
    details: {
      exhaust: 'single',
      ledStrip: true,
      mudFlaps: true,
      livery: '#27313c',
      notes: 'corporate livery, roller shutter, sensors, high roof',
    },
    cruiseKph: 38,
  }),
];

const MODELS_2025: readonly VehicleModelSpec[] = [
  defineModel('2025', {
    id: 'ev-crossover-2025',
    label: '2025 Volta EV Crossover',
    blurb:
      'A quiet electric crossover with flush handles, a charge flap on the flank, a full-width light bar and a skateboard battery under the floor.',
    vehicleClass: 'car',
    profile: 'suv',
    length: 4.6,
    width: 1.9,
    bodyHeight: 0.86,
    cabin: [2.25, 0.74, -0.1],
    wheelRadius: 0.35,
    wheelbase: 2.8,
    roof: 'domed',
    fenders: 'flared',
    nose: 'blunt',
    signature: true,
    notable: true,
    details: {
      chromeRatio: 0.05,
      exhaust: 'none',
      chargePort: 'flank',
      ledStrip: true,
      roofSensor: true,
      mudFlaps: false,
      livery: '#4f7f6f',
      notes: 'charge flap, light bar, flush handles, aero wheels, pedestrian warning tone',
    },
    engine: {
      kind: 'electric',
      rate: 1.5,
      gain: 0.3,
      note: 'inverter whine, near silent at a crawl',
    },
    horn: { rate: 1.2, gain: 0.56, tone: 'synthetic chirp' },
  }),
  defineModel('2025', {
    id: 'autonomous-pod-2025',
    label: '2025 Wayfare Autonomous Pod',
    blurb:
      'A driverless shuttle with a sensor crown, wraparound glazing, a nose charge port and no steering wheel at all. It stops for anything.',
    vehicleClass: 'bus',
    profile: 'pod',
    length: 3.9,
    width: 2.0,
    bodyHeight: 1.5,
    cabin: [0, 0, 0],
    wheelRadius: 0.3,
    wheelbase: 2.4,
    sections: 1,
    roof: 'domed',
    nose: 'blunt',
    windowBands: 1,
    rideHeight: 0.24,
    signature: true,
    notable: false,
    parkable: false,
    details: {
      chromeRatio: 0.04,
      exhaust: 'none',
      chargePort: 'nose',
      ledStrip: true,
      roofSensor: true,
      mudFlaps: false,
      livery: '#3a6fd8',
      notes: 'sensor crown, wraparound glazing, rotor-free hub motors, nose charge port',
    },
    engine: { kind: 'electric', rate: 1.62, gain: 0.26, note: 'near-silent pod hum' },
    horn: { rate: 1.3, gain: 0.5, tone: 'polite two-note chime' },
    cruiseKph: 32,
    accel: 2.2,
    brake: 5.0,
  }),
  defineModel('2025', {
    id: 'electric-bus-2025',
    label: '2025 Volta Electric Transit Bus',
    blurb:
      'A battery-electric articulated bus: pantograph-free, charge flaps on both flanks, a lit route band and almost no sound at all.',
    vehicleClass: 'bus',
    profile: 'bus',
    length: 9.2,
    width: 2.44,
    bodyHeight: 1.7,
    sections: 2,
    sectionSplit: 0.55,
    roof: 'arched',
    windowBands: 1,
    wheelRadius: 0.42,
    wheelbase: 5.8,
    rideHeight: 0.3,
    signature: true,
    parkable: false,
    details: {
      chromeRatio: 0.04,
      exhaust: 'none',
      chargePort: 'flank',
      pantograph: true,
      ledStrip: true,
      roofSensor: true,
      mudFlaps: false,
      livery: '#2a2f36',
      notes: 'charge flaps, rooftop pantograph rails, lit route band, flat floor',
    },
    engine: { kind: 'electric', rate: 1.38, gain: 0.3 },
    horn: { rate: 1.14, gain: 0.58 },
    cruiseKph: 36,
    accel: 1.5,
    brake: 4.4,
  }),
];

/** Every modelled vehicle, keyed by the year it belongs to. */
export const ERA_VEHICLE_MODELS: Readonly<Record<EraId, readonly VehicleModelSpec[]>> =
  Object.freeze({
    '1945': Object.freeze(MODELS_1945),
    '1965': Object.freeze(MODELS_1965),
    '1985': Object.freeze(MODELS_1985),
    '2005': Object.freeze(MODELS_2005),
    '2025': Object.freeze(MODELS_2025),
  });

/** The models authored for one era (never empty). */
export function eraVehicleModels(era: EraId): readonly VehicleModelSpec[] {
  return ERA_VEHICLE_MODELS[era];
}

/** Model lookup by id across every era. */
export function vehicleModel(id: string): VehicleModelSpec | undefined {
  for (const models of Object.values(ERA_VEHICLE_MODELS)) {
    const match = models.find((model) => model.id === id);
    if (match) return match;
  }
  return undefined;
}

/* ------------------------------------------------------------------------- *
 * Fleet plan
 * ------------------------------------------------------------------------- */

export interface FleetEntry {
  readonly spec: VehicleModelSpec;
  readonly count: number;
}

/** One year's vehicle roster: what the traffic system instantiates. */
export interface EraFleetPlan {
  readonly era: EraId;
  readonly size: number;
  readonly entries: readonly FleetEntry[];
  /** Model of the era's notable vehicle (registered for inspection). */
  readonly notable: VehicleModelSpec;
  /** Class mix the fleet was allocated from (the era descriptor's own `mix`). */
  readonly mix: EraVehicleMix;
  readonly style: string;
  /** Lamp level implied by the era's lighting mood (`0` day, `1` night). */
  readonly lightLevel: number;
}

/**
 * How lit a year's lamps should be. Headlights and tail lamps glow strongly in
 * the 1985 neon dusk and stay as daytime running lights in the daylight eras.
 */
export function eraLightLevel(era: EraId): number {
  const { sunElevationDeg, sunIntensity } = getEraDescriptor(era).lighting;
  const dusk = clamp01((20 - sunElevationDeg) / 22);
  const dim = clamp01(1.2 - sunIntensity);
  return clamp01(Math.max(dusk, dim * 0.5));
}

/** Largest-remainder allocation of `seats` across `weights`, minimum one each. */
function allocateSeats(weights: readonly number[], seats: number): number[] {
  const count = weights.length;
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  const base = weights.map(() => 1);
  let used = count;
  const remaining = Math.max(0, seats - used);
  if (remaining > 0) {
    const shares = weights.map((weight) => (total > 0 ? (Math.max(0, weight) / total) * remaining : 0));
    const floors = shares.map((share) => Math.floor(share));
    used += floors.reduce((sum, value) => sum + value, 0);
    for (let index = 0; index < count; index += 1) base[index] += floors[index] as number;

    let leftover = seats - used;
    const order = shares
      .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
      .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
    for (const candidate of order) {
      if (leftover <= 0) break;
      base[candidate.index] += 1;
      leftover -= 1;
    }
  }
  return base;
}

/** Spreads `seats` over models of one class, signature models first. */
function spreadAcrossModels(models: readonly VehicleModelSpec[], seats: number): number[] {
  const counts = models.map(() => 0);
  if (seats <= 0) return counts;

  const priority = models
    .map((model, index) => ({ index, signature: model.signature ? 0 : 1, index2: index }))
    .sort((left, right) => left.signature - right.signature || left.index2 - right.index2);

  let remaining = seats;
  for (const entry of priority) {
    if (remaining <= 0) break;
    counts[entry.index] += 1;
    remaining -= 1;
  }
  // Remaining seats go round-robin so a class with two models keeps both in view.
  let cursor = 0;
  while (remaining > 0) {
    counts[cursor % models.length] += 1;
    cursor += 1;
    remaining -= 1;
  }
  return counts;
}

/**
 * Resolves one era's fleet from its descriptor: the descriptor's `mix` sizes the
 * classes, the authored catalogue supplies the models, signature models are
 * guaranteed a seat and the notable model is always present.
 *
 * A mix can mention classes this task does not model yet (`bicycle` cargo bikes,
 * for example): their share is redistributed across the modelled classes by the
 * renormalised allocation, so a year never loses traffic because of an
 * unmodelled road user.
 */
export function buildEraFleetPlan(era: EraId, size: number = DEFAULT_FLEET_SIZE): EraFleetPlan {
  const models = eraVehicleModels(era);
  const descriptor = getEraDescriptor(era);
  const mix = descriptor.vehicles.mix;
  const seats = Math.max(MIN_FLEET_SIZE, Math.min(MAX_FLEET_SIZE, Math.round(size)));

  const classes = models
    .map((model) => model.vehicleClass)
    .filter((value, index, list) => list.indexOf(value) === index);

  const weights = classes.map((vehicleClass) => mix[vehicleClass] ?? 0);
  const allocation = allocateSeats(weights, seats);

  const entries: FleetEntry[] = [];
  classes.forEach((vehicleClass, index) => {
    const classModels = models.filter((model) => model.vehicleClass === vehicleClass);
    const counts = spreadAcrossModels(classModels, allocation[index] as number);
    classModels.forEach((spec, modelIndex) => {
      const count = counts[modelIndex] as number;
      if (count > 0) entries.push({ spec, count });
    });
  });

  const notable = models.find((model) => model.notable) ?? (models[0] as VehicleModelSpec);
  if (!entries.some((entry) => entry.spec.id === notable.id)) {
    const donor = entries.find((entry) => entry.count > 1) ?? entries[0];
    if (donor && donor.count > 1) {
      const replacement: FleetEntry = { spec: donor.spec, count: donor.count - 1 };
      const index = entries.indexOf(donor);
      entries.splice(index, 1, replacement, { spec: notable, count: 1 });
    } else {
      entries.push({ spec: notable, count: 1 });
    }
  }

  // Round-robin across the roster so consecutive spawns always differ.
  const ordered: FleetEntry[] = [];
  const remaining = entries.map((entry) => ({ spec: entry.spec, count: entry.count }));
  let placed = true;
  while (placed) {
    placed = false;
    for (const entry of remaining) {
      if (entry.count <= 0) continue;
      ordered.push({ spec: entry.spec, count: 1 });
      entry.count -= 1;
      placed = true;
    }
  }

  return Object.freeze({
    era,
    size: ordered.length,
    entries: Object.freeze(ordered),
    notable,
    mix,
    style: descriptor.vehicles.style,
    lightLevel: eraLightLevel(era),
  });
}

/* ------------------------------------------------------------------------- *
 * Materials
 * ------------------------------------------------------------------------- */

/** Lamp materials a built vehicle swaps between; all shared per era. */
export interface VehicleLampMaterials {
  readonly head: { readonly lit: THREE.Material; readonly dim: THREE.Material };
  readonly tail: { readonly lit: THREE.Material; readonly dim: THREE.Material };
  readonly brake: { readonly lit: THREE.Material; readonly dim: THREE.Material };
  readonly indicator: { readonly lit: THREE.Material; readonly dim: THREE.Material };
  readonly beacon: { readonly lit: THREE.Material; readonly dim: THREE.Material };
}

/** The material set one era's whole fleet draws from. */
export interface EraVehicleMaterials {
  readonly era: EraId;
  readonly lightLevel: number;
  readonly lamps: VehicleLampMaterials;
  readonly chrome: THREE.MeshStandardMaterial;
  readonly dark: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshStandardMaterial;
  readonly tire: THREE.MeshStandardMaterial;
  readonly hub: THREE.MeshStandardMaterial;
  readonly interior: THREE.MeshStandardMaterial;
  readonly rail: THREE.MeshStandardMaterial;
  /** Paint per body colour hex, created on demand. */
  body(colour: number): THREE.MeshStandardMaterial;
  /** Livery / accent paint per colour hex, created on demand. */
  accent(colour: number): THREE.MeshStandardMaterial;
  /** Library keys this set created, for teardown. */
  keys(): readonly string[];
}

function hexString(value: number): string {
  return `#${new THREE.Color(value).getHexString()}`;
}

function requestKey(request: MaterialRequest): string {
  return request.name ?? `chrono-${request.surface}`;
}

function buildEraMaterials(
  library: MaterialLibrary,
  era: EraId,
  lightLevel: number,
): EraVehicleMaterials {
  const keys = new Set<string>();
  const bodies = new Map<number, THREE.MeshStandardMaterial>();
  const accents = new Map<number, THREE.MeshStandardMaterial>();

  const make = (request: MaterialRequest): THREE.MeshStandardMaterial => {
    const material = library.get(request);
    keys.add(material.userData.chronoKey as string);
    keys.add(requestKey(request));
    return material;
  };

  const paint = (
    cache: Map<number, THREE.MeshStandardMaterial>,
    colour: number,
    role: string,
    metalness: number,
    roughness: number,
  ): THREE.MeshStandardMaterial => {
    const cached = cache.get(colour);
    if (cached) return cached;
    const material = make({
      surface: 'corrugatedMetal',
      palette: { base: hexString(colour), accent: hexString(colour), highlight: '#ffffff' },
      roughness,
      metalness,
      size: 256,
      wear: 0.32,
      name: `chrono-vehicle-${role}-${era}-${colour.toString(16)}`,
    });
    cache.set(colour, material);
    return material;
  };

  const lamp = (
    colour: number,
    emissive: number,
    intensity: number,
    name: string,
  ): THREE.MeshStandardMaterial =>
    make({
      surface: 'neon',
      palette: { base: hexString(colour), accent: hexString(emissive), emissive: hexString(emissive) },
      emissive: hexString(emissive),
      emissiveIntensity: intensity,
      roughness: 0.25,
      metalness: 0.1,
      size: 256,
      wear: 0,
      name: `chrono-vehicle-${name}-${era}`,
    });

  const glow = 0.35 + 1.65 * lightLevel;
  const chrome = make({
    surface: 'corrugatedMetal',
    palette: { base: '#d5dae1', accent: '#b4bcc6', highlight: '#ffffff' },
    metalness: 0.95,
    roughness: 0.12,
    size: 256,
    wear: 0.12,
    name: `chrono-vehicle-chrome-${era}`,
  });
  const dark = make({
    surface: 'corrugatedMetal',
    palette: { base: '#26282c', accent: '#17181b', highlight: '#4a4d53' },
    metalness: 0.35,
    roughness: 0.55,
    size: 256,
    wear: 0.3,
    name: `chrono-vehicle-plastic-${era}`,
  });
  const glass = make({
    surface: 'glassCurtainWall',
    palette: { base: '#101b26', accent: '#1d2c3a', highlight: '#8fb4d6' },
    metalness: 0.2,
    roughness: 0.08,
    opacity: 0.74,
    size: 256,
    wear: 0.18,
    name: `chrono-vehicle-glass-${era}`,
  });
  const tire = make({
    surface: 'asphalt',
    palette: { base: '#191b1d', accent: '#232629', highlight: '#3b3f43' },
    metalness: 0,
    roughness: 0.95,
    size: 256,
    wear: 0.4,
    name: `chrono-vehicle-tire-${era}`,
  });
  const hub = make({
    surface: 'corrugatedMetal',
    palette: { base: '#c9ced6', accent: '#8f979f', highlight: '#ffffff' },
    metalness: 0.85,
    roughness: 0.22,
    size: 256,
    wear: 0.25,
    name: `chrono-vehicle-hub-${era}`,
  });
  const interior = make({
    surface: 'fabric',
    palette: { base: '#2b2823', accent: '#43372c', highlight: '#6b5a48' },
    metalness: 0,
    roughness: 0.96,
    size: 256,
    wear: 0.45,
    name: `chrono-vehicle-interior-${era}`,
  });
  const rail = make({
    surface: 'corrugatedMetal',
    palette: { base: '#9aa1a9', accent: '#6f767d', highlight: '#eef2f6' },
    metalness: 0.9,
    roughness: 0.2,
    size: 256,
    wear: 0.35,
    name: `chrono-vehicle-rail-${era}`,
  });

  const lamps: VehicleLampMaterials = Object.freeze({
    head: Object.freeze({
      lit: lamp(0xfff6dd, 0xfff2c4, glow, 'head-lamp'),
      dim: lamp(0xfff6dd, 0xfff2c4, 0.1, 'head-lamp-dim'),
    }),
    tail: Object.freeze({
      lit: lamp(0xff4a33, 0xff2b1a, 0.55 + 1.2 * lightLevel, 'tail-lamp'),
      dim: lamp(0xd43a2a, 0xff2b1a, 0.12, 'tail-lamp-dim'),
    }),
    brake: Object.freeze({
      lit: lamp(0xff5a3d, 0xff3312, 2.1, 'brake-lamp'),
      dim: lamp(0xd43a2a, 0xff2b1a, 0.12, 'tail-lamp-dim'),
    }),
    indicator: Object.freeze({
      lit: lamp(0xffb02e, 0xff9a12, 1.7, 'indicator-lamp'),
      dim: lamp(0xb3762a, 0xff9a12, 0.08, 'indicator-lamp-dim'),
    }),
    beacon: Object.freeze({
      lit: lamp(0xf7d774, 0xffd977, 1.5, 'roof-sign'),
      dim: lamp(0x8a7c46, 0xffd977, 0.2, 'roof-sign-dim'),
    }),
  });

  return {
    era,
    lightLevel,
    lamps,
    chrome,
    dark,
    glass,
    tire,
    hub,
    interior,
    rail,
    body: (colour: number) => paint(bodies, colour, 'paint', 0.28, 0.34),
    accent: (colour: number) => paint(accents, colour, 'livery', 0.2, 0.5),
    keys: () => [...keys],
  };
}

/* ------------------------------------------------------------------------- *
 * Geometry
 * ------------------------------------------------------------------------- */

/**
 * Four shared blanks back every vehicle: a unit box, a unit cylinder, a
 * pre-rotated wheel blank (disc in the local YZ plane, axle along X) and a unit
 * sphere. Parts are scaled into place, so an era swap allocates no geometry.
 */
interface FactoryGeometries {
  readonly box: THREE.BoxGeometry;
  readonly cylinder: THREE.CylinderGeometry;
  readonly wheel: THREE.CylinderGeometry;
  readonly sphere: THREE.SphereGeometry;
  dispose(): void;
}

function createGeometries(): FactoryGeometries {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1);
  cylinder.rotateZ(Math.PI / 2);
  const wheel = new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1);
  wheel.rotateZ(Math.PI / 2);
  const sphere = new THREE.SphereGeometry(0.5, 10, 7);
  return {
    box,
    cylinder,
    wheel,
    sphere,
    dispose() {
      box.dispose();
      cylinder.dispose();
      wheel.dispose();
      sphere.dispose();
    },
  };
}

/* ------------------------------------------------------------------------- *
 * Built vehicles
 * ------------------------------------------------------------------------- */

export type VehicleLampKind = 'head' | 'tail' | 'brake' | 'indicator' | 'beacon';

export interface VehicleLamp {
  readonly mesh: THREE.Mesh;
  readonly kind: VehicleLampKind;
  readonly lit: THREE.Material;
  readonly dim: THREE.Material;
}

export interface VehicleWheel {
  /** Node the system spins about its local X axis. */
  readonly spinner: THREE.Group;
  readonly radius: number;
  /** Outer side sign: `+1` on the vehicle's left, `-1` on its right. */
  readonly side: 1 | -1;
  readonly axleOffset: number;
}

/** One body section of a vehicle: one group, one longitudinal path offset. */
export interface VehicleSection {
  readonly node: THREE.Group;
  /** Metres ahead of the vehicle's reference point along the lane spline. */
  readonly offset: number;
}

export interface VehicleBuild {
  readonly spec: VehicleModelSpec;
  readonly colour: number;
  readonly root: THREE.Group;
  readonly sections: readonly VehicleSection[];
  readonly wheels: readonly VehicleWheel[];
  readonly lamps: readonly VehicleLamp[];
  readonly materials: EraVehicleMaterials;
  /** Human-readable detail inventory, surfaced in snapshots and tests. */
  readonly details: readonly string[];
  readonly meshCount: number;
}

/* ------------------------------------------------------------------------- *
 * Assembly
 * ------------------------------------------------------------------------- */

interface AssemblyContext {
  readonly geometries: FactoryGeometries;
  readonly materials: EraVehicleMaterials;
  readonly spec: VehicleModelSpec;
  /** Resolved body paint for this instance. */
  readonly colour: number;
  readonly details: Set<string>;
  meshCount: number;
  readonly wheels: VehicleWheel[];
  readonly lamps: VehicleLamp[];
}

function addMesh(
  context: AssemblyContext,
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  rotation?: readonly [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(size[0], size[1], size[2]);
  mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  // Details are cheap to draw but costly to shadow: only the panels that matter
  // for the silhouette opt in via `castShadow`.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  context.meshCount += 1;
  return mesh;
}

/** Marks a mesh as a shadow caster (body panels and greenhouses only). */
function castShadow(mesh: THREE.Mesh): THREE.Mesh {
  mesh.castShadow = true;
  return mesh;
}

function addBox(
  context: AssemblyContext,
  parent: THREE.Object3D,
  size: readonly [number, number, number],
  material: THREE.Material,
  position: readonly [number, number, number],
  rotation?: readonly [number, number, number],
): THREE.Mesh {
  return addMesh(context, parent, context.geometries.box, material, size, position, rotation);
}

function addCylinder(
  context: AssemblyContext,
  parent: THREE.Object3D,
  size: readonly [number, number, number],
  material: THREE.Material,
  position: readonly [number, number, number],
  rotation?: readonly [number, number, number],
): THREE.Mesh {
  return addMesh(context, parent, context.geometries.cylinder, material, size, position, rotation);
}

function addLamp(
  context: AssemblyContext,
  parent: THREE.Object3D,
  kind: VehicleLampKind,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  rotation?: readonly [number, number, number],
  useSphere = false,
): VehicleLamp {
  const pair = context.materials.lamps[kind];
  const mesh = addMesh(
    context,
    parent,
    useSphere ? context.geometries.sphere : context.geometries.box,
    pair.dim,
    size,
    position,
    rotation,
  );
  const lamp: VehicleLamp = { mesh, kind, lit: pair.lit, dim: pair.dim };
  context.lamps.push(lamp);
  context.details.add(`lamp:${kind}`);
  return lamp;
}

function addWheel(
  context: AssemblyContext,
  parent: THREE.Object3D,
  side: 1 | -1,
  axleOffset: number,
  lateral: number,
  rail = false,
): void {
  const plan = context.spec.plan;
  const materials = context.materials;
  const radius = plan.wheelRadius;
  const width = rail ? 0.16 : Math.max(0.22, radius * 0.62);
  const spinner = new THREE.Group();
  spinner.position.set(lateral, radius, axleOffset);
  parent.add(spinner);

  addMesh(
    context,
    spinner,
    context.geometries.wheel,
    rail ? materials.rail : materials.tire,
    [width, radius, radius],
    [0, 0, 0],
  );
  // Hub cap and a radial marker: the marker is what makes the spin readable.
  addMesh(
    context,
    spinner,
    context.geometries.wheel,
    materials.hub,
    [width * 1.08, radius * 0.5, radius * 0.5],
    [0, 0, 0],
  );
  addBox(
    context,
    spinner,
    [width * 1.2, radius * 0.34, 0.05],
    materials.hub,
    [0, radius * 0.42, 0],
  );
  if (context.spec.details.wireWheels) {
    for (let spoke = 0; spoke < 6; spoke += 1) {
      const angle = (spoke / 6) * Math.PI;
      addBox(
        context,
        spinner,
        [width * 1.12, radius * 0.72, 0.028],
        materials.hub,
        [0, 0, 0],
        [angle, 0, 0],
      );
    }
    context.details.add('wire-wheels');
  }
  context.wheels.push({ spinner, radius, side, axleOffset });
}

function addExhaust(context: AssemblyContext, parent: THREE.Object3D, halfLength: number): void {
  const plan = context.spec.plan;
  const kind = context.spec.details.exhaust;
  if (kind === 'none') return;
  const { materials } = context;
  const y = plan.rideHeight + 0.1;
  const halfW = plan.width / 2;

  if (kind === 'stack') {
    addCylinder(context, parent, [0.09, 1.5, 0.09], materials.dark, [halfW - 0.22, plan.rideHeight + 1.1, -halfLength + 0.5]);
    context.details.add('exhaust:stack');
    return;
  }
  if (kind === 'side') {
    addCylinder(context, parent, [0.1, 0.4, 0.1], materials.dark, [halfW - 0.05, y, -0.4]);
    context.details.add('exhaust:side');
    return;
  }
  addCylinder(context, parent, [0.1, 0.42, 0.1], materials.chrome, [-halfW + 0.36, y, -halfLength + 0.1]);
  context.details.add('exhaust:single');
  if (kind === 'twin') {
    addCylinder(context, parent, [0.1, 0.42, 0.1], materials.chrome, [halfW - 0.36, y, -halfLength + 0.1]);
    context.details.add('exhaust:twin');
  }
}

function addChargePort(context: AssemblyContext, parent: THREE.Object3D, halfLength: number): void {
  const port = context.spec.details.chargePort;
  if (port === 'none') return;
  const { materials } = context;
  const halfW = context.spec.plan.width / 2;
  if (port === 'flank') {
    addBox(context, parent, [0.06, 0.2, 0.26], materials.accent(0x3f8f7f), [halfW + 0.005, context.spec.plan.rideHeight + 0.55, -0.9]);
    addLamp(context, parent, 'beacon', [0.02, 0.06, 0.06], [halfW + 0.04, context.spec.plan.rideHeight + 0.55, -1.02]);
    context.details.add('charge-port:flank');
    return;
  }
  addBox(context, parent, [0.26, 0.2, 0.06], materials.accent(0x3f8f7f), [0, context.spec.plan.rideHeight + 0.5, halfLength + 0.005]);
  context.details.add('charge-port:nose');
}

function addLamps(
  context: AssemblyContext,
  parent: THREE.Object3D,
  halfLength: number,
  isFront: boolean,
): void {
  const plan = context.spec.plan;
  const details = context.spec.details;
  const { materials } = context;
  const halfW = plan.width / 2;
  const headY = plan.rideHeight + plan.bodyHeight * 0.6;
  const lampRadius = Math.min(0.2, plan.width * 0.1);
  const headX = halfW - plan.width * 0.16;

  if (isFront) {
    const headPositions: number[] = details.quadHeadlamps
      ? [headX, headX - plan.width * 0.13, -headX, -headX + plan.width * 0.13]
      : [headX, -headX];
    for (const x of headPositions) {
      addLamp(
        context,
        parent,
        'head',
        [lampRadius * 1.2, lampRadius * 1.2, 0.08],
        [x, headY, halfLength + 0.01],
      );
    }
    if (details.quadHeadlamps) context.details.add('quad-headlamps');

    // Auxiliary spotlights on the bumper: one centre lamp on the streetcar,
    // driving lamps on the 1965 muscle cars.
    for (let index = 0; index < details.spotlights; index += 1) {
      const spread = details.spotlights === 1 ? 0 : plan.width * 0.24;
      const x = details.spotlights === 1 ? 0 : index === 0 ? spread : -spread;
      addLamp(
        context,
        parent,
        'head',
        [lampRadius * 1.5, lampRadius * 1.5, 0.1],
        [x, plan.rideHeight + 0.24, halfLength + 0.04],
        undefined,
        true,
      );
      context.details.add('spotlight');
    }
  }

  // Every section carries its own rear lamps and indicators.
  const tailWidth = Math.max(0.14, plan.width * 0.22);
  const tailX = halfW - tailWidth / 2 - 0.06;
  for (const x of [tailX, -tailX]) {
    addLamp(context, parent, 'tail', [tailWidth, 0.16, 0.07], [x, headY - 0.06, -halfLength - 0.01]);
    addLamp(context, parent, 'brake', [tailWidth * 0.7, 0.1, 0.06], [x, headY - 0.24, -halfLength - 0.01]);
    addLamp(
      context,
      parent,
      'indicator',
      [0.1, 0.1, 0.06],
      [x > 0 ? halfW - 0.04 : -halfW + 0.04, headY, -halfLength + 0.16],
    );
  }
  if (details.ledStrip && isFront) {
    addLamp(context, parent, 'tail', [plan.width * 0.92, 0.06, 0.05], [0, headY + 0.02, -halfLength - 0.02]);
    context.details.add('led-strip');
  }
  if (!details.tailFins) return;

  addBox(
    context,
    parent,
    [0.14, 0.34, 0.9],
    materials.body(context.colour),
    [tailX, plan.rideHeight + plan.bodyHeight + 0.12, -halfLength + 0.4],
    [0.24, 0, 0],
  );
  addBox(
    context,
    parent,
    [0.14, 0.34, 0.9],
    materials.body(context.colour),
    [-tailX, plan.rideHeight + plan.bodyHeight + 0.12, -halfLength + 0.4],
    [0.24, 0, 0],
  );
  context.details.add('tail-fins');
}

function addCabin(context: AssemblyContext, parent: THREE.Object3D, halfLength: number): void {
  const plan = context.spec.plan;
  const details = context.spec.details;
  const { materials } = context;
  const halfW = plan.width / 2;
  const bodyTop = plan.rideHeight + plan.bodyHeight;

  if (plan.profile === 'pod') {
    // Wraparound glazing over a rounded shell, no stepped cabin at all.
    addMesh(
      context,
      parent,
      context.geometries.sphere,
      materials.glass,
      [plan.width * 1.02, plan.bodyHeight * 1.1, plan.length * 0.96],
      [0, bodyTop - plan.bodyHeight * 0.18, 0],
    );
    addBox(context, parent, [plan.width * 0.98, plan.bodyHeight * 0.5, plan.length * 0.9], materials.body(context.colour), [0, bodyTop + plan.bodyHeight * 0.16, 0]);
    context.details.add('wraparound-glazing');
  } else if (plan.profile === 'bus' || plan.profile === 'tram') {
    const bandStep = plan.deckCount === 2 ? 1.35 : plan.bodyHeight * 0.4;
    for (let band = 0; band < plan.windowBands; band += 1) {
      const y = plan.rideHeight + plan.bodyHeight * 0.3 + band * bandStep;
      const glassBand = addBox(
        context,
        parent,
        [plan.width * 1.005, 0.62, plan.length * 0.9],
        materials.glass,
        [0, y, 0],
      );
      castShadow(glassBand);
    }
    // Doors on the kerb side plus a lit destination board over the windscreen.
    const doorHeight = plan.bodyHeight * 0.8;
    const doorY = plan.rideHeight + doorHeight / 2 + 0.08;
    addBox(context, parent, [0.05, doorHeight, 0.9], materials.glass, [halfW + 0.01, doorY, plan.length * 0.22]);
    addBox(context, parent, [0.05, doorHeight, 0.9], materials.glass, [halfW + 0.01, doorY, -plan.length * 0.18]);
    addLamp(
      context,
      parent,
      'beacon',
      [plan.width * 0.62, 0.24, 0.06],
      [0, bodyTop + 0.18, halfLength + 0.02],
    );
    context.details.add('destination-board');
    context.details.add('doors');
  } else {
    const cabin = Math.max(0.6, plan.cabinLength);
    const cabinY = bodyTop + plan.cabinHeight / 2;
    // Greenhouse: glass band with a painted roof panel and pillars.
    castShadow(
      addBox(
        context,
        parent,
        [plan.width * 0.92, plan.cabinHeight, cabin],
        materials.glass,
        [0, cabinY, plan.cabinOffset],
      ),
    );
    castShadow(
      addBox(
        context,
        parent,
        [plan.width * 0.9, plan.cabinHeight * (plan.roof === 'domed' ? 0.46 : 0.3), cabin * 0.98],
        details.vinylRoof ? materials.accent(0x22201f) : materials.body(context.colour),
        [0, bodyTop + plan.cabinHeight * 0.86, plan.cabinOffset],
      ),
    );
    // Windscreen and backlight.
    addBox(context, parent, [plan.width * 0.86, plan.cabinHeight * 0.78, 0.06], materials.glass, [0, cabinY, plan.cabinOffset + cabin / 2]);
    addBox(context, parent, [plan.width * 0.86, plan.cabinHeight * 0.7, 0.06], materials.glass, [0, cabinY, plan.cabinOffset - cabin / 2]);
    // Doors and handles.
    for (const side of [1, -1] as const) {
      addBox(context, parent, [0.05, plan.cabinHeight * 0.9, cabin * 0.62], materials.body(context.colour), [side * (halfW * 0.94), cabinY, plan.cabinOffset + cabin * 0.05]);
      addBox(context, parent, [0.06, 0.05, 0.22], materials.chrome, [side * (halfW * 0.99), cabinY - 0.12, plan.cabinOffset + cabin * 0.24]);
      addBox(context, parent, [0.06, 0.05, 0.22], materials.chrome, [side * (halfW * 0.99), cabinY - 0.12, plan.cabinOffset - cabin * 0.24]);
      // Door mirrors.
      addBox(context, parent, [0.16, 0.1, 0.06], materials.dark, [side * (halfW + 0.1), cabinY + plan.cabinHeight * 0.2, plan.cabinOffset + cabin * 0.42]);
    }
    context.details.add('doors');
    context.details.add('mirrors');
    if (details.vinylRoof) context.details.add('vinyl-roof');
  }

  if (details.roofRack) {
    addBox(context, parent, [plan.width * 0.8, 0.06, 0.08], materials.dark, [0, bodyTop + plan.cabinHeight + 0.14, plan.cabinOffset + 0.55]);
    addBox(context, parent, [plan.width * 0.8, 0.06, 0.08], materials.dark, [0, bodyTop + plan.cabinHeight + 0.14, plan.cabinOffset - 0.55]);
    addBox(context, parent, [0.06, 0.06, 1.4], materials.dark, [plan.width * 0.34, bodyTop + plan.cabinHeight + 0.14, plan.cabinOffset]);
    addBox(context, parent, [0.06, 0.06, 1.4], materials.dark, [-plan.width * 0.34, bodyTop + plan.cabinHeight + 0.14, plan.cabinOffset]);
    context.details.add('roof-rack');
  }
  if (plan.roof === 'domed') {
    addMesh(
      context,
      parent,
      context.geometries.sphere,
      materials.body(context.colour),
      [plan.width * 0.86, plan.bodyHeight * 0.34, Math.max(1.2, plan.cabinLength || plan.length * 0.6)],
      [0, bodyTop + plan.cabinHeight + 0.02, plan.cabinOffset],
    );
    context.details.add('domed-roof');
  }
  if (details.roofSensor) {
    addCylinder(context, parent, [0.2, 0.14, 0.2], materials.dark, [0, bodyTop + plan.cabinHeight + (plan.profile === 'pod' ? plan.bodyHeight * 0.42 : 0.2), plan.cabinOffset - 0.3]);
    addMesh(context, parent, context.geometries.sphere, materials.glass, [0.34, 0.24, 0.34], [0, bodyTop + plan.cabinHeight + (plan.profile === 'pod' ? plan.bodyHeight * 0.55 : 0.3), plan.cabinOffset - 0.3]);
    context.details.add('sensor-crown');
  }
  if (details.taxiSign) {
    addLamp(context, parent, 'beacon', [0.62, 0.18, 0.26], [0, bodyTop + plan.cabinHeight + 0.12, plan.cabinOffset + 0.2]);
    context.details.add('roof-sign');
  }
}

function addBody(
  context: AssemblyContext,
  parent: THREE.Object3D,
  halfLength: number,
  front: boolean,
  axles: readonly number[],
): void {
  const plan = context.spec.plan;
  const details = context.spec.details;
  const { materials } = context;
  const halfW = plan.width / 2;
  const sill = plan.rideHeight;
  const bodyLength = halfLength * 2;
  const paint = materials.body(context.colour);

  addBox(context, parent, [plan.width, plan.bodyHeight, bodyLength], paint, [0, sill + plan.bodyHeight / 2, 0]);
  const shell = parent.children[parent.children.length - 1] as THREE.Mesh;
  castShadow(shell);
  addBox(context, parent, [plan.width * 0.94, 0.16, bodyLength * 0.98], materials.dark, [0, sill + 0.04, 0]);
  context.details.add('body-shell');

  if (plan.fenders === 'separate') {
    const fenderRadius = plan.wheelRadius + 0.14;
    for (const axle of axles) {
      addCylinder(
        context,
        parent,
        [plan.width * 1.02, fenderRadius, fenderRadius],
        paint,
        [0, plan.wheelRadius + 0.1, axle],
      );
    }
    context.details.add('separate-fenders');
  } else if (plan.fenders === 'flared') {
    for (const side of [1, -1] as const) {
      addBox(context, parent, [0.12, plan.bodyHeight * 0.5, bodyLength * 0.86], materials.dark, [side * (halfW + 0.04), sill + plan.bodyHeight * 0.32, 0]);
    }
    context.details.add('flared-arches');
  }

  // Bumpers, grille and brightwork follow the era's chrome ratio.
  const chromeBumper = details.chromeRatio > 0.4;
  const bumper = chromeBumper ? materials.chrome : paint;
  addBox(context, parent, [plan.width * 1.02, 0.2, 0.22], bumper, [0, sill + 0.12, halfLength - 0.04]);
  addBox(context, parent, [plan.width * 1.02, 0.2, 0.22], bumper, [0, sill + 0.12, -halfLength + 0.04]);
  context.details.add(chromeBumper ? 'chrome-bumpers' : 'painted-bumpers');

  if (front) {
    const grilleHeight = plan.bodyHeight * (plan.nose === 'long' ? 0.42 : 0.5);
    addBox(
      context,
      parent,
      [plan.width * 0.62, grilleHeight, 0.08],
      details.chromeRatio > 0.5 ? materials.chrome : materials.dark,
      [0, sill + plan.bodyHeight * 0.58, halfLength + 0.005],
    );
    context.details.add(details.chromeRatio > 0.5 ? 'chrome-grille' : 'grille');
    if (details.chromeRatio > 0.5) {
      for (let bar = -1; bar <= 1; bar += 1) {
        addBox(
          context,
          parent,
          [plan.width * 0.6, 0.04, 0.1],
          materials.chrome,
          [0, sill + plan.bodyHeight * 0.58 + bar * grilleHeight * 0.3, halfLength + 0.01],
        );
      }
      context.details.add('grille-bars');
    }
    if (plan.nose === 'long') {
      addBox(context, parent, [plan.width * 0.5, 0.08, plan.length * 0.18], paint, [0, sill + plan.bodyHeight + 0.04, halfLength - plan.length * 0.2]);
      context.details.add('long-bonnet');
    }
  }

  if (plan.profile === 'truck') {
    // Flatbed: deck, headboard, stake rails and a bolted spare wheel.
    const deckLength = bodyLength * 0.62;
    addBox(context, parent, [plan.width * 1.02, 0.14, deckLength], materials.interior, [0, sill + plan.bodyHeight * 0.42, -bodyLength * 0.18]);
    addBox(context, parent, [plan.width * 0.08, 0.7, deckLength], materials.dark, [halfW - 0.06, sill + plan.bodyHeight * 0.42 + 0.42, -bodyLength * 0.18]);
    addBox(context, parent, [plan.width * 0.08, 0.7, deckLength], materials.dark, [-halfW + 0.06, sill + plan.bodyHeight * 0.42 + 0.42, -bodyLength * 0.18]);
    addBox(context, parent, [plan.width, 1.0, 0.1], materials.dark, [0, sill + plan.bodyHeight * 0.42 + 0.5, -bodyLength * 0.18 + deckLength / 2]);
    context.details.add('stake-bed');
    context.details.add('headboard');
    if (front) {
      addMesh(context, parent, context.geometries.wheel, materials.tire, [0.18, 0.4, 0.4], [halfW - 0.02, sill + plan.bodyHeight * 0.7, -bodyLength * 0.2]);
      context.details.add('spare-wheel');
    }
  }

  if (plan.profile === 'tram') {
    addBox(context, parent, [plan.width * 1.005, 0.12, bodyLength * 0.96], materials.accent(new THREE.Color(details.livery).getHex()), [0, sill + plan.bodyHeight * 0.42, 0]);
    context.details.add('livery-band');
  } else if (details.livery !== '#000000') {
    addBox(
      context,
      parent,
      [plan.width * 1.004, 0.1, bodyLength * 0.78],
      materials.accent(new THREE.Color(details.livery).getHex()),
      [0, sill + plan.bodyHeight * 0.34, 0],
    );
    context.details.add('livery-stripe');
  }

  if (details.mudFlaps) {
    for (const side of [1, -1] as const) {
      addBox(context, parent, [0.05, 0.22, 0.26], materials.dark, [side * (halfW - 0.08), 0.2, -halfLength + 0.3]);
    }
    context.details.add('mud-flaps');
  }

  if (details.trolleyPole) {
    addCylinder(context, parent, [0.035, 1.5, 0.035], materials.rail, [0, sill + plan.bodyHeight + 0.9, -halfLength * 0.35], [0.5, 0, 0]);
    addMesh(context, parent, context.geometries.wheel, materials.rail, [0.07, 0.11, 0.11], [0, sill + plan.bodyHeight + 1.55, -halfLength * 0.35 - 0.6]);
    context.details.add('trolley-pole');
  }
  if (details.pantograph) {
    for (const side of [1, -1] as const) {
      addCylinder(context, parent, [0.03, 0.9, 0.03], materials.rail, [side * 0.5, sill + plan.bodyHeight + 0.5, -halfLength * 0.2], [0, 0, side * 0.6]);
    }
    addBox(context, parent, [1.5, 0.05, 0.08], materials.rail, [0, sill + plan.bodyHeight + 0.92, -halfLength * 0.2]);
    context.details.add('pantograph');
  }

  // Licence plates, front only on the leading section.
  if (front) {
    addBox(context, parent, [0.36, 0.12, 0.03], materials.dark, [0, sill + 0.3, halfLength + 0.02]);
    context.details.add('plates');
  }
}

function assembleSection(
  context: AssemblyContext,
  sectionLength: number,
  sectionIndex: number,
  sectionCount: number,
): THREE.Group {
  const plan = context.spec.plan;
  const node = new THREE.Group();
  const halfLength = sectionLength / 2;
  const halfW = plan.width / 2;
  const front = sectionIndex === 0;
  const last = sectionIndex === sectionCount - 1;

  // Axles: single-section vehicles use their authored wheelbase; articulated
  // ones put one axle pair per section so the joint bends convincingly.
  const axles: number[] = [];
  if (sectionCount === 1) {
    if (plan.wheelCount === 6) {
      axles.push(-plan.wheelbase / 2, plan.wheelbase / 2 - 0.35, plan.wheelbase / 2 - 1.15);
    } else {
      axles.push(plan.wheelbase / 2, -plan.wheelbase / 2);
    }
  } else {
    axles.push(sectionIndex === 0 ? sectionLength * 0.3 : -sectionLength * 0.3);
  }

  addBody(context, node, halfLength, front || plan.profile === 'tram', axles);
  // Cabins are profile-aware: buses and trams get window bands and doors, pods
  // get wraparound glazing, everything else a stepped greenhouse.
  addCabin(context, node, halfLength);

  const rail = plan.profile === 'tram';
  for (const axle of axles) {
    for (const side of [1, -1] as const) {
      addWheel(context, node, side, axle, side * (halfW - plan.wheelRadius * 0.22), rail);
    }
  }
  context.details.add('wheels');
  context.details.add('hubcaps');

  addLamps(context, node, halfLength, front || plan.profile === 'tram');
  if (last) {
    addExhaust(context, node, halfLength);
    addChargePort(context, node, halfLength);
  }
  node.userData.chronoSection = sectionIndex;
  return node;
}

function assembleVehicle(
  geometries: FactoryGeometries,
  materials: EraVehicleMaterials,
  spec: VehicleModelSpec,
  colour: number,
): VehicleBuild {
  const context: AssemblyContext = {
    geometries,
    materials,
    spec,
    colour,
    details: new Set<string>(),
    meshCount: 0,
    wheels: [],
    lamps: [],
  };
  const root = new THREE.Group();
  root.name = `vehicle-${spec.id}`;

  const plan = spec.plan;
  const sections: VehicleSection[] = [];
  const sectionCount = plan.sections;
  const frontLength = plan.length * plan.sectionSplit;
  const rearLength = plan.length - frontLength;

  for (let index = 0; index < sectionCount; index += 1) {
    const sectionLength = (index === 0 ? frontLength : rearLength) - (sectionCount > 1 ? 0.22 : 0);
    const node = assembleSection(context, sectionLength, index, sectionCount);
    // The vehicle's reference point sits at the centre of the whole body; each
    // section is offset from it along the lane spline.
    const offset =
      index === 0
        ? (plan.length / 2 - frontLength / 2) * 1
        : -(plan.length / 2 - rearLength / 2);
    root.add(node);
    sections.push({ node, offset });
  }

  root.userData.chronoVehicle = spec.id;
  root.userData.chronoEra = spec.era;
  root.userData.chronoClass = spec.vehicleClass;
  root.userData.chronoLabel = spec.label;
  root.userData.chronoColour = hexString(colour);
  root.userData.chronoDetails = [...context.details].sort();

  return {
    spec,
    colour,
    root,
    sections: Object.freeze(sections),
    wheels: Object.freeze(context.wheels),
    lamps: Object.freeze(context.lamps),
    materials,
    details: Object.freeze([...context.details].sort()),
    meshCount: context.meshCount,
  };
}

/* ------------------------------------------------------------------------- *
 * Factory
 * ------------------------------------------------------------------------- */

export interface VehicleFactoryOptions {
  /** Shared procedural material library every vehicle material comes from. */
  readonly library: MaterialLibrary;
}

export interface VehicleFactoryStats {
  /** Shared geometry blanks created by this factory (constant after the first build). */
  readonly geometries: number;
  /** Distinct materials checked out of the library for the factory's eras. */
  readonly materials: number;
  readonly built: number;
  readonly reused: number;
  readonly pooled: number;
  readonly active: number;
  readonly meshCount: number;
  readonly erasBuilt: readonly EraId[];
}

/**
 * Builds and pools era vehicles. `create()` reuses a pooled root whenever one is
 * available for the same `(model, colour)`, so a slider scrub back and forth
 * never allocates a new mesh, and `stats()` exposes the bound.
 */
export class VehicleFactory {
  readonly version = VEHICLE_FACTORY_VERSION;

  private readonly library: MaterialLibrary;
  private readonly geometries = createGeometries();
  private readonly pools = new Map<string, VehicleBuild[]>();
  private readonly materialSets = new Map<EraId, EraVehicleMaterials>();
  private readonly activeBuilds = new Set<VehicleBuild>();
  private builtCount = 0;
  private reusedCount = 0;
  private disposed = false;

  constructor(options: VehicleFactoryOptions) {
    if (!options?.library) {
      throw new TypeError('VehicleFactory needs a MaterialLibrary.');
    }
    this.library = options.library;
  }

  /** Material set for one era (created on first use and cached). */
  materialsFor(era: EraId, lightLevel: number): EraVehicleMaterials {
    const cached = this.materialSets.get(era);
    if (cached) return cached;
    const created = buildEraMaterials(this.library, era, lightLevel);
    this.materialSets.set(era, created);
    return created;
  }

  /** Checks a vehicle out of the pool, building it only when the pool is dry. */
  create(spec: VehicleModelSpec, colour?: number, lightLevel = 0.5): VehicleBuild {
    if (this.disposed) throw new Error('VehicleFactory has been disposed.');
    const paint = colour ?? spec.colour ?? 0x8f979f;
    const materials = this.materialsFor(spec.era, lightLevel);
    const key = `${spec.id}|${paint}|${materials.lightLevel.toFixed(2)}`;
    const pool = this.pools.get(key);

    if (pool && pool.length > 0) {
      const build = pool.pop() as VehicleBuild;
      this.reusedCount += 1;
      this.activeBuilds.add(build);
      build.root.visible = true;
      return build;
    }

    const build = assembleVehicle(this.geometries, materials, spec, paint);
    this.builtCount += 1;
    this.activeBuilds.add(build);
    return build;
  }

  /** Returns a build to its pool; the root is hidden but keeps its meshes. */
  release(build: VehicleBuild): void {
    if (!this.activeBuilds.delete(build)) return;
    build.root.visible = false;
    if (build.root.parent) build.root.parent.remove(build.root);
    const key = `${build.spec.id}|${build.colour}|${build.materials.lightLevel.toFixed(2)}`;
    const pool = this.pools.get(key);
    if (pool) pool.push(build);
    else this.pools.set(key, [build]);
  }

  get stats(): VehicleFactoryStats {
    let pooled = 0;
    for (const pool of this.pools.values()) pooled += pool.length;
    let materials = 0;
    for (const set of this.materialSets.values()) materials += set.keys().length;
    let meshCount = 0;
    for (const build of this.activeBuilds) meshCount += build.meshCount;
    return Object.freeze({
      geometries: 4,
      materials,
      built: this.builtCount,
      reused: this.reusedCount,
      pooled,
      active: this.activeBuilds.size,
      meshCount,
      erasBuilt: Object.freeze([...this.materialSets.keys()]),
    });
  }

  /** Releases every pooled root, its materials and the shared geometry blanks. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const build of this.activeBuilds) {
      build.root.visible = false;
      if (build.root.parent) build.root.parent.remove(build.root);
    }
    this.activeBuilds.clear();
    for (const pool of this.pools.values()) {
      for (const build of pool) {
        build.root.clear();
      }
    }
    this.pools.clear();
    for (const set of this.materialSets.values()) {
      for (const key of set.keys()) this.library.disposeMaterial(key);
    }
    this.materialSets.clear();
    this.geometries.dispose();
  }
}

/** Creates a vehicle factory (the `create` half of the lifecycle). */
export function createVehicleFactory(options: VehicleFactoryOptions): VehicleFactory {
  return new VehicleFactory(options);
}
