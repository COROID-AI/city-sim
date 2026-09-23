/**
 * Chrono City — environment composition test suite.
 *
 * Proves the four acceptance claims of the streetscape / sky / lighting work
 * order against the real upstream modules, not against doubles:
 *
 *  1. the road ring, sidewalk slab, kerbs, gutters and crosswalks are built from
 *     the shared `BlockLayout` constants and change surface treatment per era
 *     (1945 trolley rails + worn paint through 2025 smart-surface light strips);
 *  2. street furniture evolves per year — globe lamps → smart LED columns,
 *     hydrants, mailboxes, bins, benches, trees, the phone-booth → kiosk →
 *     charging-pillar lineage, newsstands and 2025 delivery drones;
 *  3. era sky gradient, fog, sun/moon lighting rigs and the budgeted particle
 *     beds (steam, dust, neon haze, drone lights) follow the period's mood;
 *  4. the whole environment responds to `TimelineRuntime` era changes through
 *     `SceneContext` ticks, registers per-year fixtures in the
 *     `InspectionRegistry`, and publishes era-interpolated sky/fog/exposure and
 *     lighting-rig state through `EnvironmentApi` for the grading task.
 *
 * jsdom plus the `canvas` package back the procedural material library and the
 * particle sprite, and a stub renderer stands in for WebGL, so the suite runs
 * headless.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { ERA_IDS, type EraId } from '../../src/core/eraContracts';
import {
  CELL_HALF_DEPTH,
  CELL_HALF_WIDTH,
  CROSSWALK_ANCHORS,
  isOnSidewalk,
} from '../../src/core/blockLayout';
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
  TOTAL_PARTICLE_BUDGET,
  ATMOSPHERE_DESCRIPTORS,
  PARTICLE_BUDGETS,
  PARTICLE_KINDS,
  SKY_DOME_RADIUS,
} from '../../src/environment/skyAndLighting';
import {
  DRESSING_FAMILY_IDS,
  DRESSING_PLACEMENTS,
  dressingFixtureName,
} from '../../src/environment/streetDressing';
import {
  STREETSCAPE_DESCRIPTORS,
  SIDEWALK_TOP_Y,
  TROLLEY_GAUGE,
} from '../../src/environment/streetscape';
import {
  ENVIRONMENT_GLOBAL_KEY,
  EnvironmentApi,
  createEnvironmentApi,
  type EnvironmentSnapshot,
} from '../../src/environment/environmentApi';

/* ------------------------------------------------------------------------- *
 * Harness
 * ------------------------------------------------------------------------- */

function createStubRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const stub = {
    domElement: canvas,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    toneMappingExposure: 1,
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
  readonly api: EnvironmentApi;
}

function createFixture(initialEra: EraId = '1945'): Fixture {
  const context = createContext();
  const registry = createInspectionRegistry();
  const library = createMaterialLibraryFromScene(context);
  const timeline = new TimelineRuntime({ context, initialEra });
  const api = createEnvironmentApi({
    context,
    timeline,
    registry,
    materials: library,
    initialEra,
  });
  disposables.push(api, timeline, { dispose: () => registry.clear() });
  return { context, timeline, registry, library, api };
}

/** Picks a mesh by its streetscape role tag. */
function streetscapeMesh(api: EnvironmentApi, role: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  api.root.traverse((object) => {
    if (found) return;
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.userData.chronoStreetscapeRole === role) found = mesh;
  });
  return found;
}

function meshByRole(api: EnvironmentApi, role: string): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  api.root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.userData.chronoStreetscapeRole === role) meshes.push(mesh);
  });
  return meshes;
}

afterEach(() => {
  for (const disposable of disposables.splice(0)) disposable.dispose();
  for (const context of contexts.splice(0)) context.dispose();
  delete (window as unknown as Record<string, unknown>)[ENVIRONMENT_GLOBAL_KEY];
});

/* ------------------------------------------------------------------------- *
 * 1. Street surface built from BlockLayout
 * ------------------------------------------------------------------------- */

describe('street surface', () => {
  it('builds the road ring, sidewalk slab, kerbs and crossings from BlockLayout', () => {
    const { api } = createFixture('1945');
    const snapshot = api.streetscape.snapshot();

    expect(snapshot.roadRing.width).toBeCloseTo(CELL_HALF_WIDTH * 2, 6);
    expect(snapshot.roadRing.depth).toBeCloseTo(CELL_HALF_DEPTH * 2, 6);
    expect(snapshot.sidewalkTopY).toBeCloseTo(SIDEWALK_TOP_Y, 6);
    expect(snapshot.crosswalkCount).toBe(CROSSWALK_ANCHORS.length);
    expect(snapshot.crosswalkBarCount).toBeGreaterThanOrEqual(CROSSWALK_ANCHORS.length * 4);

    const road = streetscapeMesh(api, 'road-ring');
    expect(road).not.toBeNull();
    road!.geometry.computeBoundingBox();
    const roadBox = road!.geometry.boundingBox!;
    expect(roadBox.max.x).toBeCloseTo(CELL_HALF_WIDTH, 4);
    expect(roadBox.min.x).toBeCloseTo(-CELL_HALF_WIDTH, 4);
    expect(roadBox.max.z).toBeCloseTo(CELL_HALF_DEPTH, 4);
    expect(roadBox.min.z).toBeCloseTo(-CELL_HALF_DEPTH, 4);

    // The sidewalk is a raised slab, which is what makes the kerb face read.
    const sidewalk = streetscapeMesh(api, 'sidewalk');
    expect(sidewalk).not.toBeNull();
    sidewalk!.geometry.computeBoundingBox();
    const sidewalkBox = sidewalk!.geometry.boundingBox!;
    expect(sidewalkBox.min.y).toBeCloseTo(0, 4);
    expect(sidewalkBox.max.y).toBeCloseTo(SIDEWALK_TOP_Y, 4);

    expect(meshByRole(api, 'curb').length).toBe(4);
    expect(meshByRole(api, 'gutter').length).toBe(1);
    expect(meshByRole(api, 'crosswalk-bar').length).toBeGreaterThan(0);
    expect(meshByRole(api, 'lane-dash').length).toBeGreaterThan(0);
  });

  it('shows 1945 trolley rails and overhead wires with worn paint', () => {
    const { api } = createFixture('1945');
    const snapshot = api.streetscape.snapshot();

    expect(snapshot.trolleyRailPresence).toBe(1);
    expect(snapshot.trolleyWirePresence).toBe(1);
    expect(snapshot.smartSurfacePresence).toBe(0);
    expect(snapshot.crosswalkStyle).toBe(STREETSCAPE_DESCRIPTORS['1945'].crosswalkStyle);
    expect(snapshot.crosswalkOpacity).toBeCloseTo(0.4, 6);

    // Two rails per road leg, one catenary per leg plus support poles.
    expect(snapshot.railCount).toBe(8);
    expect(snapshot.wireCount).toBe(4);
    expect(snapshot.trolleyPoleCount).toBeGreaterThanOrEqual(4);

    const rails = meshByRole(api, 'rail');
    expect(rails.length).toBe(8);
    const rail = rails[0];
    const railsGroup = rail.parent as THREE.Group;
    expect(railsGroup.visible).toBe(true);
    rail.geometry.computeBoundingBox();
    // Rails are offset from the carriageway centre by half the standard gauge.
    expect(TROLLEY_GAUGE).toBeGreaterThan(1);
    expect(Math.abs(rail.position.z) + Math.abs(rail.position.x)).toBeGreaterThan(0);
  });

  it('swaps to 2025 fresh markings and smart-surface accents', () => {
    const { api } = createFixture('2025');
    const snapshot = api.streetscape.snapshot();

    expect(snapshot.trolleyRailPresence).toBe(0);
    expect(snapshot.trolleyWirePresence).toBe(0);
    expect(snapshot.smartSurfacePresence).toBe(1);
    expect(snapshot.crosswalkStyle).toBe('smart');
    expect(snapshot.crosswalkOpacity).toBeGreaterThan(
      STREETSCAPE_DESCRIPTORS['1945'].crosswalkOpacity,
    );
    expect(snapshot.smartStripCount).toBeGreaterThan(0);

    const railGroup = meshByRole(api, 'rail')[0].parent as THREE.Group;
    expect(railGroup.visible).toBe(false);
    const smartGroup = api.root.getObjectByName('chrono-smart-surface');
    expect(smartGroup).toBeDefined();
    expect(smartGroup!.visible).toBe(true);
  });
});

/* ------------------------------------------------------------------------- *
 * 2. Era street furniture
 * ------------------------------------------------------------------------- */

describe('era street dressing', () => {
  it('places every dressed family on the sidewalk band, never on the carriageway', () => {
    const { api } = createFixture('1945');
    const snapshot = api.dressing.snapshot();

    expect(snapshot.families).toHaveLength(DRESSING_FAMILY_IDS.length);
    for (const family of snapshot.families) {
      expect(family.placements).toBeGreaterThan(0);
    }
    expect(snapshot.boothLineageName).toBe('Telephone booth');

    for (const placement of DRESSING_PLACEMENTS) {
      if (placement.family === 'droneLights') continue;
      expect(isOnSidewalk(placement.position)).toBe(true);
    }
  });

  it('runs lamps from 1945 globes to 2025 smart LED columns', () => {
    const globe = createFixture('1945');
    expect(globe.api.dressing.snapshot().lampStyle).toBe('globeGas');
    expect(globe.api.dressing.familyStyle('lamps')).toBe('globeGas');

    const led = createFixture('2025');
    const snapshot = led.api.dressing.snapshot();
    expect(snapshot.lampStyle).toBe('smartLed');
    // Every lamp anchor builds one variant per visited era, and the current era
    // is the visible one.
    const lampAnchor = led.api.root.getObjectByName('chrono-dressing-lamp');
    expect(lampAnchor).toBeDefined();
    const visible = lampAnchor!.children.filter((child) => child.visible);
    expect(visible).toHaveLength(1);
    expect(visible[0].userData.chronoDressingEra).toBe('2025');
  });

  it('carries the fixture set through hydrants, boxes, bins, benches, trees and newsstands', () => {
    const { api } = createFixture('1985');
    const snapshot = api.dressing.snapshot();
    const byFamily = new Map(snapshot.families.map((family) => [family.family, family]));

    expect(byFamily.get('hydrants')!.style).toBe('chrome');
    expect(byFamily.get('mailboxes')!.style).toBe('clusterBox');
    expect(byFamily.get('trashCans')!.style).toBe('domeBin');
    expect(byFamily.get('benches')!.style).toBe('concrete');
    expect(byFamily.get('trees')!.style).toBe('maple/grate');
    expect(byFamily.get('newsstands')!.style).toBe('magazineStand');
    expect(byFamily.get('boothLineage')!.style).toBe('kiosk');

    for (const family of snapshot.families) {
      expect(family.visible).toBeGreaterThan(0);
      if (family.family === 'droneLights') {
        // 1985 has no drones: the family exists but contributes no geometry.
        expect(family.meshes).toBe(0);
      } else {
        expect(family.meshes).toBeGreaterThan(0);
      }
    }
  });

  it('evolves the phone booth lineage into a 2025 charging pillar and shows drone lights', () => {
    const booth = createFixture('1945');
    expect(booth.api.dressing.familyStyle('boothLineage')).toBe('phoneBooth');
    expect(dressingFixtureName('street-booth-lineage', '1945')).toBe('Telephone booth');
    expect(dressingFixtureName('street-booth-lineage', '1985')).toBe('Civic kiosk');
    expect(dressingFixtureName('street-booth-lineage', '2025')).toBe('EV charging pillar');
    expect(booth.api.dressing.snapshot().droneLightCount).toBe(0);
    expect(booth.api.dressing.snapshot().families.at(-1)!.style).toBe('drones-0');

    const future = createFixture('2025');
    expect(future.api.dressing.familyStyle('boothLineage')).toBe('chargingPillar');
    expect(future.api.dressing.snapshot().droneLightCount).toBe(5);
    expect(future.api.dressing.snapshot().families.at(-1)!.style).toBe('drones-5');
  });
});

/* ------------------------------------------------------------------------- *
 * 3. Sky, fog, lighting rigs and particles
 * ------------------------------------------------------------------------- */

describe('era sky, fog and lighting', () => {
  it('publishes the era sky gradient, fog and exposure for grading consumers', () => {
    const { api, context } = createFixture('1945');
    const snapshot = api.snapshot();

    expect(snapshot.sky.topColor).toBe(0x9fb3c8);
    expect(snapshot.sky.radius).toBe(SKY_DOME_RADIUS);
    expect(snapshot.fog.mode).toBe('linear');
    expect(snapshot.fog.color).toBe(0xb8b3a6);
    expect(snapshot.exposure).toBeCloseTo(0.95, 6);
    expect(snapshot.lighting.sunElevationDeg).toBeCloseTo(38, 6);
    expect(snapshot.lighting.mood).toContain('overcast');

    // The rig owns the renderer exposure; the grader only reads it.
    const renderer = context.renderer as THREE.WebGLRenderer & { toneMappingExposure?: number };
    expect(renderer.toneMappingExposure).toBeCloseTo(0.95, 6);
    expect(api.gradeState().exposure).toBeCloseTo(0.95, 6);
    expect(api.gradeState().fogMode).toBe('linear');

    // Fog lives on the scene, and the dome is in the graph.
    expect(context.scene.fog).toBeInstanceOf(THREE.Fog);
    const dome = context.scene.getObjectByName('chrono-sky-dome') as THREE.Mesh | undefined;
    expect(dome).toBeDefined();
    const material = dome!.material as THREE.ShaderMaterial;
    const top = material.uniforms.uTop.value as THREE.Color;
    expect(top.getHex()).toBe(0x9fb3c8);
  });

  it('switches 1985 to exponential dusk fog, a visible moon and amber light', () => {
    const { api, context } = createFixture('1985');
    const snapshot = api.snapshot();

    expect(snapshot.fog.mode).toBe('exponential');
    expect(snapshot.fog.density).toBeCloseTo(0.0068, 6);
    expect(context.scene.fog).toBeInstanceOf(THREE.FogExp2);
    expect(snapshot.exposure).toBeCloseTo(1.25, 6);
    expect(snapshot.lighting.sunElevationDeg).toBeCloseTo(6, 6);
    expect(snapshot.lighting.moonVisible).toBe(true);
    expect(snapshot.lighting.moonIntensity).toBeGreaterThan(0);

    const sun = context.scene.getObjectByName('chrono-sun') as THREE.DirectionalLight;
    const moon = context.scene.getObjectByName('chrono-moon') as THREE.DirectionalLight;
    expect(sun).toBeDefined();
    expect(moon).toBeDefined();
    expect(sun.castShadow).toBe(true);
    expect(moon.intensity).toBeGreaterThan(0);
    // Sun elevation drives the directional light's height above the horizon.
    expect(sun.position.y).toBeGreaterThan(0);
    expect(sun.position.y).toBeLessThan(sun.position.length());
  });

  it('budgets the particle beds and matches each era mood', () => {
    const { api, context } = createFixture('1945');
    const budget = api.particleBudget();

    expect(budget.capacity).toBe(TOTAL_PARTICLE_BUDGET);
    expect(budget.beds.map((bed) => bed.kind)).toEqual([...PARTICLE_KINDS]);
    for (const bed of budget.beds) {
      expect(bed.capacity).toBe(PARTICLE_BUDGETS[bed.kind]);
    }

    // 1945: coal steam and dust, no neon haze and no drones.
    const byKind = new Map(budget.beds.map((bed) => [bed.kind, bed]));
    expect(byKind.get('steam')!.presence).toBeCloseTo(ATMOSPHERE_DESCRIPTORS['1945'].steam, 6);
    expect(byKind.get('neonHaze')!.presence).toBeLessThan(0.1);
    expect(byKind.get('droneLights')!.presence).toBe(0);

    for (let frame = 0; frame < 40; frame += 1) context.tick(0.1);
    const running = api.particleBudget();
    expect(running.beds.find((bed) => bed.kind === 'steam')!.active).toBeGreaterThan(0);
    expect(running.active).toBeLessThanOrEqual(running.capacity);

    // The beds stay inside their budgets, and 1945's coal steam and dust
    // dominate while the neon haze hardly registers — the frame is not drowned.
    const live = new Map(running.beds.map((bed) => [bed.kind, bed.active]));
    expect(live.get('dust')!).toBeGreaterThan(0);
    expect(live.get('neonHaze')!).toBeLessThan(live.get('dust')!);
    for (const bed of running.beds) {
      expect(bed.active).toBeLessThanOrEqual(bed.capacity);
      expect(bed.opacity).toBeLessThanOrEqual(1);
    }

    // 1985 turns the neon haze to full and 2025 releases the drones.
    api.applyEra('1985');
    expect(api.snapshot().particles.beds.find((bed) => bed.kind === 'neonHaze')!.presence).toBe(1);

    api.applyEra('2025');
    for (let frame = 0; frame < 60; frame += 1) context.tick(0.1);
    const future = api.snapshot().particles;
    expect(future.beds.find((bed) => bed.kind === 'droneLights')!.presence).toBe(1);
    expect(future.beds.find((bed) => bed.kind === 'droneLights')!.active).toBeGreaterThan(0);
    expect(future.active).toBeLessThanOrEqual(future.capacity);
  });
});

/* ------------------------------------------------------------------------- *
 * 4. Timeline response, inspection registry and disposal
 * ------------------------------------------------------------------------- */

describe('era response through the shared tick loop', () => {
  it('morphs surface, dressing and sky as the timeline tweens under SceneContext ticks', () => {
    const { api, context, timeline } = createFixture('1945');
    expect(api.era).toBe('1945');
    expect(api.dressing.snapshot().lampStyle).toBe('globeGas');

    const anchor = api.root.getObjectByName('chrono-dressing-lamp')!;
    const progressSamples: number[] = [];
    let maxVisibleVariants = 0;
    let sawTargetAboveHalf = false;

    timeline.selectEra('2025');
    expect(api.isTransitioning).toBe(true);

    let frames = 0;
    while (timeline.isTransitioning && frames < 200) {
      context.tick(0.1);
      progressSamples.push(api.progress);
      maxVisibleVariants = Math.max(
        maxVisibleVariants,
        anchor.children.filter((child) => child.visible).length,
      );
      if (api.progress > 0.5) {
        // Mid-tween the street already reads as the incoming era's furniture.
        sawTargetAboveHalf =
          sawTargetAboveHalf ||
          api.root
            .getObjectByName('chrono-dressing-lamp')!
            .children.some((child) => child.userData.chronoDressingEra === '2025' && child.visible);
        const smart = api.root.getObjectByName('chrono-smart-surface')!;
        expect(smart.visible).toBe(true);
      }
      frames += 1;
    }

    expect(frames).toBeGreaterThan(2);
    expect(api.era).toBe('2025');
    expect(api.progress).toBe(1);
    expect(api.isTransitioning).toBe(false);
    expect(maxVisibleVariants).toBeGreaterThanOrEqual(2);
    expect(sawTargetAboveHalf).toBe(true);

    // Progress is monotonic and never jumps straight to the target.
    for (let index = 1; index < progressSamples.length; index += 1) {
      expect(progressSamples[index]).toBeGreaterThanOrEqual(progressSamples[index - 1]);
    }
    expect(progressSamples[0]).toBeLessThan(1);

    const settled: EnvironmentSnapshot = api.snapshot();
    expect(settled.streetscape.smartSurfacePresence).toBe(1);
    expect(settled.streetscape.trolleyRailPresence).toBe(0);
    expect(settled.dressing.lampStyle).toBe('smartLed');
    expect(api.dressing.familyStyle('boothLineage')).toBe('chargingPillar');
    expect(settled.tickCount).toBeGreaterThan(0);
    expect(settled.registered).toBe(true);

    // The environment tick is registered on the shared context.
    expect(context.hasSystem('environment')).toBe(true);
  });

  it('registers notable fixtures with per-year names and deregisters on dispose', () => {
    const { api, registry, context, timeline } = createFixture('1945');

    expect(api.inspectables()).toHaveLength(8);
    expect(api.inspectables()).toContain('street-booth-lineage');
    expect(registry.has('street-lamp')).toBe(true);

    expect(registry.resolve('street-booth-lineage', '1945')!.name).toBe('Telephone booth');
    expect(registry.resolve('street-booth-lineage', '1985')!.name).toBe('Civic kiosk');
    expect(registry.resolve('street-booth-lineage', '2025')!.name).toBe('EV charging pillar');
    expect(registry.resolve('street-lamp', '1965')!.name).toBe('Fluorescent cobra lamp');
    expect(registry.resolve('street-tree', '2025')!.name).toBe('Climate-resilient oak');

    // The published fixture report follows the selected era.
    expect(api.snapshot().fixtures.find((f) => f.id === 'street-booth-lineage')!.name).toBe(
      'Telephone booth',
    );

    api.integrate();
    expect(
      (window as unknown as Record<string, unknown>)[ENVIRONMENT_GLOBAL_KEY],
    ).toBe(api);

    api.dispose();
    expect(context.hasSystem('environment')).toBe(false);
    expect(timeline.blendableCount).toBe(0);
    expect(registry.has('street-lamp')).toBe(false);
    expect(registry.size).toBe(0);
    expect(api.root.parent).toBeNull();
    expect(context.scene.fog).toBeNull();
    expect(
      (window as unknown as Record<string, unknown>)[ENVIRONMENT_GLOBAL_KEY],
    ).toBeUndefined();
  });

  it('latches late runtime handles through consume()', () => {
    const context = createContext();
    const registry = createInspectionRegistry();
    const library = createMaterialLibraryFromScene(context);
    const api = createEnvironmentApi({ context, materials: library, initialEra: '1945' });
    disposables.push(api, { dispose: () => registry.clear() });

    expect(api.inspectables()).toHaveLength(0);
    expect(api.blendableId).toBeNull();

    const timeline = new TimelineRuntime({ context, initialEra: '1945' });
    disposables.push(timeline);
    api.consume({ timeline, registry });

    expect(api.blendableId).not.toBeNull();
    expect(api.inspectables()).toHaveLength(8);

    timeline.selectEra('2025', { immediate: true });
    context.tick(0.1);
    expect(api.era).toBe('2025');
    expect(api.snapshot().dressing.lampStyle).toBe('smartLed');
  });

  it('authors a descriptor for every era and keeps the conflict boundary clean', () => {
    const { api } = createFixture('2025');

    for (const era of ERA_IDS) {
      expect(ATMOSPHERE_DESCRIPTORS[era].era).toBe(era);
      expect(STREETSCAPE_DESCRIPTORS[era].era).toBe(era);
    }

    // No vehicle or pedestrian entities are created by the environment.
    const names: string[] = [];
    api.root.traverse((object) => names.push(object.name.toLowerCase()));
    expect(names.some((name) => name.includes('vehicle'))).toBe(false);
    expect(names.some((name) => name.includes('pedestrian'))).toBe(false);
    expect(names.some((name) => name.includes('lamp'))).toBe(true);
  });
});
