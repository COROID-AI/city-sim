/**
 * Chrono City — storefronts and advertising test suite.
 *
 * Proves the four acceptance claims of the storefront/advertising task against
 * the real upstream modules, not against doubles:
 *
 *  1. shopfronts change per year — 1945 hand-painted grocer/diner, 1965 neon
 *     diner, 1985 record store/arcade, 2005 chain coffee/internet cafe, 2025
 *     holographic/LED retail — with window dressing, menus, racks, crates,
 *     mannequins and awnings per era;
 *  2. advertisements evolve with the year — 1945 paper posters and painted wall
 *     media, 1965 neon + billboards, 1985 backlit billboards, 2005 print + video,
 *     2025 LED/holographic — and only the lit eras animate;
 *  3. every mesh this task owns stays inside the `0–4 m` storefront band, while
 *     freestanding media stands clear of the walking line on the sidewalk;
 *  4. shops and billboards register inspectables that resolve per-year names and
 *     blurbs through the `InspectionRegistry`, follow `TimelineRuntime` era
 *     changes through `SceneContext.tick()`, and pass a real ray-cast click all
 *     the way into the info card.
 *
 * jsdom plus the `canvas` package back the procedural sign textures and a stub
 * renderer stands in for WebGL, so the suite runs headless.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { ERA_IDS, type EraId } from '../../src/core/eraContracts';
import { SceneContext, type SceneContextOptions } from '../../src/core/sceneContext';
import { TimelineRuntime } from '../../src/era/timelineRuntime';
import { getEraDescriptor } from '../../src/era/eraDescriptors';
import {
  createInspectionRegistry,
  type InspectionRegistry,
} from '../../src/interaction/inspectionRegistry';
import { createInspectionLayer } from '../../src/interaction/pickingController';
import { INFO_CARD_SELECTORS } from '../../src/interaction/infoCard';
import {
  createMaterialLibraryFromScene,
  type MaterialLibrary,
} from '../../src/materials/materialLibrary';
import { createBuildingsApi } from '../../src/city/buildings/buildingsApi';
import { STOREFRONT_BAND_HEIGHT } from '../../src/city/buildings/buildingFactory';
import {
  AD_KIND_SPECS,
  ERA_AD_KINDS,
  ERA_ADVERTISERS,
  MEDIA_CLASSES,
  mediaClass,
  type AdKind,
  type MediaClass,
} from '../../src/city/storefronts/advertisingFactory';
import {
  BAND_ROLES,
  MAX_STOREFRONT_MATERIALS_PER_ERA,
  SHOP_ARCHETYPES,
  SIDEWALK_ROLES,
  STOREFRONT_METRICS,
  defaultStorefrontLots,
  getShopArchetypes,
  lotCarriesKerbMedia,
  mountSurfacesFromLots,
  type AwningKind,
  type ShopDressingKind,
  type ShopKind,
  type StorefrontLot,
} from '../../src/city/storefronts/storefrontFactory';
import {
  STOREFRONTS_SYSTEM_ID,
  StorefrontsApi,
  billboardInspectableId,
  createStorefrontsApi,
  decalSpec,
  fasciaSpec,
  menuSpec,
  shopfrontInspectableId,
  sourceEraWeight,
  targetEraWeight,
  valanceSpec,
} from '../../src/city/storefronts/storefrontsApi';
import {
  SIGN_MEDIA_DEFAULTS,
  SIGN_TEXTURES_VERSION,
  createSignMaterialHandle,
  createSignTexture,
  eraLettering,
  planSignAtlas,
  signMediaDefaults,
  transformSignCase,
  type SignMedia,
} from '../../src/city/storefronts/signTextures';

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
  readonly api: StorefrontsApi;
}

function createFixture(initialEra: EraId = '1945'): Fixture {
  const context = createContext();
  const registry = createInspectionRegistry();
  const library = createMaterialLibraryFromScene(context);
  const timeline = new TimelineRuntime({ context, initialEra });
  const api = createStorefrontsApi({ context, timeline, registry, materials: library });
  disposables.push(api, timeline, { dispose: () => registry.clear() });
  return { context, timeline, registry, library, api };
}

/** Ticks the shared render loop until the timeline settles (or the frame cap). */
function settle(context: SceneContext, timeline: TimelineRuntime, maxFrames = 200): number {
  let frames = 0;
  while (timeline.isTransitioning && frames < maxFrames) {
    context.tick(0.1);
    frames += 1;
  }
  return frames;
}

const UNIT_CORNERS: readonly THREE.Vector3[] = Object.freeze(
  [-0.5, 0.5].flatMap((x) =>
    [-0.5, 0.5].flatMap((y) => [-0.5, 0.5].map((z) => new THREE.Vector3(x, y, z))),
  ),
);

/** jsdom only rasterises canvases when the optional `canvas` binding is built. */
function canvas2dAvailable(): boolean {
  return document.createElement('canvas').getContext('2d') !== null;
}

interface Box3Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

function emptyBounds(): Box3Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
}

/**
 * Lot-local bounds of every instance in `meshes`. Instance matrices are stored
 * in the variant group's space, which is identity relative to the lot group, so
 * the numbers are directly comparable with the band metrics.
 */
function instanceBounds(meshes: readonly THREE.Mesh[]): Box3Bounds {
  const bounds = emptyBounds();
  const matrix = new THREE.Matrix4();
  const corner = new THREE.Vector3();

  for (const mesh of meshes) {
    const instanced = mesh as THREE.InstancedMesh;
    if (!instanced.isInstancedMesh) continue;
    for (let index = 0; index < instanced.count; index += 1) {
      instanced.getMatrixAt(index, matrix);
      for (const unit of UNIT_CORNERS) {
        corner.copy(unit).applyMatrix4(matrix);
        bounds.minX = Math.min(bounds.minX, corner.x);
        bounds.maxX = Math.max(bounds.maxX, corner.x);
        bounds.minY = Math.min(bounds.minY, corner.y);
        bounds.maxY = Math.max(bounds.maxY, corner.y);
        bounds.minZ = Math.min(bounds.minZ, corner.z);
        bounds.maxZ = Math.max(bounds.maxZ, corner.z);
      }
    }
  }
  return bounds;
}

function meshesWithRole(meshes: readonly THREE.Mesh[], roles: readonly string[]): THREE.Mesh[] {
  return meshes.filter((mesh) => roles.includes(String(mesh.userData.chronoStorefrontRole)));
}

/* ------------------------------------------------------------------------- *
 * Era expectations
 * ------------------------------------------------------------------------- */

interface EraExpectation {
  readonly shopKinds: readonly ShopKind[];
  readonly dressing: readonly ShopDressingKind[];
  readonly signMedia: readonly SignMedia[];
  readonly mediaClasses: readonly MediaClass[];
  readonly awning: AwningKind;
}

/** What each year must show: businesses, window dressing and ad technology. */
const ERA_EXPECTATIONS: Readonly<Record<EraId, EraExpectation>> = Object.freeze({
  '1945': {
    shopKinds: ['grocer', 'diner', 'barber', 'pharmacy', 'hardware', 'newsstand'],
    dressing: ['produceCrates', 'sacks', 'dinerCounter', 'menuBoard', 'newsPile', 'magazineRack'],
    signMedia: ['painted', 'enamel', 'paper'],
    mediaClasses: ['painted', 'paper'],
    awning: 'canvasShed',
  },
  '1965': {
    shopKinds: ['diner', 'sodaFountain', 'supermarket', 'hairdresser', 'applianceShowroom', 'pharmacy'],
    dressing: ['dinerCounter', 'stools', 'coffeeUrn', 'tvWall', 'produceCrates'],
    signMedia: ['neon', 'backlit'],
    mediaClasses: ['neon', 'backlit'],
    awning: 'angledMetal',
  },
  '1985': {
    shopKinds: ['recordStore', 'arcade', 'videoRental', 'electronics', 'boutique', 'pizzeria'],
    dressing: ['records', 'recordRacks', 'arcadeCabinets', 'mannequins', 'clothingRack', 'tvWall'],
    signMedia: ['neon', 'bulbMarquee', 'backlit'],
    mediaClasses: ['neon', 'backlit', 'video'],
    awning: 'stripedFabric',
  },
  '2005': {
    shopKinds: ['coffeeChain', 'internetCafe', 'mobileShop', 'bankBranch', 'copyShop', 'supermarketExpress'],
    dressing: ['espressoBar', 'cafeTables', 'laptopRows', 'phoneWall', 'bankCounter', 'selfCheckout'],
    signMedia: ['backlit', 'video', 'print'],
    mediaClasses: ['backlit', 'print', 'video'],
    awning: 'retractable',
  },
  '2025': {
    shopKinds: ['holographicRetail', 'ledShowroom', 'microCafe', 'vrArcade', 'zeroWasteGrocer', 'coworkLounge'],
    dressing: ['hologramPlinths', 'ledShelves', 'vrRigs', 'planters', 'microGreens', 'bikes'],
    signMedia: ['led', 'hologram'],
    mediaClasses: ['led', 'hologram'],
    awning: 'ledCanopy',
  },
});

/* ------------------------------------------------------------------------- *
 * Shopfronts per era
 * ------------------------------------------------------------------------- */

describe('era shopfront programs', () => {
  for (const era of ERA_IDS) {
    it(`${era} dresses all eighteen lots with era-authentic shops and window dressing`, () => {
      const { api } = createFixture(era);
      const expectation = ERA_EXPECTATIONS[era];
      const summary = api.featuresFor(era);

      expect(summary.era).toBe(era);
      expect(summary.lots).toBe(18);
      expect(summary.shopNames).toHaveLength(18);
      expect(new Set(summary.shopNames).size).toBe(18);

      for (const kind of expectation.shopKinds) {
        expect(summary.shopKinds).toContain(kind);
      }
      for (const kind of expectation.dressing) {
        expect(summary.dressing[kind] ?? 0).toBeGreaterThan(0);
      }
      for (const media of expectation.signMedia) {
        expect(summary.signMedia).toContain(media);
      }

      // Detail budgets: real dressing, real awnings, real signage on every lot.
      expect(summary.dressingInstances).toBeGreaterThan(200);
      expect(summary.awningInstances).toBeGreaterThan(0);
      expect(summary.awningKinds.length).toBeGreaterThanOrEqual(1);
      expect(summary.awningKinds).toContain(expectation.awning);
      expect(summary.instances).toBeGreaterThan(600);
      expect(summary.shopfront.signageFaces).toBeGreaterThanOrEqual(18);
      expect(summary.materialKeys.length).toBeLessThanOrEqual(MAX_STOREFRONT_MATERIALS_PER_ERA);

      // Every lot resolves the same name in the snapshot and the plan.
      const snapshot = api.snapshot();
      expect(snapshot.lotCount).toBe(18);
      for (const lot of snapshot.lots) {
        expect(lot.shopName).toBe(api.shopNameFor(lot.id, era));
        expect(lot.dressingKinds.length).toBeGreaterThanOrEqual(3);
        expect(lot.signMedia).toBe(
          getShopArchetypes(era).find((archetype) =>
            archetype.names.includes(lot.shopName),
          )?.sign ?? lot.signMedia,
        );
      }
    });
  }

  it('gives every era its own trading names, awnings and dressing', () => {
    const { api } = createFixture('1945');
    const namesByEra = ERA_IDS.map((era) => api.featuresFor(era).shopNames.join('|'));
    expect(new Set(namesByEra).size).toBe(ERA_IDS.length);

    const awningByEra = ERA_IDS.map((era) => api.featuresFor(era).awningKinds.join('|'));
    expect(new Set(awningByEra).size).toBeGreaterThanOrEqual(3);

    const dressingByEra = ERA_IDS.map((era) => api.featuresFor(era).dressingKinds.join('|'));
    expect(new Set(dressingByEra).size).toBe(ERA_IDS.length);
  });

  it('authors six programs and three trading names per era', () => {
    for (const era of ERA_IDS) {
      const archetypes = SHOP_ARCHETYPES[era];
      expect(archetypes).toHaveLength(6);
      const names = archetypes.flatMap((archetype) => [...archetype.names]);
      expect(names).toHaveLength(18);
      expect(new Set(names).size).toBe(18);
      expect(new Set(archetypes.map((archetype) => archetype.kind)).size).toBe(6);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * Advertising per era
 * ------------------------------------------------------------------------- */

describe('advertising evolves with the year', () => {
  for (const era of ERA_IDS) {
    it(`${era} advertises with ${ERA_EXPECTATIONS[era].mediaClasses.join(', ')} media`, () => {
      const { api } = createFixture(era);
      const expectation = ERA_EXPECTATIONS[era];
      const summary = api.featuresFor(era);
      const planKinds = ERA_AD_KINDS[era];

      // The year's blade, transom and kerb formats are all in use.
      for (const kind of [planKinds.blade, planKinds.transom, planKinds.kerb] as AdKind[]) {
        expect(summary.adKinds).toContain(kind);
      }
      expect(summary.ads.faces).toBeGreaterThanOrEqual(18);
      expect(summary.billboardInstances).toBeGreaterThan(0);

      for (const className of expectation.mediaClasses) {
        expect(summary.mediaProfile[className]).toBeGreaterThan(0);
      }
      for (const className of MEDIA_CLASSES) {
        if (expectation.mediaClasses.includes(className)) continue;
        expect(summary.mediaProfile[className]).toBe(0);
      }

      // Ad copy is drawn from the era's own slogans and advertisers.
      const slogans = getEraDescriptor(era).signage.slogans;
      const advertisers = ERA_ADVERTISERS[era];
      for (const lot of api.mountSurfaces) {
        for (const ad of api.advertisementsFor(lot.lotId, era)) {
          expect(slogans).toContain(ad.copy.headline);
          expect(advertisers).toContain(ad.copy.seller);
          // Every plan is built for the medium its format is authored with.
          expect(AD_KIND_SPECS[ad.kind].media).toBe(ad.media);
          expect(ad.width).toBeGreaterThan(0.8);
          expect(ad.height).toBeGreaterThan(0.2);
        }
      }
    });
  }

  it('keeps 1945 hand-painted and paper media dominant and completely unlit', () => {
    const { api } = createFixture('1945');
    const summary = api.featuresFor('1945');
    const share = summary.mediaShare;

    expect(share.painted + share.paper).toBeCloseTo(1, 6);
    expect(share.neon + share.backlit + share.print + share.video + share.led + share.hologram).toBe(0);
    expect(summary.animatedFaces).toBe(0);
    expect(summary.ads.faces).toBeGreaterThan(0);
    for (const kind of summary.adKinds) {
      expect(['hangingSign', 'paperTransom', 'paperHoard']).toContain(kind);
    }
  });

  it('lights and animates neon, bulb, backlit, video, LED and hologram media from 1965 on', () => {
    const { api } = createFixture('1965');
    const animated = new Set<EraId>();
    for (const era of ERA_IDS) {
      const summary = api.featuresFor(era);
      if (summary.animatedFaces > 0) animated.add(era);
      if (era === '1945') continue;
      expect(summary.glow).toBeGreaterThan(0);
    }
    expect([...animated].sort()).toEqual(['1965', '1985', '2005', '2025']);
  });

  it('plans in-band blades and transoms plus freestanding kerb media', () => {
    const { api } = createFixture('2005');
    const kerbLots = defaultStorefrontLots().filter((lot) => lotCarriesKerbMedia(lot));
    expect(kerbLots.length).toBeGreaterThan(4);
    const kerbKinds = new Set<AdKind>();

    for (const lot of defaultStorefrontLots()) {
      const ads = api.advertisementsFor(lot.id, '2005');
      const slots = ads.map((ad) => ad.slot);
      expect(slots).toContain('blade');
      expect(slots).toContain('transom');
      if (lotCarriesKerbMedia(lot)) expect(slots).toContain('kerb');
      for (const ad of ads) {
        if (ad.slot !== 'kerb') continue;
        kerbKinds.add(ad.kind);
        expect(AD_KIND_SPECS[ad.kind].structure).not.toBe('cantilever');
        expect(ad.centerZ).toBeGreaterThan(1.9);
      }
    }

    // 2005 advertises with both printed and moving media on the pavement.
    expect(kerbKinds.has('videoBillboard')).toBe(true);
    expect(kerbKinds.has('busShelterPoster')).toBe(true);
  });
});

/* ------------------------------------------------------------------------- *
 * Boundary discipline
 * ------------------------------------------------------------------------- */

describe('storefront band boundary', () => {
  for (const era of ERA_IDS) {
    it(`${era} keeps every owned mesh inside its band or clear on the sidewalk`, () => {
      const { api } = createFixture(era);
      const lots = defaultStorefrontLots();
      let bandInstances = 0;
      let kerbInstances = 0;

      for (const lot of lots) {
        const variant = api.variant(lot.id, era);
        expect(variant).not.toBeNull();
        const meshes = variant?.meshes ?? [];
        expect(meshes.length).toBeGreaterThan(0);

        for (const mesh of meshes) {
          const role = mesh.userData.chronoStorefrontRole;
          expect(typeof role).toBe('string');
          expect([...BAND_ROLES, ...SIDEWALK_ROLES]).toContain(role);
        }

        for (const role of BAND_ROLES) {
          const band = instanceBounds(meshesWithRole(meshes, [role]));
          if (!Number.isFinite(band.minY)) continue;
          bandInstances += 1;
          const where = `${era} ${lot.id} ${role}`;
          expect(band.minY, `${where} minY`).toBeGreaterThanOrEqual(-0.02);
          expect(band.maxY, `${where} maxY`).toBeLessThanOrEqual(STOREFRONT_BAND_HEIGHT + 0.02);
          // Mounted on the wall, never reaching past the awning into the street.
          expect(band.minZ, `${where} minZ`).toBeGreaterThanOrEqual(-0.02);
          expect(band.maxZ, `${where} maxZ`).toBeLessThanOrEqual(2.0);
        }

        for (const role of SIDEWALK_ROLES) {
          const kerb = instanceBounds(meshesWithRole(meshes, [role]));
          if (!Number.isFinite(kerb.minY)) continue;
          kerbInstances += 1;
          const where = `${era} ${lot.id} ${role}`;
          // Clear of the wall and of the walking line, still on the sidewalk.
          expect(kerb.minZ, `${where} minZ`).toBeGreaterThanOrEqual(1.9);
          expect(kerb.maxZ, `${where} maxZ`).toBeLessThanOrEqual(3.0);
          expect(kerb.minY, `${where} minY`).toBeGreaterThanOrEqual(-0.02);
        }
      }

      expect(bandInstances).toBeGreaterThan(0);
      expect(kerbInstances).toBeGreaterThan(0);
    });
  }

  it('lines up with the buildings task’s mount surfaces', () => {
    const context = createContext();
    const registry = createInspectionRegistry();
    const buildings = createBuildingsApi({ context, registry, initialEra: '1945' });
    disposables.push(buildings, { dispose: () => registry.clear() });

    const derived = mountSurfacesFromLots(defaultStorefrontLots());
    const fromBuildings = buildings.mountSurfaceList();
    expect(fromBuildings).toHaveLength(derived.length);

    for (const mount of fromBuildings) {
      const match = derived.find((entry) => entry.lotId === mount.lotId);
      expect(match).toBeDefined();
      expect(match?.width).toBeCloseTo(mount.width, 6);
      expect(match?.height).toBeCloseTo(mount.height, 6);
      expect(match?.yaw).toBeCloseTo(mount.yaw, 6);
      expect(match?.position.x).toBeCloseTo(mount.position.x, 6);
      expect(match?.position.z).toBeCloseTo(mount.position.z, 6);
      expect(match?.position.y).toBeCloseTo(STOREFRONT_BAND_HEIGHT / 2, 6);
    }

    // The buildings task only offers a bare panel in the band; the storefronts
    // sit in front of it, never inside it.
    const storefront = createStorefrontsApi({
      context,
      registry,
      initialEra: '1945',
      mountSurfaces: fromBuildings,
      systemId: 'city-storefronts-buildings-check',
      blendableId: 'city-storefronts-buildings-check',
    });
    disposables.push(storefront);
    expect(storefront.lots).toHaveLength(18);
    for (const mount of fromBuildings) {
      const group = storefront.lotObject(mount.lotId);
      expect(group?.position.x).toBeCloseTo(mount.position.x, 6);
      expect(group?.position.z).toBeCloseTo(mount.position.z, 6);
    }
  });

  it('reserves the band above 4 m for the buildings task', () => {
    // The band height the buildings module owns is the one this module fills.
    expect(STOREFRONT_BAND_HEIGHT).toBe(4);
    expect(STOREFRONT_METRICS.fasciaBottom + STOREFRONT_METRICS.fasciaHeight).toBeLessThanOrEqual(4);
    expect(STOREFRONT_METRICS.glassTop).toBeLessThan(STOREFRONT_METRICS.fasciaBottom);
    expect(STOREFRONT_METRICS.transomBottom + STOREFRONT_METRICS.transomHeight).toBeLessThanOrEqual(
      STOREFRONT_METRICS.fasciaBottom,
    );
  });
});

/* ------------------------------------------------------------------------- *
 * Timeline composition
 * ------------------------------------------------------------------------- */

describe('TimelineRuntime composition', () => {
  it('cross-fades the band through SceneContext ticks and never leaves a lot empty', () => {
    const { context, timeline, api } = createFixture('1945');
    expect(context.hasSystem(STOREFRONTS_SYSTEM_ID)).toBe(true);
    expect(timeline.blendableCount).toBe(1);
    expect(api.blendableId).toBeTruthy();

    timeline.selectEra('2025', { durationMs: 1000 });
    expect(timeline.isTransitioning).toBe(true);

    const progress: number[] = [];
    let minWeightSum = Number.POSITIVE_INFINITY;
    let visibleFrames = 0;

    while (timeline.isTransitioning && progress.length < 200) {
      context.tick(0.1);
      const snapshot = api.snapshot();
      progress.push(snapshot.progress);
      expect(snapshot.visibleVariants).toBeGreaterThan(0);
      for (const lot of snapshot.lots) {
        minWeightSum = Math.min(minWeightSum, lot.weightSum);
        if (lot.visibleVariantCount > 0) visibleFrames += 1;
      }
    }

    expect(progress.length).toBeGreaterThan(3);
    for (let index = 1; index < progress.length; index += 1) {
      expect(progress[index] as number).toBeGreaterThanOrEqual(progress[index - 1] as number);
    }
    expect(minWeightSum).toBeGreaterThan(0.9);
    expect(visibleFrames).toBeGreaterThan(0);

    const settled = api.snapshot();
    expect(settled.transitioning).toBe(false);
    expect(settled.era).toBe('2025');
    expect(settled.shopNames).toEqual(api.featuresFor('2025').shopNames);
    for (const lot of settled.lots) {
      expect(lot.era).toBe('2025');
      expect(lot.weightSum).toBeCloseTo(1, 6);
      expect(lot.visibleVariantCount).toBe(1);
      expect(lot.shopName).toBe(api.shopNameFor(lot.id, '2025'));
    }
  });

  it('animates the era’s lit media from the frame clock and leaves 1945 static', () => {
    const { context, api } = createFixture('1945');
    api.applyEra('1945');
    context.tick(0.2);
    const first = api.snapshot();
    context.tick(0.2);
    const second = api.snapshot();

    expect(first.animatedFaces).toBe(0);
    expect(first.glow).toBeCloseTo(second.glow, 6);
    expect(second.tickCount).toBeGreaterThan(first.tickCount);

    api.applyEra('2025');
    context.tick(0.1);
    const litA = api.snapshot();
    context.tick(0.35);
    const litB = api.snapshot();

    expect(litA.animatedFaces).toBeGreaterThan(0);
    expect(litA.glow).toBeGreaterThan(0);
    expect(litB.tickCount).toBeGreaterThan(litA.tickCount);
    expect(litB.glow).not.toBeCloseTo(litA.glow, 6);
    expect(litB.mediaPulse).toBeGreaterThanOrEqual(0);
    expect(litB.mediaPulse).toBeLessThanOrEqual(1);
  });

  it('blends source and target era weights monotonically', () => {
    expect(sourceEraWeight(0)).toBe(1);
    expect(targetEraWeight(0)).toBe(0);
    expect(sourceEraWeight(1)).toBe(0);
    expect(targetEraWeight(1)).toBe(1);
    expect(sourceEraWeight(0.5) + targetEraWeight(0.5)).toBeGreaterThan(0.9);
  });

  it('keeps five eras of signage inside the texture and material budget', () => {
    const { api } = createFixture('1945');
    for (const era of ERA_IDS) {
      expect(api.materialKeysFor(era).length).toBeLessThanOrEqual(MAX_STOREFRONT_MATERIALS_PER_ERA);
    }
    const snapshot = api.snapshot();
    expect(snapshot.signTextureCount).toBeLessThan(200);
    expect(snapshot.materialCount).toBeLessThanOrEqual(MAX_STOREFRONT_MATERIALS_PER_ERA);
  });
});

/* ------------------------------------------------------------------------- *
 * Inspection
 * ------------------------------------------------------------------------- */

describe('inspection integration', () => {
  it('registers every shop and billboard with per-year copy', () => {
    const { api, registry } = createFixture('1985');
    const kerbLots = defaultStorefrontLots().filter((lot) => lotCarriesKerbMedia(lot));

    expect(api.inspectables()).toHaveLength(18 + kerbLots.length);
    expect(registry.ids()).toContain(shopfrontInspectableId('south-2'));
    expect(registry.ids()).toContain(billboardInspectableId('south-2'));

    for (const lot of defaultStorefrontLots()) {
      for (const era of ERA_IDS) {
        const shop = registry.resolve(shopfrontInspectableId(lot.id), era);
        expect(shop).not.toBeNull();
        expect(shop?.source).toBe('era');
        expect(shop?.name).toBe(api.shopNameFor(lot.id, era));
        expect((shop?.blurb ?? '').length).toBeGreaterThan(40);

        if (!lotCarriesKerbMedia(lot)) continue;
        const billboard = registry.resolve(billboardInspectableId(lot.id), era);
        expect(billboard).not.toBeNull();
        expect(billboard?.source).toBe('era');
        expect(billboard?.name.length).toBeGreaterThan(6);
        expect(billboard?.name.toLowerCase()).toMatch(/billboard|hoarding|column|poster/);
        expect(billboard?.blurb ?? '').toMatch(/billboard|hoarding|column|poster/);
      }
    }
  });

  it('opens the year’s shop name in the info card after a ray-cast click', () => {
    const context = createContext();
    const registry = createInspectionRegistry();
    const layer = createInspectionLayer({ context, registry, era: '1945' });
    const api = createStorefrontsApi({ context, registry, initialEra: '1945' });
    disposables.push(api, layer, { dispose: () => registry.clear() });

    const lotId = 'south-2';
    const lot = defaultStorefrontLots().find((entry) => entry.id === lotId);
    expect(lot).toBeDefined();

    const clickShopfront = (): { name: string | null; blurb: string | null } => {
      const variant = api.variant(lotId, api.era);
      expect(variant).not.toBeNull();
      const group = api.lotObject(lotId);
      expect(group).not.toBeNull();
      api.root.updateMatrixWorld(true);

      // Stand in the street, level with the display bay, and aim at its centre.
      const bay = group?.localToWorld(new THREE.Vector3(0, 1.5, 0.6)) ?? new THREE.Vector3();
      const outward = api.mountSurfaces.find((mount) => mount.lotId === lotId)?.normal ?? {
        x: 0,
        y: 0,
        z: 1,
      };
      context.camera.position.set(
        bay.x + outward.x * 8,
        1.7,
        bay.z + outward.z * 8,
      );
      context.camera.lookAt(bay.x, 1.5, bay.z);
      context.camera.updateMatrixWorld(true);

      const viewport = context.viewport;
      const picked = layer.picking.pickAt(viewport.width / 2, viewport.height / 2);
      expect(picked).not.toBeNull();
      const resolution = layer.open(picked?.id ?? '');
      expect(layer.isOpen).toBe(true);
      const cardName = document.querySelector(INFO_CARD_SELECTORS.name)?.textContent ?? null;
      return { name: resolution?.name ?? null, blurb: resolution?.blurb ?? cardName };
    };

    const firstPick = clickShopfront();
    expect(firstPick.name).toBe(api.shopNameFor(lotId, '1945'));
    const cardAfter1945 = document.querySelector(INFO_CARD_SELECTORS.name)?.textContent ?? '';
    expect(cardAfter1945).toContain(String(api.shopNameFor(lotId, '1945')));

    api.applyEra('2025');
    layer.setEra('2025');
    const secondPick = clickShopfront();
    expect(secondPick.name).toBe(api.shopNameFor(lotId, '2025'));
    expect(secondPick.name).not.toBe(firstPick.name);
    const cardAfter2025 = document.querySelector(INFO_CARD_SELECTORS.name)?.textContent ?? '';
    expect(cardAfter2025).toContain(String(api.shopNameFor(lotId, '2025')));
  });

  it('paints the same shop name onto the fascia as the info card reports', () => {
    const { api } = createFixture('1945');
    const samples: Array<{ lot: string; era: EraId }> = [
      { lot: 'south-0', era: '1945' },
      { lot: 'west-1', era: '2025' },
      { lot: 'east-2', era: '1985' },
    ];

    for (const sample of samples) {
      api.featuresFor(sample.era);
      const variant = api.variant(sample.lot, sample.era);
      expect(variant).not.toBeNull();
      const face = (variant?.meshes ?? []).find((mesh) =>
        String(
          (mesh.material as THREE.Material).userData.chronoSignId ?? '',
        ).startsWith(`${sample.era}:fascia:`),
      );
      expect(face).toBeDefined();
      const texture = (face?.material as THREE.MeshStandardMaterial).map;
      const painted = String(texture?.userData.chronoSignText ?? '');
      const expected = api.shopNameFor(sample.lot, sample.era) ?? '';
      expect(painted).toContain(transformSignCase(expected, eraLettering(sample.era).signageCase));
      expect(face?.userData.chronoStorefrontRole).toBe('signage');
    }
  });
});

/* ------------------------------------------------------------------------- *
 * Sign textures
 * ------------------------------------------------------------------------- */

describe('era signage typography', () => {
  it('draws the era’s lettering case and font stack into the canvas', () => {
    for (const era of ERA_IDS) {
      const lettering = eraLettering(era);
      const handle = createSignTexture(
        {
          era,
          media: 'painted',
          palette: { board: '#7d2f2a', ink: '#f4e3c0', glow: '#ffd9a0' },
          blocks: [{ text: 'The Blue Plate Diner', role: 'title' }],
          widthMeters: 6,
          heightMeters: 0.8,
        },
        1234,
      );

      expect(handle.version).toBe(SIGN_TEXTURES_VERSION);
      expect(handle.letteredText[0]).toBe(transformSignCase('The Blue Plate Diner', lettering.signageCase));
      expect(handle.drawCalls.some((call) => call.startsWith('lettering('))).toBe(true);
      expect(
        handle.drawCalls.some((call) => call.includes('substrate(surface=paintedSign')),
        handle.drawCalls.join(' | '),
      ).toBe(true);
      expect(handle.rasterized).toBe(canvas2dAvailable());
      expect(handle.canvas.width).toBeGreaterThan(handle.canvas.height);
      handle.dispose();
    }

    expect(eraLettering('1965').signageCase).toBe('upper');
    expect(eraLettering('1945').signageCase).toBe('mixed');
    expect(transformSignCase('Corner News Bureau', 'upper')).toBe('CORNER NEWS BUREAU');
    expect(transformSignCase('Corner News Bureau', 'mixed')).toBe('Corner News Bureau');
  });

  it('fits the atlas to the face aspect so glyphs are never stretched', () => {
    for (const aspect of [10, 4, 1, 0.6, 0.35]) {
      for (const frames of [1, 4]) {
        const grid = planSignAtlas({ aspect, frames, longEdge: 512 });
        expect(grid.cellWidth / grid.cellHeight).toBeCloseTo(aspect, 1);
        expect(grid.columns * grid.rows).toBeGreaterThanOrEqual(frames);
        expect(grid.width).toBeLessThanOrEqual(1024);
        expect(grid.height).toBeLessThanOrEqual(1024);
        expect(grid.cellWidth).toBeGreaterThanOrEqual(20);
        expect(grid.cellHeight).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('animates media with UV offsets and lighting only, never a repaint', () => {
    const video = createSignTexture(
      {
        era: '2005',
        media: 'video',
        palette: { board: '#101018', ink: '#cfe6ff', glow: '#7fd4ff' },
        blocks: [{ text: 'CONNECTED', role: 'title' }],
        alternates: [[{ text: 'STREAM ANYWHERE', role: 'title' }]],
        widthMeters: 3.4,
        heightMeters: 1.55,
      },
      99,
    );
    expect(video.frames).toBeGreaterThan(1);

    const handle = createSignMaterialHandle({ id: 'video-ad', handle: video });
    // The reel is baked into the atlas as frames, so animating it must not add a
    // single canvas op — the draw list is frozen at texture-build time.
    const bakedOps = video.drawCalls;
    const bakedOpCount = bakedOps.length;
    expect(Object.isFrozen(bakedOps)).toBe(true);

    const first = handle.advance(0);
    const second = handle.advance(0.42);
    const again = handle.advance(0.42);

    expect(second.frame).not.toBe(first.frame);
    expect(second.uv[1]).not.toBeCloseTo(first.uv[1], 6);
    expect(again.emissiveIntensity).toBeCloseTo(second.emissiveIntensity, 6);
    expect(handle.material.emissiveMap).toBe(handle.texture.texture);
    expect(video.drawCalls.length).toBe(bakedOpCount);
    expect(video.canvas.width).toBeGreaterThan(0);

    const painted = createSignTexture(
      {
        era: '1945',
        media: 'painted',
        palette: { board: '#6f2f2a', ink: '#f6e7c4', glow: '#ffd9a0' },
        blocks: [{ text: 'Kowalski & Sons Grocers', role: 'title' }],
        widthMeters: 6,
        heightMeters: 0.74,
      },
      7,
    );
    const staticHandle = createSignMaterialHandle({ id: 'painted-sign', handle: painted });
    expect(staticHandle.animated).toBe(false);
    expect(staticHandle.advance(0).uv).toEqual(staticHandle.advance(9).uv);
    expect(staticHandle.advance(9).emissiveIntensity).toBeCloseTo(
      staticHandle.baseEmissiveIntensity,
      6,
    );

    staticHandle.dispose();
    handle.dispose();
  });

  it('keeps 1945 paint dull and later media bright', () => {
    expect(signMediaDefaults('painted').animation).toBe('none');
    expect(signMediaDefaults('paper').emissiveIntensity).toBeLessThan(0.2);
    for (const media of ['neon', 'bulbMarquee', 'backlit', 'video', 'led', 'hologram'] as SignMedia[]) {
      expect(signMediaDefaults(media).animation).not.toBe('none');
      expect(signMediaDefaults(media).emissiveIntensity).toBeGreaterThan(1);
    }
    expect(SIGN_MEDIA_DEFAULTS.led.emissiveIntensity).toBeGreaterThan(
      SIGN_MEDIA_DEFAULTS.painted.emissiveIntensity,
    );
  });

  it('classifies media for the HUD and media audits', () => {
    expect(mediaClass('enamel')).toBe('painted');
    expect(mediaClass('bulbMarquee')).toBe('neon');
    expect(mediaClass('hologram')).toBe('hologram');
    expect(mediaClass('video')).toBe('video');
  });

  it('paints every face at the aspect it is mounted at, so no glyph stretches', () => {
    const { api } = createFixture('1965');
    for (const lot of defaultStorefrontLots().slice(0, 4)) {
      const plan = api.planFor(lot.id, '1965');
      expect(plan).not.toBeNull();
      if (!plan) continue;
      for (const spec of [fasciaSpec(plan), decalSpec(plan), menuSpec(plan), valanceSpec(plan)]) {
        const handle = createSignTexture(spec, 4242);
        const faceAspect = spec.widthMeters / spec.heightMeters;
        const atlasAspect = handle.cellWidth / handle.cellHeight;
        // Within 2 %: the atlas snaps its short edge to whole pixels.
        expect(Math.abs(atlasAspect / faceAspect - 1), `${spec.key} atlas aspect`).toBeLessThan(
          0.02,
        );
        expect(handle.letteredText[0]?.length ?? 0).toBeGreaterThan(0);
        handle.dispose();
      }
    }
  });

  it('letters the awning valance in the eras that wear a fabric valance', () => {
    const valanceIds = (api: StorefrontsApi, era: EraId): string[] => {
      api.featuresFor(era);
      const ids: string[] = [];
      for (const lot of defaultStorefrontLots()) {
        for (const mesh of api.variant(lot.id, era)?.meshes ?? []) {
          if (mesh.userData.chronoStorefrontRole !== 'awning') continue;
          const id = String((mesh.material as THREE.Material).userData.chronoSignId ?? '');
          if (id.includes(':valance:')) ids.push(id);
        }
      }
      return ids;
    };

    const fixture = createFixture('1945');
    expect(valanceIds(fixture.api, '1945').length).toBeGreaterThan(8);
    expect(valanceIds(fixture.api, '1985').length).toBeGreaterThan(8);
    // The 2025 LED canopies have no fabric valance to letter.
    expect(valanceIds(fixture.api, '2025')).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------- *
 * Lifecycle
 * ------------------------------------------------------------------------- */

describe('lifecycle', () => {
  it('is deterministic for a given seed', () => {
    const first = createFixture('1945');
    const second = createFixture('1945');

    for (const lot of defaultStorefrontLots()) {
      for (const era of ERA_IDS) {
        expect(second.api.shopNameFor(lot.id, era)).toBe(first.api.shopNameFor(lot.id, era));
      }
    }
    expect(first.api.featuresFor('1985').instances).toBe(second.api.featuresFor('1985').instances);
    expect(first.api.snapshot().signTextureCount).toBe(second.api.snapshot().signTextureCount);

    const lots: readonly StorefrontLot[] = defaultStorefrontLots();
    expect(lots[0]?.index).toBe(0);
    expect(lots[lots.length - 1]?.index).toBe(lots.length - 1);
  });

  it('detaches, deregisters and restores shared materials on dispose', () => {
    const { context, timeline, registry, api } = createFixture('1985');
    const lotGroup = api.lotObject('south-2');
    const source = api.variant('south-2', '1985');
    const sourceMaterial = source?.meshes.find(
      (mesh) => (mesh.material as THREE.Material).userData.chronoBaseOpacity === 1,
    )?.material as THREE.MeshStandardMaterial | undefined;
    expect(sourceMaterial).toBeDefined();

    timeline.selectEra('2005', { durationMs: 400 });
    context.tick(0.05);
    const target = api.variant('south-2', '2005');
    const targetMaterial = target?.meshes.find(
      (mesh) => (mesh.material as THREE.Material).userData.chronoBaseOpacity === 1,
    )?.material as THREE.MeshStandardMaterial | undefined;
    expect(targetMaterial).toBeDefined();
    // Mid-tween the outgoing era is still opaque and the incoming one is fading in.
    expect(sourceMaterial?.opacity).toBe(1);
    expect(targetMaterial?.opacity).toBeLessThan(1);

    const frames = settle(context, timeline);
    expect(frames).toBeGreaterThan(0);
    expect(api.era).toBe('2005');
    expect(targetMaterial?.opacity).toBe(1);

    api.dispose();
    expect(api.isDisposed).toBe(true);
    expect(api.snapshot().registeredInspectables).toBe(0);
    expect(context.hasSystem(STOREFRONTS_SYSTEM_ID)).toBe(false);
    expect(timeline.blendableCount).toBe(0);
    expect(lotGroup?.parent).toBeNull();
    expect(registry.has(shopfrontInspectableId('south-2'))).toBe(false);
    expect(registry.has(billboardInspectableId('south-2'))).toBe(false);
    expect(targetMaterial?.opacity).toBe(1);
    expect(targetMaterial?.transparent).toBe(false);
    expect(() => api.setEra('1945')).toThrow(/disposed/);
  });

  it('refuses to build without a scene context', () => {
    expect(() => createStorefrontsApi({ context: undefined as never })).toThrow(TypeError);
  });

  it('uses in-band roles and a textured sign material on every lot', () => {
    const { api } = createFixture('1965');
    const variant = api.variant('north-3', '1965');
    const roles = new Set((variant?.meshes ?? []).map((mesh) => mesh.userData.chronoStorefrontRole));
    expect(roles.has('shopfront')).toBe(true);
    expect(roles.has('shopfront-glass')).toBe(true);
    expect(roles.has('window-dressing')).toBe(true);
    expect(roles.has('awning')).toBe(true);
    expect(roles.has('signage')).toBe(true);

    const signMesh = (variant?.meshes ?? []).find((mesh) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      return Boolean(material.emissiveMap) && material.emissiveIntensity > 0;
    });
    expect(signMesh).toBeDefined();
    expect((signMesh?.material as THREE.MeshStandardMaterial).map).toBeInstanceOf(THREE.CanvasTexture);
  });
});

/* ------------------------------------------------------------------------- *
 * Teardown
 * ------------------------------------------------------------------------- */

afterEach(() => {
  while (disposables.length > 0) {
    const disposable = disposables.pop();
    try {
      disposable?.dispose();
    } catch {
      // A fixture may already be disposed by its own test.
    }
  }
  while (contexts.length > 0) contexts.pop()?.dispose();
  document.body.innerHTML = '';
});
