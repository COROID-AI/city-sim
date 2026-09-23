/**
 * Chrono City — era-evolving perimeter buildings test suite.
 *
 * Proves the four acceptance claims of the buildings task against the real
 * upstream modules, not against doubles:
 *
 *  1. the ring of lots tiles the block perimeter, and every ornament sits above
 *     the `0–4 m` storefront band, which offers a mount surface instead;
 *  2. all five eras build a distinct, era-authentic set (walk-up fire escapes and
 *     water towers, 1965 fins and neon, 1985 concrete grids and mirrored bands,
 *     2005 curtain wall, 2025 media facade and green terraces);
 *  3. a year change morphs the block through the `TimelineRuntime` tween driven
 *     only by `SceneContext.tick()`: progress is gradual, the envelope moves
 *     monotonically, and no frame leaves a lot empty, see-through or unwalled;
 *  4. landmark buildings resolve per-year copy through the `InspectionRegistry`,
 *     and the whole system detaches cleanly on `dispose()`.
 *
 * jsdom plus the `canvas` package back the procedural material library, and a
 * stub renderer stands in for WebGL, so the suite runs headless.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { ERA_IDS, type EraId } from '../../src/core/eraContracts';
import { SceneContext, type SceneContextOptions } from '../../src/core/sceneContext';
import { TimelineRuntime } from '../../src/era/timelineRuntime';
import {
  createInspectionRegistry,
  type InspectionRegistry,
} from '../../src/interaction/inspectionRegistry';
import {
  createMaterialLibraryFromScene,
  type MaterialLibrary,
} from '../../src/materials/materialLibrary';
import {
  DETAIL_BASE_Y,
  LOT_LAYOUT,
  MAX_UNIQUE_MATERIALS_PER_ERA,
  STOREFRONT_BAND_HEIGHT,
  UNIT_GEOMETRY_KINDS,
  getEraRecipes,
  lotById,
  sideFrontage,
  streetWallBlock,
} from '../../src/city/buildings/buildingFactory';
import {
  BUILDINGS_BLENDABLE_ID,
  BUILDINGS_SYSTEM_ID,
  BuildingsApi,
  createBuildingsApi,
  landmarkInspectableId,
  sourceEraWeight,
  targetEraWeight,
} from '../../src/city/buildings/buildingsApi';

/* ------------------------------------------------------------------------- *
 * Harness
 * ------------------------------------------------------------------------- */

function createStubRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const stub = {
    domElement: canvas,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    setPixelRatio: () => {},
    setSize: () => {},
    render: () => {},
    setAnimationLoop: () => {},
    dispose: () => {},
  };
  return stub as unknown as THREE.WebGLRenderer;
}

const contexts: SceneContext[] = [];
const disposables: Array<{ dispose(): void }> = [];

function createContext(options: SceneContextOptions = {}): SceneContext {
  const context = new SceneContext({
    autoResize: false,
    shadows: false,
    createRenderer: createStubRenderer,
    ...options,
  });
  contexts.push(context);
  return context;
}

interface Fixture {
  readonly context: SceneContext;
  readonly timeline: TimelineRuntime;
  readonly registry: InspectionRegistry;
  readonly library: MaterialLibrary;
  readonly api: BuildingsApi;
}

function createFixture(initialEra: EraId = '1945'): Fixture {
  const context = createContext();
  const registry = createInspectionRegistry();
  const library = createMaterialLibraryFromScene(context);
  const timeline = new TimelineRuntime({ context, initialEra });
  const api = createBuildingsApi({ context, timeline, registry, materials: library });
  disposables.push(api, timeline, { dispose: () => registry.clear() });
  return { context, timeline, registry, library, api };
}

/** Ticks the shared render loop until the timeline settles (or the frame cap). */
function settle(context: SceneContext, timeline: TimelineRuntime, maxFrames = 120): number {
  let frames = 0;
  while (timeline.isTransitioning && frames < maxFrames) {
    context.tick(0.1);
    frames += 1;
  }
  return frames;
}

const cornerProbe = new THREE.Vector3();
const instanceMatrix = new THREE.Matrix4();

/** Lowest world-space `y` of one instance, corners included so pitch is exact. */
function instanceLowestY(mesh: THREE.InstancedMesh, index: number): number {
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  mesh.getMatrixAt(index, instanceMatrix);
  instanceMatrix.premultiply(mesh.matrixWorld);
  let lowest = Number.POSITIVE_INFINITY;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        cornerProbe.set(x, y, z).applyMatrix4(instanceMatrix);
        lowest = Math.min(lowest, cornerProbe.y);
      }
    }
  }
  return lowest;
}

interface RoleScan {
  readonly lowestY: Record<string, number>;
  readonly instances: Record<string, number>;
}

/** Lowest instance and instance count per building role across every variant. */
function scanRoles(api: BuildingsApi): RoleScan {
  api.root.updateMatrixWorld(true);
  const lowestY: Record<string, number> = {};
  const instances: Record<string, number> = {};
  for (const variant of api.listVariants()) {
    for (const mesh of variant.meshes) {
      const instanced = mesh as THREE.InstancedMesh;
      if (!instanced.isInstancedMesh) continue;
      const role = String(mesh.userData.chronoBuildingRole ?? 'unknown');
      instances[role] = (instances[role] ?? 0) + instanced.count;
      for (let index = 0; index < instanced.count; index += 1) {
        lowestY[role] = Math.min(lowestY[role] ?? Number.POSITIVE_INFINITY, instanceLowestY(instanced, index));
      }
    }
  }
  return { lowestY, instances };
}

afterEach(() => {
  for (const disposable of disposables.splice(0)) disposable.dispose();
  for (const context of contexts.splice(0)) context.dispose();
});

/* ------------------------------------------------------------------------- *
 * 1. Perimeter ring and the storefront band
 * ------------------------------------------------------------------------- */

describe('block perimeter ring', () => {
  it('tiles all four sides continuously with unique lots', () => {
    expect(LOT_LAYOUT).toHaveLength(18);
    expect(new Set(LOT_LAYOUT.map((lot) => lot.id)).size).toBe(18);

    for (const side of ['north', 'south', 'east', 'west'] as const) {
      const lots = LOT_LAYOUT.filter((lot) => lot.side === side);
      const frontage = lots.reduce((total, lot) => total + lot.frontWidth, 0);
      expect(frontage).toBeCloseTo(sideFrontage(side), 6);
      expect(lots.every((lot) => lot.frontWidth >= 8)).toBe(true);
    }

    // Every street frontage sits on the block edge — no lot floats or overlaps.
    for (const lot of LOT_LAYOUT) {
      if (lot.side === 'south' || lot.side === 'north') {
        expect(Math.abs(lot.frontCenter.z)).toBeCloseTo(25, 6);
        expect(Math.abs(lot.frontCenter.x)).toBeLessThanOrEqual(26 + 1e-6);
      } else {
        expect(Math.abs(lot.frontCenter.x)).toBeCloseTo(40, 6);
        expect(Math.abs(lot.frontCenter.z)).toBeLessThanOrEqual(25 + 1e-6);
      }
    }

    expect(LOT_LAYOUT.filter((lot) => lot.landmark)).toHaveLength(6);
  });

  it('offers a 0–4 m mount surface per lot and keeps every ornament above it', () => {
    const { api } = createFixture('1945');
    api.applyEra('1945');

    const surfaces = api.mountSurfaceList();
    expect(surfaces).toHaveLength(LOT_LAYOUT.length);
    for (const surface of surfaces) {
      expect(surface.height).toBe(STOREFRONT_BAND_HEIGHT);
      expect(surface.position.y).toBeCloseTo(STOREFRONT_BAND_HEIGHT / 2, 6);
      const lot = lotById(surface.lotId)!;
      expect(surface.position.x).toBeCloseTo(lot.frontCenter.x, 6);
      expect(surface.position.z).toBeCloseTo(lot.frontCenter.z, 6);
      // The normal faces the street on every side of the block.
      expect(surface.normal.x).toBeCloseTo(Math.sin(lot.yaw), 6);
      expect(surface.normal.z).toBeCloseTo(Math.cos(lot.yaw), 6);
    }
    expect(new Set(surfaces.map((surface) => surface.id)).size).toBe(surfaces.length);

    const scan = scanRoles(api);
    // The band panel is the only geometry this task places inside the 0–4 m band.
    expect(scan.lowestY['mount-surface']).toBeCloseTo(0, 3);
    expect(scan.instances['mount-surface']).toBe(LOT_LAYOUT.length);
    // Each panel spans its lot's whole frontage — not a projecting bay.
    for (const variant of api.listVariants()) {
      expect(variant.mountSurface.width).toBeCloseTo(variant.plan.lot.frontWidth, 6);
      expect(variant.mountSurface.height).toBe(STOREFRONT_BAND_HEIGHT);
      expect(variant.mountSurface.baseY).toBe(0);
    }

    // Facade ornament and roof clutter are strictly above the band...
    expect(scan.lowestY['facade-detail']).toBeGreaterThanOrEqual(DETAIL_BASE_Y - 1e-6);
    expect(scan.lowestY['rooftop']).toBeGreaterThanOrEqual(STOREFRONT_BAND_HEIGHT - 1e-6);
    // ...while the wall shopfronts mount to starts at grade.
    expect(scan.lowestY['mass']).toBeCloseTo(0, 3);
    expect(scan.instances['facade-detail']).toBeGreaterThan(1000);
    expect(scan.instances['rooftop']).toBeGreaterThan(300);
  });
});

/* ------------------------------------------------------------------------- *
 * 2. Era-authentic sets
 * ------------------------------------------------------------------------- */

describe('era building sets', () => {
  it('builds a distinct, era-authentic set for each of the five years', () => {
    const { api } = createFixture();
    const summaries = new Map<EraId, ReturnType<BuildingsApi['featuresFor']>>();
    const massingByEra = new Map<EraId, Set<string>>();

    for (const era of ERA_IDS) {
      api.applyEra(era);
      const summary = api.featuresFor(era);
      summaries.set(era, summary);

      // Every year: framed windows, a cornice line, roof decks and clutter.
      expect(summary.lots).toBe(LOT_LAYOUT.length);
      expect(summary.facade.windows).toBeGreaterThan(50);
      expect(summary.facade.cornices).toBeGreaterThan(0);
      expect(summary.roof.roofDecks).toBeGreaterThanOrEqual(LOT_LAYOUT.length);
      expect(summary.roof.clutter).toBeGreaterThan(0);

      const massings = new Set(api.snapshot().lots.map((lot) => lot.massing));
      massingByEra.set(era, massings);
      expect(massings.size).toBe(getEraRecipes(era).length);
      expect(massings.size).toBe(era === '1985' ? 2 : 1);
    }

    // 1945 — brick/stone walk-ups with fire escapes, sills, lintels and tanks.
    const y1945 = summaries.get('1945')!;
    expect(y1945.facade.fireEscapeStacks).toBeGreaterThan(0);
    expect(y1945.facade.fireEscapeParts).toBeGreaterThan(30);
    expect(y1945.facade.sills).toBeGreaterThan(0);
    expect(y1945.facade.lintels).toBeGreaterThan(0);
    expect(y1945.facade.pilasters).toBeGreaterThan(0);
    expect(y1945.roof.waterTowers).toBeGreaterThan(0);
    expect(y1945.roof.chimneys).toBeGreaterThan(0);
    expect(y1945.roof.pigeonCoops).toBeGreaterThan(0);
    expect(y1945.roof.solarPanels).toBe(0);
    expect(y1945.facade.mediaPanels).toBe(0);
    expect(summaries.get('2005')!.roof.waterTowers).toBe(0);
    expect(summaries.get('2025')!.roof.waterTowers).toBe(0);

    // 1965 — mid-century ribbon glazing, fins, spandrels and neon.
    const y1965 = summaries.get('1965')!;
    expect(y1965.facade.briseSoleilFins).toBeGreaterThan(0);
    expect(y1965.facade.spandrels).toBeGreaterThan(0);
    expect(y1965.facade.mullions).toBeGreaterThan(0);
    expect(y1965.facade.neonStrips).toBeGreaterThan(0);
    expect(y1965.roof.neonRoofSigns).toBeGreaterThan(0);
    expect(y1965.roof.antennaMasts).toBeGreaterThan(0);
    expect(y1965.roof.acUnits).toBeGreaterThan(0);
    expect(y1965.facade.fireEscapeStacks).toBe(0);

    // 1985 — brutalist concrete grids plus mirrored bands, dishes and plant.
    const y1985 = summaries.get('1985')!;
    expect(massingByEra.get('1985')).toEqual(new Set(['brutalist', 'mirrorTower']));
    expect(y1985.facade.concreteGrids).toBeGreaterThan(0);
    expect(y1985.facade.mirrorBands).toBeGreaterThan(0);
    expect(y1985.roof.satelliteDishes).toBeGreaterThan(0);
    expect(y1985.roof.mechanicalFloors).toBeGreaterThan(0);

    // 2005 — sleek glass offices: curtain wall, spandrels, plant deck and masts.
    const y2005 = summaries.get('2005')!;
    expect(y2005.facade.mullions).toBeGreaterThan(0);
    expect(y2005.facade.spandrels).toBeGreaterThan(0);
    expect(y2005.facade.sills).toBe(0); // flush modern frames
    expect(y2005.facade.mirrorBands).toBe(0);
    expect(y2005.roof.antennaMasts).toBeGreaterThan(0);
    expect(y2005.roof.acUnits).toBeGreaterThan(0);

    // 2025 — parametric green towers, planted terraces and a media facade.
    const y2025 = summaries.get('2025')!;
    expect(y2025.facade.mediaPanels).toBeGreaterThan(0);
    expect(y2025.facade.planterBands).toBeGreaterThan(0);
    expect(y2025.facade.facadeTrees).toBeGreaterThan(0);
    expect(y2025.roof.solarPanels).toBeGreaterThan(0);
    expect(y2025.roof.windTurbines).toBeGreaterThan(0);
    expect(y2025.roof.mediaCrowns).toBeGreaterThan(0);
    expect(y2025.roof.planters).toBeGreaterThan(0);
    expect(y2025.roof.roofTrees).toBeGreaterThan(0);

    // Five years, five different skylines.
    const means = ERA_IDS.map((era) => summaries.get(era)!.heights.mean.toFixed(2));
    expect(new Set(means).size).toBe(ERA_IDS.length);
    expect(summaries.get('1945')!.heights.mean).toBeLessThan(summaries.get('1985')!.heights.mean);
    expect(summaries.get('1945')!.heights.mean).toBeLessThan(summaries.get('2025')!.heights.mean);
    expect(summaries.get('1945')!.heights.max).toBeLessThan(summaries.get('2025')!.heights.max);
  });

  it('caps unique materials per era and reuses a handful of instanced shapes', () => {
    const { api } = createFixture();
    const allKeys = new Set<string>();
    let detailInstances = 0;

    for (const era of ERA_IDS) {
      api.applyEra(era);
      const keys = api.materialKeysFor(era);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.length).toBeLessThanOrEqual(MAX_UNIQUE_MATERIALS_PER_ERA);
      for (const key of keys) allKeys.add(key);
      detailInstances += api.featuresFor(era).detailInstances;
    }

    // 18 lots x 5 eras of ornament stay inside a tiny GPU budget.
    const snapshot = api.snapshot();
    expect(snapshot.detailGeometryCount).toBeLessThanOrEqual(UNIT_GEOMETRY_KINDS.length);
    expect(snapshot.materialCount).toBeLessThanOrEqual(40);
    expect(allKeys.size).toBe(snapshot.materialCount);
    // ~135 ornament instances per building per era, all instanced.
    expect(detailInstances).toBeGreaterThan(10000);
    expect(detailInstances / (LOT_LAYOUT.length * ERA_IDS.length)).toBeGreaterThan(100);
  });
});

/* ------------------------------------------------------------------------- *
 * 3. Morph through the timeline
 * ------------------------------------------------------------------------- */

describe('era morphing', () => {
  it('settles into the timeline era on registration', () => {
    const { api, timeline, context } = createFixture('1945');
    const snapshot = api.snapshot();

    expect(timeline.era).toBe('1945');
    expect(snapshot.era).toBe('1945');
    expect(snapshot.from).toBe('1945');
    expect(snapshot.progress).toBe(1);
    expect(snapshot.transitioning).toBe(false);
    expect(snapshot.builtVariants).toBe(LOT_LAYOUT.length);
    expect(snapshot.visibleVariants).toBe(LOT_LAYOUT.length);
    expect(snapshot.minWeightSum).toBeCloseTo(1, 10);
    expect(timeline.hasBlendable(BUILDINGS_BLENDABLE_ID)).toBe(true);
    expect(api.blendableId).toBe(BUILDINGS_BLENDABLE_ID);
    expect(context.hasSystem(BUILDINGS_SYSTEM_ID)).toBe(true);
  });

  it('morphs progressively across SceneContext ticks with no gap or hard cut', () => {
    const { api, context, timeline } = createFixture('1945');
    expect(api.snapshot().era).toBe('1945');

    const startHeights = api.snapshot().lots.map((lot) => lot.envelopeHeight);
    timeline.selectEra('1985');

    interface Sample {
      readonly progress: number;
      readonly heights: readonly number[];
      readonly weightSums: readonly number[];
      readonly visibleCounts: readonly number[];
      readonly doubleEraLots: number;
      /** Tallest street wall still covering the band on each visible variant. */
      readonly bandCoverage: number;
    }
    const samples: Sample[] = [];

    let frames = 0;
    while (timeline.isTransitioning && frames < 120) {
      context.tick(0.1);
      frames += 1;
      const snapshot = api.snapshot();
      samples.push({
        progress: snapshot.progress,
        heights: snapshot.lots.map((lot) => lot.envelopeHeight),
        weightSums: snapshot.lots.map((lot) => lot.weightSum),
        visibleCounts: snapshot.lots.map((lot) => lot.visibleVariantCount),
        doubleEraLots: snapshot.lots.filter((lot) => lot.activeEras.length === 2).length,
        bandCoverage: Math.min(
          ...snapshot.lots.map((lot) =>
            Math.max(
              ...lot.variants
                .filter((variant) => variant.visible)
                .map((variant) => {
                  const handle = api.variant(lot.id, variant.era)!;
                  return streetWallBlock(handle.plan).height * variant.scaleY;
                }),
            ),
          ),
        ),
      });
    }

    // The tween is a real progression, not a cut.
    expect(timeline.isTransitioning).toBe(false);
    expect(frames).toBeGreaterThanOrEqual(8);
    expect(samples).toHaveLength(frames);
    const progresses = samples.map((sample) => sample.progress);
    expect(progresses.filter((value) => value > 0 && value < 1).length).toBeGreaterThanOrEqual(5);
    expect(progresses).toEqual([...progresses].sort((a, b) => a - b));
    expect(samples.at(-1)!.progress).toBe(1);

    // No frame leaves a lot empty, see-through or without a walled band.
    for (const sample of samples) {
      expect(Math.min(...sample.visibleCounts)).toBeGreaterThanOrEqual(1);
      expect(Math.min(...sample.weightSums)).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(sample.bandCoverage).toBeGreaterThanOrEqual(STOREFRONT_BAND_HEIGHT);
      for (const height of sample.heights) {
        expect(height).toBeGreaterThan(STOREFRONT_BAND_HEIGHT + 5);
      }
    }

    // Both eras share the screen mid-morph: a crossfade, not a swap.
    const mid = samples.filter((sample) => sample.progress > 0.3 && sample.progress < 0.7);
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.every((sample) => sample.doubleEraLots === LOT_LAYOUT.length)).toBe(true);

    // Heights move smoothly, monotonically, in the direction of the new era.
    const endHeights = samples.at(-1)!.heights;
    for (let lotIndex = 0; lotIndex < endHeights.length; lotIndex += 1) {
      const start = startHeights[lotIndex]!;
      const end = endHeights[lotIndex]!;
      expect(Math.abs(end - start)).toBeGreaterThan(0.5);
      const rising = end > start;
      for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1]!.heights[lotIndex]!;
        const current = samples[index]!.heights[lotIndex]!;
        expect(current - previous).toBeLessThan(20);
        if (rising) expect(current).toBeGreaterThanOrEqual(previous - 1e-9);
        else expect(current).toBeLessThanOrEqual(previous + 1e-9);
      }
    }

    // The morph lands exactly on the target era's plans, nothing left blended.
    const settled = api.snapshot();
    expect(settled.era).toBe('1985');
    expect(settled.from).toBe('1985');
    expect(settled.transitioning).toBe(false);
    expect(settled.minWeightSum).toBeCloseTo(1, 10);
    for (const lot of settled.lots) {
      const handle = api.variant(lot.id, '1985')!;
      // The envelope lands exactly on the era's silhouette, turrets included.
      expect(lot.envelopeHeight).toBeCloseTo(handle.plan.skyline, 6);
      expect(handle.plan.skyline).toBeGreaterThanOrEqual(handle.plan.height);
      expect(lot.visibleVariantCount).toBe(1);
      expect(lot.activeEras).toEqual(['1985']);
      expect(handle.scaleY).toBeCloseTo(1, 6);
    }
    expect(timeline.settledEra).toBe('1985');
  });

  it('tours all five years through the context loop, one distinct skyline per year', () => {
    const { api, context, timeline } = createFixture('2005');
    const skylines: number[] = [];
    const meanHeights: number[] = [];

    for (const era of ERA_IDS) {
      timeline.selectEra(era);
      const frames = settle(context, timeline);
      expect(frames).toBeGreaterThan(0);
      expect(timeline.settledEra).toBe(era);

      const snapshot = api.snapshot();
      expect(snapshot.era).toBe(era);
      expect(snapshot.transitioning).toBe(false);
      expect(snapshot.lots.every((lot) => lot.visibleVariantCount === 1)).toBe(true);
      expect(snapshot.lots.every((lot) => lot.weightSum >= 1 - 1e-9)).toBe(true);
      expect(snapshot.minEnvelopeHeight).toBeGreaterThan(STOREFRONT_BAND_HEIGHT + 5);

      // The settled variant sits at its authored size, fully opaque.
      for (const variant of api.listVariants()) {
        if (variant.era !== era || !variant.group.visible) continue;
        expect(variant.scaleY).toBeCloseTo(1, 6);
        expect(variant.scaleZ).toBeCloseTo(1, 6);
        expect(variant.materials.get('facade').opacity).toBeCloseTo(1, 6);
      }

      skylines.push(snapshot.skylineHeight);
      meanHeights.push(
        snapshot.lots.reduce((total, lot) => total + lot.envelopeHeight, 0) / snapshot.lots.length,
      );
    }

    expect(new Set(meanHeights.map((value) => value.toFixed(2))).size).toBe(ERA_IDS.length);
    expect(new Set(skylines.map((value) => value.toFixed(2))).size).toBe(ERA_IDS.length);
    // Every year was built; only the current one is visible.
    expect(api.listVariants()).toHaveLength(LOT_LAYOUT.length * ERA_IDS.length);
    expect(api.snapshot().visibleVariants).toBe(LOT_LAYOUT.length);
    expect(api.snapshot().tickCount).toBeGreaterThan(0);
  });

  it('keeps the crossfade weights overlapping so the block is never see-through', () => {
    for (let step = 0; step <= 20; step += 1) {
      const progress = step / 20;
      expect(sourceEraWeight(progress) + targetEraWeight(progress)).toBeGreaterThanOrEqual(1 - 1e-9);
    }
    expect(sourceEraWeight(0)).toBe(1);
    expect(targetEraWeight(0)).toBe(0);
    expect(sourceEraWeight(1)).toBe(0);
    expect(targetEraWeight(1)).toBe(1);
    expect(targetEraWeight(0.3)).toBeGreaterThan(0);
    expect(sourceEraWeight(0.6)).toBeGreaterThan(0);
  });

  it('drives the emissive accents from SceneContext ticks', () => {
    const { api, context } = createFixture('2025');
    api.applyEra('2025');
    for (let step = 0; step < 12; step += 1) context.tick(0.1);

    const snapshot = api.snapshot();
    expect(snapshot.tickCount).toBeGreaterThan(0);
    expect(snapshot.mediaPulse).toBeGreaterThan(0);
    expect(snapshot.mediaPulse).toBeLessThanOrEqual(1);

    const accent = api.variant('south-2', '2025')!.materials.get('accent');
    const pulsed = accent.emissiveIntensity;
    context.tick(0.37);
    expect(Math.abs(accent.emissiveIntensity - pulsed)).toBeGreaterThan(1e-9);
    expect(api.isAnimated).toBe(true);
    expect(context.hasSystem(BUILDINGS_SYSTEM_ID)).toBe(true);
  });
});

/* ------------------------------------------------------------------------- *
 * 4. Landmarks and inspection
 * ------------------------------------------------------------------------- */

describe('landmark inspection', () => {
  it('registers landmarks with per-year names and resolves them through the scene tree', () => {
    const { api, registry, context, timeline } = createFixture('1945');

    const landmarks = LOT_LAYOUT.filter((lot) => lot.landmark);
    expect(api.inspectables()).toHaveLength(landmarks.length);
    expect(api.landmarkIds).toEqual(landmarks.map((lot) => lot.id));

    for (const lot of landmarks) {
      const id = landmarkInspectableId(lot.id);
      expect(registry.has(id)).toBe(true);
      const record = registry.require(id);
      // Registered on the stable lot group, so picking survives era morphs.
      expect(record.object).toBe(api.lotObject(lot.id));
      expect(record.object.name).toContain(lot.id);
      expect(record.data.system).toBe('city-buildings');
      expect(record.data.landmark).toBe(true);

      const names = ERA_IDS.map((era) => registry.resolve(id, era)!.name);
      expect(names.every((name) => name.length > 3)).toBe(true);
      expect(new Set(names).size).toBe(ERA_IDS.length);
      for (const era of ERA_IDS) {
        const resolved = registry.resolve(id, era)!;
        expect(resolved.hasEraCopy).toBe(true);
        expect(resolved.source).toBe('era');
        expect(resolved.blurb.length).toBeGreaterThan(20);
      }
    }

    // Known per-year identities, so the copy cannot silently drift.
    expect(registry.resolve(landmarkInspectableId('south-2'), '1945')!.name).toBe(
      'Hartley & Sons Dry Goods',
    );
    expect(registry.resolve(landmarkInspectableId('south-2'), '2025')!.name).toBe(
      'Meridian Exchange',
    );
    expect(registry.resolve(landmarkInspectableId('east-2'), '1985')!.name).toBe(
      'Fenwick Data Centre',
    );

    // A hit on any child mesh resolves up to the landmark — what picking does.
    const variant = api.variant('south-2', '1945')!;
    const childMesh = variant.meshes.find(
      (mesh) => mesh.userData.chronoBuildingRole === 'mass',
    )!;
    api.root.updateMatrixWorld(true);
    const hit = registry.resolveObject(childMesh, '1945')!;
    expect(hit.objectId).toBe(landmarkInspectableId('south-2'));
    expect(hit.name).toBe('Hartley & Sons Dry Goods');

    // The card follows the year: morph to 2025, then re-resolve the same mesh.
    timeline.selectEra('2025');
    settle(context, timeline);
    expect(api.era).toBe('2025');
    expect(registry.resolveObject(childMesh, api.era)!.name).toBe('Meridian Exchange');
  });

  it('detaches from every upstream system and releases its geometry on dispose', () => {
    const { api, context, timeline, registry, library } = createFixture('1965');
    api.applyEra('1965');
    const shared = library.materialKeys();
    expect(shared.length).toBeGreaterThan(0);
    const facadeMaterial = api.variant('south-2', '1965')!.materials.get('facade');
    expect(facadeMaterial.opacity).toBeCloseTo(1, 6);

    api.dispose();

    expect(api.isDisposed).toBe(true);
    expect(registry.size).toBe(0);
    expect(timeline.hasBlendable(BUILDINGS_BLENDABLE_ID)).toBe(false);
    expect(context.hasSystem(BUILDINGS_SYSTEM_ID)).toBe(false);
    expect(api.root.parent).toBeNull();
    expect(api.root.children).toHaveLength(0);
    expect(api.listVariants()).toHaveLength(0);
    expect(api.snapshot().detailGeometryCount).toBe(0);
    // Caller-owned materials are handed back clean for the next system.
    expect(facadeMaterial.opacity).toBe(1);
    expect(facadeMaterial.depthWrite).toBe(true);
    expect(() => api.setEra('1985')).toThrow(/disposed/);
    expect(() =>
      api.updateEraTransition(1, {
        from: '1965',
        to: '1985',
        elapsedMs: 1200,
        durationMs: 1200,
        active: false,
      }),
    ).not.toThrow();
  });
});

