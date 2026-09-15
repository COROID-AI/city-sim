/**
 * Poster × environment composition suite (headless, node).
 *
 * Proves the poster domain composes with the room shell it is placed against:
 * the same headless kernel owns both modules, the environment shell provides the
 * `RoomBounds` and the structural anchor set, the timeline applies all five years
 * to both, and every mounted poster:
 *
 *  - sits on a wall surface the shell actually built (right plane, right inward
 *    normal) rather than on hard-coded world coordinates,
 *  - stays inside the room the shell measured,
 *  - never intersects the reserved doorway, the storefront glazing, the counter
 *    or the menu board's readable sightline,
 *  - is exposed as a hotspot whose anchor lives in the poster module's own group,
 *  - is released again when both modules dispose, leaving an empty world.
 *
 * The zone checks are re-derived here from the shell's anchors (point sampling
 * against explicit boxes) instead of trusting the module's own placement checker.
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
  wallSurface,
  type EnvironmentModule,
  type ReservedZone,
} from '../environment';
import {
  boxesOverlap,
  counterBox,
  createPosterModule,
  menuBoardMount,
  menuSightlineBox,
  posterPlacementProblems,
  posterWallFrame,
  reservedZoneBox,
  type PosterModule,
  type PosterPlacement,
} from './PosterModule';
import { posterSpec } from './data/index';

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
  posters: PosterModule;
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
  const posters = createPosterModule({ bounds, layout, seed: 0x1945 });
  const context = kernel.createBuildContext(periodFor('1945'), {
    services: { environmentModule: environment },
  });
  environment.build(context);
  posters.build(context);
  return { kernel, environment, posters };
}

function applyYear(scene: Scene, year: YearId): { shellNodesAfterEnvironment: number } {
  scene.kernel.setYear(year);
  const period = periodFor(year);
  const context = scene.kernel.createBuildContext(period, {
    services: { environmentModule: scene.environment },
  });
  scene.environment.applyPeriod(period, context);
  const shellNodesAfterEnvironment = scene.environment.nodeCount;
  scene.posters.applyPeriod(period, context);
  scene.environment.update(0.1, { year, elapsedSeconds: 0.1, frame: 1 });
  scene.posters.update(0.1, { year, elapsedSeconds: 0.1, frame: 1 });
  return { shellNodesAfterEnvironment };
}

/** Point samples across the mounted sheet: corners, edges and centre. */
function samplePoints(placement: PosterPlacement, inset: number): { x: number; y: number; z: number }[] {
  const frame = posterWallFrame(placement.wall);
  const lateral = frame.lateral;
  const halfWidth = placement.width / 2 - inset;
  const halfHeight = placement.height / 2 - inset;
  const points: { x: number; y: number; z: number }[] = [];
  for (const lateralOffset of [-halfWidth, 0, halfWidth]) {
    for (const verticalOffset of [-halfHeight, 0, halfHeight]) {
      points.push({
        x: placement.position.x + lateral.x * lateralOffset,
        y: placement.position.y + verticalOffset,
        z: placement.position.z + lateral.z * lateralOffset,
      });
    }
  }
  return points;
}

function insideBox(point: { x: number; y: number; z: number }, box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }): boolean {
  return (
    point.x > box.min.x &&
    point.x < box.max.x &&
    point.y > box.min.y &&
    point.y < box.max.y &&
    point.z > box.min.z &&
    point.z < box.max.z
  );
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

describe('posters on the café shell', () => {
  it('applies all five eras on the environment’s wall surfaces inside the room', () => {
    const scene = compose();
    expect(scene.posters.layout).toBe(scene.environment.layout);
    expect(scene.posters.bounds).toBe(scene.environment.bounds);
    expect(scene.kernel.world.children).toHaveLength(2);
    expect(scene.environment.nodeCount).toBeGreaterThan(0);

    for (const year of YEAR_IDS) {
      const { shellNodesAfterEnvironment } = applyYear(scene, year);
      const spec = posterSpec(year);
      const placements = scene.posters.placements;
      expect(scene.posters.spec?.year).toBe(year);
      expect(placements).toHaveLength(spec.posters.length);
      expect(posterPlacementProblems(placements, scene.environment.layout, scene.environment.bounds)).toEqual([]);

      const measured = measureShellEnvelope(scene.environment.root as THREE.Object3D);
      expect(measured).not.toBeNull();
      expect(measured?.width).toBeCloseTo(scene.environment.bounds.width, 3);
      expect(measured?.depth).toBeCloseTo(scene.environment.bounds.depth, 3);

      for (const placement of placements) {
        // On a wall surface the shell built: right plane, right inward normal.
        const wall = wallSurface(scene.environment.layout.walls, placement.wall);
        const frame = posterWallFrame(placement.wall);
        expect(frame.normal).toEqual(wall.inward);
        expect(frame.rotationY).toBe(placement.rotationY);
        const planeCoordinate = wall.runAxis === 'x' ? placement.position.z : placement.position.x;
        const wallPlane = wall.runAxis === 'x' ? wall.center.z : wall.center.x;
        expect(Math.abs(planeCoordinate - wallPlane)).toBeLessThan(0.05);

        // Mounted on one of the shell's own poster mounts.
        const mount = scene.environment.layout.wallMounts.find((entry) => entry.id === placement.mountId);
        expect(mount).toBeDefined();
        expect(mount?.purpose).toBe('poster');
        expect(mount?.wall).toBe(placement.wall);

        // Inside the room volume.
        for (const point of samplePoints(placement, 0.2)) {
          expect(Math.abs(point.x)).toBeLessThanOrEqual(scene.environment.bounds.width / 2);
          expect(Math.abs(point.z)).toBeLessThanOrEqual(scene.environment.bounds.depth / 2);
          expect(point.y).toBeGreaterThan(1);
          expect(point.y).toBeLessThan(scene.environment.bounds.height);
        }
      }

      // The poster domain adds its own group and never disturbs the shell.
      expect(shellNodesAfterEnvironment).toBeGreaterThan(0);
      expect(scene.environment.nodeCount).toBe(shellNodesAfterEnvironment);
      expect(scene.kernel.world.children).toHaveLength(2);

      // Hotspots: one per poster, anchored in the poster module's group.
      const hotspots = scene.posters.getHotspots();
      expect(hotspots).toHaveLength(placements.length);
      const root = scene.posters.root;
      expect(root).toBeInstanceOf(THREE.Object3D);
      for (const hotspot of hotspots) {
        expect(hotspot.year).toBe(year);
        expect(hotspot.anchor).toBeInstanceOf(THREE.Object3D);
        let owner = hotspot.anchor as THREE.Object3D | undefined;
        while (owner && owner !== root) owner = owner.parent ?? undefined;
        expect(owner).toBe(root);
      }
      const focus = scene.posters.posterFocus(placements[0]?.posterId ?? '');
      expect(focus).not.toBeNull();
      expect(focus?.year).toBe(year);
    }

    scene.posters.dispose();
    scene.environment.dispose();
    expect(scene.kernel.world.children).toHaveLength(0);
  });

  it('keeps every mounted sheet clear of the doorway, glazing, counter and menu sightline', () => {
    const scene = compose();
    const layout = scene.environment.layout;
    const menuMount = menuBoardMount(layout);
    expect(menuMount).toBeDefined();
    const sightline = menuSightlineBox(layout);
    expect(sightline).not.toBeNull();
    const counter = counterBox(layout);
    const openings: readonly ReservedZone[] = [
      layout.doorway,
      layout.entrance,
      ...layout.glazingZones,
    ];
    expect(openings.length).toBeGreaterThan(4);
    const openingBoxes = openings.map((zone) => reservedZoneBox(zone));

    for (const year of YEAR_IDS) {
      applyYear(scene, year);
      for (const placement of scene.posters.placements) {
        // Independent check: no sample point of the sheet lands in an opening,
        // over the counter or in the menu board's readable sightline.
        for (const point of samplePoints(placement, 0.05)) {
          for (const [index, openingBox] of openingBoxes.entries()) {
            expect(
              insideBox(point, openingBox),
            ).toBe(false);
            expect(openings[index]?.id).toBeTruthy();
          }
          expect(insideBox(point, counter)).toBe(false);
          if (sightline) expect(insideBox(point, sightline)).toBe(false);
        }
        // …and the sheet never overlaps the zone volumes either.
        for (const openingBox of openingBoxes) {
          expect(boxesOverlap(placement.footprint, openingBox)).toBe(false);
        }
        expect(boxesOverlap(placement.footprint, counter)).toBe(false);
        if (sightline) expect(boxesOverlap(placement.footprint, sightline)).toBe(false);
        // The menu board keeps its own anchor.
        expect(placement.mountId).not.toBe(menuMount?.id);
      }
    }

    scene.posters.dispose();
    scene.environment.dispose();
  });

  it('derives placement from the shell it is given rather than fixed world coordinates', () => {
    // A smaller, more cramped room: the same posters must re-derive their mounts.
    const bounds: RoomBounds = { width: 7.4, depth: 9.2, height: 3.4 };
    const scene = compose({ bounds });
    expect(scene.posters.bounds.width).toBe(bounds.width);
    expect(scene.posters.bounds.depth).toBe(bounds.depth);

    for (const year of YEAR_IDS) {
      applyYear(scene, year);
      const placements = scene.posters.placements;
      expect(placements.length).toBeGreaterThan(0);
      expect(posterPlacementProblems(placements, scene.environment.layout, bounds)).toEqual([]);
      const placementsByWall = new Set(placements.map((placement) => placement.wall));
      expect(placementsByWall.size).toBeGreaterThan(1);
      for (const placement of placements) {
        const frame = posterWallFrame(placement.wall);
        const wallPlane = frame.normal.x !== 0 ? (bounds.width / 2) * Math.sign(-frame.normal.x) : (bounds.depth / 2) * Math.sign(-frame.normal.z);
        const coordinate = frame.normal.x !== 0 ? placement.position.x : placement.position.z;
        expect(Math.abs(coordinate - wallPlane)).toBeLessThan(0.05);
        expect(placement.footprint.max.y).toBeLessThan(bounds.height);
        expect(placement.footprint.min.y).toBeGreaterThan(0.9);
      }
    }

    scene.posters.dispose();
    scene.environment.dispose();
    expect(scene.kernel.world.children).toHaveLength(0);
  });
});
