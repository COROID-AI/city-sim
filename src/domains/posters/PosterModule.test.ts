/**
 * Poster domain contract, artwork and lifecycle suite (headless, node).
 *
 * These tests drive the real {@link SceneModule} surface in a headless kernel and
 * assert observable artwork behaviour rather than plumbing:
 *
 *  - all five eras are present, distinct, and cover their required categories,
 *  - every poster face, fitting, decal and frame grain is painted procedurally
 *    (no network access, no remote font or image),
 *  - placements derive from the environment shell's poster mounts and stay inside
 *    the room, clear of the doorway, glazing, counter and menu board sightline,
 *  - each era mounts framed, pinned, taped and unframed sheets with the right
 *    hardware, frames, wall wear and print-colour drift,
 *  - build / applyPeriod / update / dispose release every geometry, material and
 *    texture, and repeated era changes do not grow the live resource sets.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { YEAR_IDS, isSceneModule, type PeriodDefinition, type YearId } from '../../contracts/period';
import { createKernel, type Kernel } from '../../core/kernel';
import {
  CAFE_ROOM_BOUNDS,
  STRUCTURAL_LAYOUT,
  createEnvironmentModule,
  environmentSpec,
  reservedZone,
  wallMountsOf,
  type StructuralLayout,
} from '../environment';
import {
  POSTER_SPECS,
  POSTER_INVENTORY,
  REQUIRED_POSTER_CATEGORIES,
  posterDatasetProblems,
  posterSpec,
  posterSpecProblems,
  type PosterSpec,
  type PosterYearSpec,
} from './data/index';
import {
  FRAME_STYLE_IDS,
  FRAME_STYLES,
  POSTER_MOUNTS,
  frameExtents,
  type FrameStyleId,
} from './frames';
import {
  POSTER_MODULE_ID,
  boxSize,
  boxesOverlap,
  counterBox,
  createPosterModule,
  isMenuBoardMount,
  menuBoardMount,
  menuSightlineBox,
  planPosterPlacements,
  posterPlacementProblems,
  reservedZoneBox,
  type PosterModule,
  type PosterPlacement,
} from './PosterModule';
import {
  PosterResources,
  contrastRatio,
  createPosterFaceTexture,
  isProceduralPosterTexture,
  parseColor,
  paintPosterFace,
  posterTornCorner,
  type CanvasFactory,
  type PosterFaceRequest,
  type PosterResourceCounts,
} from './textures';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const openKernels: Kernel[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
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

function setup(options: { seed?: number; canvasFactory?: CanvasFactory; maxPosters?: number } = {}): {
  kernel: Kernel;
  module: PosterModule;
} {
  const kernel = createKernel(null, {
    forceHeadless: true,
    bounds: CAFE_ROOM_BOUNDS,
    autoResize: false,
    seed: options.seed ?? 0x1945,
  });
  openKernels.push(kernel);
  const module = createPosterModule({
    seed: options.seed ?? 0x1945,
    canvasFactory: options.canvasFactory,
    maxPosters: options.maxPosters,
  });
  module.build(kernel.createBuildContext(periodFor('1945')));
  return { kernel, module };
}

function applyYear(module: PosterModule, kernel: Kernel, year: YearId): void {
  kernel.setYear(year);
  const period = periodFor(year);
  const context = kernel.createBuildContext(period);
  module.applyPeriod(period, context);
  module.update(0.1, { year, elapsedSeconds: 0.1, frame: 1 });
}

function toFaceRequest(spec: PosterYearSpec, poster: PosterSpec, height: number): PosterFaceRequest {
  return {
    id: poster.id,
    title: poster.title,
    layout: poster.layout,
    motif: poster.motif,
    palette: poster.palette,
    headline: poster.headline,
    subhead: poster.subhead,
    body: poster.body,
    badge: poster.badge,
    footer: poster.footer,
    wear: poster.wear,
    fade: poster.fade,
    year: spec.year,
    typography: spec.typography,
    print: spec.print,
    aspect: poster.size[0] / poster.size[1],
  };
}

interface CanvasRecord {
  putImageDataCalls: number;
  images: ImageData[];
}

function recordingCanvasFactory(record: CanvasRecord): CanvasFactory {
  return (width, height) => {
    const context = {
      createImageData: (w: number, h: number): ImageData =>
        ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) as ImageData,
      putImageData: (image: ImageData): void => {
        record.putImageDataCalls += 1;
        record.images.push(image);
      },
    };
    return { width, height, getContext: () => context } as unknown as HTMLCanvasElement;
  };
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  return meshes;
}

function meshNames(root: THREE.Object3D): string[] {
  return meshesOf(root).map((mesh) => mesh.name);
}

function countNodes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse(() => {
    count += 1;
  });
  return count;
}

function trackDisposal(resources: PosterResources): { disposed: () => number; total: number } {
  const snapshot = resources.snapshot();
  const tracked: unknown[] = [...snapshot.geometries, ...snapshot.materials, ...snapshot.textures];
  let disposed = 0;
  for (const resource of tracked) {
    (resource as { addEventListener: (type: string, listener: () => void) => void }).addEventListener('dispose', () => {
      disposed += 1;
    });
  }
  return { disposed: () => disposed, total: tracked.length };
}

function posterOnWall(spec: PosterYearSpec, layout: StructuralLayout): PosterPlacement[] {
  const plan = planPosterPlacements(spec, layout, { bounds: CAFE_ROOM_BOUNDS });
  return [...plan.placements];
}

/* -------------------------------------------------------------------------- */
/* Era inventory                                                              */
/* -------------------------------------------------------------------------- */

describe('era inventory', () => {
  it('supplies one distinct poster programme for every selectable year', () => {
    expect(Object.keys(POSTER_SPECS).sort()).toEqual([...YEAR_IDS].sort());
    expect(posterDatasetProblems()).toEqual([]);

    const signatures = new Set<string>();
    // The frame vocabulary is complete and self-describing.
    for (const id of FRAME_STYLE_IDS) {
      expect(FRAME_STYLES[id].id).toBe(id);
      expect(FRAME_STYLES[id].mounts.length).toBeGreaterThan(0);
    }
    expect(POSTER_MOUNTS).toEqual(['framed', 'pinned', 'taped', 'unframed']);
    for (const year of YEAR_IDS) {
      const spec = posterSpec(year);
      expect(spec.year).toBe(year);
      expect(spec.posters.length).toBeGreaterThanOrEqual(6);
      expect(posterSpecProblems(spec)).toEqual([]);
      for (const category of REQUIRED_POSTER_CATEGORIES[year]) {
        expect(spec.posters.some((poster) => poster.category === category)).toBe(true);
      }
      for (const mount of ['framed', 'pinned', 'taped', 'unframed'] as const) {
        expect(spec.posters.some((poster) => poster.mount === mount)).toBe(true);
      }
      // Era-specific content: the categories that make the wall of that year.
      signatures.add(
        `${spec.posters.map((poster) => poster.category).join(',')}|${spec.print.misregistration}|${spec.typography.display}`,
      );
    }
    expect(signatures.size).toBe(YEAR_IDS.length);

    const wartime = posterSpec('1945');
    expect(wartime.posters.some((poster) => poster.category === 'rationing')).toBe(true);
    expect(wartime.posters.some((poster) => poster.category === 'civic-notice')).toBe(true);
    expect(wartime.posters.flatMap((poster) => poster.body).join(' ')).toMatch(/RATION|SALVAGE|FUEL/);

    const sixties = posterSpec('1965');
    expect(sixties.posters.flatMap((poster) => poster.category)).toEqual(
      expect.arrayContaining(['soda', 'tobacco', 'travel']),
    );

    const eighties = posterSpec('1985');
    expect(eighties.posters.filter((poster) => poster.mount === 'framed').map((poster) => poster.frame)).toEqual(
      expect.arrayContaining(['neon-tube', 'gloss-black']),
    );

    const twoThousands = posterSpec('2005');
    expect(twoThousands.posters.flatMap((poster) => poster.category)).toEqual(
      expect.arrayContaining(['film', 'telecom', 'early-web']),
    );
    expect(twoThousands.posters.some((poster) => /INTERNET|EMAIL|BROADBAND/.test(poster.headline))).toBe(true);

    const twenties = posterSpec('2025');
    expect(twenties.posters.flatMap((poster) => poster.category)).toEqual(
      expect.arrayContaining(['social', 'sustainability', 'local-art']),
    );
    expect(twenties.posters.some((poster) => /CUP|RENEWABLE|RISO|WELCOME/i.test(poster.headline))).toBe(true);
  });

  it('publishes a flat inventory table the verification tasks can assert against', () => {
    for (const year of YEAR_IDS) {
      const spec = posterSpec(year);
      const row = POSTER_INVENTORY[year];
      expect(row.year).toBe(year);
      expect(row.posterCount).toBe(spec.posters.length);
      expect(row.posterCount).toBeGreaterThanOrEqual(6);
      expect(row.categories).toEqual(SPEC_CATEGORIES(spec));
      expect(row.mounts).toEqual(SPEC_MOUNTS(spec));
      expect(row.frames).toEqual([...new Set(spec.posters.map((poster) => poster.frame))]);
      expect(Object.keys(row.notes).sort()).toEqual(spec.posters.map((poster) => poster.id).sort());
      expect(row.notes[spec.posters[0]?.id ?? '']).toBe(spec.posters[0]?.note);
      expect(row.hardware.length).toBeGreaterThan(0);
      expect(row.typography).toEqual([spec.typography.display, spec.typography.body]);
      expect(row.proceduralOnly).toBe(true);
      expect(row.notes[spec.posters[1]?.id ?? '']).toBe(spec.posters[1]?.note);
      expect(row.summary.length).toBeGreaterThan(20);
      for (const frame of row.frames) {
        expect(FRAME_STYLES[frame]).toBeDefined();
      }
    }
    // Every era's headline set is its own; no accidental copy-paste across eras.
    const headlineSets = YEAR_IDS.map((year) => POSTER_INVENTORY[year].headlines.join('|'));
    expect(new Set(headlineSets).size).toBe(YEAR_IDS.length);
  });
});

function SPEC_CATEGORIES(spec: PosterYearSpec): readonly string[] {
  const seen: string[] = [];
  for (const poster of spec.posters) if (!seen.includes(poster.category)) seen.push(poster.category);
  return seen;
}

function SPEC_MOUNTS(spec: PosterYearSpec): readonly string[] {
  const seen: string[] = [];
  for (const poster of spec.posters) if (!seen.includes(poster.mount)) seen.push(poster.mount);
  return seen;
}

/* -------------------------------------------------------------------------- */
/* Procedural artwork                                                         */
/* -------------------------------------------------------------------------- */

describe('procedural artwork', () => {
  it('paints every face on a 2D canvas without touching the network', () => {
    const networkAttempts: string[] = [];
    vi.stubGlobal('fetch', (...args: unknown[]) => {
      networkAttempts.push(String(args[0]));
      throw new Error('poster pipeline must not fetch anything');
    });
    const record: CanvasRecord = { putImageDataCalls: 0, images: [] };
    const { kernel, module } = setup({ canvasFactory: recordingCanvasFactory(record) });
    expect(module.posterCount).toBe(posterSpec('1945').posters.length);

    for (const year of YEAR_IDS) {
      kernel.setYear(year);
      applyYear(module, kernel, year);
      expect(module.textureSource).toBe('canvas');
      expect(module.proceduralOnly).toBe(true);
      for (const face of module.faces) {
        expect(face.texture).toBeInstanceOf(THREE.CanvasTexture);
        expect(isProceduralPosterTexture(face.texture)).toBe(true);
        expect(face.canvas).not.toBeNull();
      }
    }

    expect(networkAttempts).toEqual([]);
    expect(record.putImageDataCalls).toBeGreaterThanOrEqual(
      YEAR_IDS.length * posterSpec('1945').posters.length,
    );
    // Painters wrote real artwork, not a placeholder fill.
    expect(record.images.every((image) => image.data.length > 0)).toBe(true);
    for (const texture of module.resources?.snapshot().textures ?? []) {
      expect(isProceduralPosterTexture(texture)).toBe(true);
    }
    module.dispose();
  });

  it('materialises headless artwork as upright data textures, deterministically', () => {
    const spec = posterSpec('1985');
    const poster = spec.posters[0];
    if (!poster) throw new Error('missing poster fixture');
    const request = toFaceRequest(spec, poster, 256);

    const surface = paintPosterFace(request, { height: 256 });
    const repeated = paintPosterFace(request, { height: 256 });
    expect(repeated.data).toEqual(surface.data);
    expect(surface.distinctColors()).toBeGreaterThan(24);
    expect(surface.coverRatio(surface.sample(2, 2), 18)).toBeGreaterThan(0.05);

    const face = createPosterFaceTexture(request, { height: 256, canvasFactory: () => null });
    expect(face.source).toBe('data');
    expect(face.texture).toBeInstanceOf(THREE.DataTexture);
    expect(face.texture.name.startsWith('poster:face:1985:')).toBe(true);
    expect(isProceduralPosterTexture(face.texture)).toBe(true);
    expect(face.width).toBe(Math.round(256 * request.aspect));
    expect(face.height).toBe(256);

    // The data backend pre-flips its rows so both backends read upright.
    const image = face.texture.image as { data: Uint8ClampedArray; width: number; height: number };
    const stride = image.width * 4;
    expect(Array.from(image.data.slice(0, stride))).toEqual(
      Array.from(surface.data.slice((image.height - 1) * stride, image.height * stride)),
    );
    expect(face.surface.data).toEqual(surface.data);
  });

  it('draws every era with legible contrast, print drift and wear', () => {
    for (const year of YEAR_IDS) {
      const spec = posterSpec(year);
      for (const poster of spec.posters) {
        const request = toFaceRequest(spec, poster, 128);
        const surface = paintPosterFace(request, { height: 128 });
        // Ink against paper still reads at inspect range.
        const ink = surface.sample(Math.round(surface.width / 2), Math.round(surface.height * 0.1));
        expect(contrastRatio(parseColor(poster.palette.ink), parseColor(poster.palette.paper))).toBeGreaterThan(2.5);
        expect(surface.distinctColors()).toBeGreaterThan(20);
        expect(poster.fade + spec.print.fade).toBeGreaterThan(0);
        expect(poster.wear).toBeGreaterThan(0);
        // Colour drift and ageing move the print away from a flat fill.
        expect(surface.channelDrift(ink)).toBeGreaterThan(8);
      }
    }
  });

  it('tears the corner of a heavily worn sheet and leaves a clean one intact', () => {
    const spec = posterSpec('1945');
    const worn = spec.posters.reduce((worst, poster) => (poster.wear > worst.wear ? poster : worst));
    const fresh = { ...worn, id: `${worn.id}-fresh`, wear: 0.05, fade: 0 };
    const wornSurface = paintPosterFace(toFaceRequest(spec, worn, 224), { height: 224 });
    const freshSurface = paintPosterFace(toFaceRequest(spec, fresh, 224), { height: 224 });

    const corners = { tl: [1, 1], tr: [wornSurface.width - 2, 1], bl: [1, wornSurface.height - 2], br: [wornSurface.width - 2, wornSurface.height - 2] } as const;
    const torn = corners[posterTornCorner(toFaceRequest(spec, worn, 224))];
    expect(wornSurface.alphaAt(torn[0], torn[1])).toBe(0);
    expect(freshSurface.alphaAt(corners[posterTornCorner(toFaceRequest(spec, worn, 224))][0], corners[posterTornCorner(toFaceRequest(spec, worn, 224))][1])).toBeGreaterThan(0);
    // Edge ageing grubbies the border of the worn sheet; the fresh one keeps its paper.
    const midRow = Math.round(wornSurface.height / 2);
    const wornEdge = wornSurface.sample(0, midRow);
    const freshEdge = freshSurface.sample(0, midRow);
    expect(wornEdge.r).toBeLessThan(freshEdge.r);
    expect(wornEdge.g).toBeLessThan(freshEdge.g);
  });
});

/* -------------------------------------------------------------------------- */
/* Placement                                                                  */
/* -------------------------------------------------------------------------- */

describe('placement', () => {
  it('mounts every era on the environment shell mounts, inside the room', () => {
    const layout: StructuralLayout = STRUCTURAL_LAYOUT;
    const posterMounts = layout.wallMounts.filter((mount) => mount.purpose === 'poster');
    expect(posterMounts.length).toBeGreaterThan(4);
    expect(menuBoardMount(layout)).toBeDefined();

    for (const year of YEAR_IDS) {
      const spec = posterSpec(year);
      const placements = posterOnWall(spec, layout);
      expect(placements.map((placement) => placement.posterId)).toEqual(spec.posters.map((poster) => poster.id));
      expect(posterPlacementProblems(placements, layout, CAFE_ROOM_BOUNDS)).toEqual([]);

      for (const placement of placements) {
        const mount = layout.wallMounts.find((entry) => entry.id === placement.mountId);
        expect(mount).toBeDefined();
        expect(isMenuBoardMount(mount!)).toBe(false);
        expect(placement.wall).toBe(mount?.wall);

        // Inside the room volume.
        expect(placement.footprint.min.x).toBeGreaterThanOrEqual(-CAFE_ROOM_BOUNDS.width / 2);
        expect(placement.footprint.max.x).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.width / 2);
        expect(placement.footprint.min.z).toBeGreaterThanOrEqual(-CAFE_ROOM_BOUNDS.depth / 2);
        expect(placement.footprint.max.z).toBeLessThanOrEqual(CAFE_ROOM_BOUNDS.depth / 2);
        expect(placement.footprint.min.y).toBeGreaterThan(1);
        expect(placement.footprint.max.y).toBeLessThan(CAFE_ROOM_BOUNDS.height);

        // Clear of the doorway, the storefront glazing and the counter.
        for (const zone of layout.reservedZones) {
          expect(boxesOverlap(placement.footprint, reservedZoneBox(zone))).toBe(false);
        }
        expect(boxesOverlap(placement.footprint, counterBox(layout))).toBe(false);
        const sightline = menuSightlineBox(layout);
        if (sightline) expect(boxesOverlap(placement.footprint, sightline)).toBe(false);
      }

      // Two posters never overlap, and the frames stay on their wall plane.
      for (let index = 0; index < placements.length; index += 1) {
        for (let other = index + 1; other < placements.length; other += 1) {
          const left = placements[index];
          const right = placements[other];
          if (!left || !right) continue;
          expect(boxesOverlap(left.footprint, right.footprint)).toBe(false);
        }
        const placement = placements[index];
        if (!placement) continue;
        const normalAxis = placement.wall === 'back' || placement.wall === 'front' ? 'z' : 'x';
        const poster = spec.posters.find((entry) => entry.id === placement.posterId);
        if (!poster) throw new Error(`missing poster ${placement.posterId}`);
        const rail = FRAME_STYLES[placement.frame].rail;
        const extent = frameExtents(placement.frame, poster.size);
        const plane = normalAxis === 'z' ? CAFE_ROOM_BOUNDS.depth / 2 : CAFE_ROOM_BOUNDS.width / 2;
        expect(Math.abs(Math.abs(placement.position[normalAxis]) - plane)).toBeLessThan(0.05);
        expect(placement.width).toBeCloseTo(extent.width, 5);
        expect(placement.width).toBeCloseTo(poster.size[0] + rail * 2, 5);
        // The placement box covers the whole mounted sheet, frame included.
        const boxed = boxSize(placement.box);
        expect(boxed.y).toBeGreaterThanOrEqual(placement.height - 1e-9);
        expect(boxed.y).toBeLessThan(placement.height + 0.01);
        expect(boxed[normalAxis]).toBeGreaterThan(0);
      }
    }
  });

  it('detects a deliberate clash with the reserved zones, the counter and the menu sightline', () => {
    const layout = STRUCTURAL_LAYOUT;
    const spec = posterSpec('2025');
    const [first] = posterOnWall(spec, layout);
    if (!first) throw new Error('missing placement fixture');

    // Moves a real placement, footprint included, onto a target point.
    const planted = (id: string, target: { x: number; y: number; z: number }): PosterPlacement => {
      const delta = {
        x: target.x - first.position.x,
        y: target.y - first.position.y,
        z: target.z - first.position.z,
      };
      const shift = (box: PosterPlacement['box']): PosterPlacement['box'] => ({
        min: { x: box.min.x + delta.x, y: box.min.y + delta.y, z: box.min.z + delta.z },
        max: { x: box.max.x + delta.x, y: box.max.y + delta.y, z: box.max.z + delta.z },
      });
      return { ...first, posterId: id, position: target, box: shift(first.box), footprint: shift(first.footprint) };
    };

    const doorway = reservedZone(layout, 'back-room-doorway');
    expect(doorway).toBeDefined();
    if (doorway) {
      const blocked = planted('planted-in-the-doorway', {
        x: doorway.position.x,
        y: doorway.position.y,
        z: doorway.position.z,
      });
      expect(posterPlacementProblems([blocked], layout, CAFE_ROOM_BOUNDS).join(' ')).toMatch(/doorway/);
    }

    const sightline = menuSightlineBox(layout);
    if (sightline) {
      const blocking = planted('planted-in-the-sightline', {
          x: (sightline.min.x + sightline.max.x) / 2,
          y: (sightline.min.y + sightline.max.y) / 2,
          z: (sightline.min.z + sightline.max.z) / 2,
      });
      expect(posterPlacementProblems([blocking], layout, CAFE_ROOM_BOUNDS).join(' ')).toMatch(/sightline/);
    }

    const counter = counterBox(layout);
    const overCounter = planted('planted-over-the-counter', {
      x: (counter.min.x + counter.max.x) / 2,
      y: (counter.min.y + counter.max.y) / 2,
      z: (counter.min.z + counter.max.z) / 2,
    });
    expect(posterPlacementProblems([overCounter], layout, CAFE_ROOM_BOUNDS).join(' ')).toMatch(
      /counter|dado/,
    );
  });

  it('uses the environment shell mounts when it is handed the real module', () => {
    const kernel = createKernel(null, { forceHeadless: true, bounds: CAFE_ROOM_BOUNDS, autoResize: false });
    openKernels.push(kernel);
    const environment = createEnvironmentModule();
    const context = kernel.createBuildContext(periodFor('1965'), { services: { environmentModule: environment } });
    environment.build(context);
    const module = createPosterModule();
    module.build(context);
    expect(module.layout).toBe(environment.layout);
    expect(module.bounds).toBe(environment.bounds);
    const mountIds = new Set(wallMountsOf(environment.layout, 'back', 'poster').map((mount) => mount.id));
    expect(module.placements.some((placement) => mountIds.has(placement.mountId))).toBe(true);
    module.dispose();
    environment.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* SceneModule behaviour                                                      */
/* -------------------------------------------------------------------------- */

describe('SceneModule behaviour', () => {
  it('builds, applies all five eras, animates and disposes without leaking', () => {
    const { kernel, module } = setup({ seed: 0x5eed });
    expect(isSceneModule(module)).toBe(true);
    expect(module.id).toBe(POSTER_MODULE_ID);
    expect(module.posterCount).toBe(posterSpec('1945').posters.length);
    expect(kernel.world.children).toContain(module.root);
    expect(countNodes(module.root!)).toBeGreaterThan(module.posterCount);
    expect(module.describe().placementProblems).toEqual([]);

    const nodesPerPoster = countNodes(module.root!) / module.posterCount;
    expect(nodesPerPoster).toBeGreaterThan(6);

    const baselineCounts = module.resources?.counts;
    expect(baselineCounts?.geometries ?? 0).toBeGreaterThan(module.posterCount);
    expect(baselineCounts?.materials ?? 0).toBeGreaterThan(0);
    expect(baselineCounts?.textures ?? 0).toBeGreaterThanOrEqual(module.posterCount);

    const second = createPosterModule({ seed: 0x5eed });
    const secondContext = kernel.createBuildContext(periodFor('1945'));
    second.build(secondContext);
    second.update(0.25, { year: '1945', elapsedSeconds: 0.25, frame: 1 });

    for (const year of YEAR_IDS) {
      applyYear(module, kernel, year);
      expect(module.spec?.year).toBe(year);
      expect(module.posterCount).toBe(posterSpec(year).posters.length);
      expect(module.describe().built).toBe(true);
      expect(module.describe().placementProblems).toEqual([]);
      expect(module.describe().textureSource).not.toBe('none');
      expect(module.proceduralOnly).toBe(true);

      const hotspots = module.getHotspots();
      expect(hotspots).toHaveLength(module.posterCount);
      for (const hotspot of hotspots) {
        expect(hotspot.year).toBe(year);
        expect(hotspot.moduleId).toBe(POSTER_MODULE_ID);
        expect(hotspot.label.length).toBeGreaterThan(3);
        expect(hotspot.description && hotspot.description.length).toBeGreaterThan(10);
        expect(hotspot.anchor).toBeInstanceOf(THREE.Object3D);
        expect(Number.isFinite(hotspot.position.x)).toBe(true);
        expect(hotspot.position.y).toBeGreaterThan(1);
        expect(hotspot.position.y).toBeLessThan(CAFE_ROOM_BOUNDS.height);
      }

      const states = module.posterStates;
      expect(states).toHaveLength(module.posterCount);
      // The era's small life: taped sheets sway, neon frames flicker.
      module.update(0.5, { year, elapsedSeconds: 0.5, frame: 2 });
      const moved = module.posterStates;
      expect(moved.map((state) => state.sway)).not.toEqual(states.map((state) => state.sway));
    }
    expect(module.updateCount).toBeGreaterThan(YEAR_IDS.length);

    // Determinism: the same seed produces the same wall and the same motion.
    applyYear(second, kernel, '2025');
    applyYear(module, kernel, '2025');
    expect(module.posterStates.map((state) => state.sway.toFixed(8))).toEqual(
      second.posterStates.map((state) => state.sway.toFixed(8)),
    );
    expect(module.placements.map((placement) => `${placement.posterId}:${placement.mountId}`)).toEqual(
      second.placements.map((placement) => `${placement.posterId}:${placement.mountId}`),
    );
    second.dispose();

    // Dispose releases every resource it created, and is safe to repeat.
    const resources = module.resources;
    expect(resources).toBeDefined();
    const tracker = trackDisposal(resources!);
    expect(tracker.total).toBeGreaterThan(0);
    module.dispose();
    expect(tracker.disposed()).toBe(tracker.total);
    expect((module.disposition?.geometries ?? 0) + (module.disposition?.materials ?? 0) + (module.disposition?.textures ?? 0)).toBe(tracker.total);
    expect(module.disposition?.posters).toBeGreaterThan(0);
    expect(module.getHotspots()).toEqual([]);
    expect(module.root).toBeUndefined();
    expect(module.posterStates).toEqual([]);
    expect(module.describe().built).toBe(false);
    module.update(1, { year: '2025', elapsedSeconds: 1, frame: 9 });
    expect(module.posterStates).toEqual([]);
    module.dispose();
  });

  it('keeps the live resource sets flat while the timeline moves back and forth', () => {
    const { kernel, module } = setup({ seed: 0x21 });
    const reference = new Map<YearId, PosterResourceCounts>();
    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (const year of cycle % 2 === 0 ? YEAR_IDS : [...YEAR_IDS].reverse()) {
        applyYear(module, kernel, year);
        const counts = module.resources?.counts;
        expect(counts?.textures ?? 0).toBeGreaterThan(0);
        const baseline = reference.get(year);
        if (baseline) {
          expect(counts).toEqual(baseline);
        } else {
          expect(counts).toBeDefined();
          reference.set(year, counts as PosterResourceCounts);
        }
        expect(module.disposition).not.toBeNull();
        expect((module.disposition?.geometries ?? 0) > 0).toBe(true);
      }
    }
    expect(reference.size).toBe(YEAR_IDS.length);
    expect(kernel.world.children.filter((child) => child === module.root)).toHaveLength(1);
    module.dispose();
    expect(kernel.world.children).toHaveLength(0);
  });

  it('mounts era-correct frames, hardware, glazing and wall wear', () => {
    const { kernel, module } = setup({ seed: 0x1985 });
    for (const year of YEAR_IDS) {
      applyYear(module, kernel, year);
      const spec = posterSpec(year);
      const names = module.assemblies.flatMap((assembly) => meshNames(assembly.group));
      const mountsUsed = new Set(module.placements.map((placement) => placement.mount));
      expect([...mountsUsed].sort()).toEqual(['framed', 'pinned', 'taped', 'unframed']);

      for (const placement of module.placements) {
        expect(names.some((name) => name.startsWith('poster-face'))).toBe(true);
        expect(names.some((name) => name.startsWith('wall-wear-'))).toBe(true);
        if (placement.mount === 'framed') {
          expect(names).toContain('frame-rail-top');
          expect(names.some((name) => name === 'hardware-nail' || name === 'hardware-wire')).toBe(true);
        }
        if (placement.mount === 'pinned') {
          expect(names.some((name) => name === 'hardware-steel-pin' || name === 'hardware-brass-pin')).toBe(true);
        }
        if (placement.mount === 'taped') {
          expect(names).toContain('hardware-tape-aged');
        }
        if (placement.mount === 'unframed') {
          expect(names).toContain('hardware-putty-dab');
        }
      }

      const frameStyles = new Set(module.placements.map((placement) => placement.frame));
      for (const style of frameStyles) {
        expect(FRAME_STYLES[style]).toBeDefined();
      }
      if (year === '1985') {
        expect(names).toContain('frame-neon-tube-vertical');
        expect(names).toContain('frame-glass');
        expect(module.assemblies.some((assembly) => assembly.litMaterials.length > 0)).toBe(true);
      }
      if (year === '1965') {
        expect(names).toContain('frame-glass');
      }
      if (year === '2025') {
        expect(names).toContain('frame-backing-board');
        expect(names).toContain('frame-mat-left');
      }
      expect(spec.styles.every((style: FrameStyleId) => FRAME_STYLES[style])).toBe(true);
    }
    module.dispose();
  });

  it('exposes close-up inspect framing for every mounted poster', () => {
    const { kernel, module } = setup({ seed: 0x77 });
    applyYear(module, kernel, '1965');
    for (const placement of module.placements) {
      const focus = module.posterFocus(placement.posterId);
      expect(focus).not.toBeNull();
      if (!focus) continue;
      expect(focus.year).toBe('1965');
      expect(focus.distance).toBeGreaterThanOrEqual(0.5);
      expect(focus.distance).toBeLessThanOrEqual(1.25);
      expect(Math.hypot(focus.direction.x, focus.direction.y, focus.direction.z)).toBeCloseTo(1, 5);
      const offset = {
        x: focus.eye.x - focus.target.x,
        y: focus.eye.y - focus.target.y,
        z: focus.eye.z - focus.target.z,
      };
      expect(Math.hypot(offset.x, offset.y, offset.z)).toBeCloseTo(focus.distance, 5);
      expect(focus.radius).toBeGreaterThan(0.2);
    }
    expect(module.posterFocus('not-on-the-wall')).toBeNull();
    module.dispose();
  });
});
