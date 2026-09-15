/**
 * Furniture scene module — the era-varying furniture and soft decor of the café.
 *
 * One module owns every prop the customer sits on, eats from, hangs a coat on or
 * looks at, exactly the way the frozen {@link SceneModule} contract expects:
 *
 *  - `build(context)` raises `tables`, `seating`, `counter-front`, `fixtures` and
 *    `soft-decor` groups inside a single `furniture` node, dressed in the era's
 *    material set and placed with the era's rules.
 *  - `applyPeriod(period, context)` rebuilds the props for the new era. Unlike
 *    the room shell, furniture geometry *is* period specific (a 1945 bentwood
 *    chair is not a 2025 moulded shell), so the previous group is released before
 *    the next is raised: no object of the old era survives the swap.
 *  - `update(delta, context)` ticks the wall clock's hands and breathes a little
 *    life into the foliage.
 *  - `dispose()` releases every geometry, material and texture the module
 *    created and detaches its group, returning the kernel's node count to its
 *    pre-build baseline.
 *  - `getHotspots()` exposes the era's furniture landmarks (counter frontage,
 *    booth seating, banquette, coat stand, hat rack, magazine rack, wall clock,
 *    payphone, rugs, window dressing, plants, the table setting and — where the
 *    era has them — the lounge and the standing rail), each with the era's own
 *    note and a focus point, without touching the core hotspot registry.
 *
 * Placement is *planned* before it is built: {@link planFurniture} returns the
 * complete, geometry-free list of props (`PropPlanEntry`) derived from the
 * environment's {@link RoomBounds}, its structural layout and the era spec. The
 * plan drives the builders, the placement rules assertion, the diagnostics and
 * the hotspot anchors, so what the tests check is what the scene contains.
 *
 * Determinism: prop placement uses a per-era seeded source (module seed hashed
 * with the {@link YearId}), not the context's shared source, so re-applying an
 * era always reproduces the same layout.
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
  type RoomPoint,
  type SceneModule,
  type UpdateContext,
  type YearId,
} from '../../contracts/period';
import { createSeededRandom, disposeObject3D } from '../../core/kernel';
import {
  CAFE_ROOM_BOUNDS,
  STRUCTURAL_LAYOUT,
  serviceLaneRect,
  validateLayout,
  type StructuralLayout,
} from '../environment';
import {
  createFurnitureMaterialSet,
  disposeFurnitureMaterialSet,
  type FurnitureMaterialRecipe,
  type FurnitureMaterialSet,
  type FurnitureMaterialSlot,
  type FurnitureMaterialSource,
} from './materials';
import { buildCounterFront, planCounterFront } from './counterFront';
import { buildFixtures, planFixtures } from './fixtures';
import { buildSeating, planSeating } from './seating';
import { buildSoftDecor, planSoftDecor } from './softDecor';
import { buildTables, planTables } from './tables';
import { SPEC_1945 } from './data/1945';
import { SPEC_1965 } from './data/1965';
import { SPEC_1985 } from './data/1985';
import { SPEC_2005 } from './data/2005';
import { SPEC_2025 } from './data/2025';
import { hashString, type CanvasFactory } from './textures';

/* -------------------------------------------------------------------------- */
/* Era vocabulary: seating                                                    */
/* -------------------------------------------------------------------------- */

/** Loose chair families the café uses across its five eras. */
export type ChairKind =
  | 'bentwood-cane'
  | 'tubular-metal'
  | 'vinyl-diner'
  | 'stacking-polypropylene'
  | 'chrome-moulded-shell'
  | 'plywood-shell'
  | 'moulded-shell'
  | 'upholstered-lounge';

export interface ChairSpec {
  readonly kind: ChairKind;
  readonly label: string;
  readonly frameSlot: FurnitureMaterialSlot;
  readonly seatSlot: FurnitureMaterialSlot;
  readonly backSlot: FurnitureMaterialSlot;
  /** Top of the seat above the floor, in metres. */
  readonly seatHeight: number;
  readonly seatWidth: number;
  readonly seatDepth: number;
  /** Height of the back above the seat, in metres. */
  readonly backHeight: number;
  readonly stackable: boolean;
  /** The chair's joinery, in prose (corners, stiles, frame, upholstery). */
  readonly joinery: string;
}

export type BanquetteKind = 'buttoned-rexine' | 'ribbed-vinyl' | 'moquette' | 'stitched-leather' | 'wool-boucle';

export interface BanquetteSpec {
  readonly kind: BanquetteKind;
  readonly style: string;
  readonly seatSlot: FurnitureMaterialSlot;
  readonly backSlot: FurnitureMaterialSlot;
  readonly plinthSlot: FurnitureMaterialSlot;
  readonly trimSlot: FurnitureMaterialSlot | null;
  readonly seatHeight: number;
  readonly backHeight: number;
  /** Upholstery panel width along the run, in metres. */
  readonly panelWidth: number;
  /** Buttons per panel. */
  readonly buttons: number;
  readonly joinery: string;
}

export type BoothKind = 'timber-leatherette-booth' | 'ribbed-vinyl-booth' | 'high-back-vinyl-booth' | 'leather-booth' | 'reclaimed-timber-booth';

export interface BoothSpec {
  readonly kind: BoothKind;
  readonly style: string;
  readonly benchSlot: FurnitureMaterialSlot;
  readonly frameSlot: FurnitureMaterialSlot;
  readonly tableSlot: FurnitureMaterialSlot;
  readonly tableSurfaceSlot: FurnitureMaterialSlot;
  readonly seatHeight: number;
  readonly backHeight: number;
  readonly joinery: string;
}

export type BenchKind = 'moulded-pad-bench' | 'laminated-bench' | 'reclaimed-bench' | 'steel-pad-bench';

export interface BenchSpec {
  readonly kind: BenchKind;
  readonly style: string;
  readonly seatSlot: FurnitureMaterialSlot;
  readonly frameSlot: FurnitureMaterialSlot;
  readonly length: number;
  readonly depth: number;
  readonly seatHeight: number;
  readonly joinery: string;
}

export type StoolKind = 'timber-round' | 'chrome-vinyl' | 'moulded-polypropylene' | 'leather-bar' | 'reclaimed-timber';

export interface StoolSpec {
  readonly kind: StoolKind;
  readonly style: string;
  readonly seatSlot: FurnitureMaterialSlot;
  readonly frameSlot: FurnitureMaterialSlot;
  readonly seatHeight: number;
  readonly radius: number;
  readonly count: number;
  readonly footRail: boolean;
  readonly joinery: string;
}

export type LoungeKind = 'tub-armchair-pair' | 'mix-and-match-loveseat';

export interface LoungeSpec {
  readonly kind: LoungeKind;
  readonly style: string;
  readonly armchairLabel: string;
  readonly armchairSlot: FurnitureMaterialSlot;
  readonly legSlot: FurnitureMaterialSlot;
  readonly tableTopSlot: FurnitureMaterialSlot;
  readonly tableFrameSlot: FurnitureMaterialSlot;
  readonly seatHeight: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly tableRadius: number;
  readonly tableHeight: number;
  readonly joinery: string;
}

export type RailKind = 'steel-perch-rail' | 'timber-perch-rail';

export interface RailSpec {
  readonly kind: RailKind;
  readonly style: string;
  readonly topSlot: FurnitureMaterialSlot;
  readonly frameSlot: FurnitureMaterialSlot;
  /** Extra rail length beyond the window seat spread, in metres. */
  readonly length: number;
  readonly height: number;
  readonly joinery: string;
}

export interface SeatingSpec {
  /** Loose chair around the tables and at the window. */
  readonly chair: ChairSpec;
  /** Secondary chair for the two window seats (era mix), when there is one. */
  readonly accentChair: ChairSpec | null;
  /** Fixed upholstered bench run down each side wall. */
  readonly banquette: BanquetteSpec;
  /** Facing upholstered booth in the front-right quadrant. */
  readonly booth: BoothSpec;
  /** Free-standing modular bench modules, opposite the banquette. */
  readonly bench: BenchSpec | null;
  /** Stools at the counter (bar height in 2005). */
  readonly stools: StoolSpec;
  /** Window lounge group, where the era has one. */
  readonly lounge: LoungeSpec | null;
  /** Standing / perch rail along the window bay, where the era has one. */
  readonly standingRail: RailSpec | null;
  /** Loose chairs along the inner side of a communal run. */
  readonly chairsPerSide: number;
  /** The era's seating rule, in prose. */
  readonly arrangement: string;
}

/* -------------------------------------------------------------------------- */
/* Era vocabulary: tables, counters, fixtures, soft decor                     */
/* -------------------------------------------------------------------------- */

export type TableSurfaceKind =
  | 'painted-wood'
  | 'marble'
  | 'chrome-laminate'
  | 'formica'
  | 'laminate'
  | 'glass'
  | 'stone'
  | 'terrazzo'
  | 'solid-wood'
  | 'reclaimed-wood';

export type TableBaseKind =
  | 'cast-iron-pedestal'
  | 'chrome-pedestal'
  | 'x-frame-chrome'
  | 'steel-pedestal'
  | 'steel-trestle'
  | 'timber-trestle'
  | 'cast-iron-legs'
  | 'timber-legs'
  | 'hairpin-steel';

export type TableShape = 'rect' | 'round' | 'oval';

/** One table build: top, base and the joinery that holds them together. */
export interface TableVariant {
  readonly label: string;
  readonly surface: TableSurfaceKind;
  readonly base: TableBaseKind;
  readonly shape: TableShape;
  readonly width: number;
  readonly depth: number;
  readonly topThickness: number;
  readonly surfaceSlot: FurnitureMaterialSlot;
  readonly baseSlot: FurnitureMaterialSlot;
  readonly apronSlot: FurnitureMaterialSlot | null;
  readonly bandSlot: FurnitureMaterialSlot | null;
  readonly joinerySlot: FurnitureMaterialSlot | null;
  readonly joinery: string;
}

export interface TableSpec extends TableVariant {
  /** Long shared tables with bench seating instead of a slot per row. */
  readonly communal: boolean;
  /** The era's second table build, used for {@link TableSpec.variantRows}. */
  readonly variant: TableVariant | null;
  readonly variantRows: readonly number[];
  /** The era's table rule, in prose. */
  readonly placement: string;
}

export type CounterFrontKind =
  | 'painted-panelled'
  | 'formica-banded'
  | 'laminate-modular'
  | 'stainless-bar'
  | 'reclaimed-timber-slats';

export interface CounterFrontSpec {
  readonly kind: CounterFrontKind;
  readonly style: string;
  readonly panelSlot: FurnitureMaterialSlot;
  readonly panelAccentSlot: FurnitureMaterialSlot;
  readonly trimSlot: FurnitureMaterialSlot;
  readonly nosingSlot: FurnitureMaterialSlot;
  readonly panelWidth: number;
  readonly kickHeight: number;
  readonly topBandHeight: number;
  readonly footRail: boolean;
  /** The era turns the counter into bar-height seating (2005). */
  readonly barHeight: boolean;
  readonly joinery: string;
}

export type CoatStandKind = 'bentwood-stand' | 'tubular-stand' | 'chrome-tree' | 'steel-post' | 'timber-post';

export interface CoatStandSpec {
  readonly kind: CoatStandKind;
  readonly style: string;
  readonly postSlot: FurnitureMaterialSlot;
  readonly hookSlot: FurnitureMaterialSlot;
  readonly height: number;
  readonly radius: number;
  readonly hooks: number;
  readonly joinery: string;
}

export type HatRackKind = 'painted-rail-pegs' | 'shop-rail' | 'coat-hooks' | 'steel-rail-hooks' | 'timber-hook-board';

export interface HatRackSpec {
  readonly kind: HatRackKind;
  readonly style: string;
  readonly boardSlot: FurnitureMaterialSlot;
  readonly hookSlot: FurnitureMaterialSlot;
  readonly width: number;
  readonly height: number;
  readonly joinery: string;
}

export type MagazineRackKind = 'slanted-timber-rack' | 'chrome-rack' | 'wire-rack' | 'slim-steel-rack' | 'ladder-rack';

export interface MagazineRackSpec {
  readonly kind: MagazineRackKind;
  readonly style: string;
  readonly frameSlot: FurnitureMaterialSlot;
  readonly pocketSlot: FurnitureMaterialSlot;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly joinery: string;
}

export type ClockKind = 'station-clock' | 'round-dial' | 'electric-square' | 'digital-led' | 'digital-panel';

export interface ClockSpec {
  readonly kind: ClockKind;
  readonly style: string;
  readonly caseSlot: FurnitureMaterialSlot;
  readonly faceSlot: FurnitureMaterialSlot;
  readonly handSlot: FurnitureMaterialSlot;
  readonly radius: number;
  readonly joinery: string;
}

export type PhoneKind = 'payphone-bakelite' | 'payphone-chrome' | 'wall-phone-pushbutton' | 'payphone-card' | 'slim-wall-phone';

export interface PhoneSpec {
  readonly kind: PhoneKind;
  readonly style: string;
  readonly caseSlot: FurnitureMaterialSlot;
  readonly trimSlot: FurnitureMaterialSlot;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Whether the phone carries a hanging directory on its shelf. */
  readonly directory: boolean;
  readonly joinery: string;
}

export type BinKind = 'pedal-bin-enamel' | 'swing-bin' | 'open-bin-steel' | 'recycling-station' | 'segregated-recycling';

export interface BinSpec {
  readonly kind: BinKind;
  readonly style: string;
  readonly bodySlot: FurnitureMaterialSlot;
  readonly lidSlot: FurnitureMaterialSlot;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly compartments: number;
  readonly joinery: string;
}

export interface FixtureSpec {
  readonly coatStand: CoatStandSpec;
  readonly hatRack: HatRackSpec;
  readonly magazineRack: MagazineRackSpec;
  readonly clock: ClockSpec;
  readonly phone: PhoneSpec;
  readonly bin: BinSpec;
  /** The era's fixture rule, in prose. */
  readonly placement: string;
}

export type RugKind = 'woven-wool-runner' | 'flatweave-cotton' | 'shag-pile' | 'jute-flatweave' | 'recycled-felt';

export interface RugSpec {
  readonly kind: RugKind;
  readonly style: string;
  readonly slot: FurnitureMaterialSlot;
  readonly borderSlot: FurnitureMaterialSlot;
  readonly width: number;
  readonly fringe: boolean;
  readonly joinery: string;
}

export type WindowTreatmentKind =
  | 'lace-and-pelmet'
  | 'cafe-curtains'
  | 'vertical-blinds'
  | 'roller-blinds'
  | 'timber-venetian-blinds';

export interface WindowTreatmentSpec {
  readonly kind: WindowTreatmentKind;
  readonly style: string;
  readonly panelSlot: FurnitureMaterialSlot;
  readonly trimSlot: FurnitureMaterialSlot;
  /** Fraction of the glazing bay height the dressing covers, 0..1. */
  readonly coverage: number;
  readonly pelmet: boolean;
  readonly slats: number;
  readonly joinery: string;
}

export type PlantKind = 'aspidistra' | 'spider-plant' | 'rubber-plant' | 'monstera' | 'olive-tree';

export type PlantPlacement = 'window-corner' | 'counter-end' | 'counter-top';

export interface PlantSpec {
  readonly kind: PlantKind;
  readonly style: string;
  readonly leafSlot: FurnitureMaterialSlot;
  readonly potSlot: FurnitureMaterialSlot;
  readonly height: number;
  readonly potRadius: number;
  readonly placement: PlantPlacement;
  readonly count: number;
  readonly joinery: string;
}

export type TableDecorItemKind =
  | 'sugar-bowl'
  | 'condiment-set'
  | 'cruet'
  | 'napkin-holder'
  | 'ketchup-bottle'
  | 'sauce-bottle'
  | 'bud-vase'
  | 'flower-vase'
  | 'tea-light'
  | 'menu-card'
  | 'table-number'
  | 'ashtray'
  | 'succulent-pot'
  | 'water-carafe';

export interface TableDecorItem {
  readonly kind: TableDecorItemKind;
  readonly label: string;
  readonly slot: FurnitureMaterialSlot;
  /** Width, height and depth of the item in metres. */
  readonly size: readonly [number, number, number];
}

export interface SoftDecorSpec {
  readonly rug: RugSpec;
  readonly windowTreatment: WindowTreatmentSpec;
  readonly plants: readonly PlantSpec[];
  readonly tableDecor: readonly TableDecorItem[];
  /** The era's soft-decor rule, in prose. */
  readonly placement: string;
}

/* -------------------------------------------------------------------------- */
/* Era spec                                                                   */
/* -------------------------------------------------------------------------- */

/** Everything the furniture domain knows about one era. */
export interface FurnitureSpec extends DomainSpecBase, FurnitureMaterialSource {
  readonly year: YearId;
  readonly label: string;
  readonly name: string;
  readonly summary: string;
  readonly paletteName: string;
  readonly materialSetId: string;
  readonly tags: readonly string[];
  readonly notes: readonly string[];
  /** Era accent, used for small joinery details and hotspot copy. */
  readonly accentColor: string;
  readonly surfaces: Readonly<Record<FurnitureMaterialSlot, FurnitureMaterialRecipe>>;
  readonly tables: TableSpec;
  readonly seating: SeatingSpec;
  readonly counterFront: CounterFrontSpec;
  readonly fixtures: FixtureSpec;
  readonly softDecor: SoftDecorSpec;
}

/* -------------------------------------------------------------------------- */
/* Plan vocabulary                                                            */
/* -------------------------------------------------------------------------- */

/** Which builder owns a planned prop. */
export type FurnitureGroup = 'tables' | 'seating' | 'counterFront' | 'fixtures' | 'softDecor';

/** Prop families the plan distinguishes (used by the tests and hotspots). */
export type PropKind =
  | 'table'
  | 'chair'
  | 'bench'
  | 'banquette'
  | 'booth'
  | 'stool'
  | 'lounge'
  | 'standing-rail'
  | 'counter-front'
  | 'coat-stand'
  | 'hat-rack'
  | 'magazine-rack'
  | 'wall-clock'
  | 'payphone'
  | 'waste-bin'
  | 'rug'
  | 'curtain'
  | 'blind'
  | 'plant'
  | 'table-decor';

/** How a prop is supported: standing on the floor, or mounted on a surface. */
export type PropSupport = 'floor' | 'elevated';

/** Full extents of a prop in its own axes (x = width, z = depth). */
export interface PropSize {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One planned prop: where it goes and how much room it takes. */
export interface PropPlanEntry {
  readonly id: string;
  readonly kind: PropKind;
  readonly group: FurnitureGroup;
  readonly label: string;
  /** Centre of the prop's bounding box in world space. */
  readonly center: RoomPoint;
  /** Extents in the prop's own axes; rotate by {@link PropPlanEntry.rotationY}. */
  readonly size: PropSize;
  readonly rotationY: number;
  readonly support: PropSupport;
  readonly tags: readonly string[];
}

/** A planned prop plus the node the builder raised for it. */
export interface PlacedProp extends PropPlanEntry {
  readonly node: THREE.Object3D;
}

/** The complete, geometry-free placement of one era. */
export interface FurniturePlan {
  readonly year: YearId;
  readonly entries: readonly PropPlanEntry[];
  readonly groups: Readonly<Record<FurnitureGroup, readonly PropPlanEntry[]>>;
}

/** Everything the planners need: era spec, room and the era's random source. */
export interface FurniturePlanInput {
  readonly year: YearId;
  readonly spec: FurnitureSpec;
  readonly layout: StructuralLayout;
  readonly bounds: RoomBounds;
  readonly random: () => number;
}

/** Planning input plus the era's built material set. */
export interface FurnitureBuildInput extends FurniturePlanInput {
  readonly materials: FurnitureMaterialSet;
}

/** What one builder returns: its group, its props and its named landmarks. */
export interface PropBuildResult {
  readonly group: THREE.Group;
  readonly props: readonly PlacedProp[];
  readonly landmarks: Readonly<Record<string, THREE.Object3D>>;
  readonly meshCount: number;
}

/** Extents of a prop in world axes, after its yaw. */
export function worldExtents(size: PropSize, rotationY: number): PropSize {
  const cos = Math.abs(Math.cos(rotationY));
  const sin = Math.abs(Math.sin(rotationY));
  return { x: size.x * cos + size.z * sin, y: size.y, z: size.x * sin + size.z * cos };
}

/** Axis aligned world box of a planned prop. */
export function propBounds(entry: PropPlanEntry): { min: RoomPoint; max: RoomPoint } {
  const extents = worldExtents(entry.size, entry.rotationY);
  return {
    min: {
      x: entry.center.x - extents.x / 2,
      y: entry.center.y - extents.y / 2,
      z: entry.center.z - extents.z / 2,
    },
    max: {
      x: entry.center.x + extents.x / 2,
      y: entry.center.y + extents.y / 2,
      z: entry.center.z + extents.z / 2,
    },
  };
}

/** Axis aligned rectangle in the floor plane. */
export interface PropRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Floor footprint of a planned prop. */
export function propFootprint(entry: PropPlanEntry): PropRect {
  const bounds = propBounds(entry);
  return { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z };
}

/** True when two floor rectangles overlap by more than `tolerance`. */
export function rectsOverlap(a: PropRect, b: PropRect, tolerance = 0.002): boolean {
  return (
    a.minX < b.maxX - tolerance && b.minX < a.maxX - tolerance && a.minZ < b.maxZ - tolerance && b.minZ < a.maxZ - tolerance
  );
}

/** The five planners, in build order. */
const PLANNERS: Readonly<Record<FurnitureGroup, (input: FurniturePlanInput) => readonly PropPlanEntry[]>> =
  Object.freeze({
    tables: planTables,
    seating: planSeating,
    counterFront: planCounterFront,
    fixtures: planFixtures,
    softDecor: planSoftDecor,
  });

/** Plans every prop of one era (no geometry, no materials). */
export function planFurniture(input: FurniturePlanInput): FurniturePlan {
  const groups = {} as Record<FurnitureGroup, readonly PropPlanEntry[]>;
  const entries: PropPlanEntry[] = [];
  for (const group of Object.keys(PLANNERS) as FurnitureGroup[]) {
    const planned = [...PLANNERS[group](input)];
    groups[group] = Object.freeze(planned);
    entries.push(...planned);
  }
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate furniture prop id "${entry.id}".`);
    ids.add(entry.id);
  }
  return Object.freeze({ year: input.year, entries: Object.freeze(entries), groups: Object.freeze(groups) });
}

/** Stable signature of a plan: equal signatures mean identical placement. */
export function furniturePlanSignature(plan: FurniturePlan): string {
  return plan.entries
    .map(
      (entry) =>
        `${entry.id}@${entry.center.x.toFixed(4)},${entry.center.y.toFixed(4)},${entry.center.z.toFixed(4)}` +
        `#${entry.size.x.toFixed(4)}x${entry.size.y.toFixed(4)}x${entry.size.z.toFixed(4)}r${entry.rotationY.toFixed(4)}`,
    )
    .join('|');
}

/* -------------------------------------------------------------------------- */
/* Placement rules                                                            */
/* -------------------------------------------------------------------------- */

/** Depth of the entrance door's swing volume, measured into the room. */
export const DOOR_SWING_DEPTH = 1.1;
/** Depth of the approach kept clear in front of the back room doorway. */
export const DOORWAY_APPROACH_DEPTH = 0.9;

/** The volumes furniture placement must leave empty. */
export interface PlacementRules {
  readonly bounds: RoomBounds;
  readonly serviceLane: PropRect;
  readonly entranceSwing: PropRect;
  readonly counter: PropRect;
  readonly doorwayApproach: PropRect;
}

/** Derives the placement rules from the room and its structural layout. */
export function placementRules(
  layout: StructuralLayout,
  bounds: RoomBounds = layout.bounds,
): PlacementRules {
  const halfDepth = bounds.depth / 2;
  const entrance = layout.entrance;
  const doorway = layout.doorway;
  return {
    bounds,
    serviceLane: serviceLaneRect(layout.serviceLane),
    entranceSwing: {
      minX: entrance.position.x - entrance.width / 2 - 0.05,
      maxX: entrance.position.x + entrance.width / 2 + 0.05,
      minZ: halfDepth - DOOR_SWING_DEPTH,
      maxZ: halfDepth,
    },
    counter: {
      minX: layout.counter.center.x - layout.counter.width / 2,
      maxX: layout.counter.center.x + layout.counter.width / 2,
      minZ: layout.counter.center.z - layout.counter.depth / 2,
      maxZ: layout.counter.center.z + layout.counter.depth / 2,
    },
    doorwayApproach: {
      minX: doorway.position.x - doorway.width / 2,
      maxX: doorway.position.x + doorway.width / 2,
      minZ: -halfDepth,
      maxZ: -halfDepth + DOORWAY_APPROACH_DEPTH,
    },
  };
}

/**
 * Checks one era's plan against the acceptance rules and returns one message per
 * violation: every prop inside the room, no prop in the counter service lane, the
 * door swing, the doorway approach or the counter volume, every floor prop
 * standing on the floor, and no two floor props overlapping (rugs excepted —
 * everything stands on them).
 */
export function placementProblems(plan: FurniturePlan, rules: PlacementRules): readonly string[] {
  const problems: string[] = [];
  const halfWidth = rules.bounds.width / 2;
  const halfDepth = rules.bounds.depth / 2;
  const epsilon = 1e-6;

  for (const entry of plan.entries) {
    const bounds = propBounds(entry);
    const inside =
      bounds.min.x >= -halfWidth - epsilon &&
      bounds.max.x <= halfWidth + epsilon &&
      bounds.min.z >= -halfDepth - epsilon &&
      bounds.max.z <= halfDepth + epsilon &&
      bounds.min.y >= -epsilon &&
      bounds.max.y <= rules.bounds.height + epsilon;
    if (!inside) {
      problems.push(
        `${entry.id}: outside the room envelope ` +
          `(x ${bounds.min.x.toFixed(3)}..${bounds.max.x.toFixed(3)}, ` +
          `y ${bounds.min.y.toFixed(3)}..${bounds.max.y.toFixed(3)}, ` +
          `z ${bounds.min.z.toFixed(3)}..${bounds.max.z.toFixed(3)})`,
      );
    }

    const footprint = propFootprint(entry);
    if (rectsOverlap(footprint, rules.serviceLane)) {
      problems.push(`${entry.id}: blocks the counter service lane`);
    }
    if (rectsOverlap(footprint, rules.entranceSwing)) {
      problems.push(`${entry.id}: blocks the entrance door swing`);
    }
    // The doorway approach is a floor rule: a shelf or a pot resting on the
    // counter above it does not block anyone's way.
    if (entry.support === 'floor') {
      if (rectsOverlap(footprint, rules.doorwayApproach)) {
        problems.push(`${entry.id}: blocks the back room doorway`);
      }
      if (rectsOverlap(footprint, rules.counter)) {
        problems.push(`${entry.id}: stands inside the counter volume`);
      }
      if (Math.abs(bounds.min.y) > epsilon) {
        problems.push(`${entry.id}: floor prop does not stand on the floor`);
      }
    }
  }

  const solid = plan.entries.filter((entry) => entry.support === 'floor' && entry.kind !== 'rug');
  for (let a = 0; a < solid.length; a += 1) {
    for (let b = a + 1; b < solid.length; b += 1) {
      const left = solid[a];
      const right = solid[b];
      if (!left || !right) continue;
      if (rectsOverlap(propFootprint(left), propFootprint(right))) {
        problems.push(`${left.id} overlaps ${right.id}`);
      }
    }
  }


  return problems;
}

/* -------------------------------------------------------------------------- */
/* Era spec map                                                               */
/* -------------------------------------------------------------------------- */

const SPEC_SOURCES: Readonly<Record<YearId, FurnitureSpec>> = {
  '1945': SPEC_1945,
  '1965': SPEC_1965,
  '1985': SPEC_1985,
  '2005': SPEC_2005,
  '2025': SPEC_2025,
};

function buildSpecMap(): Readonly<Record<YearId, FurnitureSpec>> {
  const map = {} as Record<YearId, FurnitureSpec>;
  for (const year of YEAR_IDS) {
    const spec = SPEC_SOURCES[year];
    if (!spec) throw new Error(`Missing furniture spec for ${year}.`);
    if (spec.year !== year) {
      throw new Error(`Furniture spec keyed ${year} declares year ${spec.year}.`);
    }
    map[year] = spec;
  }
  return Object.freeze(map);
}

/** Per-year furniture specs, keyed by {@link YearId}. */
export const FURNITURE_SPECS: Readonly<Record<YearId, FurnitureSpec>> = buildSpecMap();

/** The five eras the furniture domain has data for, in chronological order. */
export const FURNITURE_SPEC_YEARS: readonly YearId[] = Object.freeze([...YEAR_IDS]);

/** Looks up an era spec, throwing for an unsupported year. */
export function furnitureSpec(year: YearId): FurnitureSpec {
  const spec = FURNITURE_SPECS[year];
  if (!spec) throw new Error(`No furniture spec for ${year}.`);
  return spec;
}

/** Every era spec, in chronological order. */
export function furnitureSpecs(): readonly FurnitureSpec[] {
  return FURNITURE_SPEC_YEARS.map((year) => furnitureSpec(year));
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

/** Flattened view of an era's furniture, used by diagnostics and the tests. */
export interface FurnitureSpecSummary {
  readonly year: YearId;
  readonly name: string;
  readonly paletteName: string;
  readonly materialSetId: string;
  readonly chair: ChairKind;
  readonly accentChair: ChairKind | 'none';
  readonly tables: string;
  readonly communal: boolean;
  readonly counterFront: CounterFrontKind;
  readonly banquette: string;
  readonly booth: string;
  readonly bench: string;
  readonly stools: StoolKind;
  readonly lounge: LoungeKind | 'none';
  readonly standingRail: RailKind | 'none';
  readonly rug: RugKind;
  readonly windowTreatment: WindowTreatmentKind;
  readonly plants: string;
  readonly clock: ClockKind;
  readonly phone: PhoneKind;
  readonly bin: BinKind;
  readonly tableDecor: string;
  readonly seatingRule: string;
  readonly accent: string;
}

/** Flattens an era spec into the summary used by diagnostics and the tests. */
export function describeFurnitureSpec(spec: FurnitureSpec): FurnitureSpecSummary {
  return {
    year: spec.year,
    name: spec.name,
    paletteName: spec.paletteName,
    materialSetId: spec.materialSetId,
    chair: spec.seating.chair.kind,
    accentChair: spec.seating.accentChair?.kind ?? 'none',
    tables: `${spec.tables.surface} on ${spec.tables.base}`,
    communal: spec.tables.communal,
    counterFront: spec.counterFront.kind,
    banquette: spec.seating.banquette.style,
    booth: spec.seating.booth.style,
    bench: spec.seating.bench?.style ?? 'none',
    stools: spec.seating.stools.kind,
    lounge: spec.seating.lounge?.kind ?? 'none',
    standingRail: spec.seating.standingRail?.kind ?? 'none',
    rug: spec.softDecor.rug.kind,
    windowTreatment: spec.softDecor.windowTreatment.kind,
    plants: spec.softDecor.plants.map((plant) => plant.kind).join('+'),
    clock: spec.fixtures.clock.kind,
    phone: spec.fixtures.phone.kind,
    bin: spec.fixtures.bin.kind,
    tableDecor: spec.softDecor.tableDecor.map((item) => item.kind).join('+'),
    seatingRule: spec.seating.arrangement,
    accent: spec.accentColor,
  };
}

/** Fields the timeline is expected to move between eras. */
export const FURNITURE_ERA_DISCRIMINATOR_FIELDS = Object.freeze([
  'name',
  'paletteName',
  'materialSetId',
  'chair',
  'accentChair',
  'tables',
  'communal',
  'counterFront',
  'banquette',
  'booth',
  'bench',
  'stools',
  'lounge',
  'standingRail',
  'rug',
  'windowTreatment',
  'plants',
  'clock',
  'phone',
  'bin',
  'tableDecor',
  'seatingRule',
  'accent',
] as const satisfies readonly (keyof FurnitureSpecSummary)[]);

/**
 * Returns the discriminator fields that share a value across two eras. An empty
 * array means the two eras read as completely different rooms.
 */
export function furnitureEraConflicts(
  a: FurnitureSpecSummary,
  b: FurnitureSpecSummary,
): readonly (keyof FurnitureSpecSummary)[] {
  return FURNITURE_ERA_DISCRIMINATOR_FIELDS.filter((field) => a[field] === b[field]);
}

/** Stable module id: registry key, hotspot owner id and node namespace. */
export const FURNITURE_MODULE_ID = 'furniture';

/** Name of the single group every furniture node is parented to. */
export const FURNITURE_GROUP_NAME = 'furniture';

/** Seed of the module's per-era deterministic placement source. */
export const DEFAULT_FURNITURE_SEED = 0x5ea7;

export interface FurnitureModuleOptions {
  /** Interior volume; defaults to {@link CAFE_ROOM_BOUNDS}. */
  readonly bounds?: RoomBounds;
  /** Structural anchor set; defaults to {@link STRUCTURAL_LAYOUT}. */
  readonly layout?: StructuralLayout;
  /** Canvas factory for the procedural surfaces (defaults to the DOM canvas). */
  readonly canvasFactory?: CanvasFactory;
  /** Texture resolution override for every furniture surface. */
  readonly textureSize?: number;
  /** Era reported by `getHotspots` before the first build. */
  readonly initialYear?: YearId;
  /** Module seed; defaults to {@link DEFAULT_FURNITURE_SEED}. */
  readonly seed?: number;
}

/** Diagnostics snapshot of the module for one moment in the timeline. */
export interface FurnitureModuleDescription {
  readonly moduleId: string;
  readonly year: YearId;
  readonly built: boolean;
  readonly paletteName: string | null;
  readonly materialSetId: string | null;
  readonly textureSource: FurnitureMaterialSet['textureSource'] | 'none';
  readonly textureCount: number;
  readonly materialCount: number;
  readonly nodeCount: number;
  readonly meshCount: number;
  readonly propCount: number;
  readonly propCounts: Readonly<Record<string, number>>;
  readonly landmarkCount: number;
  readonly placementProblems: readonly string[];
  readonly summary: FurnitureSpecSummary;
}

/* -------------------------------------------------------------------------- */
/* Module                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The café's furniture and soft decor: tables, seating, counter frontage,
 * fixtures, rugs, window dressing, plants and table settings, rebuilt for each
 * of the five eras.
 */
export class FurnitureModule implements SceneModule<FurnitureSpec> {
  readonly id = FURNITURE_MODULE_ID;

  /** Interior volume every prop is placed inside. */
  readonly bounds: RoomBounds;

  /** Table slot grid, counter zone, service lane, mounts and reserved zones. */
  readonly layout: StructuralLayout;

  /** Placement rules derived from the room and the layout. */
  readonly rules: PlacementRules;

  private readonly options: FurnitureModuleOptions;
  private group: THREE.Group | null = null;
  private materials: FurnitureMaterialSet | null = null;
  private currentSpec: FurnitureSpec | null = null;
  private builtPlan: FurniturePlan | null = null;
  private placed: PlacedProp[] = [];
  private landmarkNodes = new Map<string, THREE.Object3D>();
  private clockHands: THREE.Object3D | null = null;
  private foliageNodes: THREE.Object3D[] = [];
  private clockSeconds = 0;
  private phase = 0;
  private updates = 0;

  constructor(options: FurnitureModuleOptions = {}) {
    this.options = options;
    this.bounds = options.bounds ?? CAFE_ROOM_BOUNDS;
    this.layout = options.layout ?? STRUCTURAL_LAYOUT;

    if (
      this.layout.bounds.width !== this.bounds.width ||
      this.layout.bounds.depth !== this.bounds.depth ||
      this.layout.bounds.height !== this.bounds.height
    ) {
      throw new Error('The structural layout must describe the same room as `bounds`.');
    }
    const problems = validateLayout(this.layout);
    if (problems.length > 0) {
      throw new Error(`Invalid environment layout: ${problems.join('; ')}`);
    }
    this.rules = placementRules(this.layout, this.bounds);
  }

  /* -- SceneModule surface -------------------------------------------------- */

  /** The single `furniture` group, once built. */
  get root(): THREE.Object3D | undefined {
    return this.group ?? undefined;
  }

  /** Era data currently applied. */
  get spec(): FurnitureSpec | undefined {
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
    // Furniture geometry is era specific — a bentwood chair is not a moulded
    // shell — so the era swap raises the props for the new year and releases the
    // previous group first. Nothing from the era we just left can survive it.
    this.dispose();
    this.raise(period.year, context);
  }

  update(deltaSeconds: number, _context: UpdateContext): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(deltaSeconds, 0) : 0;
    this.phase = (this.phase + delta) % (Math.PI * 2);
    this.updates += 1;
    this.clockSeconds = (this.clockSeconds + delta) % 43_200;

    const hands = this.clockHands;
    if (hands) {
      const [minute, second, hour] = hands.children;
      if (second) second.rotation.z = -((this.clockSeconds % 60) / 60) * Math.PI * 2;
      if (minute) minute.rotation.z = -((this.clockSeconds % 3600) / 3600) * Math.PI * 2;
      if (hour) hour.rotation.z = -((this.clockSeconds % 43_200) / 43_200) * Math.PI * 2;
    }
    // A gentle breath through the foliage, so the room never looks frozen.
    for (const plant of this.foliageNodes) {
      plant.rotation.z = Math.sin(this.phase * 0.6) * 0.006;
    }
  }

  dispose(): void {
    if (this.group) {
      disposeObject3D(this.group);
      this.group = null;
    }
    if (this.materials) {
      disposeFurnitureMaterialSet(this.materials);
      this.materials = null;
    }
    this.currentSpec = null;
    this.builtPlan = null;
    this.placed = [];
    this.landmarkNodes = new Map();
    this.clockHands = null;
    this.foliageNodes = [];
    this.phase = 0;
    this.clockSeconds = 0;
  }

  getHotspots(): readonly Hotspot[] {
    const spec = this.currentSpec ?? furnitureSpec(this.options.initialYear ?? DEFAULT_YEAR_ID);
    const plan = this.builtPlan ?? this.eraPlan(spec.year);
    const hotspots: Hotspot[] = [];

    const make = (
      kind: PropKind,
      options: {
        readonly id: string;
        readonly label: string;
        readonly description: string;
        readonly landmark?: string;
        readonly kind?: Hotspot['kind'];
        /** Restricts the match to ids with this prefix (two kinds, one hotspot). */
        readonly prefix?: string;
      },
    ): void => {
      const entry = plan.entries.find(
        (candidate) =>
          candidate.kind === kind && (options.prefix === undefined || candidate.id.startsWith(options.prefix)),
      );
      if (!entry) return;
      const bounds = propBounds(entry);
      const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
      hotspots.push({
        id: options.id,
        label: options.label,
        description: options.description,
        position: new THREE.Vector3(
          entry.center.x,
          Math.min(Math.max(entry.center.y, 0.35), 1.6),
          entry.center.z,
        ),
        radius: Math.min(Math.max(span / 2, 0.45), 2.2),
        year: spec.year,
        moduleId: this.id,
        kind: options.kind ?? 'info',
        anchor: options.landmark ? this.landmarkNodes.get(options.landmark) : undefined,
      });
    };

    const era = `${spec.year} ${spec.name}`;
    make('counter-front', {
      id: 'furniture:counter-front',
      label: `Counter frontage — ${spec.counterFront.style}`,
      description: `${era}. ${spec.counterFront.joinery}`,
      landmark: 'counter-front',
      kind: 'interactive',
    });
    make('table', {
      id: 'furniture:tables',
      label: `Tables — ${spec.tables.label}`,
      description: `${era}. ${spec.tables.joinery} ${spec.tables.placement}`,
      landmark: 'table-1-1',
      kind: 'info',
    });
    make('booth', {
      id: 'furniture:booth-seating',
      label: `Booth seating — ${spec.seating.booth.style}`,
      description: `${era}. ${spec.seating.booth.joinery}`,
      landmark: 'booth',
      kind: 'interactive',
    });
    make('banquette', {
      id: 'furniture:banquette',
      label: `Banquette — ${spec.seating.banquette.style}`,
      description: `${era}. ${spec.seating.banquette.joinery}`,
      landmark: 'banquette-right',
      kind: 'info',
    });
    make('stool', {
      id: 'furniture:counter-stools',
      label: `Counter stools — ${spec.seating.stools.style}`,
      description: `${era}. ${spec.seating.stools.joinery}`,
      landmark: 'counter-stools',
      kind: 'info',
      prefix: 'furniture:stool:counter',
    });
    make('coat-stand', {
      id: 'furniture:coat-stand',
      label: `Coat stand — ${spec.fixtures.coatStand.style}`,
      description: `${era}. ${spec.fixtures.coatStand.joinery}`,
      landmark: 'coat-stand',
      kind: 'interactive',
    });
    make('hat-rack', {
      id: 'furniture:hat-rack',
      label: `Hat rack — ${spec.fixtures.hatRack.style}`,
      description: `${era}. ${spec.fixtures.hatRack.joinery}`,
      landmark: 'hat-rack',
      kind: 'info',
    });
    make('magazine-rack', {
      id: 'furniture:magazine-rack',
      label: `Magazine rack — ${spec.fixtures.magazineRack.style}`,
      description: `${era}. ${spec.fixtures.magazineRack.joinery}`,
      landmark: 'magazine-rack',
      kind: 'info',
    });
    make('wall-clock', {
      id: 'furniture:wall-clock',
      label: `Wall clock — ${spec.fixtures.clock.style}`,
      description: `${era}. ${spec.fixtures.clock.joinery}`,
      landmark: 'wall-clock',
      kind: 'info',
    });
    make('payphone', {
      id: 'furniture:payphone',
      label: `${spec.fixtures.phone.style}`,
      description: `${era}. ${spec.fixtures.phone.joinery}`,
      landmark: 'payphone',
      kind: 'interactive',
    });
    make('waste-bin', {
      id: 'furniture:waste-bin',
      label: `Waste bin — ${spec.fixtures.bin.style}`,
      description: `${era}. ${spec.fixtures.bin.joinery}`,
      landmark: 'waste-bin',
      kind: 'info',
    });
    make('rug', {
      id: 'furniture:rug',
      label: `Rug — ${spec.softDecor.rug.style}`,
      description: `${era}. ${spec.softDecor.rug.joinery}`,
      kind: 'info',
    });
    make('plant', {
      id: 'furniture:house-plants',
      label: `House plants — ${spec.softDecor.plants.map((plant) => plant.kind.replace('-', ' ')).join(', ')}`,
      description: `${era}. ${spec.softDecor.plants[0]?.joinery ?? ''}`.trim(),
      kind: 'info',
    });
    make('curtain', {
      id: 'furniture:window-dressing',
      label: `Window dressing — ${spec.softDecor.windowTreatment.style}`,
      description: `${era}. ${spec.softDecor.windowTreatment.joinery}`,
      kind: 'info',
    });
    make('blind', {
      id: 'furniture:window-dressing',
      label: `Window dressing — ${spec.softDecor.windowTreatment.style}`,
      description: `${era}. ${spec.softDecor.windowTreatment.joinery}`,
      kind: 'info',
    });
    make('table-decor', {
      id: 'furniture:table-setting',
      label: `Table setting — ${spec.softDecor.tableDecor.map((item) => item.label).join(', ')}`,
      description: `${era}. ${spec.softDecor.placement}`,
      kind: 'info',
    });
    if (spec.seating.lounge) {
      make('lounge', {
        id: 'furniture:lounge',
        label: `Lounge — ${spec.seating.lounge.style}`,
        description: `${era}. ${spec.seating.lounge.joinery}`,
        landmark: 'lounge',
        kind: 'interactive',
      });
    }
    const windowChair = spec.seating.lounge
      ? spec.seating.lounge.armchairLabel
      : (spec.seating.accentChair ?? spec.seating.chair).label;
    make('chair', {
      id: 'furniture:window-seats',
      label: `Window seats — ${windowChair}`,
      description: `${era}. ${spec.seating.arrangement}`,
      landmark: 'window-seat',
      kind: 'info',
      prefix: 'furniture:chair:window',
    });
    make('stool', {
      id: 'furniture:perch-stools',
      label: `Perch stools — ${spec.seating.stools.style}`,
      description: `${era}. ${spec.seating.standingRail?.joinery ?? ''}`.trim(),
      landmark: 'window-perch',
      kind: 'info',
      prefix: 'furniture:stool:window',
    });
    make('standing-rail', {
      id: 'furniture:standing-rail',
      label: `Standing rail — ${spec.seating.standingRail?.style ?? ''}`.trim(),
      description: `${era}. ${spec.seating.standingRail?.joinery ?? ''}`.trim(),
      landmark: 'standing-rail',
      kind: 'interactive',
    });
    make('bench', {
      id: 'furniture:bench-seating',
      label: `Bench seating — ${spec.seating.bench?.style ?? ''}`.trim(),
      description: `${era}. ${spec.seating.bench?.joinery ?? ''}`.trim(),
      landmark: 'bench',
      kind: 'info',
    });

    return Object.freeze(hotspots);
  }

  /* -- Diagnostics and consumer accessors ---------------------------------- */

  /** True once the props have been raised. */
  get built(): boolean {
    return this.group !== null;
  }

  /** The era's material set (every material is named `furniture:<year>:<slot>`). */
  get materialSet(): FurnitureMaterialSet | undefined {
    return this.materials ?? undefined;
  }

  /** Identifier of the active material set. */
  get materialSetId(): string | undefined {
    return this.materials?.id;
  }

  /** Where the era's surfaces came from. */
  get textureSource(): FurnitureMaterialSet['textureSource'] | 'none' {
    return this.materials?.textureSource ?? 'none';
  }

  /** Every procedural texture the module owns, once built. */
  get textures(): readonly THREE.Texture[] {
    return this.materials?.textures ?? [];
  }

  /** Number of scene-graph nodes under the furniture group. */
  get nodeCount(): number {
    if (!this.group) return 0;
    let count = 0;
    this.group.traverse(() => {
      count += 1;
    });
    return count;
  }

  /** Number of meshes under the furniture group. */
  get meshCount(): number {
    if (!this.group) return 0;
    let count = 0;
    this.group.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) count += 1;
    });
    return count;
  }

  /** Number of times {@link SceneModule.update} has run. */
  get updateCount(): number {
    return this.updates;
  }

  /** The props raised for the active era. */
  get props(): readonly PlacedProp[] {
    return this.placed;
  }

  /** The plan the active era was built from. */
  get plan(): FurniturePlan | undefined {
    return this.builtPlan ?? undefined;
  }

  /** Named landmark nodes of the active era (counter front, booth, clock, ...). */
  get landmarks(): ReadonlyMap<string, THREE.Object3D> {
    return this.landmarkNodes;
  }

  /** Plans one era without building it (hotspots, tests, tooling). */
  eraPlan(year: YearId): FurniturePlan {
    return planFurniture({
      year,
      spec: furnitureSpec(year),
      layout: this.layout,
      bounds: this.bounds,
      random: this.createRandom(year),
    });
  }

  /** Placement problems of the active era (empty means the plan is sound). */
  placementProblems(): readonly string[] {
    const year = this.currentSpec?.year ?? this.options.initialYear ?? DEFAULT_YEAR_ID;
    const plan = this.builtPlan ?? this.eraPlan(year);
    return placementProblems(plan, this.rules);
  }

  /** Prop counts by kind, for the active era. */
  propCounts(): Readonly<Record<string, number>> {
    const plan = this.builtPlan;
    const counts: Record<string, number> = {};
    for (const entry of plan?.entries ?? []) {
      counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    }
    return counts;
  }

  /** Everything diagnostics (and the tests) need in one snapshot. */
  describe(): FurnitureModuleDescription {
    const spec = this.currentSpec ?? furnitureSpec(this.options.initialYear ?? DEFAULT_YEAR_ID);
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
      meshCount: this.meshCount,
      propCount: this.placed.length,
      propCounts: this.propCounts(),
      landmarkCount: this.landmarkNodes.size,
      placementProblems: this.placementProblems(),
      summary: describeFurnitureSpec(spec),
    });
  }

  /* -- Internals ------------------------------------------------------------ */

  private createRandom(year: YearId): () => number {
    const seed = this.options.seed ?? DEFAULT_FURNITURE_SEED;
    return createSeededRandom(seed ^ hashString(`furniture:${year}`));
  }

  private raise(year: YearId, context: BuildContext): void {
    const spec = furnitureSpec(year);
    const materials = createFurnitureMaterialSet(spec, {
      canvasFactory: this.options.canvasFactory,
      textureSize: this.options.textureSize,
    });
    const input: FurnitureBuildInput = {
      year,
      spec,
      materials,
      layout: this.layout,
      bounds: this.bounds,
      random: this.createRandom(year),
    };

    const plan = planFurniture(input);
    const group = new THREE.Group();
    group.name = FURNITURE_GROUP_NAME;
    const placed: PlacedProp[] = [];
    const landmarks = new Map<string, THREE.Object3D>();

    try {
      const results: readonly PropBuildResult[] = [
        buildTables(input, plan.groups.tables),
        buildSeating(input, plan.groups.seating),
        buildCounterFront(input, plan.groups.counterFront),
        buildFixtures(input, plan.groups.fixtures),
        buildSoftDecor(input, plan.groups.softDecor),
      ];
      for (const result of results) {
        group.add(result.group);
        placed.push(...result.props);
        for (const [key, node] of Object.entries(result.landmarks)) landmarks.set(key, node);
      }
      context.root.add(group);
    } catch (error) {
      // Never leave a half-raised room behind: release what was built and let
      // the error reach the composition layer.
      disposeObject3D(group);
      disposeFurnitureMaterialSet(materials);
      throw error;
    }

    this.group = group;
    this.materials = materials;
    this.currentSpec = spec;
    this.builtPlan = plan;
    this.placed = placed;
    this.landmarkNodes = landmarks;
    this.clockHands = landmarks.get('clock-hands') ?? null;
    this.foliageNodes = [...landmarks.entries()]
      .filter(([key]) => key.startsWith('plant-'))
      .map(([, node]) => node);
    this.phase = 0;
    this.clockSeconds = 0;
  }
}

/** Convenience factory mirroring `createKernel` / `createEnvironmentModule`. */
export function createFurnitureModule(options: FurnitureModuleOptions = {}): FurnitureModule {
  return new FurnitureModule(options);
}
