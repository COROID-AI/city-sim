/**
 * Signage and lighting unit suite (headless, node).
 *
 * Proves the five eras really differ, that every era's rig is built from local
 * procedural artwork with no remote asset, that placements stay inside the room
 * (no clipping through walls or ceiling), that the update path is allocation
 * free and that repeated timeline scrubbing releases every generated texture.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { YEAR_IDS, type PeriodDefinition, type RoomBounds, type YearId } from '../../contracts/period';
import { createKernel, type Kernel } from '../../core/kernel';
import { CAFE_ROOM_BOUNDS, createStructuralLayout, environmentSpec, type StructuralLayout } from '../environment';
import {
  LIGHT_BUDGET,
  MESH_BUDGET,
  SIGNAGE_LIGHTING_SPECS,
  SIGNAGE_LIGHTING_MODULE_ID,
  SIGN_STANDOFF,
  SignageLightingModule,
  createSignageLightingModule,
  describeSignageLightingSpec,
  isEmissiveSignageMaterial,
  kelvinToHex,
  kelvinToRgb,
  signageLightingSpec,
  signagePlacementProblems,
  type FixturePlacement,
  type SignPlacement,
  type SignageLightingModuleOptions,
} from './SignageLightingModule';
import {
  contrastRatio,
  isProceduralSignageTexture,
  paintSignFace,
  parseColor,
  SIGN_STYLE_IDS,
  type Rgb,
} from './textures';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const openKernels: Kernel[] = [];

afterEach(() => {
  for (const kernel of openKernels.splice(0)) {
    if (!kernel.isDisposed) kernel.dispose();
  }
});

/** A real period definition, built the way the registry will hand one over. */
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
  readonly module: SignageLightingModule;
  readonly bounds: RoomBounds;
  readonly layout: StructuralLayout;
}

function compose(
  year: YearId = '1945',
  options: { bounds?: RoomBounds; layout?: StructuralLayout; moduleOptions?: SignageLightingModuleOptions } = {},
): Scene {
  const bounds = options.bounds ?? CAFE_ROOM_BOUNDS;
  const layout = options.layout ?? createStructuralLayout(bounds);
  const kernel = createKernel(null, { forceHeadless: true, bounds, autoResize: false, seed: 0x1945 });
  openKernels.push(kernel);
  const module = createSignageLightingModule({ bounds, layout, seed: 0x1945, ...options.moduleOptions });
  module.build(kernel.createBuildContext(periodFor(year), { services: {} }));
  return { kernel, module, bounds, layout };
}

/** Moves the same module to `year`, the way the transition engine will. */
function applyYear(scene: Scene, year: YearId): void {
  scene.kernel.setYear(year);
  const period = periodFor(year);
  const context = scene.kernel.createBuildContext(period, { services: {} });
  scene.module.applyPeriod(period, context);
  scene.module.update(1 / 60, { year, elapsedSeconds: 1 / 60, frame: 1 });
}

function boxesInside(root: THREE.Object3D, bounds: RoomBounds, tolerance: number): string[] {
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
      problems.push(
        `${object.name} box [${box.min.x.toFixed(2)},${box.min.y.toFixed(2)},${box.min.z.toFixed(2)}]..` +
          `[${box.max.x.toFixed(2)},${box.max.y.toFixed(2)},${box.max.z.toFixed(2)}]`,
      );
    }
  });
  return problems;
}

function placementsOf(module: SignageLightingModule): readonly SignPlacement[] {
  return module.signs;
}

function firstSign(module: SignageLightingModule): SignPlacement {
  const sign = module.signs[0];
  if (!sign) throw new Error('the era placed no signs');
  return sign;
}

function firstFixture(module: SignageLightingModule): FixturePlacement {
  const fixture = module.fixtures[0];
  if (!fixture) throw new Error('the era placed no fixtures');
  return fixture;
}

/** Sum of absolute channel differences between two colours. */
function colorDistance(a: Rgb, b: Rgb): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/* -------------------------------------------------------------------------- */
/* Era data                                                                   */
/* -------------------------------------------------------------------------- */

describe('signage and lighting era data', () => {
  it('covers exactly the five eras and carries every field the registry reads', () => {
    expect(Object.keys(SIGNAGE_LIGHTING_SPECS).sort()).toEqual([...YEAR_IDS].sort());
    for (const year of YEAR_IDS) {
      const spec = signageLightingSpec(year);
      expect(spec).toBe(SIGNAGE_LIGHTING_SPECS[year]);
      expect(spec.year).toBe(year);
      expect(SIGN_STYLE_IDS).toContain(spec.signs[0]?.style);
      // Sign material, lettering technique, lettering text, dimensions, kelvin,
      // emissive intensity and the exposure hint all live in the data.
      expect(spec.signs.length).toBeGreaterThanOrEqual(3);
      for (const sign of spec.signs) {
        expect(sign.material.length).toBeGreaterThan(0);
        expect(sign.technique.length).toBeGreaterThan(0);
        expect(sign.style.length).toBeGreaterThan(0);
        expect(sign.text.length).toBeGreaterThan(0);
        expect(sign.width).toBeGreaterThan(0);
        expect(sign.height).toBeGreaterThan(0);
        expect(sign.depth).toBeGreaterThan(0);
        expect(sign.emissiveIntensity).toBeGreaterThanOrEqual(0);
        expect(sign.align).toBeGreaterThanOrEqual(0);
        expect(sign.align).toBeLessThanOrEqual(1);
        expect(parseColor(sign.baseColor).r + parseColor(sign.baseColor).g + parseColor(sign.baseColor).b).toBeGreaterThan(0);
      }
      expect(spec.fixtures.length).toBeGreaterThanOrEqual(1);
      let totalFixtures = 0;
      for (const fixture of spec.fixtures) {
        expect(fixture.count).toBeGreaterThanOrEqual(1);
        totalFixtures += fixture.count;
        expect(fixture.colorTemperatureK).toBeGreaterThanOrEqual(2000);
        expect(fixture.colorTemperatureK).toBeLessThanOrEqual(6500);
        expect(fixture.emissiveIntensity).toBeGreaterThan(0);
        expect(fixture.intensity).toBeGreaterThan(0);
        expect(fixture.range).toBeGreaterThan(0);
        expect(fixture.brightness).toBeGreaterThan(0);
        expect(fixture.brightness).toBeLessThanOrEqual(1);
        expect(fixture.flicker).toBeGreaterThanOrEqual(0);
        expect(fixture.flicker).toBeLessThanOrEqual(1);
      }
      // The documented budget is never exceeded by an era's own rig.
      expect(spec.maxActiveLights).toBeLessThanOrEqual(LIGHT_BUDGET);
      expect(totalFixtures).toBeLessThanOrEqual(spec.maxActiveLights);
      // Exposure hints stay in a range that reads at night without blowing out.
      expect(spec.exposure).toBeGreaterThanOrEqual(0.9);
      expect(spec.exposure).toBeLessThanOrEqual(1.4);
      expect(spec.nightExposure).toBeGreaterThanOrEqual(0.9);
      expect(spec.nightExposure).toBeLessThanOrEqual(1.4);
      expect(spec.bloom).toBeGreaterThan(0);
      expect(spec.bloom).toBeLessThanOrEqual(1);
    }
  });

  it('rewrites the lettering method, hardware and colour temperature era by era', () => {
    const inventory = Object.fromEntries(YEAR_IDS.map((year) => [year, describeSignageLightingSpec(signageLightingSpec(year))]));

    const y1945 = inventory['1945'];
    const y1965 = inventory['1965'];
    const y1985 = inventory['1985'];
    const y2005 = inventory['2005'];
    const y2025 = inventory['2025'];
    if (!y1945 || !y1965 || !y1985 || !y2005 || !y2025) throw new Error('missing era inventory');

    // 1945: hand-painted glass and board, bare bulbs, nothing lit.
    expect(y1945.neon).toBe(false);
    expect(y1945.internallyLitSigns).toBe(0);
    expect(y1945.fluorescentTubes).toBe(false);
    expect(y1945.lightBox).toBe(false);
    expect(y1945.channelLetters).toBe(false);
    expect(y1945.ledStrips).toBe(false);
    expect(y1945.dimmablePendant).toBe(false);
    expect(y1945.paintedGlass).toBe(true);
    expect(y1945.handPainted).toBe(true);
    expect(y1945.bareBulbPendant).toBe(true);
    expect(y1945.kelvinRange[0]).toBeGreaterThanOrEqual(2400);
    expect(y1945.kelvinRange[1]).toBeLessThanOrEqual(2700);

    // 1965: applied vinyl plus a simple illuminated exterior panel, fluorescents.
    expect(y1965.appliedVinyl).toBe(true);
    expect(y1965.fluorescentTubes).toBe(true);
    expect(y1965.internallyLitSigns).toBeGreaterThanOrEqual(1);
    expect(y1965.neon).toBe(false);
    expect(y1965.kelvinRange[0]).toBeGreaterThanOrEqual(3000);
    expect(y1965.kelvinRange[1]).toBeLessThanOrEqual(4100);

    // 1985: light box, coloured acrylic, cheap price strip and red neon.
    expect(y1985.lightBox).toBe(true);
    expect(y1985.colouredAcrylic).toBe(true);
    expect(y1985.priceStrip).toBe(true);
    expect(y1985.neon).toBe(true);
    expect(y1985.halogenDownlights).toBe(true);
    const neon = signageLightingSpec('1985').fixtures.find((fixture) => fixture.kind === 'neon-tube');
    const neonRgb = parseColor(neon?.color ?? '#000000');
    expect(neonRgb.r).toBeGreaterThan(neonRgb.g);
    expect(neonRgb.r).toBeGreaterThan(neonRgb.b);

    // 2005: internallit channel letters, printed vinyl, cool compact fluorescents.
    expect(y2005.channelLetters).toBe(true);
    expect(y2005.printedVinyl).toBe(true);
    expect(y2005.compactFluorescents).toBe(true);
    expect(y2005.neon).toBe(false);
    expect(y2005.fluorescentTubes).toBe(false);
    expect(y2005.kelvinRange[0]).toBeGreaterThanOrEqual(4100);
    expect(y2005.kelvinRange[1]).toBeLessThanOrEqual(5000);

    // 2025: LED edge-lit panel, slim backlit logo, QR decal, tunable rig.
    expect(y2025.edgeLitPanel).toBe(true);
    expect(y2025.backlitLogo).toBe(true);
    expect(y2025.qrDecal).toBe(true);
    expect(y2025.ledStrips).toBe(true);
    expect(y2025.dimmablePendant).toBe(true);
    expect(y2025.kelvinRange[0]).toBeGreaterThanOrEqual(2700);
    expect(y2025.kelvinRange[1]).toBeLessThanOrEqual(4000);

    // The era marker words the acceptance criteria name.
    const wording = YEAR_IDS.map((year) => signageLightingSpec(year).signs.map((sign) => sign.text).join(' '));
    expect(wording[0]).toContain('BLUE BIRD');
    expect(wording[1]).toContain('CONTINENTAL');
    expect(wording[2]).toContain('MODERNE');
    expect(wording[3]).toContain('VELO');
    expect(wording[4]).toContain('ARBOUR');
  });

  it('maps colour temperature to a warm and a cool light colour', () => {
    const warm = kelvinToRgb(2500);
    const cool = kelvinToRgb(4700);
    expect(warm.r).toBeGreaterThan(warm.b);
    expect(cool.b / cool.r).toBeGreaterThan(warm.b / warm.r);
    expect(kelvinToHex(2500)).toMatch(/^#[0-9a-f]{6}$/);
    expect(kelvinToHex(2700)).not.toBe(kelvinToHex(4000));
  });

  it('paints legible lettering and real artwork on every era sign', () => {
    for (const year of YEAR_IDS) {
      for (const sign of signageLightingSpec(year).signs) {
        const surface = paintSignFace({
          year,
          signId: sign.id,
          style: sign.style,
          text: sign.text,
          secondaryText: sign.secondaryText,
          baseColor: sign.baseColor,
          letterColor: sign.letterColor,
          glowColor: sign.glowColor,
          backlit: sign.backlit,
          width: sign.width,
          height: sign.height,
          seed: 0x1945,
        });
        expect(surface.width).toBeGreaterThan(16);
        expect(surface.height).toBeGreaterThan(8);
        // Legibility: the ink contrasts with the panel it is painted on.
        expect(contrastRatio(parseColor(sign.letterColor), parseColor(sign.baseColor))).toBeGreaterThan(2.4);
        // The lettering actually reached the raster.
        const letter = parseColor(sign.letterColor);
        const base = parseColor(sign.baseColor);
        let opaque = 0;
        let letterLike = 0;
        for (let index = 0; index < surface.data.length; index += 4) {
          if ((surface.data[index + 3] ?? 0) < 128) continue;
          opaque += 1;
          const pixel = {
            r: surface.data[index] ?? 0,
            g: surface.data[index + 1] ?? 0,
            b: surface.data[index + 2] ?? 0,
          };
          if (colorDistance(pixel, letter) <= colorDistance(pixel, base)) letterLike += 1;
        }
        expect(opaque).toBeGreaterThan(0);
        expect(letterLike / opaque).toBeGreaterThan(0.01);
        // Applied vinyl and the QR decal are cut artwork: transparent ground.
        const cutArtwork = sign.style === 'vinyl-letters' || sign.style === 'qr-decal';
        expect(surface.hasTransparency()).toBe(cutArtwork);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Module lifecycle                                                           */
/* -------------------------------------------------------------------------- */

describe('SignageLightingModule across the timeline', () => {
  it('builds, applies, updates and disposes all five eras on one module', () => {
    const scene = compose('1945');
    const { module, kernel } = scene;
    expect(module.id).toBe(SIGNAGE_LIGHTING_MODULE_ID);
    expect(kernel.world.children).toContain(module.root);
    expect(module.spec?.year).toBe('1945');

    const signatures = new Set<string>();
    for (const year of YEAR_IDS) {
      applyYear(scene, year);
      const spec = signageLightingSpec(year);
      expect(module.spec?.year).toBe(year);
      expect(module.year).toBe(year);
      expect(placementsOf(module)).toHaveLength(spec.signs.length);
      const expectedFixtures = spec.fixtures.reduce((total, fixture) => total + fixture.count, 0);
      expect(module.fixtures).toHaveLength(expectedFixtures);
      expect(module.activeLightCount).toBe(expectedFixtures);
      expect(module.activeLightCount).toBeLessThanOrEqual(spec.maxActiveLights);
      expect(module.activeLightCount).toBeLessThanOrEqual(module.lightBudget);
      expect(module.meshCount).toBeGreaterThan(0);
      expect(module.meshCount).toBeLessThanOrEqual(module.drawCallBudget);
      expect(module.drawCallBudget).toBe(MESH_BUDGET);
      expect(module.getHotspots()).toHaveLength(spec.signs.length + expectedFixtures);
      expect(module.updateCount).toBeGreaterThan(0);
      expect(module.placementProblems).toEqual([]);
      expect(module.describe().rejected).toEqual([]);
      signatures.add(module.signature);
    }
    // Five genuinely different eras, not five copies of the same rig.
    expect(signatures.size).toBe(YEAR_IDS.length);

    expect(module.dispose).toBeTypeOf('function');
    module.dispose();
    expect(module.root).toBeUndefined();
    expect(module.signs).toHaveLength(0);
    expect(module.fixtures).toHaveLength(0);
    expect(module.lights).toHaveLength(0);
    module.dispose();
    expect(kernel.world.children).toHaveLength(0);
  });

  it('keeps every sign, fixture and light inside the room for each era', () => {
    const scene = compose('1945');
    const { module, bounds, layout } = scene;
    for (const year of YEAR_IDS) {
      applyYear(scene, year);
      const root = module.root;
      expect(root).toBeInstanceOf(THREE.Object3D);
      if (!root) throw new Error('module root missing');
      // Independent geometry check: no mesh may cross a wall, the floor or the ceiling.
      expect(boxesInside(root, bounds, 0.05)).toEqual([]);
      // …and no light object may sit outside the volume either.
      root.updateMatrixWorld(true);
      const worldPosition = new THREE.Vector3();
      for (const light of module.lights) {
        light.getWorldPosition(worldPosition);
        expect(Math.abs(worldPosition.x)).toBeLessThanOrEqual(bounds.width / 2);
        expect(Math.abs(worldPosition.z)).toBeLessThanOrEqual(bounds.depth / 2);
        expect(worldPosition.y).toBeGreaterThan(0);
        expect(worldPosition.y).toBeLessThan(bounds.height);
      }
      // …and the module's own placement checker agrees, with real anchors.
      expect(signagePlacementProblems(module.signs, module.fixtures, layout, bounds, signageLightingSpec(year))).toEqual([]);
      for (const sign of module.signs) {
        expect(sign.box.max.y).toBeLessThan(bounds.height);
        expect(sign.box.min.y).toBeGreaterThan(0.05);
        if (sign.anchor === 'storefront-glazing') {
          const zone = layout.glazingZones.find((entry) => entry.id === sign.anchorId);
          expect(zone).toBeDefined();
        }
      }
      for (const fixture of module.fixtures) {
        if (fixture.shaft) {
          const base = {
            x: fixture.position.x + fixture.direction.x * fixture.shaftLength,
            y: fixture.position.y + fixture.direction.y * fixture.shaftLength,
            z: fixture.position.z + fixture.direction.z * fixture.shaftLength,
          };
          expect(base.y).toBeGreaterThan(0);
        }
      }
    }
    module.dispose();
  });

  it('lights the room with emissive fixtures that read as sources', () => {
    const scene = compose('1985');
    const { module } = scene;
    expect(module.litMaterials.length).toBe(module.fixtures.length);
    for (const material of module.litMaterials) {
      expect(material.emissiveIntensity).toBeGreaterThan(0);
      expect(material.emissive.getHex()).not.toBe(0);
      // Every lit fixture material is flagged so a renderer can treat it as a source.
      expect(isEmissiveSignageMaterial(material)).toBe(true);
    }
    // The lit sign faces are flagged too; unlit faces carry no emission.
    const root = module.root;
    expect(root).toBeInstanceOf(THREE.Object3D);
    const faceMaterials: THREE.Material[] = [];
    root?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!object.name.endsWith(':face')) return;
      const material = object.material;
      if (Array.isArray(material)) return;
      faceMaterials.push(material);
    });
    expect(faceMaterials).toHaveLength(module.signs.length);
    const emissiveFaces = faceMaterials.filter(
      (material) => material instanceof THREE.MeshStandardMaterial && material.emissiveIntensity > 0,
    );
    expect(emissiveFaces).toHaveLength(module.signs.filter((sign) => sign.emissiveIntensity > 0).length);
    expect(emissiveFaces.every((material) => isEmissiveSignageMaterial(material))).toBe(true);
    // Signs that are internally lit carry their own emissive face.
    const litSigns = module.signs.filter((sign) => sign.backlit);
    expect(litSigns.length).toBeGreaterThan(0);
    for (const sign of litSigns) {
      expect(sign.emissiveIntensity).toBeGreaterThan(0);
    }
    // The emission is visible before any update runs.
    expect(module.litSurfaceIntensity).toBeGreaterThan(0);
    expect(module.brightnessHint).toBeGreaterThan(0);
    expect(module.brightnessHint).toBeLessThanOrEqual(1);

    // Neon flickers, tungsten halogen does not: the update path is doing work.
    const neonLights = module.lights.filter((light) => light.name.includes('neon'));
    const halogenLights = module.lights.filter((light) => light.name.includes('downlight'));
    expect(neonLights.length).toBeGreaterThan(0);
    expect(halogenLights.length).toBeGreaterThan(0);
    const neonSamples: number[] = [];
    const baseline = halogenLights.map((light) => light.intensity);
    for (let frame = 0; frame < 60; frame += 1) {
      module.update(0.05, { year: '1985', elapsedSeconds: frame * 0.05, frame });
      const firstNeon = neonLights[0];
      if (firstNeon) neonSamples.push(firstNeon.intensity);
    }
    expect(Math.max(...neonSamples) - Math.min(...neonSamples)).toBeGreaterThan(0.05);
    halogenLights.forEach((light, index) => {
      expect(light.intensity).toBeCloseTo(baseline[index] ?? 0, 6);
    });
    expect(module.litLevel).toBeGreaterThan(0);
    module.dispose();
  });

  it('keeps the update path allocation free and reuses its resources', () => {
    const scene = compose('2025');
    const { module } = scene;
    const countsBefore = module.resources?.counts;
    const materialsBefore = module.litMaterials;
    const lightsBefore = module.lights;
    for (let frame = 0; frame < 240; frame += 1) {
      module.update(1 / 60, { year: '2025', elapsedSeconds: frame / 60, frame });
    }
    expect(module.resources?.counts).toEqual(countsBefore);
    expect(module.litMaterials).toHaveLength(materialsBefore.length);
    expect(module.lights).toHaveLength(lightsBefore.length);
    module.litMaterials.forEach((material, index) => {
      expect(material).toBe(materialsBefore[index]);
    });
    module.lights.forEach((light, index) => {
      expect(light).toBe(lightsBefore[index]);
    });
    module.dispose();
  });

  it('paints every face procedurally and never touches the network', () => {
    const networkAttempts: string[] = [];
    vi.stubGlobal('fetch', (...args: unknown[]) => {
      networkAttempts.push(String(args[0]));
      throw new Error('signage must not fetch anything');
    });
    const scene = compose('1945');
    const { module } = scene;
    for (const year of YEAR_IDS) {
      applyYear(scene, year);
      expect(module.textures.length).toBeGreaterThan(0);
      expect(module.proceduralOnly).toBe(true);
      expect(['canvas', 'data']).toContain(module.textureSource);
      for (const entry of module.textures) {
        expect(entry.texture.name.startsWith('signage:')).toBe(true);
        expect(isProceduralSignageTexture(entry.texture)).toBe(true);
      }
      expect(module.signs.length).toBeGreaterThan(0);
    }
    expect(networkAttempts).toEqual([]);
    module.dispose();
    vi.unstubAllGlobals();
  });

  it('releases the generated textures on every era change and on dispose', () => {
    const disposeSpy = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const scene = compose('1945');
    const { module, kernel } = scene;
    let released = 0;
    for (let round = 0; round < 3; round += 1) {
      for (const year of YEAR_IDS) {
        const texturesBefore = module.textures.length;
        applyYear(scene, year);
        const disposition = module.disposition;
        expect(disposition).not.toBeNull();
        expect(disposition?.textures ?? 0).toBe(texturesBefore);
        expect(disposition?.geometries ?? 0).toBeGreaterThan(0);
        expect(disposition?.materials ?? 0).toBeGreaterThan(0);
        released += disposition?.textures ?? 0;
        // One module group in the world, never an accumulating pile.
        expect(kernel.world.children).toHaveLength(1);
      }
    }
    const finalCount = module.textures.length;
    module.dispose();
    released += finalCount;
    expect(module.textures).toHaveLength(0);
    expect(module.root).toBeUndefined();
    expect(kernel.world.children).toHaveLength(0);
    expect(disposeSpy.mock.calls.length).toBeGreaterThanOrEqual(released);
    disposeSpy.mockRestore();
  });

  it('derives placements from the shell it is given rather than fixed coordinates', () => {
    const bounds: RoomBounds = { width: 7.4, depth: 9.2, height: 3.4 };
    const scene = compose('1985', { bounds, layout: createStructuralLayout(bounds) });
    const { module } = scene;
    expect(module.bounds).toBe(scene.layout.bounds);
    for (const year of YEAR_IDS) {
      applyYear(scene, year);
      expect(module.signs.length).toBeGreaterThanOrEqual(3);
      expect(module.placementProblems).toEqual([]);
      expect(boxesInside(module.root as THREE.Object3D, bounds, 0.05)).toEqual([]);
      // The signs hang off the smaller room's own anchors.
      const mount = scene.layout.wallMounts.find((entry) => entry.purpose === 'signage');
      const facade = module.signs.find((sign) => sign.surface === 'facade');
      expect(facade?.anchorId).toBe(mount?.id);
      expect(facade?.box.max.y).toBeLessThan(bounds.height);
      // The glazing signs stay on the bays the shell published.
      const windowSign = module.signs.find((sign) => sign.surface === 'storefront-glass');
      if (windowSign) {
        expect(scene.layout.glazingZones.some((zone) => zone.id === windowSign.anchorId)).toBe(true);
      }
    }
    module.dispose();
  });

  it('exposes hotspot anchors inside its own group and framing for inspect mode', () => {
    const scene = compose('2005');
    const { module } = scene;
    const root = module.root;
    expect(root).toBeInstanceOf(THREE.Object3D);
    const hotspots = module.getHotspots();
    expect(hotspots).toHaveLength(module.signs.length + module.fixtures.length);
    for (const hotspot of hotspots) {
      expect(hotspot.year).toBe('2005');
      expect(hotspot.moduleId).toBe(module.id);
      expect(hotspot.anchor).toBeInstanceOf(THREE.Object3D);
      let owner: THREE.Object3D | undefined = hotspot.anchor;
      while (owner && owner !== root) owner = owner.parent ?? undefined;
      expect(owner).toBe(root);
    }
    const sign = firstSign(module);
    const focus = module.signFocus(sign.signId);
    expect(focus).not.toBeNull();
    expect(focus?.year).toBe('2005');
    expect(focus?.target).not.toEqual(focus?.eye);
    expect(focus?.distance).toBeGreaterThan(0);
    expect(module.signFocus('not-a-sign')).toBeNull();
    // Sign faces stand off the wall rather than clipping into it.
    expect(Math.abs(sign.box.max.z - sign.box.min.z)).toBeGreaterThanOrEqual(sign.depth - 1e-6);
    expect(SIGN_STANDOFF).toBeGreaterThan(0);
    module.dispose();
  });

  it('publishes per-era exposure and bloom-free brightness hints', () => {
    const scene = compose('1945');
    const { module } = scene;
    for (const year of YEAR_IDS) {
      applyYear(scene, year);
      const spec = signageLightingSpec(year);
      const hints = module.exposureHints;
      expect(hints.exposure).toBe(spec.exposure);
      expect(hints.nightExposure).toBe(spec.nightExposure);
      expect(hints.bloom).toBe(spec.bloom);
      expect(hints.colorTemperatureK).toBe(spec.colorTemperatureK);
      expect(hints.ambientTint).toBe(spec.ambientTint);
      expect(hints.activeLightCount).toBe(module.activeLightCount);
      expect(hints.activeLightCount).toBeLessThanOrEqual(hints.maxActiveLights);
      const brightness = module.brightnessHint;
      expect(brightness).toBeGreaterThan(0);
      expect(brightness).toBeLessThanOrEqual(1);
      // Not black, not blown out: lit surfaces stay inside a sane band.
      expect(module.litSurfaceIntensity).toBeGreaterThan(0.05);
      expect(module.litSurfaceIntensity).toBeLessThan(3.5);
    }
    const description = module.describe();
    expect(description.built).toBe(true);
    expect(description.hotspotCount).toBe(module.signs.length + module.fixtures.length);
    expect(description.proceduralOnly).toBe(true);
    module.dispose();
    expect(module.describe().built).toBe(false);
  });

  it('keeps the lit fixture roster per era', () => {
    const scene = compose('1945');
    const { module } = scene;
    const first = firstFixture(module);
    expect(first.fixtureId.length).toBeGreaterThan(0);
    const kindsByYear = new Map<YearId, readonly string[]>();
    for (const year of YEAR_IDS) {
      applyYear(scene, year);
      kindsByYear.set(year, module.fixtures.map((fixture) => fixture.kind));
    }
    expect(kindsByYear.get('1945')).toContain('bare-bulb-pendant');
    expect(kindsByYear.get('1965')).toContain('fluorescent-tube');
    expect(kindsByYear.get('1985')).toContain('neon-tube');
    expect(kindsByYear.get('2005')).toContain('compact-fluorescent');
    expect(kindsByYear.get('2025')).toContain('led-strip');
    expect(kindsByYear.get('2025')).toContain('dimmable-pendant');
    // 1945 has no neon and no internally lit sign; 2005 has no neon either.
    for (const year of ['1945', '2005'] as const) {
      applyYear(scene, year);
      expect(module.fixtures.some((fixture) => fixture.kind === 'neon-tube')).toBe(false);
      expect(module.signs.every((sign) => !sign.backlit)).toBe(year === '1945');
    }
    module.dispose();
  });
});
