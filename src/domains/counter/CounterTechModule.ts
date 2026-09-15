/**
 * Counter technology scene module — everything the café takes money with, from
 * the 1945 manual till to the 2025 tablet and contactless reader.
 *
 * One module owns the whole point-of-sale detail set, exactly the way the frozen
 * {@link SceneModule} contract expects:
 *
 *  - `build(context)` raises a single `counter` group holding one named sub
 *    group per prop family (`counter-tech-register`, `-payment`, `-cash`,
 *    `-docket`, `-signage`, `-cabling`, `-pickup`) and builds the era's
 *    inventory from the era data file plus the environment's published anchors.
 *  - `applyPeriod(period, context)` rebuilds the counter for the new era. The
 *    equipment *is* the period — a lever till is not a tablet — so the previous
 *    group is released before the next is raised: exactly one era's counter is
 *    ever attached, which is what makes the timeline read as a replacement.
 *  - `update(delta, context)` drives the era's animation deterministically from
 *    `context.elapsedSeconds`: the 1985 LED blink, the 2005 CRT and 2025 tablet
 *    screen breathing, the receipt tape feed of 1965/1985/2005 (paper travels
 *    and the printed lines scroll), the cash-drawer nudge every era shares, the
 *    1945 lever and bell, the 1965 crank and the 2025 contactless tap
 *    acknowledgement. Nothing is allocated per frame.
 *  - `dispose()` releases every geometry, material, texture and node it created
 *    and detaches its group, so switching years repeatedly neither grows the
 *    scene graph nor leaks tracked resources.
 *  - `getHotspots()` exposes the era's register/POS, its payment device and the
 *    counter surface (plus the era's paper, cards, reader and pickup shelf) for
 *    inspect mode.
 *
 * Placement is *planned* before it is built: {@link planCounterTech} turns the
 * era spec plus the environment's {@link StructuralLayout} and {@link RoomBounds}
 * into a complete, geometry-free list of {@link PlacedCounterProp}s, each naming
 * the anchor it came from (`counter-top-handoff-end`, `floor-right-beside-counter`),
 * sitting flush on that anchor's published support, and reporting an axis-aligned
 * box inside the published room. {@link validateCounterPlan} then checks the plan
 * against the room and the shell's fixed geometry (counter slab, pass mats,
 * splashback, back-bar uprights, back-bar shelves) and
 * {@link counterShellClearanceBoxes} publishes exactly what was checked.
 *
 * The till island is derived, never hardcoded: it is the free strip at the
 * counter's service end — clear of the back-room doorway the environment
 * reserves in the back wall, left of the machine, grinder and tray-run bays, in
 * front of the splashback and behind the service face — so the counter domain
 * shares the counter without fighting its neighbours for the machine bays or
 * blocking a doorway.
 */

import * as THREE from 'three';
import {
  DEFAULT_YEAR_ID,
  YEAR_IDS,
  yearToNumber,
  type BuildContext,
  type DomainSpecBase,
  type Hotspot,
  type HotspotKind,
  type PeriodDefinition,
  type RoomBounds,
  type RoomPoint,
  type SceneModule,
  type UpdateContext,
  type YearId,
} from '../../contracts/period';
import { disposeObject3D } from '../../core/kernel';
import {
  CAFE_ROOM_BOUNDS,
  STRUCTURAL_LAYOUT,
  validateLayout,
  type StructuralLayout,
} from '../environment';
import {
  counterMaterialSetSignature,
  createCounterMaterialSet,
  disposeCounterMaterialSet,
  type CounterCanvasFactory,
  type CounterMaterialSet,
  type CounterMaterialSlot,
  type CounterSurfaceOverride,
} from './textures/labels';
import { SPEC_1945 } from './data/1945';
import { SPEC_1965 } from './data/1965';
import { SPEC_1985 } from './data/1985';
import { SPEC_2005 } from './data/2005';
import { SPEC_2025 } from './data/2025';
import { mechanicalRegisterDevice } from './props/mechanicalRegister';
import { electronicRegisterDevice } from './props/electronicRegister';
import { manualTillDevice } from './props/manualTill';
import { posTerminalDevice } from './props/posTerminal';
import { tabletContactlessDevice } from './props/tabletContactless';

/* -------------------------------------------------------------------------- */
/* Identity and layout constants                                              */
/* -------------------------------------------------------------------------- */

/** Stable module id: registry key, hotspot owner id and node namespace. */
export const COUNTER_TECH_MODULE_ID = 'counter';

/** Name of the single group every counter node is parented to. */
export const COUNTER_TECH_GROUP_NAME = 'counter';

/** Named sub group per prop family, so the scene graph stays addressable. */
export const COUNTER_GROUP_NAMES: Readonly<Record<CounterPropGroup, string>> = Object.freeze({
  register: 'counter-tech-register',
  payment: 'counter-tech-payment',
  cash: 'counter-tech-cash',
  docket: 'counter-tech-docket',
  signage: 'counter-tech-signage',
  cabling: 'counter-tech-cabling',
  pickup: 'counter-tech-pickup',
});

/** Clearance kept above the counter top's pass-mat datum (mats are 20 mm proud). */
export const COUNTER_TOP_CLEARANCE = 0.021;
/** Width of the till island along the counter's service end, in metres. */
export const COUNTER_ISLAND_WIDTH = 0.44;
/** Gap between the island and the counter's end panel. */
export const COUNTER_ISLAND_END_MARGIN = 0.02;
/** Gap kept in front of the counter's splashback. */
export const COUNTER_ISLAND_SPLASH_GAP = 0.05;
/** Gap kept behind the counter's service face. */
export const COUNTER_ISLAND_FRONT_GAP = 0.02;
/** Depth of the back band of the island (coin trays, printers, spare rolls). */
export const COUNTER_BACK_BAND_DEPTH = 0.36;
/** Depth of the front band of the island (the till or terminal itself). */
export const COUNTER_FRONT_BAND_DEPTH = 0.31;
/** Depth of the customer lip of the island (readers, cards, tip jar). */
export const COUNTER_LIP_BAND_DEPTH = 0.1;
/** Gap kept between the 2025 pickup shelf and the right-hand wall. */
export const COUNTER_FLOOR_WALL_GAP = 0.08;/** Gap between the pickup shelf and the counter's service face. */
export const COUNTER_FLOOR_GAP = 0.25;
/** Anchor id of the till island's counter-top placement. */
export const COUNTER_ISLAND_ANCHOR_ID = 'counter-top-service-end';
/** Anchor id of the pickup shelf's floor placement. */
export const COUNTER_FLOOR_ANCHOR_ID = 'floor-right-beside-counter';
/** Prefix of the stacked "on top of the drawer" anchor id. */
export const COUNTER_DRAWER_ANCHOR_PREFIX = 'counter-drawer-shell';
/** Tolerance used when validating placements. */
export const COUNTER_PLACEMENT_EPSILON = 1e-4;
/** Fraction of the drawer cycle the animation starts at (so t = 0 is closed). */
export const COUNTER_DRAWER_PHASE = 0.4;

/* -------------------------------------------------------------------------- */
/* Era vocabulary                                                             */
/* -------------------------------------------------------------------------- */

/** Which prop family builds an era's inventory. */
export type CounterDeviceFamily =
  | 'manual-till'
  | 'mechanical-register'
  | 'electronic-register'
  | 'pos-terminal'
  | 'tablet-contactless';

/** Prop family a placement belongs to (drives the named sub group). */
export type CounterPropGroup =
  | 'register'
  | 'payment'
  | 'cash'
  | 'docket'
  | 'signage'
  | 'cabling'
  | 'pickup';

/** Where inside the counter a prop is placed from. */
export type CounterPlacementBand =
  | 'counter-back'
  | 'counter-front'
  | 'counter-lip'
  | 'drawer-line'
  | 'floor-side';

/** What a prop stands on. */
export type CounterSupport = 'counter' | 'drawer' | 'floor';

/** How the era presents its display. */
export type CounterDisplayKind = 'none' | 'mechanical-dial' | 'led' | 'crt' | 'tablet';

/** How the era takes money. */
export type CounterPaymentMode = 'cash-only' | 'cash-first' | 'card-and-cash' | 'contactless-first';

/**
 * Every counter prop kind the five eras use. Kinds shared between eras (the cash
 * drawer, coin tray, tip jar, cable, receipt printer and paper) are built once
 * per era, era-correctly, by that era's prop builder.
 */
export type CounterPropKind =
  // shared
  | 'cash-drawer'
  | 'coin-tray'
  | 'tip-jar'
  | 'cable'
  | 'price-card'
  | 'printed-label'
  | 'receipt-printer'
  | 'receipt-roll'
  | 'receipt-tape'
  // 1945
  | 'till-body'
  | 'till-lid'
  | 'till-lever'
  | 'till-bell'
  | 'drawer-pull'
  | 'docket-pad'
  | 'docket-pencil'
  | 'ledger'
  // 1965
  | 'register-body'
  | 'register-crank'
  // 1985
  | 'ecr-body'
  | 'display-led'
  | 'barcode-scanner'
  | 'scanner-goods'
  // 2005
  | 'pos-terminal'
  | 'crt-monitor'
  | 'card-terminal'
  | 'loyalty-cards'
  // 2025
  | 'tablet-stand'
  | 'tablet'
  | 'contactless-reader'
  | 'tap-target'
  | 'qr-card'
  | 'pickup-shelf'
  | 'order-tickets';

/* -------------------------------------------------------------------------- */
/* Era data                                                                   */
/* -------------------------------------------------------------------------- */

/** Extents of a prop's axis-aligned box, in metres. */
export interface CounterPropSize {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A prop's offset from its band anchor, in metres. */
export interface CounterOffset {
  readonly x: number;
  readonly z: number;
}

/** One prop of an era's counter inventory, before placement. */
export interface CounterInventoryEntry {
  /** Stable id inside the era (`till-body`, `cash-drawer`). */
  readonly id: string;
  readonly kind: CounterPropKind;
  /** Human readable name (hotspot labels, diagnostics). */
  readonly label: string;
  /** Prose detail for inspect mode. */
  readonly detail: string;
  readonly group: CounterPropGroup;
  readonly band: CounterPlacementBand;
  /** Offset from the band anchor, before clamping into the island. */
  readonly offset: CounterOffset;
  readonly size: CounterPropSize;
  /** Height of the prop's box base above its support surface. */
  readonly lift: number;
  readonly rotationY: number;
  readonly material: CounterMaterialSlot;
  readonly trim: CounterMaterialSlot | null;
  readonly tags: readonly string[];
}

/** The era's animation recipe; every value is time-driven and deterministic. */
export interface CounterAnimationSpec {
  readonly displayKind: CounterDisplayKind;
  /** LED blink period, in seconds (`0` when the era never blinks). */
  readonly displayBlinkSeconds: number;
  /** Fraction of the blink period the LED stays lit. */
  readonly displayOnFraction: number;
  /** Peak emissive intensity of the lit face. */
  readonly displayGlow: number;
  /** Breathing period of a continuously lit screen, in seconds. */
  readonly screenBreatheSeconds: number;
  /** Period of the small status-lamp pulse (scanner, PIN pad, reader). */
  readonly statusPulseSeconds: number;
  /** Receipt paper feed speed, in metres per second (`0` = paperless). */
  readonly tapeSpeed: number;
  /** Length of paper between wraps, in metres. */
  readonly tapeLength: number;
  readonly drawerNudgeSeconds: number;
  readonly drawerNudgeDuration: number;
  readonly drawerNudgeMetres: number;
  /** How often the 2025 contactless reader acknowledges a tap. */
  readonly tapPeriodSeconds: number;
  readonly tapDurationSeconds: number;
  /** Prose description of what the era's counter does on its own. */
  readonly cue: string;
}

/** One era of counter technology: the device, its inventory and its animation. */
export interface CounterTechSpec extends DomainSpecBase {
  readonly year: YearId;
  readonly label: string;
  /** Era name (`'Post-war austerity'`). */
  readonly name: string;
  readonly summary: string;
  /** One line caption used by hotspots and diagnostics. */
  readonly caption: string;
  readonly deviceFamily: CounterDeviceFamily;
  /** The register, till or POS the era is known for. */
  readonly device: {
    readonly name: string;
    readonly kind: CounterPropKind;
    readonly detail: string;
  };
  /** How the era takes money, and the prop that carries it. */
  readonly payment: {
    readonly name: string;
    readonly kind: CounterPropKind;
    readonly mode: CounterPaymentMode;
    readonly detail: string;
  };
  /** Prose description of the era's display. */
  readonly displayDetail: string;
  readonly paletteName: string;
  readonly materialSetId: string;
  /** Per-era overrides of the counter's surface recipes. */
  readonly surfaces: Partial<Record<CounterMaterialSlot, CounterSurfaceOverride>>;
  readonly animation: CounterAnimationSpec;
  readonly inventory: readonly CounterInventoryEntry[];
  readonly notes: readonly string[];
}

/** Era data keyed by year, as the period registry aggregates it. */
export const COUNTER_TECH_SPECS: Readonly<Record<YearId, CounterTechSpec>> = Object.freeze({
  '1945': SPEC_1945,
  '1965': SPEC_1965,
  '1985': SPEC_1985,
  '2005': SPEC_2005,
  '2025': SPEC_2025,
});

/** The era data for `year`, or the default era for anything unrecognised. */
export function counterTechSpec(year: YearId | undefined): CounterTechSpec {
  const spec = year ? COUNTER_TECH_SPECS[year] : undefined;
  return spec ?? COUNTER_TECH_SPECS[DEFAULT_YEAR_ID];
}

/** One line summary of an era's counter, for diagnostics and the HUD. */
export function describeCounterTechSpec(spec: CounterTechSpec): string {
  const kinds = spec.inventory.map((entry) => entry.kind).join(', ');
  return `${spec.year} ${spec.device.name} (${spec.deviceFamily}, ${spec.payment.mode}) — ${spec.inventory.length} props: ${kinds}`;
}

/** Every prop kind an era's inventory contains, in plan order. */
export function counterInventoryKinds(spec: CounterTechSpec): readonly CounterPropKind[] {
  return spec.inventory.map((entry) => entry.kind);
}

/* -------------------------------------------------------------------------- */
/* Islands and bands                                                          */
/* -------------------------------------------------------------------------- */

/** The free strip of counter top the counter domain owns, derived from the layout. */
export interface CounterIslandRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Counter top height published by the environment. */
  readonly surfaceHeight: number;
  /** Support height props on the island stand on (top + mat clearance). */
  readonly datum: number;
  readonly center: RoomPoint;
  /** Anchor id every island placement names. */
  readonly anchorId: string;
}

/** One placement band: its centre, its extent and what it stands on. */
export interface CounterBandAnchor {
  readonly band: CounterPlacementBand;
  readonly anchorId: string;
  readonly support: CounterSupport;
  readonly centerX: number;
  readonly centerZ: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Half extents a prop may occupy inside the band, in metres. */
  readonly halfWidth: number;
  readonly halfDepth: number;
}

/**
 * The till island: the clear strip at the counter's service end. Derived from
 * the counter zone's published faces so a re-scaled room moves it with the room.
 */
export function counterIslandRect(layout: StructuralLayout): CounterIslandRect {
  const { counter } = layout;
  const minX = counter.center.x - counter.width / 2 + COUNTER_ISLAND_END_MARGIN;
  const maxX = minX + COUNTER_ISLAND_WIDTH;
  const minZ = counter.backFaceZ + COUNTER_ISLAND_SPLASH_GAP;
  const maxZ = counter.serviceFaceZ - COUNTER_ISLAND_FRONT_GAP;
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    surfaceHeight: counter.surfaceHeight,
    datum: roundMetres(counter.surfaceHeight + COUNTER_TOP_CLEARANCE),
    center: { x: (minX + maxX) / 2, y: counter.surfaceHeight, z: (minZ + maxZ) / 2 },
    anchorId: COUNTER_ISLAND_ANCHOR_ID,
  };
}

function roundMetres(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * The island's bands, plus the floor band beside the counter. The offsets are
 * measured from the island's own edges, so the bands follow any room size.
 */
export function counterBandAnchors(
  island: CounterIslandRect,
  layout: StructuralLayout,
): Readonly<Record<CounterPlacementBand, CounterBandAnchor>> {
  const halfWidth = (island.maxX - island.minX) / 2;
  const backMinZ = island.minZ;
  const backMaxZ = Math.min(backMinZ + COUNTER_BACK_BAND_DEPTH, island.maxZ);
  const frontMaxZ = island.maxZ - COUNTER_LIP_BAND_DEPTH - 0.01;
  const frontMinZ = Math.max(frontMaxZ - COUNTER_FRONT_BAND_DEPTH, backMaxZ);
  const lipMinZ = frontMaxZ + 0.01;
  const lipMaxZ = island.maxZ;
  return Object.freeze({
    'counter-back': Object.freeze({
      band: 'counter-back' as const,
      anchorId: island.anchorId,
      support: 'counter' as const,
      centerX: (island.minX + island.maxX) / 2,
      centerZ: (backMinZ + backMaxZ) / 2,
      minZ: backMinZ,
      maxZ: backMaxZ,
      halfWidth,
      halfDepth: (backMaxZ - backMinZ) / 2,
    }),
    'counter-front': Object.freeze({
      band: 'counter-front' as const,
      anchorId: island.anchorId,
      support: 'counter' as const,
      centerX: (island.minX + island.maxX) / 2,
      centerZ: (frontMinZ + frontMaxZ) / 2,
      minZ: frontMinZ,
      maxZ: frontMaxZ,
      halfWidth,
      halfDepth: (frontMaxZ - frontMinZ) / 2,
    }),
    'counter-lip': Object.freeze({
      band: 'counter-lip' as const,
      anchorId: island.anchorId,
      support: 'counter' as const,
      centerX: (island.minX + island.maxX) / 2,
      centerZ: (lipMinZ + lipMaxZ) / 2,
      minZ: lipMinZ,
      maxZ: lipMaxZ,
      halfWidth,
      halfDepth: (lipMaxZ - lipMinZ) / 2,
    }),
    'drawer-line': Object.freeze({
      band: 'drawer-line' as const,
      anchorId: COUNTER_DRAWER_ANCHOR_PREFIX,
      support: 'drawer' as const,
      centerX: (island.minX + island.maxX) / 2,
      centerZ: island.center.z,
      minZ: island.minZ,
      maxZ: island.maxZ,
      halfWidth,
      halfDepth: (island.maxZ - island.minZ) / 2,
    }),
    'floor-side': Object.freeze({
      band: 'floor-side' as const,
      anchorId: COUNTER_FLOOR_ANCHOR_ID,
      support: 'floor' as const,
      // The floor band hugs the right-hand wall beside the counter's service
      // face; the entry's own size decides where its box lands.
      centerX: layout.bounds.width / 2,
      centerZ: layout.counter.serviceFaceZ,
      minZ: layout.counter.serviceFaceZ,
      maxZ: layout.bounds.depth / 2,
      halfWidth: 0,
      halfDepth: 0,
    }),
  });
}

/* -------------------------------------------------------------------------- */
/* Placement                                                                  */
/* -------------------------------------------------------------------------- */

/** A prop placed in the room: the inventory entry plus its resolved box. */
export interface PlacedCounterProp extends CounterInventoryEntry {
  readonly center: RoomPoint;
  readonly support: CounterSupport;
  /** Height of the surface the prop stands on. */
  readonly supportHeight: number;
  readonly anchorId: string;
  /** Axis-aligned box of the prop, rotation taken into account. */
  readonly min: RoomPoint;
  readonly max: RoomPoint;
}

/** What the planner verified, and what it found. */
export interface CounterPlacementReport {
  readonly year: YearId;
  readonly family: CounterDeviceFamily;
  readonly propCount: number;
  readonly kinds: readonly CounterPropKind[];
  readonly anchorIds: readonly string[];
  readonly bandCounts: Readonly<Record<CounterPlacementBand, number>>;
  readonly groupCounts: Readonly<Record<CounterPropGroup, number>>;
  /** Ids of the shell clearance boxes the plan was checked against. */
  readonly clearance: readonly string[];
  /** One message per placement problem; empty means the plan is sound. */
  readonly problems: readonly string[];
  readonly signature: string;
}

/** The era's complete, geometry-free build plan. */
export interface CounterTechPlan {
  readonly year: YearId;
  readonly family: CounterDeviceFamily;
  readonly island: CounterIslandRect;
  readonly bands: Readonly<Record<CounterPlacementBand, CounterBandAnchor>>;
  readonly entries: readonly PlacedCounterProp[];
  readonly signature: string;
  readonly variationSeed: number;
  readonly report: CounterPlacementReport;
}

export interface CounterPlanInput {
  readonly year: YearId;
  readonly spec: CounterTechSpec;
  readonly layout: StructuralLayout;
  readonly bounds: RoomBounds;
  /** Module seed; only feeds the era's internal detail variation. */
  readonly seed?: number;
}

/** Extents of a rotated box, used for every axis-aligned placement check. */
export function counterWorldExtents(size: CounterPropSize, rotationY: number): CounterPropSize {
  const cos = Math.abs(Math.cos(rotationY));
  const sin = Math.abs(Math.sin(rotationY));
  return { x: size.x * cos + size.z * sin, y: size.y, z: size.x * sin + size.z * cos };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function boxOf(entry: CounterInventoryEntry, center: RoomPoint, rotationY: number): { min: RoomPoint; max: RoomPoint } {
  const extents = counterWorldExtents(entry.size, rotationY);
  return {
    min: {
      x: center.x - extents.x / 2,
      y: center.y - entry.size.y / 2,
      z: center.z - extents.z / 2,
    },
    max: {
      x: center.x + extents.x / 2,
      y: center.y + entry.size.y / 2,
      z: center.z + extents.z / 2,
    },
  };
}

/** Axis-aligned box of a placed prop. */
export function counterPropBounds(entry: PlacedCounterProp): { min: RoomPoint; max: RoomPoint } {
  return { min: entry.min, max: entry.max };
}

/** True when two boxes overlap by more than `epsilon` on every axis. */
export function counterBoxesOverlap(
  a: { readonly min: RoomPoint; readonly max: RoomPoint },
  b: { readonly min: RoomPoint; readonly max: RoomPoint },
  epsilon = COUNTER_PLACEMENT_EPSILON,
): boolean {
  return (
    a.min.x < b.max.x - epsilon &&
    b.min.x < a.max.x - epsilon &&
    a.min.y < b.max.y - epsilon &&
    b.min.y < a.max.y - epsilon &&
    a.min.z < b.max.z - epsilon &&
    b.min.z < a.max.z - epsilon
  );
}

/** One box of the shell's fixed geometry the counter must stay clear of. */
export interface CounterShellClearanceBox {
  readonly id: string;
  readonly reason: string;
  readonly min: RoomPoint;
  readonly max: RoomPoint;
}

/**
 * The environment shell's fixed geometry around the counter: the top slab, the
 * four counter-pass mats, the splashback, the back-bar uprights and the two
 * back-bar shelves. Derived from the structural layout alone, so the plan can be
 * validated headlessly without raising the shell.
 */
export function counterShellClearanceBoxes(layout: StructuralLayout): readonly CounterShellClearanceBox[] {
  const { counter, bounds } = layout;
  const halfDepth = bounds.depth / 2;
  const boxes: CounterShellClearanceBox[] = [];
  const push = (id: string, reason: string, min: RoomPoint, max: RoomPoint): void => {
    boxes.push({ id, reason, min, max });
  };

  push(
    'counter-top-slab',
    'the counter top slab',
    { x: counter.center.x - counter.width / 2, y: counter.baseHeight, z: counter.backFaceZ },
    { x: counter.center.x + counter.width / 2, y: counter.surfaceHeight, z: counter.serviceFaceZ },
  );

  layout.counterPassSlots.forEach((slot, index) => {
    push(
      `counter-pass-mat-${index + 1}`,
      'a counter pass mat',
      { x: slot.position.x - slot.width / 2, y: slot.surfaceHeight, z: slot.position.z - slot.depth / 2 },
      { x: slot.position.x + slot.width / 2, y: slot.surfaceHeight + 0.02, z: slot.position.z + slot.depth / 2 },
    );
  });

  push(
    'counter-splashback',
    'the tiled splashback',
    { x: counter.center.x - counter.width / 2, y: counter.surfaceHeight, z: -halfDepth + 0.03 },
    { x: counter.center.x + counter.width / 2, y: counter.surfaceHeight + 0.62, z: -halfDepth + 0.05 },
  );

  for (const side of [-1, 1]) {
    const x = counter.center.x + (counter.width / 2 - 0.12) * side;
    push(
      `counter-backbar-upright-${side < 0 ? 'left' : 'right'}`,
      'a back-bar upright',
      { x: x - 0.03, y: 1.375, z: -halfDepth + 0.04 },
      { x: x + 0.03, y: 2.425, z: -halfDepth + 0.32 },
    );
  }

  for (const height of [1.9, 2.4]) {
    push(
      `counter-backbar-shelf-${height.toFixed(1)}`,
      'a back-bar shelf',
      { x: counter.center.x - counter.width / 2, y: height - 0.02, z: -halfDepth + 0.03 },
      { x: counter.center.x + counter.width / 2, y: height + 0.02, z: -halfDepth + 0.33 },
    );
  }

  return boxes;
}

/**
 * Turns the era spec plus the environment anchors into the complete list of
 * props to build. Pure: no meshes, no side effects, so the plan can be asserted
 * on its own and re-derived identically by the tests.
 */
export function planCounterTech(input: CounterPlanInput): CounterTechPlan {
  const { spec, layout, bounds } = input;
  const island = counterIslandRect(layout);
  const drawer = spec.inventory.find((entry) => entry.kind === 'cash-drawer');
  const drawerEntry = drawer
    ? placeEntry(drawer, island, counterBandAnchors(island, layout), layout, island.datum, null)
    : null;
  const bands = counterBandAnchors(island, layout);

  const entries: PlacedCounterProp[] = spec.inventory.map((entry) =>
    placeEntry(entry, island, bands, layout, island.datum, drawerEntry),
  );

  const signature = counterPlanSignature(entries);
  const problems = validateCounterPlan(entries, bounds, layout);
  const clearance = counterShellClearanceBoxes(layout).map((box) => box.id);
  const bandCounts = countValues(
    entries.map((entry) => entry.band),
    ['counter-back', 'counter-front', 'counter-lip', 'drawer-line', 'floor-side'],
  );
  const groupCounts = countValues(
    entries.map((entry) => entry.group),
    ['register', 'payment', 'cash', 'docket', 'signage', 'cabling', 'pickup'],
  );

  return {
    year: spec.year,
    family: spec.deviceFamily,
    island,
    bands,
    entries,
    signature,
    variationSeed: ((input.seed ?? 0) + yearToNumber(spec.year) * 7919) >>> 0,
    report: {
      year: spec.year,
      family: spec.deviceFamily,
      propCount: entries.length,
      kinds: entries.map((entry) => entry.kind),
      anchorIds: [...new Set(entries.map((entry) => entry.anchorId))],
      bandCounts,
      groupCounts,
      clearance,
      problems,
      signature,
    },
  };
}

function countValues<T extends string>(values: readonly T[], keys: readonly T[]): Readonly<Record<T, number>> {
  const counts = {} as Record<T, number>;
  for (const key of keys) counts[key] = 0;
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.freeze(counts);
}

function placeEntry(
  entry: CounterInventoryEntry,
  island: CounterIslandRect,
  bands: Readonly<Record<CounterPlacementBand, CounterBandAnchor>>,
  layout: StructuralLayout,
  datum: number,
  drawer: PlacedCounterProp | null,
): PlacedCounterProp {
  const band = bands[entry.band];
  const extents = counterWorldExtents(entry.size, entry.rotationY);

  if (entry.band === 'floor-side') {
    const wallX = layout.bounds.width / 2;
    const centerX = wallX - COUNTER_FLOOR_WALL_GAP - extents.x / 2 + entry.offset.x;
    const centerZ = layout.counter.serviceFaceZ + COUNTER_FLOOR_GAP + extents.z / 2 + entry.offset.z;
    const supportHeight = layout.floorHeight;
    const center: RoomPoint = { x: centerX, y: supportHeight + entry.lift + entry.size.y / 2, z: centerZ };
    const box = boxOf(entry, center, entry.rotationY);
    return { ...entry, center, support: 'floor', supportHeight, anchorId: band.anchorId, min: box.min, max: box.max };
  }

  if (entry.band === 'drawer-line') {
    const base = drawer ?? null;
    const supportHeight = base ? base.max.y : datum;
    const centerX = clampNumber(
      (base ? base.center.x : island.center.x) + entry.offset.x,
      island.minX + extents.x / 2,
      island.maxX - extents.x / 2,
    );
    const centerZ = clampNumber(
      (base ? base.center.z : island.center.z) + entry.offset.z,
      island.minZ + extents.z / 2,
      island.maxZ - extents.z / 2,
    );
    const center: RoomPoint = { x: centerX, y: supportHeight + entry.lift + entry.size.y / 2, z: centerZ };
    const box = boxOf(entry, center, entry.rotationY);
    return {
      ...entry,
      center,
      support: 'drawer',
      supportHeight,
      anchorId: base ? `${COUNTER_DRAWER_ANCHOR_PREFIX}:${base.id}` : band.anchorId,
      min: box.min,
      max: box.max,
    };
  }

  const centerX = clampNumber(
    band.centerX + entry.offset.x,
    island.minX + extents.x / 2,
    island.maxX - extents.x / 2,
  );
  const centerZ = clampNumber(
    band.centerZ + entry.offset.z,
    band.minZ + extents.z / 2,
    band.maxZ - extents.z / 2,
  );
  const center: RoomPoint = { x: centerX, y: datum + entry.lift + entry.size.y / 2, z: centerZ };
  const box = boxOf(entry, center, entry.rotationY);
  return {
    ...entry,
    center,
    support: 'counter',
    supportHeight: datum,
    anchorId: band.anchorId,
    min: box.min,
    max: box.max,
  };
}

/**
 * Checks a plan against the room and the shell's fixed geometry. Returns one
 * message per problem; an empty array means every prop stands inside the room,
 * on its support, inside its band, clear of the shell and clear of its
 * neighbours.
 */
export function validateCounterPlan(
  entries: readonly PlacedCounterProp[],
  bounds: RoomBounds,
  layout: StructuralLayout,
): readonly string[] {
  const problems: string[] = [];
  const island = counterIslandRect(layout);
  const clearance = counterShellClearanceBoxes(layout);
  const epsilon = COUNTER_PLACEMENT_EPSILON;

  for (const entry of entries) {
    if (
      entry.min.x < -bounds.width / 2 + epsilon ||
      entry.max.x > bounds.width / 2 - epsilon ||
      entry.min.z < -bounds.depth / 2 + epsilon ||
      entry.max.z > bounds.depth / 2 - epsilon ||
      entry.min.y < -epsilon ||
      entry.max.y > bounds.height - epsilon
    ) {
      problems.push(`${entry.id} leaves the room volume`);
    }
    if (entry.min.y < entry.supportHeight - epsilon) {
      problems.push(`${entry.id} sinks below its ${entry.support} support`);
    }
    if (entry.support === 'counter' || entry.support === 'drawer') {
      if (
        entry.min.x < island.minX - epsilon ||
        entry.max.x > island.maxX + epsilon ||
        entry.min.z < island.minZ - epsilon ||
        entry.max.z > island.maxZ + epsilon
      ) {
        problems.push(`${entry.id} leaves the till island`);
      }
    }
    if (entry.support === 'floor') {
      const counterMinX = layout.counter.center.x - layout.counter.width / 2;
      const counterMaxX = layout.counter.center.x + layout.counter.width / 2;
      const counterMaxZ = layout.counter.serviceFaceZ;
      const overlapsCounter =
        entry.min.x < counterMaxX &&
        counterMinX < entry.max.x &&
        entry.min.z < counterMaxZ &&
        layout.counter.backFaceZ < entry.max.z;
      if (overlapsCounter) problems.push(`${entry.id} stands inside the counter`);
    }
    for (const box of clearance) {
      if (counterBoxesOverlap(entry, box, epsilon)) {
        problems.push(`${entry.id} intersects ${box.id} (${box.reason})`);
      }
    }
  }

  for (let first = 0; first < entries.length; first += 1) {
    const a = entries[first];
    if (!a) continue;
    for (let second = first + 1; second < entries.length; second += 1) {
      const b = entries[second];
      if (!b) continue;
      if (counterBoxesOverlap(a, b, epsilon)) {
        problems.push(`${a.id} overlaps ${b.id}`);
      }
    }
  }

  return Object.freeze(problems);
}

/** Stable fingerprint of a plan: identical for identical specs and layouts. */
export function counterPlanSignature(plan: CounterTechPlan | readonly PlacedCounterProp[]): string {
  const entries: readonly PlacedCounterProp[] = Array.isArray(plan)
    ? plan
    : (plan as CounterTechPlan).entries;
  return entries
    .map(
      (entry) =>
        `${entry.id}@${entry.center.x.toFixed(4)},${entry.center.y.toFixed(4)},${entry.center.z.toFixed(4)}` +
        `#${entry.size.x.toFixed(3)}x${entry.size.y.toFixed(3)}x${entry.size.z.toFixed(3)}`,
    )
    .join('|');
}

/* -------------------------------------------------------------------------- */
/* Cues (what the era's update drives)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Everything the prop builder hands back to the module so `update` can drive it:
 * lit faces, paper, drawers, cranks, levers, bells, tap rings and status lamps.
 * All members are arrays the module mutates in place, never per frame.
 */
export interface CounterCueRegistry {
  readonly displayMaterials: THREE.MeshStandardMaterial[];
  readonly displayEmissive: number[];
  readonly tapeNodes: THREE.Object3D[];
  readonly drawerNodes: THREE.Object3D[];
  readonly crankNodes: THREE.Object3D[];
  readonly leverNodes: THREE.Object3D[];
  readonly bellNodes: THREE.Object3D[];
  readonly tapRings: THREE.Object3D[];
  readonly tapLights: THREE.MeshStandardMaterial[];
  readonly tapLightEmissive: number[];
  readonly statusLights: THREE.MeshStandardMaterial[];
  readonly statusLightEmissive: number[];
}

/** A fresh, empty cue registry. */
export function createCounterCueRegistry(): CounterCueRegistry {
  return {
    displayMaterials: [],
    displayEmissive: [],
    tapeNodes: [],
    drawerNodes: [],
    crankNodes: [],
    leverNodes: [],
    bellNodes: [],
    tapRings: [],
    tapLights: [],
    tapLightEmissive: [],
    statusLights: [],
    statusLightEmissive: [],
  };
}

/* -------------------------------------------------------------------------- */
/* Prop builders                                                              */
/* -------------------------------------------------------------------------- */

export interface CounterDeviceBuildInput {
  readonly spec: CounterTechSpec;
  readonly plan: CounterTechPlan;
  readonly layout: StructuralLayout;
  readonly materials: CounterMaterialSet;
  /** The module's single `counter` group. */
  readonly parent: THREE.Group;
  readonly cues: CounterCueRegistry;
  /** Seed for the era's internal detail variation (coin scatter, card fan). */
  readonly variationSeed: number;
  /** Named sub group for a prop family, created on first use. */
  readonly groupFor: (key: CounterPropGroup) => THREE.Group;
}

export interface CounterDeviceBuildResult {
  /** Prop id (`till-body`) to the node built for it. */
  readonly nodes: ReadonlyMap<string, THREE.Object3D>;
  /** Every named node the builder created (parents and parts). */
  readonly nodeNames: readonly string[];
  /** Number of meshes in the era's counter. */
  readonly meshes: number;
}

/** One era's prop builder. */
export interface CounterDeviceBuilder {
  readonly family: CounterDeviceFamily;
  build(input: CounterDeviceBuildInput): CounterDeviceBuildResult;
}

/** Builders by family, as chosen by each era spec's `deviceFamily`. */
export const COUNTER_DEVICE_BUILDERS: Readonly<Record<CounterDeviceFamily, CounterDeviceBuilder>> =
  Object.freeze({
    'manual-till': manualTillDevice,
    'mechanical-register': mechanicalRegisterDevice,
    'electronic-register': electronicRegisterDevice,
    'pos-terminal': posTerminalDevice,
    'tablet-contactless': tabletContactlessDevice,
  });

/* -------------------------------------------------------------------------- */
/* Animation state                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Time-driven state of the era's counter. The module mutates one instance in
 * place, so `update` allocates nothing; {@link CounterTechModule.animationSnapshot}
 * hands out a copy for diagnostics and assertions.
 */
export interface CounterAnimationState {
  year: YearId | null;
  elapsedSeconds: number;
  displayKind: CounterDisplayKind;
  /** True while an LED era is inside its lit part of the blink cycle. */
  displayOn: boolean;
  /** Emissive intensity to apply to the era's lit faces. */
  displayGlow: number;
  /** Same value for the eras that light a screen rather than a segment face. */
  screenGlow: number;
  /** Paper advance in metres, wrapped at the era's tape length. */
  tapeAdvance: number;
  drawerOpen: boolean;
  /** How far the drawer has eased back on its runners, in metres. */
  drawerOffset: number;
  tapActive: boolean;
  /** Progress through the current 2025 tap acknowledgement (`0`..`1`). */
  tapPulse: number;
  /** Number of completed contactless acknowledgements. */
  tapCount: number;
  /** Crank rotation of the mechanical era, in radians. */
  crankTurn: number;
  /** Small status lamps (scanner, PIN pad, reader). */
  statusGlow: number;
}

function emptyAnimationState(): CounterAnimationState {
  return {
    year: null,
    elapsedSeconds: 0,
    displayKind: 'none',
    displayOn: false,
    displayGlow: 0,
    screenGlow: 0,
    tapeAdvance: 0,
    drawerOpen: false,
    drawerOffset: 0,
    tapActive: false,
    tapPulse: 0,
    tapCount: 0,
    crankTurn: 0,
    statusGlow: 0,
  };
}

/**
 * Computes the era's animation state for `elapsedSeconds`. Pure and allocation
 * free apart from the target object, so the same second always yields the same
 * counter — which is what lets the headless suite assert the animation.
 */
export function computeCounterAnimation(
  target: CounterAnimationState,
  animation: CounterAnimationSpec,
  year: YearId,
  elapsedSeconds: number,
): CounterAnimationState {
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(elapsedSeconds, 0) : 0;
  target.year = year;
  target.elapsedSeconds = elapsed;
  target.displayKind = animation.displayKind;

  if (animation.displayKind === 'led') {
    const period = Math.max(animation.displayBlinkSeconds, 0.2);
    const duty = Math.min(Math.max(animation.displayOnFraction, 0.05), 1);
    target.displayOn = elapsed % period < period * duty;
    target.displayGlow = target.displayOn ? animation.displayGlow : animation.displayGlow * 0.12;
    target.screenGlow = 0;
  } else if (animation.displayKind === 'crt' || animation.displayKind === 'tablet') {
    const breathe = Math.max(animation.screenBreatheSeconds, 1);
    const swing = 0.94 + 0.06 * Math.sin((elapsed / breathe) * Math.PI * 2);
    target.displayOn = true;
    target.displayGlow = animation.displayGlow * swing;
    target.screenGlow = target.displayGlow;
  } else {
    target.displayOn = false;
    target.displayGlow = 0;
    target.screenGlow = 0;
  }

  const pulse = Math.max(animation.statusPulseSeconds, 0.5);
  target.statusGlow = 0.8 + 0.2 * Math.sin((elapsed / pulse) * Math.PI * 2);

  const tapeLength = animation.tapeLength;
  const tapeSpeed = animation.tapeSpeed;
  target.tapeAdvance = tapeLength > 0 && tapeSpeed > 0 ? (elapsed * tapeSpeed) % tapeLength : 0;
  target.crankTurn = (elapsed * 1.15) % (Math.PI * 2);

  const nudgePeriod = Math.max(animation.drawerNudgeSeconds, 1);
  const nudgeDuration = Math.min(Math.max(animation.drawerNudgeDuration, 0.05), nudgePeriod);
  const drawerPhase = (elapsed + nudgePeriod * COUNTER_DRAWER_PHASE) % nudgePeriod;
  target.drawerOpen = drawerPhase < nudgeDuration;
  target.drawerOffset = target.drawerOpen
    ? animation.drawerNudgeMetres * Math.sin(Math.PI * (drawerPhase / nudgeDuration))
    : 0;

  if (animation.displayKind === 'tablet' && animation.tapPeriodSeconds > 0) {
    const tapPeriod = animation.tapPeriodSeconds;
    const tapDuration = Math.min(Math.max(animation.tapDurationSeconds, 0.05), tapPeriod);
    const tapPhase = elapsed % tapPeriod;
    target.tapActive = tapPhase < tapDuration;
    target.tapPulse = target.tapActive ? tapPhase / tapDuration : 0;
    target.tapCount = Math.floor(elapsed / tapPeriod);
  } else {
    target.tapActive = false;
    target.tapPulse = 0;
    target.tapCount = 0;
  }

  return target;
}

/* -------------------------------------------------------------------------- */
/* Module                                                                     */
/* -------------------------------------------------------------------------- */

export interface CounterTechModuleOptions {
  /** Interior volume; defaults to the café room. */
  readonly bounds?: RoomBounds;
  /** Structural anchor set; defaults to the café layout. */
  readonly layout?: StructuralLayout;
  /** Canvas factory for the procedural surfaces (defaults to the DOM). */
  readonly canvasFactory?: CounterCanvasFactory;
  /** Texture resolution override for every counter surface. */
  readonly textureSize?: number;
  /** Deterministic seed for the era's internal detail variation. */
  readonly seed?: number;
  /** Era reported by `getHotspots` before the first build. */
  readonly initialYear?: YearId;
}

/** Diagnostics snapshot of the module for one moment in the timeline. */
export interface CounterTechModuleDescription {
  readonly moduleId: string;
  readonly year: YearId;
  readonly built: boolean;
  readonly family: CounterDeviceFamily;
  readonly paletteName: string | null;
  readonly materialSetId: string | null;
  readonly textureSource: CounterMaterialSet['textureSource'] | 'none';
  readonly textureCount: number;
  readonly materialCount: number;
  readonly propCount: number;
  readonly meshCount: number;
  readonly nodeCount: number;
  readonly planSignature: string | null;
  readonly problems: readonly string[];
  readonly animation: CounterAnimationSpec;
  readonly summary: string;
}

/**
 * The café's counter technology: register, payment device, drawer, paper, cards,
 * reader and pickup shelf, per era.
 */
export class CounterTechModule implements SceneModule<CounterTechSpec> {
  readonly id = COUNTER_TECH_MODULE_ID;

  /** Interior volume every prop is placed inside. */
  readonly bounds: RoomBounds;

  /** Counter zone, pass slots and the rest of the anchor set. */
  readonly layout: StructuralLayout;

  private readonly options: CounterTechModuleOptions;
  private group: THREE.Group | null = null;
  private materials: CounterMaterialSet | null = null;
  private currentSpec: CounterTechSpec | null = null;
  private builtPlan: CounterTechPlan | null = null;
  private nodes: ReadonlyMap<string, THREE.Object3D> = new Map();
  private builtNodeNames: readonly string[] = [];
  private cues: CounterCueRegistry | null = null;
  private tapeBaseY: number[] = [];
  private drawerBaseZ: number[] = [];
  private meshes = 0;
  private updates = 0;
  private clock = 0;
  private readonly state: CounterAnimationState = emptyAnimationState();
  private erasPlanned = new Map<YearId, CounterTechPlan>();

  constructor(options: CounterTechModuleOptions = {}) {
    this.options = options;
    this.bounds = options.bounds ?? CAFE_ROOM_BOUNDS;
    this.layout = options.layout ?? STRUCTURAL_LAYOUT;

    const layoutBounds = this.layout.bounds;
    if (
      layoutBounds.width !== this.bounds.width ||
      layoutBounds.depth !== this.bounds.depth ||
      layoutBounds.height !== this.bounds.height
    ) {
      throw new Error('The structural layout must describe the same room as `bounds`.');
    }
    const problems = validateLayout(this.layout);
    if (problems.length > 0) {
      throw new Error(`Invalid environment layout: ${problems.join('; ')}`);
    }
  }

  /* -- SceneModule surface -------------------------------------------------- */

  /** The single `counter` group, once built. */
  get root(): THREE.Object3D | undefined {
    return this.group ?? undefined;
  }

  /** Era data currently applied. */
  get spec(): CounterTechSpec | undefined {
    return this.currentSpec ?? undefined;
  }

  build(context: BuildContext): void {
    this.dispose();
    this.raise(context.year, context);
  }

  applyPeriod(period: PeriodDefinition, context: BuildContext): void {
    if (!this.group) {
      this.raise(period.year, context);
      return;
    }
    // Counter technology *is* the period: a lever till is not a tablet, so the
    // era swap raises the new inventory and releases the previous group first.
    // Exactly one era's counter is ever attached, which is what makes the
    // timeline read as a replacement rather than an accumulation.
    this.dispose();
    this.raise(period.year, context);
  }

  update(deltaSeconds: number, context: UpdateContext): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(deltaSeconds, 0) : 0;
    this.updates += 1;
    this.clock += delta;
    const elapsed =
      context && Number.isFinite(context.elapsedSeconds) ? Math.max(context.elapsedSeconds, 0) : this.clock;

    const spec = this.currentSpec;
    const cues = this.cues;
    if (!spec || !cues) return;

    computeCounterAnimation(this.state, spec.animation, spec.year, elapsed);

    // Every cue list is walked by index and mutated in place: no allocation.
    for (let index = 0; index < cues.displayMaterials.length; index += 1) {
      const material = cues.displayMaterials[index];
      const base = cues.displayEmissive[index];
      if (!material || base === undefined) continue;
      const glow = this.state.displayKind === 'led' ? this.state.displayGlow : this.state.screenGlow;
      material.emissiveIntensity = base * Math.max(glow, 0.02);
    }
    for (let index = 0; index < cues.statusLights.length; index += 1) {
      const material = cues.statusLights[index];
      const base = cues.statusLightEmissive[index];
      if (!material || base === undefined) continue;
      material.emissiveIntensity = base * this.state.statusGlow;
    }
    for (let index = 0; index < cues.tapeNodes.length; index += 1) {
      const node = cues.tapeNodes[index];
      if (!node) continue;
      const baseY = this.tapeBaseY[index] ?? node.position.y;
      node.position.y = baseY + this.state.tapeAdvance;
      const mesh = node as THREE.Mesh;
      const material = mesh.material as THREE.MeshStandardMaterial | undefined;
      const map = material?.map;
      if (map && spec.animation.tapeLength > 0) {
        map.offset.y = (this.state.tapeAdvance / spec.animation.tapeLength) % 1;
      }
    }
    for (let index = 0; index < cues.drawerNodes.length; index += 1) {
      const node = cues.drawerNodes[index];
      if (!node) continue;
      const baseZ = this.drawerBaseZ[index] ?? node.position.z;
      node.position.z = baseZ - this.state.drawerOffset;
    }
    for (let index = 0; index < cues.crankNodes.length; index += 1) {
      const node = cues.crankNodes[index];
      if (!node) continue;
      node.rotation.z = this.state.crankTurn;
    }
    for (let index = 0; index < cues.leverNodes.length; index += 1) {
      const node = cues.leverNodes[index];
      if (!node) continue;
      node.rotation.x = -this.state.drawerOffset * 8;
    }
    for (let index = 0; index < cues.bellNodes.length; index += 1) {
      const node = cues.bellNodes[index];
      if (!node) continue;
      node.rotation.z = this.state.drawerOpen ? Math.sin(elapsed * 18) * 0.09 : 0;
    }
    for (let index = 0; index < cues.tapRings.length; index += 1) {
      const node = cues.tapRings[index];
      if (!node) continue;
      const scale = 1 + this.state.tapPulse * 0.35;
      node.scale.setScalar(scale);
      node.visible = this.state.tapActive;
    }
    for (let index = 0; index < cues.tapLights.length; index += 1) {
      const material = cues.tapLights[index];
      const base = cues.tapLightEmissive[index];
      if (!material || base === undefined) continue;
      const lit = this.state.tapActive ? 0.35 + (1 - this.state.tapPulse) * 0.65 : 0.12;
      material.emissiveIntensity = base * lit;
    }
  }

  dispose(): void {
    if (this.group) {
      disposeObject3D(this.group);
      this.group = null;
    }
    if (this.materials) {
      disposeCounterMaterialSet(this.materials);
      this.materials = null;
    }
    this.currentSpec = null;
    this.builtPlan = null;
    this.nodes = new Map();
    this.builtNodeNames = [];
    this.cues = null;
    this.tapeBaseY = [];
    this.drawerBaseZ = [];
    this.meshes = 0;
    this.clock = 0;
    this.state.year = null;
    this.state.elapsedSeconds = 0;
    this.state.displayKind = 'none';
    this.state.displayOn = false;
    this.state.displayGlow = 0;
    this.state.screenGlow = 0;
    this.state.tapeAdvance = 0;
    this.state.drawerOpen = false;
    this.state.drawerOffset = 0;
    this.state.tapActive = false;
    this.state.tapPulse = 0;
    this.state.tapCount = 0;
    this.state.crankTurn = 0;
    this.state.statusGlow = 0;
  }

  getHotspots(): readonly Hotspot[] {
    const spec = this.currentSpec ?? counterTechSpec(this.options.initialYear);
    const plan = this.builtPlan ?? this.eraPlan(spec.year);
    const era = `${spec.year} · ${spec.caption}`;
    const hotspots: Hotspot[] = [];

    const register = findByKind(plan.entries, spec.device.kind);
    if (register) {
      hotspots.push(
        this.hotspot(register, spec, {
          id: 'counter:register',
          label: `${spec.device.name} — ${spec.year}`,
          description: `${era}. ${spec.device.detail} ${spec.summary}`,
          kind: 'interactive',
        }),
      );
    }

    const payment = findByKind(plan.entries, spec.payment.kind);
    if (payment) {
      hotspots.push(
        this.hotspot(payment, spec, {
          id: 'counter:payment',
          label: `${spec.payment.name} — ${spec.year}`,
          description: `${era}. ${spec.payment.detail} Payment is ${spec.payment.mode}.`,
          kind: 'interactive',
        }),
      );
    }

    hotspots.push({
      id: 'counter:surface',
      label: `Counter surface — ${spec.year}`,
      description: `${era}. ${spec.displayDetail} The till island is the clear strip at the service end of the counter.`,
      position: new THREE.Vector3(plan.island.center.x, plan.island.datum, plan.island.center.z),
      radius: Math.max(plan.island.maxX - plan.island.minX, plan.island.maxZ - plan.island.minZ) / 2,
      year: spec.year,
      moduleId: this.id,
      kind: 'info',
      anchor: this.group ?? undefined,
    });

    for (const entry of plan.entries) {
      if (!INTERESTING_HOTSPOT_KINDS.has(entry.kind)) continue;
      if (entry.kind === spec.device.kind || entry.kind === spec.payment.kind) continue;
      hotspots.push(
        this.hotspot(entry, spec, {
          id: `counter:${entry.id}`,
          label: `${entry.label} — ${spec.year}`,
          description: `${era}. ${entry.detail}`,
          kind: entry.group === 'cash' || entry.group === 'payment' ? 'interactive' : 'info',
        }),
      );
    }

    return hotspots;
  }

  private hotspot(
    entry: PlacedCounterProp,
    spec: CounterTechSpec,
    content: { readonly id: string; readonly label: string; readonly description: string; readonly kind: HotspotKind },
  ): Hotspot {
    const extents = counterWorldExtents(entry.size, entry.rotationY);
    return {
      id: content.id,
      label: content.label,
      description: content.description,
      position: new THREE.Vector3(entry.center.x, entry.center.y, entry.center.z),
      radius: Math.max(Math.max(extents.x, extents.z) / 2 + 0.12, 0.18),
      year: spec.year,
      moduleId: this.id,
      kind: content.kind,
      anchor: this.nodes.get(entry.id),
    };
  }

  /* -- Diagnostics and consumer accessors ---------------------------------- */

  /** True once the era's counter has been raised. */
  get built(): boolean {
    return this.group !== null;
  }

  /** The plan currently built (or `undefined` before the first build). */
  get plan(): CounterTechPlan | undefined {
    return this.builtPlan ?? undefined;
  }

  /** Every placed prop, in plan order. */
  get placements(): readonly PlacedCounterProp[] {
    return this.builtPlan?.entries ?? [];
  }

  /** The till island the current era was placed in. */
  get island(): CounterIslandRect | undefined {
    return this.builtPlan?.island;
  }

  /** The single `counter` group. */
  get node(): THREE.Group | undefined {
    return this.group ?? undefined;
  }

  /** Read-only view of the era's animation cues. */
  get cueTargets(): CounterCueRegistry | undefined {
    return this.cues ?? undefined;
  }

  /** The live animation state (mutated in place by {@link update}). */
  get animation(): CounterAnimationState {
    return this.state;
  }

  /** A copy of the animation state, for assertions and diagnostics. */
  animationSnapshot(): CounterAnimationState {
    return { ...this.state };
  }

  /** The era's material set (every material is named `counter:<year>:<slot>`). */
  get materialSet(): CounterMaterialSet | undefined {
    return this.materials ?? undefined;
  }

  /** Identifier of the active material set. */
  get materialSetId(): string | undefined {
    return this.materials?.id;
  }

  /** Where the era's surfaces came from. */
  get textureSource(): CounterMaterialSet['textureSource'] | 'none' {
    return this.materials?.textureSource ?? 'none';
  }

  /** Fingerprint of the era's material set. */
  get materialSignature(): string | null {
    return this.materials ? counterMaterialSetSignature(this.materials) : null;
  }

  /** Number of scene-graph nodes under the counter group. */
  get nodeCount(): number {
    if (!this.group) return 0;
    let count = 0;
    this.group.traverse(() => {
      count += 1;
    });
    return count;
  }

  /** Number of meshes in the era's counter (as built). */
  get meshCount(): number {
    return this.meshes;
  }

  /** Number of distinct geometries currently attached to the counter. */
  get geometryCount(): number {
    if (!this.group) return 0;
    const geometries = new Set<THREE.BufferGeometry>();
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry instanceof THREE.BufferGeometry) geometries.add(mesh.geometry);
    });
    return geometries.size;
  }

  /** Number of distinct materials currently attached to the counter. */
  get materialCount(): number {
    if (!this.group) return 0;
    const materials = new Set<THREE.Material>();
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const entry of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (entry) materials.add(entry);
      }
    });
    return materials.size;
  }

  /** Everything the module tracks for disposal: the graph, geometries and maps. */
  get resourceCount(): number {
    if (!this.group) return 0;
    return this.nodeCount + this.geometryCount + this.materialCount + (this.materials?.textures.length ?? 0);
  }

  /** Names of every node the built era created. */
  get nodeNames(): readonly string[] {
    return this.builtNodeNames;
  }

  /** Prop id to the node built for it (empty before the first build). */
  get propNodes(): ReadonlyMap<string, THREE.Object3D> {
    return this.nodes;
  }

  /** Number of times {@link SceneModule.update} has run. */
  get updateCount(): number {
    return this.updates;
  }

  /** Kind of every prop the current era builds. */
  get kinds(): readonly CounterPropKind[] {
    return (this.builtPlan?.entries ?? []).map((entry) => entry.kind);
  }

  /** True when the era's counter contains a prop of `kind`. */
  hasKind(kind: CounterPropKind): boolean {
    return this.kinds.includes(kind);
  }

  /** The plan for `year`, derived without building anything (and cached). */
  eraPlan(year: YearId): CounterTechPlan {
    const cached = this.erasPlanned.get(year);
    if (cached) return cached;
    const plan = planCounterTech({
      year,
      spec: counterTechSpec(year),
      layout: this.layout,
      bounds: this.bounds,
      seed: this.options.seed,
    });
    this.erasPlanned.set(year, plan);
    return plan;
  }

  /** Diagnostics snapshot of the module for the active era. */
  describe(): CounterTechModuleDescription {
    const spec = this.currentSpec ?? counterTechSpec(this.options.initialYear);
    return {
      moduleId: this.id,
      year: spec.year,
      built: this.built,
      family: spec.deviceFamily,
      paletteName: this.materials?.paletteName ?? null,
      materialSetId: this.materials?.id ?? null,
      textureSource: this.textureSource,
      textureCount: this.materials?.textures.length ?? 0,
      materialCount: this.materialCount,
      propCount: this.builtPlan?.entries.length ?? 0,
      meshCount: this.meshes,
      nodeCount: this.nodeCount,
      planSignature: this.builtPlan?.signature ?? null,
      problems: this.builtPlan?.report.problems ?? [],
      animation: spec.animation,
      summary: describeCounterTechSpec(spec),
    };
  }

  /* -- Internals ------------------------------------------------------------ */

  private raise(year: YearId, context: BuildContext): void {
    const spec = counterTechSpec(year);
    const plan = planCounterTech({
      year: spec.year,
      spec,
      layout: this.layout,
      bounds: this.bounds,
      seed: this.options.seed,
    });
    if (plan.report.problems.length > 0) {
      throw new Error(`Invalid counter plan for ${spec.year}: ${plan.report.problems.join('; ')}`);
    }

    const materials = createCounterMaterialSet(spec, {
      canvasFactory: this.options.canvasFactory,
      textureSize: this.options.textureSize,
    });
    const group = new THREE.Group();
    group.name = COUNTER_TECH_GROUP_NAME;
    const cues = createCounterCueRegistry();
    const groups = new Map<CounterPropGroup, THREE.Group>();
    const groupFor = (key: CounterPropGroup): THREE.Group => {
      const existing = groups.get(key);
      if (existing) return existing;
      const created = new THREE.Group();
      created.name = COUNTER_GROUP_NAMES[key];
      group.add(created);
      groups.set(key, created);
      return created;
    };

    const builder = COUNTER_DEVICE_BUILDERS[spec.deviceFamily];
    const result = builder.build({
      spec,
      plan,
      layout: this.layout,
      materials,
      parent: group,
      cues,
      variationSeed: plan.variationSeed,
      groupFor,
    });

    // Empty families would only add nodes the registry has to walk.
    for (const [key, child] of groups) {
      if (child.children.length === 0) {
        group.remove(child);
        groups.delete(key);
      }
    }

    context.root.add(group);

    this.group = group;
    this.materials = materials;
    this.currentSpec = spec;
    this.builtPlan = plan;
    this.nodes = result.nodes;
    this.builtNodeNames = result.nodeNames;
    this.cues = cues;
    this.meshes = result.meshes;
    this.tapeBaseY = cues.tapeNodes.map((node) => node.position.y);
    this.drawerBaseZ = cues.drawerNodes.map((node) => node.position.z);
    this.clock = 0;
    computeCounterAnimation(this.state, spec.animation, spec.year, 0);
  }
}

/** Kinds that earn their own inspect-mode hotspot. */
const INTERESTING_HOTSPOT_KINDS: ReadonlySet<CounterPropKind> = new Set<CounterPropKind>([
  'cash-drawer',
  'coin-tray',
  'tip-jar',
  'receipt-printer',
  'receipt-tape',
  'receipt-roll',
  'docket-pad',
  'ledger',
  'register-crank',
  'till-bell',
  'display-led',
  'barcode-scanner',
  'scanner-goods',
  'crt-monitor',
  'card-terminal',
  'loyalty-cards',
  'tablet',
  'contactless-reader',
  'qr-card',
  'pickup-shelf',
  'cable',
]);

function findByKind(entries: readonly PlacedCounterProp[], kind: CounterPropKind): PlacedCounterProp | undefined {
  return entries.find((entry) => entry.kind === kind);
}

/** Creates the module the composition root instantiates per era. */
export function createCounterTechModule(options: CounterTechModuleOptions = {}): CounterTechModule {
  return new CounterTechModule(options);
}

/** Every era the counter domain publishes data for, in timeline order. */
export function counterTechYears(): readonly YearId[] {
  return YEAR_IDS;
}
