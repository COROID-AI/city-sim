/**
 * Tableware scene module — every cup, saucer, mug, glass, piece of cutlery,
 * condiment set, tray and packaging item on the café's tables and counter pass.
 *
 * One module owns the whole service, exactly the way the frozen
 * {@link SceneModule} contract expects:
 *
 *  - `build(context)` raises a single `tableware` node holding one named group
 *    per zone (`tableware-tables`, `tableware-counter-pass`), built from the era
 *    spec and placed from the environment's published structural anchors.
 *  - `applyPeriod(period, context)` rebuilds the whole service for the new era.
 *    Tableware *is* the period (a 1945 heavy china cup is not a 2025 reusable
 *    lidded cup), so the previous group is released before the next is raised:
 *    exactly one era's tableware is ever attached, and the change reads as a
 *    replacement rather than an accumulation.
 *  - `update(delta, context)` breathes a little life into the service: the
 *    printed logos catch the light and the stacks settle by a hair.
 *  - `dispose()` releases every geometry, material, canvas texture and
 *    scene-graph node the module created, including the shared prototype
 *    geometry cache, and detaches its group.
 *  - `getHotspots()` exposes the era's table service, counter pass, condiments
 *    and packaging for the overlay, with the era's own notes.
 *
 * Placement is *planned* before it is built: {@link planTableware} turns the era
 * spec plus the environment's {@link StructuralLayout} into a complete,
 * geometry-free list of {@link TablewarePlacement}s. Every placement names the
 * anchor it came from (`table-slot-c1-r1`, `counter-pass-3`), sits flush on that
 * anchor's published `surfaceHeight`, and carries the footprint radius the
 * builders and the tests check for clearance. Nothing in this module hardcodes a
 * room coordinate.
 *
 * Geometry is instanced where repetition is high: each item kind is built once
 * into a prototype (a handful of primitive parts sharing cached geometry), then
 * every placement of that kind becomes one `InstancedMesh` per part. Sixteen
 * place settings therefore cost one draw call per cup part, not sixteen cups.
 *
 * Determinism: the plan is derived from the spec and the layout alone, and the
 * only seeded variation (printed wear and per-instance tint) comes from a
 * per-era source hashed from the module seed and the {@link YearId}, so
 * re-applying an era always reproduces the same table.
 */

import * as THREE from 'three';
import {
  DEFAULT_YEAR_ID,
  YEAR_IDS,
  type BuildContext,
  type DomainSpecBase,
  type Hotspot,
  type PeriodDefinition,
  type RoomBounds,
  type SceneModule,
  type UpdateContext,
  type YearId,
} from '../../contracts/period';
import { createSeededRandom, disposeObject3D } from '../../core/kernel';
import {
  CAFE_ROOM_BOUNDS,
  STRUCTURAL_LAYOUT,
  validateLayout,
  type CounterPassSlot,
  type StructuralLayout,
  type TableSlot,
} from '../environment';
import {
  TABLEWARE_MATERIAL_SLOTS,
  createTablewareMaterialSet,
  disposeTablewareMaterialSet,
  hashString,
  tablewareMaterial,
  tablewareMaterialSetSignature,
  type CanvasFactory,
  type TablewareMaterialRecipe,
  type TablewareMaterialSet,
  type TablewareMaterialSlot,
  type TablewareMaterialSource,
} from './tablewareTextures';
import { SPEC_1945 } from './data/1945';
import { SPEC_1965 } from './data/1965';
import { SPEC_1985 } from './data/1985';
import { SPEC_2005 } from './data/2005';
import { SPEC_2025 } from './data/2025';

/* -------------------------------------------------------------------------- */
/* Era vocabulary: drinking vessels                                           */
/* -------------------------------------------------------------------------- */

/** How a drinking vessel is built, era by era. */
export type VesselKind =
  | 'china-cup'
  | 'narrow-rim-cup'
  | 'demitasse-cup'
  | 'stoneware-mug'
  | 'glass-tumbler'
  | 'double-walled-glass'
  | 'reusable-cup'
  | 'lidded-cup'
  | 'paper-cup'
  | 'corrugated-cup';

/** What closes a vessel. */
export type VesselLid = 'none' | 'paper-lid' | 'plastic-lid' | 'reusable-lid';

/** Printed sleeve or band wrapped around a vessel. */
export type VesselSleeve = 'none' | 'printed-sleeve' | 'corrugated-sleeve' | 'silicone-band';

/** What the era's cup stands on when it is not simply on the table. */
export type VesselRest = 'saucer' | 'coaster' | 'none';

export interface VesselSpec {
  readonly kind: VesselKind;
  readonly label: string;
  /** Body material of the vessel. */
  readonly bodySlot: TablewareMaterialSlot;
  /** Rim band or handle material; `null` when the vessel is one material. */
  readonly trimSlot: TablewareMaterialSlot | null;
  /** Printed-logo slot, when the era's vessel carries a printed mark. */
  readonly printSlot: TablewareMaterialSlot | null;
  /** Printed word on the vessel (used when `printSlot` is set). */
  readonly mark: string | null;
  /** Outside diameter at the rim, in metres. */
  readonly rimDiameter: number;
  /** Outside diameter at the foot, in metres. */
  readonly baseDiameter: number;
  readonly height: number;
  /** Wall thickness story, in metres (drives the rim ring and the cavity). */
  readonly wall: number;
  readonly capacityMl: number;
  /** Fraction of capacity the era actually pours (`0.6` = a rationed portion). */
  readonly fillFraction: number;
  readonly handle: 'none' | 'small-loop' | 'chunky-loop';
  /** What the vessel rests on. */
  readonly rest: VesselRest;
  readonly lid: VesselLid;
  readonly sleeve: VesselSleeve;
  /** Extra detail the era's vessel carries, in prose. */
  readonly detail: string;
  readonly note: string;
}

/** The vessels one era puts on its tables, in their roles. */
export interface VesselSet {
  /** The era's everyday table vessel. */
  readonly cup: VesselSpec;
  /** The small cup of the era (a 1965 demitasse); `null` when it has none. */
  readonly espresso: VesselSpec | null;
  /** The era's cold-drink glass; `null` when it has none. */
  readonly tumbler: VesselSpec | null;
  /** The era's take-away vessel; `null` for the sit-down-only periods. */
  readonly takeaway: VesselSpec | null;
  /** Serving size the era pours, in millilitres. */
  readonly serveMl: number;
  readonly note: string;
}

/* -------------------------------------------------------------------------- */
/* Era vocabulary: table service                                              */
/* -------------------------------------------------------------------------- */

/** The pieces of a place setting's cutlery. */
export type CutleryPieceKind = 'knife' | 'fork' | 'spoon';

export interface CutlerySpec {
  readonly kind: CutleryPieceKind;
  readonly label: string;
  readonly metalSlot: TablewareMaterialSlot;
  /** Handle inlay (bone, bakelite, timber); `null` when the piece is all metal. */
  readonly handleSlot: TablewareMaterialSlot | null;
  readonly length: number;
  /** How the piece is finished, in prose. */
  readonly polish: string;
  readonly note: string;
}

export interface TeaspoonSpec {
  readonly label: string;
  readonly metalSlot: TablewareMaterialSlot;
  readonly handleSlot: TablewareMaterialSlot | null;
  readonly length: number;
  readonly note: string;
}

/** How the era serves sugar. */
export type SugarBowlStyle =
  | 'lidded-china'
  | 'loose-in-ceramic'
  | 'sachets-in-stoneware'
  | 'branded-sachet-pot'
  | 'glass-jar-with-tongs';

export interface SugarBowlSpec {
  readonly style: SugarBowlStyle;
  readonly label: string;
  readonly bodySlot: TablewareMaterialSlot;
  readonly lidSlot: TablewareMaterialSlot | null;
  /** Spoon, tongs or sachet material inside the bowl. */
  readonly fittingSlot: TablewareMaterialSlot | null;
  /** Fraction of the bowl that is filled — 1945 sugar stayed rationed. */
  readonly fillFraction: number;
  readonly capacityMl: number;
  readonly note: string;
}

/** How the era serves milk. */
export type CreamerStyle = 'china-jug' | 'ceramic-jug' | 'stoneware-jug' | 'single-serve-pots' | 'glass-jug';

export interface CreamerSpec {
  readonly style: CreamerStyle;
  readonly label: string;
  readonly bodySlot: TablewareMaterialSlot;
  readonly trimSlot: TablewareMaterialSlot | null;
  readonly capacityMl: number;
  readonly note: string;
}

export interface CondimentCaddySpec {
  readonly label: string;
  readonly traySlot: TablewareMaterialSlot;
  readonly bottleSlot: TablewareMaterialSlot;
  readonly capSlot: TablewareMaterialSlot;
  /** Sauce or cruet bottles standing in the caddy. */
  readonly bottles: number;
  /** The era's condiments arrive as printed sachets instead of bottles. */
  readonly sachets: boolean;
  /** Stirrers or sugar sticks standing in the caddy. */
  readonly stirrers: number;
  readonly note: string;
}

/** How the era offers napkins. */
export type NapkinHolderStyle =
  | 'folded-linen'
  | 'chrome-stand'
  | 'printed-dispenser'
  | 'paper-dispenser'
  | 'timber-stack';

export interface NapkinHolderSpec {
  readonly style: NapkinHolderStyle;
  readonly label: string;
  readonly holderSlot: TablewareMaterialSlot;
  readonly napkinSlot: TablewareMaterialSlot;
  readonly napkins: number;
  readonly mark: string | null;
  readonly note: string;
}

/** Where the period stood on smoking indoors. */
export type AshtrayStyle = 'thick-glass' | 'stainless' | 'moulded-plastic' | 'smoked-glass';

export interface AshtraySpec {
  readonly style: AshtrayStyle;
  readonly label: string;
  readonly slot: TablewareMaterialSlot;
  readonly diameter: number;
  readonly notches: number;
  readonly note: string;
}

export type TrayStyle =
  | 'enamel-metal'
  | 'stainless-waitress'
  | 'plastic-canteen'
  | 'melamine'
  | 'recycled-plastic'
  | 'timber';

export interface TraySpec {
  readonly style: TrayStyle;
  readonly label: string;
  readonly slot: TablewareMaterialSlot;
  readonly rimSlot: TablewareMaterialSlot;
  readonly width: number;
  readonly depth: number;
  readonly rimHeight: number;
  readonly note: string;
}

/** Everything the era keeps on the table beside the vessels. */
export interface TableServiceSpec {
  readonly cutlery: readonly CutlerySpec[];
  readonly teaspoon: TeaspoonSpec;
  readonly sugarBowl: SugarBowlSpec;
  readonly creamer: CreamerSpec;
  readonly condimentCaddy: CondimentCaddySpec;
  readonly napkinHolder: NapkinHolderSpec;
  /** Absent once the café stops putting ashtrays on its tables. */
  readonly ashtray: AshtraySpec | null;
  readonly tray: TraySpec | null;
  readonly placement: string;
}

/* -------------------------------------------------------------------------- */
/* Era vocabulary: the counter pass                                           */
/* -------------------------------------------------------------------------- */

/** Stacks, rows and caddies the era keeps on the counter pass. */
export type PassStackKind =
  | 'saucer-stack'
  | 'cup-stack'
  | 'demitasse-stack'
  | 'mug-stack'
  | 'tumbler-row'
  | 'paper-cup-stack'
  | 'corrugated-cup-stack'
  | 'lid-stack'
  | 'sleeve-stack'
  | 'stirrer-cup'
  | 'reusable-cup-stack'
  | 'glass-rack'
  | 'tray-stack'
  | 'cutlery-caddy'
  | 'napkin-stack';

export interface PassStackSpec {
  readonly kind: PassStackKind;
  readonly label: string;
  /** Pieces in the stack, row or caddy. */
  readonly pieces: number;
  readonly note: string;
}

export interface CounterPassSpec {
  readonly stacks: readonly PassStackSpec[];
  readonly arrangement: string;
}

/* -------------------------------------------------------------------------- */
/* Era spec                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One era's complete tableware record. It extends {@link DomainSpecBase} (the
 * frozen domain-spec shape) and {@link TablewareMaterialSource}, so a spec can
 * be handed straight to `createTablewareMaterialSet`.
 */
export interface TablewareSpec extends DomainSpecBase, TablewareMaterialSource {
  readonly year: YearId;
  readonly label: string;
  readonly name: string;
  readonly summary: string;
  readonly paletteName: string;
  readonly materialSetId: string;
  readonly tags: readonly string[];
  readonly notes: readonly string[];
  readonly accentColor: string;
  readonly vessels: VesselSet;
  readonly tableService: TableServiceSpec;
  readonly counterPass: CounterPassSpec;
  readonly surfaces: Readonly<Record<TablewareMaterialSlot, TablewareMaterialRecipe>>;
}

/* -------------------------------------------------------------------------- */
/* Placement plan                                                             */
/* -------------------------------------------------------------------------- */

/** The semantic kind of a placed piece of tableware. */
export type TablewareItemKind =
  | 'cup'
  | 'demitasse-cup'
  | 'glass-tumbler'
  | 'double-walled-glass'
  | 'reusable-cup'
  | 'lidded-cup'
  | 'paper-cup'
  | 'corrugated-cup'
  | 'saucer'
  | 'demitasse-saucer'
  | 'coaster'
  | 'teaspoon'
  | 'demitasse-spoon'
  | 'fork'
  | 'knife'
  | 'spoon'
  | 'stirrer'
  | 'sugar-bowl'
  | 'creamer'
  | 'condiment-caddy'
  | 'napkin-holder'
  | 'ashtray'
  | PassStackKind;

/** Zone a placement belongs to. */
export type TablewareZoneKind = 'table-setting' | 'counter-pass';

/**
 * Oriented footprint of one piece, in the item's own local frame: `halfWidth`
 * across the piece (local `+X`) and `halfLength` along it (local `+Z`). Circles
 * are too coarse for a 17 cm fork laid across a 72 cm table top, so clearance,
 * reach and geometry-fit checks all use this rectangle.
 */
export interface TablewareFootprint {
  readonly halfWidth: number;
  readonly halfLength: number;
}

/**
 * One piece of tableware, positioned from a published environment anchor.
 * `position` is the *base* of the piece: for a free standing item it is exactly
 * the anchor's `surfaceHeight`; for a nested item (a cup in its saucer) it is the
 * top of the item it rests on.
 */
export interface TablewarePlacement {
  /** Stable id (`table-slot-c1-r1:saucer:1`). */
  readonly id: string;
  readonly kind: TablewareItemKind;
  /** Build variant (era vessel kind, ashtray style, stack kind, ...). */
  readonly variant: string;
  readonly label: string;
  readonly zone: TablewareZoneKind;
  /** Published anchor the item is placed from. */
  readonly anchorId: string;
  readonly anchorKind: 'table-slot' | 'counter-pass';
  readonly position: THREE.Vector3;
  readonly rotationY: number;
  /** Published surface height of the anchor, in metres above the floor. */
  readonly surface: number;
  /** Oriented footprint of the piece (clearance, reach and fit checks). */
  readonly footprint: TablewareFootprint;
  /** Height of the piece above `position`. */
  readonly height: number;
  /** Id of the piece this one rests on or in; `null` when it is free. */
  readonly nestedIn: string | null;
  /** Pieces in a stack / row / caddy (`1` for a single item). */
  readonly pieces: number;
}

/** Complete, geometry-free tableware plan for one era. */
export interface TablewarePlan {
  readonly year: YearId;
  readonly entries: readonly TablewarePlacement[];
  /** Place settings, in table-slot order. */
  readonly tableSettings: readonly TablewarePlacement[];
  /** Counter-pass stacks and caddies. */
  readonly counterPass: readonly TablewarePlacement[];
  /** Every environment anchor the plan consumed, sorted. */
  readonly anchorIds: readonly string[];
  readonly signature: string;
}

export interface TablewarePlanInput {
  readonly year: YearId;
  readonly spec: TablewareSpec;
  readonly layout: StructuralLayout;
  readonly bounds: RoomBounds;
}

/**
 * Table-local layout of one place setting, in metres, relative to the table
 * anchor. Local `+X` is the **seat axis** — the table's long side, which is
 * exactly where the furniture module's seating plan plants the chairs — and
 * local `+Z` runs the length of the table. The whole cluster stays inside
 * {@link TABLEWARE_SETTING.maxReach} so nothing overhangs a table top, including
 * the 0.72 m round tops the furniture module uses in 2005.
 */
export const TABLEWARE_SETTING = Object.freeze({
  /** Distance from the table anchor to the place setting. */
  coverOffset: 0.185,
  /** Across-seat offset of the cutlery lane, either side of the cover. */
  cutleryOffset: 0.105,
  /** Extra lane offset for the third piece in a three-piece era. */
  cutlerySpread: 0.042,
  /** Distance beyond the cover to the second vessel (glass, demitasse). */
  secondCoverOffset: 0.125,
  /** How far the nested teaspoon sits from the saucer centre, toward the seat. */
  spoonOffset: 0.045,
  /** Thickness of the era's rest, used as the nested height of the vessel. */
  saucerThickness: 0.011,
  coasterThickness: 0.006,
  /** Height of the nested teaspoon above the table surface. */
  spoonHeight: 0.011,
  /** Height of a nested small cup above its own saucer. */
  demitasseSaucerThickness: 0.009,
  /** Centre-of-table cluster, laid along the free centre line of the table. */
  sugar: Object.freeze({ x: 0.0, z: -0.22 }),
  creamer: Object.freeze({ x: 0.0, z: -0.11 }),
  caddy: Object.freeze({ x: 0.0, z: 0.0 }),
  napkin: Object.freeze({ x: 0.0, z: 0.11 }),
  ashtray: Object.freeze({ x: 0.0, z: 0.22 }),
  /**
   * Every table item must stay inside this radius of the table anchor: 0.36 m is
   * the radius of the smallest round top the furniture module builds (0.72 m in
   * 2005), so nothing overhangs even then.
   */
  maxReach: 0.36,
});

/** Footprints of the counter-pass stacks, in metres. */
export const PASS_STACK_METRICS: Readonly<
  Record<PassStackKind, { halfWidth: number; halfLength: number; height: number }>
> = Object.freeze({
  'saucer-stack': { halfWidth: 0.095, halfLength: 0.095, height: 0.1 },
  'cup-stack': { halfWidth: 0.07, halfLength: 0.07, height: 0.2 },
  'demitasse-stack': { halfWidth: 0.055, halfLength: 0.055, height: 0.14 },
  'mug-stack': { halfWidth: 0.078, halfLength: 0.078, height: 0.22 },
  'tumbler-row': { halfWidth: 0.16, halfLength: 0.055, height: 0.15 },
  'paper-cup-stack': { halfWidth: 0.07, halfLength: 0.07, height: 0.21 },
  'corrugated-cup-stack': { halfWidth: 0.075, halfLength: 0.075, height: 0.23 },
  'lid-stack': { halfWidth: 0.065, halfLength: 0.065, height: 0.09 },
  'sleeve-stack': { halfWidth: 0.065, halfLength: 0.065, height: 0.08 },
  'stirrer-cup': { halfWidth: 0.058, halfLength: 0.058, height: 0.19 },
  'reusable-cup-stack': { halfWidth: 0.07, halfLength: 0.07, height: 0.25 },
  'glass-rack': { halfWidth: 0.16, halfLength: 0.07, height: 0.23 },
  'tray-stack': { halfWidth: 0.17, halfLength: 0.115, height: 0.1 },
  'cutlery-caddy': { halfWidth: 0.1, halfLength: 0.08, height: 0.2 },
  'napkin-stack': { halfWidth: 0.09, halfLength: 0.09, height: 0.11 },
});

/** Sub-slot offsets along a counter-pass slot's width, in metres. */
export const PASS_SLOT_OFFSETS: readonly number[] = Object.freeze([-0.36, 0, 0.36]);

/** Stacks placed per counter-pass slot (three fit across a 1.2 m slot). */
export const PASS_STACKS_PER_SLOT = 3;

/** Rotates a table-local point into world space around the table anchor. */
function tablePoint(slot: TableSlot, x: number, z: number, y: number): THREE.Vector3 {
  const cos = Math.cos(slot.orientation);
  const sin = Math.sin(slot.orientation);
  return new THREE.Vector3(
    slot.position.x + x * cos + z * sin,
    y,
    slot.position.z - x * sin + z * cos,
  );
}

/** Yaw that puts an item's local `+X` at seat `seat`'s right hand. */
function yawForSeat(slot: TableSlot, seat: number, extra = 0): number {
  // Chairs sit on the table's long sides — the slot's local X axis (see the
  // furniture module's seating plan) — so the first seat faces local +X and the
  // second local -X, and each item's local +X is turned to the diner's right.
  return slot.orientation + (seat === 0 ? Math.PI / 2 : -Math.PI / 2) + extra;
}

/** Footprint of a round item. */
export function roundFootprint(radius: number): TablewareFootprint {
  return { halfWidth: radius, halfLength: radius };
}

/** Footprint of a drinking vessel: rim, lid overhang and any handle bulge. */
export function vesselFootprint(vessel: VesselSpec): TablewareFootprint {
  const handle = vessel.handle === 'none' ? 0.006 : vessel.handle === 'small-loop' ? 0.026 : 0.032;
  return {
    halfWidth: vessel.rimDiameter / 2 + handle,
    halfLength: vessel.rimDiameter / 2 + 0.006,
  };
}

/** Radius of a printed coaster, in metres. */
export const COASTER_RADIUS = 0.054;

/** Radius of the saucer the era's vessel stands on, in metres. */
export function saucerRadiusFor(vessel: VesselSpec): number {
  if (vessel.kind === 'demitasse-cup') return 0.044;
  return Math.min(Math.max(vessel.rimDiameter * 0.92, 0.058), 0.074);
}

/** Footprint of the rest a vessel stands on (saucer or printed coaster). */
export function restFootprint(vessel: VesselSpec): TablewareFootprint {
  return roundFootprint(vessel.rest === 'coaster' ? COASTER_RADIUS : saucerRadiusFor(vessel));
}

/** Footprint of a piece of cutlery or a stirrer lying flat. */
export function pieceFootprint(kind: CutleryPieceKind | 'teaspoon' | 'stirrer', length: number): TablewareFootprint {
  const halfWidth =
    kind === 'fork' ? 0.015 : kind === 'spoon' ? 0.018 : kind === 'teaspoon' ? 0.017 : kind === 'stirrer' ? 0.012 : 0.013;
  return { halfWidth, halfLength: length / 2 + 0.008 };
}

/** Circumradius of a footprint, used for coarse containment answers. */
export function tablewareFootprintCircumradius(footprint: TablewareFootprint): number {
  return Math.hypot(footprint.halfWidth, footprint.halfLength);
}

/** Local axis of a yawed rectangle: `'width'` is local +X, `'length'` local +Z. */
function footprintAxis(rotationY: number, axis: 'width' | 'length'): { readonly x: number; readonly z: number } {
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return axis === 'width' ? { x: cos, z: -sin } : { x: sin, z: cos };
}

/** The four corners of a placement's footprint, in world space. */
export function tablewareFootprintCorners(
  x: number,
  z: number,
  rotationY: number,
  footprint: TablewareFootprint,
): readonly { readonly x: number; readonly z: number }[] {
  const widthAxis = footprintAxis(rotationY, 'width');
  const lengthAxis = footprintAxis(rotationY, 'length');
  const corners: { x: number; z: number }[] = [];
  for (const widthSign of [-1, 1]) {
    for (const lengthSign of [-1, 1]) {
      const offsetX = widthSign * footprint.halfWidth * widthAxis.x + lengthSign * footprint.halfLength * lengthAxis.x;
      const offsetZ = widthSign * footprint.halfWidth * widthAxis.z + lengthSign * footprint.halfLength * lengthAxis.z;
      corners.push({ x: x + offsetX, z: z + offsetZ });
    }
  }
  return corners;
}

/** True when two placements' oriented footprints intersect (SAT). */
export function tablewareFootprintsOverlap(
  a: TablewarePlacement,
  b: TablewarePlacement,
  epsilon = PLACEMENT_EPSILON,
): boolean {
  const axes = [
    footprintAxis(a.rotationY, 'width'),
    footprintAxis(a.rotationY, 'length'),
    footprintAxis(b.rotationY, 'width'),
    footprintAxis(b.rotationY, 'length'),
  ];
  const delta = { x: b.position.x - a.position.x, z: b.position.z - a.position.z };
  for (const axis of axes) {
    const distance = Math.abs(delta.x * axis.x + delta.z * axis.z);
    const radiusA =
      a.footprint.halfWidth * Math.abs(footprintAxis(a.rotationY, 'width').x * axis.x + footprintAxis(a.rotationY, 'width').z * axis.z) +
      a.footprint.halfLength * Math.abs(footprintAxis(a.rotationY, 'length').x * axis.x + footprintAxis(a.rotationY, 'length').z * axis.z);
    const radiusB =
      b.footprint.halfWidth * Math.abs(footprintAxis(b.rotationY, 'width').x * axis.x + footprintAxis(b.rotationY, 'width').z * axis.z) +
      b.footprint.halfLength * Math.abs(footprintAxis(b.rotationY, 'length').x * axis.x + footprintAxis(b.rotationY, 'length').z * axis.z);
    if (distance - epsilon > radiusA + radiusB) return false;
  }
  return true;
}

/** Distance from `anchor` to the farthest corner of a placement's footprint. */
export function tablewareFootprintReach(
  entry: TablewarePlacement,
  anchorX: number,
  anchorZ: number,
): number {
  const corners = tablewareFootprintCorners(
    entry.position.x,
    entry.position.z,
    entry.rotationY,
    entry.footprint,
  );
  let reach = 0;
  for (const corner of corners) {
    reach = Math.max(reach, Math.hypot(corner.x - anchorX, corner.z - anchorZ));
  }
  return reach;
}

/** Height of a vessel including its lid, in metres. */
function vesselHeight(vessel: VesselSpec): number {
  const lid = vessel.lid === 'none' ? 0 : vessel.lid === 'reusable-lid' ? 0.022 : 0.014;
  return vessel.height + lid;
}

/** Ids of the nested pieces a vessel carries, in build order. */
function eraCutlery(spec: TablewareSpec): readonly CutlerySpec[] {
  return spec.tableService.cutlery.slice(0, 3);
}

/** Builds the place settings of one table slot. */
function planTableSetting(spec: TablewareSpec, slot: TableSlot): TablewarePlacement[] {
  const s = TABLEWARE_SETTING;
  const placements: TablewarePlacement[] = [];
  const seats = Math.max(slot.seats, 1);

  for (let seat = 0; seat < seats; seat += 1) {
    const seatSign = seat === 0 ? 1 : -1;
    /** Local X of the seat's cover (the seat axis). */
    const cover = seatSign * s.coverOffset;
    /** Local X of the era's second vessel: beyond the cover, toward the seat. */
    const secondCover = seatSign * (s.coverOffset + s.secondCoverOffset);
    const prefix = `${slot.id}:seat-${seat + 1}`;

    /* -- the era's cup, on its rest ---------------------------------------- */

    const cup = spec.vessels.cup;
    const rest = cup.rest;
    const restThickness =
      rest === 'saucer' ? s.saucerThickness : rest === 'coaster' ? s.coasterThickness : 0;
    const restId = `${prefix}:rest`;
    if (rest !== 'none') {
      placements.push({
        id: restId,
        kind: rest === 'coaster' ? 'coaster' : 'saucer',
        variant: rest === 'coaster' ? `${cup.kind}-coaster` : `${cup.kind}-saucer`,
        label: rest === 'coaster' ? `Printed coaster for the ${cup.label}` : `Saucer for the ${cup.label}`,
        zone: 'table-setting',
        anchorId: slot.id,
        anchorKind: 'table-slot',
        position: tablePoint(slot, cover, 0, slot.surfaceHeight),
        rotationY: yawForSeat(slot, seat),
        surface: slot.surfaceHeight,
        footprint: restFootprint(cup),
        height: restThickness,
        nestedIn: null,
        pieces: 1,
      });
    }

    placements.push({
      id: `${prefix}:cup`,
      kind: 'cup',
      variant: cup.kind,
      label: cup.label,
      zone: 'table-setting',
      anchorId: slot.id,
      anchorKind: 'table-slot',
      position: tablePoint(slot, cover, 0, slot.surfaceHeight + restThickness),
      rotationY: yawForSeat(slot, seat),
      surface: slot.surfaceHeight,
      footprint: vesselFootprint(cup),
      height: vesselHeight(cup),
      nestedIn: rest === 'none' ? null : restId,
      pieces: 1,
    });

    /* -- the teaspoon, resting on the saucer ------------------------------- */

    const teaspoon = spec.tableService.teaspoon;
    const spoonId = `${prefix}:teaspoon`;
    // With a rest the teaspoon waits on the saucer; without one (the paper-cup
    // era) it lies on the table in the cutlery lane, beside the last piece.
    const spoonLane =
      seatSign * (s.cutleryOffset + eraCutlery(spec).length * s.cutlerySpread);
    placements.push({
      id: spoonId,
      kind: 'teaspoon',
      variant: teaspoon.label,
      label: teaspoon.label,
      zone: 'table-setting',
      anchorId: slot.id,
      anchorKind: 'table-slot',
      position:
        rest === 'none'
          ? tablePoint(slot, cover, spoonLane, slot.surfaceHeight)
          : tablePoint(slot, cover - seatSign * s.spoonOffset, 0, slot.surfaceHeight + s.spoonHeight),
      rotationY: yawForSeat(slot, seat, rest === 'none' ? Math.PI : 0),
      surface: slot.surfaceHeight,
      footprint: pieceFootprint('teaspoon', teaspoon.length),
      height: 0.012,
      nestedIn: rest === 'none' ? null : restId,
      pieces: 1,
    });

    /* -- the era's second vessel (tumbler, demitasse or double-walled glass) */

    const second = spec.vessels.espresso ?? spec.vessels.tumbler;
    if (second) {
      const secondRest = second.rest;
      const secondRestThickness =
        secondRest === 'saucer'
          ? s.demitasseSaucerThickness
          : secondRest === 'coaster'
            ? s.coasterThickness
            : 0;
      const secondRestId = `${prefix}:${second.kind}-rest`;
      if (secondRest !== 'none') {
        placements.push({
          id: secondRestId,
          kind: secondRest === 'coaster' ? 'coaster' : 'demitasse-saucer',
          variant: `${second.kind}-saucer`,
          label: `Saucer for the ${second.label}`,
          zone: 'table-setting',
          anchorId: slot.id,
          anchorKind: 'table-slot',
          position: tablePoint(slot, secondCover, 0, slot.surfaceHeight),
          rotationY: yawForSeat(slot, seat),
          surface: slot.surfaceHeight,
          footprint: restFootprint(second),
          height: secondRestThickness,
          nestedIn: null,
          pieces: 1,
        });
      }
      placements.push({
        id: `${prefix}:${second.kind}`,
        kind:
          second.kind === 'demitasse-cup'
            ? 'demitasse-cup'
            : second.kind === 'double-walled-glass'
              ? 'double-walled-glass'
              : second.kind === 'reusable-cup'
                ? 'reusable-cup'
                : second.kind === 'lidded-cup'
                  ? 'lidded-cup'
                  : second.kind === 'paper-cup'
                    ? 'paper-cup'
                    : second.kind === 'corrugated-cup'
                      ? 'corrugated-cup'
                      : 'glass-tumbler',
        variant: second.kind,
        label: second.label,
        zone: 'table-setting',
        anchorId: slot.id,
        anchorKind: 'table-slot',
        position: tablePoint(
          slot,
          secondCover,
          0,
          slot.surfaceHeight + secondRestThickness,
        ),
        rotationY: yawForSeat(slot, seat),
        surface: slot.surfaceHeight,
        footprint: vesselFootprint(second),
        height: vesselHeight(second),
        nestedIn: secondRest === 'none' ? null : secondRestId,
        pieces: 1,
      });
    }

    /* -- the era's cutlery laid beside the setting ------------------------- */

    const cutlery = eraCutlery(spec);
    cutlery.forEach((piece, index) => {
      // The knife lies to the diner's right, the fork (and any spoon) to their
      // left, both parallel to the seat axis with the blade toward the table.
      const side = index === 0 ? -1 : 1;
      const lane = index === 0 ? s.cutleryOffset : s.cutleryOffset + (index - 1) * s.cutlerySpread;
      placements.push({
        id: `${prefix}:${piece.kind}`,
        kind: piece.kind,
        variant: `${piece.kind}:${piece.metalSlot}${piece.handleSlot ? `+${piece.handleSlot}` : ''}`,
        label: piece.label,
        zone: 'table-setting',
        anchorId: slot.id,
        anchorKind: 'table-slot',
        position: tablePoint(slot, cover, seatSign * side * lane, slot.surfaceHeight),
        rotationY: yawForSeat(slot, seat, Math.PI),
        surface: slot.surfaceHeight,
        footprint: pieceFootprint(piece.kind, piece.length),
        height: 0.012,
        nestedIn: null,
        pieces: 1,
      });
    });
  }

  /* -- the centre of the table ------------------------------------------- */

  const service = spec.tableService;
  const centre = (
    id: string,
    kind: TablewareItemKind,
    variant: string,
    label: string,
    at: { readonly x: number; readonly z: number },
    footprint: TablewareFootprint,
    height: number,
  ): TablewarePlacement => ({
    id: `${slot.id}:${id}`,
    kind,
    variant,
    label,
    zone: 'table-setting',
    anchorId: slot.id,
    anchorKind: 'table-slot',
    position: tablePoint(slot, at.x, at.z, slot.surfaceHeight),
    rotationY: slot.orientation,
    surface: slot.surfaceHeight,
    footprint,
    height,
    nestedIn: null,
    pieces: 1,
  });

  placements.push(
    centre(
      'sugar-bowl',
      'sugar-bowl',
      service.sugarBowl.style,
      service.sugarBowl.label,
      s.sugar,
      roundFootprint(0.05),
      0.1,
    ),
  );
  placements.push(
    centre(
      'creamer',
      'creamer',
      service.creamer.style,
      service.creamer.label,
      s.creamer,
      { halfWidth: 0.053, halfLength: 0.045 },
      0.09,
    ),
  );
  placements.push(
    centre(
      'condiment-caddy',
      'condiment-caddy',
      service.condimentCaddy.sachets ? 'sachet-caddy' : 'bottle-caddy',
      service.condimentCaddy.label,
      s.caddy,
      { halfWidth: 0.065, halfLength: 0.045 },
      0.115,
    ),
  );
  placements.push(
    centre(
      'napkin-holder',
      'napkin-holder',
      service.napkinHolder.style,
      service.napkinHolder.label,
      s.napkin,
      roundFootprint(0.055),
      0.09,
    ),
  );
  if (service.ashtray) {
    placements.push(
      centre(
        'ashtray',
        'ashtray',
        service.ashtray.style,
        service.ashtray.label,
        s.ashtray,
        roundFootprint(service.ashtray.diameter / 2 + 0.004),
        0.035,
      ),
    );
  }

  return placements;
}

/** Builds the counter-pass stacks for one era. */
function planCounterPass(spec: TablewareSpec, layout: StructuralLayout): TablewarePlacement[] {
  const eligible = layout.counterPassSlots.filter(
    (slot) => slot.kind === 'tray-run' || slot.kind === 'handoff',
  );
  const slots = eligible.length > 0 ? eligible : layout.counterPassSlots;
  if (slots.length === 0) return [];

  const placements: TablewarePlacement[] = [];
  spec.counterPass.stacks.forEach((stack, index) => {
    const slot = slots[Math.floor(index / PASS_STACKS_PER_SLOT) % slots.length] as CounterPassSlot;
    const offset = PASS_SLOT_OFFSETS[index % PASS_STACKS_PER_SLOT] ?? 0;
    const metrics = PASS_STACK_METRICS[stack.kind];
    placements.push({
      id: `${slot.id}:${stack.kind}`,
      kind: stack.kind,
      variant: stack.kind,
      label: stack.label,
      zone: 'counter-pass',
      anchorId: slot.id,
      anchorKind: 'counter-pass',
      position: new THREE.Vector3(slot.position.x + offset, slot.surfaceHeight, slot.position.z),
      rotationY: 0,
      surface: slot.surfaceHeight,
      footprint: { halfWidth: metrics.halfWidth, halfLength: metrics.halfLength },
      height: metrics.height,
      nestedIn: null,
      pieces: Math.max(stack.pieces, 1),
    });
  });
  return placements;
}

/** Stable fingerprint of a plan: identical for identical eras and layouts. */
export function tablewarePlanSignature(
  plan: TablewarePlan | readonly TablewarePlacement[],
): string {
  const entries: readonly TablewarePlacement[] = Array.isArray(plan)
    ? [...(plan as readonly TablewarePlacement[])]
    : (plan as TablewarePlan).entries;
  const parts = entries.map(
    (entry) =>
      `${entry.id}@${entry.position.x.toFixed(4)},${entry.position.y.toFixed(4)},${entry.position.z.toFixed(4)}~${entry.rotationY.toFixed(4)}`,
  );
  return parts.join('|');
}

/**
 * Turns the era spec plus the environment's structural anchors into the complete
 * list of pieces to build. Pure: no three.js meshes, no side effects, so the
 * plan can be asserted on its own and re-derived identically by the tests.
 */
export function planTableware(input: TablewarePlanInput): TablewarePlan {
  const { spec, layout } = input;
  const tableSettings: TablewarePlacement[] = [];
  for (const slot of layout.tableSlots) {
    tableSettings.push(...planTableSetting(spec, slot));
  }
  const counterPass = planCounterPass(spec, layout);
  const entries = [...tableSettings, ...counterPass];
  const anchorIds = [...new Set(entries.map((entry) => entry.anchorId))].sort();
  return Object.freeze({
    year: spec.year,
    entries: Object.freeze(entries),
    tableSettings: Object.freeze(tableSettings),
    counterPass: Object.freeze(counterPass),
    anchorIds: Object.freeze(anchorIds),
    signature: tablewarePlanSignature(entries),
  });
}

const PLACEMENT_EPSILON = 1e-6;

/**
 * Checks a plan against the anchors it claims to use and returns prose problems
 * (`[]` when the era's service is sound). Used by the module's own diagnostics
 * and by the tests:
 *
 *  - every item names a real table slot or counter-pass slot,
 *  - free standing items sit *exactly* on the anchor's published surface height,
 *  - nested items sit on top of the item they name,
 *  - table items stay inside the setting footprint, pass items inside their slot,
 *  - items inside the room, nothing floating, nothing intersecting anything it
 *    is not deliberately resting on.
 */
export function tablewarePlacementProblems(
  plan: TablewarePlan,
  layout: StructuralLayout,
  bounds: RoomBounds,
): readonly string[] {
  const problems: string[] = [];
  const tableSlots = new Map(layout.tableSlots.map((slot) => [slot.id, slot] as const));
  const passSlots = new Map(layout.counterPassSlots.map((slot) => [slot.id, slot] as const));
  const byId = new Map(plan.entries.map((entry) => [entry.id, entry] as const));
  const margin = 0.02;

  for (const entry of plan.entries) {
    const slot = tableSlots.get(entry.anchorId) ?? passSlots.get(entry.anchorId);
    if (!slot) {
      problems.push(`${entry.id}: anchors to unknown ${entry.anchorKind} ${entry.anchorId}`);
      continue;
    }
    if (entry.nestedIn === null && Math.abs(entry.position.y - entry.surface) > PLACEMENT_EPSILON) {
      problems.push(`${entry.id}: does not sit flush on the ${entry.anchorId} surface height`);
    }
    if (Math.abs(slot.surfaceHeight - entry.surface) > PLACEMENT_EPSILON) {
      problems.push(`${entry.id}: surface ${entry.surface} does not match ${entry.anchorId}`);
    }
    const corners = tablewareFootprintCorners(
      entry.position.x,
      entry.position.z,
      entry.rotationY,
      entry.footprint,
    );
    if (
      entry.position.y < -PLACEMENT_EPSILON ||
      entry.position.y + entry.height > bounds.height + PLACEMENT_EPSILON
    ) {
      problems.push(`${entry.id}: escapes the room volume`);
    }
    for (const corner of corners) {
      if (
        Math.abs(corner.x) > bounds.width / 2 - margin ||
        Math.abs(corner.z) > bounds.depth / 2 - margin
      ) {
        problems.push(`${entry.id}: its footprint escapes the room volume`);
        break;
      }
    }
    if (entry.nestedIn === null) {
      if (entry.anchorKind === 'table-slot') {
        const reach = tablewareFootprintReach(entry, slot.position.x, slot.position.z);
        if (reach > TABLEWARE_SETTING.maxReach + PLACEMENT_EPSILON) {
          problems.push(`${entry.id}: reaches ${reach.toFixed(3)} m past the table top`);
        }
      } else {
        const halfWidth = (slot as CounterPassSlot).width / 2;
        const halfDepth = (slot as CounterPassSlot).depth / 2;
        for (const corner of corners) {
          if (
            Math.abs(corner.x - slot.position.x) > halfWidth + PLACEMENT_EPSILON ||
            Math.abs(corner.z - slot.position.z) > halfDepth + PLACEMENT_EPSILON
          ) {
            problems.push(`${entry.id}: overhangs the ${entry.anchorId} pass slot`);
            break;
          }
        }
      }
    } else {
      const host = byId.get(entry.nestedIn);
      if (!host) {
        problems.push(`${entry.id}: rests on missing item ${entry.nestedIn}`);
      } else {
        const widthAxis = footprintAxis(host.rotationY, 'width');
        const lengthAxis = footprintAxis(host.rotationY, 'length');
        const offsetX = entry.position.x - host.position.x;
        const offsetZ = entry.position.z - host.position.z;
        const localX = offsetX * widthAxis.x + offsetZ * widthAxis.z;
        const localZ = offsetX * lengthAxis.x + offsetZ * lengthAxis.z;
        if (
          Math.abs(localX) > host.footprint.halfWidth + PLACEMENT_EPSILON ||
          Math.abs(localZ) > host.footprint.halfLength + PLACEMENT_EPSILON
        ) {
          problems.push(`${entry.id}: does not rest on ${host.id}`);
        }
        if (entry.position.y < host.position.y - PLACEMENT_EPSILON) {
          problems.push(`${entry.id}: sits below ${host.id}`);
        }
      }
    }
  }

  const groups = new Map<string, TablewarePlacement[]>();
  for (const entry of plan.entries) {
    if (entry.nestedIn !== null) continue;
    const list = groups.get(entry.anchorId);
    if (list) list.push(entry);
    else groups.set(entry.anchorId, [entry]);
  }
  for (const [anchorId, entries] of groups) {
    for (let a = 0; a < entries.length; a += 1) {
      for (let b = a + 1; b < entries.length; b += 1) {
        const left = entries[a];
        const right = entries[b];
        if (!left || !right) continue;
        if (tablewareFootprintsOverlap(left, right)) {
          problems.push(`${left.id} overlaps ${right.id} on ${anchorId}`);
        }
      }
    }
  }

  return problems;
}

/* -------------------------------------------------------------------------- */
/* Era spec map                                                               */
/* -------------------------------------------------------------------------- */

const SPEC_SOURCES: Readonly<Record<YearId, TablewareSpec>> = {
  '1945': SPEC_1945,
  '1965': SPEC_1965,
  '1985': SPEC_1985,
  '2005': SPEC_2005,
  '2025': SPEC_2025,
};

function buildSpecMap(): Readonly<Record<YearId, TablewareSpec>> {
  const map = {} as Record<YearId, TablewareSpec>;
  for (const year of YEAR_IDS) {
    const spec = SPEC_SOURCES[year];
    if (!spec) throw new Error(`Missing tableware spec for ${year}.`);
    if (spec.year !== year) {
      throw new Error(`Tableware spec keyed ${year} declares year ${spec.year}.`);
    }
    for (const slot of TABLEWARE_MATERIAL_SLOTS) {
      if (!spec.surfaces[slot]) {
        throw new Error(`The ${year} tableware spec is missing the "${slot}" surface.`);
      }
    }
    map[year] = spec;
  }
  return Object.freeze(map);
}

/** Per-year tableware specs, keyed by {@link YearId}. */
export const TABLEWARE_SPECS: Readonly<Record<YearId, TablewareSpec>> = buildSpecMap();

/** The five eras the tableware domain has data for, in chronological order. */
export const TABLEWARE_SPEC_YEARS: readonly YearId[] = Object.freeze([...YEAR_IDS]);

/** Looks up an era spec, throwing for an unsupported year. */
export function tablewareSpec(year: YearId): TablewareSpec {
  const spec = TABLEWARE_SPECS[year];
  if (!spec) throw new Error(`No tableware spec for ${year}.`);
  return spec;
}

/** Every era spec, in chronological order. */
export function tablewareSpecs(): readonly TablewareSpec[] {
  return TABLEWARE_SPEC_YEARS.map((year) => tablewareSpec(year));
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

/** Flattened view of an era's tableware, used by diagnostics and the tests. */
export interface TablewareSpecSummary {
  readonly year: YearId;
  readonly name: string;
  readonly paletteName: string;
  readonly materialSetId: string;
  /** Every vessel the era puts on a table, in role order. */
  readonly vessels: string;
  readonly cup: VesselKind;
  readonly espresso: VesselKind | 'none';
  readonly tumbler: VesselKind | 'none';
  readonly takeaway: VesselKind | 'none';
  readonly serveMl: number;
  /** Fraction of the cup the era actually pours. */
  readonly fillFraction: number;
  readonly handle: VesselSpec['handle'];
  readonly rest: VesselRest;
  readonly lid: VesselLid;
  readonly sleeve: VesselSleeve;
  readonly cutlery: string;
  readonly teaspoon: string;
  readonly sugarBowl: SugarBowlStyle;
  readonly creamer: CreamerStyle;
  readonly condimentCaddy: string;
  readonly napkinHolder: NapkinHolderStyle;
  readonly ashtray: AshtrayStyle | 'none';
  readonly tray: TrayStyle | 'none';
  readonly passStacks: string;
  readonly serviceRule: string;
  readonly accent: string;
}

/** Flattens an era spec into the summary used by diagnostics and the tests. */
export function describeTablewareSpec(spec: TablewareSpec): TablewareSpecSummary {
  const service = spec.tableService;
  const caddy = service.condimentCaddy;
  return {
    year: spec.year,
    name: spec.name,
    paletteName: spec.paletteName,
    materialSetId: spec.materialSetId,
    vessels: [spec.vessels.cup.kind, spec.vessels.espresso?.kind, spec.vessels.tumbler?.kind, spec.vessels.takeaway?.kind]
      .filter((kind): kind is VesselKind => kind !== undefined)
      .join('+'),
    cup: spec.vessels.cup.kind,
    espresso: spec.vessels.espresso?.kind ?? 'none',
    tumbler: spec.vessels.tumbler?.kind ?? 'none',
    takeaway: spec.vessels.takeaway?.kind ?? 'none',
    serveMl: spec.vessels.serveMl,
    fillFraction: spec.vessels.cup.fillFraction,
    handle: spec.vessels.cup.handle,
    rest: spec.vessels.cup.rest,
    lid: spec.vessels.cup.lid,
    sleeve: spec.vessels.cup.sleeve,
    cutlery: service.cutlery
      .map((piece) => `${piece.kind}:${piece.metalSlot}${piece.handleSlot ? `+${piece.handleSlot}` : ''}`)
      .join(','),
    teaspoon: `${service.teaspoon.metalSlot}:${service.teaspoon.length}`,
    sugarBowl: service.sugarBowl.style,
    creamer: service.creamer.style,
    condimentCaddy: `${caddy.traySlot}:${caddy.bottles}b${caddy.sachets ? '+sachets' : ''}${
      caddy.stirrers > 0 ? `+${caddy.stirrers}stirrers` : ''
    }`,
    napkinHolder: service.napkinHolder.style,
    ashtray: service.ashtray?.style ?? 'none',
    tray: service.tray?.style ?? 'none',
    passStacks: spec.counterPass.stacks.map((stack) => stack.kind).join('+'),
    serviceRule: service.placement,
    accent: spec.accentColor,
  };
}

/**
 * Fields the timeline is expected to move between eras. The nullable vessel
 * roles are folded into {@link TablewareSpecSummary.vessels} so two eras can
 * never look identical just because neither has, say, a demitasse.
 */
export const TABLEWARE_ERA_DISCRIMINATOR_FIELDS = Object.freeze([
  'name',
  'paletteName',
  'materialSetId',
  'vessels',
  'serveMl',
  'fillFraction',
  'cutlery',
  'teaspoon',
  'sugarBowl',
  'creamer',
  'condimentCaddy',
  'napkinHolder',
  'ashtray',
  'tray',
  'passStacks',
  'accent',
] as const satisfies readonly (keyof TablewareSpecSummary)[]);

/**
 * Returns the discriminator fields that share a value across two eras. An empty
 * array means the two eras read as completely different services.
 */
export function tablewareEraConflicts(
  a: TablewareSpecSummary,
  b: TablewareSpecSummary,
): readonly (keyof TablewareSpecSummary)[] {
  return TABLEWARE_ERA_DISCRIMINATOR_FIELDS.filter((field) => a[field] === b[field]);
}

/** Stable module id: registry key, hotspot owner id and node namespace. */
export const TABLEWARE_MODULE_ID = 'tableware';

/** Name of the single group every tableware node is parented to. */
export const TABLEWARE_GROUP_NAME = 'tableware';

/** Names of the two zone groups inside the module's group. */
export const TABLEWARE_ZONE_GROUP_NAMES = Object.freeze({
  tables: 'tableware-tables',
  counterPass: 'tableware-counter-pass',
});

/** Seed of the module's per-era deterministic variation source. */
export const DEFAULT_TABLEWARE_SEED = 0x7ab1;

export interface TablewareModuleOptions {
  /** Interior volume; defaults to {@link CAFE_ROOM_BOUNDS}. */
  readonly bounds?: RoomBounds;
  /** Structural anchor set; defaults to {@link STRUCTURAL_LAYOUT}. */
  readonly layout?: StructuralLayout;
  /** Canvas factory for the procedural surfaces (defaults to the DOM canvas). */
  readonly canvasFactory?: CanvasFactory;
  /** Texture resolution override for every tableware surface. */
  readonly textureSize?: number;
  /** Era reported by `getHotspots` before the first build. */
  readonly initialYear?: YearId;
  /** Module seed; defaults to {@link DEFAULT_TABLEWARE_SEED}. */
  readonly seed?: number;
}

/** Footprint of one built item prototype, measured off its real geometry. */
export interface TablewareItemFootprint {
  /** Radius of the smallest circle around the item, in metres. */
  readonly radius: number;
  /** Local `+X` / `-X` reach of the built geometry, in metres. */
  readonly halfWidth: number;
  /** Local `+Z` / `-Z` reach of the built geometry, in metres. */
  readonly halfLength: number;
  readonly height: number;
  readonly parts: number;
  readonly instances: number;
}

/** Diagnostics snapshot of the module for one moment in the timeline. */
export interface TablewareModuleDescription {
  readonly moduleId: string;
  readonly year: YearId;
  readonly built: boolean;
  readonly paletteName: string | null;
  readonly materialSetId: string | null;
  readonly textureSource: TablewareMaterialSet['textureSource'] | 'none';
  readonly textureCount: number;
  readonly materialCount: number;
  readonly nodeCount: number;
  readonly meshCount: number;
  readonly instanceCount: number;
  readonly placementCount: number;
  readonly placementCounts: Readonly<Record<string, number>>;
  readonly variantCount: number;
  readonly placementProblems: readonly string[];
  readonly summary: TablewareSpecSummary;
}

/* -------------------------------------------------------------------------- */
/* Geometry: cached primitives, prototype parts                               */
/* -------------------------------------------------------------------------- */

/** One BufferGeometry per distinct shape, shared by every prototype part. */
interface GeometryCache {
  readonly geometries: Map<string, THREE.BufferGeometry>;
}

function cachedGeometry(
  cache: GeometryCache,
  key: string,
  create: () => THREE.BufferGeometry,
): THREE.BufferGeometry {
  const existing = cache.geometries.get(key);
  if (existing) return existing;
  const geometry = create();
  geometry.name = key;
  cache.geometries.set(key, geometry);
  return geometry;
}

function cylinderGeometry(
  cache: GeometryCache,
  key: string,
  topRadius: number,
  bottomRadius: number,
  height: number,
  segments = 20,
  openEnded = false,
): THREE.BufferGeometry {
  return cachedGeometry(
    cache,
    key,
    () =>
      new THREE.CylinderGeometry(
        Math.max(topRadius, 0.001),
        Math.max(bottomRadius, 0.001),
        Math.max(height, 0.001),
        segments,
        1,
        openEnded,
      ),
  );
}

function discGeometry(
  cache: GeometryCache,
  key: string,
  radius: number,
  segments = 20,
): THREE.BufferGeometry {
  return cachedGeometry(cache, key, () => {
    const geometry = new THREE.CircleGeometry(Math.max(radius, 0.001), segments);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  });
}

function torusGeometry(
  cache: GeometryCache,
  key: string,
  radius: number,
  tube: number,
  radialSegments = 8,
  tubularSegments = 20,
  arc = Math.PI * 2,
  plane: 'flat' | 'upright' = 'flat',
): THREE.BufferGeometry {
  return cachedGeometry(
    cache,
    `${key}:${plane}`,
    () => {
      const geometry = new THREE.TorusGeometry(
        Math.max(radius, 0.001),
        Math.max(tube, 0.0005),
        radialSegments,
        tubularSegments,
        arc,
      );
      // Rims, lips, wells and foot rings lie flat on the table top; only the
      // handles of the cups and jugs stand upright.
      if (plane === 'flat') geometry.rotateX(-Math.PI / 2);
      return geometry;
    },
  );
}

function boxGeometry(
  cache: GeometryCache,
  key: string,
  width: number,
  height: number,
  depth: number,
): THREE.BufferGeometry {
  return cachedGeometry(
    cache,
    key,
    () => new THREE.BoxGeometry(Math.max(width, 0.001), Math.max(height, 0.001), Math.max(depth, 0.001)),
  );
}

function sphereGeometry(
  cache: GeometryCache,
  key: string,
  radius: number,
  widthSegments = 10,
  heightSegments = 8,
): THREE.BufferGeometry {
  return cachedGeometry(
    cache,
    key,
    () => new THREE.SphereGeometry(Math.max(radius, 0.001), widthSegments, heightSegments),
  );
}

/** One primitive of an item prototype, in the item's own local frame. */
interface TablewarePart {
  readonly key: string;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly matrix: THREE.Matrix4;
}

function makePart(
  key: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: readonly [number, number, number] = [0, 0, 0],
  rotation: readonly [number, number, number] = [0, 0, 0],
): TablewarePart {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(position[0], position[1], position[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ')),
    new THREE.Vector3(1, 1, 1),
  );
  return { key, geometry, material, matrix };
}

/** Copies a prototype's parts, shifted by (`dx`, `dy`, `dz`) and re-keyed. */
function offsetParts(
  parts: readonly TablewarePart[],
  prefix: string,
  dx: number,
  dy: number,
  dz: number,
): TablewarePart[] {
  const translate = new THREE.Matrix4().makeTranslation(dx, dy, dz);
  return parts.map((part, index) => ({
    ...part,
    key: `${prefix}:${index}:${part.key}`,
    matrix: new THREE.Matrix4().copy(translate).multiply(part.matrix),
  }));
}

/** Repeats a prototype's parts (nested stacking, rows and bundles). */
function repeatParts(
  parts: readonly TablewarePart[],
  prefix: string,
  count: number,
  dy: number,
  dx = 0,
  dz = 0,
  centre = false,
): TablewarePart[] {
  const repeated: TablewarePart[] = [];
  const origin = centre ? (count - 1) / 2 : 0;
  for (let index = 0; index < count; index += 1) {
    const step = index - origin;
    repeated.push(...offsetParts(parts, `${prefix}:${index}`, dx * step, dy * index, dz * step));
  }
  return repeated;
}

/** Everything an item builder needs: the era spec and its material set. */
interface ItemBuildContext {
  readonly spec: TablewareSpec;
  readonly materials: TablewareMaterialSet;
  readonly cache: GeometryCache;
}

function slotMaterial(context: ItemBuildContext, slot: TablewareMaterialSlot): THREE.Material {
  return tablewareMaterial(context.materials, slot);
}

/* -- vessels ---------------------------------------------------------------- */

/** Builds one drinking vessel: wall, cavity, rim, foot, contents, trim. */
function vesselParts(context: ItemBuildContext, vessel: VesselSpec): TablewarePart[] {
  const { cache } = context;
  const key = vessel.kind;
  const body = slotMaterial(context, vessel.bodySlot);
  const trim = vessel.trimSlot ? slotMaterial(context, vessel.trimSlot) : body;
  const parts: TablewarePart[] = [];
  const rTop = vessel.rimDiameter / 2;
  const rBottom = vessel.baseDiameter / 2;
  const wall = Math.max(vessel.wall, 0.0015);
  const segments = vessel.kind === 'china-cup' || vessel.kind === 'narrow-rim-cup' ? 24 : 20;
  const straight =
    vessel.kind === 'stoneware-mug' ||
    vessel.kind === 'glass-tumbler' ||
    vessel.kind === 'reusable-cup' ||
    vessel.kind === 'lidded-cup';
  const topRadius = straight ? Math.max(rBottom, rTop * 0.98) : rTop;
  const isGlass = vessel.kind === 'glass-tumbler' || vessel.kind === 'double-walled-glass';

  parts.push(
    makePart(
      `${key}:wall`,
      cylinderGeometry(cache, `${key}:wall`, topRadius, rBottom, vessel.height, segments, true),
      body,
      [0, vessel.height / 2, 0],
    ),
  );
  parts.push(
    makePart(
      `${key}:floor`,
      discGeometry(cache, `${key}:floor`, Math.max(rBottom - wall * 0.6, 0.004), segments),
      body,
      [0, wall, 0],
    ),
  );
  parts.push(
    makePart(
      `${key}:rim`,
      torusGeometry(cache, `${key}:rim`, Math.max(topRadius - wall * 0.5, 0.004), wall * 0.8, 8, segments),
      trim,
      [0, vessel.height, 0],
    ),
  );
  if (vessel.kind === 'china-cup' || vessel.kind === 'stoneware-mug' || isGlass) {
    parts.push(
      makePart(
        `${key}:foot`,
        torusGeometry(cache, `${key}:foot`, Math.max(rBottom - wall, 0.004), wall * 0.9, 6, segments),
        trim,
        [0, wall * 0.95, 0],
      ),
    );
  }
  if (isGlass) {
    parts.push(
      makePart(
        `${key}:base`,
        cylinderGeometry(cache, `${key}:base`, rBottom * 0.96, rBottom * 0.96, 0.014, segments),
        body,
        [0, 0.007, 0],
      ),
    );
  }
  if (vessel.kind === 'double-walled-glass') {
    const inner = Math.max(topRadius - wall * 2.4, 0.006);
    parts.push(
      makePart(
        `${key}:inner`,
        cylinderGeometry(cache, `${key}:inner`, inner, Math.max(rBottom - wall * 2, 0.006), vessel.height * 0.9, 16, true),
        body,
        [0, vessel.height * 0.47, 0],
      ),
    );
    parts.push(
      makePart(
        `${key}:inner-floor`,
        discGeometry(cache, `${key}:inner-floor`, Math.max(inner - wall, 0.004), 16),
        body,
        [0, 0.012, 0],
      ),
    );
  }
  if (vessel.fillFraction > 0) {
    const cavity = Math.max(vessel.height - wall * 2, 0.004);
    const fillRadius = Math.max((topRadius + rBottom) / 2 - wall * 1.3, 0.004);
    parts.push(
      makePart(
        `${key}:contents`,
        discGeometry(cache, `${key}:contents`, fillRadius, segments),
        slotMaterial(context, isGlass ? 'tintedGlass' : 'brew'),
        [0, wall * 2 + cavity * Math.min(Math.max(vessel.fillFraction, 0), 1), 0],
      ),
    );
  }
  if (vessel.handle !== 'none') {
    const handleRadius = vessel.handle === 'small-loop' ? 0.019 : 0.026;
    const tube = vessel.handle === 'small-loop' ? 0.005 : 0.0075;
    parts.push(
      makePart(
        `${key}:handle`,
        torusGeometry(cache, `${key}:handle`, handleRadius, tube, 8, 18, Math.PI, 'upright'),
        trim,
        [topRadius - wall * 0.4, vessel.height * 0.42, 0],
        [0, 0, -Math.PI / 2],
      ),
    );
  }
  if (vessel.printSlot && vessel.mark) {
    const bandRadius = Math.max(topRadius - wall * 0.5, 0.004) + 0.0012;
    const bandHeight = Math.min(vessel.height * 0.42, 0.05);
    parts.push(
      makePart(
        `${key}:print`,
        cylinderGeometry(cache, `${key}:print`, bandRadius, bandRadius, bandHeight, segments, true),
        slotMaterial(context, vessel.printSlot),
        [0, vessel.height * 0.5, 0],
      ),
    );
  }
  if (vessel.sleeve !== 'none') {
    const sleeveSlot: TablewareMaterialSlot =
      vessel.sleeve === 'corrugated-sleeve'
        ? 'corrugated'
        : vessel.sleeve === 'silicone-band'
          ? 'rubber'
          : 'sleeve';
    const sleeveMaterial = slotMaterial(context, sleeveSlot);
    const lowRadius = rBottom + (topRadius - rBottom) * 0.3 + 0.004;
    const highRadius = rBottom + (topRadius - rBottom) * 0.72 + 0.004;
    const sleeveHeight = Math.min(vessel.height * 0.34, 0.05);
    const low = vessel.height * 0.32;
    parts.push(
      makePart(
        `${key}:sleeve`,
        cylinderGeometry(cache, `${key}:sleeve`, highRadius, lowRadius, sleeveHeight, segments, true),
        sleeveMaterial,
        [0, low + sleeveHeight / 2, 0],
      ),
    );
    parts.push(
      makePart(
        `${key}:sleeve-top`,
        torusGeometry(cache, `${key}:sleeve-top`, Math.max(highRadius - 0.001, 0.004), 0.0015, 5, segments),
        sleeveMaterial,
        [0, low + sleeveHeight, 0],
      ),
    );
    parts.push(
      makePart(
        `${key}:sleeve-foot`,
        torusGeometry(cache, `${key}:sleeve-foot`, Math.max(lowRadius - 0.001, 0.004), 0.0015, 5, segments),
        sleeveMaterial,
        [0, low, 0],
      ),
    );
  }
  if (vessel.lid !== 'none') {
    const lidSlot: TablewareMaterialSlot =
      vessel.lid === 'paper-lid' ? 'paper' : vessel.lid === 'reusable-lid' ? 'accent' : 'plastic';
    const lidMaterial = slotMaterial(context, lidSlot);
    const lidRadius = topRadius + 0.003;
    const lidHeight = vessel.lid === 'reusable-lid' ? 0.018 : 0.011;
    parts.push(
      makePart(
        `${key}:lid-band`,
        cylinderGeometry(cache, `${key}:lid-band`, lidRadius, lidRadius, lidHeight * 0.5, segments, true),
        lidMaterial,
        [0, vessel.height + lidHeight * 0.25, 0],
      ),
    );
    parts.push(
      makePart(
        `${key}:lid-top`,
        discGeometry(cache, `${key}:lid-top`, Math.max(lidRadius - 0.002, 0.004), segments),
        lidMaterial,
        [0, vessel.height + lidHeight * 0.5, 0],
      ),
    );
    parts.push(
      makePart(
        `${key}:lid-rim`,
        torusGeometry(cache, `${key}:lid-rim`, Math.max(lidRadius - 0.001, 0.004), 0.0018, 5, segments),
        lidMaterial,
        [0, vessel.height + lidHeight * 0.25, 0],
      ),
    );
    if (vessel.lid === 'reusable-lid') {
      parts.push(
        makePart(
          `${key}:lid-spout`,
          boxGeometry(cache, `${key}:lid-spout`, 0.03, 0.008, 0.026),
          lidMaterial,
          [lidRadius * 0.42, vessel.height + lidHeight * 0.55, 0],
        ),
      );
    }
    if (vessel.lid === 'paper-lid') {
      parts.push(
        makePart(
          `${key}:lid-tab`,
          boxGeometry(cache, `${key}:lid-tab`, 0.016, 0.003, 0.012),
          lidMaterial,
          [lidRadius * 0.6, vessel.height, 0],
        ),
      );
    }
  }
  return parts;
}

/* -- rests ------------------------------------------------------------------ */

interface RestBuildOptions {
  readonly key: string;
  readonly slot: TablewareMaterialSlot;
  readonly radius: number;
  readonly thickness: number;
  /** Printed coaster rather than a saucer with a well. */
  readonly printed: boolean;
}

/** Saucer, demitasse saucer or printed coaster: plate, lip, well, ring. */
function restParts(context: ItemBuildContext, options: RestBuildOptions): TablewarePart[] {
  const { cache } = context;
  const material = slotMaterial(context, options.slot);
  const parts: TablewarePart[] = [
    makePart(
      `${options.key}:plate`,
      cylinderGeometry(cache, `${options.key}:plate`, options.radius, options.radius * 0.93, options.thickness, 24),
      material,
      [0, options.thickness / 2, 0],
    ),
    makePart(
      `${options.key}:lip`,
      torusGeometry(cache, `${options.key}:lip`, Math.max(options.radius - 0.004, 0.004), 0.0024, 6, 24),
      material,
      [0, options.thickness, 0],
    ),
  ];
  parts.push(
    options.printed
      ? makePart(
          `${options.key}:ring`,
          torusGeometry(cache, `${options.key}:ring`, options.radius * 0.68, 0.0016, 4, 20),
          material,
          [0, options.thickness, 0],
        )
      : makePart(
          `${options.key}:well`,
          torusGeometry(cache, `${options.key}:well`, options.radius * 0.5, 0.0032, 6, 20),
          material,
          [0, options.thickness, 0],
        ),
  );
  return parts;
}

/* -- cutlery ---------------------------------------------------------------- */

interface CutleryBuildOptions {
  readonly key: string;
  readonly kind: CutleryPieceKind | 'teaspoon' | 'stirrer';
  readonly length: number;
  readonly metalSlot: TablewareMaterialSlot;
  readonly handleSlot: TablewareMaterialSlot | null;
  /** Bowl scale for spoon-family pieces (`1` full, `0.72` teaspoon). */
  readonly bowlScale: number;
}

/** One piece of cutlery, lying flat with its length along local `+Z`. */
function cutleryParts(context: ItemBuildContext, options: CutleryBuildOptions): TablewarePart[] {
  const { cache } = context;
  const key = options.key;
  const metal = slotMaterial(context, options.metalSlot);
  const handle = options.handleSlot ? slotMaterial(context, options.handleSlot) : metal;
  const length = options.length;
  const parts: TablewarePart[] = [];
  parts.push(
    makePart(
      `${key}:handle`,
      boxGeometry(cache, `${key}:handle`, 0.011, 0.005, length * 0.44),
      handle,
      [0, 0.0035, -length * 0.28],
    ),
  );
  if (options.handleSlot) {
    parts.push(
      makePart(
        `${key}:inlay`,
        boxGeometry(cache, `${key}:inlay`, 0.0125, 0.003, length * 0.34),
        metal,
        [0, 0.0054, -length * 0.3],
      ),
    );
  }
  parts.push(
    makePart(
      `${key}:bolster`,
      boxGeometry(cache, `${key}:bolster`, 0.013, 0.0042, 0.016),
      metal,
      [0, 0.0032, -length * 0.05],
    ),
  );
  if (options.kind === 'knife') {
    parts.push(
      makePart(
        `${key}:blade`,
        boxGeometry(cache, `${key}:blade`, 0.015, 0.0022, length * 0.5),
        metal,
        [0, 0.0022, length * 0.2],
      ),
    );
    parts.push(
      makePart(
        `${key}:tip`,
        boxGeometry(cache, `${key}:tip`, 0.009, 0.0018, length * 0.12),
        metal,
        [0, 0.0022, length * 0.45],
      ),
    );
  } else if (options.kind === 'fork') {
    parts.push(
      makePart(
        `${key}:head`,
        boxGeometry(cache, `${key}:head`, 0.016, 0.002, length * 0.2),
        metal,
        [0, 0.0022, length * 0.27],
      ),
    );
    for (let tine = 0; tine < 4; tine += 1) {
      parts.push(
        makePart(
          `${key}:tine-${tine}`,
          boxGeometry(cache, `${key}:tine-${tine}`, 0.0028, 0.0018, length * 0.18),
          metal,
          [(tine - 1.5) * 0.0045, 0.0022, length * 0.4],
        ),
      );
    }
  } else if (options.kind === 'stirrer') {
    parts.push(
      makePart(
        `${key}:paddle`,
        boxGeometry(cache, `${key}:paddle`, 0.01, 0.002, 0.03),
        metal,
        [0, 0.0022, length * 0.42],
      ),
    );
  } else {
    const bowl = 0.014 * options.bowlScale;
    parts.push(
      makePart(
        `${key}:bowl`,
        sphereGeometry(cache, `${key}:bowl`, bowl, 12, 8),
        metal,
        [0, 0.0035, length * 0.32],
      ),
    );
    const bowlGeometry = parts[parts.length - 1];
    if (bowlGeometry) {
      parts[parts.length - 1] = {
        ...bowlGeometry,
        matrix: new THREE.Matrix4()
          .compose(
            new THREE.Vector3(0, 0.0035, length * 0.32),
            new THREE.Quaternion(),
            new THREE.Vector3(1, 0.22, 1.35),
          ),
      };
    }
  }
  return parts;
}

/* -- table service ---------------------------------------------------------- */

/** Sugar bowl: bowl, rim, contents or sachets, optional lid and fitting. */
function sugarBowlParts(context: ItemBuildContext, spec: TablewareSpec): TablewarePart[] {
  const bowl = spec.tableService.sugarBowl;
  const { cache } = context;
  const key = `sugar-bowl:${bowl.style}`;
  const body = slotMaterial(context, bowl.bodySlot);
  const radius = 0.042;
  const parts: TablewarePart[] = [
    makePart(
      `${key}:wall`,
      cylinderGeometry(cache, `${key}:wall`, radius, radius * 0.72, 0.062, 18, true),
      body,
      [0, 0.031, 0],
    ),
    makePart(
      `${key}:floor`,
      discGeometry(cache, `${key}:floor`, radius * 0.68, 18),
      body,
      [0, 0.004, 0],
    ),
    makePart(
      `${key}:rim`,
      torusGeometry(cache, `${key}:rim`, radius, 0.002, 6, 18),
      body,
      [0, 0.062, 0],
    ),
  ];
  if (bowl.style === 'sachets-in-stoneware' || bowl.style === 'branded-sachet-pot') {
    for (let index = 0; index < 3; index += 1) {
      parts.push(
        makePart(
          `${key}:sachet-${index}`,
          boxGeometry(cache, `${key}:sachet-${index}`, 0.026, 0.038, 0.004),
          slotMaterial(context, 'print'),
          [(index - 1) * 0.019, 0.026, -0.006],
          [0.35, index === 1 ? -0.12 : 0.12, 0],
        ),
      );
    }
  } else {
    parts.push(
      makePart(
        `${key}:sugar`,
        discGeometry(cache, `${key}:sugar`, radius * 0.66, 18),
        slotMaterial(context, 'sugar'),
        [0, 0.008 + Math.min(Math.max(bowl.fillFraction, 0), 1) * 0.028, 0],
      ),
    );
  }
  if (bowl.lidSlot) {
    const lid = slotMaterial(context, bowl.lidSlot);
    parts.push(
      makePart(
        `${key}:lid`,
        cylinderGeometry(cache, `${key}:lid`, radius * 1.03, radius * 0.95, 0.012, 18, true),
        lid,
        [0, 0.068, 0],
      ),
    );
    parts.push(
      makePart(`${key}:lid-top`, discGeometry(cache, `${key}:lid-top`, radius * 0.96, 18), lid, [0, 0.074, 0]),
    );
    parts.push(
      makePart(
        `${key}:knob`,
        sphereGeometry(cache, `${key}:knob`, 0.009, 10, 8),
        lid,
        [0, 0.08, 0],
        [0, 0, 0],
      ),
    );
  }
  if (bowl.fittingSlot && (bowl.style === 'loose-in-ceramic' || bowl.style === 'glass-jar-with-tongs')) {
    const fitting = slotMaterial(context, bowl.fittingSlot);
    parts.push(
      makePart(
        `${key}:fitting`,
        boxGeometry(cache, `${key}:fitting`, 0.011, 0.004, 0.07),
        fitting,
        [0, 0.066, 0.004],
        [0, 0.25, 0],
      ),
    );
    parts.push(
      makePart(
        `${key}:fitting-head`,
        sphereGeometry(cache, `${key}:fitting-head`, 0.011, 10, 8),
        fitting,
        [0, 0.069, 0.038],
        [0, 0, 0],
      ),
    );
  }
  return parts;
}

/** Creamer: jug with spout and handle, or a tray of single-serve pots. */
function creamerParts(context: ItemBuildContext, spec: TablewareSpec): TablewarePart[] {
  const creamer = spec.tableService.creamer;
  const { cache } = context;
  const key = `creamer:${creamer.style}`;
  const body = slotMaterial(context, creamer.bodySlot);
  const trim = creamer.trimSlot ? slotMaterial(context, creamer.trimSlot) : body;
  const parts: TablewarePart[] = [];

  if (creamer.style === 'single-serve-pots') {
    parts.push(
      makePart(
        `${key}:tray`,
        boxGeometry(cache, `${key}:tray`, 0.07, 0.008, 0.045),
        trim,
        [0, 0.004, 0],
      ),
    );
    for (let index = 0; index < 2; index += 1) {
      const x = (index - 0.5) * 0.033;
      parts.push(
        makePart(
          `${key}:pot-${index}`,
          cylinderGeometry(cache, `${key}:pot-${index}`, 0.013, 0.011, 0.022, 12),
          body,
          [x, 0.019, 0],
        ),
      );
      parts.push(
        makePart(
          `${key}:foil-${index}`,
          discGeometry(cache, `${key}:foil-${index}`, 0.0125, 12),
          slotMaterial(context, 'chrome'),
          [x, 0.0305, 0],
        ),
      );
    }
    return parts;
  }

  const rBottom = 0.045;
  const rTop = 0.037;
  const height = 0.072;
  parts.push(
    makePart(
      `${key}:wall`,
      cylinderGeometry(cache, `${key}:wall`, rTop, rBottom, height, 18, true),
      body,
      [0, height / 2, 0],
    ),
  );
  parts.push(
    makePart(`${key}:floor`, discGeometry(cache, `${key}:floor`, rBottom * 0.9, 18), body, [0, 0.004, 0]),
  );
  parts.push(
    makePart(`${key}:rim`, torusGeometry(cache, `${key}:rim`, rTop, 0.0016, 6, 18), trim, [0, height, 0]),
  );
  parts.push(
    makePart(
      `${key}:spout`,
      boxGeometry(cache, `${key}:spout`, 0.02, 0.006, 0.012),
      trim,
      [0, height - 0.002, rTop + 0.004],
      [0.25, 0, 0],
    ),
  );
  parts.push(
    makePart(
      `${key}:handle`,
      torusGeometry(cache, `${key}:handle`, 0.014, 0.0042, 8, 16, Math.PI, 'upright'),
      trim,
      [-rBottom * 0.8, height * 0.5, 0],
      [0, 0, Math.PI / 2],
    ),
  );
  if (creamer.capacityMl > 0) {
    parts.push(
      makePart(
        `${key}:milk`,
        discGeometry(cache, `${key}:milk`, rTop * 0.86, 18),
        slotMaterial(context, 'brew'),
        [0, height * 0.72, 0],
      ),
    );
  }
  return parts;
}

/** Condiment caddy: tray, bottles or printed sachets, and stirrers. */
function caddyParts(context: ItemBuildContext, spec: TablewareSpec): TablewarePart[] {
  const caddy = spec.tableService.condimentCaddy;
  const { cache } = context;
  const key = `caddy:${caddy.sachets ? 'sachet' : 'bottle'}`;
  const tray = slotMaterial(context, caddy.traySlot);
  const halfWidth = 0.06;
  const halfDepth = 0.04;
  const parts: TablewarePart[] = [
    makePart(
      `${key}:tray`,
      boxGeometry(cache, `${key}:tray`, halfWidth * 2, 0.012, halfDepth * 2),
      tray,
      [0, 0.006, 0],
    ),
    makePart(
      `${key}:rim-front`,
      boxGeometry(cache, `${key}:rim-front`, halfWidth * 2, 0.01, 0.006),
      tray,
      [0, 0.017, halfDepth - 0.003],
    ),
    makePart(
      `${key}:rim-back`,
      boxGeometry(cache, `${key}:rim-back`, halfWidth * 2, 0.01, 0.006),
      tray,
      [0, 0.017, -halfDepth + 0.003],
    ),
  ];
  if (caddy.sachets) {
    for (let index = 0; index < 3; index += 1) {
      parts.push(
        makePart(
          `${key}:sachet-${index}`,
          boxGeometry(cache, `${key}:sachet-${index}`, 0.028, 0.045, 0.004),
          slotMaterial(context, 'print'),
          [(index - 1) * 0.032, 0.035, -0.004],
          [0.3, index === 1 ? -0.12 : 0.12, 0],
        ),
      );
    }
  } else {
    const bottleMaterial = slotMaterial(context, caddy.bottleSlot);
    const capMaterial = slotMaterial(context, caddy.capSlot);
    const count = Math.max(caddy.bottles, 1);
    for (let index = 0; index < count; index += 1) {
      const x = (index - (count - 1) / 2) * 0.034;
      parts.push(
        makePart(
          `${key}:bottle-${index}`,
          cylinderGeometry(cache, `${key}:bottle-${index}`, 0.012, 0.012, 0.052, 12),
          bottleMaterial,
          [x, 0.038, 0],
        ),
      );
      parts.push(
        makePart(
          `${key}:cap-${index}`,
          cylinderGeometry(cache, `${key}:cap-${index}`, 0.009, 0.009, 0.008, 10),
          capMaterial,
          [x, 0.068, 0],
        ),
      );
    }
  }
  for (let index = 0; index < caddy.stirrers; index += 1) {
    const x = 0.04 + (index % 2) * 0.008;
    const z = -0.016 + Math.floor(index / 2) * 0.012;
    parts.push(
      makePart(
        `${key}:stirrer-${index}`,
        cylinderGeometry(cache, `${key}:stirrer-${index}`, 0.0022, 0.0022, 0.09, 6),
        slotMaterial(context, 'plastic'),
        [x, 0.057, z],
        [0.06 * (index % 2 === 0 ? 1 : -1), 0, 0.05],
      ),
    );
  }
  return parts;
}

/** Napkins: folded linen, a chrome stand, a printed dispenser or a timber stack. */
function napkinParts(context: ItemBuildContext, spec: TablewareSpec): TablewarePart[] {
  const holder = spec.tableService.napkinHolder;
  const { cache } = context;
  const key = `napkin:${holder.style}`;
  const holderMaterial = slotMaterial(context, holder.holderSlot);
  const napkinMaterial = slotMaterial(context, holder.napkinSlot);
  const parts: TablewarePart[] = [];

  switch (holder.style) {
    case 'folded-linen': {
      for (let index = 0; index < 3; index += 1) {
        parts.push(
          makePart(
            `${key}:napkin-${index}`,
            boxGeometry(cache, `${key}:napkin-${index}`, 0.086, 0.01, 0.086),
            napkinMaterial,
            [(index - 1) * 0.003, 0.006 + index * 0.011, (index - 1) * 0.002],
            [0, index * 0.05, 0],
          ),
        );
      }
      parts.push(
        makePart(
          `${key}:ring`,
          torusGeometry(cache, `${key}:ring`, 0.022, 0.004, 6, 14),
          holderMaterial,
          [0, 0.042, 0],
          [Math.PI / 2, 0, 0],
        ),
      );
      break;
    }
    case 'chrome-stand': {
      parts.push(
        makePart(
          `${key}:base`,
          cylinderGeometry(cache, `${key}:base`, 0.042, 0.042, 0.006, 16),
          holderMaterial,
          [0, 0.003, 0],
        ),
      );
      for (const sign of [-1, 1]) {
        parts.push(
          makePart(
            `${key}:post-${sign}`,
            boxGeometry(cache, `${key}:post-${sign}`, 0.005, 0.07, 0.005),
            holderMaterial,
            [sign * 0.038, 0.038, 0],
          ),
        );
      }
      parts.push(
        makePart(
          `${key}:rail`,
          boxGeometry(cache, `${key}:rail`, 0.086, 0.005, 0.005),
          holderMaterial,
          [0, 0.072, 0],
        ),
      );
      parts.push(
        makePart(
          `${key}:napkins`,
          boxGeometry(cache, `${key}:napkins`, 0.072, 0.048, 0.026),
          napkinMaterial,
          [0, 0.03, 0],
        ),
      );
      break;
    }
    case 'printed-dispenser':
    case 'paper-dispenser': {
      parts.push(
        makePart(
          `${key}:body`,
          boxGeometry(cache, `${key}:body`, 0.084, 0.072, 0.046),
          holderMaterial,
          [0, 0.036, 0],
        ),
      );
      parts.push(
        makePart(
          `${key}:face`,
          boxGeometry(cache, `${key}:face`, 0.07, 0.05, 0.002),
          slotMaterial(context, holder.mark ? 'print' : 'napkin'),
          [0, 0.038, -0.024],
        ),
      );
      parts.push(
        makePart(
          `${key}:fold`,
          boxGeometry(cache, `${key}:fold`, 0.042, 0.03, 0.01),
          napkinMaterial,
          [0, 0.022, -0.03],
          [0.35, 0, 0],
        ),
      );
      break;
    }
    case 'timber-stack': {
      parts.push(
        makePart(`${key}:base`, boxGeometry(cache, `${key}:base`, 0.084, 0.008, 0.07), holderMaterial, [0, 0.004, 0]),
      );
      for (const sign of [-1, 1]) {
        parts.push(
          makePart(
            `${key}:slat-${sign}`,
            boxGeometry(cache, `${key}:slat-${sign}`, 0.006, 0.05, 0.07),
            holderMaterial,
            [sign * 0.038, 0.03, 0],
          ),
        );
      }
      for (let index = 0; index < 3; index += 1) {
        parts.push(
          makePart(
            `${key}:napkin-${index}`,
            boxGeometry(cache, `${key}:napkin-${index}`, 0.07, 0.012, 0.066),
            napkinMaterial,
            [0, 0.014 + index * 0.013, 0],
          ),
        );
      }
      break;
    }
  }
  return parts;
}

/** Ashtray: bowl, well and the rests a cigarette was tapped on. */
function ashtrayParts(context: ItemBuildContext, spec: TablewareSpec): TablewarePart[] {
  const ashtray = spec.tableService.ashtray;
  if (!ashtray) return [];
  const { cache } = context;
  const key = `ashtray:${ashtray.style}`;
  const material = slotMaterial(context, ashtray.slot);
  const radius = ashtray.diameter / 2;
  const height = 0.03;
  const parts: TablewarePart[] = [
    makePart(
      `${key}:wall`,
      cylinderGeometry(cache, `${key}:wall`, radius, radius * 0.94, height, 20, true),
      material,
      [0, height / 2, 0],
    ),
    makePart(`${key}:floor`, discGeometry(cache, `${key}:floor`, radius * 0.92, 20), material, [0, 0.004, 0]),
    makePart(
      `${key}:well`,
      torusGeometry(cache, `${key}:well`, radius * 0.42, 0.005, 6, 16),
      material,
      [0, 0.013, 0],
    ),
  ];
  const notches = Math.max(ashtray.notches, 1);
  for (let index = 0; index < notches; index += 1) {
    const angle = (index / notches) * Math.PI * 2;
    parts.push(
      makePart(
        `${key}:notch-${index}`,
        boxGeometry(cache, `${key}:notch-${index}`, 0.014, 0.007, 0.008),
        material,
        [Math.cos(angle) * (radius - 0.004), height - 0.002, Math.sin(angle) * (radius - 0.004)],
        [0, -angle, 0],
      ),
    );
  }
  return parts;
}

/** Tray: base slab with a raised rim on all four sides. */
function trayParts(context: ItemBuildContext, tray: TraySpec): TablewarePart[] {
  const { cache } = context;
  const key = `tray:${tray.style}`;
  const material = slotMaterial(context, tray.slot);
  const rimMaterial = slotMaterial(context, tray.rimSlot);
  const halfWidth = tray.width / 2;
  const halfDepth = tray.depth / 2;
  const base = 0.008;
  const rim = Math.max(tray.rimHeight, 0.004);
  return [
    makePart(`${key}:base`, boxGeometry(cache, `${key}:base`, tray.width, base, tray.depth), material, [0, base / 2, 0]),
    makePart(
      `${key}:rim-left`,
      boxGeometry(cache, `${key}:rim-left`, 0.008, rim, tray.depth),
      rimMaterial,
      [-halfWidth + 0.004, base + rim / 2, 0],
    ),
    makePart(
      `${key}:rim-right`,
      boxGeometry(cache, `${key}:rim-right`, 0.008, rim, tray.depth),
      rimMaterial,
      [halfWidth - 0.004, base + rim / 2, 0],
    ),
    makePart(
      `${key}:rim-front`,
      boxGeometry(cache, `${key}:rim-front`, tray.width, rim, 0.008),
      rimMaterial,
      [0, base + rim / 2, halfDepth - 0.004],
    ),
    makePart(
      `${key}:rim-back`,
      boxGeometry(cache, `${key}:rim-back`, tray.width, rim, 0.008),
      rimMaterial,
      [0, base + rim / 2, -halfDepth + 0.004],
    ),
  ];
}

/* -- counter-pass stacks ---------------------------------------------------- */

/** Stacks, rows, racks, caddies and bundles on the counter pass. */
function stackParts(context: ItemBuildContext, stack: PassStackSpec): TablewarePart[] {
  const { cache, spec } = context;
  const key = stack.kind;
  const pieces = Math.min(Math.max(stack.pieces, 1), 12);
  const cup = spec.vessels.cup;
  const espresso = spec.vessels.espresso;
  const tumbler = spec.vessels.tumbler;
  const takeaway = spec.vessels.takeaway;

  switch (stack.kind) {
    case 'saucer-stack': {
      const radius = cup.rest === 'coaster' ? COASTER_RADIUS : saucerRadiusFor(cup);
      const piece = restParts(context, {
        key: `${key}:piece`,
        slot: cup.rest === 'coaster' ? 'print' : cup.bodySlot,
        radius,
        thickness: cup.rest === 'coaster' ? TABLEWARE_SETTING.coasterThickness : TABLEWARE_SETTING.saucerThickness,
        printed: cup.rest === 'coaster',
      });
      return repeatParts(piece, key, pieces, TABLEWARE_SETTING.saucerThickness + 0.004);
    }
    case 'cup-stack': {
      const piece = vesselParts(context, cup);
      return repeatParts(piece, key, pieces, cup.height * 0.42);
    }
    case 'demitasse-stack': {
      const vessel = espresso ?? cup;
      return repeatParts(vesselParts(context, vessel), key, pieces, vessel.height * 0.4);
    }
    case 'mug-stack': {
      const piece = vesselParts(context, cup);
      return repeatParts(piece, key, pieces, cup.height * 0.34);
    }
    case 'tumbler-row': {
      const vessel = tumbler ?? cup;
      const spacing = Math.min(Math.max(vessel.rimDiameter * 0.72, 0.048), 0.058);
      return repeatParts(vesselParts(context, vessel), key, pieces, 0, spacing, 0, true);
    }
    case 'paper-cup-stack':
    case 'corrugated-cup-stack': {
      const vessel =
        (stack.kind === 'paper-cup-stack'
          ? spec.vessels.cup.kind === 'paper-cup'
            ? spec.vessels.cup
            : takeaway
          : spec.vessels.cup.kind === 'corrugated-cup'
            ? spec.vessels.cup
            : takeaway) ?? cup;
      return repeatParts(vesselParts(context, vessel), key, pieces, vessel.height * 0.16);
    }
    case 'lid-stack': {
      const vessel = takeaway ?? cup;
      const lidRadius = vessel.rimDiameter / 2 + 0.003;
      const piece = [
        makePart(
          `${key}:piece:disc`,
          discGeometry(cache, `${key}:piece:disc`, lidRadius - 0.002, 20),
          slotMaterial(context, 'plastic'),
          [0, 0.003, 0],
        ),
        makePart(
          `${key}:piece:rim`,
          torusGeometry(cache, `${key}:piece:rim`, lidRadius - 0.001, 0.0018, 5, 20),
          slotMaterial(context, 'plastic'),
          [0, 0.003, 0],
        ),
      ];
      return repeatParts(piece, key, pieces, 0.009);
    }
    case 'sleeve-stack': {
      const vessel = takeaway ?? cup;
      const lowRadius = vessel.baseDiameter / 2 + 0.006;
      const piece = [
        makePart(
          `${key}:piece:band`,
          cylinderGeometry(cache, `${key}:piece:band`, lowRadius + 0.004, lowRadius, 0.032, 16, true),
          slotMaterial(context, 'sleeve'),
          [0, 0.016, 0],
        ),
        makePart(
          `${key}:piece:edge`,
          torusGeometry(cache, `${key}:piece:edge`, lowRadius + 0.003, 0.0015, 5, 16),
          slotMaterial(context, 'sleeve'),
          [0, 0.032, 0],
        ),
      ];
      return repeatParts(piece, key, pieces, 0.011);
    }
    case 'stirrer-cup': {
      const holder = [
        makePart(
          `${key}:holder`,
          cylinderGeometry(cache, `${key}:holder`, 0.045, 0.04, 0.075, 16, true),
          slotMaterial(context, 'accent'),
          [0, 0.0375, 0],
        ),
        makePart(
          `${key}:holder-floor`,
          discGeometry(cache, `${key}:holder-floor`, 0.038, 16),
          slotMaterial(context, 'accent'),
          [0, 0.004, 0],
        ),
      ];
      const stirrer = [
        makePart(
          `${key}:piece:stick`,
          cylinderGeometry(cache, `${key}:piece:stick`, 0.0022, 0.0022, 0.11, 6),
          slotMaterial(context, 'plastic'),
          [0, 0.09, 0],
        ),        makePart(
          `${key}:piece:paddle`,
          boxGeometry(cache, `${key}:piece:paddle`, 0.009, 0.002, 0.026),
          slotMaterial(context, 'plastic'),
          [0, 0.147, 0],
        ),
      ];
      return [...holder, ...repeatParts(stirrer, key, pieces, 0, 0.006, 0.005)];
    }
    case 'reusable-cup-stack': {
      const vessel = spec.vessels.cup.kind === 'reusable-cup' ? spec.vessels.cup : takeaway ?? cup;
      return repeatParts(vesselParts(context, vessel), key, pieces, vessel.height * 0.26);
    }
    case 'glass-rack': {
      const vessel = tumbler ?? cup;
      const halfWidth = 0.145;
      const rack = [
        makePart(
          `${key}:rack-base`,
          boxGeometry(cache, `${key}:rack-base`, halfWidth * 2, 0.012, 0.1),
          slotMaterial(context, 'wood'),
          [0, 0.006, 0],
        ),
        makePart(
          `${key}:rack-rail-front`,
          boxGeometry(cache, `${key}:rack-rail-front`, halfWidth * 2, 0.008, 0.008),
          slotMaterial(context, 'wood'),
          [0, 0.078, 0.042],
        ),
        makePart(
          `${key}:rack-rail-back`,
          boxGeometry(cache, `${key}:rack-rail-back`, halfWidth * 2, 0.008, 0.008),
          slotMaterial(context, 'wood'),
          [0, 0.078, -0.042],
        ),
      ];
      return [...rack, ...repeatParts(vesselParts(context, vessel), key, pieces, 0, 0.068, 0, true)];
    }
    case 'tray-stack': {
      const tray = spec.tableService.tray;
      const piece = tray
        ? trayParts(context, tray)
        : [
            makePart(
              `${key}:piece:slab`,
              boxGeometry(cache, `${key}:piece:slab`, 0.2, 0.008, 0.14),
              slotMaterial(context, 'accent'),
              [0, 0.004, 0],
            ),
          ];
      const trayHeight = tray ? 0.008 + Math.max(tray.rimHeight, 0.004) : 0.008;
      return repeatParts(piece, key, pieces, trayHeight * 0.85);
    }
    case 'cutlery-caddy': {
      const caddyMaterial = slotMaterial(context, 'accent');
      const caddy = [
        makePart(
          `${key}:base`,
          boxGeometry(cache, `${key}:base`, 0.12, 0.008, 0.09),
          caddyMaterial,
          [0, 0.004, 0],
        ),
        makePart(
          `${key}:wall-left`,
          boxGeometry(cache, `${key}:wall-left`, 0.008, 0.11, 0.09),
          caddyMaterial,
          [-0.056, 0.059, 0],
        ),
        makePart(
          `${key}:wall-right`,
          boxGeometry(cache, `${key}:wall-right`, 0.008, 0.11, 0.09),
          caddyMaterial,
          [0.056, 0.059, 0],
        ),
        makePart(
          `${key}:wall-front`,
          boxGeometry(cache, `${key}:wall-front`, 0.112, 0.11, 0.008),
          caddyMaterial,
          [0, 0.059, 0.041],
        ),
        makePart(
          `${key}:wall-back`,
          boxGeometry(cache, `${key}:wall-back`, 0.112, 0.11, 0.008),
          caddyMaterial,
          [0, 0.059, -0.041],
        ),
      ];
      const piece = cutleryParts(context, {
        key: `${key}:piece`,
        kind: 'teaspoon',
        length: 0.15,
        metalSlot: spec.tableService.teaspoon.metalSlot,
        handleSlot: spec.tableService.teaspoon.handleSlot,
        bowlScale: 0.75,
      });
      const standing = piece.map((part) => ({
        ...part,
        matrix: new THREE.Matrix4()
          .makeTranslation(-0.035, 0.071, 0)
          .multiply(new THREE.Matrix4().makeRotationZ(0.1))
          .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
          .multiply(part.matrix),
      }));
      return [...caddy, ...repeatParts(standing, key, pieces, 0.002, 0.011, 0.004)];
    }
    case 'napkin-stack': {
      const piece = [
        makePart(
          `${key}:piece:fold`,
          boxGeometry(cache, `${key}:piece:fold`, 0.086, 0.01, 0.088),
          slotMaterial(context, spec.tableService.napkinHolder.napkinSlot),
          [0, 0.005, 0],
        ),
      ];
      return repeatParts(piece, key, pieces, 0.013, 0.002, 0.002);
    }
    default:
      return [];
  }
}

/** Maps a placement to the vessel spec it should be built from. */
function vesselForKind(spec: TablewareSpec, kind: TablewareItemKind): VesselSpec | null {
  const vessels: readonly (VesselSpec | null)[] = [
    spec.vessels.cup,
    spec.vessels.espresso,
    spec.vessels.tumbler,
    spec.vessels.takeaway,
  ];
  return vessels.find((vessel) => vessel !== null && vessel.kind === kind) ?? null;
}

/** Maps a rest placement's variant back to the vessel that stands on it. */
function vesselForRestVariant(spec: TablewareSpec, variant: string): VesselSpec {
  const vessels: readonly (VesselSpec | null)[] = [
    spec.vessels.cup,
    spec.vessels.espresso,
    spec.vessels.tumbler,
    spec.vessels.takeaway,
  ];
  return vessels.find((vessel) => vessel !== null && variant.startsWith(vessel.kind)) ?? spec.vessels.cup;
}

/** Cutlery build options for one era piece. */
function cutleryOptionsFor(kind: CutleryPieceKind, spec: TablewareSpec): CutleryBuildOptions {
  const piece = spec.tableService.cutlery.find((candidate) => candidate.kind === kind);
  if (piece) {
    return {
      key: `${kind}:${piece.metalSlot}${piece.handleSlot ? `+${piece.handleSlot}` : ''}`,
      kind,
      length: piece.length,
      metalSlot: piece.metalSlot,
      handleSlot: piece.handleSlot,
      bowlScale: kind === 'spoon' ? 1 : 0.8,
    };
  }
  return {
    key: `${kind}:teaspoon`,
    kind,
    length: spec.tableService.teaspoon.length,
    metalSlot: spec.tableService.teaspoon.metalSlot,
    handleSlot: spec.tableService.teaspoon.handleSlot,
    bowlScale: 0.72,
  };
}

/** Builds the prototype parts for one placement, dispatch on its kind. */
function buildPrototype(entry: TablewarePlacement, context: ItemBuildContext): readonly TablewarePart[] {
  const spec = context.spec;
  switch (entry.kind) {
    case 'cup':
      return vesselParts(context, spec.vessels.cup);
    case 'demitasse-cup':
      return vesselParts(context, spec.vessels.espresso ?? spec.vessels.cup);
    case 'glass-tumbler':
    case 'double-walled-glass':
    case 'reusable-cup':
    case 'lidded-cup':
    case 'paper-cup':
    case 'corrugated-cup':
      return vesselParts(context, vesselForKind(spec, entry.kind) ?? spec.vessels.cup);
    case 'saucer':
    case 'demitasse-saucer': {
      const vessel = vesselForRestVariant(spec, entry.variant);
      return restParts(context, {
        key: `rest:${entry.variant}`,
        slot: vessel.bodySlot,
        radius: saucerRadiusFor(vessel),
        thickness:
          vessel.kind === 'demitasse-cup'
            ? TABLEWARE_SETTING.demitasseSaucerThickness
            : TABLEWARE_SETTING.saucerThickness,
        printed: false,
      });
    }
    case 'coaster':
      return restParts(context, {
        key: 'rest:coaster',
        slot: 'print',
        radius: COASTER_RADIUS,
        thickness: TABLEWARE_SETTING.coasterThickness,
        printed: true,
      });
    case 'teaspoon':
      return cutleryParts(context, {
        key: `teaspoon:${spec.tableService.teaspoon.metalSlot}`,
        kind: 'teaspoon',
        length: spec.tableService.teaspoon.length,
        metalSlot: spec.tableService.teaspoon.metalSlot,
        handleSlot: spec.tableService.teaspoon.handleSlot,
        bowlScale: 0.72,
      });
    case 'knife':
    case 'fork':
    case 'spoon':
      return cutleryParts(context, cutleryOptionsFor(entry.kind, spec));
    case 'stirrer':
      return cutleryParts(context, {
        key: 'stirrer:plastic',
        kind: 'stirrer',
        length: 0.14,
        metalSlot: 'plastic',
        handleSlot: null,
        bowlScale: 1,
      });
    case 'sugar-bowl':
      return sugarBowlParts(context, spec);
    case 'creamer':
      return creamerParts(context, spec);
    case 'condiment-caddy':
      return caddyParts(context, spec);
    case 'napkin-holder':
      return napkinParts(context, spec);
    case 'ashtray':
      return ashtrayParts(context, spec);
    default: {
      const stack = spec.counterPass.stacks.find((candidate) => candidate.kind === entry.kind);
      return stack ? stackParts(context, stack) : [];
    }
  }
}

/** Radius, local half extents and height of a prototype, off its real geometry. */
function measurePrototype(parts: readonly TablewarePart[]): {
  radius: number;
  halfWidth: number;
  halfLength: number;
  height: number;
} {
  const box = new THREE.Box3();
  const corner = new THREE.Vector3();
  for (const part of parts) {
    if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
    const bounds = part.geometry.boundingBox;
    if (!bounds) continue;
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          corner.set(x, y, z).applyMatrix4(part.matrix);
          box.expandByPoint(corner);
        }
      }
    }
  }
  let radius = 0;
  for (const x of [box.min.x, box.max.x]) {
    for (const z of [box.min.z, box.max.z]) {
      radius = Math.max(radius, Math.hypot(x, z));
    }
  }
  return {
    radius,
    halfWidth: Math.max(Math.abs(box.min.x), Math.abs(box.max.x)),
    halfLength: Math.max(Math.abs(box.min.z), Math.abs(box.max.z)),
    height: Math.max(box.max.y, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Module                                                                     */
/* -------------------------------------------------------------------------- */

interface PrototypeRecord {
  readonly parts: readonly TablewarePart[];
  readonly placements: { readonly matrix: THREE.Matrix4; readonly tint: THREE.Color }[];
}

/**
 * The café's tableware: cups, saucers, glasses, cutlery, condiment sets, trays,
 * napkin holders and packaging, rebuilt for each of the five eras.
 */
export class TablewareModule implements SceneModule<TablewareSpec> {
  readonly id = TABLEWARE_MODULE_ID;

  /** Interior volume every piece is placed inside. */
  readonly bounds: RoomBounds;

  /** Table slot grid, counter pass and the rest of the anchor set. */
  readonly layout: StructuralLayout;

  private readonly options: TablewareModuleOptions;
  private group: THREE.Group | null = null;
  private tablesGroup: THREE.Group | null = null;
  private passGroup: THREE.Group | null = null;
  private materials: TablewareMaterialSet | null = null;
  private currentSpec: TablewareSpec | null = null;
  private cache: GeometryCache = { geometries: new Map() };
  private builtPlan: TablewarePlan | null = null;
  private footprints: Record<string, TablewareItemFootprint> = {};
  private meshes = 0;
  private instances = 0;
  private glassMaterials: THREE.MeshStandardMaterial[] = [];
  private glassRoughness: number[] = [];
  private phase = 0;
  private updates = 0;

  constructor(options: TablewareModuleOptions = {}) {
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

  /** The single `tableware` group, once built. */
  get root(): THREE.Object3D | undefined {
    return this.group ?? undefined;
  }

  /** Era data currently applied. */
  get spec(): TablewareSpec | undefined {
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
    // Tableware *is* the period: a 1945 heavy china cup is not a 2025 reusable
    // lidded cup, so the era swap raises the new service and releases the
    // previous group first. Exactly one era's tableware is ever attached, which
    // is what makes the timeline read as a replacement rather than a pile-up.
    this.dispose();
    this.raise(period.year, context);
  }

  update(deltaSeconds: number, _context: UpdateContext): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(deltaSeconds, 0) : 0;
    this.phase = (this.phase + delta) % (Math.PI * 2);
    this.updates += 1;

    // The glassware catches the light as the viewer moves: a whisper of
    // roughness, not motion, so the table still reads as a set table.
    for (let index = 0; index < this.glassMaterials.length; index += 1) {
      const material = this.glassMaterials[index];
      const base = this.glassRoughness[index];
      if (!material || base === undefined) continue;
      material.roughness = Math.min(Math.max(base + Math.sin(this.phase * 0.6 + index) * 0.015, 0), 1);
    }
  }

  dispose(): void {
    if (this.group) {
      disposeObject3D(this.group);
      this.group = null;
    }
    this.tablesGroup = null;
    this.passGroup = null;
    for (const geometry of this.cache.geometries.values()) geometry.dispose();
    this.cache = { geometries: new Map() };
    if (this.materials) {
      disposeTablewareMaterialSet(this.materials);
      this.materials = null;
    }
    this.currentSpec = null;
    this.builtPlan = null;
    this.footprints = {};
    this.meshes = 0;
    this.instances = 0;
    this.glassMaterials = [];
    this.glassRoughness = [];
    this.phase = 0;
  }

  getHotspots(): readonly Hotspot[] {
    const spec = this.currentSpec ?? tablewareSpec(this.options.initialYear ?? DEFAULT_YEAR_ID);
    const plan = this.builtPlan ?? this.eraPlan(spec.year);
    const slots = this.layout.tableSlots;
    const firstTable = plan.tableSettings[0];
    const firstPass = plan.counterPass[0];
    const fallbackTable = slots[0];
    const era = `${spec.year} ${spec.name}`;
    const service = spec.tableService;
    const vessel = spec.vessels.cup;
    const tablePosition = firstTable
      ? firstTable.position.clone()
      : new THREE.Vector3(
          fallbackTable ? fallbackTable.position.x : 0,
          fallbackTable ? fallbackTable.surfaceHeight : 0.74,
          fallbackTable ? fallbackTable.position.z : 0,
        );
    const passPosition = firstPass
      ? firstPass.position.clone()
      : new THREE.Vector3(0, this.layout.counter.surfaceHeight, this.layout.counter.center.z);

    const hotspots: Hotspot[] = [
      {
        id: 'tableware:table-service',
        label: `Table service — ${vessel.label}`,
        description: `${era}. ${vessel.note} ${service.placement}`,
        position: new THREE.Vector3(tablePosition.x, tablePosition.y + 0.12, tablePosition.z),
        radius: 0.42,
        year: spec.year,
        moduleId: this.id,
        kind: 'interactive',
        anchor: this.tablesGroup ?? undefined,
      },
      {
        id: 'tableware:counter-pass',
        label: `Counter pass — ${spec.vessels.serveMl} ml service`,
        description: `${era}. ${spec.counterPass.arrangement}`,
        position: new THREE.Vector3(passPosition.x, passPosition.y + 0.09, passPosition.z),
        radius: 0.4,
        year: spec.year,
        moduleId: this.id,
        kind: 'info',
        anchor: this.passGroup ?? undefined,
      },
      {
        id: 'tableware:condiments',
        label: `Condiment caddy — ${service.condimentCaddy.label}`,
        description: `${era}. ${service.condimentCaddy.note} ${service.sugarBowl.note} ${service.creamer.note}`,
        position: new THREE.Vector3(tablePosition.x, tablePosition.y + 0.16, tablePosition.z),
        radius: 0.34,
        year: spec.year,
        moduleId: this.id,
        kind: 'info',
      },
    ];
    if (service.ashtray) {
      hotspots.push({
        id: 'tableware:ashtrays',
        label: `Ashtrays — ${service.ashtray.label}`,
        description: `${era}. ${service.ashtray.note}`,
        position: new THREE.Vector3(tablePosition.x, tablePosition.y + 0.08, tablePosition.z),
        radius: 0.34,
        year: spec.year,
        moduleId: this.id,
        kind: 'info',
      });
    }
    if (spec.vessels.takeaway) {
      hotspots.push({
        id: 'tableware:packaging',
        label: `Takeaway — ${spec.vessels.takeaway.label}`,
        description: `${era}. ${spec.vessels.takeaway.note}`,
        position: new THREE.Vector3(passPosition.x, passPosition.y + 0.14, passPosition.z),
        radius: 0.36,
        year: spec.year,
        moduleId: this.id,
        kind: 'interactive',
        anchor: this.passGroup ?? undefined,
      });
    }
    return hotspots;
  }

  /* -- Diagnostics and consumer accessors ---------------------------------- */

  /** True once the era's service has been raised. */
  get built(): boolean {
    return this.group !== null;
  }

  /** The era's material set (every material is named `tableware:<year>:<slot>`). */
  get materialSet(): TablewareMaterialSet | undefined {
    return this.materials ?? undefined;
  }

  /** Identifier of the active material set. */
  get materialSetId(): string | undefined {
    return this.materials?.id;
  }

  /** Name of the active era palette. */
  get paletteName(): string | undefined {
    return this.currentSpec?.paletteName;
  }

  /** Where the era's surfaces came from. */
  get textureSource(): TablewareMaterialSet['textureSource'] | 'none' {
    return this.materials?.textureSource ?? 'none';
  }

  /** Fingerprint of the era's material set. */
  get materialSignature(): string | null {
    return this.materials ? tablewareMaterialSetSignature(this.materials) : null;
  }

  /** The plan currently built (or `undefined` before the first build). */
  get plan(): TablewarePlan | undefined {
    return this.builtPlan ?? undefined;
  }

  /** Every placed piece, in plan order. */
  get placements(): readonly TablewarePlacement[] {
    return this.builtPlan?.entries ?? [];
  }

  /** Measured footprint of every built prototype, keyed `kind:variant`. */
  get itemFootprints(): Readonly<Record<string, TablewareItemFootprint>> {
    return this.footprints;
  }

  /** Number of scene-graph nodes under the tableware group. */
  get nodeCount(): number {
    if (!this.group) return 0;
    let count = 0;
    this.group.traverse(() => {
      count += 1;
    });
    return count;
  }

  /** Number of instanced meshes in the era's service. */
  get meshCount(): number {
    return this.meshes;
  }

  /** Number of instanced pieces in the era's service. */
  get instanceCount(): number {
    return this.instances;
  }

  /** Number of times {@link SceneModule.update} has run. */
  get updateCount(): number {
    return this.updates;
  }

  /** The plan for `year`, derived without building anything. */
  eraPlan(year: YearId): TablewarePlan {
    return planTableware({
      year,
      spec: tablewareSpec(year),
      layout: this.layout,
      bounds: this.bounds,
    });
  }

  /** Coarse clearance answers for the active plan (`[]` when the service is sound). */
  placementProblems(): readonly string[] {
    const spec = this.currentSpec;
    const plan = this.builtPlan ?? this.eraPlan(spec ? spec.year : this.options.initialYear ?? DEFAULT_YEAR_ID);
    return tablewarePlacementProblems(plan, this.layout, this.bounds);
  }

  /** Everything diagnostics (and the tests) need in one snapshot. */
  describe(): TablewareModuleDescription {
    const spec = this.currentSpec ?? tablewareSpec(this.options.initialYear ?? DEFAULT_YEAR_ID);
    return Object.freeze({
      moduleId: this.id,
      year: spec.year,
      built: this.built,
      paletteName: this.currentSpec?.paletteName ?? null,
      materialSetId: this.materials?.id ?? null,
      textureSource: this.textureSource,
      textureCount: this.materials?.textures.length ?? 0,
      materialCount: this.materials ? Object.keys(this.materials.slots).length : 0,
      nodeCount: this.nodeCount,
      meshCount: this.meshes,
      instanceCount: this.instances,
      placementCount: this.placements.length,
      placementCounts: this.placementCounts(),
      variantCount: this.variantCount(),
      placementProblems: this.placementProblems(),
      summary: describeTablewareSpec(spec),
    });
  }

  /* -- Internals ------------------------------------------------------------ */

  private createRandom(year: YearId): () => number {
    const seed = this.options.seed ?? DEFAULT_TABLEWARE_SEED;
    return createSeededRandom(seed ^ hashString(`tableware:${year}`));
  }

  private placementCounts(): Readonly<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const entry of this.placements) {
      counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    }
    return counts;
  }

  private variantCount(): number {
    return new Set(this.placements.map((entry) => `${entry.kind}:${entry.variant}`)).size;
  }

  private raise(year: YearId, context: BuildContext): void {
    const spec = tablewareSpec(year);
    const materials = createTablewareMaterialSet(spec, {
      canvasFactory: this.options.canvasFactory,
      textureSize: this.options.textureSize,
    });
    const cache: GeometryCache = { geometries: new Map() };
    const group = new THREE.Group();
    group.name = TABLEWARE_GROUP_NAME;
    const tables = new THREE.Group();
    tables.name = TABLEWARE_ZONE_GROUP_NAMES.tables;
    const counterPass = new THREE.Group();
    counterPass.name = TABLEWARE_ZONE_GROUP_NAMES.counterPass;
    const buildContext: ItemBuildContext = { spec, materials, cache };
    const random = this.createRandom(year);

    try {
      const plan = planTableware({ year, spec, layout: this.layout, bounds: this.bounds });
      const prototypes = new Map<string, PrototypeRecord>();
      const axis = new THREE.Vector3(0, 1, 0);

      for (const entry of plan.entries) {
        const key = `${entry.kind}:${entry.variant}`;
        let record = prototypes.get(key);
        if (!record) {
          record = { parts: buildPrototype(entry, buildContext), placements: [] };
          prototypes.set(key, record);
        }
        record.placements.push({
          matrix: new THREE.Matrix4().compose(
            entry.position,
            new THREE.Quaternion().setFromAxisAngle(axis, entry.rotationY),
            new THREE.Vector3(1, 1, 1),
          ),
          // A whisper of per-piece variation, seeded per era so it reproduces.
          tint: new THREE.Color().setScalar(0.955 + random() * 0.045),
        });
      }

      const footprints: Record<string, TablewareItemFootprint> = {};
      let meshes = 0;
      let instances = 0;
      const glassMaterials: THREE.MeshStandardMaterial[] = [];
      const glassRoughness: number[] = [];

      for (const [key, record] of prototypes) {
        const measured = measurePrototype(record.parts);
        footprints[key] = Object.freeze({
          radius: measured.radius,
          halfWidth: measured.halfWidth,
          halfLength: measured.halfLength,
          height: measured.height,
          parts: record.parts.length,
          instances: record.placements.length,
        });
        const zoneGroup = isPassStackKind(entryKindOf(key)) ? counterPass : tables;
        record.parts.forEach((part, partIndex) => {
          const mesh = new THREE.InstancedMesh(part.geometry, part.material, record.placements.length);
          mesh.name = `${TABLEWARE_GROUP_NAME}:${key}:${partIndex}`;
          const matrix = new THREE.Matrix4();
          record.placements.forEach((placement, index) => {
            matrix.multiplyMatrices(placement.matrix, part.matrix);
            mesh.setMatrixAt(index, matrix);
            mesh.setColorAt(index, placement.tint);
          });
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.computeBoundingSphere();
          zoneGroup.add(mesh);
          meshes += 1;
          instances += record.placements.length;
          if (part.material instanceof THREE.MeshStandardMaterial && part.material.transparent) {
            if (!glassMaterials.includes(part.material)) {
              glassMaterials.push(part.material);
              glassRoughness.push(part.material.roughness);
            }
          }
        });
      }

      group.add(tables);
      group.add(counterPass);
      context.root.add(group);

      this.group = group;
      this.tablesGroup = tables;
      this.passGroup = counterPass;
      this.materials = materials;
      this.currentSpec = spec;
      this.cache = cache;
      this.builtPlan = plan;
      this.footprints = footprints;
      this.meshes = meshes;
      this.instances = instances;
      this.glassMaterials = glassMaterials;
      this.glassRoughness = glassRoughness;
      this.phase = 0;
    } catch (error) {
      // Never leave a half-set table behind: release what was built and let the
      // error reach the composition layer.
      disposeObject3D(group);
      for (const geometry of cache.geometries.values()) geometry.dispose();
      disposeTablewareMaterialSet(materials);
      throw error;
    }
  }
}

/** True when a `kind:variant` prototype key is a counter-pass stack. */
function isPassStackKind(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(PASS_STACK_METRICS, kind);
}

/** Kind half of a `kind:variant` prototype key. */
function entryKindOf(key: string): string {
  const separator = key.indexOf(':');
  return separator === -1 ? key : key.slice(0, separator);
}

/** Convenience factory mirroring `createKernel` / `createEnvironmentModule`. */
export function createTablewareModule(options: TablewareModuleOptions = {}): TablewareModule {
  return new TablewareModule(options);
}

/* -------------------------------------------------------------------------- */
/* Re-exports: the module file also exposes the era spec map and the surface   */
/* pipeline, so the period registry and the tests can import from one place.   */
/* -------------------------------------------------------------------------- */

export {
  TABLEWARE_MATERIAL_SLOTS,
  TABLEWARE_TEXTURE_PREFIX,
  DEFAULT_TABLEWARE_TEXTURE_SIZE,
  Raster,
  createTablewareMaterialSet,
  createTablewareTexture,
  defaultCanvasFactory,
  disposeTablewareMaterialSet,
  distinctPixelColors,
  isTablewareMaterialSlot,
  isTablewareTexture,
  paintTablewareSurface,
  tablewareMaterial,
  tablewareMaterialName,
  tablewareMaterialSetMaterials,
  tablewareMaterialSetSignature,
  tablewareRecipe,
} from './tablewareTextures';
export type {
  CanvasFactory,
  TablewareMaterialRecipe,
  TablewareMaterialSet,
  TablewareMaterialSetOptions,
  TablewareMaterialSlot,
  TablewareMaterialSource,
  TablewareRecipeOptions,
  TablewareTexture,
  TablewareTextureKind,
  TablewareTextureOptions,
  TablewareTexturePalette,
  TablewareTextureStyle,
} from './tablewareTextures';

