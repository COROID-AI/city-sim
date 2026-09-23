/**
 * Chrono City — era-evolving building factory.
 *
 * Everything the perimeter-building system needs *before* anything is drawn:
 * the authoring ring of lots around the block, the six authored building
 * recipes that realise the five eras (1945 brick walk-up, 1965 mid-century,
 * 1985 brutalist slab, 1985 mirrored tower, 2005 glass office, 2025 parametric
 * green tower), the deterministic massing planner that turns a recipe and a lot
 * into stacked mass blocks, the material sets those recipes resolve through the
 * shared `MaterialLibrary`, and the instancing primitives (`DetailGeometrySet`
 * + `DetailBatcher`) that keep facade ornament affordable.
 *
 * Local building frame (one lot, everything authored in metres):
 *   * `+Y` is up and the base of the building sits at `y = 0`;
 *   * the street line is `z = 0` and the building extends towards `-z`;
 *   * `x` runs along the frontage, centred on `0`;
 *   * a mass block's `frontOffset` is the distance from the street line back to
 *     that block's front face, so `frontOffset: 0` is the street wall.
 *
 * The authored details only ever live *above* `DETAIL_BASE_Y`, which keeps the
 * `0–4 m` storefront band clear for the storefronts/advertisements task: this
 * module hands that task a mount surface (`role: 'mount-surface'` geometry plus
 * `LotDefinition` metadata) and nothing else inside the band.
 *
 * Lifecycle:
 *   create    → lot ring, recipes, plans, material sets, geometry/batch helpers.
 *   consume   → `facades.ts`, `rooftops.ts`, `buildingsApi.ts`.
 *   integrate → `buildingsApi.ts` composes it into the era-blendable system.
 */

import * as THREE from 'three';

import { BLOCK_HALF_DEPTH, BLOCK_HALF_WIDTH, type BlockSide } from '../../core/blockLayout';
import type { EraId } from '../../core/eraContracts';
import type { RandomSource } from '../../core/sceneContext';
import { getEraDescriptor, type EraTimelineDescriptor } from '../../era/eraDescriptors';
import {
  SURFACE_MATERIAL_DEFAULTS,
  type MaterialLibrary,
  type MaterialRequest,
} from '../../materials/materialLibrary';
import { mixHex, type SurfaceKind } from '../../materials/textureGenerators';

export const BUILDING_FACTORY_VERSION = 1;

/** Height of the storefront band this task must leave clear, in metres. */
export const STOREFRONT_BAND_HEIGHT = 4;

/** Lowest `y` an authored facade ornament may reach — just clear of the band. */
export const DETAIL_BASE_Y = STOREFRONT_BAND_HEIGHT + 0.05;

/** Depth of the buildable ring around the block, in metres. */
export const PERIMETER_DEPTH = 14;

/** Name of the group the whole building set is parented to. */
export const BUILDINGS_ROOT_NAME = 'chrono-city-buildings';

/** Prefix of one lot's group name: `building-lot:south-2`. */
export const LOT_GROUP_PREFIX = 'building-lot:';

/** Hard cap on the number of distinct materials a single era may resolve. */
export const MAX_UNIQUE_MATERIALS_PER_ERA = 8;

/* ------------------------------------------------------------------------- *
 * Lots
 * ------------------------------------------------------------------------- */

/** A point on the ground plane (the Y component is always 0 by convention). */
export interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

/**
 * One authored building lot on the block perimeter. Lots tile each side of the
 * block continuously — the frontages of a side sum to its length — so the
 * street wall has no seams, at any era.
 */
export interface LotDefinition {
  /** Stable id, e.g. `south-2`; also the basis of the inspectable id. */
  readonly id: string;
  /** Which side of the block the lot fronts. */
  readonly side: BlockSide;
  /** Index of the lot along its side, from the side's first corner. */
  readonly index: number;
  /** Length of the street frontage, in metres. */
  readonly frontWidth: number;
  /** World position of the middle of the street frontage, at ground level. */
  readonly frontCenter: GroundPoint;
  /** Yaw that turns the local `+Z` (facing) axis outward onto the street. */
  readonly yaw: number;
  /** `true` when this lot registers as an inspectable landmark building. */
  readonly landmark: boolean;
}

interface PerimeterSideSpec {
  readonly side: BlockSide;
  readonly widths: readonly number[];
}

/** Frontages of the south row, west → east; sums to `80 - 2 * 14 = 52`. */
const SOUTH_WIDTHS: readonly number[] = [10, 12, 9, 11, 10];
/** Frontages of the north row, west → east. */
const NORTH_WIDTHS: readonly number[] = [9, 11, 12, 10, 10];
/** Frontages of the west column, north → south; sums to the block depth, 50. */
const WEST_WIDTHS: readonly number[] = [12, 13, 13, 12];
/** Frontages of the east column, north → south. */
const EAST_WIDTHS: readonly number[] = [13, 12, 12, 13];

/** Lots that carry a named, per-year inspectable identity. */
export const LANDMARK_LOT_IDS: readonly string[] = Object.freeze([
  'south-2',
  'south-4',
  'north-0',
  'north-3',
  'west-1',
  'east-2',
]);

const PERIMETER_SIDES: readonly PerimeterSideSpec[] = Object.freeze([
  { side: 'south', widths: SOUTH_WIDTHS },
  { side: 'north', widths: NORTH_WIDTHS },
  { side: 'west', widths: WEST_WIDTHS },
  { side: 'east', widths: EAST_WIDTHS },
]);

interface SideFrame {
  /** World position of the side's first corner at ground level. */
  readonly startX: number;
  readonly startZ: number;
  /** Unit direction of the side's along-axis, pointing away from the start corner. */
  readonly axisX: number;
  readonly axisZ: number;
  /** Yaw that maps the local facing axis (`+Z`) onto the street. */
  readonly yaw: number;
  /** Total length of the side, in metres. */
  readonly length: number;
}

const HALF_PI = Math.PI / 2;

function sideFrame(side: BlockSide): SideFrame {
  const rowStart = -(BLOCK_HALF_WIDTH - PERIMETER_DEPTH);
  const columnStart = -BLOCK_HALF_DEPTH;
  switch (side) {
    case 'south':
      return {
        startX: rowStart,
        startZ: BLOCK_HALF_DEPTH,
        axisX: 1,
        axisZ: 0,
        yaw: 0,
        length: BLOCK_HALF_WIDTH * 2 - PERIMETER_DEPTH * 2,
      };
    case 'north':
      return {
        startX: rowStart,
        startZ: -BLOCK_HALF_DEPTH,
        axisX: 1,
        axisZ: 0,
        yaw: Math.PI,
        length: BLOCK_HALF_WIDTH * 2 - PERIMETER_DEPTH * 2,
      };
    case 'west':
      return {
        startX: -BLOCK_HALF_WIDTH,
        startZ: columnStart,
        axisX: 0,
        axisZ: 1,
        yaw: -HALF_PI,
        length: BLOCK_HALF_DEPTH * 2,
      };
    default:
      return {
        startX: BLOCK_HALF_WIDTH,
        startZ: columnStart,
        axisX: 0,
        axisZ: 1,
        yaw: HALF_PI,
        length: BLOCK_HALF_DEPTH * 2,
      };
  }
}

function buildLotLayout(): readonly LotDefinition[] {
  const lots: LotDefinition[] = [];
  for (const spec of PERIMETER_SIDES) {
    const frame = sideFrame(spec.side);
    let cursor = 0;
    spec.widths.forEach((frontWidth, index) => {
      const along = cursor + frontWidth / 2;
      cursor += frontWidth;
      const id = `${spec.side}-${index}`;
      lots.push(
        Object.freeze({
          id,
          side: spec.side,
          index,
          frontWidth,
          frontCenter: Object.freeze({
            x: frame.startX + frame.axisX * along,
            z: frame.startZ + frame.axisZ * along,
          }),
          yaw: frame.yaw,
          landmark: LANDMARK_LOT_IDS.includes(id),
        }),
      );
    });
  }
  return Object.freeze(lots);
}

/** The authoring ring: 18 lots tiling the four sides of the block. */
export const LOT_LAYOUT: readonly LotDefinition[] = buildLotLayout();

/** Looks up one lot by id; `null` when unknown. */
export function lotById(id: string): LotDefinition | null {
  return LOT_LAYOUT.find((lot) => lot.id === id) ?? null;
}

/** Total frontage of one side of the block, in metres. */
export function sideFrontage(side: BlockSide): number {
  return sideFrame(side).length;
}

/** Yaw that faces the street for a side of the block. */
export function sideYaw(side: BlockSide): number {
  return sideFrame(side).yaw;
}

/* ------------------------------------------------------------------------- *
 * Recipes — what each era's buildings are made of
 * ------------------------------------------------------------------------- */

/** The eras' massing archetypes; one recipe per archetype. */
export type BuildingMassing =
  | 'walkup'
  | 'midcentury'
  | 'brutalist'
  | 'mirrorTower'
  | 'glassOffice'
  | 'parametricGreen';

/** How one era's facades are articulated above the storefront band. */
export interface FacadeFeatureRecipe {
  readonly windowStyle: 'sash' | 'ribbon' | 'punched' | 'curtainWall' | 'parametric';
  /** Clear window width, in metres. */
  readonly windowWidth: number;
  /** Window centre-to-centre spacing, in metres. */
  readonly baySpacing: number;
  /** Window height as a fraction of the floor height. */
  readonly windowHeightRatio: number;
  /** How far the window frame projects from the wall, in metres. */
  readonly frameDepth: number;
  /** Projecting sill depth; `0` for flush modern frames. */
  readonly sillProjection: number;
  readonly lintels: boolean;
  readonly cornice: 'deep' | 'thin' | 'band' | 'cap' | 'green' | 'none';
  readonly corniceDepth: number;
  readonly corniceHeight: number;
  /** Depth of the plain band cap that terminates the storefront band. */
  readonly bandCapDepth: number;
  readonly bandCapHeight: number;
  /** Number of iron fire-escape stacks on the street elevation. */
  readonly fireEscapes: boolean;
  readonly fireEscapeBays: number;
  readonly neonTrim: boolean;
  readonly mirroredBands: boolean;
  readonly mediaFacade: boolean;
  readonly planterBands: boolean;
  readonly concreteGrid: boolean;
  readonly mullions: boolean;
  readonly spandrels: boolean;
  readonly briseSoleil: boolean;
  readonly pilasters: boolean;
}

/**
 * Rooftop character: everything that gives an era its documented roof line
 * (`architecture.roofStyle` in the era descriptors) — water tanks and chimneys,
 * HVAC plant, dishes and masts, green terraces with solar and wind.
 */
export interface RoofFeatureRecipe {
  readonly waterTowers: number;
  readonly chimneys: number;
  readonly pigeonCoops: number;
  readonly acUnits: number;
  readonly vents: number;
  readonly satelliteDishes: number;
  readonly ductRuns: number;
  readonly crates: number;
  readonly bulkhead: boolean;
  readonly parapet: 'brick' | 'cap' | 'band' | 'mirror' | 'green' | 'none';
  readonly parapetHeight: number;
  readonly neonRoofSign: boolean;
  readonly antennaMast: boolean;
  readonly mechanicalFloor: boolean;
  readonly solarPanels: number;
  readonly windTurbines: number;
  readonly planters: number;
  readonly trees: number;
  readonly mediaCrown: boolean;
}

/** One authored building archetype: massing, materials and ornament budget. */
export interface BuildingRecipe {
  readonly era: EraId;
  readonly massing: BuildingMassing;
  /** Realises `architecture.style` from the era descriptor. */
  readonly style: string;
  readonly storeysMin: number;
  readonly storeysMax: number;
  /** Floor-to-floor height, in metres. */
  readonly floorHeight: number;
  /** Lot depth the massing prefers, in metres. */
  readonly depth: number;
  readonly depthJitter: number;
  readonly facadeSurface: SurfaceKind;
  readonly trimSurface: SurfaceKind;
  readonly glassSurface: SurfaceKind;
  readonly metalSurface: SurfaceKind;
  readonly roofSurface: SurfaceKind;
  readonly accentSurface: SurfaceKind;
  readonly foliage: boolean;
  /** `0` = mirror smooth, `1` = sooty and rough. Mirrors `architecture.facadeRoughness`. */
  readonly facadeRoughness: number;
  readonly glassRoughness: number;
  readonly facadeWear: number;
  /** Ratio of the descriptor's palette that survives into the glass tint. */
  readonly glassMix: number;
  /** Multiplies every surface texture's feature density. */
  readonly repeatScale: number;
  readonly facade: FacadeFeatureRecipe;
  readonly roof: RoofFeatureRecipe;
  readonly notes: string;
}

/** 1945 — soot-stained brick and stone walk-ups with iron fire escapes. */
const RECIPE_WALKUP: BuildingRecipe = {
  era: '1945',
  massing: 'walkup',
  style: 'soot-stained brick walk-ups with stone lintels, deep cornices and iron fire escapes',
  storeysMin: 3,
  storeysMax: 6,
  floorHeight: 3.4,
  depth: 13.5,
  depthJitter: 0.6,
  facadeSurface: 'brick',
  trimSurface: 'stone',
  glassSurface: 'glassCurtainWall',
  metalSurface: 'corrugatedMetal',
  roofSurface: 'asphalt',
  accentSurface: 'paintedSign',
  foliage: false,
  facadeRoughness: 0.95,
  glassRoughness: 0.24,
  facadeWear: 0.62,
  glassMix: 0.28,
  repeatScale: 1,
  facade: {
    windowStyle: 'sash',
    windowWidth: 1.15,
    baySpacing: 2.6,
    windowHeightRatio: 0.62,
    frameDepth: 0.14,
    sillProjection: 0.2,
    lintels: true,
    cornice: 'deep',
    corniceDepth: 0.62,
    corniceHeight: 0.85,
    bandCapDepth: 0.3,
    bandCapHeight: 0.3,
    fireEscapes: true,
    fireEscapeBays: 2,
    neonTrim: false,
    mirroredBands: false,
    mediaFacade: false,
    planterBands: false,
    concreteGrid: false,
    mullions: false,
    spandrels: false,
    briseSoleil: false,
    pilasters: true,
  },
  roof: {
    waterTowers: 1,
    chimneys: 2,
    pigeonCoops: 1,
    acUnits: 0,
    vents: 2,
    satelliteDishes: 0,
    ductRuns: 1,
    crates: 2,
    bulkhead: true,
    parapet: 'brick',
    parapetHeight: 0.85,
    neonRoofSign: false,
    antennaMast: false,
    mechanicalFloor: false,
    solarPanels: 0,
    windTurbines: 0,
    planters: 0,
    trees: 0,
    mediaCrown: false,
  },
  notes: 'Narrow red-brick frontages, stone sills and lintels, deep projecting cornice, tar roofs.',
};

/** 1965 — post-war optimism: ribbon glazing, aluminium and neon fascias. */
const RECIPE_MIDCENTURY: BuildingRecipe = {
  era: '1965',
  massing: 'midcentury',
  style: 'mid-century ribbon glazing, aluminium spandrels and neon fascias',
  storeysMin: 4,
  storeysMax: 12,
  floorHeight: 3.1,
  depth: 12.5,
  depthJitter: 0.5,
  facadeSurface: 'stucco',
  trimSurface: 'corrugatedMetal',
  glassSurface: 'glassCurtainWall',
  metalSurface: 'corrugatedMetal',
  roofSurface: 'asphalt',
  accentSurface: 'neon',
  foliage: false,
  facadeRoughness: 0.55,
  glassRoughness: 0.1,
  facadeWear: 0.28,
  glassMix: 0.52,
  repeatScale: 1.1,
  facade: {
    windowStyle: 'ribbon',
    windowWidth: 2.2,
    baySpacing: 2.7,
    windowHeightRatio: 0.5,
    frameDepth: 0.07,
    sillProjection: 0.06,
    lintels: false,
    cornice: 'thin',
    corniceDepth: 0.3,
    corniceHeight: 0.42,
    bandCapDepth: 0.45,
    bandCapHeight: 0.42,
    fireEscapes: false,
    fireEscapeBays: 0,
    neonTrim: true,
    mirroredBands: false,
    mediaFacade: false,
    planterBands: false,
    concreteGrid: false,
    mullions: true,
    spandrels: true,
    briseSoleil: true,
    pilasters: false,
  },
  roof: {
    waterTowers: 0,
    chimneys: 1,
    pigeonCoops: 0,
    acUnits: 3,
    vents: 2,
    satelliteDishes: 0,
    ductRuns: 2,
    crates: 1,
    bulkhead: true,
    parapet: 'cap',
    parapetHeight: 0.45,
    neonRoofSign: true,
    antennaMast: true,
    mechanicalFloor: false,
    solarPanels: 0,
    windTurbines: 0,
    planters: 0,
    trees: 0,
    mediaCrown: false,
  },
  notes: 'Continuous ribbon windows, thin projecting fins, gilded-aluminium spandrels, rooftop neon.',
};

/** 1985 — heavy concrete slabs with deep-recessed punched windows. */
const RECIPE_BRUTALIST: BuildingRecipe = {
  era: '1985',
  massing: 'brutalist',
  style: 'brutalist concrete slabs with expressed grids and projecting stair towers',
  storeysMin: 6,
  storeysMax: 14,
  floorHeight: 3,
  depth: 14,
  depthJitter: 0.4,
  facadeSurface: 'stucco',
  trimSurface: 'stone',
  glassSurface: 'glassCurtainWall',
  metalSurface: 'corrugatedMetal',
  roofSurface: 'asphalt',
  accentSurface: 'neon',
  foliage: false,
  facadeRoughness: 0.88,
  glassRoughness: 0.16,
  facadeWear: 0.4,
  glassMix: 0.32,
  repeatScale: 0.9,
  facade: {
    windowStyle: 'punched',
    windowWidth: 1.5,
    baySpacing: 3.2,
    windowHeightRatio: 0.42,
    frameDepth: 0.08,
    sillProjection: 0,
    lintels: false,
    cornice: 'band',
    corniceDepth: 0.42,
    corniceHeight: 0.7,
    bandCapDepth: 0.35,
    bandCapHeight: 0.5,
    fireEscapes: false,
    fireEscapeBays: 0,
    neonTrim: false,
    mirroredBands: false,
    mediaFacade: false,
    planterBands: false,
    concreteGrid: true,
    mullions: false,
    spandrels: false,
    briseSoleil: false,
    pilasters: true,
  },
  roof: {
    waterTowers: 0,
    chimneys: 1,
    pigeonCoops: 1,
    acUnits: 4,
    vents: 3,
    satelliteDishes: 2,
    ductRuns: 3,
    crates: 3,
    bulkhead: true,
    parapet: 'band',
    parapetHeight: 0.6,
    neonRoofSign: true,
    antennaMast: true,
    mechanicalFloor: true,
    solarPanels: 0,
    windTurbines: 0,
    planters: 0,
    trees: 0,
    mediaCrown: false,
  },
  notes: 'Bush-hammered concrete, expressed floor bands and pier grid, heavy rooftop plant rooms.',
};

/** 1985 — the other half of the era: stepped mirror-glass towers. */
const RECIPE_MIRROR_TOWER: BuildingRecipe = {
  era: '1985',
  massing: 'mirrorTower',
  style: 'stepped mirror-glass towers with mirrored spandrel bands and rooftop dishes',
  storeysMin: 12,
  storeysMax: 24,
  floorHeight: 3,
  depth: 13.5,
  depthJitter: 0.5,
  facadeSurface: 'glassCurtainWall',
  trimSurface: 'stone',
  glassSurface: 'glassCurtainWall',
  metalSurface: 'corrugatedMetal',
  roofSurface: 'asphalt',
  accentSurface: 'neon',
  foliage: false,
  facadeRoughness: 0.12,
  glassRoughness: 0.05,
  facadeWear: 0.16,
  glassMix: 0.74,
  repeatScale: 1.25,
  facade: {
    windowStyle: 'curtainWall',
    windowWidth: 1.8,
    baySpacing: 2.1,
    windowHeightRatio: 0.66,
    frameDepth: 0.05,
    sillProjection: 0,
    lintels: false,
    cornice: 'band',
    corniceDepth: 0.5,
    corniceHeight: 0.6,
    bandCapDepth: 0.5,
    bandCapHeight: 0.45,
    fireEscapes: false,
    fireEscapeBays: 0,
    neonTrim: true,
    mirroredBands: true,
    mediaFacade: false,
    planterBands: false,
    concreteGrid: false,
    mullions: true,
    spandrels: true,
    briseSoleil: false,
    pilasters: false,
  },
  roof: {
    waterTowers: 0,
    chimneys: 0,
    pigeonCoops: 0,
    acUnits: 3,
    vents: 2,
    satelliteDishes: 3,
    ductRuns: 2,
    crates: 2,
    bulkhead: true,
    parapet: 'mirror',
    parapetHeight: 0.7,
    neonRoofSign: true,
    antennaMast: true,
    mechanicalFloor: true,
    solarPanels: 0,
    windTurbines: 0,
    planters: 0,
    trees: 0,
    mediaCrown: false,
  },
  notes: 'Faceted mirrored curtain walls, stepped massing, mirrored spandrels, dish-dotted roofs.',
};

/** 2005 — disciplined glass-and-steel offices over mixed-use podiums. */
const RECIPE_GLASS_OFFICE: BuildingRecipe = {
  era: '2005',
  massing: 'glassOffice',
  style: 'sleek glass-and-steel office towers over precast mixed-use podiums',
  storeysMin: 8,
  storeysMax: 20,
  floorHeight: 3.6,
  depth: 13,
  depthJitter: 0.5,
  facadeSurface: 'glassCurtainWall',
  trimSurface: 'corrugatedMetal',
  glassSurface: 'glassCurtainWall',
  metalSurface: 'corrugatedMetal',
  roofSurface: 'asphalt',
  accentSurface: 'neon',
  foliage: false,
  facadeRoughness: 0.14,
  glassRoughness: 0.06,
  facadeWear: 0.2,
  glassMix: 0.58,
  repeatScale: 1.35,
  facade: {
    windowStyle: 'curtainWall',
    windowWidth: 1.7,
    baySpacing: 1.9,
    windowHeightRatio: 0.72,
    frameDepth: 0.04,
    sillProjection: 0,
    lintels: false,
    cornice: 'cap',
    corniceDepth: 0.34,
    corniceHeight: 0.34,
    bandCapDepth: 0.7,
    bandCapHeight: 0.52,
    fireEscapes: false,
    fireEscapeBays: 0,
    neonTrim: false,
    mirroredBands: false,
    mediaFacade: false,
    planterBands: false,
    concreteGrid: false,
    mullions: true,
    spandrels: true,
    briseSoleil: false,
    pilasters: false,
  },
  roof: {
    waterTowers: 0,
    chimneys: 0,
    pigeonCoops: 0,
    acUnits: 4,
    vents: 3,
    satelliteDishes: 1,
    ductRuns: 2,
    crates: 1,
    bulkhead: true,
    parapet: 'cap',
    parapetHeight: 0.6,
    neonRoofSign: false,
    antennaMast: true,
    mechanicalFloor: true,
    solarPanels: 2,
    windTurbines: 0,
    planters: 0,
    trees: 0,
    mediaCrown: false,
  },
  notes: 'Regular curtain-wall grids, horizontal spandrel bands, glass canopy line over the band.',
};

/** 2025 — mass-timber parametric towers with planting and media facades. */
const RECIPE_PARAMETRIC_GREEN: BuildingRecipe = {
  era: '2025',
  massing: 'parametricGreen',
  style: 'parametric mass-timber towers with planted terraces, solar arrays and media facades',
  storeysMin: 10,
  storeysMax: 26,
  floorHeight: 3.9,
  depth: 12.5,
  depthJitter: 0.5,
  facadeSurface: 'stucco',
  trimSurface: 'corrugatedMetal',
  glassSurface: 'glassCurtainWall',
  metalSurface: 'corrugatedMetal',
  roofSurface: 'cobble',
  accentSurface: 'neon',
  foliage: true,
  facadeRoughness: 0.45,
  glassRoughness: 0.08,
  facadeWear: 0.12,
  glassMix: 0.56,
  repeatScale: 1.2,
  facade: {
    windowStyle: 'parametric',
    windowWidth: 1.9,
    baySpacing: 2.2,
    windowHeightRatio: 0.66,
    frameDepth: 0.06,
    sillProjection: 0.12,
    lintels: false,
    cornice: 'green',
    corniceDepth: 0.55,
    corniceHeight: 0.9,
    bandCapDepth: 0.45,
    bandCapHeight: 0.4,
    fireEscapes: false,
    fireEscapeBays: 0,
    neonTrim: true,
    mirroredBands: false,
    mediaFacade: true,
    planterBands: true,
    concreteGrid: false,
    mullions: true,
    spandrels: false,
    briseSoleil: true,
    pilasters: false,
  },
  roof: {
    waterTowers: 0,
    chimneys: 0,
    pigeonCoops: 0,
    acUnits: 2,
    vents: 2,
    satelliteDishes: 0,
    ductRuns: 1,
    crates: 1,
    bulkhead: true,
    parapet: 'green',
    parapetHeight: 0.9,
    neonRoofSign: false,
    antennaMast: false,
    mechanicalFloor: false,
    solarPanels: 8,
    windTurbines: 2,
    planters: 6,
    trees: 3,
    mediaCrown: true,
  },
  notes: 'Shifting rotated floor plates, deep planted reveals, LED media bands and green terraces.',
};

/** Every authored archetype, in chronological order. */
export const BUILDING_RECIPES: readonly BuildingRecipe[] = Object.freeze([
  RECIPE_WALKUP,
  RECIPE_MIDCENTURY,
  RECIPE_BRUTALIST,
  RECIPE_MIRROR_TOWER,
  RECIPE_GLASS_OFFICE,
  RECIPE_PARAMETRIC_GREEN,
]);

/**
 * Which archetypes each era draws from. 1985 deliberately mixes the two: some
 * lots are heavy brutalist slabs, others stepped mirrored towers, which is what
 * the era descriptor's architecture note describes.
 */
export const ERA_BUILDING_MASSINGS: Readonly<Record<EraId, readonly BuildingMassing[]>> =
  Object.freeze({
    '1945': Object.freeze(['walkup'] as const),
    '1965': Object.freeze(['midcentury'] as const),
    '1985': Object.freeze(['brutalist', 'mirrorTower'] as const),
    '2005': Object.freeze(['glassOffice'] as const),
    '2025': Object.freeze(['parametricGreen'] as const),
  });

/** Recipe of one archetype. */
export function getRecipe(massing: BuildingMassing): BuildingRecipe {
  const recipe = BUILDING_RECIPES.find((candidate) => candidate.massing === massing);
  if (!recipe) throw new RangeError(`Unknown building massing "${String(massing)}".`);
  return recipe;
}

/** Every archetype an era draws from. */
export function getEraRecipes(era: EraId): readonly BuildingRecipe[] {
  const massings = ERA_BUILDING_MASSINGS[era];
  if (!massings) throw new RangeError(`Unknown era "${String(era)}".`);
  return massings.map(getRecipe);
}

/** The era's primary archetype (the first it draws from). */
export function getEraRecipe(era: EraId): BuildingRecipe {
  return getEraRecipes(era)[0]!;
}

/* ------------------------------------------------------------------------- *
 * Plans — one lot's massing for one era
 * ------------------------------------------------------------------------- */

/** One stacked mass of a building: a podium, a shaft, a crown or a wing. */
export interface BuildingMassBlock {
  /** Size along the frontage, in metres. */
  readonly width: number;
  readonly height: number;
  /** Height of the block's base above ground, in metres. */
  readonly baseY: number;
  readonly depth: number;
  /** Distance from the street line back to this block's front face, in metres. */
  readonly frontOffset: number;
  /** Centre inside the frontage, in metres (`+` towards the lot's local `+X`). */
  readonly centerX: number;
  /** Twist about the block's own centre, in radians (the parametric look). */
  readonly yaw: number;
}

/** One lot's building for one era: massing plus the recipe that dresses it. */
export interface BuildingPlan {
  /** Stable id: `<lotId>@<era>`. */
  readonly id: string;
  readonly lot: LotDefinition;
  readonly era: EraId;
  readonly recipe: BuildingRecipe;
  readonly storeys: number;
  readonly floorHeight: number;
  /** Storey-derived height above ground, in metres. */
  readonly height: number;
  /**
   * Highest mass top, in metres — the silhouette the era tween actually morphs.
   * A few massings (walk-up turrets, brutalist stair towers) deliberately rise
   * above the storey height, so this is the value the envelope interpolates.
   */
  readonly skyline: number;
  /** Lot depth this era builds to, in metres. */
  readonly depth: number;
  readonly masses: readonly BuildingMassBlock[];
  /** Seed of the deterministic stream this plan was drawn from. */
  readonly seed: number;
}

/** Smallest street-wall height a recipe may author, so the band is always walled. */
const MIN_STREET_WALL_HEIGHT = 5.4;

interface MassingContext {
  readonly lot: LotDefinition;
  readonly height: number;
  readonly depth: number;
  readonly floorHeight: number;
  readonly storeys: number;
  readonly random: RandomSource;
}

function authorWalkerMasses(context: MassingContext): BuildingMassBlock[] {
  const { lot, height, depth, random } = context;
  const frontage = lot.frontWidth;
  const wingHeight = Math.max(MIN_STREET_WALL_HEIGHT, height * random.float(0.62, 0.76));
  return [
    // The street wall: full frontage, two thirds of the lot depth, full height.
    {
      width: frontage,
      height: Math.max(MIN_STREET_WALL_HEIGHT, height),
      baseY: 0,
      depth: depth * 0.68,
      frontOffset: 0,
      centerX: 0,
      yaw: 0,
    },
    // Rear service wing, a storey or two lower than the street wall.
    {
      width: frontage * 0.72,
      height: wingHeight,
      baseY: 0,
      depth: depth * 0.32,
      frontOffset: depth * 0.68,
      centerX: -frontage * 0.08,
      yaw: 0,
    },
    // Projecting hoist / stair turret, proud of the brick face and through the
    // roof line — the silhouette every 1945 walk-up has.
    {
      width: Math.min(3.2, frontage * 0.28),
      height: height + random.float(1.1, 1.9),
      baseY: 0,
      depth: depth * 0.34,
      frontOffset: -0.28,
      centerX: frontage * 0.3,
      yaw: 0,
    },
  ];
}

function authorMidcenturyMasses(context: MassingContext): BuildingMassBlock[] {
  const { lot, height, depth, random } = context;
  const frontage = lot.frontWidth;
  const podium = Math.max(MIN_STREET_WALL_HEIGHT, height * 0.3);
  const plant = Math.max(2.4, height * 0.08);
  return [
    { width: frontage, height: podium, baseY: 0, depth, frontOffset: 0, centerX: 0, yaw: 0 },
    {
      width: frontage * random.float(0.88, 0.95),
      height: height - podium - plant,
      baseY: podium,
      depth: depth * 0.74,
      frontOffset: depth * 0.13,
      centerX: 0,
      yaw: 0,
    },
    {
      width: frontage * 0.34,
      height: plant,
      baseY: height - plant,
      depth: depth * 0.42,
      frontOffset: depth * 0.34,
      centerX: frontage * 0.24,
      yaw: 0,
    },
  ];
}

function authorBrutalistMasses(context: MassingContext): BuildingMassBlock[] {
  const { lot, height, depth, random } = context;
  const frontage = lot.frontWidth;
  const towerWidth = Math.min(4.2, frontage * 0.34);
  const side = random.bool(0.5) ? -1 : 1;
  return [
    { width: frontage, height, baseY: 0, depth, frontOffset: 0, centerX: 0, yaw: 0 },
    // Expressed stair tower, proud of the slab on the street.
    {
      width: towerWidth,
      height: height + random.float(0.8, 1.6),
      baseY: 0,
      depth: depth * random.float(0.34, 0.46),
      frontOffset: -0.32,
      centerX: side * (frontage / 2 - towerWidth / 2),
      yaw: 0,
    },
  ];
}

function authorMirrorTowerMasses(context: MassingContext): BuildingMassBlock[] {
  const { lot, height, depth, random } = context;
  const frontage = lot.frontWidth;
  const podium = Math.max(MIN_STREET_WALL_HEIGHT, height * 0.22);
  const crownHeight = Math.max(2.6, height * 0.1);
  const shaftSpan = Math.max(3, height - podium - crownHeight);
  const shaftOne = shaftSpan * random.float(0.58, 0.72);
  const shaftTwo = shaftSpan - shaftOne;
  return [
    { width: frontage, height: podium, baseY: 0, depth, frontOffset: 0, centerX: 0, yaw: 0 },
    {
      width: frontage * 0.9,
      height: shaftOne,
      baseY: podium,
      depth: depth * 0.8,
      frontOffset: depth * 0.1,
      centerX: 0,
      yaw: 0,
    },
    {
      width: frontage * 0.72,
      height: shaftTwo,
      baseY: podium + shaftOne,
      depth: depth * 0.62,
      frontOffset: depth * 0.19,
      centerX: 0,
      yaw: random.float(-0.04, 0.04),
    },
    {
      width: frontage * 0.5,
      height: crownHeight,
      baseY: height - crownHeight,
      depth: depth * 0.44,
      frontOffset: depth * 0.28,
      centerX: 0,
      yaw: 0,
    },
  ];
}

function authorGlassOfficeMasses(context: MassingContext): BuildingMassBlock[] {
  const { lot, height, depth, random } = context;
  const frontage = lot.frontWidth;
  const podium = Math.max(MIN_STREET_WALL_HEIGHT, height * 0.16);
  const crown = Math.max(2.8, height * 0.14);
  return [
    { width: frontage, height: podium, baseY: 0, depth, frontOffset: 0, centerX: 0, yaw: 0 },
    {
      width: frontage * random.float(0.9, 0.96),
      height: height - podium - crown,
      baseY: podium,
      depth: depth * 0.86,
      frontOffset: depth * 0.07,
      centerX: 0,
      yaw: 0,
    },
    {
      width: frontage * 0.62,
      height: crown,
      baseY: height - crown,
      depth: depth * 0.6,
      frontOffset: depth * 0.2,
      centerX: 0,
      yaw: 0,
    },
  ];
}

function authorParametricGreenMasses(context: MassingContext): BuildingMassBlock[] {
  const { lot, height, depth, random } = context;
  const frontage = lot.frontWidth;
  const base = Math.max(MIN_STREET_WALL_HEIGHT, height * 0.2);
  const remaining = Math.max(6, height - base);
  const crownHeight = Math.max(2.8, remaining * 0.12);
  const band = (remaining - crownHeight) / 3;
  const twist = random.float(0.06, 0.13);
  const rotation = random.float(-0.35, 0.35);
  return [
    { width: frontage, height: base, baseY: 0, depth, frontOffset: 0, centerX: 0, yaw: 0 },
    // Three rotated floor bands: the parametric twist above the podium.
    {
      width: frontage * 0.95,
      height: band,
      baseY: base,
      depth: depth * 0.9,
      frontOffset: depth * 0.05,
      centerX: 0,
      yaw: rotation,
    },
    {
      width: frontage * 0.85,
      height: band,
      baseY: base + band,
      depth: depth * 0.82,
      frontOffset: depth * 0.1,
      centerX: 0,
      yaw: rotation + twist,
    },
    {
      width: frontage * 0.72,
      height: band,
      baseY: base + band * 2,
      depth: depth * 0.72,
      frontOffset: depth * 0.15,
      centerX: 0,
      yaw: rotation + twist * 2,
    },
    {
      width: frontage * 0.52,
      height: crownHeight,
      baseY: height - crownHeight,
      depth: depth * 0.5,
      frontOffset: depth * 0.28,
      centerX: 0,
      yaw: rotation + twist * 3,
    },
  ];
}

function authorMasses(massing: BuildingMassing, context: MassingContext): BuildingMassBlock[] {
  switch (massing) {
    case 'walkup':
      return authorWalkerMasses(context);
    case 'midcentury':
      return authorMidcenturyMasses(context);
    case 'brutalist':
      return authorBrutalistMasses(context);
    case 'mirrorTower':
      return authorMirrorTowerMasses(context);
    case 'glassOffice':
      return authorGlassOfficeMasses(context);
    default:
      return authorParametricGreenMasses(context);
  }
}

/**
 * Draws one lot's plan for one era from a deterministic stream.
 *
 * The stream is forked from the caller's source by `<lotId>:<era>`, so the plan
 * is stable no matter which era was planned first, and reruns of the same seed
 * rebuild byte-identical geometry.
 */
export function planBuilding(lot: LotDefinition, era: EraId, random: RandomSource): BuildingPlan {
  const recipes = getEraRecipes(era);
  const recipe = recipes[lot.index % recipes.length]!;
  const stream = random.fork(`${lot.id}:${era}`);
  const storeys = stream.int(recipe.storeysMin, recipe.storeysMax);
  const floorHeight = recipe.floorHeight;
  const height = storeys * floorHeight;
  const depth = Math.max(6, recipe.depth + stream.float(-recipe.depthJitter, recipe.depthJitter));
  const masses = authorMasses(recipe.massing, {
    lot,
    height,
    depth,
    floorHeight,
    storeys,
    random: stream,
  });
  const skyline = masses.reduce((top, block) => Math.max(top, block.baseY + block.height), 0);

  return Object.freeze({
    id: `${lot.id}@${era}`,
    lot,
    era,
    recipe,
    storeys,
    floorHeight,
    height,
    skyline,
    depth,
    masses: Object.freeze(masses),
    seed: stream.seed,
  });
}

/** Plans every lot for one era. */
export function planBuildings(
  era: EraId,
  random: RandomSource,
  lots: readonly LotDefinition[] = LOT_LAYOUT,
): readonly BuildingPlan[] {
  return Object.freeze(lots.map((lot) => planBuilding(lot, era, random)));
}

/** Highest point of a plan, in metres — the block's skyline for that lot. */
export function planSkyline(plan: BuildingPlan): number {
  return plan.masses.reduce((top, block) => Math.max(top, block.baseY + block.height), 0);
}

/**
 * The street-wall block of a plan: the flush mass that carries the street
 * elevation and the storefront band. Projecting bays and stair turrets sit
 * *proud* of the street line (`frontOffset < 0`) and are deliberately ignored,
 * so the band, the fire escapes and the neon line land on the real wall.
 */
export function streetWallBlock(plan: BuildingPlan): BuildingMassBlock {
  const flush = plan.masses.filter((block) => block.frontOffset >= -0.05);
  const pool = flush.length > 0 ? flush : plan.masses;
  return pool.reduce((closest, block) =>
    block.frontOffset < closest.frontOffset ? block : closest,
  );
}

/* ------------------------------------------------------------------------- *
 * Materials
 * ------------------------------------------------------------------------- */

/** Material roles a recipe dresses its geometry with. */
export type BuildingMaterialKey =
  | 'facade'
  | 'trim'
  | 'glass'
  | 'metal'
  | 'roof'
  | 'accent'
  | 'foliage';

/** Every material role, in resolution order. */
export const BUILDING_MATERIAL_KEYS: readonly BuildingMaterialKey[] = Object.freeze([
  'facade',
  'trim',
  'glass',
  'metal',
  'roof',
  'accent',
  'foliage',
]);

/** The material set one era resolves through the shared `MaterialLibrary`. */
export interface BuildingMaterialSet {
  readonly era: EraId;
  readonly recipe: BuildingRecipe;
  /** `MaterialLibrary` cache keys of every material in the set. */
  readonly keys: readonly string[];
  /** Every material instance the set holds. */
  readonly list: readonly THREE.MeshStandardMaterial[];
  has(key: BuildingMaterialKey): boolean;
  get(key: BuildingMaterialKey): THREE.MeshStandardMaterial;
}

function hexOf(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

function surfaceRequest(
  recipe: BuildingRecipe,
  descriptor: EraTimelineDescriptor,
  key: BuildingMaterialKey,
): MaterialRequest {
  const palette = descriptor.palette;
  const primary = hexOf(palette.buildingPrimary);
  const secondary = hexOf(palette.buildingSecondary);
  const sky = hexOf(palette.skyHorizon);
  const ground = hexOf(palette.ground);
  const emissive = hexOf(palette.emissive);
  const accent = hexOf(palette.accents[0] ?? palette.buildingSecondary);
  const surface =
    key === 'facade'
      ? recipe.facadeSurface
      : key === 'trim'
        ? recipe.trimSurface
        : key === 'glass'
          ? recipe.glassSurface
          : key === 'metal'
            ? recipe.metalSurface
            : key === 'roof'
              ? recipe.roofSurface
              : key === 'accent'
                ? recipe.accentSurface
                : 'stucco';
  const defaults = SURFACE_MATERIAL_DEFAULTS[surface];
  // Non-facade roles are tuned by the era's *primary* recipe, so an era that
  // draws from two archetypes (1985: brutalist slab and mirrored tower) still
  // shares one trim/glass/metal/roof/accent material across both — which is what
  // keeps every era inside `MAX_UNIQUE_MATERIALS_PER_ERA`.
  const eraRecipe = key === 'facade' ? recipe : getEraRecipe(recipe.era);
  const facadeRoughness = eraRecipe.facadeRoughness;
  const facadeWear = eraRecipe.facadeWear;
  const glassRoughness = eraRecipe.glassRoughness;
  const repeat: readonly [number, number] = [
    defaults.repeat[0] * eraRecipe.repeatScale,
    defaults.repeat[1] * eraRecipe.repeatScale,
  ];
  const name = `chrono-buildings-${recipe.era}-${key}`;
  const base: MaterialRequest = {
    surface,
    palette: {
      base: primary,
      accent: secondary,
      joint: mixHex(ground, primary, 0.35),
      grime: mixHex(ground, primary, 0.2),
      highlight: mixHex(secondary, '#ffffff', 0.25),
      emissive,
    },
    repeat,
    // Everything is requested transparent so the era crossfade can drive
    // `opacity` without a shader rebuild mid-tween.
    transparent: true,
    name,
  };

  switch (key) {
    case 'facade':
      return {
        ...base,
        palette: {
          ...base.palette,
          joint: mixHex(ground, primary, 0.45),
          grime: mixHex(ground, primary, 0.15),
        },
        roughness: recipe.facadeRoughness,
        wear: recipe.facadeWear,
        size: 512,
      };
    case 'trim':
      return {
        ...base,
        palette: {
          ...base.palette,
          base: secondary,
          accent: mixHex(secondary, primary, 0.4),
        },
        roughness: Math.min(0.95, facadeRoughness + 0.05),
        metalness: 0.22,
        wear: facadeWear * 0.7,
        size: 256,
      };
    case 'glass':
      return {
        ...base,
        palette: {
          ...base.palette,
          base: mixHex(primary, sky, eraRecipe.glassMix),
          accent: sky,
          joint: mixHex(primary, ground, 0.35),
          grime: mixHex(ground, primary, 0.4),
          emissive: mixHex(emissive, sky, 0.5),
        },
        roughness: glassRoughness,
        metalness: 0.42,
        emissive: eraRecipe.era === '1945' ? 0.35 : 0.6,
        wear: facadeWear * 0.35,
        repeat: [repeat[0] * 2, repeat[1] * 2],
        size: 512,
      };
    case 'metal':
      return {
        ...base,
        palette: {
          ...base.palette,
          base: mixHex(secondary, ground, 0.35),
          accent,
        },
        metalness: 0.85,
        wear: facadeWear,
        size: 256,
      };
    case 'roof':
      return {
        ...base,
        palette: {
          ...base.palette,
          base: mixHex(ground, primary, 0.28),
          accent: mixHex(ground, primary, 0.05),
        },
        roughness: 0.96,
        wear: Math.min(1, facadeWear + 0.2),
        size: 512,
      };
    case 'accent':
      return {
        ...base,
        palette: { ...base.palette, base: emissive, accent, emissive },
        size: 256,
      };
    default:
      return {
        ...base,
        palette: {
          ...base.palette,
          base: '#3f6b3a',
          accent: '#6f9b52',
          joint: '#26331f',
          grime: '#2a3a26',
          highlight: '#8fbf6a',
          emissive: '#bfe8a0',
        },
        roughness: 0.86,
        emissive: 0.2,
        repeat: [1.5, 1.5],
        size: 256,
      };
  }
}

class ResolvedMaterialSet implements BuildingMaterialSet {
  readonly era: EraId;
  readonly recipe: BuildingRecipe;
  readonly keys: readonly string[];
  readonly list: readonly THREE.MeshStandardMaterial[];

  private readonly materials = new Map<BuildingMaterialKey, THREE.MeshStandardMaterial>();

  constructor(recipe: BuildingRecipe, materials: Map<BuildingMaterialKey, THREE.MeshStandardMaterial>) {
    this.era = recipe.era;
    this.recipe = recipe;
    for (const [key, material] of materials) this.materials.set(key, material);
    this.keys = Object.freeze([...materials.values()].map((material) => String(material.userData.chronoKey)));
    this.list = Object.freeze([...materials.values()]);
  }

  has(key: BuildingMaterialKey): boolean {
    return this.materials.has(key);
  }

  get(key: BuildingMaterialKey): THREE.MeshStandardMaterial {
    const material = this.materials.get(key);
    if (!material) {
      throw new RangeError(
        `Era ${this.era} recipe "${this.recipe.massing}" has no "${key}" material.`,
      );
    }
    return material;
  }
}

/**
 * Resolves — and caches through the library — every material one recipe draws
 * with. Identical recipes in the same era share the returned instances, so an
 * era's whole building set uploads a handful of textures, not one per building.
 */
export function createBuildingMaterialSet(
  library: MaterialLibrary,
  recipe: BuildingRecipe,
): BuildingMaterialSet {
  const descriptor = getEraDescriptor(recipe.era);
  const materials = new Map<BuildingMaterialKey, THREE.MeshStandardMaterial>();
  for (const key of BUILDING_MATERIAL_KEYS) {
    if (key === 'foliage' && !recipe.foliage) continue;
    materials.set(key, library.get(surfaceRequest(recipe, descriptor, key)));
  }
  return new ResolvedMaterialSet(recipe, materials);
}

/* ------------------------------------------------------------------------- *
 * Instancing primitives
 * ------------------------------------------------------------------------- */

/** The shared primitive shapes every detail instance is scaled from. */
export type UnitGeometryKind = 'box' | 'cylinder' | 'cone' | 'sphere';

/** Primitive kinds, in the order they are documented. */
export const UNIT_GEOMETRY_KINDS: readonly UnitGeometryKind[] = Object.freeze([
  'box',
  'cylinder',
  'cone',
  'sphere',
]);

/** Where a mesh sits in the building's story: wall, ornament or roof clutter. */
export type BuildingRole = 'mass' | 'mount-surface' | 'facade-detail' | 'rooftop';

/**
 * The handful of unit geometries the whole block is built from: one 1 m box, a
 * 1 × 1 cylinder, a 1 × 1 cone and a 1 m sphere. Every detail instance is one of
 * these scaled, so the GPU sees four geometries no matter how many ornaments a
 * facade carries.
 */
export class DetailGeometrySet {
  private readonly cache = new Map<UnitGeometryKind, THREE.BufferGeometry>();

  get(kind: UnitGeometryKind): THREE.BufferGeometry {
    const cached = this.cache.get(kind);
    if (cached) return cached;
    const geometry =
      kind === 'box'
        ? new THREE.BoxGeometry(1, 1, 1)
        : kind === 'cylinder'
          ? new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, false)
          : kind === 'cone'
            ? new THREE.ConeGeometry(0.5, 1, 12, 1, false)
            : new THREE.SphereGeometry(0.5, 10, 8);
    geometry.name = `chrono-building-${kind}`;
    this.cache.set(kind, geometry);
    return geometry;
  }

  /** How many distinct geometries have been materialised. */
  get size(): number {
    return this.cache.size;
  }

  get kinds(): readonly UnitGeometryKind[] {
    return Object.freeze([...this.cache.keys()]);
  }

  /** Releases every shared geometry. The set stays usable afterwards. */
  dispose(): void {
    for (const geometry of this.cache.values()) geometry.dispose();
    this.cache.clear();
  }
}

/** One queued primitive instance. Position and scale are in the variant's frame. */
export interface DetailInstanceSpec {
  readonly geometry: UnitGeometryKind;
  readonly material: THREE.Material;
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  /** Rotation about `+Y`, in radians. */
  readonly yaw?: number;
  /** Rotation about `+X`, in radians (dishes, lids, ladder rails). */
  readonly pitch?: number;
  /** Rotation about `+Z`, in radians. */
  readonly roll?: number;
}

interface DetailBatch {
  readonly geometry: UnitGeometryKind;
  readonly material: THREE.Material;
  readonly specs: DetailInstanceSpec[];
}

const IDENTITY_ROTATION: DetailRotation = Object.freeze({});

/** Optional per-instance rotation handed to the batcher's convenience helpers. */
export interface DetailRotation {
  readonly yaw?: number;
  readonly pitch?: number;
  readonly roll?: number;
}

/**
 * Collects primitive instances, then flushes them into one `InstancedMesh` per
 * `(shape, material)` pair. Facade and rooftop builders queue hundreds of
 * windows, sills, tanks and dishes through one of these and pay a handful of
 * draw calls for the lot.
 */
export class DetailBatcher {
  /** Role written into every flushed mesh's `userData.chronoBuildingRole`. */
  readonly role: BuildingRole;

  private readonly parent: THREE.Object3D;
  private readonly geometrySet: DetailGeometrySet;
  private readonly batches = new Map<string, DetailBatch>();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private flushedInstances = 0;

  constructor(
    parent: THREE.Object3D,
    geometrySet: DetailGeometrySet,
    role: BuildingRole = 'facade-detail',
  ) {
    this.parent = parent;
    this.geometrySet = geometrySet;
    this.role = role;
  }

  /** Queues one instance of a primitive. */
  add(spec: DetailInstanceSpec): void {
    const key = `${spec.geometry}|${spec.material.uuid}`;
    const existing = this.batches.get(key);
    if (existing) {
      existing.specs.push(spec);
      return;
    }
    this.batches.set(key, {
      geometry: spec.geometry,
      material: spec.material,
      specs: [spec],
    });
  }

  /** Queues a box of `width × height × depth` centred on `(x, y, z)`. */
  box(
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    rotation: DetailRotation = IDENTITY_ROTATION,
  ): void {
    this.add({
      geometry: 'box',
      material,
      position: [x, y, z],
      scale: [width, height, depth],
      yaw: rotation.yaw,
      pitch: rotation.pitch,
      roll: rotation.roll,
    });
  }

  /** Queues a cylinder of `diameter × height` centred on `(x, y, z)`. */
  cylinder(
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    diameter: number,
    height: number,
    rotation: DetailRotation = IDENTITY_ROTATION,
  ): void {
    this.add({
      geometry: 'cylinder',
      material,
      position: [x, y, z],
      scale: [diameter, height, diameter],
      yaw: rotation.yaw,
      pitch: rotation.pitch,
      roll: rotation.roll,
    });
  }

  /** Queues a cone of `diameter × height` centred on `(x, y, z)`. */
  cone(
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    diameter: number,
    height: number,
    rotation: DetailRotation = IDENTITY_ROTATION,
  ): void {
    this.add({
      geometry: 'cone',
      material,
      position: [x, y, z],
      scale: [diameter, height, diameter],
      yaw: rotation.yaw,
      pitch: rotation.pitch,
      roll: rotation.roll,
    });
  }

  /** Queues a sphere of `diameter` centred on `(x, y, z)`. */
  sphere(material: THREE.Material, x: number, y: number, z: number, diameter: number): void {
    this.add({
      geometry: 'sphere',
      material,
      position: [x, y, z],
      scale: [diameter, diameter, diameter],
    });
  }

  /** Instances waiting to be flushed. */
  get queuedCount(): number {
    let queued = 0;
    for (const batch of this.batches.values()) queued += batch.specs.length;
    return queued;
  }

  /** Instances already flushed into instanced meshes. */
  get instanceCount(): number {
    return this.flushedInstances;
  }

  /** Flushed instanced meshes, newest last. */
  get flushedMeshes(): readonly THREE.InstancedMesh[] {
    return this.meshes;
  }

  /**
   * Creates one `InstancedMesh` per queued `(shape, material)` pair and returns
   * the number of instances handed to the GPU.
   */
  flush(): number {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    let flushed = 0;

    for (const batch of this.batches.values()) {
      if (batch.specs.length === 0) continue;
      const mesh = new THREE.InstancedMesh(
        this.geometrySet.get(batch.geometry),
        batch.material,
        batch.specs.length,
      );
      batch.specs.forEach((spec, index) => {
        euler.set(spec.pitch ?? 0, spec.yaw ?? 0, spec.roll ?? 0, 'YXZ');
        quaternion.setFromEuler(euler);
        position.set(spec.position[0], spec.position[1], spec.position[2]);
        scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = `${this.parent.name}:${this.role}:${batch.geometry}`;
      mesh.userData.chronoBuildingRole = this.role;
      mesh.userData.chronoBuildingShape = batch.geometry;
      // The flat band panel never needs to cast; everything else does.
      mesh.castShadow = this.role !== 'mount-surface';
      mesh.receiveShadow = true;
      // The bounding sphere covers every instance, so culling stays correct.
      mesh.computeBoundingSphere();
      this.parent.add(mesh);
      this.meshes.push(mesh);
      flushed += batch.specs.length;
    }

    this.batches.clear();
    this.flushedInstances += flushed;
    return flushed;
  }
}
