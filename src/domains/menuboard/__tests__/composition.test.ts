/**
 * Menu board × environment composition suite (headless, node).
 *
 * Proves the board composes with the room shell it is hung in: the same headless
 * kernel owns both modules, the environment provides the {@link RoomBounds} and
 * the structural anchor set, the timeline applies all five years to both, and for
 * every era the board:
 *
 *  - hangs on a wall surface the shell actually built, on the shell's own menu
 *    mount, at the right plane and facing the room (instead of hard-coded world
 *    coordinates),
 *  - stays inside the room the shell measured, with a finite transform and no
 *    NaN,
 *  - fits inside the readable sightline the shell's menu mount implies, so a
 *    board never reaches past its own anchoring surface,
 *  - never intersects the reserved doorway, storefront glazing, entrance or the
 *    counter,
 *  - falls back to a counter-wall anchor, still inside the room, when a shell
 *    publishes no menu mount at all,
 *  - is released again when both modules dispose, leaving an empty world.
 *
 * The zone checks are re-derived here from the shell's anchors (boxes built
 * locally and point sampling) instead of trusting the module's own checker.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { YEAR_IDS, type PeriodDefinition, type RoomBounds, type YearId } from '../../../contracts/period';
import { createKernel, type Kernel } from '../../../core/kernel';
import {
  CAFE_ROOM_BOUNDS,
  createEnvironmentModule,
  createStructuralLayout,
  environmentSpec,
  wallSurface,
  type EnvironmentModule,
  type ReservedZone,
  type StructuralLayout,
} from '../../environment';
import { COUNTER_WALL_ANCHOR_ID, menuMountOf } from '../boardGeometry';
import { createMenuBoardModule, type MenuBoardModule } from '../MenuBoardModule';
import { MENU_BOARD_SPECS } from '../data/index';

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
  kernel: Kernel;
  environment: EnvironmentModule;
  board: MenuBoardModule;
  layout: StructuralLayout;
}

function compose(options: { bounds?: RoomBounds; layout?: StructuralLayout } = {}): Scene {
  const bounds = options.bounds ?? CAFE_ROOM_BOUNDS;
  const layout = options.layout ?? createStructuralLayout(bounds);
  const kernel = createKernel(null, {
    forceHeadless: true,
    bounds,
    autoResize: false,
    seed: 0x1945,
  });
  openKernels.push(kernel);
  const environment = createEnvironmentModule({ bounds, layout });
  const board = createMenuBoardModule({ bounds, layout, textureHeight: 96 });
  const context = kernel.createBuildContext(periodFor('1945'), {
    services: { environmentModule: environment },
  });
  environment.build(context);
  board.build(context);
  return { kernel, environment, board, layout };
}

function applyYear(scene: Scene, year: YearId): void {
  scene.kernel.setYear(year);
  const period = periodFor(year);
  const context = scene.kernel.createBuildContext(period, {
    services: { environmentModule: scene.environment },
  });
  scene.environment.applyPeriod(period, context);
  scene.board.applyPeriod(period, context);
  scene.environment.update(0.1, { year, elapsedSeconds: 0.1, frame: 1 });
  scene.board.update(0.1, { year, elapsedSeconds: 0.1, frame: 1 });
}

/* -- Independent geometry helpers (not the module's own) --------------------- */

interface Box {
  readonly min: { readonly x: number; readonly y: number; readonly z: number };
  readonly max: { readonly x: number; readonly y: number; readonly z: number };
}

function boxFromCentre(
  centre: { x: number; y: number; z: number },
  half: { x: number; y: number; z: number },
): Box {
  return {
    min: { x: centre.x - half.x, y: centre.y - half.y, z: centre.z - half.z },
    max: { x: centre.x + half.x, y: centre.y + half.y, z: centre.z + half.z },
  };
}

function reservedZoneVolume(zone: ReservedZone): Box {
  const halfWidth = zone.width / 2;
  const halfHeight = zone.height / 2;
  const centreY = zone.sillHeight + halfHeight;
  if (zone.wall === 'back' || zone.wall === 'front') {
    return {
      min: { x: zone.position.x - halfWidth, y: centreY - halfHeight, z: zone.position.z - 0.12 },
      max: { x: zone.position.x + halfWidth, y: centreY + halfHeight, z: zone.position.z + 0.12 },
    };
  }
  return {
    min: { x: zone.position.x - 0.12, y: centreY - halfHeight, z: zone.position.z - halfWidth },
    max: { x: zone.position.x + 0.12, y: centreY + halfHeight, z: zone.position.z + halfWidth },
  };
}

function counterVolume(layout: StructuralLayout): Box {
  const counter = layout.counter;
  return boxFromCentre(
    { x: counter.center.x, y: counter.surfaceHeight / 2, z: counter.center.z },
    { x: counter.width / 2, y: counter.surfaceHeight / 2, z: counter.depth / 2 },
  );
}

function volumesOverlap(a: Box, b: Box): boolean {
  return (
    a.min.x < b.max.x && b.min.x < a.max.x &&
    a.min.y < b.max.y && b.min.y < a.max.y &&
    a.min.z < b.max.z && b.min.z < a.max.z
  );
}

function insideVolume(point: { x: number; y: number; z: number }, box: Box): boolean {
  return (
    point.x > box.min.x && point.x < box.max.x &&
    point.y > box.min.y && point.y < box.max.y &&
    point.z > box.min.z && point.z < box.max.z
  );
}

function boxIsFinite(box: Box): boolean {
  return (
    Number.isFinite(box.min.x) && Number.isFinite(box.min.y) && Number.isFinite(box.min.z) &&
    Number.isFinite(box.max.x) && Number.isFinite(box.max.y) && Number.isFinite(box.max.z)
  );
}

/** The volume a board's menu mount implies: the sightline the poster domain reserves. */
function menuSightline(layout: StructuralLayout): Box | null {
  const mount = menuMountOf(layout);
  if (!mount) return null;
  const depth = 2.4;
  const halfLateral = (mount.width + 0.5) / 2;
  const climb = 0.75;
  if (Math.abs(mount.normal.x) > 0.5) {
    const to = mount.position.x + depth * mount.normal.x;
    return {
      min: {
        x: Math.min(mount.position.x, to),
        y: mount.mountHeight - climb,
        z: mount.position.z - halfLateral - 0.25,
      },
      max: {
        x: Math.max(mount.position.x, to),
        y: mount.mountHeight + climb,
        z: mount.position.z + halfLateral + 0.25,
      },
    };
  }
  const to = mount.position.z + depth * mount.normal.z;
  return {
    min: {
      x: mount.position.x - halfLateral - 0.25,
      y: mount.mountHeight - climb,
      z: Math.min(mount.position.z, to),
    },
    max: {
      x: mount.position.x + halfLateral + 0.25,
      y: mount.mountHeight + climb,
      z: Math.max(mount.position.z, to),
    },
  };
}

/** Corner and face-centre samples of a placed board. */
function boardSamples(placement: NonNullable<MenuBoardModule['placement']>): { x: number; y: number; z: number }[] {
  const box = placement.box;
  const mid = {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };
  const points: { x: number; y: number; z: number }[] = [mid];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        points.push({ x, y, z });
      }
    }
  }
  return points;
}

/* -------------------------------------------------------------------------- */
/* Composition                                                               */
/* -------------------------------------------------------------------------- */

describe('menu board on the café shell', () => {
  it('hangs the board on the shell’s menu mount inside the room for every era', () => {
    const scene = compose();
    expect(scene.board.layout).toBe(scene.environment.layout);
    expect(scene.board.bounds).toBe(scene.environment.bounds);
    expect(scene.kernel.world.children).toHaveLength(2);
    expect(scene.board.root?.name).toBe('menuboard');
    expect(scene.environment.root?.name).toBe('environment');

    const mount = menuMountOf(scene.layout);
    expect(mount).toBeDefined();
    const sightline = menuSightline(scene.layout);
    expect(sightline).not.toBeNull();

    for (const year of YEAR_IDS) {
      // The environment dresses the room for the new era first; the board then
      // re-hangs itself without disturbing a single shell node.
      scene.kernel.setYear(year);
      const period = periodFor(year);
      const context = scene.kernel.createBuildContext(period, {
        services: { environmentModule: scene.environment },
      });
      scene.environment.applyPeriod(period, context);
      const shellNodes = scene.environment.nodeCount;
      scene.board.applyPeriod(period, context);
      scene.board.update(0.1, { year, elapsedSeconds: 0.1, frame: 1 });

      const placement = scene.board.placement;
      expect(placement).toBeDefined();
      if (!placement) continue;
      const description = scene.board.describe();
      expect(description.year).toBe(year);
      expect(description.anchorSource).toBe('wall-mount');
      expect(description.mountId).toBe(mount?.id);
      expect(description.wall).toBe(mount?.wall);
      expect(description.placementProblems).toEqual([]);

      // Finite transform and box, no NaN.
      expect(Number.isFinite(placement.position.x)).toBe(true);
      expect(Number.isFinite(placement.position.y)).toBe(true);
      expect(Number.isFinite(placement.position.z)).toBe(true);
      expect(Number.isFinite(placement.rotationY)).toBe(true);
      expect(Number.isFinite(placement.tilt)).toBe(true);
      expect(boxIsFinite(placement.box)).toBe(true);
      expect(Number.isNaN(placement.box.min.y)).toBe(false);

      // On the shell's wall plane, facing the room.
      const wall = wallSurface(scene.layout.walls, placement.wall);
      const planeCoordinate = wall.runAxis === 'x' ? placement.position.z : placement.position.x;
      const wallPlane = wall.runAxis === 'x' ? wall.center.z : wall.center.x;
      expect(placement.normal).toEqual(wall.inward);
      // The carcass hugs the wall: the centre sits half a board depth off the
      // plane, plus the small clearance a tilted board stands on.
      expect(Math.abs(Math.abs(planeCoordinate - wallPlane) - placement.depth / 2)).toBeLessThan(0.05);
      expect(placement.rotationY).toBeCloseTo(
        placement.wall === 'right' ? -Math.PI / 2 : 0,
        6,
      );

      // Inside the room the shell measured.
      const bounds = scene.environment.bounds;
      expect(placement.box.min.x).toBeGreaterThanOrEqual(-bounds.width / 2 - 1e-6);
      expect(placement.box.max.x).toBeLessThanOrEqual(bounds.width / 2 + 1e-6);
      expect(placement.box.min.z).toBeGreaterThanOrEqual(-bounds.depth / 2 - 1e-6);
      expect(placement.box.max.z).toBeLessThanOrEqual(bounds.depth / 2 + 1e-6);
      expect(placement.box.min.y).toBeGreaterThan(0);
      expect(placement.box.max.y).toBeLessThan(bounds.height);

      // Inside the readable sightline of its own mount: the board never reaches
      // past its anchoring surface or over the neighbouring panels.
      if (sightline) {
        expect(placement.box.min.x).toBeGreaterThanOrEqual(sightline.min.x - 1e-6);
        expect(placement.box.max.x).toBeLessThanOrEqual(sightline.max.x + 1e-6);
        expect(placement.box.min.z).toBeGreaterThanOrEqual(sightline.min.z - 30e-6);
        expect(placement.box.max.z).toBeLessThanOrEqual(sightline.max.z + 30e-6);
        expect(placement.box.min.y).toBeGreaterThanOrEqual(sightline.min.y - 1e-6);
        expect(placement.box.max.y).toBeLessThanOrEqual(sightline.max.y + 1e-6);
      }

      // The board hangs on the shell's own mount surface, and the shell is
      // untouched by the board module.
      expect(scene.layout.wallMounts.some((entry) => entry.id === placement.anchorId)).toBe(true);
      expect(scene.environment.nodeCount).toBe(shellNodes);
      expect(scene.kernel.world.children).toHaveLength(2);
    }

    scene.board.dispose();
    scene.environment.dispose();
    expect(scene.kernel.world.children).toHaveLength(0);
  }, 60_000);

  it('keeps the board clear of the doorway, the glazing, the entrance and the counter', () => {
    const scene = compose();
    const layout = scene.environment.layout;
    const openings: readonly ReservedZone[] = [layout.doorway, layout.entrance, ...layout.glazingZones];
    const openingVolumes = openings.map((zone) => reservedZoneVolume(zone));
    const counter = counterVolume(layout);
    expect(openings.length).toBeGreaterThan(4);

    for (const year of YEAR_IDS) {
      applyYear(scene, year);
      const placement = scene.board.placement;
      expect(placement).toBeDefined();
      if (!placement) continue;

      for (const point of boardSamples(placement)) {
        for (const volume of openingVolumes) expect(insideVolume(point, volume)).toBe(false);
        expect(insideVolume(point, counter)).toBe(false);
      }
      for (const volume of openingVolumes) {
        expect(volumesOverlap(placement.box, volume)).toBe(false);
      }
      expect(volumesOverlap(placement.box, counter)).toBe(false);

      // The board is a wall piece, hung well above the floor.
      expect(placement.box.min.y).toBeGreaterThan(0.7);
    }

    scene.board.dispose();
    scene.environment.dispose();
  }, 60_000);

  it('falls back to the counter wall when the shell publishes no menu mount', () => {
    const full = createStructuralLayout(CAFE_ROOM_BOUNDS);
    const withoutMenu: StructuralLayout = {
      ...full,
      wallMounts: Object.freeze(
        full.wallMounts.filter((mount) => mount.purpose !== 'menu' && !mount.id.includes('menu')),
      ),
    };
    expect(menuMountOf(withoutMenu)).toBeUndefined();

    const scene = compose({ layout: withoutMenu });
    for (const year of YEAR_IDS) {
      applyYear(scene, year);
      const placement = scene.board.placement;
      expect(placement).toBeDefined();
      if (!placement) continue;
      const counter = scene.layout.counter;
      const description = scene.board.describe();
      expect(description.anchorSource).toBe('counter-wall');
      expect(description.mountId).toBe(COUNTER_WALL_ANCHOR_ID);
      expect(description.wall).toBe('back');
      expect(description.placementProblems).toEqual([]);
      // Centred on the counter, clear of its top, inside the room.
      expect(placement.position.x).toBeCloseTo(counter.center.x, 6);
      expect(placement.box.min.y).toBeGreaterThan(counter.surfaceHeight);
      expect(placement.box.min.z).toBeGreaterThanOrEqual(-CAFE_ROOM_BOUNDS.depth / 2 - 1e-6);
      expect(placement.box.max.y).toBeLessThan(CAFE_ROOM_BOUNDS.height);
      expect(volumesOverlap(placement.box, counterVolume(scene.layout))).toBe(false);
      // The board shrinks to what the wall it hangs on can carry.
      expect(placement.width).toBeLessThanOrEqual(Math.min(counter.width * 0.9, 2.8) + 1e-9);
    }

    scene.board.dispose();
    scene.environment.dispose();
  }, 60_000);

  it('derives its placement from the room it is handed rather than fixed coordinates', () => {
    const bounds: RoomBounds = { width: 7.4, depth: 9.2, height: 3.4 };
    const scene = compose({ bounds });
    expect(scene.board.bounds.width).toBe(bounds.width);
    expect(scene.board.bounds.depth).toBe(bounds.depth);
    const mount = menuMountOf(scene.layout);
    expect(mount).toBeDefined();

    for (const year of YEAR_IDS) {
      applyYear(scene, year);
      const placement = scene.board.placement;
      expect(placement).toBeDefined();
      if (!placement) continue;
      expect(scene.board.describe().placementProblems).toEqual([]);
      expect(placement.box.max.x).toBeLessThanOrEqual(bounds.width / 2 + 1e-6);
      expect(placement.box.min.z).toBeGreaterThanOrEqual(-bounds.depth / 2 - 1e-6);
      expect(placement.box.min.y).toBeGreaterThan(0.8);
      expect(placement.box.max.y).toBeLessThan(bounds.height);
      expect(volumesOverlap(placement.box, counterVolume(scene.layout))).toBe(false);
    }

    scene.board.dispose();
    scene.environment.dispose();
  }, 60_000);

  it('is deterministic and independent of the environment module’s own state', () => {
    const first = compose();
    const second = compose();
    for (const year of YEAR_IDS) {
      applyYear(first, year);
      applyYear(second, year);
      expect(first.board.boardLayout?.signature).toBe(second.board.boardLayout?.signature);
      expect(first.board.describe().placementSignature).toBe(second.board.describe().placementSignature);
      expect(first.board.describe().layoutSignature).toBe(second.board.describe().layoutSignature);
      const spec = MENU_BOARD_SPECS[year];
      expect(first.board.panels.length).toBeGreaterThanOrEqual(spec.panels.length);
    }
    // Two boards, two groups: neither module touched the other's nodes.
    expect(first.environment.root).not.toBe(second.environment.root);
    expect(first.board.root?.parent).toBe(first.kernel.world);
    expect(first.environment.root?.parent).toBe(first.kernel.world);
    expect(first.board.getHotspots().length).toBeGreaterThan(3);

    first.board.dispose();
    second.board.dispose();
    first.environment.dispose();
    second.environment.dispose();
    expect(first.kernel.world.children).toHaveLength(0);
    expect(second.kernel.world.children).toHaveLength(0);

    // The board module exposes the era map the registry composes with.
    expect(MENU_BOARD_SPECS['2025'].boardKind).toBe('digital-screen');
    expect(new THREE.Vector3(0, 0, 0).isVector3).toBe(true);
  }, 60_000);
});
