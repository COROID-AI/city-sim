/**
 * Counter × environment composition suite (headless, node).
 *
 * The two modules are built and driven *together*, exactly as the period
 * registry and the app composition layer will drive them:
 *
 *  - `EnvironmentModule` raises the room shell and publishes its `RoomBounds`
 *    and structural layout; `CounterTechModule` is constructed against those
 *    published values, so the counter contract is exercised against the real
 *    environment contract rather than a copy of it.
 *  - The counter is built for all five eras with the kernel's own build context
 *    and its props are checked against the *measured* shell: the envelope
 *    (floor, walls, ceiling), the storefront, the doorway, the wainscot and
 *    every mesh of the counter shell the environment raises.
 *  - The era swap moves the room's finishes and the counter's inventory at the
 *    same time, proving one module does not overwrite the other, and the scene
 *    graph returns to its pre-build size afterwards.
 *  - A kernel frame listener drives `update`, so the animation the domain suite
 *    asserts is also exercised through the runtime the app uses.
 *  - Disposing both modules returns the kernel's world to its baseline.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  YEAR_IDS,
  isSceneModule,
  type BuildContext,
  type PeriodDefinition,
  type RoomPoint,
  type YearId,
} from '../../contracts/period';
import { createKernel, type Kernel } from '../../core/kernel';
import {
  CAFE_ROOM_BOUNDS,
  STRUCTURAL_LAYOUT,
  createEnvironmentModule,
  environmentSpec,
  measureShellEnvelope,
  roomBoundsEqual,
} from '../environment';
import {
  COUNTER_TECH_MODULE_ID,
  counterBoxesOverlap,
  counterTechSpec,
  createCounterTechModule,
  type CounterTechModule,
} from './CounterTechModule';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const openKernels: Kernel[] = [];

function headlessKernel(): Kernel {
  const kernel = createKernel(null, {
    forceHeadless: true,
    bounds: CAFE_ROOM_BOUNDS,
    autoResize: false,
    initialYear: '1945',
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

/** World box of every mesh under `root`, as the shell test compares against. */
function meshBoxes(root: THREE.Object3D): readonly { readonly name: string; readonly box: THREE.Box3 }[] {
  root.updateMatrixWorld(true);
  const boxes: { name: string; box: THREE.Box3 }[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const box = new THREE.Box3().setFromObject(mesh);
    if (!box.isEmpty()) boxes.push({ name: mesh.name, box });
  });
  return boxes;
}

function toRoomBox(box: THREE.Box3): { min: RoomPoint; max: RoomPoint } {
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
  };
}

function worldBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

interface Composition {
  readonly kernel: Kernel;
  readonly environment: ReturnType<typeof createEnvironmentModule>;
  readonly counter: CounterTechModule;
  build(year: YearId): BuildContext;
}

function compose(): Composition {
  const kernel = headlessKernel();
  const environment = createEnvironmentModule();
  const counter = createCounterTechModule({ bounds: environment.bounds, layout: environment.layout });
  return {
    kernel,
    environment,
    counter,
    build(year: YearId): BuildContext {
      const context = kernel.createBuildContext(periodFor(year));
      environment.build(context);
      counter.build(context);
      return context;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

describe('counter composed with the environment shell', () => {
  it('is constructed from the bounds and layout the environment publishes', () => {
    const { environment, counter } = compose();
    expect(roomBoundsEqual(environment.bounds, CAFE_ROOM_BOUNDS, 1e-9)).toBe(true);
    expect(counter.bounds).toBe(environment.bounds);
    expect(counter.layout).toBe(environment.layout);
    expect(environment.layout).toBe(STRUCTURAL_LAYOUT);
    expect(isSceneModule(environment)).toBe(true);
    expect(isSceneModule(counter)).toBe(true);
    expect(counter.id).toBe(COUNTER_TECH_MODULE_ID);
    expect(environment.id).not.toBe(counter.id);
  });

  it('raises the counter inside the measured room and beside the shell', () => {
    const { kernel, environment, counter, build } = compose();
    build('1945');
    expect(kernel.world.children.map((child) => child.name)).toEqual(['environment', 'counter']);
    const envelope = measureShellEnvelope(environment.root as THREE.Object3D);
    expect(envelope).not.toBeNull();
    if (envelope) {
      expect(envelope.width).toBeCloseTo(CAFE_ROOM_BOUNDS.width, 3);
      expect(envelope.depth).toBeCloseTo(CAFE_ROOM_BOUNDS.depth, 3);
      expect(envelope.height).toBeCloseTo(CAFE_ROOM_BOUNDS.height, 3);
    }
    const counterBox = worldBox(counter.root as THREE.Object3D);
    expect(counterBox.min.x).toBeGreaterThan(-CAFE_ROOM_BOUNDS.width / 2);
    expect(counterBox.max.x).toBeLessThan(CAFE_ROOM_BOUNDS.width / 2);
    expect(counterBox.min.z).toBeGreaterThan(-CAFE_ROOM_BOUNDS.depth / 2);
    expect(counterBox.max.z).toBeLessThan(CAFE_ROOM_BOUNDS.depth / 2);
    expect(counterBox.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(counterBox.max.y).toBeLessThan(CAFE_ROOM_BOUNDS.height);
  });

  it('places every prop of every era clear of the shell the environment raised', () => {
    const { environment, counter, build } = compose();
    const problems: string[] = [];
    for (const year of YEAR_IDS) {
      const context = build(year);
      const shell = meshBoxes(environment.root as THREE.Object3D);
      expect(shell.length).toBeGreaterThan(20);
      expect(counter.spec?.year).toBe(year);
      expect(environment.spec?.year).toBe(year);
      for (const entry of counter.placements) {
        for (const { name, box } of shell) {
          if (counterBoxesOverlap(entry, toRoomBox(box))) {
            problems.push(`${year}: ${entry.id} intersects the shell mesh ${name}`);
          }
        }
      }
      expect(context.bounds).toBe(environment.bounds);
      expect(counter.hasKind(counterTechSpec(year).device.kind)).toBe(true);
    }
    expect(problems).toEqual([]);
  });

  it('reproduces identical prop transforms on two consecutive builds', () => {
    const { counter, build } = compose();
    build('1985');
    const snapshot = () =>
      counter.placements.map((entry) => ({
        id: entry.id,
        center: { ...entry.center },
        min: { ...entry.min },
        max: { ...entry.max },
        anchorId: entry.anchorId,
      }));
    const first = snapshot();
    const signature = counter.plan?.signature;
    build('1985');
    expect(counter.plan?.signature).toBe(signature);
    expect(snapshot()).toEqual(first);
    expect(counter.placements.every((entry) => entry.max.x <= CAFE_ROOM_BOUNDS.width / 2)).toBe(true);
  });

  it('swaps eras with the environment without overwriting it', () => {
    const { kernel, environment, counter, build } = compose();
    build('1945');
    const counterBaseline = countNodes(counter.root as THREE.Object3D);
    const worldBaseline = countNodes(kernel.world);
    const seen = new Set<string>();

    for (const year of ['2025', '1965', '2005', '1945', '1985'] as const) {
      const context = build(year);
      const builtCount = countNodes(counter.root as THREE.Object3D);
      environment.applyPeriod(context.period, context);
      counter.applyPeriod(context.period, context);
      expect(environment.spec?.year).toBe(year);
      expect(counter.spec?.year).toBe(year);
      expect(environment.getHotspots().length).toBeGreaterThan(0);
      expect(counter.getHotspots().length).toBeGreaterThanOrEqual(3);
      seen.add(counter.materialSignature ?? '');
      // Re-applying an era replaces the counter, it never accumulates: the graph
      // comes back to exactly the size the fresh build produced.
      expect(countNodes(counter.root as THREE.Object3D)).toBe(builtCount);
      expect(environment.built).toBe(true);
      expect(counter.plan?.report.problems).toEqual([]);
      expect(kernel.world.children.map((child) => child.name)).toEqual(['environment', 'counter']);
    }
    expect(seen.size).toBe(5);

    const finalContext = build('1945');
    environment.applyPeriod(finalContext.period, finalContext);
    counter.applyPeriod(finalContext.period, finalContext);
    expect(countNodes(counter.root as THREE.Object3D)).toBe(counterBaseline);
    // Neither module accumulates: the world never grows past its 1945 size.
    expect(countNodes(kernel.world)).toBeLessThanOrEqual(worldBaseline);
  });

  it('exposes hotspot ids that do not collide with the environment overlay', () => {
    const { environment, counter, build } = compose();
    for (const year of YEAR_IDS) {
      const context = build(year);
      void context;
      const environmentIds = new Set(environment.getHotspots().map((hotspot) => hotspot.id));
      for (const hotspot of counter.getHotspots()) {
        expect(environmentIds.has(hotspot.id), `${year} hotspot ${hotspot.id}`).toBe(false);
        expect(hotspot.moduleId).toBe(COUNTER_TECH_MODULE_ID);
      }
    }
  });

  it('animates through the kernel frame loop', () => {
    const { kernel, environment, counter, build } = compose();
    build('2025');
    expect(environment.built).toBe(true);
    const unlisten = kernel.onFrame((frame) => {
      counter.update(frame.deltaSeconds, {
        year: frame.year,
        elapsedSeconds: frame.elapsedSeconds,
        frame: frame.frame,
      });
    });

    kernel.update(0.25);
    expect(counter.updateCount).toBe(1);
    expect(counter.animation.elapsedSeconds).toBeCloseTo(0.25, 6);
    const firstTape = counter.animation.tapCount;

    kernel.setYear('2025');
    kernel.update(0.5);
    kernel.update(0.5);
    expect(counter.updateCount).toBe(3);
    expect(counter.animation.elapsedSeconds).toBeCloseTo(1.25, 6);
    expect(counter.animation.tapCount).toBeGreaterThanOrEqual(firstTape);
    expect(counter.animation.displayGlow).toBeGreaterThan(0);

    unlisten();
    const before = counter.updateCount;
    kernel.update(0.5);
    expect(counter.updateCount).toBe(before);

    // The room and the counter are both still attached to the composition root.
    expect(kernel.world.children.map((child) => child.name)).toEqual(['environment', 'counter']);
  });

  it('disposes both modules and returns the world to its baseline', () => {
    const { kernel, environment, counter, build } = compose();
    const worldBaseline = countNodes(kernel.world);
    build('2005');
    expect(countNodes(kernel.world)).toBeGreaterThan(worldBaseline + 20);
    counter.dispose();
    expect(counter.resourceCount).toBe(0);
    expect(kernel.world.children.map((child) => child.name)).toEqual(['environment']);
    environment.dispose();
    expect(countNodes(kernel.world)).toBe(worldBaseline);
    expect(kernel.world.children.length).toBe(0);
  });
});
