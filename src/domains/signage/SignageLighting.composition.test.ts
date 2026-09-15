/**
 * Signage × environment composition suite (headless, node).
 *
 * Proves the signage and lighting domain composes with the room shell it is
 * placed against: the same headless kernel owns both modules, the environment
 * shell publishes the `RoomBounds` and the structural anchors, the timeline
 * applies all five years to both, and every sign and fixture
 *
 *  - hangs off an anchor the shell actually built (fascia mount, glazing bay,
 *    back wall or counter) rather than a hard-coded world coordinate,
 *  - stays inside the room the shell measured, down to each mesh's bounding box,
 *  - keeps its light objects inside the volume and inside the documented budget,
 *  - is exposed as a hotspot anchored in the signage module's own group,
 *  - is released again when both modules dispose, leaving an empty world.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { YEAR_IDS, type PeriodDefinition, type RoomBounds, type YearId } from '../../contracts/period';
import { createKernel, type Kernel } from '../../core/kernel';
import {
  CAFE_ROOM_BOUNDS,
  createEnvironmentModule,
  createStructuralLayout,
  environmentSpec,
  measureShellEnvelope,
  type EnvironmentModule,
} from '../environment';
import {
  createSignageLightingModule,
  signageLightingSpec,
  type SignageLightingModule,
} from './SignageLightingModule';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const openKernels: Kernel[] = [];

afterEach(() => {
  for (const kernel of openKernels.splice(0)) {
    if (!kernel.isDisposed) kernel.dispose();
  }
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

interface Scene {
  readonly kernel: Kernel;
  readonly environment: EnvironmentModule;
  readonly signage: SignageLightingModule;
  readonly bounds: RoomBounds;
}

function compose(options: { bounds?: RoomBounds } = {}): Scene {
  const bounds = options.bounds ?? CAFE_ROOM_BOUNDS;
  const layout = createStructuralLayout(bounds);
  const kernel = createKernel(null, {
    forceHeadless: true,
    bounds,
    autoResize: false,
    seed: 0x1945,
  });
  openKernels.push(kernel);
  const environment = createEnvironmentModule({ bounds, layout });
  const signage = createSignageLightingModule({ bounds: environment.bounds, layout: environment.layout, seed: 0x1945 });
  const context = kernel.createBuildContext(periodFor('1945'), {
    services: { environmentModule: environment },
  });
  environment.build(context);
  signage.build(context);
  return { kernel, environment, signage, bounds: environment.bounds };
}

/**
 * Applies one era to both modules, the way the transition engine will, and
 * reports the shell's node census measured between the two applications so the
 * signage module can be held to account for not touching the room.
 */
function applyYear(scene: Scene, year: YearId): { shellNodes: number; shellChildren: number } {
  scene.kernel.setYear(year);
  const period = periodFor(year);
  const context = scene.kernel.createBuildContext(period, {
    services: { environmentModule: scene.environment },
  });
  scene.environment.applyPeriod(period, context);
  const shellNodes = scene.environment.nodeCount;
  const shellChildren = scene.environment.root?.children.length ?? 0;
  scene.signage.applyPeriod(period, context);
  scene.environment.update(0.1, { year, elapsedSeconds: 0.1, frame: 1 });
  scene.signage.update(0.1, { year, elapsedSeconds: 0.1, frame: 1 });
  return { shellNodes, shellChildren };
}

/** Every mesh box under `root`, checked against the room volume. */
function meshBoxProblems(root: THREE.Object3D, bounds: RoomBounds, tolerance: number): string[] {
  root.updateMatrixWorld(true);
  const problems: string[] = [];
  const box = new THREE.Box3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    box.setFromObject(object);
    if (box.isEmpty()) return;
    if (
      box.min.x < -bounds.width / 2 - tolerance ||
      box.max.x > bounds.width / 2 + tolerance ||
      box.min.z < -bounds.depth / 2 - tolerance ||
      box.max.z > bounds.depth / 2 + tolerance ||
      box.min.y < -tolerance ||
      box.max.y > bounds.height + tolerance
    ) {
      problems.push(object.name);
    }
  });
  return problems;
}

function lightOutside(bounds: RoomBounds, light: THREE.Object3D): boolean {
  const position = new THREE.Vector3();
  light.getWorldPosition(position);
  return (
    Math.abs(position.x) > bounds.width / 2 ||
    Math.abs(position.z) > bounds.depth / 2 ||
    position.y <= 0 ||
    position.y >= bounds.height
  );
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

describe('signage and lighting on the café shell', () => {
  it('applies all five eras on the environment’s own bounds and anchors', () => {
    const scene = compose();
    const { signage, environment, kernel, bounds } = scene;

    // The signage module reads the shell's room and anchors, not its own copy.
    expect(signage.layout).toBe(environment.layout);
    expect(signage.bounds).toBe(environment.bounds);
    expect(kernel.world.children).toHaveLength(2);
    expect(environment.nodeCount).toBeGreaterThan(0);

    const anchorIds = new Set<string>([
      ...environment.layout.wallMounts.map((mount) => mount.id),
      ...environment.layout.reservedZones.map((zone) => zone.id),
      ...environment.layout.counterPassSlots.map((slot) => slot.id),
      'back-wall-above-counter',
      'counter-service-face',
    ]);

    for (const year of YEAR_IDS) {
      const { shellNodes, shellChildren } = applyYear(scene, year);
      const spec = signageLightingSpec(year);
      const root = signage.root;
      expect(root).toBeInstanceOf(THREE.Object3D);
      if (!root) throw new Error('signage root missing');

      expect(signage.spec?.year).toBe(year);
      expect(signage.signs).toHaveLength(spec.signs.length);
      expect(signage.activeLightCount).toBeGreaterThan(0);
      expect(signage.activeLightCount).toBeLessThanOrEqual(spec.maxActiveLights);
      expect(signage.placementProblems).toEqual([]);

      // The shell measured exactly the volume both modules build against.
      const shellRoot = environment.root;
      expect(shellRoot).toBeInstanceOf(THREE.Object3D);
      if (!shellRoot) throw new Error('environment root missing');
      const measured = measureShellEnvelope(shellRoot);
      expect(measured).not.toBeNull();
      expect(measured?.width).toBeCloseTo(bounds.width, 3);
      expect(measured?.depth).toBeCloseTo(bounds.depth, 3);

      // Every sign panel and fixture part stays inside the room.
      expect(meshBoxProblems(root, bounds, 0.06)).toEqual([]);
      root.updateMatrixWorld(true);
      const worldPosition = new THREE.Vector3();
      for (const light of signage.lights) {
        expect(lightOutside(bounds, light)).toBe(false);
        light.getWorldPosition(worldPosition);
        expect(Number.isFinite(worldPosition.x)).toBe(true);
        expect(Number.isFinite(worldPosition.y)).toBe(true);
      }

      // Every sign hangs off a structural anchor the shell published.
      for (const sign of signage.signs) {
        expect(anchorIds.has(sign.anchorId)).toBe(true);
        const wall = environment.layout.walls.find((entry) => entry.id === sign.wall);
        expect(wall).toBeDefined();
        // Signs are mounted inside the room, never outside the shell.
        if (sign.wall === 'front') expect(sign.box.max.z).toBeLessThanOrEqual(bounds.depth / 2);
        if (sign.wall === 'back') expect(sign.box.min.z).toBeGreaterThanOrEqual(-bounds.depth / 2);
      }
      // Glazing signs use the shell's own bay ids.
      for (const sign of signage.signs.filter((entry) => entry.surface === 'storefront-glass')) {
        expect(environment.layout.glazingZones.some((zone) => zone.id === sign.anchorId)).toBe(true);
      }

      // Hotspots are anchored inside the signage group, never the shell's.
      const hotspots = signage.getHotspots();
      expect(hotspots).toHaveLength(signage.signs.length + signage.fixtures.length);
      for (const hotspot of hotspots) {
        expect(hotspot.year).toBe(year);
        expect(hotspot.anchor).toBeInstanceOf(THREE.Object3D);
        let owner: THREE.Object3D | undefined = hotspot.anchor;
        while (owner && owner !== root) owner = owner.parent ?? undefined;
        expect(owner).toBe(root);
      }
      const focus = signage.signFocus(signage.signs[0]?.signId ?? '');
      expect(focus).not.toBeNull();
      expect(focus?.year).toBe(year);

      // The signage domain adds its own group and never disturbs the shell.
      expect(environment.nodeCount).toBe(shellNodes);
      expect(environment.root?.children.length).toBe(shellChildren);
      expect(kernel.world.children).toHaveLength(2);
      // Exposure and colour temperature come from the same era data.
      expect(signage.exposureHints.exposure).toBe(spec.exposure);
      expect(signage.exposureHints.colorTemperatureK).toBe(spec.colorTemperatureK);
      expect(signage.inventory.year).toBe(year);
    }

    signage.dispose();
    environment.dispose();
    expect(kernel.world.children).toHaveLength(0);
    expect(environment.nodeCount).toBe(0);
    expect(signage.root).toBeUndefined();
  });

  it('keeps the room envelope and anchors stable while the signage era changes', () => {
    const scene = compose();
    const { environment, signage, kernel, bounds } = scene;
    const layout = environment.layout;
    const baseline = measureShellEnvelope(environment.root as THREE.Object3D);
    expect(baseline).not.toBeNull();

    for (const year of YEAR_IDS) {
      applyYear(scene, year);
      // The shell re-dresses per era, but the volume and the anchor set it
      // publishes to its consumers never move.
      expect(environment.layout).toBe(layout);
      expect(environment.bounds).toBe(bounds);
      const envelope = measureShellEnvelope(environment.root as THREE.Object3D);
      expect(envelope?.width).toBeCloseTo(baseline?.width ?? 0, 3);
      expect(envelope?.depth).toBeCloseTo(baseline?.depth ?? 0, 3);
      expect(envelope?.height).toBeCloseTo(baseline?.height ?? 0, 3);
      // The signage group is a sibling of the shell, never a child of it.
      const shellRoot = environment.root;
      const signageRoot = signage.root;
      expect(shellRoot).toBeInstanceOf(THREE.Object3D);
      expect(signageRoot).toBeInstanceOf(THREE.Object3D);
      if (!shellRoot || !signageRoot) throw new Error('missing module roots');
      expect(shellRoot.children).not.toContain(signageRoot);
      expect(kernel.world.children).toContain(shellRoot);
      expect(kernel.world.children).toContain(signageRoot);
      expect(signage.signs.every((sign) => sign.anchorId.length > 0)).toBe(true);
    }

    signage.dispose();
    environment.dispose();
  });

  it('re-derives every sign and fixture on a smaller shell', () => {
    const bounds: RoomBounds = { width: 7.4, depth: 9.2, height: 3.4 };
    const scene = compose({ bounds });
    expect(scene.signage.bounds.width).toBe(bounds.width);
    expect(scene.signage.layout).toBe(scene.environment.layout);

    for (const year of YEAR_IDS) {
      applyYear(scene, year);
      expect(scene.signage.signs.length).toBeGreaterThanOrEqual(3);
      expect(scene.signage.placementProblems).toEqual([]);
      const root = scene.signage.root;
      if (!root) throw new Error('signage root missing');
      expect(meshBoxProblems(root, bounds, 0.06)).toEqual([]);
      expect(scene.signage.exposureHints.nightExposure).toBe(signageLightingSpec(year).nightExposure);
      const facade = scene.signage.signs.find((sign) => sign.surface === 'facade');
      expect(facade).toBeDefined();
      expect(facade?.box.max.y).toBeLessThan(bounds.height);
      expect(facade?.box.min.y).toBeGreaterThan(0.5);
    }

    scene.signage.dispose();
    scene.environment.dispose();
    expect(scene.kernel.world.children).toHaveLength(0);
  });
});
