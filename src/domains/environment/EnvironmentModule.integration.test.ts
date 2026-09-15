/**
 * Environment composition suite (headless, node).
 *
 * Proves the environment module is drivable exactly like every other domain
 * module: a registry-shaped driver aggregates it through the frozen
 * {@link SceneModule} contract, the kernel headless harness owns the scene, the
 * timeline applies all five years in sequence, and independent consumers read
 * the module's outputs:
 *
 *  - the navigation controller consumes the exported `RoomBounds` and keeps the
 *    walking camera inside the room the shell actually built,
 *  - a prop placement pass consumes the structural anchor set (table slot grid
 *    with surface heights, counter-pass slots, service lane, wall mounts and the
 *    reserved doorway / glazing zones) for tables, chairs, tableware, machines,
 *    posters, signage and patrons,
 *  - diagnostics read the era summary, and disposal leaves an empty world with
 *    the scene-graph node count back at the pre-build baseline.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  YEAR_IDS,
  isPeriodDefinition,
  isSceneModule,
  type BuildContext,
  type PeriodDefinition,
  type RoomPoint,
  type SceneModule,
  type UpdateContext,
  type YearId,
} from '../../contracts/period';
import { createKernel, type Kernel } from '../../core/kernel';
import {
  createNavigationController,
  navigationInterior,
  type NavigationEventSource,
  type NavigationInterior,
} from '../../core/navigation';
import {
  CAFE_ROOM_BOUNDS,
  COUNTER_BASE_HEIGHT,
  COUNTER_TOP_THICKNESS,
  SHELL_NODE_NAMES,
  SIGNAGE_MOUNT_HEIGHT,
  TABLE_SURFACE_HEIGHT,
  counterRect,
  createEnvironmentModule,
  describeEnvironmentSpec,
  environmentSpec,
  floorRect,
  measureShellEnvelope,
  pointInsideBounds,
  rectsOverlap,
  roomBoundsEqual,
  serviceLaneRect,
  validateLayout,
  type EnvironmentModule,
  type EnvironmentSpecSummary,
  type StructuralLayout,
} from './index';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const openKernels: Kernel[] = [];

afterEach(() => {
  for (const kernel of openKernels.splice(0)) {
    if (!kernel.isDisposed) kernel.dispose();
  }
});

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

/** Era fixture: the period registry (a later task) owns the real definitions. */
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

/**
 * Registry-shaped driver: builds each module on the first era and re-applies
 * every later era, ticking `update` from the kernel's frame loop. This is the
 * only integration surface the module is allowed to depend on.
 */
interface EraDriver {
  readonly modules: readonly SceneModule[];
  readonly appliedYears: readonly YearId[];
  applyYear(year: YearId): void;
  disposeAll(): void;
}

function createEraDriver(kernel: Kernel, modules: readonly SceneModule[]): EraDriver {
  const built = new Set<SceneModule>();
  const applied: YearId[] = [];
  const unsubscribe = kernel.onFrame((frame) => {
    const context: UpdateContext = {
      year: frame.year,
      elapsedSeconds: frame.elapsedSeconds,
      frame: frame.frame,
    };
    for (const module of modules) module.update(frame.deltaSeconds, context);
  });

  return {
    modules,
    appliedYears: applied,
    applyYear(year: YearId): void {
      const period = periodFor(year);
      if (!isPeriodDefinition(period)) throw new Error(`era fixture ${year} is not a period`);
      kernel.setYear(year);
      for (const module of modules) {
        if (built.has(module)) {
          const context = kernel.createBuildContext(period);
          module.applyPeriod(period, context);
        } else {
          const context: BuildContext = kernel.createBuildContext(period);
          module.build(context);
          built.add(module);
        }
      }
      applied.push(year);
    },
    disposeAll(): void {
      unsubscribe();
      for (const module of modules) module.dispose();
    },
  };
}

function setup(): { kernel: Kernel; module: EnvironmentModule; driver: EraDriver } {
  const kernel = createKernel(null, {
    forceHeadless: true,
    bounds: CAFE_ROOM_BOUNDS,
    autoResize: false,
  });
  openKernels.push(kernel);
  const module = createEnvironmentModule();
  const driver = createEraDriver(kernel, [module]);
  return { kernel, module, driver };
}

/* -------------------------------------------------------------------------- */
/* Consumers                                                                  */
/* -------------------------------------------------------------------------- */

/** Minimal keyboard source so the navigation controller can be driven headless. */
interface FakeKeyTarget extends NavigationEventSource {
  dispatch(type: string, event: unknown): void;
  listenerCount(): number;
}

function createKeyTarget(): FakeKeyTarget {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  return {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
      if (typeof listener !== 'function') return;
      const set = listeners.get(type) ?? new Set<(event: Event) => void>();
      set.add(listener as (event: Event) => void);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
      if (typeof listener !== 'function') return;
      listeners.get(type)?.delete(listener as (event: Event) => void);
    },
    dispatch(type: string, event: unknown): void {
      for (const listener of listeners.get(type) ?? []) listener(event as Event);
    },
    listenerCount(): number {
      let count = 0;
      for (const set of listeners.values()) count += set.size;
      return count;
    },
  };
}

function containmentViolation(point: THREE.Vector3, interior: NavigationInterior): number {
  return Math.max(
    0,
    interior.minX - point.x,
    point.x - interior.maxX,
    interior.minY - point.y,
    point.y - interior.maxY,
    interior.minZ - point.z,
    point.z - interior.maxZ,
  );
}

type PlacementKind = 'table' | 'table-top' | 'chair' | 'tableware' | 'machine' | 'poster' | 'signage' | 'patron';

interface PropPlacement {
  readonly id: string;
  readonly kind: PlacementKind;
  readonly zone: 'interior' | 'facade';
  readonly position: THREE.Vector3;
  readonly rotationY: number;
  /** Wall mounts carry the normal the prop must face. */
  readonly facing?: RoomPoint;
}

/**
 * Prop placement consumer: exactly how machines, tableware, posters, signage and
 * patrons use the anchor set — no hardcoded room coordinates anywhere.
 */
function placeProps(layout: StructuralLayout): readonly PropPlacement[] {
  const placements: PropPlacement[] = [];

  for (const slot of layout.tableSlots) {
    placements.push({
      id: `table:${slot.id}`,
      kind: 'table',
      zone: 'interior',
      position: new THREE.Vector3(slot.position.x, slot.position.y, slot.position.z),
      rotationY: slot.orientation,
    });
    placements.push({
      id: `table-top:${slot.id}`,
      kind: 'table-top',
      zone: 'interior',
      position: new THREE.Vector3(slot.position.x, slot.surfaceHeight, slot.position.z),
      rotationY: slot.orientation,
    });
    for (let seat = 0; seat < slot.seats; seat += 1) {
      const angle = slot.orientation + Math.PI / 2 + seat * Math.PI;
      const distance = slot.clearance * 0.7;
      placements.push({
        id: `chair:${slot.id}:${seat + 1}`,
        kind: 'chair',
        zone: 'interior',
        position: new THREE.Vector3(
          slot.position.x + Math.cos(angle) * distance,
          0,
          slot.position.z + Math.sin(angle) * distance,
        ),
        rotationY: angle + Math.PI,
      });
    }
    for (let item = 0; item < 2; item += 1) {
      placements.push({
        id: `tableware:${slot.id}:${item + 1}`,
        kind: 'tableware',
        zone: 'interior',
        position: new THREE.Vector3(
          slot.position.x + (item === 0 ? -0.16 : 0.16),
          slot.surfaceHeight + 0.02,
          slot.position.z,
        ),
        rotationY: slot.orientation,
      });
    }
    placements.push({
      id: `patron:${slot.id}`,
      kind: 'patron',
      zone: 'interior',
      position: new THREE.Vector3(slot.position.x, 0, slot.position.z - slot.clearance * 0.4),
      rotationY: Math.PI,
    });
  }

  for (const pass of layout.counterPassSlots) {
    placements.push({
      id: `machine:${pass.id}`,
      kind: 'machine',
      zone: 'interior',
      position: new THREE.Vector3(pass.position.x, pass.surfaceHeight, pass.position.z),
      rotationY: 0,
    });
  }

  for (const mount of layout.wallMounts) {
    placements.push({
      id: `${mount.purpose}:${mount.id}`,
      kind: mount.purpose === 'signage' ? 'signage' : 'poster',
      zone: mount.wall === 'front' ? 'facade' : 'interior',
      position: new THREE.Vector3(mount.position.x, mount.mountHeight, mount.position.z),
      rotationY: 0,
      facing: mount.normal,
    });
  }

  // Patrons waiting at the counter and coming in through the entrance.
  placements.push({
    id: 'patron:counter',
    kind: 'patron',
    zone: 'interior',
    position: new THREE.Vector3(0, 0, layout.counter.serviceFaceZ + 0.5),
    rotationY: 0,
  });
  placements.push({
    id: 'patron:entrance',
    kind: 'patron',
    zone: 'interior',
    position: new THREE.Vector3(
      layout.entrance.position.x,
      0,
      layout.entrance.position.z - 1.1,
    ),
    rotationY: Math.PI,
  });

  return placements;
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

describe('composition through the shared contracts and kernel harness', () => {
  it('applies all five eras through the SceneModule contract', () => {
    const { kernel, module, driver } = setup();
    const baseline = countNodes(kernel.scene);
    expect(isSceneModule(module)).toBe(true);

    const signatures = new Set<string>();
    const summaries: EnvironmentSpecSummary[] = [];
    const meshCounts: number[] = [];

    for (const year of YEAR_IDS) {
      driver.applyYear(year);

      expect(module.built).toBe(true);
      expect(kernel.year).toBe(year);
      expect(module.spec?.year).toBe(year);
      expect(module.bounds).toEqual(CAFE_ROOM_BOUNDS);

      // Every mesh is dressed in the era's material set.
      for (const mesh of meshesOf(module.root as THREE.Object3D)) {
        expect((mesh.material as THREE.Material).name).toContain(`:${year}:`);
      }

      signatures.add(
        `${module.shellSignature}|${module.storefrontSignature}|${module.materialSignature}`,
      );
      summaries.push(module.describe().summary);
      meshCounts.push(meshesOf(module.root as THREE.Object3D).length);

      // The kernel frame loop drives `update` through the contract.
      const updates = module.updateCount;
      kernel.update(1 / 60);
      kernel.update(1 / 60);
      expect(module.updateCount).toBe(updates + 2);
    }

    expect(driver.appliedYears).toEqual([...YEAR_IDS]);
    // Shell geometry, storefront geometry and material identifiers change per era.
    expect(signatures.size).toBe(5);
    expect(new Set(meshCounts).size).toBeGreaterThan(1);
    expect(new Set(summaries.map((summary) => summary.materialSetId)).size).toBe(5);
    expect(new Set(summaries.map((summary) => summary.windowDressing)).size).toBe(5);
    expect(summaries.map((summary) => summary.year)).toEqual([...YEAR_IDS]);
    expect(summaries).toEqual(YEAR_IDS.map((year) => describeEnvironmentSpec(environmentSpec(year))));

    expect(countNodes(kernel.scene)).toBeGreaterThan(baseline);
  });

  it('lets navigation consume the exported RoomBounds and keeps the camera inside', () => {
    const { kernel, module, driver } = setup();
    driver.applyYear('1985');

    const bounds = module.bounds;
    expect(roomBoundsEqual(measureShellEnvelope(module.root as THREE.Object3D) ?? bounds, bounds, 1e-6)).toBe(true);

    const keyTarget = createKeyTarget();
    const navigation = createNavigationController({
      camera: kernel.camera,
      rig: kernel.cameraRig,
      bounds,
      frameSource: kernel,
      keyTarget,
      element: null,
      ownerDocument: null,
      mode: 'walk',
      headBob: null,
    });
    navigation.attach();
    expect(navigation.attached).toBe(true);
    expect(navigation.bounds).toEqual(bounds);

    const interior = navigationInterior(bounds, navigation.limits);
    expect(interior.maxX).toBeCloseTo(bounds.width / 2 - navigation.limits.wallMargin, 6);
    expect(interior.maxZ).toBeCloseTo(bounds.depth / 2 - navigation.limits.wallMargin, 6);
    expect(interior.maxY).toBeCloseTo(bounds.height - navigation.limits.ceilingMargin, 6);

    // Walk into the room for a while: collision keeps the camera inside the shell.
    const start = kernel.camera.position.clone();
    keyTarget.dispatch('keydown', { code: 'KeyW', cancelable: false });
    let violation = 0;
    let walkError = 0;
    for (let step = 0; step < 360; step += 1) {
      try {
        kernel.update(1 / 60);
      } catch (error) {
        walkError += 1;
        throw error;
      }
      violation = Math.max(violation, containmentViolation(kernel.camera.position, interior));
    }
    keyTarget.dispatch('keyup', { code: 'KeyW' });

    expect(walkError).toBe(0);
    expect(violation).toBeLessThanOrEqual(1e-6);
    expect(kernel.camera.position.distanceTo(start)).toBeGreaterThan(0.5);

    // Hotspots from the era are consumable navigation targets.
    const counter = module.getHotspots().find((hotspot) => hotspot.id === 'environment-counter');
    if (!counter) throw new Error('the environment must expose a counter hotspot');
    navigation.setTarget(counter.position);
    for (let step = 0; step < 10; step += 1) kernel.update(1 / 60);
    expect(containmentViolation(kernel.camera.position, interior)).toBeLessThanOrEqual(1e-6);

    // The controller can be re-pointed at the same volume, and detaches cleanly.
    navigation.setBounds(module.bounds);
    expect(navigation.bounds).toEqual(bounds);
    navigation.detach();
    expect(navigation.attached).toBe(false);
    expect(navigation.getListenerStats().total).toBe(0);
    expect(keyTarget.listenerCount()).toBe(0);
  });

  it('lets props consume the structural anchor set', () => {
    const { module, driver } = setup();
    driver.applyYear('2025');

    const layout = module.layout;
    const bounds = module.bounds;
    expect(validateLayout(layout)).toEqual([]);

    const placements = placeProps(layout);
    expect(placements.length).toBeGreaterThan(30);

    for (const placement of placements) {
      expect(Number.isFinite(placement.position.x)).toBe(true);
      expect(Number.isFinite(placement.position.y)).toBe(true);
      expect(Number.isFinite(placement.position.z)).toBe(true);
      expect(Number.isFinite(placement.rotationY)).toBe(true);
      if (placement.zone === 'interior') {
        expect(
          pointInsideBounds(bounds, placement.position, placement.kind === 'poster' ? 0 : 0.1),
          `${placement.id} must be inside the room`,
        ).toBe(true);
      } else {
        // The signage bracket hangs on the storefront facade plane itself.
        expect(placement.position.z).toBeGreaterThanOrEqual(bounds.depth / 2 - 1e-9);
        expect(pointInsideBounds(bounds, placement.position, 0)).toBe(true);
      }
      if (placement.facing) {
        expect(Math.abs(placement.facing.x) + Math.abs(placement.facing.y) + Math.abs(placement.facing.z)).toBe(1);
      }
    }

    // Tables stand on the floor and carry a top at the anchor's surface height.
    for (const slot of layout.tableSlots) {
      const base = placements.find((placement) => placement.id === `table:${slot.id}`);
      const top = placements.find((placement) => placement.id === `table-top:${slot.id}`);
      expect(base?.position.y).toBe(0);
      expect(top?.position.y).toBeCloseTo(slot.surfaceHeight, 6);
      expect(top?.position.y).toBeCloseTo(TABLE_SURFACE_HEIGHT, 6);
      expect(placements.filter((placement) => placement.id.startsWith(`tableware:${slot.id}`))).toHaveLength(2);
      expect(placements.filter((placement) => placement.id.startsWith(`chair:${slot.id}`))).toHaveLength(slot.seats);
    }

    // Machines sit on the counter-pass slots, on the counter top.
    for (const pass of layout.counterPassSlots) {
      const machine = placements.find((placement) => placement.id === `machine:${pass.id}`);
      expect(machine?.position.x).toBeCloseTo(pass.position.x, 6);
      expect(machine?.position.z).toBeCloseTo(pass.position.z, 6);
      expect(machine?.position.y).toBeCloseTo(layout.counter.surfaceHeight, 6);
      expect(layout.counter.surfaceHeight).toBeCloseTo(
        COUNTER_BASE_HEIGHT + COUNTER_TOP_THICKNESS,
        6,
      );
    }

    // Posters and signage hang on the wall mounts, outside the reserved zones.
    const posters = placements.filter((placement) => placement.kind === 'poster');
    expect(posters.length).toBeGreaterThanOrEqual(3);
    const posterWalls = new Set(
      layout.wallMounts.filter((mount) => mount.purpose !== 'signage').map((mount) => mount.wall),
    );
    expect([...posterWalls].sort()).toEqual(['back', 'left', 'right']);
    const signage = placements.filter((placement) => placement.kind === 'signage');
    expect(signage).toHaveLength(1);
    expect(signage[0]?.position.y).toBeCloseTo(SIGNAGE_MOUNT_HEIGHT, 6);

    // Furniture keeps the service lane and the counter clear; patrons may stand
    // in the lane to be served, but never inside the counter; wall mounted props
    // that sit over the counter must clear its surface in height.
    const counterBox = counterRect(layout.counter);
    const laneBox = serviceLaneRect(layout.serviceLane);
    const footprint = (placement: PropPlacement) => floorRect(placement.position, 0.2, 0.2);
    for (const placement of placements) {
      if (placement.kind === 'table' || placement.kind === 'chair') {
        expect(footprint(placement), `${placement.id} blocks the service lane`).not.toSatisfy(
          (box) => rectsOverlap(box, laneBox),
        );
        expect(footprint(placement), `${placement.id} overlaps the counter`).not.toSatisfy(
          (box) => rectsOverlap(box, counterBox),
        );
      }
      if (placement.kind === 'patron') {
        expect(footprint(placement), `${placement.id} is inside the counter`).not.toSatisfy(
          (box) => rectsOverlap(box, counterBox),
        );
      }
      if (placement.kind === 'poster' || placement.kind === 'signage') {
        if (rectsOverlap(footprint(placement), counterBox)) {
          expect(
            placement.position.y,
            `${placement.id} hangs too low over the counter`,
          ).toBeGreaterThan(layout.counter.surfaceHeight + 0.3);
        }
      }
    }

    // The reserved doorway and glazing zones are honoured by the shell itself.
    const doorway = module.root?.getObjectByName(SHELL_NODE_NAMES.backRoomDoorway);
    expect(doorway?.position.x).toBeCloseTo(0, 6);
    const blade = module.root?.getObjectByName(`${SHELL_NODE_NAMES.signageBracket}-blade`);
    expect(blade?.position.y).toBeCloseTo(SIGNAGE_MOUNT_HEIGHT, 6);
    expect(module.root?.getObjectByName(`${SHELL_NODE_NAMES.storefrontGlazing}-pane-storefront-glazing-1`)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Teardown                                                                   */
/* -------------------------------------------------------------------------- */

describe('composition teardown', () => {
  it('leaves an empty environment group and an untouched scene graph', () => {
    const { kernel, module, driver } = setup();
    const baseline = countNodes(kernel.scene);
    for (const year of YEAR_IDS) driver.applyYear(year);

    expect(kernel.world.children.length).toBe(1);
    expect(kernel.listenerCount).toBe(1); // the driver's frame subscription

    driver.disposeAll();

    expect(module.built).toBe(false);
    expect(module.root).toBeUndefined();
    expect(module.materialSet).toBeUndefined();
    expect(kernel.world.children).toHaveLength(0);
    expect(kernel.scene.getObjectByName(SHELL_NODE_NAMES.floor)).toBeUndefined();
    expect(kernel.scene.getObjectByName(SHELL_NODE_NAMES.signageBracket)).toBeUndefined();
    expect(countNodes(kernel.scene)).toBe(baseline);
    expect(kernel.listenerCount).toBe(0);

    kernel.dispose();
    expect(kernel.isDisposed).toBe(true);
    expect(kernel.listenerCount).toBe(0);
  });
});
