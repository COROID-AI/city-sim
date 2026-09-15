/**
 * Environment domain suite (headless, node).
 *
 * The shell must be real in a GPU-free process: the kernel boots headless, the
 * module builds, moves through all five eras and disposes, while the tests
 * assert the actual integrated behaviour:
 *
 *  - five era records that differ on every period discriminator,
 *  - the full node inventory in one `environment` group with finite geometry,
 *  - an exported `RoomBounds` that matches the built envelope within tolerance
 *    and a walkable floor at y = 0 in every era,
 *  - the structural anchor set (table slot grid with surface heights, counter
 *    zone, counter-pass slots, service lane, wall mounts, reserved doorway and
 *    glazing zones) realised in the geometry,
 *  - `applyPeriod` swapping palette, material set, window dressing and profile
 *    driven geometry, releasing the previous material set,
 *  - zero network or filesystem asset loading: finishes are procedural,
 *  - `dispose` returning the scene-graph node count to the pre-build baseline
 *    with every geometry, material and texture released and no leaked listeners.
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
} from '../../contracts/period';
import { createKernel, type Kernel } from '../../core/kernel';
import {
  CAFE_ROOM_BOUNDS,
  COUNTER_BASE_HEIGHT,
  COUNTER_TOP_THICKNESS,
  ENVIRONMENT_SPECS,
  ENVIRONMENT_SPEC_YEARS,
  EnvironmentModule,
  SHELL_NODE_NAMES,
  STRUCTURAL_LAYOUT,
  TABLE_SURFACE_HEIGHT,
  createEnvironmentModule,
  createFinishTexture,
  createStructuralLayout,
  describeEnvironmentSpec,
  environmentSpec,
  environmentSpecs,
  eraConflicts,
  isProceduralFinishTexture,
  materialSetMaterials,
  pointInsideBounds,
  roomBoundsEqual,
  shellFloorHeight,
  surfaceStyle,
  validateLayout,
  wallMountsOf,
  type CanvasFactory,
  type FinishTexture,
} from './index';

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
 * real `PeriodDefinition`s; this fixture derives one from the same era spec so
 * the environment suite exercises the contract with era-correct colours.
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
    const material = mesh.material as THREE.MeshStandardMaterial;
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
  }
  return [...textures];
}

function distinctPixelColors(data: Uint8ClampedArray): number {
  const seen = new Set<number>();
  for (let index = 0; index < data.length; index += 4) {
    seen.add(
      (((data[index] ?? 0) << 24) |
        ((data[index + 1] ?? 0) << 16) |
        ((data[index + 2] ?? 0) << 8) |
        (data[index + 3] ?? 0)) >>>
        0,
    );
  }
  return seen.size;
}

/** A minimal 2D canvas good enough to prove the canvas texture path runs. */
interface FakeCanvasRecord {
  readonly factory: CanvasFactory;
  putImageDataCalls: number;
  readonly images: ImageData[];
}

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

function buildOnce(kernel: Kernel, module: EnvironmentModule, year: YearId = DEFAULT_YEAR_ID): BuildContext {
  const context = kernel.createBuildContext(periodFor(year));
  module.build(context);
  return context;
}

/* -------------------------------------------------------------------------- */
/* Era data                                                                   */
/* -------------------------------------------------------------------------- */

describe('era data: five period-correct records', () => {
  it('covers exactly the five selectable years with distinct discriminators', () => {
    expect(ENVIRONMENT_SPEC_YEARS).toEqual([...YEAR_IDS]);
    expect(Object.keys(ENVIRONMENT_SPECS)).toEqual([...YEAR_IDS]);

    const summaries = environmentSpecs().map(describeEnvironmentSpec);
    expect(summaries).toHaveLength(5);

    for (const summary of summaries) {
      expect(summary.materialSetId).toMatch(/^material-set:/);
      expect(summary.paletteName.length).toBeGreaterThan(4);
      expect(summary.floorFinish.length).toBeGreaterThan(4);
      expect(summary.wallTreatment.length).toBeGreaterThan(4);
      expect(summary.wainscotProfile.length).toBeGreaterThan(4);
      expect(summary.ceilingType.length).toBeGreaterThan(4);
      expect(summary.tilePalette.length).toBeGreaterThan(4);
      expect(summary.glazingStyle.length).toBeGreaterThan(4);
      expect(summary.windowDressing.length).toBeGreaterThan(4);
      expect(summary.signage.length).toBeGreaterThan(4);
      expect(summary.bounceWall).toMatch(/^#[0-9a-f]{6}$/);
      expect(summary.bounceCeiling).toMatch(/^#[0-9a-f]{6}$/);
      expect(summary.colorTemperatureK).toBeGreaterThan(1500);
      expect(summary.colorTemperatureK).toBeLessThan(8000);
    }

    for (let a = 0; a < summaries.length; a += 1) {
      for (let b = a + 1; b < summaries.length; b += 1) {
        const left = summaries[a];
        const right = summaries[b];
        if (!left || !right) throw new Error('era summary fixture is incomplete');
        expect(eraConflicts(left, right)).toEqual([]);
      }
    }
  });

  it('keeps every era counter surface on the structural counter anchor', () => {
    const counter = STRUCTURAL_LAYOUT.counter;
    expect(counter.surfaceHeight).toBeCloseTo(COUNTER_BASE_HEIGHT + COUNTER_TOP_THICKNESS, 6);
    for (const spec of environmentSpecs()) {
      expect(spec.counter.shell.length).toBeGreaterThan(4);
      expect(spec.counter.backBar.length).toBeGreaterThan(4);
      expect(spec.counter.top.finish.length).toBeGreaterThan(4);
      expect(spec.counter.topOverhang).toBeGreaterThan(0);
      expect(spec.wainscot.height).toBeGreaterThan(0.8);
      expect(spec.wainscot.height).toBeLessThan(CAFE_ROOM_BOUNDS.height / 2);
      expect(spec.glazing.paneColumns).toBeGreaterThanOrEqual(1);
      expect(spec.signage.lettering.length).toBeGreaterThan(3);
    }
  });

  it('paints finishes procedurally through both texture backends', () => {
    const spec = environmentSpec('1985');
    const finish: FinishTexture = createFinishTexture(surfaceStyle(spec.floor, 64), {
      key: 'probe:floor',
    });
    expect(isProceduralFinishTexture(finish.texture)).toBe(true);
    expect(finish.texture.name).toBe('env:probe:floor');
    expect(finish.source).toBe('data');
    const image = (finish.texture as THREE.DataTexture).image as { data: Uint8ClampedArray };
    expect(distinctPixelColors(image.data)).toBeGreaterThan(4);
    finish.texture.dispose();

    const record = createFakeCanvas();
    const canvasFinish = createFinishTexture(surfaceStyle(spec.floor, 64), {
      key: 'probe:canvas',
      canvasFactory: record.factory,
    });
    expect(canvasFinish.source).toBe('canvas');
    expect(canvasFinish.texture).toBeInstanceOf(THREE.CanvasTexture);
    expect(record.putImageDataCalls).toBe(1);
    expect(record.images).toHaveLength(1);
    expect(distinctPixelColors(record.images[0]?.data ?? new Uint8ClampedArray())).toBeGreaterThan(4);
    canvasFinish.texture.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Build                                                                      */
/* -------------------------------------------------------------------------- */

describe('build: the closed café shell', () => {
  it('raises the whole node inventory exactly once inside one environment group', () => {
    const kernel = headlessKernel();
    const module = createEnvironmentModule();
    expect(isSceneModule(module)).toBe(true);

    const baseline = countNodes(kernel.scene);
    buildOnce(kernel, module);

    expect(module.built).toBe(true);
    expect(module.root?.name).toBe('environment');
    expect(module.root?.parent).toBe(kernel.world);
    expect(countNodes(kernel.scene)).toBeGreaterThan(baseline);

    for (const [key, name] of Object.entries(SHELL_NODE_NAMES)) {
      let occurrences = 0;
      kernel.scene.traverse((object) => {
        if (object.name === name) occurrences += 1;
      });
      expect(occurrences, `${key} (${name}) must exist exactly once`).toBe(1);
      expect(module.root?.getObjectByName(name)).toBeTruthy();
    }

    // Every mesh has finite, non-degenerate bounds.
    const meshes = meshesOf(kernel.world);
    expect(meshes.length).toBeGreaterThan(40);
    for (const mesh of meshes) {
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      expect(Number.isFinite(box.min.x) && Number.isFinite(box.min.y) && Number.isFinite(box.min.z)).toBe(true);
      expect(Number.isFinite(box.max.x) && Number.isFinite(box.max.y) && Number.isFinite(box.max.z)).toBe(true);
      expect(box.max.x - box.min.x).toBeGreaterThan(0);
    }
    for (const texture of texturesOf(kernel.world)) {
      expect(isProceduralFinishTexture(texture)).toBe(true);
    }
  });

  it('measures back to the exported RoomBounds with a walkable floor at 0', () => {
    const kernel = headlessKernel();
    const module = createEnvironmentModule();
    expect(module.bounds).toEqual(CAFE_ROOM_BOUNDS);
    expect(module.layout.bounds).toEqual(CAFE_ROOM_BOUNDS);

    buildOnce(kernel, module);
    const measured = module.measuredBounds;
    expect(measured).not.toBeNull();
    if (!measured) throw new Error('shell envelope must be measurable');
    expect(roomBoundsEqual(measured, CAFE_ROOM_BOUNDS, 1e-6)).toBe(true);
    expect(shellFloorHeight(module.root as THREE.Object3D)).toBeCloseTo(0, 6);

    // The volume is era independent: navigation and props stay valid for all five.
    for (const year of YEAR_IDS) {
      module.applyPeriod(periodFor(year), kernel.createBuildContext(periodFor(year)));
      const eraMeasured = module.measuredBounds;
      if (!eraMeasured) throw new Error('shell envelope must be measurable in every era');
      expect(roomBoundsEqual(eraMeasured, CAFE_ROOM_BOUNDS, 1e-6)).toBe(true);
      expect(shellFloorHeight(module.root as THREE.Object3D)).toBeCloseTo(0, 6);
    }
  });

  it('validates its own layout and rejects an inconsistent one', () => {
    expect(validateLayout(STRUCTURAL_LAYOUT)).toEqual([]);
    expect(createStructuralLayout()).toEqual(STRUCTURAL_LAYOUT);
    expect(() => createEnvironmentModule({ layout: { ...STRUCTURAL_LAYOUT, floorHeight: 0.4 } })).toThrow(
      /Invalid environment layout/,
    );
    expect(() =>
      createEnvironmentModule({
        bounds: { width: 9, depth: 11, height: 3.6 },
        layout: createStructuralLayout({ width: 8, depth: 8, height: 3 }),
      }),
    ).toThrow(/same room as `bounds`/);
  });

  it('realises the structural anchors in geometry', () => {
    const kernel = headlessKernel();
    const module = createEnvironmentModule();
    buildOnce(kernel, module);
    const root = module.root as THREE.Object3D;
    const layout = module.layout;

    // Table slot grid: eight slots with a usable surface height, all clear of the
    // counter, the service lane and the walls.
    expect(layout.tableSlots).toHaveLength(8);
    for (const slot of layout.tableSlots) {
      expect(slot.surfaceHeight).toBeCloseTo(TABLE_SURFACE_HEIGHT, 6);
      expect(slot.seats).toBeGreaterThanOrEqual(2);
      expect(pointInsideBounds(layout.bounds, slot.position, slot.clearance)).toBe(true);
      expect(slot.position.y).toBe(0);
    }

    // Counter zone and its pass slots are marked in the shell by pass mats.
    for (const pass of layout.counterPassSlots) {
      const mat = root.getObjectByName(`${SHELL_NODE_NAMES.counterShell}-pass-${pass.index + 1}`);
      expect(mat, `${pass.id} pass mat must exist`).toBeTruthy();
      expect(mat?.position.x).toBeCloseTo(pass.position.x, 6);
      expect(mat?.position.z).toBeCloseTo(pass.position.z, 6);
      expect(mat?.position.y).toBeCloseTo(pass.surfaceHeight + 0.01, 6);
    }

    // Service lane runs from the entrance towards the counter.
    expect(layout.serviceLane.from.z).toBeCloseTo(layout.bounds.depth / 2 - 0.9, 6);
    expect(layout.serviceLane.to.z).toBeGreaterThan(layout.counter.serviceFaceZ);
    expect(layout.serviceLane.to.z).toBeLessThan(layout.counter.serviceFaceZ + 0.6);

    // Wall mount surfaces exist on all four walls, facing into the room.
    for (const wall of layout.walls) {
      const mounts = wallMountsOf(layout, wall.id);
      expect(mounts.length, `${wall.id} wall mounts`).toBeGreaterThan(0);
      for (const mount of mounts) {
        expect(mount.normal).toEqual(wall.inward);
        expect(mount.mountHeight).toBeGreaterThan(0);
      }
    }
    expect(wallMountsOf(layout, 'front', 'signage')).toHaveLength(1);

    // Reserved doorway and glazing zones.
    expect(layout.doorway.wall).toBe('back');
    expect(layout.entrance.wall).toBe('front');
    expect(layout.glazingZones).toHaveLength(4);
    expect(layout.reservedZones.map((zone) => zone.id)).toEqual(
      expect.arrayContaining([
        'back-room-doorway',
        'storefront-entrance',
        'storefront-glazing-1',
        'storefront-glazing-4',
      ]),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Period application                                                         */
/* -------------------------------------------------------------------------- */

describe('applyPeriod: five era palettes, material sets and window dressings', () => {
  it('moves the shell to every era and reports the era it is showing', () => {
    const kernel = headlessKernel();
    const module = createEnvironmentModule();
    buildOnce(kernel, module);

    const shellSignatures = new Set<string>();
    const storefrontSignatures = new Set<string>();
    const materialSignatures = new Set<string>();
    const materialSetIds = new Set<string>();
    const dressingIds = new Set<string>();

    for (const year of YEAR_IDS) {
      const period = periodFor(year);
      module.applyPeriod(period, kernel.createBuildContext(period));
      const spec = environmentSpec(year);

      expect(module.spec).toBe(spec);
      expect(module.spec?.year).toBe(year);
      expect(module.paletteName).toBe(spec.paletteName);
      expect(module.materialSetId).toContain(spec.materialSetId);
      expect(module.windowDressing?.id).toBe(spec.windowDressing.id);
      expect(module.materialSet?.slots.floor.name).toBe(`env:${year}:floor`);
      expect(module.materialSet?.slots.signage.name).toBe(`env:${year}:signage`);

      const dressing = module.materialSet?.slots.dressing as THREE.MeshStandardMaterial;
      expect(dressing.map?.name).toBe(`env:${year}:dressing`);
      expect(dressing.opacity).toBeCloseTo(spec.windowDressing.opacity, 6);

      // Every mesh in the group is dressed in the era's set.
      for (const mesh of meshesOf(module.root as THREE.Object3D)) {
        expect((mesh.material as THREE.Material).name.startsWith(`env:${year}:`)).toBe(true);
      }

      shellSignatures.add(module.shellSignature ?? '');
      storefrontSignatures.add(module.storefrontSignature ?? '');
      materialSignatures.add(module.materialSignature ?? '');
      materialSetIds.add(module.materialSetId ?? '');
      dressingIds.add(module.windowDressing?.id ?? '');
    }

    expect(shellSignatures.size).toBe(5);
    expect(storefrontSignatures.size).toBe(5);
    expect(materialSignatures.size).toBe(5);
    expect(materialSetIds.size).toBe(5);
    expect(dressingIds.size).toBe(5);
  });

  it('releases the previous material set when the era moves', () => {
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose');
    const textureDispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const kernel = headlessKernel();
    const module = createEnvironmentModule();
    buildOnce(kernel, module);

    const first = module.materialSet;
    if (!first) throw new Error('the module must hold a material set after build');

    module.applyPeriod(periodFor('1965'), kernel.createBuildContext(periodFor('1965')));

    const disposedMaterials = new Set(materialDispose.mock.contexts);
    const disposedTextures = new Set(textureDispose.mock.contexts);
    for (const material of materialSetMaterials(first)) {
      expect(disposedMaterials.has(material)).toBe(true);
    }
    for (const texture of first.textures) {
      expect(disposedTextures.has(texture)).toBe(true);
    }
    expect(module.materialSet?.id).not.toBe(first.id);
    expect(module.built).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Update, hotspots and diagnostics                                           */
/* -------------------------------------------------------------------------- */

describe('update, hotspots and diagnostics', () => {
  it('animates the era signage only when it is lit', () => {
    const kernel = headlessKernel();
    const module = createEnvironmentModule();
    buildOnce(kernel, module);
    const listenerStats = kernel.getListenerStats();

    const painted = module.materialSet?.slots.signage as THREE.MeshStandardMaterial;
    for (let frame = 0; frame < 30; frame += 1) {
      module.update(1 / 60, { year: '1945', elapsedSeconds: frame / 60, frame });
    }
    expect(painted.emissiveIntensity).toBeCloseTo(0.05, 6);

    module.applyPeriod(periodFor('1985'), kernel.createBuildContext(periodFor('1985')));
    const neon = module.materialSet?.slots.signage as THREE.MeshStandardMaterial;
    const samples = new Set<number>();
    for (let frame = 0; frame < 45; frame += 1) {
      module.update(1 / 60, { year: '1985', elapsedSeconds: frame / 60, frame });
      samples.add(Number((neon.emissiveIntensity ?? 0).toFixed(5)));
    }
    expect(samples.size).toBeGreaterThan(1);
    expect(module.updateCount).toBe(75);
    expect(kernel.getListenerStats()).toEqual(listenerStats);

    // Updating before build (and with a silly delta) must be harmless.
    const fresh = new EnvironmentModule();
    fresh.update(Number.NaN, { year: '1945', elapsedSeconds: 0, frame: 0 });
    expect(fresh.built).toBe(false);
  });

  it('exposes era hotspots with finite positions for every year', () => {
    const kernel = headlessKernel();
    const module = createEnvironmentModule({ initialYear: '2005' });
    const before = module.getHotspots();
    expect(before.length).toBeGreaterThanOrEqual(4);
    expect(before[0]?.year).toBe('2005');

    buildOnce(kernel, module, '2005');
    for (const year of YEAR_IDS) {
      module.applyPeriod(periodFor(year), kernel.createBuildContext(periodFor(year)));
      const hotspots = module.getHotspots();
      const ids = new Set(hotspots.map((hotspot) => hotspot.id));
      expect(ids.size).toBe(hotspots.length);
      for (const hotspot of hotspots) {
        expect(hotspot.moduleId).toBe('environment');
        expect(hotspot.year).toBe(year);
        expect(hotspot.radius).toBeGreaterThan(0);
        expect(Number.isFinite(hotspot.position.x)).toBe(true);
        expect(Number.isFinite(hotspot.position.y)).toBe(true);
        expect(Number.isFinite(hotspot.position.z)).toBe(true);
        expect(hotspot.anchor).toBeInstanceOf(THREE.Object3D);
      }
      expect(hotspots.map((hotspot) => hotspot.id)).toEqual(
        expect.arrayContaining([
          'environment-counter',
          'environment-storefront',
          'environment-back-room',
          'environment-signage',
        ]),
      );
    }
  });

  it('describes the current era for diagnostics and the evidence table', () => {
    const kernel = headlessKernel();
    const module = createEnvironmentModule();
    buildOnce(kernel, module, '2025');

    const description = module.describe();
    expect(description.moduleId).toBe('environment');
    expect(description.year).toBe('2025');
    expect(description.built).toBe(true);
    expect(description.layoutProblems).toEqual([]);
    expect(description.summary.materialSetId).toBe(environmentSpec('2025').materialSetId);
    expect(description.textureCount).toBeGreaterThan(8);
    expect(description.materialCount).toBeGreaterThan(20);
    expect(description.nodeCount).toBeGreaterThan(40);
    expect(description.shellSignature).toBeTruthy();
    expect(description.storefrontSignature).toBeTruthy();
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
      const module = createEnvironmentModule();
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

      // No DOM here, so the module fell back to data textures.
      expect(typeof document).toBe('undefined');
      expect(module.textureSource).toBe('data');

      const textures = texturesOf(module.root as THREE.Object3D);
      expect(textures.length).toBeGreaterThanOrEqual(8);
      for (const texture of textures) {
        expect(texture).toBeInstanceOf(THREE.DataTexture);
        expect(isProceduralFinishTexture(texture)).toBe(true);
        expect(texture.userData).toMatchObject({
          environment: { procedural: true, source: 'data' },
        });
      }
    } finally {
      (globalThis as { fetch: unknown }).fetch = originalFetch;
      (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = originalXhr;
      (globalThis as { Image?: unknown }).Image = originalImage;
    }
  });

  it('uses the canvas backend when a 2D canvas is available', () => {
    const record = createFakeCanvas();
    const kernel = headlessKernel();
    const module = createEnvironmentModule({ canvasFactory: record.factory });
    buildOnce(kernel, module);

    expect(module.textureSource).toBe('canvas');
    expect(record.putImageDataCalls).toBeGreaterThan(8);
    const floor = module.materialSet?.slots.floor as THREE.MeshStandardMaterial;
    expect(floor.map).toBeInstanceOf(THREE.CanvasTexture);
    const firstImage = record.images[0];
    expect(firstImage).toBeTruthy();
    expect(distinctPixelColors(firstImage?.data ?? new Uint8ClampedArray())).toBeGreaterThan(4);
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
    const module = createEnvironmentModule();
    buildOnce(kernel, module);
    const builtNodes = countNodes(kernel.scene);
    expect(builtNodes).toBeGreaterThan(baseline);

    const set = module.materialSet;
    if (!set) throw new Error('the module must hold a material set after build');
    const root = module.root as THREE.Object3D;
    const geometries = new Set<THREE.BufferGeometry>();
    for (const mesh of meshesOf(root)) geometries.add(mesh.geometry);
    const listeners = kernel.getListenerStats();

    module.dispose();

    expect(countNodes(kernel.scene)).toBe(baseline);
    expect(module.root).toBeUndefined();
    expect(module.built).toBe(false);
    expect(module.materialSet).toBeUndefined();
    expect(module.measuredBounds).toBeNull();

    const disposedGeometries = new Set(geometryDispose.mock.contexts);
    for (const geometry of geometries) {
      expect(disposedGeometries.has(geometry)).toBe(true);
    }
    const disposedMaterials = new Set(materialDispose.mock.contexts);
    for (const material of materialSetMaterials(set)) {
      expect(disposedMaterials.has(material)).toBe(true);
    }
    const disposedTextures = new Set(textureDispose.mock.contexts);
    for (const texture of set.textures) {
      expect(disposedTextures.has(texture)).toBe(true);
    }
    expect(kernel.getListenerStats()).toEqual(listeners);

    // Idempotent, and the module can rebuild afterwards for the composition root.
    module.dispose();
    expect(countNodes(kernel.scene)).toBe(baseline);

    module.build(kernel.createBuildContext(periodFor('2025')));
    expect(countNodes(kernel.scene)).toBeGreaterThan(baseline);
    module.dispose();
    expect(countNodes(kernel.scene)).toBe(baseline);
  });
});
