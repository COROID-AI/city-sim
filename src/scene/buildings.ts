/**
 * Chrono City era-morphing building system.
 *
 * One procedural building per layout lot, rebuilt for whichever era the
 * timeline selects and morphed continuously while a transition runs. The
 * architecture is entirely generated from the era contract (`./../era/eraTypes`)
 * and the lot geometry from the layout contract (`./layout`): no external model
 * or image assets, no baked per-era meshes.
 *
 * Lifecycle (owned by `scene-assembly`):
 *
 * - `createBuildingsSystem()` builds the root group, populated for the initial
 *   era; mount `system.group` into the block.
 * - pump `system.update(context)` from the shared fixed-step loop; the system
 *   drives itself from `context.era` / `context.from` / `context.blend`, or the
 *   driver can call `system.applyEra(era, blend)` directly.
 * - `system.getPickables()` returns the meshes of the visible generation(s).
 * - `system.dispose()` releases every geometry, material and cached texture.
 *
 * Advertising hosting: this task owns the rooftop signs and the media-facade
 * panels mounted on the buildings, so the advertising system can stay anchored
 * to layout slots. Those structures animate only through cheap UV offset and
 * emissive-intensity loops (`update`), never by repainting a texture. The
 * rooftop mounting anchors they are hung from are internal metadata generated
 * alongside the geometry - reported by `describe()` for inspection, but not an
 * integration surface for other systems.
 *
 * `applyEra(era, blend)` is the {@link EraAware} contract: `blend` runs from the
 * previously displayed era (`0`) to `era` (`1`). Every lot stays populated at
 * both ends, and the outgoing generation is disposed as soon as a transition
 * completes, so only the visible architecture is resident.
 */

import * as THREE from "three";

import {
  ERAS,
  clampBlend,
  getEraConfig,
  resolveEraWeights,
  type AdMedium,
  type BuildingDescriptor,
  type EraConfig,
  type EraId,
  type EraSceneSystem,
  type EraUpdateContext,
} from "../era/eraTypes";

import { CITY_LAYOUT, type BuildingLot, type CardinalSide, type CityLayout } from "./layout";

import {
  PART_MATERIAL_KEYS,
  advertisingStructuresFor,
  buildCornices,
  buildFireEscapes,
  buildMassing,
  buildMediaFacade,
  buildRoofEquipmentGroup,
  buildRooftopSign,
  buildStorefrontBays,
  buildWindowGrid,
  clamp,
  countTriangles,
  createEraMaterialSet,
  createEraTextures,
  disposeEraTextures,
  glazingRecipeFor,
  hasFireEscape,
  hashUnit,
  materialForRole,
  mergeParts,
  roofEquipmentKindsFor,
  triangleCount,
  type EraMaterialSet,
  type PartDescriptor,
  type RooftopSignStructure,
  type SignageAnchor,
  type TextureOptions,
} from "./buildingDetails";

/* -------------------------------------------------------------------------- */
/* Public shapes                                                              */
/* -------------------------------------------------------------------------- */

/** Stable system id used for pick attribution and debug overlays. */
export const BUILDINGS_SYSTEM_ID = "buildings";
/** Name of the root group every building generation is parented under. */
export const BUILDINGS_GROUP_NAME = "buildings";

/** Default seed; keeping it fixed makes the whole block deterministic. */
export const DEFAULT_BUILDINGS_SEED = 0x5eed_c17a;

/** Options accepted by {@link createBuildingsSystem}. */
export interface BuildingsSystemOptions {
  /** Layout to populate; defaults to the canonical {@link CITY_LAYOUT}. */
  readonly layout?: CityLayout;
  /** Era the block starts in; defaults to the first timeline stop (1945). */
  readonly initialEra?: EraId;
  /** Deterministic variation seed; defaults to {@link DEFAULT_BUILDINGS_SEED}. */
  readonly seed?: number;
  /** Canvas factory override, used by tests without a 2D context. */
  readonly textureOptions?: TextureOptions;
}

/** Ground placement of one building on its lot. */
export interface BuildingPlacement {
  readonly lotId: string;
  readonly streetSide: CardinalSide;
  readonly zone: BuildingLot["zone"];
  readonly center: { readonly x: number; readonly z: number };
  readonly footprint: { readonly width: number; readonly depth: number };
  /** Unit ground vector from the lot towards its street. */
  readonly facing: { readonly x: number; readonly z: number };
  /** Yaw (radians) aligning the building's +Z frontage with `facing`. */
  readonly yaw: number;
}

/**
 * Generated geometry parameters of one building.
 *
 * This is the inspection surface used by tests and the Picking/QA layers: it
 * describes the facade detail without requiring a GL context.
 */
export interface BuildingRecord {
  readonly id: string;
  readonly lotId: string;
  readonly eraId: EraId;
  readonly placement: BuildingPlacement;
  /** Storeys in the mass, stepped into the era's setback count. */
  readonly floors: number;
  readonly storeys: number;
  readonly setbackCount: number;
  readonly stepCount: number;
  /** Total wall height in metres. */
  readonly height: number;
  /** Number of window columns on the frontage facades. */
  readonly windowColumns: number;
  readonly windowRows: number;
  readonly windowPanes: number;
  readonly windowFrames: number;
  readonly windowSills: number;
  readonly windowLintels: number;
  readonly windowMullions: number;
  readonly windowBands: number;
  readonly windowPiers: number;
  readonly planters: number;
  readonly cornices: number;
  /** 0..1 era ornament density the cornice/bracket pass was built with. */
  readonly ornament: number;
  readonly storefrontBays: number;
  readonly entranceDoors: number;
  readonly awnings: number;
  readonly fireEscapes: number;
  readonly fireEscapePlatforms: number;
  readonly roofEquipment: readonly string[];
  readonly rooftopSign: RooftopSignStructure;
  readonly advertisingMedium: AdMedium | null;
  readonly mediaPanels: number;
  /** Internal mounting anchors of the signage this building hosts. */
  readonly signageAnchors: readonly SignageAnchor[];
  readonly triangles: number;
}

/** Whole-era facade detail census, used to compare era geometry budgets. */
export interface BuildingEraCensus {
  readonly eraId: EraId;
  readonly buildings: number;
  readonly lots: number;
  readonly triangles: number;
  readonly trianglesPerBuilding: number;
  readonly panes: number;
  readonly frames: number;
  readonly sills: number;
  readonly lintels: number;
  readonly mullions: number;
  readonly bands: number;
  readonly piers: number;
  readonly planters: number;
  readonly cornices: number;
  readonly storefrontBays: number;
  readonly entranceDoors: number;
  readonly fireEscapes: number;
  readonly fireEscapePlatforms: number;
  readonly mediaPanels: number;
  readonly signageAnchors: number;
  readonly maxHeight: number;
  readonly roofEquipmentKinds: readonly string[];
  readonly rooftopSigns: readonly RooftopSignStructure[];
}

/** The building system handed to scene assembly. */
export interface BuildingsSystem extends EraSceneSystem {
  readonly id: string;
  readonly group: THREE.Group;
  /** Era that is fully or partially displayed right now. */
  readonly era: EraId;
  /** Era the current transition is heading towards. */
  readonly targetEra: EraId;
  /** Era the current transition started from. */
  readonly sourceEra: EraId;
  /** Current blend in `[0, 1]`. */
  readonly blend: number;
  /** Era weights for the active transition, from `resolveEraWeights`. */
  eraWeights(): Readonly<Record<EraId, number>>;
  /** Every plan is deterministic, so this never changes for a given era. */
  describe(era?: EraId): readonly BuildingRecord[];
  census(era?: EraId): BuildingEraCensus;
  /** Meshes of the currently visible generation(s), in mount order. */
  visibleMeshes(): readonly THREE.Object3D[];
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

interface PlannedBuilding {
  readonly lot: BuildingLot;
  readonly record: BuildingRecord;
  readonly parts: readonly PartDescriptor[];
}

/** Frontage metres per storefront bay, matching the retail module. */
const FRONTAGE_PER_BAY = 3.2;
/** Fire-escape landings stop climbing after this many storeys. */
const MAX_ESCAPE_LANDINGS = 6;
/** Largest footprint share any era may claim, so lots never bleed together. */
const MAX_FOOTPRINT_FILL = 0.78;

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function facingYaw(lot: BuildingLot): number {
  return Math.atan2(lot.facing.x, lot.facing.z);
}

function placementFor(lot: BuildingLot, width: number, depth: number): BuildingPlacement {
  return {
    lotId: lot.id,
    streetSide: lot.streetSide,
    zone: lot.zone,
    center: { x: lot.center.x, z: lot.center.z },
    footprint: { width, depth },
    facing: { x: lot.facing.x, z: lot.facing.z },
    yaw: facingYaw(lot),
  };
}

/** Storeys for one lot: era range, seeded variation, block-edge height taper. */
function floorsFor(descriptor: BuildingDescriptor, eraId: EraId, lot: BuildingLot): number {
  const variation = hashUnit(`${eraId}:${lot.id}:floors`);
  const radius = Math.hypot(lot.center.x, lot.center.z);
  const edge = clamp01(radius / 40);
  const taper = 1 - descriptor.heightFalloff * edge;
  const span = descriptor.maxFloors - descriptor.minFloors;
  const floors = Math.round(descriptor.minFloors + span * variation * taper);
  return Math.max(1, Math.min(descriptor.maxFloors, floors));
}

/** Footprint of one building, clamped inside its lot with a safety margin. */
function footprintFor(descriptor: BuildingDescriptor, lot: BuildingLot): { readonly width: number; readonly depth: number } {
  const fill = Math.min(descriptor.footprintFill, MAX_FOOTPRINT_FILL);
  // Local +X spans the frontage, local +Z points at the street. On the
  // east/west lots those axes map onto the lot's depth/width respectively, so
  // the footprint has to be resolved against the facing rather than raw bounds.
  const vertical = Math.abs(lot.facing.x) > 0.5;
  const frontageExtent = vertical ? lot.footprint.depth : lot.footprint.width;
  const sideExtent = vertical ? lot.footprint.width : lot.footprint.depth;
  return {
    width: Math.max(1, frontageExtent * fill - 0.4),
    depth: Math.max(1, sideExtent * fill - 0.4),
  };
}

/**
 * Plans one era's building on one lot.
 *
 * Pure: the same `(lot, era, seed)` always yields the same parameters and the
 * same part list, which is what keeps morphing and tests deterministic.
 */
export function planBuilding(lot: BuildingLot, era: EraConfig, seed: number): PlannedBuilding {
  const descriptor = era.buildings;
  const glazing = glazingRecipeFor(descriptor);
  const structures = advertisingStructuresFor(era);
  const buildingSeed = Math.floor(hashUnit(`${era.id}:${lot.id}:seed`) * 0xffff) ^ seed;
  const { width, depth } = footprintFor(descriptor, lot);
  const floors = floorsFor(descriptor, era.id, lot);
  const halfStorey = descriptor.floorHeight / 2;
  const massing = buildMassing({
    width,
    depth,
    floors,
    floorHeight: descriptor.floorHeight,
    setbackCount: descriptor.setbacks,
    seed: buildingSeed,
  });

  const parts: PartDescriptor[] = [...massing.parts];

  const cornices = buildCornices({
    steps: massing.steps,
    ornament: descriptor.ornament,
    seed: buildingSeed,
  });
  parts.push(...cornices.parts);

  const columns = Math.max(2, descriptor.window.columns);
  const sideColumns = clamp(Math.round(columns * (depth / width)), 2, columns + 1);
  let panes = 0;
  let frames = 0;
  let sills = 0;
  let lintels = 0;
  let mullions = 0;
  let bands = 0;
  let piers = 0;
  let planters = 0;

  massing.steps.forEach((step) => {
    const grid = buildWindowGrid({
      recipe: glazing,
      width: step.width,
      depth: step.depth,
      columns,
      sideColumns,
      rows: step.rows * 2,
      yBottom: step.y0,
      rowHeight: halfStorey,
      includePiers: step.index === 0,
    });
    parts.push(...grid.parts);
    panes += grid.panes;
    frames += grid.frames;
    sills += grid.sills;
    lintels += grid.lintels;
    mullions += grid.mullions;
    bands += grid.bands;
    piers += grid.piers;
    planters += grid.planters;
  });

  const base = massing.steps[0]!;
  const bays = clamp(Math.round(lot.frontageWidth / FRONTAGE_PER_BAY), 1, 5);
  const storefront = buildStorefrontBays({
    width: base.width,
    depth: base.depth,
    floorHeight: descriptor.floorHeight,
    bays,
    ornament: descriptor.ornament,
    seed: buildingSeed,
  });
  parts.push(...storefront.parts);

  let fireEscapes = 0;
  let fireEscapePlatforms = 0;
  if (hasFireEscape(descriptor)) {
    const escapes = buildFireEscapes({
      width: base.width,
      depth: base.depth,
      rows: Math.min(base.rows * 2, MAX_ESCAPE_LANDINGS),
      yBottom: 0,
      rowHeight: halfStorey,
      seed: buildingSeed,
    });
    parts.push(...escapes.parts);
    fireEscapes = escapes.escapes;
    fireEscapePlatforms = escapes.platforms;
  }

  const roofDeckY = massing.height + 0.3;
  const roofEquipment = buildRoofEquipmentGroup({
    kinds: roofEquipmentKindsFor(descriptor),
    roofWidth: massing.topWidth,
    roofDepth: massing.topDepth,
    y: roofDeckY,
    seed: buildingSeed,
  });
  parts.push(...roofEquipment.parts);

  const rooftopSign = buildRooftopSign({
    structure: structures.signage,
    roofWidth: massing.topWidth,
    roofDepth: massing.topDepth,
    y: roofDeckY,
    seed: buildingSeed,
  });
  parts.push(...rooftopSign.parts);

  const media = buildMediaFacade({
    panels: structures.mediaPanels,
    width: base.width,
    depth: base.depth,
    rows: base.rows * 2,
    yBottom: 0,
    rowHeight: halfStorey,
    seed: buildingSeed,
  });
  parts.push(...media.parts);

  const signageAnchors: readonly SignageAnchor[] = [...rooftopSign.anchors, ...media.anchors];

  const record: BuildingRecord = {
    id: `${era.id}:${lot.id}`,
    lotId: lot.id,
    eraId: era.id,
    placement: placementFor(lot, width, depth),
    floors,
    storeys: floors * 2,
    setbackCount: descriptor.setbacks,
    stepCount: massing.steps.length,
    height: massing.height,
    windowColumns: columns,
    windowRows: floors * 2,
    windowPanes: panes,
    windowFrames: frames,
    windowSills: sills,
    windowLintels: lintels,
    windowMullions: mullions,
    windowBands: bands,
    windowPiers: piers,
    planters,
    cornices: cornices.cornices,
    ornament: descriptor.ornament,
    storefrontBays: storefront.bays,
    entranceDoors: storefront.entrances,
    awnings: storefront.awnings,
    fireEscapes,
    fireEscapePlatforms,
    roofEquipment: roofEquipment.kinds,
    rooftopSign: structures.signage,
    advertisingMedium: structures.medium,
    mediaPanels: media.panels,
    signageAnchors,
    triangles: countTriangles(parts),
  };

  return { lot, record, parts };
}

/* -------------------------------------------------------------------------- */
/* Generations                                                                */
/* -------------------------------------------------------------------------- */

interface Generation {
  readonly era: EraId;
  readonly group: THREE.Group;
  readonly materials: EraMaterialSet;
  readonly meshes: readonly THREE.Mesh[];
  /** Per-lot building roots, keyed by lot id, for the vertical morph. */
  readonly buildings: ReadonlyMap<string, THREE.Group>;
  readonly heights: ReadonlyMap<string, number>;
  readonly triangles: number;
}

/* -------------------------------------------------------------------------- */
/* System                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Builds the era-morphing building system with every layout lot populated.
 *
 * The returned object is a {@link BuildingsSystem} / {@link EraSceneSystem}:
 * `group` holds the visible generation(s), `update` drives the morph and the
 * advertising animation, and `dispose` releases all GPU resources.
 */
export function createBuildingsSystem(options: BuildingsSystemOptions = {}): BuildingsSystem {
  const layout = options.layout ?? CITY_LAYOUT;
  const lots = layout.lots;
  const seed = options.seed ?? DEFAULT_BUILDINGS_SEED;
  const root = new THREE.Group();
  root.name = BUILDINGS_GROUP_NAME;

  const plans = new Map<EraId, readonly PlannedBuilding[]>();
  const generations = new Map<EraId, Generation>();

  let currentEra: EraId = options.initialEra ?? ERAS[0].id;
  let sourceEra: EraId = currentEra;
  let targetEra: EraId = currentEra;
  let blendValue = 0;
  let disposed = false;

  function planFor(eraId: EraId): readonly PlannedBuilding[] {
    const cached = plans.get(eraId);
    if (cached) {
      return cached;
    }
    const era = getEraConfig(eraId);
    const planned = lots.map((lot) => planBuilding(lot, era, seed));
    plans.set(eraId, planned);
    return planned;
  }

  function ensureGeneration(eraId: EraId): Generation {
    const existing = generations.get(eraId);
    if (existing) {
      return existing;
    }
    const era = getEraConfig(eraId);
    const materials = createEraMaterialSet(era, createEraTextures(era, options.textureOptions));
    const group = new THREE.Group();
    group.name = `${BUILDINGS_GROUP_NAME}-${eraId}`;

    const meshes: THREE.Mesh[] = [];
    const buildings = new Map<string, THREE.Group>();
    const heights = new Map<string, number>();
    let triangles = 0;

    for (const planned of planFor(eraId)) {
      const building = new THREE.Group();
      building.name = `building-${planned.lot.id}-${eraId}`;
      building.position.set(planned.lot.center.x, 0, planned.lot.center.z);
      building.rotation.y = planned.record.placement.yaw;
      building.userData.buildingId = planned.record.id;
      building.userData.lotId = planned.lot.id;
      building.userData.eraId = eraId;

      for (const [key, geometry] of mergeParts(planned.parts)) {
        const mesh = new THREE.Mesh(geometry, materials.materials[key]);
        mesh.name = `${planned.record.id}:${key}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.buildingId = planned.record.id;
        mesh.userData.eraId = eraId;
        building.add(mesh);
        meshes.push(mesh);
        triangles += triangleCount(geometry);
      }

      group.add(building);
      buildings.set(planned.lot.id, building);
      heights.set(planned.lot.id, planned.record.height);
    }

    const generation: Generation = { era: eraId, group, materials, meshes, buildings, heights, triangles };
    generations.set(eraId, generation);
    root.add(group);
    return generation;
  }

  function disposeGeneration(eraId: EraId): void {
    const generation = generations.get(eraId);
    if (!generation) {
      return;
    }
    root.remove(generation.group);
    for (const mesh of generation.meshes) {
      mesh.geometry.dispose();
    }
    generation.materials.dispose();
    generations.delete(eraId);
  }

  /** Applies presence, the vertical morph and disposal for the current state. */
  function sync(): void {
    const needed = new Map<EraId, number>();
    if (sourceEra === targetEra) {
      needed.set(targetEra, 1);
    } else if (blendValue <= 0) {
      // At blend 0 the block is fully the source era; the incoming generation
      // is built lazily as soon as the morph actually starts.
      needed.set(sourceEra, 1);
    } else {
      needed.set(sourceEra, 1 - blendValue);
      needed.set(targetEra, blendValue);
    }

    for (const [eraId, presence] of needed) {
      const generation = ensureGeneration(eraId);
      const clamped = clamp01(presence);
      generation.group.visible = clamped > 0.002;
      generation.materials.setOpacity(clamped);
      generation.materials.setGlowScale(0.55 + 0.45 * clamped);
    }

    if (sourceEra !== targetEra && blendValue > 0) {
      const outgoing = generations.get(sourceEra);
      const incoming = generations.get(targetEra);
      const progress = clamp01(blendValue);
      if (incoming) {
        for (const [lotId, building] of incoming.buildings) {
          const ownHeight = incoming.heights.get(lotId) ?? 1;
          const previousHeight = outgoing?.heights.get(lotId) ?? ownHeight;
          const startRatio = clamp(previousHeight / Math.max(0.001, ownHeight), 0.2, 3);
          building.scale.y = startRatio + (1 - startRatio) * progress;
        }
      }
      if (outgoing) {
        for (const building of outgoing.buildings.values()) {
          building.scale.y = 1 - 0.04 * progress;
        }
      }
    } else {
      const generation = generations.get(targetEra);
      if (generation) {
        for (const building of generation.buildings.values()) {
          building.scale.y = 1;
        }
      }
    }

    for (const eraId of [...generations.keys()]) {
      if (!needed.has(eraId)) {
        disposeGeneration(eraId);
      }
    }
  }

  function applyEra(era: EraId, blend: number): void {
    if (disposed) {
      return;
    }
    const clamped = clampBlend(blend);
    if (era !== targetEra) {
      // A new target: whatever is displayed now becomes the outgoing side.
      sourceEra = currentEra;
      targetEra = era;
    }
    if (clamped >= 1) {
      currentEra = era;
      sourceEra = era;
    }
    blendValue = clamped;
    sync();
  }

  function visibleGenerations(): readonly Generation[] {
    const result: Generation[] = [];
    for (const generation of generations.values()) {
      if (generation.group.visible) {
        result.push(generation);
      }
    }
    return result.sort((a, b) => (a.era < b.era ? -1 : a.era > b.era ? 1 : 0));
  }

  function census(eraId: EraId): BuildingEraCensus {
    return censusEra(eraId, planFor(eraId).map((planned) => planned.record), lots.length);
  }

  const system: BuildingsSystem = {
    id: BUILDINGS_SYSTEM_ID,
    group: root,
    get era(): EraId {
      return currentEra;
    },
    get targetEra(): EraId {
      return targetEra;
    },
    get sourceEra(): EraId {
      return sourceEra;
    },
    get blend(): number {
      return blendValue;
    },
    eraWeights(): Readonly<Record<EraId, number>> {
      return resolveEraWeights(sourceEra, targetEra, blendValue);
    },
    applyEra,
    update(context: EraUpdateContext): void {
      if (disposed) {
        return;
      }
      const clamped = clampBlend(context.blend);
      if (context.from !== context.era) {
        // The shared transition driver owns `from`; honour it verbatim so the
        // morph matches the timeline even after a jump.
        sourceEra = context.from;
        targetEra = context.era;
        if (clamped >= 1) {
          currentEra = context.era;
          sourceEra = context.era;
        }
        blendValue = clamped;
        sync();
      } else {
        applyEra(context.era, clamped);
      }
      for (const generation of generations.values()) {
        generation.materials.animate(context.elapsed, context.delta);
      }
    },
    getPickables(): readonly THREE.Object3D[] {
      const pickables: THREE.Object3D[] = [];
      for (const generation of visibleGenerations()) {
        pickables.push(...generation.meshes);
      }
      return pickables;
    },
    describe(era?: EraId): readonly BuildingRecord[] {
      return planFor(era ?? targetEra).map((planned) => planned.record);
    },
    census(era?: EraId): BuildingEraCensus {
      return census(era ?? targetEra);
    },
    visibleMeshes(): readonly THREE.Object3D[] {
      const meshes: THREE.Object3D[] = [];
      for (const generation of visibleGenerations()) {
        meshes.push(...generation.meshes);
      }
      return meshes;
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const eraId of [...generations.keys()]) {
        disposeGeneration(eraId);
      }
      for (const eraId of [...plans.keys()]) {
        disposeEraTextures(eraId);
      }
      plans.clear();
      root.clear();
    },
  };

  // Populate the starting era so the block is never empty before the first
  // `update`: `sync()` treats a single-era state as fully present.
  sync();
  return system;
}

/* -------------------------------------------------------------------------- */
/* Reporting helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Census for every era in the dataset.
 *
 * Used by tests and the debug HUD to compare per-era geometry budgets; every
 * era is planned (never realised), so this stays cheap and GL-free.
 */
export function censusAllEras(layout: CityLayout = CITY_LAYOUT, seed = DEFAULT_BUILDINGS_SEED): readonly BuildingEraCensus[] {
  return ERAS.map((era) =>
    censusEra(era.id, layout.lots.map((lot) => planBuilding(lot, era, seed).record), layout.lots.length),
  );
}

/** Aggregates planned records into the comparable per-era census. */
function censusEra(
  eraId: EraId,
  records: readonly BuildingRecord[],
  lotCount: number,
): BuildingEraCensus {
  const roofKinds = new Set<string>();
  let triangles = 0;
  let maxHeight = 0;
  let signageAnchors = 0;
  for (const record of records) {
    triangles += record.triangles;
    maxHeight = Math.max(maxHeight, record.height);
    signageAnchors += record.signageAnchors.length;
    for (const kind of record.roofEquipment) {
      roofKinds.add(kind);
    }
  }
  return {
    eraId,
    buildings: records.length,
    lots: lotCount,
    triangles,
    trianglesPerBuilding: records.length > 0 ? Math.round(triangles / records.length) : 0,
    panes: sum(records, (record) => record.windowPanes),
    frames: sum(records, (record) => record.windowFrames),
    sills: sum(records, (record) => record.windowSills),
    lintels: sum(records, (record) => record.windowLintels),
    mullions: sum(records, (record) => record.windowMullions),
    bands: sum(records, (record) => record.windowBands),
    piers: sum(records, (record) => record.windowPiers),
    planters: sum(records, (record) => record.planters),
    cornices: sum(records, (record) => record.cornices),
    storefrontBays: sum(records, (record) => record.storefrontBays),
    entranceDoors: sum(records, (record) => record.entranceDoors),
    fireEscapes: sum(records, (record) => record.fireEscapes),
    fireEscapePlatforms: sum(records, (record) => record.fireEscapePlatforms),
    mediaPanels: sum(records, (record) => record.mediaPanels),
    signageAnchors,
    maxHeight,
    roofEquipmentKinds: [...roofKinds].sort(),
    rooftopSigns: [...new Set(records.map((record) => record.rooftopSign))].sort(),
  };
}

function sum(records: readonly BuildingRecord[], pick: (record: BuildingRecord) => number): number {
  let total = 0;
  for (const record of records) {
    total += pick(record);
  }
  return total;
}

/**
 * Material keys a building can generate, re-exported so scene assembly can
 * pre-warm or override shader behaviour without importing the detail library.
 */
export { PART_MATERIAL_KEYS };

/** Convenience re-export: the era-specific facade material resolver. */
export { materialForRole };

/** Convenience re-export: the rooftop advertising structures of an era. */
export { advertisingStructuresFor };
