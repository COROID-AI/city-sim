/**
 * Chrono City — era street dressing.
 *
 * The furniture that turns a bare road ring into a street: lamp posts that run
 * from 1945's cast-iron gas globes to 2025's smart LED columns, fire hydrants,
 * mailboxes, litter bins, benches, street trees, the telephone-booth →
 * civic-kiosk → EV-charging-pillar lineage, newsstands and 2025's delivery
 * drones. Each family is authored once per era; a `TimelineRuntime` tween
 * crossfades the outgoing and incoming variants, so the street morphs instead of
 * popping between years.
 *
 * Placement is derived from the shared `BlockLayout` sidewalk loop: every anchor
 * is a fraction around the loop plus a lateral offset inside the 3 m pedestrian
 * band, so dressing never intrudes on the carriageway traffic owns, never lands
 * on a crossing, and never leaves the sidewalk pedestrians walk. This module
 * creates no vehicle and no pedestrian.
 *
 * Notable fixtures (the booth lineage above all) expose per-year copy so the
 * `InspectionRegistry` can resolve "Telephone booth" in 1945 and "EV charging
 * pillar" in 2025 from one stable, era-independent pick target.
 *
 * Lifecycle:
 *   create    → `createStreetDressing({ context, library, parent? })` builds the
 *               anchors and the starting era's variants.
 *   consume   → `applyBlend(from, to, progress, palette)` per transition frame,
 *               `applyEra(era)` to snap, `inspectableDefinitions()` to register.
 *   integrate → the `EnvironmentApi` owns the root in the scene graph and pushes
 *               the definitions into the `InspectionRegistry`.
 */

import * as THREE from 'three';

import {
  pointOnSidewalkLoop,
  type Vec2,
} from '../core/blockLayout';
import { ERA_IDS, assertEraId, clamp01, type EraId } from '../core/eraContracts';
import type { EraColorPalette } from '../era/eraDescriptors';
import type { SceneContext } from '../core/sceneContext';
import type { MaterialLibrary, SurfaceKind } from '../materials/materialLibrary';
import type {
  InspectableCopyByEra,
  InspectableDefinition,
} from '../interaction/inspectionRegistry';

export const STREET_DRESSING_VERSION = 1;

/** Group name every dressing anchor is parented to. */
export const STREET_DRESSING_ROOT_NAME = 'chrono-street-dressing';

/** Id prefix of every inspectable this module registers. */
export const DRESSING_INSPECTABLE_PREFIX = 'street-';

/* ------------------------------------------------------------------------- *
 * Family vocabulary
 * ------------------------------------------------------------------------- */

export type LampStyle = 'globeGas' | 'fluorescentCobra' | 'sodiumCobra' | 'metalHalide' | 'smartLed';
export type HydrantStyle = 'castIron' | 'chrome' | 'smart';
export type MailboxStyle = 'pillarBox' | 'standardBox' | 'clusterBox' | 'parcelDrop';
export type TrashStyle = 'wireBasket' | 'metalDrum' | 'domeBin' | 'recyclingPair' | 'compactor';
export type BenchStyle = 'woodSlat' | 'concrete' | 'metalMesh' | 'composite';
export type TreePitStyle = 'openSoil' | 'grate' | 'planter' | 'rainGarden';
export type TreeSpecies = 'plane' | 'lime' | 'maple' | 'cherry' | 'climateOak';
export type BoothStyle = 'phoneBooth' | 'phoneBank' | 'kiosk' | 'payphone' | 'chargingPillar';
export type NewsstandStyle = 'timberKiosk' | 'pressKiosk' | 'magazineStand' | 'microRetail' | 'parcelLocker';

/** The nine dressing families the block shows. */
export type DressingFamilyId =
  | 'lamps'
  | 'hydrants'
  | 'mailboxes'
  | 'trashCans'
  | 'benches'
  | 'trees'
  | 'boothLineage'
  | 'newsstands'
  | 'droneLights';

export const DRESSING_FAMILY_IDS: readonly DressingFamilyId[] = Object.freeze([
  'lamps',
  'hydrants',
  'mailboxes',
  'trashCans',
  'benches',
  'trees',
  'boothLineage',
  'newsstands',
  'droneLights',
]);

/** Human-readable family names, for HUD output and test messages. */
export const DRESSING_FAMILY_LABELS: Readonly<Record<DressingFamilyId, string>> = Object.freeze({
  lamps: 'Street lamps',
  hydrants: 'Fire hydrants',
  mailboxes: 'Mailboxes',
  trashCans: 'Litter bins',
  benches: 'Benches',
  trees: 'Street trees',
  boothLineage: 'Phone booth / kiosk / charging pillar',
  newsstands: 'Newsstands',
  droneLights: 'Delivery drones',
});

/** Everything a year decides about its street furniture. */
export interface EraDressingDescriptor {
  readonly era: EraId;
  readonly lampStyle: LampStyle;
  readonly lampHeight: number;
  readonly lampColor: number;
  readonly lampGlow: number;
  readonly hydrantStyle: HydrantStyle;
  readonly hydrantColor: number;
  readonly mailboxStyle: MailboxStyle;
  readonly mailboxColor: number;
  readonly trashStyle: TrashStyle;
  readonly trashColor: number;
  readonly benchStyle: BenchStyle;
  readonly benchColor: number;
  readonly treePitStyle: TreePitStyle;
  readonly treeSpecies: TreeSpecies;
  readonly treeColor: number;
  readonly boothStyle: BoothStyle;
  readonly boothColor: number;
  readonly newsstandStyle: NewsstandStyle;
  readonly newsstandColor: number;
  /** Delivery drones above the block; 2025 only. */
  readonly droneLightCount: number;
  readonly notes: string;
}

/** A resolved (already blended) dressing descriptor. */
export interface ResolvedDressingDescriptor {
  readonly lampStyle: LampStyle;
  readonly lampHeight: number;
  readonly lampColor: number;
  readonly lampGlow: number;
  readonly hydrantStyle: HydrantStyle;
  readonly hydrantColor: number;
  readonly mailboxStyle: MailboxStyle;
  readonly mailboxColor: number;
  readonly trashStyle: TrashStyle;
  readonly trashColor: number;
  readonly benchStyle: BenchStyle;
  readonly benchColor: number;
  readonly treePitStyle: TreePitStyle;
  readonly treeSpecies: TreeSpecies;
  readonly treeColor: number;
  readonly boothStyle: BoothStyle;
  readonly boothColor: number;
  readonly newsstandStyle: NewsstandStyle;
  readonly newsstandColor: number;
  readonly droneLightCount: number;
}

/* ------------------------------------------------------------------------- *
 * Authored tables
 * ------------------------------------------------------------------------- */

/** The five authored dressing sets, one per year. */
export const DRESSING_DESCRIPTORS: Readonly<Record<EraId, EraDressingDescriptor>> = Object.freeze({
  '1945': Object.freeze({
    era: '1945',
    lampStyle: 'globeGas',
    lampHeight: 4.2,
    lampColor: 0xffd9a0,
    lampGlow: 1.35,
    hydrantStyle: 'castIron',
    hydrantColor: 0x7d2f2a,
    mailboxStyle: 'pillarBox',
    mailboxColor: 0x37503f,
    trashStyle: 'wireBasket',
    trashColor: 0x5c5c56,
    benchStyle: 'woodSlat',
    benchColor: 0x7a5a3a,
    treePitStyle: 'openSoil',
    treeSpecies: 'plane',
    treeColor: 0x6d7f4a,
    boothStyle: 'phoneBooth',
    boothColor: 0x8c2f2a,
    newsstandStyle: 'timberKiosk',
    newsstandColor: 0x7a6242,
    droneLightCount: 0,
    notes: 'Gas globes, cast-iron hydrants, a pillar box, timber newsstand and a red call box.',
  }),
  '1965': Object.freeze({
    era: '1965',
    lampStyle: 'fluorescentCobra',
    lampHeight: 6.4,
    lampColor: 0xfff0c0,
    lampGlow: 1.15,
    hydrantStyle: 'castIron',
    hydrantColor: 0xa8392f,
    mailboxStyle: 'standardBox',
    mailboxColor: 0x2f5a86,
    trashStyle: 'metalDrum',
    trashColor: 0x6f7480,
    benchStyle: 'woodSlat',
    benchColor: 0x8a6a44,
    treePitStyle: 'grate',
    treeSpecies: 'lime',
    treeColor: 0x76904c,
    boothStyle: 'phoneBank',
    boothColor: 0x2f6e8c,
    newsstandStyle: 'pressKiosk',
    newsstandColor: 0x8c5a3a,
    droneLightCount: 0,
    notes: 'Fluorescent cobra heads, blue boxes, steel drums and laminated-glass phone banks.',
  }),
  '1985': Object.freeze({
    era: '1985',
    lampStyle: 'sodiumCobra',
    lampHeight: 8.2,
    lampColor: 0xffa63c,
    lampGlow: 1.5,
    hydrantStyle: 'chrome',
    hydrantColor: 0xb9c0c8,
    mailboxStyle: 'clusterBox',
    mailboxColor: 0x30506b,
    trashStyle: 'domeBin',
    trashColor: 0x4a4f58,
    benchStyle: 'concrete',
    benchColor: 0x9a9891,
    treePitStyle: 'grate',
    treeSpecies: 'maple',
    treeColor: 0x7d8f45,
    boothStyle: 'kiosk',
    boothColor: 0x2e6b4f,
    newsstandStyle: 'magazineStand',
    newsstandColor: 0x9c3a4a,
    droneLightCount: 0,
    notes: 'Amber sodium cobras, cluster mailboxes, dome bins, concrete benches and a kiosk.',
  }),
  '2005': Object.freeze({
    era: '2005',
    lampStyle: 'metalHalide',
    lampHeight: 9.0,
    lampColor: 0xbfe3ff,
    lampGlow: 1.2,
    hydrantStyle: 'chrome',
    hydrantColor: 0xc6ccd2,
    mailboxStyle: 'clusterBox',
    mailboxColor: 0x2f5a86,
    trashStyle: 'recyclingPair',
    trashColor: 0x4f6b52,
    benchStyle: 'metalMesh',
    benchColor: 0x8e949c,
    treePitStyle: 'planter',
    treeSpecies: 'cherry',
    treeColor: 0x8aa05a,
    boothStyle: 'payphone',
    boothColor: 0x3a3f46,
    newsstandStyle: 'microRetail',
    newsstandColor: 0x2f4a6b,
    droneLightCount: 0,
    notes: 'Cool metal-halide heads, recycling pairs, planting beds and a hooded payphone.',
  }),
  '2025': Object.freeze({
    era: '2025',
    lampStyle: 'smartLed',
    lampHeight: 8.6,
    lampColor: 0xd9f2ff,
    lampGlow: 1.05,
    hydrantStyle: 'smart',
    hydrantColor: 0x3f4a52,
    mailboxStyle: 'parcelDrop',
    mailboxColor: 0x2c3a44,
    trashStyle: 'compactor',
    trashColor: 0x39474a,
    benchStyle: 'composite',
    benchColor: 0x6f6a5e,
    treePitStyle: 'rainGarden',
    treeSpecies: 'climateOak',
    treeColor: 0x6f8b4c,
    boothStyle: 'chargingPillar',
    boothColor: 0x2f3b46,
    newsstandStyle: 'parcelLocker',
    newsstandColor: 0x2b3a44,
    droneLightCount: 5,
    notes: 'Smart LED columns, parcel drops, solar compactors, rain gardens and a charging pillar.',
  }),
});

/** Looks a dressing set up; throws a `RangeError` for unknown eras. */
export function getDressingDescriptor(era: EraId | string): EraDressingDescriptor {
  return DRESSING_DESCRIPTORS[assertEraId(era)];
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function pick<T>(from: T, to: T, t: number): T {
  return t < 0.5 ? from : to;
}

/** Blends two dressing sets: numbers interpolate, styles snap at halfway. */
export function blendDressingDescriptors(
  from: EraId,
  to: EraId,
  progress: number,
): ResolvedDressingDescriptor {
  const t = clamp01(progress);
  const source = getDressingDescriptor(from);
  const target = getDressingDescriptor(to);
  if (from === to || t >= 1) return resolve(target);
  if (t <= 0) return resolve(source);
  return {
    lampStyle: pick(source.lampStyle, target.lampStyle, t),
    lampHeight: lerp(source.lampHeight, target.lampHeight, t),
    lampColor: source.lampColor, // snapped at apply time via the style
    lampGlow: lerp(source.lampGlow, target.lampGlow, t),
    hydrantStyle: pick(source.hydrantStyle, target.hydrantStyle, t),
    hydrantColor: source.hydrantColor,
    mailboxStyle: pick(source.mailboxStyle, target.mailboxStyle, t),
    mailboxColor: source.mailboxColor,
    trashStyle: pick(source.trashStyle, target.trashStyle, t),
    trashColor: source.trashColor,
    benchStyle: pick(source.benchStyle, target.benchStyle, t),
    benchColor: source.benchColor,
    treePitStyle: pick(source.treePitStyle, target.treePitStyle, t),
    treeSpecies: pick(source.treeSpecies, target.treeSpecies, t),
    treeColor: source.treeColor,
    boothStyle: pick(source.boothStyle, target.boothStyle, t),
    boothColor: source.boothColor,
    newsstandStyle: pick(source.newsstandStyle, target.newsstandStyle, t),
    newsstandColor: source.newsstandColor,
    droneLightCount: Math.round(lerp(source.droneLightCount, target.droneLightCount, t)),
  };
}

function resolve(descriptor: EraDressingDescriptor): ResolvedDressingDescriptor {
  return {
    lampStyle: descriptor.lampStyle,
    lampHeight: descriptor.lampHeight,
    lampColor: descriptor.lampColor,
    lampGlow: descriptor.lampGlow,
    hydrantStyle: descriptor.hydrantStyle,
    hydrantColor: descriptor.hydrantColor,
    mailboxStyle: descriptor.mailboxStyle,
    mailboxColor: descriptor.mailboxColor,
    trashStyle: descriptor.trashStyle,
    trashColor: descriptor.trashColor,
    benchStyle: descriptor.benchStyle,
    benchColor: descriptor.benchColor,
    treePitStyle: descriptor.treePitStyle,
    treeSpecies: descriptor.treeSpecies,
    treeColor: descriptor.treeColor,
    boothStyle: descriptor.boothStyle,
    boothColor: descriptor.boothColor,
    newsstandStyle: descriptor.newsstandStyle,
    newsstandColor: descriptor.newsstandColor,
    droneLightCount: descriptor.droneLightCount,
  };
}

/* ------------------------------------------------------------------------- *
 * Placement
 * ------------------------------------------------------------------------- */

/** One furniture anchor: a stable object a variant hangs under. */
export interface DressingPlacement {
  readonly id: string;
  readonly family: DressingFamilyId;
  /** Fraction around the sidewalk loop (`0` = north-east corner). */
  readonly loopT: number;
  /** Lateral offset from the sidewalk centre line: `+` towards the road. */
  readonly lateral: number;
  /** World position of the anchor, resolved from `BlockLayout`. */
  readonly position: Vec2;
  /** Yaw so the object's local `+Z` faces the road. */
  readonly yaw: number;
  /** Registered as an inspectable when `true`. */
  readonly notable: boolean;
}

const LAMP_COUNT = 16;
const TREE_COUNT = 10;
const BENCH_COUNT = 6;
const TRASH_COUNT = 6;
const HYDRANT_TS = [0.13, 0.38, 0.63, 0.88];
const MAILBOX_TS = [0.07, 0.57];
const NEWSSTAND_TS = [0.235, 0.485, 0.735];
const BOOTH_T = 0.3;
const DRONE_COUNT = 5;

function placement(
  id: string,
  family: DressingFamilyId,
  loopT: number,
  lateral: number,
  notable = false,
): DressingPlacement {
  const base = pointOnSidewalkLoop(loopT);
  const length = Math.hypot(base.x, base.z) || 1;
  const nx = base.x / length;
  const nz = base.z / length;
  return Object.freeze({
    id,
    family,
    loopT,
    lateral,
    position: Object.freeze({ x: base.x + nx * lateral, z: base.z + nz * lateral }),
    yaw: Math.atan2(nx, nz),
    notable,
  });
}

function buildPlacements(): DressingPlacement[] {
  const placements: DressingPlacement[] = [];

  // The first placement of each notable family is the one registered as an
  // inspectable, so it takes the plain family id (`street-lamp`, `street-tree`,
  // …) that the per-year copy table keys off.
  const id = (prefix: string, index: number): string =>
    index === 0 ? prefix : `${prefix}-${index}`;

  for (let index = 0; index < LAMP_COUNT; index += 1) {
    placements.push(placement(id('lamp', index), 'lamps', index / LAMP_COUNT + 0.012, 1.05, index === 0));
  }
  for (let index = 0; index < TREE_COUNT; index += 1) {
    placements.push(placement(id('tree', index), 'trees', index / TREE_COUNT + 0.05, -0.6, index === 0));
  }
  for (let index = 0; index < BENCH_COUNT; index += 1) {
    placements.push(placement(id('bench', index), 'benches', index / BENCH_COUNT + 0.09, -0.8, index === 0));
  }
  for (let index = 0; index < TRASH_COUNT; index += 1) {
    placements.push(placement(id('trash-can', index), 'trashCans', index / TRASH_COUNT + 0.07, 0.45, index === 0));
  }
  HYDRANT_TS.forEach((t, index) => {
    placements.push(placement(id('hydrant', index), 'hydrants', t, 1.15, index === 0));
  });
  MAILBOX_TS.forEach((t, index) => {
    placements.push(placement(id('mailbox', index), 'mailboxes', t, 1.0, index === 0));
  });
  NEWSSTAND_TS.forEach((t, index) => {
    placements.push(placement(id('newsstand', index), 'newsstands', t, -0.85, index === 0));
  });
  placements.push(placement('booth-lineage', 'boothLineage', BOOTH_T, -0.75, true));
  for (let index = 0; index < DRONE_COUNT; index += 1) {
    const angle = (index / DRONE_COUNT) * Math.PI * 2 + 0.4;
    const radius = 12 + (index % 3) * 6;
    placements.push(
      Object.freeze({
        id: `drone-${index}`,
        family: 'droneLights' as DressingFamilyId,
        loopT: 0,
        lateral: 0,
        position: Object.freeze({
          x: Math.cos(angle) * radius,
          z: Math.sin(angle) * radius * 0.6,
        }),
        yaw: angle,
        notable: false,
      }),
    );
  }

  return placements;
}

/** The authored anchoring plan, resolved against `BlockLayout` once. */
export const DRESSING_PLACEMENTS: readonly DressingPlacement[] = Object.freeze(buildPlacements());

/* ------------------------------------------------------------------------- *
 * Per-year fixture copy
 * ------------------------------------------------------------------------- */

/** Per-year names and copy for the notable fixtures. */
export const DRESSING_COPY: Readonly<Record<string, InspectableCopyByEra>> = Object.freeze({
  'street-lamp': Object.freeze({
    '1945': {
      name: 'Gas globe lamp post',
      blurb: 'Cast-iron post with a fragile glass globe, its mantles hissing over a blackout-painted base.',
    },
    '1965': {
      name: 'Fluorescent cobra lamp',
      blurb: 'Concrete column carrying a cantilevered cobra head that floods the new asphalt with cold light.',
    },
    '1985': {
      name: 'Sodium street lamp',
      blurb: 'Tall aluminium column with a deep amber pool under its hood and a photocell bolted to the shaft.',
    },
    '2005': {
      name: 'Metal-halide lamp column',
      blurb: 'Cool white light on a tapered column, shielded to keep the glow off the surrounding windows.',
    },
    '2025': {
      name: 'Smart LED lamp post',
      blurb: 'Dark slim column with a dimmable LED bar, air-quality sensor, camera housing and a charging socket.',
    },
  }),
  'street-hydrant': Object.freeze({
    '1945': {
      name: 'Cast-iron fire hydrant',
      blurb: 'Squat red hydrant with a heavy chain and a hand-painted war-department stencil.',
    },
    '1965': {
      name: 'Fire hydrant',
      blurb: 'Repainted municipal hydrant with a fresh cap and a reflective band around the barrel.',
    },
    '1985': {
      name: 'Chrome fire hydrant',
      blurb: 'Polished hydrant with a breakaway stem and a bright yellow cap marking the buried main.',
    },
    '2005': {
      name: 'Fire hydrant',
      blurb: 'Stainless hydrant on a concrete pad, its outlet caps tethered against vandalism.',
    },
    '2025': {
      name: 'Smart fire hydrant',
      blurb: 'Flush smart hydrant reporting pressure over the city network, with a lit status ring at street level.',
    },
  }),
  'street-mailbox': Object.freeze({
    '1945': {
      name: 'Cast-iron pillar box',
      blurb: 'Deep green pillar box with a hand-lettered collection plate and a slot worn smooth by gloved hands.',
    },
    '1965': {
      name: 'Standard mailbox',
      blurb: 'New blue steel mailbox on stubby legs, its enamel lettering still glossy under the street lamp.',
    },
    '1985': Object.freeze({
      name: 'Cluster mailbox',
      blurb: 'Four-door cluster unit for the new apartment blocks, with a payphone timetable taped to the side.',
    }),
    '2005': {
      name: 'Cluster mailbox unit',
      blurb: 'Locked mail unit with a parcel hatch, council notices and a small recycling slot.',
    },
    '2025': {
      name: 'Smart parcel drop',
      blurb: 'Parcel-and-mail locker wall with a touchscreen, courier codes and a solar strip along the top.',
    },
  }),
  'street-trash-can': Object.freeze({
    '1945': {
      name: 'Wire litter basket',
      blurb: 'Open wire basket on a spike, holding a scrap of newspaper and last night’s ration tin.',
    },
    '1965': {
      name: 'Metal litter drum',
      blurb: 'Galvanised drum with a domed lid, its paint scheme matching the new municipal blue.',
    },
    '1985': {
      name: 'Dome litter bin',
      blurb: 'Enamelled dome bin bolted to the paving, with a small ashtray ring on the rim.',
    },
    '2005': {
      name: 'Recycling pair',
      blurb: 'Twin bins for refuse and paper, the lids colour-coded and the sides stickered with collection days.',
    },
    '2025': {
      name: 'Solar smart compactor',
      blurb: 'Solar compactor that crushes waste and reports fill level, its screen scrolling the recycling target.',
    },
  }),
  'street-bench': Object.freeze({
    '1945': {
      name: 'Wood-slat bench',
      blurb: 'Splintered timber slats on a cast-iron frame, with a war-bond poster pasted to the backrest.',
    },
    '1965': {
      name: 'Wood-slat bench',
      blurb: 'Freshly varnished teak slats on concrete legs, facing the rebuilt shopfronts.',
    },
    '1985': {
      name: 'Concrete bench',
      blurb: 'Smooth precast concrete bench, cool to the touch, with a bus timetable bolted alongside.',
    },
    '2005': {
      name: 'Perforated steel bench',
      blurb: 'Powder-coated steel mesh seat over a galvanised frame, anti-skate studs along its edge.',
    },
    '2025': {
      name: 'Composite smart bench',
      blurb: 'Recycled composite bench with a solar canopy, a wireless charging pad and a planted armrest.',
    },
  }),
  'street-tree': Object.freeze({
    '1945': {
      name: 'London plane',
      blurb: 'Sooty plane tree in an open soil pit, its bark flaking over a cobbled kerb.',
    },
    '1965': {
      name: 'Common lime',
      blurb: 'Fast-growing lime in a cast-iron tree grate, planted as part of the reconstruction planting drive.',
    },
    '1985': {
      name: 'Norway maple',
      blurb: 'Dense maple in a grated pit, its canopy pruned away from the new sodium lamp heads.',
    },
    '2005': {
      name: 'Ornamental cherry',
      blurb: 'Cherry in a raised planter bed, its blossom brief but its irrigation line permanent.',
    },
    '2025': {
      name: 'Climate-resilient oak',
      blurb: 'Drought-tolerant oak over a rain garden that drinks the street’s stormwater and shades the sensor pit.',
    },
  }),
  'street-newsstand': Object.freeze({
    '1945': {
      name: 'Timber newsstand',
      blurb: 'Tarry timber stand with a canvas awning, hand-billed headlines and a queue for the afternoon edition.',
    },
    '1965': {
      name: 'Press kiosk',
      blurb: 'Formica press kiosk with a neon magazine sign, stacked near the new bus stop.',
    },
    '1985': {
      name: 'Magazine stand',
      blurb: 'Red magazine stand with racks of glossies and a small padlocked lottery shutter.',
    },
    '2005': {
      name: 'Micro-retail unit',
      blurb: 'Compact glazed unit selling coffee and papers, its fascia backlit and its shutters rolling down at six.',
    },
    '2025': {
      name: 'Parcel & press locker',
      blurb: 'Unmanned hybrid of newsstand and parcel point: press rack on one side, courier lockers on the other.',
    },
  }),
  'street-booth-lineage': Object.freeze({
    '1945': {
      name: 'Telephone booth',
      blurb: 'Red cast-iron call box, glazed in small panes, with a dial phone and a card of rationed call units inside.',
    },
    '1965': {
      name: 'Telephone booth',
      blurb: 'Pair of laminated-glass booths with chrome dials, its twin doors spilling warm light onto the sidewalk.',
    },
    '1985': {
      name: 'Civic kiosk',
      blurb: 'Green kiosk with a card payphone, a street map and a lamp box that doubles as a police call point.',
    },
    '2005': {
      name: 'Payphone kiosk',
      blurb: 'Hooded aluminium pedestal with a keypad phone, its coin slots dusty as mobiles take over the street.',
    },
    '2025': {
      name: 'EV charging pillar',
      blurb: 'Smart charging pillar with a contactless reader, holstered cable, status strip and an e-bike socket.',
    },
  }),
});

/** Per-year name of one notable fixture, for HUD and tests. */
export function dressingFixtureName(anchorId: string, era: EraId): string | null {
  const copy = DRESSING_COPY[anchorId];
  if (!copy) return null;
  return copy[era]?.name ?? null;
}

/* ------------------------------------------------------------------------- *
 * Materials
 * ------------------------------------------------------------------------- */

interface DressingMaterialSet {
  readonly body: THREE.MeshStandardMaterial;
  readonly accent: THREE.MeshStandardMaterial;
  readonly glow: THREE.MeshStandardMaterial;
}

const FAMILY_SURFACES: Readonly<Record<DressingFamilyId, { body: SurfaceKind; accent: SurfaceKind }>> =
  Object.freeze({
    lamps: { body: 'corrugatedMetal', accent: 'paintedSign' },
    hydrants: { body: 'corrugatedMetal', accent: 'paintedSign' },
    mailboxes: { body: 'corrugatedMetal', accent: 'paintedSign' },
    trashCans: { body: 'corrugatedMetal', accent: 'paintedSign' },
    benches: { body: 'stone', accent: 'corrugatedMetal' },
    trees: { body: 'stucco', accent: 'fabric' },
    boothLineage: { body: 'glassCurtainWall', accent: 'paintedSign' },
    newsstands: { body: 'corrugatedMetal', accent: 'paintedSign' },
    droneLights: { body: 'corrugatedMetal', accent: 'paintedSign' },
  });

/* ------------------------------------------------------------------------- *
 * Primitive helpers
 * ------------------------------------------------------------------------- */

function box(
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  segments = 10,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1),
    material,
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function sphere(
  radius: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function group(name: string, ...children: THREE.Object3D[]): THREE.Group {
  const holder = new THREE.Group();
  holder.name = name;
  for (const child of children) holder.add(child);
  return holder;
}

/* ------------------------------------------------------------------------- *
 * Variant builders — one era's take on each family
 * ------------------------------------------------------------------------- */

function buildLamp(
  descriptor: ResolvedDressingDescriptor,
  mats: DressingMaterialSet,
): THREE.Group {
  const height = descriptor.lampHeight;
  const holder = new THREE.Group();
  mats.glow.color.setHex(descriptor.lampColor);
  mats.glow.emissive.setHex(descriptor.lampColor);
  switch (descriptor.lampStyle) {
    case 'globeGas': {
      holder.add(box(0.5, 0.34, 0.5, mats.accent, 0, 0.17, 0));
      holder.add(cylinder(0.085, 0.15, height, mats.body, 0, height / 2 + 0.34, 0));
      holder.add(cylinder(0.17, 0.11, 0.14, mats.body, 0, height + 0.34, 0));
      holder.add(sphere(0.28, mats.glow, 0, height + 0.66, 0));
      break;
    }
    case 'fluorescentCobra': {
      holder.add(cylinder(0.13, 0.19, height, mats.body, 0, height / 2, 0));
      holder.add(box(1.5, 0.12, 0.14, mats.body, 0.72, height, 0));
      holder.add(box(0.7, 0.2, 0.34, mats.glow, 1.42, height - 0.12, 0));
      break;
    }
    case 'sodiumCobra': {
      holder.add(cylinder(0.11, 0.2, height, mats.body, 0, height / 2, 0));
      holder.add(box(1.9, 0.14, 0.16, mats.body, 0.92, height, 0));
      holder.add(box(0.8, 0.26, 0.4, mats.body, 1.84, height - 0.14, 0));
      holder.add(box(0.66, 0.06, 0.3, mats.glow, 1.84, height - 0.28, 0));
      break;
    }
    case 'metalHalide': {
      holder.add(cylinder(0.1, 0.18, height, mats.body, 0, height / 2, 0));
      holder.add(box(2.6, 0.12, 0.16, mats.body, 1.2, height, 0));
      holder.add(box(0.9, 0.22, 0.42, mats.accent, 2.4, height - 0.12, 0));
      holder.add(box(0.76, 0.05, 0.34, mats.glow, 2.4, height - 0.24, 0));
      break;
    }
    case 'smartLed': {
      holder.add(cylinder(0.13, 0.2, height, mats.body, 0, height / 2, 0));
      holder.add(box(0.34, 0.9, 0.34, mats.body, 0, height * 0.55, 0));
      holder.add(box(0.3, 0.14, 0.12, mats.glow, 0, height * 0.55, 0.2));
      holder.add(box(1.1, 0.08, 0.18, mats.body, 0.5, height, 0));
      holder.add(box(0.98, 0.05, 0.3, mats.glow, 0.62, height - 0.07, 0));
      holder.add(box(0.22, 0.3, 0.22, mats.accent, -0.2, 1.1, 0));
      break;
    }
    default:
      break;
  }
  return holder;
}

function buildHydrant(
  descriptor: ResolvedDressingDescriptor,
  mats: DressingMaterialSet,
): THREE.Group {
  mats.body.color.setHex(descriptor.hydrantColor);
  mats.accent.color.setHex(descriptor.hydrantColor);
  const holder = new THREE.Group();
  switch (descriptor.hydrantStyle) {
    case 'castIron': {
      holder.add(cylinder(0.2, 0.24, 0.7, mats.body, 0, 0.35, 0));
      holder.add(cylinder(0.1, 0.2, 0.24, mats.body, 0, 0.82, 0));
      holder.add(sphere(0.1, mats.accent, 0, 0.96, 0));
      holder.add(cylinder(0.07, 0.07, 0.24, mats.accent, 0.22, 0.5, 0, 8));
      holder.add(cylinder(0.07, 0.07, 0.24, mats.accent, -0.22, 0.5, 0, 8));
      break;
    }
    case 'chrome': {
      holder.add(cylinder(0.18, 0.22, 0.62, mats.body, 0, 0.31, 0));
      holder.add(cylinder(0.12, 0.18, 0.2, mats.accent, 0, 0.72, 0));
      holder.add(cylinder(0.1, 0.1, 0.16, mats.accent, 0, 0.9, 0));
      holder.add(cylinder(0.06, 0.06, 0.22, mats.accent, 0.2, 0.44, 0, 8));
      break;
    }
    case 'smart': {
      holder.add(box(0.42, 0.62, 0.42, mats.body, 0, 0.31, 0));
      holder.add(box(0.3, 0.08, 0.3, mats.accent, 0, 0.66, 0));
      holder.add(box(0.34, 0.06, 0.34, mats.glow, 0, 0.12, 0));
      holder.add(box(0.12, 0.18, 0.06, mats.glow, 0.22, 0.4, 0));
      break;
    }
    default:
      break;
  }
  return holder;
}

function buildMailbox(
  descriptor: ResolvedDressingDescriptor,
  mats: DressingMaterialSet,
): THREE.Group {
  mats.body.color.setHex(descriptor.mailboxColor);
  mats.accent.color.setHex(0xd8d4c8);
  const holder = new THREE.Group();
  switch (descriptor.mailboxStyle) {
    case 'pillarBox': {
      holder.add(cylinder(0.3, 0.34, 0.28, mats.body, 0, 0.14, 0, 14));
      holder.add(cylinder(0.3, 0.3, 1.1, mats.body, 0, 0.83, 0, 14));
      holder.add(sphere(0.3, mats.body, 0, 1.42, 0));
      holder.add(box(0.24, 0.05, 0.06, mats.accent, 0, 1.12, 0.29));
      break;
    }
    case 'standardBox': {
      holder.add(box(0.62, 0.5, 0.5, mats.body, 0, 0.95, 0));
      holder.add(box(0.5, 0.34, 0.4, mats.body, 0, 1.36, 0));
      holder.add(box(0.34, 0.05, 0.05, mats.accent, 0, 1.2, 0.26));
      holder.add(box(0.08, 0.7, 0.08, mats.accent, -0.22, 0.35, 0));
      holder.add(box(0.08, 0.7, 0.08, mats.accent, 0.22, 0.35, 0));
      break;
    }
    case 'clusterBox': {
      holder.add(box(1.7, 1.0, 0.6, mats.body, 0, 0.9, 0));
      for (let door = 0; door < 4; door += 1) {
        holder.add(box(0.36, 0.8, 0.04, mats.accent, -0.63 + door * 0.42, 0.9, 0.32));
      }
      holder.add(box(1.7, 0.12, 0.7, mats.body, 0, 1.46, 0));
      break;
    }
    case 'parcelDrop': {
      holder.add(box(2.1, 1.9, 0.7, mats.body, 0, 0.95, 0));
      for (let door = 0; door < 3; door += 1) {
        holder.add(box(0.6, 0.6, 0.05, mats.accent, -0.68 + door * 0.68, 1.35, 0.37));
      }
      holder.add(box(0.5, 0.34, 0.06, mats.glow, 0.62, 0.75, 0.37));
      holder.add(box(2.16, 0.1, 0.76, mats.glow, 0, 1.93, 0));
      break;
    }
    default:
      break;
  }
  return holder;
}

function buildTrashCan(
  descriptor: ResolvedDressingDescriptor,
  mats: DressingMaterialSet,
): THREE.Group {
  mats.body.color.setHex(descriptor.trashColor);
  mats.accent.color.setHex(0x8a9098);
  const holder = new THREE.Group();
  switch (descriptor.trashStyle) {
    case 'wireBasket': {
      holder.add(cylinder(0.28, 0.24, 0.72, mats.body, 0, 0.36, 0, 12));
      holder.add(cylinder(0.3, 0.3, 0.05, mats.accent, 0, 0.74, 0, 12));
      holder.add(cylinder(0.05, 0.05, 0.5, mats.accent, 0, 0.25, 0, 6));
      break;
    }
    case 'metalDrum': {
      holder.add(cylinder(0.3, 0.3, 0.86, mats.body, 0, 0.43, 0, 12));
      holder.add(cylinder(0.33, 0.33, 0.08, mats.body, 0, 0.9, 0, 12));
      holder.add(box(0.34, 0.05, 0.05, mats.accent, 0, 0.7, 0.3));
      break;
    }
    case 'domeBin': {
      holder.add(cylinder(0.32, 0.36, 0.8, mats.body, 0, 0.4, 0, 12));
      holder.add(sphere(0.34, mats.body, 0, 0.84, 0));
      holder.add(cylinder(0.12, 0.12, 0.06, mats.accent, 0, 1.16, 0, 10));
      break;
    }
    case 'recyclingPair': {
      holder.add(box(0.66, 0.9, 0.66, mats.body, -0.36, 0.45, 0));
      holder.add(box(0.66, 0.9, 0.66, mats.accent, 0.36, 0.45, 0));
      holder.add(box(0.5, 0.06, 0.5, mats.body, -0.36, 0.94, 0));
      holder.add(box(0.5, 0.06, 0.5, mats.accent, 0.36, 0.94, 0));
      break;
    }
    case 'compactor': {
      holder.add(box(0.78, 1.25, 0.72, mats.body, 0, 0.63, 0));
      holder.add(box(0.6, 0.4, 0.06, mats.glow, 0, 0.86, 0.37));
      holder.add(box(0.86, 0.09, 0.8, mats.glow, 0, 1.3, 0));
      holder.add(box(0.3, 0.24, 0.06, mats.accent, 0, 0.35, 0.37));
      break;
    }
    default:
      break;
  }
  return holder;
}

function buildBench(
  descriptor: ResolvedDressingDescriptor,
  mats: DressingMaterialSet,
): THREE.Group {
  mats.body.color.setHex(descriptor.benchColor);
  mats.accent.color.setHex(0x4a4f56);
  const holder = new THREE.Group();
  switch (descriptor.benchStyle) {
    case 'woodSlat': {
      for (let slat = 0; slat < 4; slat += 1) {
        holder.add(box(1.9, 0.06, 0.12, mats.body, 0, 0.46, -0.22 + slat * 0.14));
      }
      for (let slat = 0; slat < 3; slat += 1) {
        holder.add(box(1.9, 0.12, 0.06, mats.body, 0, 0.62 + slat * 0.16, -0.28));
      }
      holder.add(box(0.09, 0.46, 0.5, mats.accent, -0.8, 0.23, 0));
      holder.add(box(0.09, 0.46, 0.5, mats.accent, 0.8, 0.23, 0));
      break;
    }
    case 'concrete': {
      holder.add(box(2.1, 0.16, 0.62, mats.body, 0, 0.46, 0));
      holder.add(box(2.0, 0.4, 0.14, mats.body, 0, 0.62, -0.24));
      holder.add(box(0.36, 0.46, 0.5, mats.body, -0.72, 0.23, 0));
      holder.add(box(0.36, 0.46, 0.5, mats.body, 0.72, 0.23, 0));
      break;
    }
    case 'metalMesh': {
      holder.add(box(1.9, 0.09, 0.56, mats.body, 0, 0.47, 0));
      holder.add(box(1.86, 0.34, 0.07, mats.body, 0, 0.68, -0.24));
      holder.add(box(0.12, 0.46, 0.5, mats.accent, -0.78, 0.23, 0));
      holder.add(box(0.12, 0.46, 0.5, mats.accent, 0.78, 0.23, 0));
      break;
    }
    case 'composite': {
      for (let slat = 0; slat < 3; slat += 1) {
        holder.add(box(2.0, 0.07, 0.15, mats.body, 0, 0.46, -0.18 + slat * 0.18));
      }
      holder.add(box(2.0, 0.12, 0.08, mats.body, 0, 0.72, -0.3));
      holder.add(box(0.1, 0.44, 0.54, mats.accent, -0.84, 0.22, 0));
      holder.add(box(0.1, 0.44, 0.54, mats.accent, 0.84, 0.22, 0));
      holder.add(box(0.5, 0.5, 0.1, mats.glow, -0.6, 0.42, 0.26));
      break;
    }
    default:
      break;
  }
  return holder;
}

function buildTree(
  descriptor: ResolvedDressingDescriptor,
  mats: DressingMaterialSet,
): THREE.Group {
  mats.body.color.setHex(0x5a4634);
  mats.accent.color.setHex(descriptor.treeColor);
  const holder = new THREE.Group();
  holder.add(cylinder(0.16, 0.24, 3.2, mats.body, 0, 1.6, 0, 8));

  const species = descriptor.treeSpecies;
  const canopyY = species === 'cherry' ? 4.0 : 4.4;
  const radius = species === 'climateOak' ? 2.1 : species === 'maple' ? 1.9 : 1.7;
  holder.add(sphere(radius, mats.accent, 0, canopyY, 0));
  holder.add(
    sphere(
      radius * 0.72,
      mats.accent,
      radius * 0.5,
      canopyY + (species === 'plane' ? 0.9 : 0.6),
      radius * 0.3,
    ),
  );
  holder.add(
    sphere(
      radius * 0.62,
      mats.accent,
      -radius * 0.55,
      canopyY + (species === 'lime' ? 1.0 : 0.55),
      -radius * 0.35,
    ),
  );

  switch (descriptor.treePitStyle) {
    case 'openSoil':
      holder.add(box(1.7, 0.06, 1.7, mats.body, 0, 0.03, 0));
      break;
    case 'grate':
      holder.add(box(1.8, 0.07, 1.8, mats.body, 0, 0.04, 0));
      holder.add(box(1.9, 0.05, 0.16, mats.body, 0, 0.07, 0));
      holder.add(box(0.16, 0.05, 1.9, mats.body, 0, 0.07, 0));
      break;
    case 'planter':
      holder.add(box(2.0, 0.34, 2.0, mats.body, 0, 0.17, 0));
      holder.add(box(2.1, 0.08, 2.1, mats.accent, 0, 0.36, 0));
      break;
    case 'rainGarden':
      holder.add(box(2.3, 0.22, 2.3, mats.body, 0, 0.11, 0));
      holder.add(box(2.0, 0.12, 2.0, mats.accent, 0, 0.24, 0));
      holder.add(box(0.6, 0.08, 0.6, mats.body, 0.9, 0.26, 0));
      break;
    default:
      break;
  }
  return holder;
}

function buildBoothLineage(
  descriptor: ResolvedDressingDescriptor,
  mats: DressingMaterialSet,
): THREE.Group {
  mats.accent.color.setHex(descriptor.boothColor);
  const holder = new THREE.Group();
  switch (descriptor.boothStyle) {
    case 'phoneBooth': {
      holder.add(box(1.1, 0.14, 1.1, mats.accent, 0, 0.07, 0));
      holder.add(box(1.0, 2.3, 1.0, mats.accent, 0, 1.29, 0));
      holder.add(box(0.72, 1.2, 0.06, mats.body, 0, 1.7, 0.53));
      holder.add(box(0.72, 1.0, 0.06, mats.body, 0, 1.6, -0.53));
      holder.add(box(0.86, 0.2, 0.86, mats.accent, 0, 2.54, 0));
      holder.add(box(0.6, 0.16, 0.05, mats.glow, 0, 2.32, 0.5));
      break;
    }
    case 'phoneBank': {
      for (const side of [-0.62, 0.62]) {
        holder.add(box(0.92, 2.35, 0.92, mats.accent, side, 1.18, 0));
        holder.add(box(0.66, 1.2, 0.06, mats.body, side, 1.75, 0.47));
        holder.add(box(0.78, 0.14, 0.78, mats.body, side, 2.42, 0));
      }
      holder.add(box(2.2, 0.1, 1.0, mats.accent, 0, 2.56, 0));
      break;
    }
    case 'kiosk': {
      holder.add(box(1.6, 0.16, 1.2, mats.accent, 0, 0.08, 0));
      holder.add(box(1.5, 2.2, 1.1, mats.accent, 0, 1.26, 0));
      holder.add(box(1.1, 0.8, 0.06, mats.glow, 0, 1.7, 0.57));
      holder.add(box(0.4, 0.5, 0.06, mats.body, -0.5, 1.7, 0.57));
      holder.add(box(1.7, 0.16, 1.3, mats.body, 0, 2.44, 0));
      holder.add(box(0.24, 0.24, 0.05, mats.glow, 0.6, 2.7, 0.4));
      break;
    }
    case 'payphone': {
      holder.add(box(0.7, 0.16, 0.7, mats.accent, 0, 0.08, 0));
      holder.add(box(0.4, 1.6, 0.34, mats.accent, 0, 0.96, 0));
      holder.add(box(0.56, 0.42, 0.14, mats.body, 0, 1.9, 0.1));
      holder.add(box(0.34, 0.12, 0.05, mats.glow, 0, 1.66, 0.19));
      break;
    }
    case 'chargingPillar': {
      holder.add(box(0.62, 0.12, 0.62, mats.accent, 0, 0.06, 0));
      holder.add(box(0.44, 2.2, 0.36, mats.accent, 0, 1.16, 0));
      holder.add(box(0.34, 0.5, 0.05, mats.glow, 0, 1.6, 0.19));
      holder.add(box(0.36, 0.06, 0.06, mats.glow, 0, 1.05, 0.2));
      holder.add(box(0.18, 0.3, 0.18, mats.body, 0.28, 0.9, 0));
      holder.add(cylinder(0.035, 0.035, 0.7, mats.body, 0.34, 0.5, 0, 6));
      holder.add(box(0.44, 0.1, 0.44, mats.body, 0, 2.31, 0));
      break;
    }
    default:
      break;
  }
  return holder;
}

function buildNewsstand(
  descriptor: ResolvedDressingDescriptor,
  mats: DressingMaterialSet,
): THREE.Group {
  mats.body.color.setHex(descriptor.newsstandColor);
  mats.accent.color.setHex(0xd8d4c8);
  const holder = new THREE.Group();
  switch (descriptor.newsstandStyle) {
    case 'timberKiosk': {
      holder.add(box(2.4, 1.8, 1.4, mats.body, 0, 0.9, 0));
      holder.add(box(2.5, 0.1, 1.7, mats.accent, 0, 1.86, 0));
      holder.add(box(2.4, 0.9, 0.5, mats.body, 0, 2.5, -0.3));
      holder.add(box(1.0, 0.7, 0.06, mats.accent, -0.6, 1.2, 0.72));
      break;
    }
    case 'pressKiosk': {
      holder.add(box(2.2, 1.9, 1.3, mats.body, 0, 0.95, 0));
      holder.add(box(2.3, 0.12, 1.5, mats.accent, 0, 1.96, 0));
      holder.add(box(1.6, 0.5, 0.06, mats.glow, 0, 1.6, 0.67));
      holder.add(box(1.2, 0.4, 0.4, mats.accent, 0, 0.5, 0.85));
      break;
    }
    case 'magazineStand': {
      holder.add(box(2.0, 1.6, 1.0, mats.body, 0, 0.8, 0));
      for (let shelf = 0; shelf < 3; shelf += 1) {
        holder.add(box(1.9, 0.05, 0.5, mats.accent, 0, 0.7 + shelf * 0.4, 0.32));
      }
      holder.add(box(2.1, 0.1, 1.2, mats.accent, 0, 1.65, 0));
      holder.add(box(0.9, 0.5, 0.05, mats.accent, 0, 2.1, -0.4));
      break;
    }
    case 'microRetail': {
      holder.add(box(2.3, 2.3, 1.5, mats.body, 0, 1.15, 0));
      holder.add(box(1.9, 1.1, 0.06, mats.body, 0, 1.5, 0.78));
      holder.add(box(2.4, 0.14, 1.7, mats.accent, 0, 2.36, 0));
      holder.add(box(2.0, 0.4, 0.06, mats.glow, 0, 2.05, 0.78));
      holder.add(box(1.6, 0.3, 0.6, mats.accent, 0, 0.4, 0.9));
      break;
    }
    case 'parcelLocker': {
      holder.add(box(2.6, 2.4, 0.8, mats.body, 0, 1.2, 0));
      for (let cell = 0; cell < 6; cell += 1) {
        const row = cell % 3;
        const column = cell < 3 ? -0.6 : 0.6;
        holder.add(box(0.56, 0.62, 0.06, mats.accent, column, 0.55 + row * 0.66, 0.42));
      }
      holder.add(box(0.7, 0.5, 0.06, mats.glow, 0, 1.7, 0.44));
      holder.add(box(2.66, 0.1, 0.86, mats.glow, 0, 2.46, 0));
      break;
    }
    default:
      break;
  }
  return holder;
}

function buildDrone(mats: DressingMaterialSet): THREE.Group {
  const holder = new THREE.Group();
  holder.add(box(0.6, 0.16, 0.6, mats.body, 0, 0, 0));
  for (const [x, z] of [
    [-0.42, -0.42],
    [0.42, -0.42],
    [-0.42, 0.42],
    [0.42, 0.42],
  ] as const) {
    holder.add(cylinder(0.22, 0.22, 0.03, mats.accent, x, 0.06, z, 10));
    holder.add(cylinder(0.04, 0.04, 0.14, mats.body, x * 0.6, 0.02, z * 0.6, 6));
  }
  holder.add(sphere(0.12, mats.glow, 0, -0.14, 0));
  return holder;
}

/* ------------------------------------------------------------------------- *
 * StreetDressing
 * ------------------------------------------------------------------------- */

/** Per-family read-out for a HUD or a probe. */
export interface DressingFamilySnapshot {
  readonly family: DressingFamilyId;
  readonly label: string;
  readonly placements: number;
  readonly style: string;
  readonly color: number;
  readonly visible: number;
  readonly meshes: number;
}

export interface StreetDressingSnapshot {
  readonly version: number;
  readonly era: EraId;
  readonly from: EraId;
  readonly to: EraId;
  readonly progress: number;
  readonly transitioning: boolean;
  readonly families: readonly DressingFamilySnapshot[];
  readonly totalPlacements: number;
  readonly visiblePlacements: number;
  readonly totalMeshes: number;
  readonly notablePlacements: number;
  readonly boothLineageName: string;
  readonly lampStyle: LampStyle;
  readonly droneLightCount: number;
}

export interface StreetDressingOptions {
  readonly context: SceneContext;
  readonly library: MaterialLibrary;
  readonly parent?: THREE.Object3D | null;
  readonly initialEra?: EraId;
  /** Override the authored anchoring plan (tests inject a fixture plan). */
  readonly placements?: readonly DressingPlacement[];
}

interface AnchorRecord {
  readonly placement: DressingPlacement;
  readonly anchor: THREE.Group;
  readonly variants: Map<EraId, THREE.Group>;
}

export class StreetDressing {
  readonly version = STREET_DRESSING_VERSION;

  /** Root every anchor hangs from. */
  readonly root: THREE.Group;

  /** The authored (or injected) anchoring plan. */
  readonly placements: readonly DressingPlacement[];

  private readonly library: MaterialLibrary;
  private readonly parent: THREE.Object3D;
  private readonly materialSets = new Map<string, DressingMaterialSet>();
  private readonly records = new Map<DressingFamilyId, AnchorRecord[]>();

  private fromEra: EraId;
  private toEra: EraId;
  private progressState = 1;
  private paletteState: EraColorPalette;
  private disposedState = false;

  constructor(options: StreetDressingOptions) {
    if (!options?.context) throw new TypeError('StreetDressing needs a SceneContext.');
    if (!options.library) throw new TypeError('StreetDressing needs a MaterialLibrary.');
    this.library = options.library;
    this.parent = options.parent ?? options.context.scene;

    this.root = new THREE.Group();
    this.root.name = STREET_DRESSING_ROOT_NAME;
    this.placements = options.placements ?? DRESSING_PLACEMENTS;

    for (const family of DRESSING_FAMILY_IDS) this.records.set(family, []);

    for (const item of this.placements) {
      const anchor = new THREE.Group();
      anchor.name = `chrono-dressing-${item.id}`;
      anchor.position.set(item.position.x, 0, item.position.z);
      anchor.rotation.y = item.yaw;
      anchor.userData.chronoDressingFamily = item.family;
      anchor.userData.chronoDressingId = item.id;
      anchor.userData.chronoDressingNotable = item.notable;
      this.root.add(anchor);
      this.records.get(item.family)?.push({ placement: item, anchor, variants: new Map() });
    }

    this.parent.add(this.root);

    const initial = assertEraId(options.initialEra ?? '2025');
    this.fromEra = initial;
    this.toEra = initial;
    this.paletteState = { ...NEUTRAL_PALETTE };
    this.applyBlend(initial, initial, 1, null);
  }

  /* ---------------- state ---------------- */

  get era(): EraId {
    return this.toEra;
  }

  get from(): EraId {
    return this.fromEra;
  }

  get progress(): number {
    return this.progressState;
  }

  get isTransitioning(): boolean {
    return this.fromEra !== this.toEra;
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  /** Snaps the street to an era. */
  applyEra(era: EraId): void {
    this.applyBlend(era, era, 1, null);
  }

  /** Crossfades the outgoing and incoming era's furniture. */
  applyBlend(
    from: EraId,
    to: EraId,
    progress: number,
    palette: EraColorPalette | null,
  ): void {
    if (this.disposedState) return;
    const source = assertEraId(from);
    const target = assertEraId(to);
    const t = clamp01(progress);
    this.fromEra = source;
    this.toEra = target;
    this.progressState = t;
    if (palette) this.paletteState = palette;

    const sourceWeight = source === target ? 0 : 1 - t;
    const targetWeight = source === target ? 1 : t;

    for (const family of DRESSING_FAMILY_IDS) {
      const records = this.records.get(family);
      if (!records) continue;
      for (const record of records) {
        if (source !== target) {
          this.applyVariantWeight(this.variantFor(record, family, source), sourceWeight, family);
        }
        this.applyVariantWeight(this.variantFor(record, family, target), targetWeight, family);
        for (const [era, variant] of record.variants) {
          if (era === source || era === target) continue;
          this.applyVariantWeight(variant, 0, family);
        }
      }
    }
  }

  /* ---------------- observation ---------------- */

  /** Resolved style id of one family for the era being shown. */
  familyStyle(family: DressingFamilyId, era: EraId = this.toEra): string {
    const descriptor = getDressingDescriptor(era);
    switch (family) {
      case 'lamps':
        return descriptor.lampStyle;
      case 'hydrants':
        return descriptor.hydrantStyle;
      case 'mailboxes':
        return descriptor.mailboxStyle;
      case 'trashCans':
        return descriptor.trashStyle;
      case 'benches':
        return descriptor.benchStyle;
      case 'trees':
        return `${descriptor.treeSpecies}/${descriptor.treePitStyle}`;
      case 'boothLineage':
        return descriptor.boothStyle;
      case 'newsstands':
        return descriptor.newsstandStyle;
      case 'droneLights':
        return `drones-${descriptor.droneLightCount}`;
      default:
        return 'unknown';
    }
  }

  snapshot(): StreetDressingSnapshot {
    const families: DressingFamilySnapshot[] = [];
    let totalMeshes = 0;
    let visiblePlacements = 0;
    let notablePlacements = 0;

    for (const family of DRESSING_FAMILY_IDS) {
      const records = this.records.get(family) ?? [];
      let meshes = 0;
      let visible = 0;
      for (const record of records) {
        const variant = record.variants.get(this.toEra);
        if (variant && variant.visible) {
          visible += 1;
          meshes += countMeshes(variant);
        }
        if (record.placement.notable) notablePlacements += 1;
      }
      totalMeshes += meshes;
      visiblePlacements += visible;
      families.push(
        Object.freeze({
          family,
          label: DRESSING_FAMILY_LABELS[family],
          placements: records.length,
          style: this.familyStyle(family),
          color: this.familyColor(family),
          visible,
          meshes,
        }),
      );
    }

    return Object.freeze({
      version: STREET_DRESSING_VERSION,
      era: this.toEra,
      from: this.fromEra,
      to: this.toEra,
      progress: this.progressState,
      transitioning: this.fromEra !== this.toEra,
      families: Object.freeze(families),
      totalPlacements: this.placements.length,
      visiblePlacements,
      totalMeshes,
      notablePlacements,
      boothLineageName: dressingFixtureName('street-booth-lineage', this.toEra) ?? 'booth',
      lampStyle: getDressingDescriptor(this.toEra).lampStyle,
      droneLightCount: getDressingDescriptor(this.toEra).droneLightCount,
    });
  }

  /** Inspectable definitions for every notable placement. */
  inspectableDefinitions(): readonly InspectableDefinition[] {
    const definitions: InspectableDefinition[] = [];
    for (const family of DRESSING_FAMILY_IDS) {
      const records = this.records.get(family) ?? [];
      for (const record of records) {
        if (!record.placement.notable) continue;
        const id = `${DRESSING_INSPECTABLE_PREFIX}${record.placement.id}`;
        const copy = DRESSING_COPY[id];
        if (!copy) continue;
        definitions.push({
          id,
          object: record.anchor,
          copy,
          label: DRESSING_FAMILY_LABELS[family],
          data: Object.freeze({
            system: 'environment-dressing',
            family,
            eras: ERA_IDS,
          }),
        });
      }
    }
    return Object.freeze(definitions);
  }

  /** Releases every geometry, detaches the root and clears the variant cache. */
  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    this.records.clear();
    this.materialSets.clear();
    this.root.removeFromParent();
    this.root.clear();
  }

  /* ---------------- internals ---------------- */

  private familyColor(family: DressingFamilyId): number {
    const descriptor = getDressingDescriptor(this.toEra);
    switch (family) {
      case 'lamps':
        return descriptor.lampColor;
      case 'hydrants':
        return descriptor.hydrantColor;
      case 'mailboxes':
        return descriptor.mailboxColor;
      case 'trashCans':
        return descriptor.trashColor;
      case 'benches':
        return descriptor.benchColor;
      case 'trees':
        return descriptor.treeColor;
      case 'boothLineage':
        return descriptor.boothColor;
      case 'newsstands':
        return descriptor.newsstandColor;
      case 'droneLights':
        return this.paletteState.emissive;
      default:
        return 0xffffff;
    }
  }

  private materialSet(family: DressingFamilyId, era: EraId): DressingMaterialSet {
    const key = `${family}@${era}`;
    const cached = this.materialSets.get(key);
    if (cached) return cached;

    const surfaces = FAMILY_SURFACES[family];
    const descriptor = getDressingDescriptor(era);
    const neutral = { base: '#d6d6d6', accent: '#a8a8a8', grime: '#5f5f5f', highlight: '#f4f4f4' };

    const body = this.library.get({
      surface: surfaces.body,
      palette: neutral,
      name: `chrono-dressing-${family}-${era}-body`,
      size: 128,
      roughness: family === 'trees' ? 0.95 : 0.6,
      metalness: family === 'benches' && descriptor.benchStyle === 'metalMesh' ? 0.5 : 0.25,
    });
    const accent = this.library.get({
      surface: surfaces.accent,
      palette: neutral,
      name: `chrono-dressing-${family}-${era}-accent`,
      size: 128,
      roughness: 0.7,
      metalness: 0.1,
    });
    const glow = this.library.get({
      surface: 'neon',
      palette: neutral,
      name: `chrono-dressing-${family}-${era}-glow`,
      size: 128,
      emissiveIntensity: clampGlow(descriptor.lampGlow),
      roughness: 0.3,
      metalness: 0.05,
    });

    for (const material of [body, accent, glow]) {
      if (material.userData.chronoBaseEmissiveIntensity === undefined) {
        material.userData.chronoBaseEmissiveIntensity = material.emissiveIntensity;
      }
    }

    const set = { body, accent, glow };
    this.materialSets.set(key, set);
    return set;
  }

  private variantFor(record: AnchorRecord, family: DressingFamilyId, era: EraId): THREE.Group {
    const cached = record.variants.get(era);
    if (cached) return cached;

    const descriptor = resolve(getDressingDescriptor(era));
    const mats = this.materialSet(family, era);
    const variant = this.buildVariant(family, descriptor, mats);
    variant.name = `${record.placement.id}-${era}`;
    variant.userData.chronoDressingEra = era;
    variant.visible = false;
    record.anchor.add(variant);
    record.variants.set(era, variant);
    return variant;
  }

  private buildVariant(
    family: DressingFamilyId,
    descriptor: ResolvedDressingDescriptor,
    mats: DressingMaterialSet,
  ): THREE.Group {
    switch (family) {
      case 'lamps':
        return group('lamp', buildLamp(descriptor, mats));
      case 'hydrants':
        return group('hydrant', buildHydrant(descriptor, mats));
      case 'mailboxes':
        return group('mailbox', buildMailbox(descriptor, mats));
      case 'trashCans':
        return group('bin', buildTrashCan(descriptor, mats));
      case 'benches':
        return group('bench', buildBench(descriptor, mats));
      case 'trees':
        return group('tree', buildTree(descriptor, mats));
      case 'boothLineage':
        return group('booth-lineage', buildBoothLineage(descriptor, mats));
      case 'newsstands':
        return group('newsstand', buildNewsstand(descriptor, mats));
      case 'droneLights':
        return this.buildDrones(descriptor, mats);
      default:
        return group('empty');
    }
  }

  private buildDrones(
    descriptor: ResolvedDressingDescriptor,
    mats: DressingMaterialSet,
  ): THREE.Group {
    const holder = new THREE.Group();
    const count = Math.max(0, Math.round(descriptor.droneLightCount));
    mats.glow.color.setHex(this.paletteState.emissive);
    mats.glow.emissive.setHex(this.paletteState.emissive);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / Math.max(1, count)) * Math.PI * 2;
      const radius = 3 + (index % 3) * 2.4;
      const drone = buildDrone(mats);
      drone.position.set(Math.cos(angle) * radius, 22 + (index % 3) * 3, Math.sin(angle) * radius);
      drone.rotation.y = angle;
      holder.add(drone);
    }
    holder.visible = count > 0;
    return holder;
  }

  private applyVariantWeight(
    variant: THREE.Group,
    weight: number,
    family: DressingFamilyId,
  ): void {
    const visible = weight > 0.02;
    variant.visible = visible;
    if (!visible) return;
    variant.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (!material || Array.isArray(material)) return;
      material.transparent = weight < 0.995;
      material.opacity = Math.max(0.02, weight);
      // Airborne glowing fixtures (drone lights) never occlude the street below.
      material.depthWrite = weight > 0.6 && family !== 'droneLights';
    });
  }
}

const NEUTRAL_PALETTE: EraColorPalette = Object.freeze({
  sky: 0x9fb3c8,
  skyHorizon: 0xcdbfa8,
  ground: 0x4a4238,
  asphalt: 0x35322e,
  sidewalk: 0xb0a894,
  buildingPrimary: 0x8a6f5a,
  buildingSecondary: 0x6f6455,
  ambient: 0x4a5461,
  emissive: 0xd9f2ff,
  accents: Object.freeze([0x7d2f2a, 0x2f4a5a, 0x8a7a4a]),
  notes: 'environment fallback palette',
});

function clampGlow(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(0, value));
}

function countMeshes(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) total += 1;
  });
  return total;
}

/** Creates the block's era street dressing (the `create` half of the lifecycle). */
export function createStreetDressing(options: StreetDressingOptions): StreetDressing {
  return new StreetDressing(options);
}

/** Eras this module authors a dressing set for, in timeline order. */
export const DRESSING_ERAS: readonly EraId[] = ERA_IDS;
