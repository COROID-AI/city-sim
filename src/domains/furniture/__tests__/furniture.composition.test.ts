/**
 * Furniture × environment composition suite (headless, node).
 *
 * The two modules are built and driven *together*, exactly as the period
 * registry and the app composition layer will drive them:
 *
 *  - `EnvironmentModule` raises the room shell and exports `RoomBounds`;
 *    `FurnitureModule` furnishes it. Both are built for 1945, then moved through
 *    all five eras with `applyPeriod`.
 *  - Every furniture prop's world-space box is asserted inside the *measured*
 *    shell envelope and clear of the counter service lane and the door-swing
 *    volume, for every year.
 *  - The era swap moves the room's finishes and the furniture's inventory at the
 *    same time, proving one module does not overwrite the other.
 *  - Applying the same era twice reproduces the same prop count and positions,
 *    and an interrupt that jumps between eras leaves no orphaned object.
 *  - Disposing both modules returns the scene graph to its pre-build child count
 *    with every geometry, material and texture released.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_YEAR_ID,
  YEAR_IDS,
  type PeriodDefinition,
  type YearId,
} from '../../../contracts/period';
import { createKernel, type Kernel } from '../../../core/kernel';
import {
  CAFE_ROOM_BOUNDS,
  STRUCTURAL_LAYOUT,
  createEnvironmentModule,
  environmentSpec,
  roomBoundsEqual,
} from '../../environment';
import {
  FURNITURE_MATERIAL_SLOTS,
  FURNITURE_MODULE_ID,
  createFurnitureModule,
  furniturePlanSignature,
  furnitureSpec,
  isFurnitureTexture,
  placementRules,
  propBounds,
  rectsOverlap,
} from '../index';

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

function worldBox(node: THREE.Object3D): THREE.Box3 {
  node.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(node);
}

interface Composed {
  readonly env: ReturnType<typeof createEnvironmentModule>;
  readonly furniture: ReturnType<typeof createFurnitureModule>;
  readonly kernel: Kernel;
  apply(year: YearId): void;
}

/** Builds both modules for the starting era and returns the pair plus a driver. */
function compose(kernel: Kernel, options: { canvasFactory?: (w: number, h: number) => HTMLCanvasElement | null } = {}): Composed {
  const env = createEnvironmentModule(options);
  const furniture = createFurnitureModule(options);
  env.build(kernel.createBuildContext(periodFor(DEFAULT_YEAR_ID)));
  furniture.build(kernel.createBuildContext(periodFor(DEFAULT_YEAR_ID)));
  return {
    env,
    furniture,
    kernel,
    apply(year: YearId): void {
      const period = periodFor(year);
      const context = kernel.createBuildContext(period);
      env.applyPeriod(period, context);
      furniture.applyPeriod(period, context);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

describe('composition: environment shell + furniture module', () => {
  it('furnishes the measured shell in all five eras, clear of lane and swing', () => {
    const kernel = headlessKernel();
    const baseline = countNodes(kernel.scene);
    const composed = compose(kernel);
    const rules = placementRules(STRUCTURAL_LAYOUT, CAFE_ROOM_BOUNDS);
    const environment = composed.env;
    const furniture = composed.furniture;

    expect(environment.built).toBe(true);
    expect(furniture.built).toBe(true);
    expect(furniture.id).toBe(FURNITURE_MODULE_ID);

    const shellSignatures = new Set<string>();
    const furnitureCounts = new Map<YearId, number>();
    for (const year of YEAR_IDS) {
      composed.apply(year);

      // The shell still measures as the exported room every era.
      const measured = environment.measuredBounds;
      expect(measured).not.toBeNull();
      expect(roomBoundsEqual(measured ?? CAFE_ROOM_BOUNDS, CAFE_ROOM_BOUNDS, 1e-3)).toBe(true);
      shellSignatures.add(`${environment.shellSignature ?? ''}|${environment.materialSignature ?? ''}`);

      // Furniture is inside the shell and clear of the lane, swing and counter.
      expect(furniture.spec?.year).toBe(year);
      expect(furniture.placementProblems()).toEqual([]);
      const props = furniture.props;
      expect(props.length).toBeGreaterThan(30);
      furnitureCounts.set(year, props.length);

      for (const prop of props) {
        const box = worldBox(prop.node);
        expect(box.min.x, `${year} ${prop.id}`).toBeGreaterThanOrEqual(-CAFE_ROOM_BOUNDS.width / 2 - 1e-6);
        expect(box.max.x, `${year} ${prop.id}`).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.width / 2 + 1e-6);
        expect(box.min.z, `${year} ${prop.id}`).toBeGreaterThanOrEqual(-CAFE_ROOM_BOUNDS.depth / 2 - 1e-6);
        expect(box.max.z, `${year} ${prop.id}`).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.depth / 2 + 1e-6);
        expect(box.max.y, `${year} ${prop.id}`).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.height + 1e-6);
        expect(box.min.y, `${year} ${prop.id}`).toBeGreaterThanOrEqual(-0.004);

        const footprint = { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
        if (prop.support === 'floor') {
          expect(rectsOverlap(footprint, rules.serviceLane), `${year} ${prop.id} in the lane`).toBe(false);
          expect(rectsOverlap(footprint, rules.entranceSwing), `${year} ${prop.id} in the door swing`).toBe(false);
          expect(rectsOverlap(footprint, rules.counter), `${year} ${prop.id} in the counter`).toBe(false);
        }
      }
    }

    // Both modules moved with the timeline, and neither overwrote the other.
    expect(shellSignatures.size).toBe(YEAR_IDS.length);
    expect(new Set([...furnitureCounts.values()]).size).toBeGreaterThan(1);

    // The furniture group is the only one this module owns.
    let furnitureGroups = 0;
    let environmentGroups = 0;
    kernel.world.traverse((object) => {
      if (object.name === 'furniture') furnitureGroups += 1;
      if (object.name === 'environment') environmentGroups += 1;
    });
    expect(furnitureGroups).toBe(1);
    expect(environmentGroups).toBe(1);
    expect(countNodes(kernel.scene)).toBeGreaterThan(baseline);
  });

  it('updates and disposes both modules without leaking scene resources', () => {
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose');
    const textureDispose = vi.spyOn(THREE.Texture.prototype, 'dispose');

    const kernel = headlessKernel();
    const baseline = countNodes(kernel.scene);
    const composed = compose(kernel);
    const environment = composed.env;
    const furniture = composed.furniture;

    for (const year of YEAR_IDS) composed.apply(year);

    const updateContext = { year: '2025' as YearId, elapsedSeconds: 1, frame: 1 };
    environment.update(1 / 60, updateContext);
    furniture.update(1 / 60, updateContext);
    expect(environment.updateCount).toBe(1);
    expect(furniture.updateCount).toBe(1);

    // Every resource reachable from the composed scene is released on dispose.
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    for (const mesh of meshesOf(kernel.world)) {
      geometries.add(mesh.geometry);
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    }
    const furnitureSet = furniture.materialSet;
    if (!furnitureSet) throw new Error('furniture must hold a material set after build');
    expect(materials.size).toBeGreaterThan(FURNITURE_MATERIAL_SLOTS.length);

    const listeners = kernel.getListenerStats();
    furniture.dispose();
    environment.dispose();

    expect(countNodes(kernel.scene)).toBe(baseline);
    expect(kernel.world.children.length).toBe(0);
    expect(furniture.built).toBe(false);
    expect(environment.built).toBe(false);
    expect(furniture.materialSet).toBeUndefined();
    expect(environment.materialSet).toBeUndefined();
    expect(kernel.getListenerStats()).toEqual(listeners);

    const disposedGeometries = new Set(geometryDispose.mock.contexts);
    for (const geometry of geometries) {
      expect(disposedGeometries.has(geometry)).toBe(true);
    }
    const disposedMaterials = new Set(materialDispose.mock.contexts);
    for (const material of materials) {
      expect(disposedMaterials.has(material)).toBe(true);
    }
    const disposedTextures = new Set(textureDispose.mock.contexts);
    for (const texture of textures) {
      expect(disposedTextures.has(texture)).toBe(true);
    }
    for (const slot of FURNITURE_MATERIAL_SLOTS) {
      expect(disposedMaterials.has(furnitureSet.slots[slot])).toBe(true);
    }
    for (const texture of furnitureSet.textures) {
      expect(disposedTextures.has(texture)).toBe(true);
      expect(isFurnitureTexture(texture)).toBe(true);
    }

    // Idempotent, and both modules can be rebuilt by the composition root.
    furniture.dispose();
    environment.dispose();
    expect(countNodes(kernel.scene)).toBe(baseline);
    composed.env.build(kernel.createBuildContext(periodFor('1965')));
    composed.furniture.build(kernel.createBuildContext(periodFor('1965')));
    expect(countNodes(kernel.scene)).toBeGreaterThan(baseline);
    composed.env.dispose();
    composed.furniture.dispose();
    expect(countNodes(kernel.scene)).toBe(baseline);
  });

  it('composes on the canvas texture backend when a canvas exists', () => {
    const putImageDataCalls: number[] = [];
    const canvasFactory = (width: number, height: number): HTMLCanvasElement => {
      const context = {
        createImageData: (w: number, h: number): ImageData =>
          ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) as ImageData,
        putImageData: (): void => {
          putImageDataCalls.push(width * height);
        },
      };
      return { width, height, getContext: () => context } as unknown as HTMLCanvasElement;
    };

    const kernel = headlessKernel();
    const composed = compose(kernel, { canvasFactory });
    expect(composed.env.textureSource).toBe('canvas');
    expect(composed.furniture.textureSource).toBe('canvas');
    expect(putImageDataCalls.length).toBeGreaterThan(FURNITURE_MATERIAL_SLOTS.length);
    for (const texture of composed.furniture.textures) {
      expect(texture).toBeInstanceOf(THREE.CanvasTexture);
      expect(isFurnitureTexture(texture)).toBe(true);
      expect(texture.userData).toMatchObject({ furniture: { procedural: true, source: 'canvas' } });
    }
    expect(composed.furniture.materialSet?.textures.length).toBe(FURNITURE_MATERIAL_SLOTS.length);
  });

  it('places the same props every time an era is applied twice', () => {
    const kernel = headlessKernel();
    const composed = compose(kernel);

    composed.apply('1985');
    const firstSignature = furniturePlanSignature(composed.furniture.plan ?? composed.furniture.eraPlan('1985'));
    const firstCount = composed.furniture.props.length;
    const firstPositions = composed.furniture.props.map((prop) => ({
      id: prop.id,
      center: { ...prop.center },
      rotation: prop.rotationY,
    }));

    composed.apply('1985');
    const secondSignature = furniturePlanSignature(composed.furniture.plan ?? composed.furniture.eraPlan('1985'));
    expect(secondSignature).toBe(firstSignature);
    expect(composed.furniture.props.length).toBe(firstCount);
    expect(
      composed.furniture.props.map((prop) => ({ id: prop.id, center: { ...prop.center }, rotation: prop.rotationY })),
    ).toEqual(firstPositions);

    // A different era is genuinely different furniture, not a tint.
    composed.apply('2025');
    expect(furniturePlanSignature(composed.furniture.plan ?? composed.furniture.eraPlan('2025'))).not.toBe(firstSignature);
    composed.apply('1985');
    expect(furniturePlanSignature(composed.furniture.plan ?? composed.furniture.eraPlan('1985'))).toBe(firstSignature);
  });

  it('leaves no orphan behind when the timeline is interrupted mid-era', () => {
    const kernel = headlessKernel();
    const baseline = countNodes(kernel.scene);
    const composed = compose(kernel);
    const counts = new Map<YearId, number>();

    for (const year of ['1965', '2025', '1985', '2025', '1965'] as YearId[]) {
      composed.apply(year);
      const count = countNodes(kernel.scene);
      const previous = counts.get(year);
      if (previous !== undefined) expect(count).toBe(previous);
      counts.set(year, count);

      // Only one furniture and one environment group survive each swap.
      let groups = 0;
      kernel.world.traverse((object) => {
        if (object.name === 'furniture' || object.name === 'environment') groups += 1;
      });
      expect(groups).toBe(2);
      expect(count).toBeGreaterThan(baseline);

      // Every prop in the graph carries the active era's material set.
      for (const mesh of meshesOf(composed.furniture.root as THREE.Object3D)) {
        const material = mesh.material as THREE.MeshStandardMaterial;
        expect(material.name.startsWith(`furniture:${year}:`)).toBe(true);
      }
    }

    // The era spec and the plan always agree with the props on screen.
    composed.apply('2005');
    expect(composed.furniture.spec?.year).toBe('2005');
    expect(composed.furniture.props.length).toBe(composed.furniture.plan?.entries.length);
    for (const prop of composed.furniture.props) {
      expect(propBounds(prop).max.x).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.width / 2 + 1e-6);
    }
    expect(furnitureSpec('2005').name).toBe(composed.furniture.describe().summary.name);
  });
});
