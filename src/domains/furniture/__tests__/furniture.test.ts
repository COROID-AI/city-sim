/**
 * Furniture domain suite (headless, node).
 *
 * The furniture of the café must be real in a GPU-free process: the kernel boots
 * headless, the module builds, moves through all five eras and disposes, while
 * the tests assert the actual integrated behaviour:
 *
 *  - five era records that differ on the period discriminators, and the era
 *    inventory checklist the acceptance criteria name (1945 bentwood, vinyl and
 *    tubular-metal seating; 1965 chrome-melamine, vinyl booths and formica;
 *    1985 laminate, glass and stacking chairs; 2005 lounge, high stools and a
 *    bar-height counter; 2025 reclaimed communal runs, moulded shells and a
 *    standing rail),
 *  - a complete prop inventory per era (seating, tables, counter frontage,
 *    coat/hat stands, magazine rack, rugs, curtains or blinds, plants, clock,
 *    payphone or wall phone, waste bin and table-top decor),
 *  - procedural surfaces only: canvas where a canvas exists, data textures in
 *    node, never a fetched asset,
 *  - deterministic placement derived from the environment's `RoomBounds` and
 *    structural layout: every prop inside the room and clear of the counter
 *    service lane, the door swing and the counter volume,
 *  - `applyPeriod` rebuilding every prop for the new era, with nothing of the
 *    previous era left behind, and `update` ticking the era's wall clock,
 *  - `dispose` returning the scene graph to its pre-build baseline with every
 *    geometry, material and texture released,
 *  - `getHotspots` exposing the furniture landmarks navigation frames up close,
 *    without touching the core hotspot registry.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_YEAR_ID,
  YEAR_IDS,
  isSceneModule,
  type BuildContext,
  type PeriodDefinition,
  type YearId,
} from '../../../contracts/period';
import { createKernel, defaultInteriorView, type Kernel } from '../../../core/kernel';
import { CAFE_ROOM_BOUNDS, STRUCTURAL_LAYOUT, environmentSpec } from '../../environment';
import {
  DEFAULT_FURNITURE_TEXTURE_SIZE,
  FURNITURE_ERA_DISCRIMINATOR_FIELDS,
  FURNITURE_MATERIAL_SLOTS,
  FURNITURE_MODULE_ID,
  FURNITURE_SPECS,
  FURNITURE_SPEC_YEARS,
  FURNITURE_TEXTURE_PREFIX,
  FurnitureModule,
  createFurnitureModule,
  createFurnitureTexture,
  describeFurnitureSpec,
  distinctPixelColors,
  furnitureEraConflicts,
  furnitureMaterialName,
  furnitureMaterialSetMaterials,
  furnitureMaterialSetSignature,
  furniturePlanSignature,
  furnitureSpec,
  furnitureSpecs,
  isFurnitureTexture,
  paintFurnitureSurface,
  placementProblems,
  placementRules,
  planFurniture,
  propBounds,
  type CanvasFactory,
  type FurnitureTextureKind,
  type FurnitureTextureStyle,
  type PropKind,
} from '../index';
import { createSeededRandom } from '../../../core/kernel';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const openKernels: Kernel[] = [];

function headlessKernel(): Kernel {
  const kernel = createKernel(null, {
    forceHeadless: true,
    bounds: CAFE_ROOM_BOUNDS,
    autoResize: false,
  });
  openKernels.push(kernel);
  return kernel;
}

afterEach(() => {
  for (const kernel of openKernels.splice(0)) {
    if (!kernel.isDisposed) kernel.dispose();
  }
  vi.restoreAllMocks();
});

/**
 * Era fixture for the build context. The period registry (a later task) owns the
 * real `PeriodDefinition`s; this fixture derives one from the shell's era data so
 * the suite exercises the contract with era-correct colours.
 */
function periodFor(year: YearId): PeriodDefinition {
  const spec = environmentSpec(year);
  return {
    year,
    label: spec.label,
    name: spec.name,
    summary: spec.summary,
    palette: {
      background: spec.paint.trimBase,
      floor: spec.floor.palette.base,
      wall: spec.paint.wallBase,
      ceiling: spec.ceiling.finish.palette.base,
      accent: spec.accentColor,
      lamp: spec.signage.lampColor,
    },
    lighting: {
      ambientColor: spec.lightBounce.wall,
      ambientIntensity: 0.5,
      keyColor: spec.lightBounce.ceiling,
      keyIntensity: 1.4,
      fillColor: spec.lightBounce.wall,
      fillIntensity: 0.35,
      lampColor: spec.signage.lampColor,
      lampIntensity: 20,
      fogDensity: 0,
    },
    details: spec.tags,
  };
}

function countNodes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse(() => {
    count += 1;
  });
  return count;
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  return meshes;
}

function texturesOf(root: THREE.Object3D): THREE.Texture[] {
  const textures = new Set<THREE.Texture>();
  for (const mesh of meshesOf(root)) {
    const material = mesh.material as THREE.Material | THREE.Material[];
    const list = Array.isArray(material) ? material : [material];
    for (const entry of list) {
      for (const value of Object.values(entry)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  }
  return [...textures];
}

/** World space (axis aligned) box of a built node. */
/** Distinct 32 bit pixel values in a raw RGBA buffer. */
function distinctPixelBytes(data: Uint8ClampedArray): number {
  const seen = new Set<number>();
  for (let offset = 0; offset + 3 < data.length; offset += 4) {
    seen.add(
      (((data[offset] ?? 0) << 24) |
        ((data[offset + 1] ?? 0) << 16) |
        ((data[offset + 2] ?? 0) << 8) |
        (data[offset + 3] ?? 0)) >>>
        0,
    );
  }
  return seen.size;
}

function worldBox(node: THREE.Object3D): THREE.Box3 {
  node.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(node);
}

interface FakeCanvasRecord {
  readonly factory: CanvasFactory;
  putImageDataCalls: number;
  readonly images: ImageData[];
}

/** A minimal 2D canvas good enough to prove the canvas texture path runs. */
function createFakeCanvas(): FakeCanvasRecord {
  const record: FakeCanvasRecord = {
    putImageDataCalls: 0,
    images: [],
    factory: (width: number, height: number) => {
      const context = {
        createImageData: (w: number, h: number): ImageData =>
          ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) as ImageData,
        putImageData: (image: ImageData): void => {
          record.putImageDataCalls += 1;
          record.images.push(image);
        },
      };
      return { width, height, getContext: () => context } as unknown as HTMLCanvasElement;
    },
  };
  return record;
}

function buildOnce(kernel: Kernel, module: FurnitureModule, year: YearId = DEFAULT_YEAR_ID): BuildContext {
  const context = kernel.createBuildContext(periodFor(year));
  module.build(context);
  return context;
}

/** Every prop family the acceptance criteria require of every era. */
const REQUIRED_KINDS: readonly PropKind[] = Object.freeze([
  'table',
  'chair',
  'banquette',
  'booth',
  'stool',
  'counter-front',
  'coat-stand',
  'hat-rack',
  'magazine-rack',
  'rug',
  'plant',
  'wall-clock',
  'payphone',
  'waste-bin',
  'table-decor',
]);

/* -------------------------------------------------------------------------- */
/* Era data                                                                   */
/* -------------------------------------------------------------------------- */

describe('era data: five period-correct furniture records', () => {
  it('covers exactly the five selectable years with distinct discriminators', () => {
    expect(FURNITURE_SPEC_YEARS).toEqual([...YEAR_IDS]);
    expect(Object.keys(FURNITURE_SPECS)).toEqual([...YEAR_IDS]);
    expect(furnitureSpecs().map((spec) => spec.year)).toEqual([...YEAR_IDS]);
    expect(furnitureSpec('1945').year).toBe('1945');

    for (const spec of furnitureSpecs()) {
      expect(spec.surfaces).toBeTruthy();
      expect(Object.keys(spec.surfaces).sort()).toEqual([...FURNITURE_MATERIAL_SLOTS].sort());
      expect(spec.tags.length).toBeGreaterThan(2);
      expect(spec.notes.length).toBeGreaterThan(1);
    }

    // Every pair of eras differs on most of the discriminator fields, so the
    // timeline really moves the furniture rather than tinting it.
    const summaries = furnitureSpecs().map(describeFurnitureSpec);
    for (let a = 0; a < summaries.length; a += 1) {
      for (let b = a + 1; b < summaries.length; b += 1) {
        const left = summaries[a];
        const right = summaries[b];
        if (!left || !right) continue;
        const conflicts = furnitureEraConflicts(left, right);
        expect(FURNITURE_ERA_DISCRIMINATOR_FIELDS.length - conflicts.length).toBeGreaterThanOrEqual(12);
        expect(left.name).not.toBe(right.name);
        expect(left.paletteName).not.toBe(right.paletteName);
        expect(left.materialSetId).not.toBe(right.materialSetId);
      }
    }
  });

  it('reads as 1945: bentwood and tubular seating, fixed banquettes, painted counters', () => {
    const spec = furnitureSpec('1945');
    expect(spec.seating.chair.kind).toBe('bentwood-cane');
    expect(spec.seating.chair.seatSlot).toBe('cane');
    expect(spec.seating.accentChair?.kind).toBe('tubular-metal');
    expect(spec.seating.banquette.kind).toBe('buttoned-rexine');
    expect(spec.seating.banquette.buttons).toBeGreaterThan(0);
    expect(spec.seating.booth.kind).toBe('timber-leatherette-booth');
    expect(spec.seating.bench).toBeNull();
    expect(spec.seating.lounge).toBeNull();
    expect(spec.seating.standingRail).toBeNull();
    expect(spec.seating.stools.kind).toBe('timber-round');
    expect(spec.tables.surface).toBe('painted-wood');
    expect(spec.tables.base).toBe('cast-iron-pedestal');
    expect(spec.tables.variant).toBeNull();
    expect(spec.counterFront.kind).toBe('painted-panelled');
    expect(spec.softDecor.windowTreatment.kind).toBe('lace-and-pelmet');
    expect(spec.softDecor.windowTreatment.pelmet).toBe(true);
    expect(spec.softDecor.plants.some((plant) => plant.kind === 'aspidistra')).toBe(true);
    expect(spec.fixtures.clock.kind).toBe('station-clock');
    expect(spec.fixtures.phone.kind).toBe('payphone-bakelite');
    expect(spec.fixtures.bin.kind).toBe('pedal-bin-enamel');
    expect(spec.softDecor.tableDecor.map((item) => item.kind)).toContain('ashtray');
    expect(spec.softDecor.rug.kind).toBe('woven-wool-runner');
  });

  it('reads as 1965: chrome-melamine tables, vinyl booths and formica counters', () => {
    const spec = furnitureSpec('1965');
    expect(spec.tables.surface).toBe('chrome-laminate');
    expect(spec.tables.bandSlot).toBe('chrome');
    expect(spec.tables.base).toBe('chrome-pedestal');
    expect(spec.tables.shape).toBe('round');
    expect(spec.seating.booth.kind).toBe('ribbed-vinyl-booth');
    expect(spec.seating.booth.benchSlot).toBe('vinyl');
    expect(spec.seating.banquette.kind).toBe('ribbed-vinyl');
    expect(spec.seating.chair.kind).toBe('vinyl-diner');
    expect(spec.counterFront.kind).toBe('formica-banded');
    expect(spec.counterFront.panelSlot).toBe('formica');
    expect(spec.seating.lounge?.kind).toBe('tub-armchair-pair');
    expect(spec.seating.stools.kind).toBe('chrome-vinyl');
    expect(spec.seating.stools.footRail).toBe(true);
    expect(spec.softDecor.windowTreatment.kind).toBe('cafe-curtains');
    expect(spec.fixtures.phone.kind).toBe('payphone-chrome');
  });

  it('reads as 1985: modular benches, laminate and glass tables, stacking chairs', () => {
    const spec = furnitureSpec('1985');
    expect(spec.tables.surface).toBe('laminate');
    expect(spec.tables.base).toBe('x-frame-chrome');
    expect(spec.tables.variant?.surface).toBe('glass');
    expect(spec.tables.variantRows).toContain(4);
    expect(spec.seating.chair.kind).toBe('stacking-polypropylene');
    expect(spec.seating.chair.stackable).toBe(true);
    expect(spec.seating.bench?.kind).toBe('moulded-pad-bench');
    expect(spec.seating.banquette.kind).toBe('moquette');
    expect(spec.seating.booth.kind).toBe('high-back-vinyl-booth');
    expect(spec.seating.lounge).toBeNull();
    expect(spec.counterFront.kind).toBe('laminate-modular');
    expect(spec.softDecor.windowTreatment.kind).toBe('vertical-blinds');
    expect(spec.softDecor.rug.kind).toBe('shag-pile');
    expect(spec.fixtures.clock.kind).toBe('electric-square');
    expect(spec.fixtures.phone.kind).toBe('wall-phone-pushbutton');
  });

  it('reads as 2005: mix-and-match lounge, high stools and a bar-height counter', () => {
    const spec = furnitureSpec('2005');
    expect(spec.seating.lounge?.kind).toBe('mix-and-match-loveseat');
    expect(spec.seating.lounge?.armchairSlot).toBe('fabric');
    expect(spec.seating.stools.kind).toBe('leather-bar');
    expect(spec.seating.stools.seatHeight).toBeGreaterThanOrEqual(0.78);
    expect(spec.counterFront.kind).toBe('stainless-bar');
    expect(spec.counterFront.barHeight).toBe(true);
    expect(spec.counterFront.footRail).toBe(true);
    expect(spec.seating.chair.kind).toBe('plywood-shell');
    expect(spec.seating.banquette.kind).toBe('stitched-leather');
    expect(spec.tables.surface).toBe('solid-wood');
    expect(spec.softDecor.windowTreatment.kind).toBe('roller-blinds');
    expect(spec.softDecor.tableDecor.map((item) => item.kind)).not.toContain('ashtray');
    expect(spec.fixtures.phone.kind).toBe('payphone-card');
    expect(spec.fixtures.bin.compartments).toBeGreaterThan(1);
  });

  it('reads as 2025: reclaimed communal tables, moulded chairs and standing rails', () => {
    const spec = furnitureSpec('2025');
    expect(spec.tables.communal).toBe(true);
    expect(spec.tables.surface).toBe('reclaimed-wood');
    expect(spec.tables.base).toBe('timber-trestle');
    expect(spec.tables.variant?.surface).toBe('terrazzo');
    expect(spec.seating.chair.kind).toBe('moulded-shell');
    expect(spec.seating.standingRail?.kind).toBe('steel-perch-rail');
    expect(spec.seating.bench).toBeNull();
    expect(spec.seating.lounge).toBeNull();
    expect(spec.counterFront.kind).toBe('reclaimed-timber-slats');
    expect(spec.softDecor.windowTreatment.kind).toBe('timber-venetian-blinds');
    expect(spec.softDecor.rug.kind).toBe('recycled-felt');
    expect(spec.softDecor.plants.some((plant) => plant.kind === 'olive-tree')).toBe(true);
    expect(spec.fixtures.bin.kind).toBe('segregated-recycling');
    expect(spec.fixtures.bin.compartments).toBe(3);
    expect(spec.seating.chairsPerSide).toBeGreaterThanOrEqual(2);
  });

  it('gives every era the full furniture and soft-decor inventory', () => {
    const module = createFurnitureModule();
    for (const year of YEAR_IDS) {
      const plan = module.eraPlan(year);
      const kinds = new Set(plan.entries.map((entry) => entry.kind));
      for (const kind of REQUIRED_KINDS) {
        expect(kinds.has(kind), `${year} is missing a ${kind}`).toBe(true);
      }
      const windowDressing = kinds.has('curtain') || kinds.has('blind');
      expect(windowDressing, `${year} has no curtain or blind`).toBe(true);
      // Tables on the environment's slot grid, plus the communal runs.
      const tables = plan.entries.filter((entry) => entry.kind === 'table');
      expect(tables.length).toBeGreaterThanOrEqual(6);
      const counterFront = plan.entries.filter((entry) => entry.kind === 'counter-front');
      expect(counterFront.length).toBeGreaterThanOrEqual(1);
      expect(counterFront[0]?.label.length).toBeGreaterThan(4);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Materials and textures                                                     */
/* -------------------------------------------------------------------------- */

describe('materials: procedural surfaces for every era', () => {
  it('builds a named, procedural material for all 31 slots in node', () => {
    expect(typeof document).toBe('undefined');
    const kernel = headlessKernel();
    const module = createFurnitureModule();
    buildOnce(kernel, module);

    const set = module.materialSet;
    if (!set) throw new Error('the module must hold a material set after build');
    expect(set.year).toBe(DEFAULT_YEAR_ID);
    expect(furnitureMaterialSetMaterials(set).length).toBe(FURNITURE_MATERIAL_SLOTS.length);
    expect(furnitureMaterialSetSignature(set)).toContain(`furniture:${DEFAULT_YEAR_ID}:woodDark`);
    expect(set.textureSource).toBe('data');
    expect(set.textures.length).toBe(FURNITURE_MATERIAL_SLOTS.length);
    for (const slot of FURNITURE_MATERIAL_SLOTS) {
      const material = set.slots[slot] as THREE.MeshStandardMaterial;
      expect(material.name).toBe(furnitureMaterialName(DEFAULT_YEAR_ID, slot));
      expect(material.roughness).toBeGreaterThanOrEqual(0);
      expect(material.roughness).toBeLessThanOrEqual(1);
      expect(material.metalness).toBeGreaterThanOrEqual(0);
      expect(material.metalness).toBeLessThanOrEqual(1);
      expect(material.map).toBeInstanceOf(THREE.DataTexture);
      expect(isFurnitureTexture(material.map as THREE.Texture)).toBe(true);
      expect(material.userData).toMatchObject({
        furniture: { procedural: true, textureSource: 'data', year: DEFAULT_YEAR_ID, slot },
      });
    }

    const signatures = new Set<string>();
    for (const year of YEAR_IDS) {
      const eraModule = createFurnitureModule({ initialYear: year });
      const context = kernel.createBuildContext(periodFor(year));
      eraModule.build(context);
      const eraSet = eraModule.materialSet;
      if (!eraSet) throw new Error('every era must build a material set');
      expect(eraSet.year).toBe(year);
      for (const slot of FURNITURE_MATERIAL_SLOTS) {
        expect((eraSet.slots[slot] as THREE.Material).name).toBe(furnitureMaterialName(year, slot));
      }
      signatures.add(eraSet.textures.map((texture) => texture.name).join('|'));
      eraModule.dispose();
    }
    expect(signatures.size).toBe(YEAR_IDS.length);
  });

  it('paints visibly different pixel content per surface family', () => {
    const kinds: FurnitureTextureKind[] = [
      'wood-grain',
      'laminate',
      'vinyl',
      'fabric-weave',
      'cork',
      'linoleum',
      'worn-metal',
      'chrome',
      'terrazzo',
    ];
    const signatures = new Set<string>();
    for (const kind of kinds) {
      const style: FurnitureTextureStyle = {
        kind,
        palette: { base: '#8a6a40', accent: '#4a2c18', detail: '#2c1a0e', highlight: '#c9a86a' },
        scale: 5,
        contrast: 0.2,
        size: 64,
      };
      const raster = paintFurnitureSurface(style);
      expect(raster.width).toBe(64);
      expect(raster.height).toBe(64);
      expect(distinctPixelColors(raster)).toBeGreaterThan(6);
      signatures.add(raster.data.join(','));
    }
    expect(signatures.size).toBe(kinds.length);
  });

  it('paints deterministically, and seeds the pattern from the style', () => {
    const style: FurnitureTextureStyle = {
      kind: 'wood-grain',
      palette: { base: '#8a6a40', accent: '#4a2c18' },
      scale: 4,
      size: 48,
    };
    const first = paintFurnitureSurface(style);
    const second = paintFurnitureSurface(style);
    expect(first.data).toEqual(second.data);
    const seeded = paintFurnitureSurface({ ...style, seed: 1234 });
    const other = paintFurnitureSurface({ ...style, seed: 4321 });
    expect(seeded.data).not.toEqual(other.data);
  });

  it('uses the canvas backend when a 2D canvas is available', () => {
    const record = createFakeCanvas();
    const kernel = headlessKernel();
    const module = createFurnitureModule({ canvasFactory: record.factory });
    buildOnce(kernel, module);

    expect(module.textureSource).toBe('canvas');
    expect(record.putImageDataCalls).toBeGreaterThanOrEqual(FURNITURE_MATERIAL_SLOTS.length);
    const material = module.materialSet?.slots.woodDark as THREE.MeshStandardMaterial;
    expect(material.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(material.map?.name).toBe(`${FURNITURE_TEXTURE_PREFIX}1945:woodDark`);
    const firstImage = record.images[0];
    expect(firstImage).toBeTruthy();
    expect(distinctPixelBytes(firstImage?.data ?? new Uint8ClampedArray())).toBeGreaterThan(4);

    const texture = createFurnitureTexture(
      { kind: 'terrazzo', palette: { base: '#ddd6c4', accent: '#4f6b4a' }, size: DEFAULT_FURNITURE_TEXTURE_SIZE },
      { key: 'test:terrazzo', canvasFactory: record.factory },
    );
    expect(texture.source).toBe('canvas');
    expect(texture.canvas).not.toBeNull();
    expect(isFurnitureTexture(texture.texture)).toBe(true);
    texture.texture.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Placement plan                                                             */
/* -------------------------------------------------------------------------- */

describe('placement: deterministic props inside the room', () => {
  it('keeps every era inside RoomBounds and clear of the lane, swing and counter', () => {
    const module = createFurnitureModule();
    const rules = placementRules(STRUCTURAL_LAYOUT, CAFE_ROOM_BOUNDS);
    expect(rules.serviceLane.maxZ).toBeGreaterThan(rules.serviceLane.minZ);

    for (const year of YEAR_IDS) {
      const plan = module.eraPlan(year);
      expect(plan.year).toBe(year);
      expect(plan.entries.length).toBeGreaterThan(30);
      expect(placementProblems(plan, rules)).toEqual([]);

      for (const entry of plan.entries) {
        const bounds = propBounds(entry);
        expect(bounds.min.x, `${year} ${entry.id}`).toBeGreaterThanOrEqual(-CAFE_ROOM_BOUNDS.width / 2 - 1e-6);
        expect(bounds.max.x, `${year} ${entry.id}`).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.width / 2 + 1e-6);
        expect(bounds.min.z, `${year} ${entry.id}`).toBeGreaterThanOrEqual(-CAFE_ROOM_BOUNDS.depth / 2 - 1e-6);
        expect(bounds.max.z, `${year} ${entry.id}`).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.depth / 2 + 1e-6);
        if (entry.support === 'floor') {
          expect(Math.abs(bounds.min.y), `${year} ${entry.id}`).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('places a table on every slot of the environment grid', () => {
    const module = createFurnitureModule();
    for (const year of YEAR_IDS) {
      const spec = furnitureSpec(year);
      const plan = module.eraPlan(year);
      const tables = plan.entries.filter((entry) => entry.kind === 'table' && entry.tags.includes('standard'));
      if (spec.tables.communal) {
        // Outer rows only, plus one long run per column.
        expect(tables.length).toBe(4);
        const communal = plan.entries.filter((entry) => entry.tags.includes('communal'));
        expect(communal.length).toBe(2);
        for (const run of communal) {
          expect(run.size.z).toBeGreaterThan(2.5);
        }
      } else {
        expect(tables.length).toBe(STRUCTURAL_LAYOUT.tableSlots.length);
      }
      for (const slot of STRUCTURAL_LAYOUT.tableSlots) {
        if (spec.tables.communal && (slot.row === 2 || slot.row === 3)) continue;
        const match = tables.find(
          (entry) => Math.abs(entry.center.x - slot.position.x) < 0.05 && Math.abs(entry.center.z - slot.position.z) < 0.05,
        );
        expect(match, `${year} has no table at ${slot.id}`).toBeTruthy();
        expect(match?.center.y).toBeCloseTo(slot.surfaceHeight / 2, 6);
      }
    }
  });

  it('applies the era table rule, including the 1985 glass row and the 2025 terrazzo', () => {
    const module = createFurnitureModule();
    const glass = module
      .eraPlan('1985')
      .entries.filter((entry) => entry.kind === 'table')
      .map((entry) => entry.tags[0]);
    expect(glass).toContain('glass');
    expect(glass).toContain('laminate');

    const reclaimed = module
      .eraPlan('2025')
      .entries.filter((entry) => entry.kind === 'table')
      .map((entry) => entry.tags[0]);
    expect(reclaimed).toContain('reclaimed-wood');
    expect(reclaimed).toContain('terrazzo');
  });

  it('is reproducible: the same era always plans the same props', () => {
    const first = createFurnitureModule();
    const second = createFurnitureModule();
    const other = createFurnitureModule({ seed: 4321 });
    for (const year of YEAR_IDS) {
      const a = furniturePlanSignature(first.eraPlan(year));
      const b = furniturePlanSignature(second.eraPlan(year));
      expect(a).toBe(b);
      expect(a.length).toBeGreaterThan(100);
    }
    // A different module seed may vary cosmetic details, never the placement.
    expect(furniturePlanSignature(other.eraPlan('1985'))).toBe(furniturePlanSignature(first.eraPlan('1985')));
    expect(furniturePlanSignature(first.eraPlan('1945'))).not.toBe(furniturePlanSignature(first.eraPlan('2025')));
  });

  it('hands every entry to exactly one builder group', () => {
    const module = createFurnitureModule();
    const plan = module.eraPlan('1965');
    const grouped = Object.values(plan.groups).flat();
    expect(grouped.length).toBe(plan.entries.length);
    const ids = new Set(plan.entries.map((entry) => entry.id));
    expect(ids.size).toBe(plan.entries.length);
    expect(plan.groups.seating.length).toBeGreaterThan(4);
    expect(plan.groups.counterFront.length).toBeGreaterThan(0);
    expect(plan.groups.softDecor.length).toBeGreaterThan(4);
    expect(furnitureEraConflicts(describeFurnitureSpec(furnitureSpec('1965')), describeFurnitureSpec(furnitureSpec('1985'))).length)
      .toBeGreaterThan(0);
  });

  it('plans from an injected random source without breaking placement', () => {
    const plan = planFurniture({
      year: '2005',
      spec: furnitureSpec('2005'),
      layout: STRUCTURAL_LAYOUT,
      bounds: CAFE_ROOM_BOUNDS,
      random: createSeededRandom(7),
    });
    expect(placementProblems(plan, placementRules(STRUCTURAL_LAYOUT, CAFE_ROOM_BOUNDS))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Module lifecycle                                                           */
/* -------------------------------------------------------------------------- */

describe('module: build, era swap, update and diagnostics', () => {
  it('is a SceneModule and exposes its era spec', () => {
    const module = createFurnitureModule();
    expect(isSceneModule(module)).toBe(true);
    expect(module.id).toBe(FURNITURE_MODULE_ID);
    expect(module.bounds).toEqual(CAFE_ROOM_BOUNDS);
    expect(module.built).toBe(false);
    expect(module.root).toBeUndefined();
    expect(module.spec).toBeUndefined();
    expect(module.nodeCount).toBe(0);
    expect(module.props.length).toBe(0);
  });

  it('raises a furniture group inside the room and names every prop', () => {
    const kernel = headlessKernel();
    const baseline = countNodes(kernel.scene);
    const module = createFurnitureModule();
    buildOnce(kernel, module);

    expect(module.built).toBe(true);
    expect(module.root?.name).toBe('furniture');
    expect(countNodes(kernel.scene)).toBeGreaterThan(baseline);
    expect(module.props.length).toBe(module.plan?.entries.length);
    expect(module.props.length).toBeGreaterThan(30);

    const meshes = meshesOf(module.root as THREE.Object3D);
    expect(meshes.length).toBeGreaterThan(150);
    expect(module.meshCount).toBe(meshes.length);
    for (const mesh of meshes) {
      expect(mesh.name.length).toBeGreaterThan(3);
      expect(mesh.userData.furniturePart).toBeTruthy();
    }

    // Every built prop sits inside its planned box (a little slack for trim).
    for (const prop of module.props) {
      const box = worldBox(prop.node);
      const planned = propBounds(prop);
      expect(box.min.x, prop.id).toBeGreaterThan(planned.min.x - 0.12);
      expect(box.max.x, prop.id).toBeLessThan(planned.max.x + 0.12);
      expect(box.min.y, prop.id).toBeGreaterThan(planned.min.y - 0.12);
      expect(box.max.y, prop.id).toBeLessThan(planned.max.y + 0.15);
      expect(box.min.z, prop.id).toBeGreaterThan(planned.min.z - 0.12);
      expect(box.max.z, prop.id).toBeLessThan(planned.max.z + 0.12);
    }

    // And inside the room the environment shell exports.
    for (const prop of module.props) {
      const box = worldBox(prop.node);
      expect(box.min.x, prop.id).toBeGreaterThanOrEqual(-CAFE_ROOM_BOUNDS.width / 2 - 1e-6);
      expect(box.max.x, prop.id).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.width / 2 + 1e-6);
      expect(box.min.z, prop.id).toBeGreaterThanOrEqual(-CAFE_ROOM_BOUNDS.depth / 2 - 1e-6);
      expect(box.max.z, prop.id).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.depth / 2 + 1e-6);
      expect(box.min.y, prop.id).toBeGreaterThanOrEqual(-0.004);
      expect(box.max.y, prop.id).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.height + 1e-6);
    }
  });

  it('rebuilds every prop when the timeline moves, with nothing left behind', () => {
    const kernel = headlessKernel();
    const baseline = countNodes(kernel.scene);
    const module = createFurnitureModule();
    buildOnce(kernel, module);

    const seen = new Map<YearId, number>();
    for (const year of YEAR_IDS) {
      module.applyPeriod(periodFor(year), kernel.createBuildContext(periodFor(year)));
      expect(module.spec?.year).toBe(year);
      expect(module.placementProblems()).toEqual([]);
      expect(countNodes(kernel.scene)).toBeGreaterThan(baseline);

      const props = module.props;
      expect(props.length).toBeGreaterThan(30);
      const yearTagged = props.filter((prop) => prop.tags.includes(`year:${year}`));
      expect(yearTagged.length).toBeGreaterThan(0);
      seen.set(year, props.length);

      for (const texture of texturesOf(module.root as THREE.Object3D)) {
        expect(texture.name.startsWith(`${FURNITURE_TEXTURE_PREFIX}${year}:`)).toBe(true);
      }
      for (const mesh of meshesOf(module.root as THREE.Object3D)) {
        const material = mesh.material as THREE.MeshStandardMaterial;
        expect(material.name.startsWith(`furniture:${year}:`), `${mesh.name} carries ${material.name}`).toBe(true);
      }
    }
    expect(seen.size).toBe(YEAR_IDS.length);
    expect(new Set([...seen.values()]).size).toBeGreaterThan(1);
  });

  it('leaves no orphaned object when a new era interrupts an applied one', () => {
    const kernel = headlessKernel();
    const baseline = countNodes(kernel.scene);
    const module = createFurnitureModule();
    buildOnce(kernel, module);
    const onceCount = countNodes(kernel.scene);

    // Apply 2025, then jump back and forth: each swap must land on the same
    // node count for that era, never accumulating the previous room.
    module.applyPeriod(periodFor('2025'), kernel.createBuildContext(periodFor('2025')));
    const count2025 = countNodes(kernel.scene);
    module.applyPeriod(periodFor('1945'), kernel.createBuildContext(periodFor('1945')));
    expect(countNodes(kernel.scene)).toBe(onceCount);
    module.applyPeriod(periodFor('2025'), kernel.createBuildContext(periodFor('2025')));
    expect(countNodes(kernel.scene)).toBe(count2025);

    // Only one furniture group hangs in the world at a time.
    let groups = 0;
    kernel.world.traverse((object) => {
      if (object.name === 'furniture') groups += 1;
    });
    expect(groups).toBe(1);
    expect(countNodes(kernel.scene)).toBeGreaterThan(baseline);
  });

  it('ticks the wall clock and breathes through the foliage', () => {
    const kernel = headlessKernel();
    const module = createFurnitureModule();
    buildOnce(kernel, module);

    const hands = module.landmarks.get('clock-hands');
    expect(hands).toBeDefined();
    const secondHand = hands?.children[1];
    const before = secondHand?.rotation.z ?? 0;

    const context = { year: DEFAULT_YEAR_ID, elapsedSeconds: 0, frame: 0 };
    module.update(0.5, context);
    module.update(0.5, context);
    expect(module.updateCount).toBe(2);
    expect(secondHand?.rotation.z).not.toBe(before);
    expect(Number.isFinite(secondHand?.rotation.z ?? Number.NaN)).toBe(true);
  });

  it('describes itself for the diagnostics overlay', () => {
    const kernel = headlessKernel();
    const module = createFurnitureModule();
    buildOnce(kernel, module);
    const description = module.describe();

    expect(description.moduleId).toBe(FURNITURE_MODULE_ID);
    expect(description.year).toBe(DEFAULT_YEAR_ID);
    expect(description.built).toBe(true);
    expect(description.materialCount).toBe(FURNITURE_MATERIAL_SLOTS.length);
    expect(description.textureCount).toBe(FURNITURE_MATERIAL_SLOTS.length);
    expect(description.textureSource).toBe('data');
    expect(description.nodeCount).toBeGreaterThan(150);
    expect(description.propCount).toBe(module.props.length);
    expect(description.placementProblems).toEqual([]);
    expect(description.landmarkCount).toBeGreaterThan(6);
    expect(description.summary.chair).toBe('bentwood-cane');
    expect(Object.keys(description.propCounts).length).toBeGreaterThan(10);

    const yearSet = new Set<YearId>();
    for (const year of YEAR_IDS) {
      const eraModule = createFurnitureModule({ initialYear: year });
      eraModule.build(kernel.createBuildContext(periodFor(year)));
      expect(eraModule.describe().summary.year).toBe(year);
      yearSet.add(eraModule.describe().summary.year);
      eraModule.dispose();
    }
    expect(yearSet.size).toBe(YEAR_IDS.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Hotspots                                                                   */
/* -------------------------------------------------------------------------- */

describe('hotspots: the furniture landmarks navigation frames up close', () => {
  it('exposes the named landmarks for every era with an era note', () => {
    const canonical = [
      'furniture:counter-front',
      'furniture:booth-seating',
      'furniture:coat-stand',
      'furniture:payphone',
      'furniture:banquette',
      'furniture:hat-rack',
      'furniture:magazine-rack',
      'furniture:wall-clock',
      'furniture:rug',
      'furniture:house-plants',
      'furniture:window-dressing',
      'furniture:table-setting',
      'furniture:counter-stools',
    ];

    for (const year of YEAR_IDS) {
      const spec = furnitureSpec(year);
      const eraModule = createFurnitureModule({ initialYear: year });
      const hotspots = eraModule.getHotspots();
      const ids = hotspots.map((hotspot) => hotspot.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of canonical) {
        expect(ids, `${year} is missing ${id}`).toContain(id);
      }
      if (spec.seating.lounge) {
        expect(ids).toContain('furniture:lounge');
      }
      if (spec.seating.standingRail) {
        expect(ids).toContain('furniture:standing-rail');
      }
      for (const hotspot of hotspots) {
        expect(hotspot.moduleId).toBe(FURNITURE_MODULE_ID);
        expect(hotspot.year).toBe(year);
        expect(hotspot.label.length).toBeGreaterThan(4);
        expect(hotspot.description ?? '').toContain(year);
        expect(hotspot.radius).toBeGreaterThan(0);
        expect(hotspot.position.y).toBeGreaterThanOrEqual(0);
        expect(hotspot.position.y).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.height);
        expect(Math.abs(hotspot.position.x)).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.width / 2);
        expect(Math.abs(hotspot.position.z)).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.depth / 2);
      }
    }
  });

  it('anchors the landmarks to the built nodes without touching the core registry', () => {
    const kernel = headlessKernel();
    const module = createFurnitureModule();
    buildOnce(kernel, module);
    const hotspots = module.getHotspots();
    const counter = hotspots.find((hotspot) => hotspot.id === 'furniture:counter-front');
    const booth = hotspots.find((hotspot) => hotspot.id === 'furniture:booth-seating');
    const coatStand = hotspots.find((hotspot) => hotspot.id === 'furniture:coat-stand');
    const phone = hotspots.find((hotspot) => hotspot.id === 'furniture:payphone');

    expect(counter?.anchor).toBe(module.landmarks.get('counter-front'));
    expect(booth?.anchor).toBe(module.landmarks.get('booth'));
    expect(coatStand?.anchor).toBe(module.landmarks.get('coat-stand'));
    expect(phone?.anchor).toBe(module.landmarks.get('payphone'));
    expect(counter?.kind).toBe('interactive');

    // The hotspot registry lives in `src/core`; this module only reports.
    expect(Object.isFrozen(hotspots)).toBe(true);
    const now = module.getHotspots();
    expect(now.map((hotspot) => hotspot.id)).toEqual(hotspots.map((hotspot) => hotspot.id));
  });


  it('can be framed up close from the standard camera rig in every era', () => {
    const view = defaultInteriorView(CAFE_ROOM_BOUNDS);
    const camera = new THREE.PerspectiveCamera(view.fov ?? 58, 16 / 9, 0.1, 120);
    const target = new THREE.Vector3();
    const frustum = new THREE.Frustum();
    const matrix = new THREE.Matrix4();

    for (const year of YEAR_IDS) {
      const module = createFurnitureModule({ initialYear: year });
      for (const hotspot of module.getHotspots()) {
        // The rig stands at the standard interior viewpoint and aims at the
        // landmark: the landmark must land inside the frustum, at a close-up
        // distance, so inspect mode can frame it.
        camera.position.set(view.position.x, view.position.y, view.position.z);
        target.set(hotspot.position.x, hotspot.position.y, hotspot.position.z);
        camera.lookAt(target);
        camera.updateMatrixWorld(true);
        frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        expect(frustum.containsPoint(target), `${year} cannot frame ${hotspot.id}`).toBe(true);
        const distance = camera.position.distanceTo(target);
        expect(distance, `${year} ${hotspot.id}`).toBeGreaterThan(0.4);
        expect(distance, `${year} ${hotspot.id}`).toBeLessThan(CAFE_ROOM_BOUNDS.depth + 2);
      }
    }
  });

  it('moves the hotspot set with the era', () => {
    const kernel = headlessKernel();
    const module = createFurnitureModule();
    buildOnce(kernel, module);
    const before = module.getHotspots().find((hotspot) => hotspot.id === 'furniture:payphone')?.label;
    module.applyPeriod(periodFor('2025'), kernel.createBuildContext(periodFor('2025')));
    const after = module.getHotspots().find((hotspot) => hotspot.id === 'furniture:payphone')?.label;
    expect(before).not.toBe(after);
    expect(after).toContain('wall phone');
  });
});

/* -------------------------------------------------------------------------- */
/* No external assets                                                         */
/* -------------------------------------------------------------------------- */

describe('no network or filesystem asset loading', () => {
  it('builds every era from procedural pixels only', () => {
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch: unknown }).fetch = fetchSpy;
    let xhrConstructions = 0;
    let imageConstructions = 0;
    const originalXhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
    const originalImage = (globalThis as { Image?: unknown }).Image;
    class TrackingXhr {
      constructor() {
        xhrConstructions += 1;
      }
    }
    class TrackingImage {
      constructor() {
        imageConstructions += 1;
      }
    }
    (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = TrackingXhr;
    (globalThis as { Image: unknown }).Image = TrackingImage;
    const textureLoader = vi.spyOn(THREE.TextureLoader.prototype, 'load');
    const imageLoader = vi.spyOn(THREE.ImageLoader.prototype, 'load');
    const fileLoader = vi.spyOn(THREE.FileLoader.prototype, 'load');
    const bufferLoader = vi.spyOn(THREE.BufferGeometryLoader.prototype, 'parse');

    try {
      const kernel = headlessKernel();
      const module = createFurnitureModule();
      buildOnce(kernel, module);
      for (const year of YEAR_IDS) {
        module.applyPeriod(periodFor(year), kernel.createBuildContext(periodFor(year)));
      }

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(textureLoader).not.toHaveBeenCalled();
      expect(imageLoader).not.toHaveBeenCalled();
      expect(fileLoader).not.toHaveBeenCalled();
      expect(bufferLoader).not.toHaveBeenCalled();
      expect(xhrConstructions).toBe(0);
      expect(imageConstructions).toBe(0);
      expect(typeof document).toBe('undefined');

      // The set ships all 31 surfaces; the scene references the ones the era
      // actually uses, and every one of them is a procedural texture.
      expect(module.materialSet?.textures.length).toBe(FURNITURE_MATERIAL_SLOTS.length);
      const textures = texturesOf(module.root as THREE.Object3D);
      expect(textures.length).toBeGreaterThanOrEqual(12);
      for (const texture of textures) {
        expect(isFurnitureTexture(texture)).toBe(true);
        expect(texture.userData).toMatchObject({ furniture: { procedural: true, source: 'data' } });
      }

      // The module never asks a GPU for anything: the kernel stayed headless.
      expect(kernel.headless).toBe(true);
      expect(kernel.renderer).toBeNull();
    } finally {
      (globalThis as { fetch: unknown }).fetch = originalFetch;
      (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = originalXhr;
      (globalThis as { Image?: unknown }).Image = originalImage;
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Dispose                                                                    */
/* -------------------------------------------------------------------------- */

describe('dispose: clean teardown', () => {
  it('returns the scene graph to the pre-build baseline and releases everything', () => {
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose');
    const textureDispose = vi.spyOn(THREE.Texture.prototype, 'dispose');

    const kernel = headlessKernel();
    const baseline = countNodes(kernel.scene);
    const module = createFurnitureModule();
    buildOnce(kernel, module);

    const set = module.materialSet;
    if (!set) throw new Error('the module must hold a material set after build');
    const root = module.root as THREE.Object3D;
    const geometries = new Set<THREE.BufferGeometry>();
    for (const mesh of meshesOf(root)) geometries.add(mesh.geometry);

    module.dispose();

    expect(countNodes(kernel.scene)).toBe(baseline);
    expect(module.root).toBeUndefined();
    expect(module.built).toBe(false);
    expect(module.materialSet).toBeUndefined();
    expect(module.props.length).toBe(0);
    expect(module.textureSource).toBe('none');
    expect(module.placementProblems()).toEqual([]);

    const disposedGeometries = new Set(geometryDispose.mock.contexts);
    for (const geometry of geometries) {
      expect(disposedGeometries.has(geometry)).toBe(true);
    }
    const disposedMaterials = new Set(materialDispose.mock.contexts);
    for (const slot of FURNITURE_MATERIAL_SLOTS) {
      expect(disposedMaterials.has(set.slots[slot])).toBe(true);
    }
    const disposedTextures = new Set(textureDispose.mock.contexts);
    for (const texture of set.textures) {
      expect(disposedTextures.has(texture)).toBe(true);
    }

    // Idempotent, and the module can rebuild afterwards for the composition root.
    module.dispose();
    expect(countNodes(kernel.scene)).toBe(baseline);

    module.build(kernel.createBuildContext(periodFor('2025')));
    expect(countNodes(kernel.scene)).toBeGreaterThan(baseline);
    expect(module.spec?.year).toBe('2025');
    module.dispose();
    expect(countNodes(kernel.scene)).toBe(baseline);
  });

  it('releases the previous era material set when the timeline moves', () => {
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose');
    const textureDispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const kernel = headlessKernel();
    const module = createFurnitureModule();
    buildOnce(kernel, module);
    const first = module.materialSet;
    if (!first) throw new Error('the module must hold a material set after build');

    module.applyPeriod(periodFor('1985'), kernel.createBuildContext(periodFor('1985')));
    const second = module.materialSet;
    if (!second) throw new Error('the module must hold a material set after the era swap');
    expect(second).not.toBe(first);

    const disposedMaterials = new Set(materialDispose.mock.contexts);
    const disposedTextures = new Set(textureDispose.mock.contexts);
    for (const slot of FURNITURE_MATERIAL_SLOTS) {
      expect(disposedMaterials.has(first.slots[slot])).toBe(true);
      expect(disposedMaterials.has(second.slots[slot])).toBe(false);
    }
    for (const texture of first.textures) {
      expect(disposedTextures.has(texture)).toBe(true);
    }
    for (const texture of second.textures) {
      expect(disposedTextures.has(texture)).toBe(false);
    }
  });

  it('validates the room it is handed', () => {
    expect(() => new FurnitureModule({ bounds: { width: 8, depth: 11, height: 3.6 } })).toThrow();
    const module = new FurnitureModule();
    expect(module.layout.bounds).toEqual(CAFE_ROOM_BOUNDS);
    expect(module.rules.serviceLane.maxZ).toBeGreaterThan(module.rules.serviceLane.minZ);
    expect(module.rules.entranceSwing.maxZ).toBe(CAFE_ROOM_BOUNDS.depth / 2);
  });
});
