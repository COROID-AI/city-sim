/**
 * Tableware suite (headless, node).
 *
 * Everything here runs without a GPU and without a DOM, exactly the way the
 * period registry drives the domain:
 *
 *  - the five era records are checked for the resources the acceptance criteria
 *    name (heavy rationed china for 1945, a demitasse set for 1965, printed-logo
 *    stoneware for 1985, paper and corrugated takeaway for 2005, reusables and
 *    double-walled glass for 2025) and for pairwise-distinct discriminators,
 *  - the placement plan is asserted against the environment's *published*
 *    anchors: every piece names a real table slot or counter-pass slot, free
 *    pieces sit exactly on the published `surfaceHeight`, nested pieces rest on
 *    their host, nothing reaches past a table top or a pass slot, and no two
 *    free pieces intersect,
 *  - the built scene graph is asserted to be instanced (one draw call per part,
 *    not per cup), to fit the footprints the plan declared, and to expose the
 *    era's service as hotspots,
 *  - the module is driven through `applyPeriod` for all five years with the real
 *    `EnvironmentModule`, and `dispose()` is checked to release every geometry,
 *    material and procedural texture and to detach the group.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_YEAR_ID,
  YEAR_IDS,
  isSceneModule,
  type PeriodDefinition,
  type YearId,
} from '../../contracts/period';
import { createKernel, type Kernel } from '../../core/kernel';
import {
  CAFE_ROOM_BOUNDS,
  ENVIRONMENT_GROUP_NAME,
  STRUCTURAL_LAYOUT,
  createEnvironmentModule,
  environmentSpec,
  roomBoundsEqual,
} from '../environment';
import {
  COASTER_RADIUS,
  DEFAULT_TABLEWARE_SEED,
  DEFAULT_TABLEWARE_TEXTURE_SIZE,
  TABLEWARE_GROUP_NAME,
  TABLEWARE_MATERIAL_SLOTS,
  TABLEWARE_MODULE_ID,
  TABLEWARE_SPECS,
  TABLEWARE_SPEC_YEARS,
  TABLEWARE_SETTING,
  TABLEWARE_TEXTURE_PREFIX,
  TablewareModule,
  createTablewareModule,
  describeTablewareSpec,
  distinctPixelColors,
  isTablewareTexture,
  paintTablewareSurface,
  tablewareEraConflicts,
  tablewareFootprintCircumradius,
  tablewareFootprintCorners,
  tablewareFootprintReach,
  tablewareFootprintsOverlap,
  tablewareMaterialName,
  tablewarePlacementProblems,
  tablewarePlanSignature,
  tablewareSpec,
  tablewareSpecs,
  type TablewareItemKind,
  type TablewarePlacement,
  type TablewareTextureKind,
  type TablewareTextureStyle,
} from './TablewareModule';

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

function buildOnce(kernel: Kernel, module: TablewareModule, year: YearId = DEFAULT_YEAR_ID): void {
  module.build(kernel.createBuildContext(periodFor(year)));
}

function applyEra(kernel: Kernel, module: TablewareModule, year: YearId): void {
  const period = periodFor(year);
  module.applyPeriod(period, kernel.createBuildContext(period));
}

function countNodes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse(() => {
    count += 1;
  });
  return count;
}

/** Frustum of a camera, built the way the renderer builds it each frame. */
function frustumOf(camera: THREE.Camera): THREE.Frustum {
  camera.updateMatrixWorld(true);
  return new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

/** The eight corners of an axis aligned box. */
function cornersOf(box: THREE.Box3): THREE.Vector3[] {
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    }
  }
  return corners;
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  return meshes;
}

function instancedMeshesOf(root: THREE.Object3D): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.InstancedMesh).isInstancedMesh) meshes.push(object as THREE.InstancedMesh);
  });
  return meshes;
}

function texturesOf(root: THREE.Object3D): THREE.Texture[] {
  const textures = new Set<THREE.Texture>();
  for (const mesh of meshesOf(root)) {
    const material = mesh.material;
    for (const entry of Array.isArray(material) ? material : [material]) {
      const mapped = entry as THREE.MeshStandardMaterial | undefined;
      if (mapped?.map) textures.add(mapped.map);
    }
  }
  return [...textures];
}

function anchorOf(entry: TablewarePlacement): { surfaceHeight: number; id: string } | undefined {
  const table = STRUCTURAL_LAYOUT.tableSlots.find((slot) => slot.id === entry.anchorId);
  if (table) return { surfaceHeight: table.surfaceHeight, id: table.id };
  const pass = STRUCTURAL_LAYOUT.counterPassSlots.find((slot) => slot.id === entry.anchorId);
  return pass ? { surfaceHeight: pass.surfaceHeight, id: pass.id } : undefined;
}

function localPoint(slot: (typeof STRUCTURAL_LAYOUT.tableSlots)[number], x: number, z: number): { x: number; z: number } {
  const cos = Math.cos(slot.orientation);
  const sin = Math.sin(slot.orientation);
  return { x: slot.position.x + x * cos + z * sin, z: slot.position.z - x * sin + z * cos };
}

/**
 * Table-local frame of a slot: `along` is the seat axis the environment plants
 * the chairs on (the table's long side, local X) and `across` runs the length of
 * the table.
 */
function tableFrame(slot: (typeof STRUCTURAL_LAYOUT.tableSlots)[number]): (x: number, z: number) => { along: number; across: number } {
  const cos = Math.cos(slot.orientation);
  const sin = Math.sin(slot.orientation);
  return (x: number, z: number) => {
    const dx = x - slot.position.x;
    const dz = z - slot.position.z;
    return { along: dx * cos - dz * sin, across: dx * sin + dz * cos };
  };
}

interface FakeCanvasRecord {
  putImageDataCalls: number;
  images: ImageData[];
  factory: (width: number, height: number) => HTMLCanvasElement | null;
}

/** Minimal 2D canvas stand-in: enough for the procedural finish pipeline. */
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

/** Every counter-pass stack kind the plan may place on a pass slot. */
const PASS_ITEM_KINDS: readonly string[] = Object.freeze([
  'saucer-stack',
  'cup-stack',
  'demitasse-stack',
  'mug-stack',
  'tumbler-row',
  'paper-cup-stack',
  'corrugated-cup-stack',
  'lid-stack',
  'sleeve-stack',
  'stirrer-cup',
  'reusable-cup-stack',
  'glass-rack',
  'tray-stack',
  'cutlery-caddy',
  'napkin-stack',
]);

/* -------------------------------------------------------------------------- */
/* Era data                                                                   */
/* -------------------------------------------------------------------------- */

describe('era data: five period-correct tableware records', () => {
  it('covers exactly the five selectable years with distinct discriminators', () => {
    expect(TABLEWARE_SPEC_YEARS).toEqual([...YEAR_IDS]);
    expect(Object.keys(TABLEWARE_SPECS)).toEqual([...YEAR_IDS]);

    for (const spec of tablewareSpecs()) {
      expect(spec.year).toBe(tablewareSpec(spec.year).year);
      expect(spec.summary.length).toBeGreaterThan(30);
      expect(spec.notes.length).toBeGreaterThanOrEqual(3);
      expect(spec.tags.length).toBeGreaterThanOrEqual(4);
      expect(Object.keys(spec.surfaces).sort()).toEqual([...TABLEWARE_MATERIAL_SLOTS].sort());
      expect(spec.materialSetId).toContain(spec.year);
    }

    expect(() => tablewareSpec('1975' as YearId)).toThrow();

    // Two eras may never read as the same service.
    const summaries = tablewareSpecs().map((spec) => describeTablewareSpec(spec));
    for (let a = 0; a < summaries.length; a += 1) {
      for (let b = a + 1; b < summaries.length; b += 1) {
        const left = summaries[a];
        const right = summaries[b];
        if (!left || !right) continue;
        expect(tablewareEraConflicts(left, right), `${left.year} vs ${right.year}`).toEqual([]);
      }
    }
  });

  it('sets 1945 with heavy china, plated cutlery and a rationed pour', () => {
    const spec = tablewareSpec('1945');
    expect(spec.vessels.cup.kind).toBe('china-cup');
    expect(spec.vessels.cup.rest).toBe('saucer');
    expect(spec.vessels.cup.wall).toBeGreaterThan(0.004);
    expect(spec.vessels.cup.fillFraction).toBeLessThan(0.7);
    expect(spec.vessels.takeaway).toBeNull();
    expect(spec.vessels.espresso).toBeNull();
    expect(spec.vessels.tumbler?.kind).toBe('glass-tumbler');
    expect(spec.tableService.cutlery.length).toBeGreaterThanOrEqual(2);
    expect(spec.tableService.cutlery.every((piece) => piece.metalSlot === 'plated')).toBe(true);
    expect(spec.tableService.teaspoon.metalSlot).toBe('plated');
    expect(spec.tableService.tray?.style).toBe('enamel-metal');
    expect(spec.tableService.ashtray?.style).toBe('thick-glass');
    expect(spec.tableService.sugarBowl.fillFraction).toBeLessThan(0.5);

    // Rationing is what makes the 1945 pour unique: every later era pours more.
    for (const year of YEAR_IDS) {
      if (year === '1945') continue;
      expect(tablewareSpec(year).vessels.cup.fillFraction).toBeGreaterThan(
        spec.vessels.cup.fillFraction,
      );
    }
  });

  it('sets 1965 with narrow rims, demitasse sets and slim stainless', () => {
    const spec = tablewareSpec('1965');
    expect(spec.vessels.cup.kind).toBe('narrow-rim-cup');
    expect(spec.vessels.cup.rimDiameter).toBeLessThan(tablewareSpec('1945').vessels.cup.rimDiameter);
    expect(spec.vessels.espresso?.kind).toBe('demitasse-cup');
    expect(spec.vessels.espresso?.rest).toBe('saucer');
    expect(spec.vessels.espresso?.fillFraction).toBeGreaterThan(0.7);
    expect(spec.tableService.cutlery.every((piece) => piece.metalSlot === 'steel')).toBe(true);
    expect(spec.tableService.cutlery.every((piece) => piece.handleSlot === null)).toBe(true);
    expect(spec.tableService.sugarBowl.style).toBe('loose-in-ceramic');
    expect(spec.tableService.napkinHolder.style).toBe('chrome-stand');
    expect(spec.tableService.ashtray?.style).toBe('stainless');
    expect(spec.tableService.tray?.style).toBe('stainless-waitress');
  });

  it('sets 1985 with thick stoneware, printed logos and glass tumblers', () => {
    const spec = tablewareSpec('1985');
    expect(spec.vessels.cup.kind).toBe('stoneware-mug');
    expect(spec.vessels.cup.handle).toBe('chunky-loop');
    expect(spec.vessels.cup.printSlot).not.toBeNull();
    expect(spec.vessels.cup.mark).toBeTruthy();
    expect(spec.vessels.tumbler?.kind).toBe('glass-tumbler');
    expect(spec.vessels.tumbler?.printSlot).not.toBeNull();
    expect(spec.tableService.cutlery.some((piece) => piece.handleSlot === 'bakelite')).toBe(true);
    expect(spec.tableService.napkinHolder.style).toBe('printed-dispenser');
    expect(spec.tableService.sugarBowl.style).toBe('sachets-in-stoneware');
    expect(spec.tableService.ashtray?.style).toBe('moulded-plastic');
    expect(spec.counterPass.stacks.map((stack) => stack.kind)).toContain('mug-stack');
    expect(spec.counterPass.stacks.map((stack) => stack.kind)).toContain('tumbler-row');
  });

  it('sets 2005 with paper and corrugated takeaway cups, sleeves and stirrers', () => {
    const spec = tablewareSpec('2005');
    expect(spec.vessels.cup.kind).toBe('paper-cup');
    expect(spec.vessels.cup.sleeve).toBe('printed-sleeve');
    expect(spec.vessels.cup.printSlot).not.toBeNull();
    expect(spec.vessels.takeaway?.kind).toBe('corrugated-cup');
    expect(spec.vessels.takeaway?.lid).toBe('plastic-lid');
    expect(spec.vessels.takeaway?.sleeve).toBe('printed-sleeve');
    expect(spec.tableService.teaspoon.metalSlot).toBe('plastic');
    expect(spec.tableService.condimentCaddy.sachets).toBe(true);
    expect(spec.tableService.condimentCaddy.stirrers).toBeGreaterThan(0);
    expect(spec.tableService.creamer.style).toBe('single-serve-pots');

    const stacks = spec.counterPass.stacks.map((stack) => stack.kind);
    for (const kind of ['paper-cup-stack', 'lid-stack', 'sleeve-stack', 'stirrer-cup', 'corrugated-cup-stack']) {
      expect(stacks, kind).toContain(kind);
    }
  });

  it('sets 2025 with reusables, double-walled glass and a lidded cup, and no ashtrays', () => {
    const spec = tablewareSpec('2025');
    expect(spec.vessels.cup.kind).toBe('reusable-cup');
    expect(spec.vessels.cup.lid).toBe('reusable-lid');
    expect(spec.vessels.cup.sleeve).toBe('silicone-band');
    expect(spec.vessels.tumbler?.kind).toBe('double-walled-glass');
    expect(spec.vessels.takeaway?.kind).toBe('lidded-cup');
    expect(spec.vessels.takeaway?.lid).toBe('reusable-lid');
    expect(spec.tableService.cutlery.every((piece) => piece.handleSlot === 'wood')).toBe(true);
    expect(spec.tableService.condimentCaddy.sachets).toBe(false);
    expect(spec.tableService.condimentCaddy.stirrers).toBe(0);
    expect(spec.tableService.napkinHolder.style).toBe('timber-stack');
    expect(spec.tableService.ashtray).toBeNull();
    expect(spec.tableService.tray?.style).toBe('recycled-plastic');

    const stacks = spec.counterPass.stacks.map((stack) => stack.kind);
    for (const kind of ['reusable-cup-stack', 'glass-rack', 'lid-stack', 'cutlery-caddy']) {
      expect(stacks, kind).toContain(kind);
    }
    expect(stacks).not.toContain('paper-cup-stack');
    expect(stacks).not.toContain('sleeve-stack');
  });

  it('keeps the single-use wares out of the eras that never had them', () => {
    for (const year of ['1945', '1965'] as const) {
      const spec = tablewareSpec(year);
      expect(spec.vessels.takeaway, year).toBeNull();
      expect(spec.tableService.condimentCaddy.sachets, year).toBe(false);
      expect(spec.tableService.condimentCaddy.stirrers, year).toBe(0);
    }
    for (const year of ['1945', '1965', '1985'] as const) {
      expect(tablewareSpec(year).tableService.ashtray, year).not.toBeNull();
      expect(tablewareSpec(year).vessels.cup.lid, year).toBe('none');
    }
    // Ashtrays survive into 2005 and disappear entirely from 2025.
    expect(tablewareSpec('2005').tableService.ashtray).not.toBeNull();
    expect(tablewareSpec('2025').tableService.ashtray).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Placement plan                                                             */
/* -------------------------------------------------------------------------- */

describe('placement: every piece anchored to the environment layout', () => {
  it('names a published anchor for every piece, in all five eras', () => {
    const module = createTablewareModule();
    for (const year of YEAR_IDS) {
      const plan = module.eraPlan(year);
      expect(plan.year).toBe(year);
      expect(plan.entries.length).toBeGreaterThan(120);
      expect(plan.counterPass.length).toBeGreaterThanOrEqual(6);
      expect(plan.anchorIds.length).toBe(STRUCTURAL_LAYOUT.tableSlots.length + 2);

      for (const entry of plan.entries) {
        const anchor = anchorOf(entry);
        expect(anchor, `${year} ${entry.id}`).toBeDefined();
        expect(entry.surface).toBe(anchor?.surfaceHeight);
        expect(entry.footprint.halfWidth).toBeGreaterThan(0);
        expect(entry.footprint.halfLength).toBeGreaterThan(0);
        if (entry.zone === 'table-setting') {
          expect(entry.anchorKind).toBe('table-slot');
        } else {
          expect(entry.anchorKind).toBe('counter-pass');
          expect(PASS_ITEM_KINDS, entry.id).toContain(entry.kind);
        }
      }

      // Every table slot and every pass slot the module uses is published.
      for (const anchorId of plan.anchorIds) {
        const published =
          STRUCTURAL_LAYOUT.tableSlots.some((slot) => slot.id === anchorId) ||
          STRUCTURAL_LAYOUT.counterPassSlots.some((slot) => slot.id === anchorId);
        expect(published, anchorId).toBe(true);
      }

      // Two seats at eight tables: the era's cup appears sixteen times.
      expect(module.eraPlan(year).entries.filter((entry) => entry.kind === 'cup').length).toBe(16);
    }
  });

  it('sits flush on the published surface heights with nothing floating', () => {
    const module = createTablewareModule();
    for (const year of YEAR_IDS) {
      const plan = module.eraPlan(year);
      expect(tablewarePlacementProblems(plan, STRUCTURAL_LAYOUT, CAFE_ROOM_BOUNDS)).toEqual([]);

      for (const entry of plan.entries) {
        const anchor = anchorOf(entry);
        if (entry.nestedIn === null) {
          expect(entry.position.y, `${year} ${entry.id}`).toBeCloseTo(anchor?.surfaceHeight ?? 0, 9);
        } else {
          const host = plan.entries.find((candidate) => candidate.id === entry.nestedIn);
          expect(host, `${year} ${entry.id}`).toBeDefined();
          expect(entry.position.y, entry.id).toBeGreaterThanOrEqual(host?.position.y ?? 0);
        }
        // Nothing is below the floor and nothing pokes through the ceiling.
        expect(entry.position.y).toBeGreaterThanOrEqual(0);
        expect(entry.position.y + entry.height).toBeLessThan(CAFE_ROOM_BOUNDS.height);
      }

      // Free pieces never intersect each other on the same anchor.
      const free = plan.entries.filter((entry) => entry.nestedIn === null);
      for (let a = 0; a < free.length; a += 1) {
        for (let b = a + 1; b < free.length; b += 1) {
          const left = free[a];
          const right = free[b];
          if (!left || !right || left.anchorId !== right.anchorId) continue;
          expect(
            tablewareFootprintsOverlap(left, right),
            `${year} ${left.id} vs ${right.id}`,
          ).toBe(false);
        }
      }
    }
  });

  it('keeps every table piece inside the table top and every pass piece inside its slot', () => {
    const module = createTablewareModule();
    for (const year of YEAR_IDS) {
      const plan = module.eraPlan(year);

      for (const entry of plan.tableSettings) {
        if (entry.nestedIn !== null) continue;
        const slot = STRUCTURAL_LAYOUT.tableSlots.find((candidate) => candidate.id === entry.anchorId);
        if (!slot) throw new Error(`unknown table slot ${entry.anchorId}`);
        const reach = tablewareFootprintReach(entry, slot.position.x, slot.position.z);
        expect(reach, `${year} ${entry.id}`).toBeLessThanOrEqual(TABLEWARE_SETTING.maxReach + 1e-9);
        // A 0.72 m round top is the smallest the furniture module builds, so the
        // whole setting (including cutlery tips) stays inside a 0.36 m radius.
        expect(reach, `${year} ${entry.id}`).toBeLessThanOrEqual(0.36);      }

      for (const entry of plan.counterPass) {
        const slot = STRUCTURAL_LAYOUT.counterPassSlots.find(
          (candidate) => candidate.id === entry.anchorId,
        );
        if (!slot) throw new Error(`unknown counter-pass slot ${entry.anchorId}`);
        expect(['tray-run', 'handoff'], entry.anchorId).toContain(slot.kind);
        for (const corner of tablewareFootprintCorners(
          entry.position.x,
          entry.position.z,
          entry.rotationY,
          entry.footprint,
        )) {
          expect(Math.abs(corner.x - slot.position.x)).toBeLessThanOrEqual(slot.width / 2);
          expect(Math.abs(corner.z - slot.position.z)).toBeLessThanOrEqual(slot.depth / 2);
        }
      }
    }
  });

  it('seats the cover on the table’s long side with the cutlery to hand', () => {
    const module = createTablewareModule();
    for (const year of YEAR_IDS) {
      const plan = module.eraPlan(year);
      for (const slot of STRUCTURAL_LAYOUT.tableSlots) {
        const toLocal = tableFrame(slot);
        const entries = plan.tableSettings.filter((entry) => entry.anchorId === slot.id);
        for (let seat = 0; seat < slot.seats; seat += 1) {
          const seatSign = seat === 0 ? 1 : -1;
          const prefix = `${slot.id}:seat-${seat + 1}`;
          const cup = entries.find((entry) => entry.id === `${prefix}:cup`);
          const teaspoon = entries.find((entry) => entry.id === `${prefix}:teaspoon`);
          const knife = entries.find((entry) => entry.kind === 'knife' && entry.id.startsWith(prefix));
          const fork = entries.find((entry) => entry.kind === 'fork' && entry.id.startsWith(prefix));
          expect(cup, `${year} ${prefix}`).toBeDefined();
          expect(teaspoon, `${year} ${prefix}`).toBeDefined();
          expect(knife, `${year} ${prefix}`).toBeDefined();
          expect(fork, `${year} ${prefix}`).toBeDefined();
          if (!cup || !teaspoon || !knife || !fork) continue;

          // The cover sits on the seat axis — the table's long side, which is
          // exactly where the environment's chair plan plants the chairs.
          const cover = toLocal(cup.position.x, cup.position.z);
          expect(cover.along, `${year} ${prefix}`).toBeCloseTo(
            seatSign * TABLEWARE_SETTING.coverOffset,
            9,
          );
          expect(Math.abs(cover.across), `${year} ${prefix}`).toBeLessThan(1e-9);

          // The cup stands on its own rest, which itself sits on the table.
          if (cup.nestedIn !== null) {
            const rest = entries.find((entry) => entry.id === cup.nestedIn);
            expect(rest, `${year} ${prefix}`).toBeDefined();
            expect(rest?.position.y).toBeCloseTo(slot.surfaceHeight, 9);
            expect(cup.position.y).toBeGreaterThan(rest?.position.y ?? 0);
          } else {
            expect(cup.position.y).toBeCloseTo(slot.surfaceHeight, 9);
          }

          // Cutlery lies beside the cover, across the seat axis, and the
          // teaspoon is no further from the table centre than the cup.
          for (const piece of [knife, fork]) {
            const local = toLocal(piece.position.x, piece.position.z);
            expect(Math.abs(local.along - cover.along), piece.id).toBeLessThan(1e-9);
            expect(Math.abs(local.across), piece.id).toBeGreaterThan(0.08);
          }
          const teaspoonOffset = Math.hypot(
            teaspoon.position.x - slot.position.x,
            teaspoon.position.z - slot.position.z,
          );
          const cupOffset = Math.hypot(
            cup.position.x - slot.position.x,
            cup.position.z - slot.position.z,
          );
          expect(teaspoonOffset, `${year} ${prefix}`).toBeLessThanOrEqual(cupOffset + 0.16);

          // Every item on the cover is turned to the seat it serves.
          const expectedYaw = slot.orientation + (seat === 0 ? Math.PI / 2 : -Math.PI / 2);
          expect(Math.abs(Math.cos(cup.rotationY - expectedYaw) - 1)).toBeLessThan(1e-9);
          expect(Math.abs(Math.cos(knife.rotationY - (expectedYaw + Math.PI)) - 1)).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('is deterministic: the same era plans the same table every time', () => {
    const module = createTablewareModule();
    for (const year of YEAR_IDS) {
      const first = module.eraPlan(year);
      const second = createTablewareModule().eraPlan(year);
      expect(first.signature).toBe(second.signature);
      expect(tablewarePlanSignature(first.entries)).toBe(first.signature);
    }
    expect(module.eraPlan('1985').signature).not.toBe(module.eraPlan('2025').signature);
    expect(DEFAULT_TABLEWARE_SEED).toBeGreaterThan(0);
  });

  it('flags a plan that would float, overhang or collide', () => {
    const module = createTablewareModule();
    const plan = module.eraPlan('1985');
    const first = plan.entries[0];
    if (!first) throw new Error('the 1985 plan must place something');
    const floated: TablewarePlacement = { ...first, position: first.position.clone().setY(first.position.y + 0.05) };
    const problems = tablewarePlacementProblems(
      { ...plan, entries: [floated, ...plan.entries.slice(1)] },
      STRUCTURAL_LAYOUT,
      CAFE_ROOM_BOUNDS,
    );
    expect(problems.some((problem) => problem.includes('flush'))).toBe(true);

    const floating = tablewarePlacementProblems(plan, STRUCTURAL_LAYOUT, CAFE_ROOM_BOUNDS);
    expect(floating).toEqual([]);
  });

  it('places the counter-pass stacks on the tray run and handoff anchors', () => {
    const module = createTablewareModule();
    for (const year of YEAR_IDS) {
      const plan = module.eraPlan(year);
      const used = new Set(plan.counterPass.map((entry) => entry.anchorId));
      expect(used.size).toBeGreaterThanOrEqual(2);
      for (const entry of plan.counterPass) {
        const anchor = anchorOf(entry);
        expect(entry.position.y).toBeCloseTo(anchor?.surfaceHeight ?? 0, 9);
        expect(entry.pieces).toBeGreaterThanOrEqual(1);
      }
      // The cup stacks the criteria ask for are always on the pass.
      const cupStacks = plan.counterPass.filter((entry) =>
        ['cup-stack', 'mug-stack', 'demitasse-stack', 'paper-cup-stack', 'reusable-cup-stack'].includes(
          entry.kind,
        ),
      );
      expect(cupStacks.length, year).toBeGreaterThanOrEqual(1);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Materials and surfaces                                                     */
/* -------------------------------------------------------------------------- */

describe('materials: procedural surfaces for every era', () => {
  it('builds one named, procedural material per slot for every year', () => {
    const kernel = headlessKernel();
    const module = createTablewareModule();
    const signatures = new Set<string>();

    for (const year of YEAR_IDS) {
      applyEra(kernel, module, year);
      const set = module.materialSet;
      if (!set) throw new Error('the module must hold a material set after a build');
      expect(set.year).toBe(year);
      expect(set.textures.length).toBe(TABLEWARE_MATERIAL_SLOTS.length);
      expect(set.textureSource).toBe('data');
      for (const slot of TABLEWARE_MATERIAL_SLOTS) {
        const material = set.slots[slot] as THREE.MeshStandardMaterial;
        expect(material.name).toBe(tablewareMaterialName(year, slot));
        expect(material.map, `${year} ${slot}`).toBeTruthy();
        expect(isTablewareTexture(material.map as THREE.Texture)).toBe(true);
        expect(material.map?.name.startsWith(`${TABLEWARE_TEXTURE_PREFIX}${year}:`)).toBe(true);
        expect(material.roughness).toBeGreaterThanOrEqual(0);
        expect(material.roughness).toBeLessThanOrEqual(1);
        expect(material.metalness).toBeGreaterThanOrEqual(0);
        expect(material.metalness).toBeLessThanOrEqual(1);
      }

      // Restrained material physics: glass reads as glass, stainless as metal.
      const glass = set.slots['glass'] as THREE.MeshStandardMaterial;
      expect(glass.transparent).toBe(true);
      expect(glass.roughness).toBeLessThan(0.15);
      expect((set.slots['steel'] as THREE.MeshStandardMaterial).metalness).toBeGreaterThanOrEqual(0.6);
      expect((set.slots['china'] as THREE.MeshStandardMaterial).roughness).toBeLessThan(0.45);
      expect((set.slots['corrugated'] as THREE.MeshStandardMaterial).roughness).toBeGreaterThan(0.7);

      signatures.add(module.materialSignature ?? '');
      module.dispose();
    }
    expect(signatures.size).toBe(YEAR_IDS.length);
  });

  it('paints visibly different pixel content per surface family', () => {
    const kinds: TablewareTextureKind[] = [
      'glaze',
      'stoneware',
      'glass',
      'paper',
      'flute',
      'card',
      'plastic',
      'steel',
      'plated',
      'enamel',
      'chrome',
      'bakelite',
      'wood',
      'weave',
      'print',
      'granular',
      'rubber',
      'sauce',
    ];
    const signatures = new Set<string>();
    for (const kind of kinds) {
      const raster = paintTablewareSurface({
        kind,
        palette: { base: '#c9c2ad', accent: '#6d5136', detail: '#4a3a2c', highlight: '#fdf8ee' },
        scale: 5,
        contrast: 0.2,
        size: 64,
        mark: 'CAFE',
      });
      expect(raster.width).toBe(64);
      expect(raster.height).toBe(64);
      expect(distinctPixelColors(raster)).toBeGreaterThan(6);
      const sample = Array.from({ length: 24 }, (_unused, index) => raster.data[index * 41] ?? 0).join(',');
      signatures.add(`${kind}:${sample}`);
    }
    expect(signatures.size).toBe(kinds.length);
  });

  it('paints deterministically and seeds the pattern from the style', () => {
    const style: TablewareTextureStyle = {
      kind: 'paper',
      palette: { base: '#f2ece0', accent: '#8a7657' },
      scale: 4,
      size: 48,
      mark: 'CAFE',
    };
    const first = paintTablewareSurface(style);
    const second = paintTablewareSurface(style);
    expect(first.data).toEqual(second.data);
    const other = paintTablewareSurface({ ...style, mark: 'LANE' });
    expect(other.data).not.toEqual(first.data);
    const seeded = paintTablewareSurface({ ...style, seed: 1234 });
    const otherSeed = paintTablewareSurface({ ...style, seed: 4321 });
    expect(seeded.data).not.toEqual(otherSeed.data);
    expect(DEFAULT_TABLEWARE_TEXTURE_SIZE).toBeGreaterThanOrEqual(64);
  });

  it('uses the canvas backend when a 2D canvas is available', () => {
    const record = createFakeCanvas();
    const kernel = headlessKernel();
    const module = createTablewareModule({ canvasFactory: record.factory });
    buildOnce(kernel, module);

    expect(module.textureSource).toBe('canvas');
    expect(record.putImageDataCalls).toBeGreaterThanOrEqual(TABLEWARE_MATERIAL_SLOTS.length);
    const material = module.materialSet?.slots.paper as THREE.MeshStandardMaterial;
    expect(material.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(material.map?.name).toBe(`${TABLEWARE_TEXTURE_PREFIX}1945:paper`);
    expect(record.images.length).toBeGreaterThan(0);
    const image = record.images[0];
    expect(image).toBeTruthy();
    const distinct = new Set<number>();
    const data = image?.data ?? new Uint8ClampedArray();
    for (let offset = 0; offset < data.length; offset += 4) {
      distinct.add(((data[offset] ?? 0) << 16) | ((data[offset + 1] ?? 0) << 8) | (data[offset + 2] ?? 0));
    }
    expect(distinct.size).toBeGreaterThan(4);
  });
});

/* -------------------------------------------------------------------------- */
/* Module behaviour                                                           */
/* -------------------------------------------------------------------------- */

describe('module: build, era swap, update and diagnostics', () => {
  it('implements the SceneModule contract and rebuilds for all five eras', () => {
    const kernel = headlessKernel();
    const module = createTablewareModule();
    expect(isSceneModule(module)).toBe(true);
    expect(module.id).toBe(TABLEWARE_MODULE_ID);
    expect(module.built).toBe(false);
    expect(module.root).toBeUndefined();
    expect(module.updateCount).toBe(0);

    const inventories = new Set<string>();
    for (const year of YEAR_IDS) {
      applyEra(kernel, module, year);
      expect(module.built).toBe(true);
      expect(module.spec?.year).toBe(year);
      expect((module.root as THREE.Object3D).name).toBe(TABLEWARE_GROUP_NAME);

      const description = module.describe();
      expect(description.year).toBe(year);
      expect(description.nodeCount).toBeGreaterThan(10);
      expect(description.meshCount).toBeGreaterThan(10);
      expect(description.instanceCount).toBeGreaterThanOrEqual(description.placementCount);
      expect(description.placementCount).toBeGreaterThan(120);
      expect(description.variantCount).toBeGreaterThan(8);
      expect(description.placementProblems).toEqual([]);
      expect(description.summary.year).toBe(year);
      expect(module.placementProblems()).toEqual([]);
      inventories.add(
        [...new Set(module.placements.map((entry) => entry.variant))].sort().join('|'),
      );
      module.dispose();
      expect(module.built).toBe(false);
    }
    expect(inventories.size).toBe(YEAR_IDS.length);
  });

  it('replaces the era instead of accumulating it', () => {
    const kernel = headlessKernel();
    const baseline = countNodes(kernel.scene);
    const module = createTablewareModule();
    buildOnce(kernel, module, '1945');
    expect(countNodes(kernel.scene)).toBeGreaterThan(baseline);

    const tablewareGroups = (): THREE.Object3D[] =>
      kernel.world.children.filter((child) => child.name === TABLEWARE_GROUP_NAME);
    expect(tablewareGroups().length).toBe(1);

    for (let pass = 0; pass < 2; pass += 1) {
      for (const year of YEAR_IDS) {
        applyEra(kernel, module, year);
        expect(tablewareGroups().length, year).toBe(1);
        expect(module.spec?.year).toBe(year);

        // Every material still in the scene belongs to the era we just raised:
        // nothing from the previous table survives the swap.
        const materialNames = new Set<string>();
        for (const mesh of meshesOf(module.root as THREE.Object3D)) {
          const material = mesh.material;
          for (const entry of Array.isArray(material) ? material : [material]) {
            if (entry) materialNames.add(entry.name);
          }
        }
        expect(materialNames.size).toBeGreaterThan(0);
        for (const name of materialNames) {
          expect(name.startsWith(`tableware:${year}:`), `${name} at ${year}`).toBe(true);
        }
      }
    }

    module.dispose();
    expect(tablewareGroups().length).toBe(0);
    expect(countNodes(kernel.scene)).toBe(baseline);
  });

  it('advances time without disturbing the table', () => {
    const kernel = headlessKernel();
    const module = createTablewareModule();
    buildOnce(kernel, module, '1985');
    const before = module.describe();
    const glass = module.materialSet?.slots.glass as THREE.MeshStandardMaterial;
    const baseRoughness = glass.roughness;

    module.update(0.5, { year: '1985', elapsedSeconds: 0.5, frame: 1 });
    module.update(0.5, { year: '1985', elapsedSeconds: 1, frame: 2 });

    expect(module.updateCount).toBe(2);
    const after = module.describe();
    expect(after.instanceCount).toBe(before.instanceCount);
    expect(after.placementCount).toBe(before.placementCount);
    expect(glass.roughness).not.toBe(baseRoughness);
    expect(Math.abs(glass.roughness - baseRoughness)).toBeLessThanOrEqual(0.02);

    module.dispose();
    expect(module.updateCount).toBe(2);
  });

  it('validates the room and layout it is handed', () => {
    expect(() => new TablewareModule({ bounds: { width: 8, depth: 11, height: 3.6 } })).toThrow();
    const module = new TablewareModule();
    expect(module.bounds).toEqual(CAFE_ROOM_BOUNDS);
    expect(module.layout.bounds).toEqual(CAFE_ROOM_BOUNDS);
  });

  it('exposes the era service as hotspots, before and after a build', () => {
    const kernel = headlessKernel();
    const module = createTablewareModule();
    const ids = new Set<string>();

    // Hotspots work from the derived plan even before anything is raised.
    expect(module.getHotspots().length).toBeGreaterThanOrEqual(3);

    for (const year of YEAR_IDS) {
      applyEra(kernel, module, year);
      const hotspots = module.getHotspots();
      expect(hotspots.length).toBeGreaterThanOrEqual(3);
      for (const hotspot of hotspots) {
        expect(hotspot.moduleId).toBe(TABLEWARE_MODULE_ID);
        expect(hotspot.year).toBe(year);
        expect(hotspot.radius).toBeGreaterThan(0);
        expect(Number.isFinite(hotspot.position.x)).toBe(true);
        expect(Number.isFinite(hotspot.position.y)).toBe(true);
        expect(Number.isFinite(hotspot.position.z)).toBe(true);
        expect(hotspot.description?.length ?? 0).toBeGreaterThan(20);
        ids.add(hotspot.id);
      }
      expect(hotspots.some((hotspot) => hotspot.id === 'tableware:table-service')).toBe(true);
      expect(hotspots.some((hotspot) => hotspot.id === 'tableware:counter-pass')).toBe(true);
      expect(hotspots.some((hotspot) => hotspot.id === 'tableware:condiments')).toBe(true);
      expect(hotspots.some((hotspot) => hotspot.id === 'tableware:ashtrays')).toBe(year !== '2025');
      const packaging = hotspots.some((hotspot) => hotspot.id === 'tableware:packaging');
      expect(packaging).toBe(year === '2005' || year === '2025');
      module.dispose();
    }
    expect(ids.size).toBe(5);
  });
});

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

describe('geometry: instanced detail that fits its declared footprint', () => {
  it('instances repeated pieces instead of duplicating meshes', () => {
    const kernel = headlessKernel();
    const module = createTablewareModule();
    for (const year of YEAR_IDS) {
      applyEra(kernel, module, year);
      const root = module.root as THREE.Object3D;
      const meshes = meshesOf(root);
      const instanced = instancedMeshesOf(root);
      expect(meshes.length).toBeGreaterThan(10);
      expect(instanced.length).toBe(meshes.length);
      expect(instanced.length).toBe(module.meshCount);

      // The sixteen table settings are drawn with one mesh per part.
      const counts = instanced.map((mesh) => mesh.count);
      expect(Math.max(...counts)).toBeGreaterThanOrEqual(16);
      expect(counts.every((count) => count >= 1)).toBe(true);
      expect(instanced.every((mesh) => mesh.instanceMatrix.count === mesh.count)).toBe(true);
      expect(instanced.every((mesh) => mesh.instanceColor !== null)).toBe(true);

      // Geometry is shared between instances, not cloned per cup.
      const geometries = new Set(meshes.map((mesh) => mesh.geometry));
      expect(geometries.size).toBeLessThan(meshes.length);

      const footprints = module.itemFootprints;
      expect(Object.keys(footprints).length).toBeGreaterThan(8);
      const overflows: string[] = [];
      for (const entry of module.placements) {
        const key = `${entry.kind}:${entry.variant}`;
        const measured = footprints[key];
        expect(measured, `${year} ${key}`).toBeDefined();
        if (!measured) continue;
        // The built geometry is contained by the footprint the plan published:
        // no cup wider or taller than the clearance its setting reserved for it.
        if (measured.halfWidth > entry.footprint.halfWidth + 0.005) {
          overflows.push(
            `${key} width ${measured.halfWidth.toFixed(4)} > ${entry.footprint.halfWidth}`,
          );
        }
        if (measured.halfLength > entry.footprint.halfLength + 0.005) {
          overflows.push(
            `${key} length ${measured.halfLength.toFixed(4)} > ${entry.footprint.halfLength}`,
          );
        }
        if (measured.radius > tablewareFootprintCircumradius(entry.footprint) + 0.005) {
          overflows.push(`${key} radius ${measured.radius.toFixed(4)}`);
        }
        if (measured.height > entry.height + 0.005) {
          overflows.push(`${key} height ${measured.height.toFixed(4)} > ${entry.height}`);
        }
        expect(measured.parts, `${year} ${key}`).toBeGreaterThan(0);
        expect(measured.instances, `${year} ${key}`).toBeGreaterThan(0);
      }
      expect(overflows, year).toEqual([]);
      module.dispose();
    }
  });

  it('keeps the service in scale with the tables, the counter and the room', () => {
    const module = createTablewareModule();
    const tableTop = STRUCTURAL_LAYOUT.tableSlots[0]?.surfaceHeight ?? 0.74;
    const counterTop = STRUCTURAL_LAYOUT.counter.surfaceHeight;

    for (const year of YEAR_IDS) {
      const plan = module.eraPlan(year);
      const cup = plan.entries.find((entry) => entry.kind === 'cup');
      if (!cup) throw new Error(`${year} must set a cup on the table`);
      expect(cup.height).toBeGreaterThan(0.05);
      expect(cup.height).toBeLessThan(0.2);
      expect(cup.footprint.halfWidth).toBeLessThan(0.09);
      expect(cup.surface).toBe(tableTop);

      // Sauce, sugar and napkins are table-sized, not tray-sized.
      const caddy = plan.entries.find((entry) => entry.kind === 'condiment-caddy');
      expect(caddy?.height).toBeLessThan(0.2);
      const saucer = plan.entries.find((entry) => entry.kind === 'saucer');
      if (saucer) expect(saucer.footprint.halfWidth).toBeLessThan(0.09);
      const coaster = plan.entries.find((entry) => entry.kind === 'coaster');
      if (coaster) expect(coaster.footprint.halfWidth).toBeCloseTo(COASTER_RADIUS, 6);

      for (const entry of plan.counterPass) {
        expect(entry.surface).toBe(counterTop);
        expect(entry.height).toBeLessThan(0.3);
      }
    }
  });

  it('seats the cover on the seat axis and keeps the cluster on the centre line', () => {
    const module = createTablewareModule();
    const slot = STRUCTURAL_LAYOUT.tableSlots[0];
    if (!slot) throw new Error('the environment must publish table slots');
    const plan = module.eraPlan('1945');

    const covers = plan.tableSettings.filter(
      (entry) => entry.anchorId === slot.id && entry.id.endsWith(':cup'),
    );
    expect(covers.length).toBe(2);
    for (const cup of covers) {
      // The saucer is under the cup, concentric with it.
      const rest = plan.tableSettings.find((entry) => entry.id === cup.nestedIn);
      expect(rest).toBeDefined();
      expect(rest?.kind).toBe('saucer');
      expect(rest?.position.x).toBeCloseTo(cup.position.x, 9);
      expect(rest?.position.z).toBeCloseTo(cup.position.z, 9);
      expect(cup.nestedIn).toMatch(/^table-slot-c1-r1:seat-[12]:rest$/);
    }

    // The centre cluster the plan declares is what the module places, on the
    // centre line of the table between the two covers.
    const sugar = plan.tableSettings.find((entry) => entry.kind === 'sugar-bowl');
    const expectedSugar = localPoint(
      slot,
      TABLEWARE_SETTING.sugar.x,
      TABLEWARE_SETTING.sugar.z,
    );
    expect(sugar?.position.x).toBeCloseTo(expectedSugar.x, 9);
    expect(sugar?.position.z).toBeCloseTo(expectedSugar.z, 9);
    expect(sugar?.position.y).toBeCloseTo(slot.surfaceHeight, 9);
    const toLocal = tableFrame(slot);
    expect(Math.abs(toLocal(sugar?.position.x ?? 0, sugar?.position.z ?? 0).along)).toBeLessThan(1e-9);
  });

  it('varies the service visibly between the eras that share an anchor grid', () => {
    const module = createTablewareModule();
    const kindsPerEra = new Map<YearId, Set<TablewareItemKind>>();
    const variantsPerEra = new Map<YearId, Set<string>>();
    for (const year of YEAR_IDS) {
      const plan = module.eraPlan(year);
      kindsPerEra.set(year, new Set(plan.entries.map((entry) => entry.kind)));
      variantsPerEra.set(year, new Set(plan.entries.map((entry) => entry.variant)));
      for (const entry of plan.entries) {
        expect(
          STRUCTURAL_LAYOUT.tableSlots.some((slot) => slot.id === entry.anchorId) ||
            STRUCTURAL_LAYOUT.counterPassSlots.some((slot) => slot.id === entry.anchorId),
          `${year} ${entry.id}`,
        ).toBe(true);
      }
    }

    expect(kindsPerEra.get('1945')?.has('glass-tumbler')).toBe(true);
    expect(variantsPerEra.get('1945')?.has('china-cup')).toBe(true);
    expect(variantsPerEra.get('1965')?.has('narrow-rim-cup')).toBe(true);
    expect(kindsPerEra.get('1965')?.has('demitasse-cup')).toBe(true);
    expect(kindsPerEra.get('1965')?.has('demitasse-saucer')).toBe(true);
    expect(variantsPerEra.get('1985')?.has('stoneware-mug')).toBe(true);
    expect(kindsPerEra.get('1985')?.has('coaster')).toBe(true);
    expect(variantsPerEra.get('2005')?.has('paper-cup')).toBe(true);
    expect(kindsPerEra.get('2005')?.has('ashtray')).toBe(true);
    expect(kindsPerEra.get('2005')?.has('saucer')).toBe(false);
    expect(variantsPerEra.get('2025')?.has('reusable-cup')).toBe(true);
    expect(kindsPerEra.get('2025')?.has('double-walled-glass')).toBe(true);
    expect(kindsPerEra.get('2025')?.has('ashtray')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Assets                                                                     */
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

    try {
      const kernel = headlessKernel();
      const module = createTablewareModule();
      buildOnce(kernel, module);
      for (const year of YEAR_IDS) {
        applyEra(kernel, module, year);
      }

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(textureLoader).not.toHaveBeenCalled();
      expect(imageLoader).not.toHaveBeenCalled();
      expect(fileLoader).not.toHaveBeenCalled();
      expect(xhrConstructions).toBe(0);
      expect(imageConstructions).toBe(0);
      expect(typeof document).toBe('undefined');

      const textures = texturesOf(module.root as THREE.Object3D);
      expect(textures.length).toBeGreaterThanOrEqual(10);
      for (const texture of textures) {
        expect(isTablewareTexture(texture)).toBe(true);
        expect(texture.userData).toMatchObject({ tableware: { procedural: true, source: 'data' } });
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
    const module = createTablewareModule();
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
    expect(module.placements.length).toBe(0);
    expect(module.textureSource).toBe('none');
    expect(module.meshCount).toBe(0);
    expect(module.instanceCount).toBe(0);
    expect(Object.keys(module.itemFootprints).length).toBe(0);
    expect(module.placementProblems()).toEqual([]);

    const disposedGeometries = new Set(geometryDispose.mock.contexts);
    for (const geometry of geometries) {
      expect(disposedGeometries.has(geometry)).toBe(true);
    }
    const disposedMaterials = new Set(materialDispose.mock.contexts);
    for (const slot of TABLEWARE_MATERIAL_SLOTS) {
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
    const module = createTablewareModule();
    buildOnce(kernel, module);
    const first = module.materialSet;
    if (!first) throw new Error('the module must hold a material set after build');

    applyEra(kernel, module, '1985');
    const second = module.materialSet;
    if (!second) throw new Error('the module must hold a material set after the era swap');
    expect(second).not.toBe(first);

    const disposedMaterials = new Set(materialDispose.mock.contexts);
    const disposedTextures = new Set(textureDispose.mock.contexts);
    for (const slot of TABLEWARE_MATERIAL_SLOTS) {
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

  it('leaves no orphan after an interrupted run of era swaps', () => {
    const kernel = headlessKernel();
    const baseline = countNodes(kernel.scene);
    const module = createTablewareModule();
    for (const year of ['1945', '2025', '1965', '2005', '1985', '2025'] as const) {
      applyEra(kernel, module, year);
    }
    expect(kernel.world.children.filter((child) => child.name === TABLEWARE_GROUP_NAME).length).toBe(1);
    module.dispose();
    expect(countNodes(kernel.scene)).toBe(baseline);
    expect(kernel.world.children.length).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Composition with the real environment shell                                */
/* -------------------------------------------------------------------------- */

describe('composition: tableware over the real environment shell', () => {
  it('anchors the whole service to the published shell anchors for all five eras', () => {
    const kernel = headlessKernel();
    const baseline = countNodes(kernel.scene);
    const env = createEnvironmentModule();
    const tableware = createTablewareModule();

    env.build(kernel.createBuildContext(periodFor(DEFAULT_YEAR_ID)));
    tableware.build(kernel.createBuildContext(periodFor(DEFAULT_YEAR_ID)));

    expect(env.built).toBe(true);
    expect(tableware.built).toBe(true);
    expect(roomBoundsEqual(tableware.bounds, env.bounds, 1e-9)).toBe(true);
    expect(tableware.layout).toBe(env.layout);

    const shields: string[] = [];
    for (const year of YEAR_IDS) {
      const period = periodFor(year);
      const context = kernel.createBuildContext(period);
      env.applyPeriod(period, context);
      tableware.applyPeriod(period, context);

      // The shell still measures as the exported room every era.
      const measured = env.measuredBounds;
      expect(measured).not.toBeNull();
      expect(roomBoundsEqual(measured ?? CAFE_ROOM_BOUNDS, CAFE_ROOM_BOUNDS, 1e-3)).toBe(true);

      // The service is anchored to the published grid, flush on its surfaces.
      const plan = tableware.plan;
      expect(plan, year).toBeDefined();
      expect(tableware.placementProblems()).toEqual([]);
      expect(tableware.describe().placementCount).toBeGreaterThan(120);

      for (const entry of tableware.placements) {
        const tableSlot = env.layout.tableSlots.find((slot) => slot.id === entry.anchorId);
        const passSlot = env.layout.counterPassSlots.find((slot) => slot.id === entry.anchorId);
        const anchor = tableSlot ?? passSlot;
        expect(anchor, `${year} ${entry.id}`).toBeDefined();
        expect(entry.surface, entry.id).toBe(anchor?.surfaceHeight ?? -1);
        if (entry.nestedIn === null) {
          expect(entry.position.y, entry.id).toBeCloseTo(entry.surface, 9);
        }

        // Everything stays inside RoomBounds, corners included.
        for (const corner of tablewareFootprintCorners(
          entry.position.x,
          entry.position.z,
          entry.rotationY,
          entry.footprint,
        )) {
          expect(Math.abs(corner.x), entry.id).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.width / 2);
          expect(Math.abs(corner.z), entry.id).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.depth / 2);
        }
      }

      // Every published table slot is set for the era.
      for (const slot of env.layout.tableSlots) {
        const items = tableware.placements.filter((entry) => entry.anchorId === slot.id);
        expect(items.length, `${year} ${slot.id}`).toBeGreaterThanOrEqual(2);
        for (const item of items) expect(item.surface).toBe(slot.surfaceHeight);
      }

      // One era at a time: a single tableware group beside the single shell.
      expect(kernel.world.children.filter((child) => child.name === TABLEWARE_GROUP_NAME).length).toBe(1);
      expect(kernel.world.children.filter((child) => child.name === ENVIRONMENT_GROUP_NAME).length).toBe(1);
      shields.push(`${tableware.describe().variantCount}:${tableware.describe().summary.vessels}`);
    }
    expect(new Set(shields).size).toBe(YEAR_IDS.length);

    tableware.dispose();
    env.dispose();
    expect(countNodes(kernel.scene)).toBe(baseline);
    expect(tableware.built).toBe(false);
    expect(env.built).toBe(false);
  });

  it('keeps the two modules independent when the timeline moves quickly', () => {
    const kernel = headlessKernel();
    const env = createEnvironmentModule();
    const tableware = createTablewareModule();
    env.build(kernel.createBuildContext(periodFor('1945')));
    tableware.build(kernel.createBuildContext(periodFor('1945')));

    for (const year of ['2025', '1945', '2005', '1985', '1965', '1945'] as const) {
      const period = periodFor(year);
      const context = kernel.createBuildContext(period);
      env.applyPeriod(period, context);
      tableware.applyPeriod(period, context);
      expect(env.spec?.year).toBe(year);
      expect(tableware.spec?.year).toBe(year);
      expect(tableware.spec).toEqual(tablewareSpec(year));
      expect(tableware.placementProblems()).toEqual([]);
      expect(env.describe().layoutProblems).toEqual([]);
    }

    tableware.dispose();
    expect(env.built).toBe(true);
    env.dispose();
  });

  /**
   * Framing evidence for the two views the acceptance criteria name. There is no
   * GPU in this environment, so rather than pixels the suite asserts the
   * *framing*: a top-down camera above the room and a counter-pass camera both
   * see the era's service, and the service really does change between the eras.
   */
  it('frames the era service in a top-down and a counter-pass view', () => {
    const kernel = headlessKernel();
    const env = createEnvironmentModule();
    const tableware = createTablewareModule();
    env.build(kernel.createBuildContext(periodFor(DEFAULT_YEAR_ID)));
    tableware.build(kernel.createBuildContext(periodFor(DEFAULT_YEAR_ID)));

    const topDown = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    topDown.position.set(0, CAFE_ROOM_BOUNDS.height + 5, 0.001);
    topDown.lookAt(0, 0, 0);
    topDown.updateProjectionMatrix();

    const passView = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 200);
    passView.position.set(0, 1.65, STRUCTURAL_LAYOUT.counter.serviceFaceZ + 0.35);
    passView.updateProjectionMatrix();

    const signatures = new Set<string>();
    for (const year of YEAR_IDS) {
      const period = periodFor(year);
      const context = kernel.createBuildContext(period);
      env.applyPeriod(period, context);
      tableware.applyPeriod(period, context);

      const root = tableware.root as THREE.Object3D;
      root.updateMatrixWorld(true);
      const service = new THREE.Box3().setFromObject(root);
      expect(service.isEmpty(), year).toBe(false);

      // The service stands on the published surfaces: nothing below the table
      // tops and nothing above the tallest stack on the counter.
      expect(service.min.y, year).toBeGreaterThanOrEqual(
        (STRUCTURAL_LAYOUT.tableSlots[0]?.surfaceHeight ?? 0.74) - 0.001,
      );
      expect(service.max.y, year).toBeLessThan(STRUCTURAL_LAYOUT.counter.surfaceHeight + 0.35);

      // A top-down view of the room frames the whole service.
      const topFrustum = frustumOf(topDown);
      for (const corner of cornersOf(service)) {
        expect(topFrustum.containsPoint(corner), `${year} top-down ${corner.toArray().join(',')}`).toBe(true);
      }

      // A counter-pass view frames the nearest table's setting in full.
      const slot = STRUCTURAL_LAYOUT.tableSlots.reduce((best, candidate) =>
        candidate.position.z > best.position.z ? candidate : best,
      );
      passView.lookAt(slot.position.x, slot.surfaceHeight, slot.position.z);
      passView.updateMatrixWorld(true);
      const passFrustum = frustumOf(passView);
      const setting = new THREE.Box3();
      for (const entry of tableware.placements.filter((item) => item.anchorId === slot.id)) {
        setting.expandByPoint(
          new THREE.Vector3(
            entry.position.x - entry.footprint.halfWidth,
            entry.position.y,
            entry.position.z - entry.footprint.halfLength,
          ),
        );
        setting.expandByPoint(
          new THREE.Vector3(
            entry.position.x + entry.footprint.halfWidth,
            entry.position.y + entry.height,
            entry.position.z + entry.footprint.halfLength,
          ),
        );
      }
      expect(setting.isEmpty(), `${year} setting`).toBe(false);
      for (const corner of cornersOf(setting)) {
        expect(passFrustum.containsPoint(corner), `${year} counter-pass`).toBe(true);
      }

      signatures.add(
        `${tableware.describe().summary.cup}+${tableware.describe().summary.vessels}+${tableware.describe().variantCount}`,
      );
    }
    // The table reads differently in every era, in both views.
    expect(signatures.size).toBe(YEAR_IDS.length);

    tableware.dispose();
    env.dispose();
  });
})
