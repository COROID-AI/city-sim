/**
 * Chrono City — era-evolving perimeter buildings.
 *
 * `BuildingsApi` is the single entry point the rest of the app talks to. It owns
 * the building set that rings the block and morphs it through the five eras:
 *
 *   * it lays out the authoring ring of lots (`LOT_LAYOUT`) around the block
 *     perimeter and hangs one lot group per lot off a single root group;
 *   * it plans each lot per era (`planBuilding`) and builds one *variant* per
 *     (lot, era) — mass shells, facade ornament from `facades.ts` and rooftop
 *     clutter from `rooftops.ts` — lazily, so only the eras in play exist;
 *   * it implements `EraBlendable`: `setEra()` starts a transition and
 *     `updateEraTransition()` is called once per frame by the `TimelineRuntime`
 *     tween, morphing the block *continuously* — the envelope (height and depth)
 *     interpolates between the two eras' plans while the old facade dissolves
 *     into the new one, so the street wall is never empty and never cuts;
 *   * it registers its landmark lots in the `InspectionRegistry` with per-year
 *     names and blurbs, on the stable lot group so the inspectable object does
 *     not change under the picker as eras morph;
 *   * it registers a `SceneContext` tick system that animates the emissive
 *     accents (neon fascias, media walls, LED crowns) off the shared frame clock.
 *
 * Two ownership boundaries are deliberate:
 *
 *   * **The `0–4 m` storefront band belongs to the storefronts/advertisements
 *     task.** This module contributes only a plain band panel per lot
 *     (`role: 'mount-surface'`) and a fascia cap just above 4.05 m; it authors no
 *     awnings, no shop signage and no ornament inside the band — proven by the
 *     `mount-surface` / `detail` roles every mesh carries in `userData`.
 *   * **Materials come from the shared `MaterialLibrary`.** One era resolves at
 *     most `MAX_UNIQUE_MATERIALS_PER_ERA` materials and shares them across all
 *     18 lots, and every ornament instance is a scaled copy of one of four unit
 *     geometries, which is what keeps five eras of detail inside the frame
 *     budget.
 *
 * Lifecycle:
 *   create    → `createBuildingsApi({ context, timeline, materials, registry })`.
 *   consume   → `api.snapshot()`, `api.mountSurfaces()`, `api.featuresFor(era)`,
 *               `api.lotObject(id)` for HUDs, tests and sibling city systems.
 *   integrate → the era-transition integration task wires it into `main.ts`:
 *
 *   ```ts
 *   const timeline = createTimelineRuntime({ context, initialEra: '1945' });
 *   const inspection = createInspectionLayer({ context });
 *   const buildings = createBuildingsApi({
 *     context,
 *     timeline,
 *     registry: inspection.registry,
 *   });
 *   ```
 */

import * as THREE from 'three';

import {
  DEFAULT_ERA,
  ERA_IDS,
  assertEraId,
  clamp01,
  type EraBlendable,
  type EraId,
  type EraTransitionInfo,
  type EraTransitionOptions,
} from '../../core/eraContracts';
import type {
  FrameInfo,
  RandomSource,
  SceneContext,
  SystemRegistration,
} from '../../core/sceneContext';
import type { EraBlendableRegistration, TimelineRuntime } from '../../era/timelineRuntime';
import {
  createMaterialLibraryFromScene,
  type MaterialLibrary,
} from '../../materials/materialLibrary';
import type {
  InspectableCopyByEra,
  InspectableDefinition,
  InspectionRegistry,
} from '../../interaction/inspectionRegistry';
import {
  BUILDINGS_ROOT_NAME,
  DetailBatcher,
  DetailGeometrySet,
  LOT_GROUP_PREFIX,
  LOT_LAYOUT,
  STOREFRONT_BAND_HEIGHT,
  createBuildingMaterialSet,
  getEraRecipes,
  planBuilding,
  planSkyline,
  type BuildingMassing,
  type BuildingMaterialSet,
  type BuildingPlan,
  type BuildingRecipe,
  type LotDefinition,
} from './buildingFactory';
import {
  buildFacadeDetails,
  createFacadeFeatureCounts,
  type FacadeFeatureCounts,
  type MountSurfacePanel,
} from './facades';
import {
  buildRooftopDetails,
  createRooftopFeatureCounts,
  type RooftopFeatureCounts,
} from './rooftops';

export const BUILDINGS_API_VERSION = 1;

/** Tick-system id this system registers under. */
export const BUILDINGS_SYSTEM_ID = 'city-buildings';

/** Tick order: after the timeline (`-1000`), before interaction picking. */
export const BUILDINGS_SYSTEM_ORDER = -500;

/** Blendable id handed to the timeline. */
export const BUILDINGS_BLENDABLE_ID = 'city-buildings-block';

/** Prefix of a landmark building's inspectable id: `building-south-2`. */
export const LANDMARK_INSPECTABLE_PREFIX = 'building-';

/**
 * Crossfade thresholds of the ~1.2 s era tween.
 *
 * The new era's variant starts materialising once the envelope has begun to
 * move (15 %), is fully opaque by half way, and the old variant is gone by 75 %.
 * Because the target weight rises before the source weight falls, the sum of the
 * two weights never drops below 1 — the block is never transparent and never
 * empty while it morphs.
 */
export const TARGET_RISE_START = 0.15;
export const TARGET_RISE_END = 0.5;
export const SOURCE_FADE_START = 0.3;
export const SOURCE_FADE_END = 0.75;

/** Inspectable id of a lot's landmark building. */
export function landmarkInspectableId(lotId: string): string {
  return `${LANDMARK_INSPECTABLE_PREFIX}${lotId}`;
}

/* ------------------------------------------------------------------------- *
 * Landmark copy — one name and blurb per year
 * ------------------------------------------------------------------------- */

const LANDMARK_COPY: Readonly<Record<string, InspectableCopyByEra>> = Object.freeze({
  'south-2': Object.freeze({
    '1945': {
      name: 'Hartley & Sons Dry Goods',
      blurb:
        'Brick dry-goods warehouse with a shrapnel-pocked cornice, blackout paint flaking off the sash windows and a hand-lettered board offering ration coupons.',
    },
    '1965': {
      name: 'Meridian House',
      blurb:
        'Ribbon glazing and a gilded aluminium fascia announce the block’s first new office building; its rooftop sign buzzes above the tram wires.',
    },
    '1985': {
      name: 'Meridian Tower',
      blurb:
        'Mirrored setback tower over a mirrored lobby, magenta tube light washing the spandrel bands and a to-let board in the atrium.',
    },
    '2005': {
      name: 'Meridian Plaza',
      blurb:
        'A disciplined curtain wall over a granite service concourse; the lobby screen loops the building’s energy rating beside backlit lightboxes.',
    },
    '2025': {
      name: 'Meridian Exchange',
      blurb:
        'Mass-timber floors above a planted colonnade, its LED media band streaming the district carbon counter to the street.',
    },
  }),
  'south-4': Object.freeze({
    '1945': {
      name: 'The Rialto Picture House',
      blurb:
        'Deep stone cornice, painted canopy fascia and a bulb-lettered marquee promising a matinee double bill.',
    },
    '1965': {
      name: 'Rialto Scope Cinema',
      blurb:
        'Neon tubing wraps a fresh aluminium fascia and chrome capitals spell SCOPE above a wall of ribbon glazing.',
    },
    '1985': {
      name: 'Rialto Twin',
      blurb:
        'Split into two screens under a mirrored parapet, magenta tubes running the piers and a satellite dish bolted to the roof.',
    },
    '2005': {
      name: 'Rialto Leisure Complex',
      blurb:
        'Glass frontage, backlit poster lightboxes and a rooftop plant deck serving the screens below.',
    },
    '2025': {
      name: 'Rialto Studios',
      blurb:
        'Timber-clad studios under a planted roof terrace, with a media facade playing the evening programme.',
    },
  }),
  'north-0': Object.freeze({
    '1945': {
      name: 'Provincial Savings Bank',
      blurb:
        'Limestone base, soot-darkened brick above and a deep cornice carried over the barred vault windows.',
    },
    '1965': {
      name: 'Midland Trust Building',
      blurb:
        'Horizontal shade fins above a ribbon-glazed banking hall, with a brass-and-neon nameplate over the doors.',
    },
    '1985': {
      name: 'Midland Trust Tower',
      blurb:
        'Stepped mirror glass with a mirrored parapet and a rooftop dish farm feeding the trading floor.',
    },
    '2005': {
      name: 'Midland Trust Centre',
      blurb:
        'Blue-green curtain wall over a granite podium, mullion shadows falling crisp across the banking hall.',
    },
    '2025': {
      name: 'Cooperative Bank House',
      blurb:
        'Warm timber and low-iron glass above a bike room, the planted roofline hiding a solar-and-battery plant.',
    },
  }),
  'north-3': Object.freeze({
    '1945': {
      name: 'The Coronet Hotel',
      blurb:
        'Narrow brick frontage with stone lintels, a fire escape zig-zagging over the fascia and a coal-smoke-stained parapet.',
    },
    '1965': {
      name: 'Coronet Motor Hotel',
      blurb:
        'Cantilevered concrete balconies, a neon room-rate sign and a roof deck built for the new motoring trade.',
    },
    '1985': {
      name: 'Coronet Plaza Hotel',
      blurb:
        'Mirrored bands, an atrium under a stepped crown and satellite dishes pulling the first pay-movie channels.',
    },
    '2005': {
      name: 'Coronet Business Hotel',
      blurb:
        'Sleek glass tower, backlit lightbox signage and rooftop chillers tucked behind an aluminium coping.',
    },
    '2025': {
      name: 'Coronet Living',
      blurb:
        'Serviced apartments behind planted reveals, a media band scrolling the city’s air-quality index.',
    },
  }),
  'west-1': Object.freeze({
    '1945': {
      name: 'Fairfield Market Hall',
      blurb:
        'Long brick hall in pilastered bays with stone lintels, a tar roof carrying a hoist turret and timber water tanks.',
    },
    '1965': {
      name: 'Fairfield Department Store',
      blurb:
        'Ribbon windows over a chamfered concrete podium, with a spidery neon name bolted to the roofline.',
    },
    '1985': {
      name: 'Fairfield Galleria',
      blurb:
        'Brutalist slab with an expressed concrete grid and a mirrored atrium lantern glowing above the parapet.',
    },
    '2005': {
      name: 'Fairfield Shopping Centre',
      blurb:
        'Glass-box retail over a precast podium, ventilated by rooftop plant and lit by blue brand lightboxes.',
    },
    '2025': {
      name: 'Fairfield Market & Gardens',
      blurb:
        'Mass-timber floors above a covered market, terraces planted right up to the LED crown.',
    },
  }),
  'east-2': Object.freeze({
    '1945': {
      name: 'Fenwick Laundry & Steam Works',
      blurb:
        'Soot-black brick with a stubby chimney stack, iron shutters and a fire escape over the loading bays.',
    },
    '1965': {
      name: 'Fenwick Engineering Works',
      blurb:
        'Precast panels, ribbon clerestories and a rooftop neon sign aimed at the elevated road.',
    },
    '1985': {
      name: 'Fenwick Data Centre',
      blurb:
        'Windowless brutalist slab ringed by a mechanical floor, duct runs and a forest of dishes.',
    },
    '2005': {
      name: 'Fenwick Technology Campus',
      blurb:
        'Curtain-wall tower over a glazed podium, rooftop chillers and a telecom mast standing on the parapet.',
    },
    '2025': {
      name: 'Fenwick Green Works',
      blurb:
        'Cross-laminated timber with planted terraces, wind cowls and an LED crown reporting grid demand.',
    },
  }),
});

/* ------------------------------------------------------------------------- *
 * Public shapes
 * ------------------------------------------------------------------------- */

/** The storefront band mount surface one lot offers to the shopfront task. */
export interface BuildingMountSurface {
  readonly id: string;
  readonly lotId: string;
  readonly side: LotDefinition['side'];
  /** Centre of the band panel, world space, at half the band height. */
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  /** Outward-facing unit normal in world space. */
  readonly normal: Readonly<{ x: number; y: number; z: number }>;
  /** Frontage the panel spans, in metres. */
  readonly width: number;
  /** Band height, in metres — always `STOREFRONT_BAND_HEIGHT`. */
  readonly height: number;
  /** Yaw a shopfront should adopt when attaching to this lot. */
  readonly yaw: number;
}

/** One built (lot, era) variant. */
export interface BuildingVariantHandle {
  readonly lotId: string;
  readonly era: EraId;
  readonly plan: BuildingPlan;
  readonly group: THREE.Group;
  readonly materials: BuildingMaterialSet;
  readonly massInstances: number;
  readonly facadeInstances: number;
  readonly roofInstances: number;
  readonly mountSurfaceInstances: number;
  readonly facadeFeatures: FacadeFeatureCounts;
  readonly roofFeatures: RooftopFeatureCounts;
  readonly mountSurface: MountSurfacePanel;
  /** `MaterialLibrary` keys this variant drew with. */
  readonly materialKeys: readonly string[];
  /** Every mesh in the variant, tagged in `userData.chronoBuildingRole`. */
  readonly meshes: readonly THREE.Mesh[];
  /** Crossfade weight last applied (`0` hidden, `1` fully shown). */
  readonly weight: number;
  readonly scaleY: number;
  readonly scaleZ: number;
  applyWeight(weight: number, scaleY: number, scaleZ: number): void;
  dispose(): void;
}

/** Per-lot state inside a `BuildingsSnapshot`. */
export interface BuildingVariantState {
  readonly era: EraId;
  readonly weight: number;
  readonly visible: boolean;
  readonly scaleY: number;
  readonly scaleZ: number;
  readonly authoredHeight: number;
  readonly detailInstances: number;
}

/** Per-lot state inside a `BuildingsSnapshot`. */
export interface BuildingLotState {
  readonly id: string;
  readonly side: LotDefinition['side'];
  readonly frontWidth: number;
  readonly landmark: boolean;
  readonly inspectableId: string | null;
  /** Recipe style of the era the lot is heading towards. */
  readonly style: string;
  readonly massing: BuildingMassing;
  readonly storeys: number;
  /** Morphing street-wall height and depth, in metres. */
  readonly envelopeHeight: number;
  readonly envelopeDepth: number;
  /** Sum of the visible variants' weights — `>= 1` means the lot is never see-through. */
  readonly weightSum: number;
  readonly visibleVariantCount: number;
  readonly activeEras: readonly EraId[];
  readonly variants: readonly BuildingVariantState[];
}

/** Everything a HUD, a test or the integration task needs to read at once. */
export interface BuildingsSnapshot {
  readonly version: number;
  readonly era: EraId;
  readonly from: EraId;
  readonly to: EraId;
  readonly progress: number;
  readonly transitioning: boolean;
  readonly lotCount: number;
  readonly landmarkCount: number;
  readonly registeredInspectables: number;
  readonly builtVariants: number;
  readonly visibleVariants: number;
  readonly massInstances: number;
  readonly detailInstances: number;
  readonly rooftopInstances: number;
  readonly mountSurfaceInstances: number;
  readonly detailGeometryCount: number;
  readonly materialCount: number;
  readonly materialKeys: readonly string[];
  readonly minWeightSum: number;
  readonly minEnvelopeHeight: number;
  readonly skylineHeight: number;
  readonly mediaPulse: number;
  readonly tickCount: number;
  readonly lots: readonly BuildingLotState[];
}

/** One era's built feature totals, aggregated across every lot. */
export interface EraFeatureSummary {
  readonly era: EraId;
  readonly lots: number;
  readonly massings: readonly BuildingMassing[];
  readonly recipeStyles: readonly string[];
  readonly storeys: Readonly<{ min: number; max: number; mean: number }>;
  readonly heights: Readonly<{ min: number; max: number; mean: number }>;
  readonly facade: FacadeFeatureCounts;
  readonly roof: RooftopFeatureCounts;
  readonly detailInstances: number;
  readonly rooftopInstances: number;
  readonly materialKeys: readonly string[];
}

export interface BuildingsApiOptions {
  /** Shared scene context: supplies the scene, seeded RNG and the tick loop. */
  readonly context: SceneContext;
  /** Timeline driving the era. When given, this API registers as a blendable. */
  readonly timeline?: TimelineRuntime | null;
  /** Shared material library; a scene-seeded one is created when omitted. */
  readonly materials?: MaterialLibrary;
  /** Registry the landmark lots register in. Omit to register nothing. */
  readonly registry?: InspectionRegistry | null;
  /** Object the building root is parented to. Defaults to `context.scene`. */
  readonly parent?: THREE.Object3D;
  /** Lots to build; defaults to the authored block ring. */
  readonly lots?: readonly LotDefinition[];
  /** Era to build before the timeline takes over. Defaults to the timeline's. */
  readonly initialEra?: EraId;
  readonly blendableId?: string;
  readonly systemId?: string;
  readonly systemOrder?: number;
  /** Register the `SceneContext` media/neon pulse system. Defaults to `true`. */
  readonly animate?: boolean;
  /** Register landmark inspectables. Defaults to `true` when a registry is given. */
  readonly registerLandmarks?: boolean;
  /** Create the landmark inspectables without a registry (diagnostics only). */
  readonly announceLandmarks?: boolean;
}

interface LotRecord {
  readonly lot: LotDefinition;
  readonly group: THREE.Group;
  /** Built variants of this lot, keyed by era (at most one per era). */
  readonly variants: Map<EraId, BuildingVariant>;
}

function variantKey(lotId: string, era: EraId): string {
  return `${lotId}@${era}`;
}

function planKey(lot: LotDefinition, era: EraId): string {
  return variantKey(lot.id, era);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Weight of the incoming era at tween progress `p`. */
export function targetEraWeight(progress: number): number {
  const p = clamp01(progress);
  return clamp01((p - TARGET_RISE_START) / (TARGET_RISE_END - TARGET_RISE_START));
}

/** Weight of the outgoing era at tween progress `p`. */
export function sourceEraWeight(progress: number): number {
  const p = clamp01(progress);
  return 1 - clamp01((p - SOURCE_FADE_START) / (SOURCE_FADE_END - SOURCE_FADE_START));
}

function addCounts<T extends object>(target: T, source: T): T {
  const record = target as unknown as Record<string, number>;
  for (const [key, value] of Object.entries(source as unknown as Record<string, number>)) {
    record[key] = (record[key] ?? 0) + value;
  }
  return target;
}

/* ------------------------------------------------------------------------- *
 * Variant
 * ------------------------------------------------------------------------- */

/**
 * One lot's building for one era: mass shells, facade ornament and rooftop
 * clutter, plus the crossfade state the morph writes.
 */
class BuildingVariant implements BuildingVariantHandle {
  readonly lotId: string;
  readonly era: EraId;
  readonly plan: BuildingPlan;
  readonly group: THREE.Group;
  readonly materials: BuildingMaterialSet;
  readonly massInstances: number;
  readonly facadeInstances: number;
  readonly roofInstances: number;
  readonly mountSurfaceInstances: number;
  readonly facadeFeatures: FacadeFeatureCounts;
  readonly roofFeatures: RooftopFeatureCounts;
  readonly mountSurface: MountSurfacePanel;
  readonly materialKeys: readonly string[];
  meshes: readonly THREE.Mesh[];

  weight = 1;
  scaleY = 1;
  scaleZ = 1;

  private disposed = false;

  constructor(
    lot: LotDefinition,
    plan: BuildingPlan,
    materials: BuildingMaterialSet,
    geometries: DetailGeometrySet,
    random: RandomSource,
    parent: THREE.Object3D,
  ) {
    this.lotId = lot.id;
    this.era = plan.era;
    this.plan = plan;
    this.materials = materials;
    this.group = new THREE.Group();
    this.group.name = `${LOT_GROUP_PREFIX}${variantKey(lot.id, plan.era)}`;
    this.group.userData.chronoBuildingLot = lot.id;
    this.group.userData.chronoBuildingEra = plan.era;

    // Mass shells: one scaled box per planned mass block, drawn with the era's
    // facade material so the wall inside the storefront band matches the
    // building above it.
    const massBatcher = new DetailBatcher(this.group, geometries, 'mass');
    for (const block of plan.masses) {
      massBatcher.box(
        materials.get('facade'),
        block.centerX,
        block.baseY + block.height / 2,
        -(block.frontOffset + block.depth / 2),
        block.width,
        block.height,
        block.depth,
        { yaw: block.yaw },
      );
    }
    this.massInstances = massBatcher.flush();

    const facade = buildFacadeDetails({ plan, materials, geometries, parent: this.group, random });
    const rooftop = buildRooftopDetails({ plan, materials, geometries, parent: this.group, random });
    this.facadeInstances = facade.instanceCount;
    this.roofInstances = rooftop.instanceCount;
    this.facadeFeatures = facade.counts;
    this.roofFeatures = rooftop.counts;
    this.mountSurface = facade.mountSurface;
    this.mountSurfaceInstances = 1;

    const meshes: THREE.Mesh[] = [];
    this.group.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
    });
    this.meshes = Object.freeze(meshes);
    this.materialKeys = Object.freeze([...materials.keys]);

    parent.add(this.group);
  }

  /** Total ornament instances above the storefront band (facade + rooftop). */
  get detailInstances(): number {
    return this.facadeInstances + this.roofInstances;
  }

  applyWeight(weight: number, scaleY: number, scaleZ: number): void {
    this.weight = weight;
    this.scaleY = scaleY;
    this.scaleZ = scaleZ;
    this.group.visible = weight > 0.002;
    this.group.scale.set(1, scaleY, scaleZ);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes) {
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
    }
    this.group.removeFromParent();
    this.group.clear();
    this.meshes = Object.freeze([]);
  }
}

/* ------------------------------------------------------------------------- *
 * API
 * ------------------------------------------------------------------------- */

/**
 * The era-evolving building set of the city block.
 *
 * Everything the rest of the app needs is reachable from here: the lot ring, the
 * morph state, the storefront mount surfaces, the per-era feature totals and the
 * landmark inspectable ids.
 */
export class BuildingsApi implements EraBlendable {
  readonly version = BUILDINGS_API_VERSION;

  /** Tick-system id; also the id the timeline blendable registers under. */
  readonly id: string;
  readonly root: THREE.Group;
  readonly lots: readonly LotDefinition[];
  readonly landmarkIds: readonly string[];

  private readonly context: SceneContext;
  private readonly timeline: TimelineRuntime | null;
  private readonly registry: InspectionRegistry | null;
  private readonly library: MaterialLibrary;
  private readonly ownsLibrary: boolean;
  private readonly random: SceneContext['random'];
  private readonly geometries = new DetailGeometrySet();
  private readonly records = new Map<string, LotRecord>();
  private readonly plans = new Map<string, BuildingPlan>();
  /** Material sets keyed by archetype: 1985 resolves one per massing. */
  private readonly materialSets = new Map<BuildingMassing, BuildingMaterialSet>();
  private readonly mountSurfaces: readonly BuildingMountSurface[];
  private readonly registeredIds: string[] = [];
  private readonly systemId: string;
  private readonly systemOrder: number;
  private readonly animate: boolean;

  private blendableRegistration: EraBlendableRegistration | null = null;
  private systemRegistration: SystemRegistration | null = null;

  private fromEra: EraId;
  private toEra: EraId;
  private progressState = 1;
  private mediaPulseState = 1;
  private tickCountState = 0;
  private disposedState = false;

  constructor(options: BuildingsApiOptions) {
    if (!options?.context) throw new TypeError('BuildingsApi needs a SceneContext.');
    this.context = options.context;
    this.timeline = options.timeline ?? null;
    this.registry = options.registry ?? null;
    this.library = options.materials ?? createMaterialLibraryFromScene(options.context);
    this.ownsLibrary = options.materials === undefined;
    this.random = options.context.random;
    this.id = options.blendableId ?? BUILDINGS_BLENDABLE_ID;
    this.systemId = options.systemId ?? BUILDINGS_SYSTEM_ID;
    this.systemOrder = options.systemOrder ?? BUILDINGS_SYSTEM_ORDER;
    this.animate = options.animate ?? true;
    this.lots = options.lots ?? LOT_LAYOUT;

    this.root = new THREE.Group();
    this.root.name = BUILDINGS_ROOT_NAME;

    for (const lot of this.lots) {
      const group = new THREE.Group();
      group.name = `${LOT_GROUP_PREFIX}${lot.id}`;
      group.position.set(lot.frontCenter.x, 0, lot.frontCenter.z);
      group.rotation.y = lot.yaw;
      group.userData.chronoBuildingLot = lot.id;
      group.userData.chronoBuildingSide = lot.side;
      this.root.add(group);
      this.records.set(lot.id, { lot, group, variants: new Map() });
    }

    (options.parent ?? options.context.scene).add(this.root);
    this.root.updateMatrixWorld(true);

    this.mountSurfaces = Object.freeze(
      this.lots.map((lot) => this.buildMountSurface(lot)),
    );
    this.landmarkIds = Object.freeze(
      this.lots.filter((lot) => lot.landmark).map((lot) => lot.id),
    );

    const initial = options.initialEra ?? this.timeline?.era ?? DEFAULT_ERA;
    this.fromEra = assertEraId(initial);
    this.toEra = this.fromEra;
    this.applyMorph();

    if (options.registerLandmarks ?? this.registry !== null) {
      if (this.registry) this.registerLandmarks();
    }

    if (this.timeline) {
      this.blendableRegistration = this.timeline.registerBlendable(this, { id: this.id });
    }

    if (this.animate) {
      this.systemRegistration = this.context.registerSystem(
        this.systemId,
        this.tick,
        { order: this.systemOrder },
      );
    }
  }

  /* ---------------- era state ---------------- */

  /** Era the block is currently showing (the tween's target while it runs). */
  get era(): EraId {
    return this.toEra;
  }

  /** Era the running tween started from. */
  get from(): EraId {
    return this.fromEra;
  }

  /** Eased tween progress; `1` when settled. */
  get progress(): number {
    return this.progressState;
  }

  get isTransitioning(): boolean {
    return this.fromEra !== this.toEra;
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  get blendableId(): string | null {
    return this.blendableRegistration?.id ?? null;
  }

  /** `true` when the buildings' media/neon accents tick with the frame clock. */
  get isAnimated(): boolean {
    return this.systemRegistration !== null;
  }

  /**
   * `EraBlendable`: called once when a transition starts.
   *
   * `{ immediate: true }` (or a zero duration) snaps to the era; otherwise the
   * block starts morphing from the era it currently shows and both ends of the
   * tween are built straight away so the tween never stalls on geometry.
   */
  setEra(era: EraId, options: EraTransitionOptions = {}): void {
    this.assertUsable();
    const target = assertEraId(era);
    const durationMs = options.durationMs ?? 0;

    if (options.immediate === true || durationMs <= 0) {
      this.fromEra = target;
      this.toEra = target;
      this.progressState = 1;
      this.applyMorph();
      return;
    }

    const source = this.toEra;
    this.fromEra = source;
    this.toEra = target;
    this.progressState = 0;
    for (const record of this.records.values()) {
      this.variantFor(record.lot, source);
      this.variantFor(record.lot, target);
    }
    this.applyMorph();
  }

  /**
   * `EraBlendable`: one call per frame while the timeline tween runs, plus a
   * final call with `progress === 1` and `info.active === false`.
   */
  updateEraTransition(progress: number, transition: EraTransitionInfo): void {
    if (this.disposedState) return;
    const target = assertEraId(transition.to);
    const source = assertEraId(transition.from);
    const value = clamp01(progress);
    const complete = !transition.active || value >= 1;

    this.fromEra = complete ? target : source;
    this.toEra = target;
    this.progressState = complete ? 1 : value;
    this.applyMorph();
  }

  /** Snaps the block to an era without a tween (`setEra` with `immediate`). */
  applyEra(era: EraId): void {
    this.setEra(era, { immediate: true });
  }

  /* ---------------- content access ---------------- */

  /** The stable lot group that landmarks are registered against. */
  lotObject(lotId: string): THREE.Object3D | null {
    return this.records.get(lotId)?.group ?? null;
  }

  /** One built variant, or `null` when that (lot, era) has not been built. */
  variant(lotId: string, era: EraId): BuildingVariantHandle | null {
    return this.records.get(lotId)?.variants.get(era) ?? null;
  }

  /** Every built variant, in lot order then era order. */
  listVariants(): readonly BuildingVariantHandle[] {
    const built: BuildingVariantHandle[] = [];
    for (const record of this.records.values()) built.push(...record.variants.values());
    return Object.freeze(built);
  }

  /** Ids of the landmark inspectables this API registers. */
  inspectables(): readonly string[] {
    return Object.freeze([...this.registeredIds]);
  }

  /** The storefront band mount surface of every lot. */
  mountSurfaceList(): readonly BuildingMountSurface[] {
    return this.mountSurfaces;
  }

  /** Material keys one era resolves (at most `MAX_UNIQUE_MATERIALS_PER_ERA`). */
  materialKeysFor(era: EraId): readonly string[] {
    const keys = new Set<string>();
    for (const recipe of getEraRecipes(assertEraId(era))) {
      for (const key of this.materialSet(recipe).keys) keys.add(key);
    }
    return Object.freeze([...keys]);
  }

  /**
   * Per-era feature totals across the whole block. Builds any variant the era
   * is missing, so the summary always describes the complete era set.
   */
  featuresFor(era: EraId): EraFeatureSummary {
    const target = assertEraId(era);
    const facade = createFacadeFeatureCounts();
    const roof = createRooftopFeatureCounts();
    const heights: number[] = [];
    const storeyCounts: number[] = [];
    const materialKeys = new Set<string>();
    let detailInstances = 0;
    let rooftopInstances = 0;

    for (const record of this.records.values()) {
      const variant = this.variantFor(record.lot, target);
      addCounts(facade, variant.facadeFeatures);
      addCounts(roof, variant.roofFeatures);
      for (const key of variant.materialKeys) materialKeys.add(key);
      heights.push(planSkyline(variant.plan));
      storeyCounts.push(variant.plan.storeys);
      detailInstances += variant.facadeInstances;
      rooftopInstances += variant.roofInstances;
    }

    const recipes = getEraRecipes(target);
    return Object.freeze({
      era: target,
      lots: this.records.size,
      massings: Object.freeze(recipes.map((recipe) => recipe.massing)),
      recipeStyles: Object.freeze(recipes.map((recipe) => recipe.style)),
      storeys: summarize(storeyCounts),
      heights: summarize(heights),
      facade: Object.freeze(facade),
      roof: Object.freeze(roof),
      detailInstances,
      rooftopInstances,
      materialKeys: Object.freeze([...materialKeys]),
    });
  }

  /** Full, read-only state of the building set. */
  snapshot(): BuildingsSnapshot {
    const weights = this.currentWeights();
    const lots: BuildingLotState[] = [];
    let visibleVariants = 0;
    let massInstances = 0;
    let detailInstances = 0;
    let rooftopInstances = 0;
    let minWeightSum = Number.POSITIVE_INFINITY;
    let minEnvelopeHeight = Number.POSITIVE_INFINITY;
    let skylineHeight = 0;

    for (const record of this.records.values()) {
      const sourcePlan = this.planFor(record.lot, this.fromEra);
      const targetPlan = this.planFor(record.lot, this.toEra);
      const envelopeHeight = lerp(sourcePlan.skyline, targetPlan.skyline, this.progressState);
      const envelopeDepth = lerp(sourcePlan.depth, targetPlan.depth, this.progressState);
      const variants: BuildingVariantState[] = [];
      const activeEras: EraId[] = [];
      let weightSum = 0;
      let visibleCount = 0;

      for (const [era, variant] of record.variants) {
        const weight = weights.get(era) ?? 0;
        weightSum += weight;
        if (variant.group.visible) {
          visibleCount += 1;
          visibleVariants += 1;
          activeEras.push(era);
        }
        variants.push(
          Object.freeze({
            era,
            weight,
            visible: variant.group.visible,
            scaleY: variant.scaleY,
            scaleZ: variant.scaleZ,
            authoredHeight: variant.plan.skyline,
            detailInstances: variant.detailInstances,
          }),
        );
      }

      minWeightSum = Math.min(minWeightSum, weightSum);
      minEnvelopeHeight = Math.min(minEnvelopeHeight, envelopeHeight);
      skylineHeight = Math.max(skylineHeight, envelopeHeight);

      lots.push(
        Object.freeze({
          id: record.lot.id,
          side: record.lot.side,
          frontWidth: record.lot.frontWidth,
          landmark: record.lot.landmark,
          inspectableId: record.lot.landmark ? landmarkInspectableId(record.lot.id) : null,
          style: targetPlan.recipe.style,
          massing: targetPlan.recipe.massing,
          storeys: targetPlan.storeys,
          envelopeHeight,
          envelopeDepth,
          weightSum,
          visibleVariantCount: visibleCount,
          activeEras: Object.freeze(activeEras),
          variants: Object.freeze(variants),
        }),
      );
    }

    let builtVariants = 0;
    for (const record of this.records.values()) {
      for (const variant of record.variants.values()) {
        builtVariants += 1;
        massInstances += variant.massInstances;
        detailInstances += variant.facadeInstances;
        rooftopInstances += variant.roofInstances;
      }
    }

    const materialKeys = new Set<string>();
    for (const set of this.materialSets.values()) {
      for (const key of set.keys) materialKeys.add(key);
    }

    return Object.freeze({
      version: this.version,
      era: this.toEra,
      from: this.fromEra,
      to: this.toEra,
      progress: this.progressState,
      transitioning: this.isTransitioning,
      lotCount: this.records.size,
      landmarkCount: this.landmarkIds.length,
      registeredInspectables: this.registeredIds.length,
      builtVariants,
      visibleVariants,
      massInstances,
      detailInstances,
      rooftopInstances,
      mountSurfaceInstances: this.records.size,
      detailGeometryCount: this.geometries.size,
      materialCount: materialKeys.size,
      materialKeys: Object.freeze([...materialKeys]),
      minWeightSum: Number.isFinite(minWeightSum) ? minWeightSum : 0,
      minEnvelopeHeight: Number.isFinite(minEnvelopeHeight) ? minEnvelopeHeight : 0,
      skylineHeight,
      mediaPulse: this.mediaPulseState,
      tickCount: this.tickCountState,
      lots: Object.freeze(lots),
    });
  }

  /** Detaches from the timeline/context and releases every mesh it created. */
  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.systemRegistration?.dispose();
    this.systemRegistration = null;
    this.blendableRegistration?.dispose();
    this.blendableRegistration = null;

    if (this.registry) {
      for (const id of this.registeredIds) this.registry.deregister(id);
    }
    this.registeredIds.length = 0;

    for (const record of this.records.values()) {
      for (const variant of record.variants.values()) variant.dispose();
      record.variants.clear();
    }
    this.plans.clear();

    this.root.removeFromParent();
    this.root.clear();

    this.geometries.dispose();
    this.releaseMaterialState();
    if (this.ownsLibrary) this.library.dispose();
  }

  /* ---------------- internals ---------------- */

  private readonly tick = (_context: SceneContext, frame: FrameInfo): void => {
    if (this.disposedState) return;
    this.tickCountState += 1;
    // Emissive accents breathe with the shared frame clock: neon fascias and
    // LED media walls pulse on every variant that has one.
    const pulse = 0.82 + 0.18 * Math.sin(frame.elapsed * 1.7 + 0.4);
    this.mediaPulseState = pulse;
    for (const set of this.materialSets.values()) {
      const recipe = set.recipe;
      if (!recipe.facade.mediaFacade && !recipe.facade.neonTrim && !recipe.roof.mediaCrown) {
        continue;
      }
      if (!set.has('accent')) continue;
      const accent = set.get('accent');
      const base = Number(accent.userData.chronoBaseEmissiveIntensity ?? accent.emissiveIntensity);
      accent.emissiveIntensity = base * pulse;
    }
  };

  private assertUsable(): void {
    if (this.disposedState) {
      throw new Error(`BuildingsApi "${this.id}" is disposed and can no longer be driven.`);
    }
  }

  private buildMountSurface(lot: LotDefinition): BuildingMountSurface {
    return Object.freeze({
      id: `${LANDMARK_INSPECTABLE_PREFIX}${lot.id}-band`,
      lotId: lot.id,
      side: lot.side,
      position: Object.freeze({
        x: lot.frontCenter.x,
        y: STOREFRONT_BAND_HEIGHT / 2,
        z: lot.frontCenter.z,
      }),
      normal: Object.freeze({
        x: Math.sin(lot.yaw),
        y: 0,
        z: Math.cos(lot.yaw),
      }),
      width: lot.frontWidth,
      height: STOREFRONT_BAND_HEIGHT,
      yaw: lot.yaw,
    });
  }

  private registerLandmarks(): void {
    const registry = this.registry;
    if (!registry) return;
    for (const record of this.records.values()) {
      const lot = record.lot;
      if (!lot.landmark) continue;
      const id = landmarkInspectableId(lot.id);
      const copy = LANDMARK_COPY[lot.id] ?? {};
      const definition: InspectableDefinition = {
        id,
        object: record.group,
        copy,
        label: `Landmark building (${lot.id})`,
        highlight: { emissive: 0xffd9a0, emissiveIntensity: 0.85 },
        data: Object.freeze({
          system: 'city-buildings',
          landmark: true,
          side: lot.side,
          frontage: lot.frontWidth,
          eras: ERA_IDS,
        }),
      };
      registry.register(definition);
      this.registeredIds.push(id);
    }
  }

  /** Cached, geometry-free plan for one (lot, era). */
  private planFor(lot: LotDefinition, era: EraId): BuildingPlan {
    const key = planKey(lot, era);
    const cached = this.plans.get(key);
    if (cached) return cached;
    const plan = planBuilding(lot, era, this.random);
    this.plans.set(key, plan);
    return plan;
  }

  /**
   * Cached material set for one archetype. Non-facade roles resolve to the same
   * shared instances across an era's archetypes, so 1985's brutalist slabs and
   * mirrored towers together stay inside `MAX_UNIQUE_MATERIALS_PER_ERA`.
   */
  private materialSet(recipe: BuildingRecipe): BuildingMaterialSet {
    const cached = this.materialSets.get(recipe.massing);
    if (cached) return cached;
    const built = createBuildingMaterialSet(this.library, recipe);
    for (const material of built.list) {
      if (material.userData.chronoBaseEmissiveIntensity === undefined) {
        material.userData.chronoBaseEmissiveIntensity = material.emissiveIntensity;
      }
    }
    this.materialSets.set(recipe.massing, built);
    return built;
  }

  /** Every material set an era needs (one per archetype it draws from). */
  private setsForEra(era: EraId): readonly BuildingMaterialSet[] {
    return getEraRecipes(era).map((recipe) => this.materialSet(recipe));
  }

  /** Builds (once) and returns the variant for one (lot, era). */
  private variantFor(lot: LotDefinition, era: EraId): BuildingVariant {
    const record = this.records.get(lot.id);
    if (!record) throw new RangeError(`Unknown building lot "${lot.id}".`);
    const cached = record.variants.get(era);
    if (cached) return cached;
    const plan = this.planFor(lot, era);
    const variant = new BuildingVariant(
      lot,
      plan,
      this.materialSet(plan.recipe),
      this.geometries,
      this.random,
      record.group,
    );
    record.variants.set(era, variant);
    return variant;
  }

  /** Active crossfade weights, keyed by era. */
  private currentWeights(): Map<EraId, number> {
    const weights = new Map<EraId, number>();
    if (this.fromEra === this.toEra) {
      weights.set(this.toEra, 1);
      return weights;
    }
    weights.set(this.fromEra, sourceEraWeight(this.progressState));
    weights.set(this.toEra, targetEraWeight(this.progressState));
    return weights;
  }

  /**
   * Pushes the morph into the scene: the envelope (height/depth) interpolates
   * between the two eras' plans, the era variants crossfade, and every other
   * built variant is hidden.
   */
  private applyMorph(): void {
    const weights = this.currentWeights();
    const eras = new Set<EraId>([this.fromEra, this.toEra]);

    for (const [era, weight] of weights) {
      for (const set of this.setsForEra(era)) {
        for (const material of set.list) {
          material.opacity = weight;
          material.transparent = true;
          // Opaque while fully visible, blended while crossfading.
          material.depthWrite = weight > 0.995;
        }
      }
    }

    for (const record of this.records.values()) {
      const sourcePlan = this.planFor(record.lot, this.fromEra);
      const targetPlan = this.planFor(record.lot, this.toEra);
      const envelopeHeight = lerp(sourcePlan.skyline, targetPlan.skyline, this.progressState);
      const envelopeDepth = lerp(sourcePlan.depth, targetPlan.depth, this.progressState);

      for (const era of eras) {
        const variant = this.variantFor(record.lot, era);
        const weight = weights.get(era) ?? 0;
        variant.applyWeight(
          weight,
          envelopeHeight / variant.plan.skyline,
          envelopeDepth / variant.plan.depth,
        );
      }

      // Anything left over from an earlier tour through the timeline is hidden.
      for (const variant of record.variants.values()) {
        if (eras.has(variant.era)) continue;
        variant.applyWeight(0, 1, 1);
      }
    }
  }

  /** Restores shared materials to the state the rest of the app expects. */
  private releaseMaterialState(): void {
    for (const set of this.materialSets.values()) {
      for (const material of set.list) {
        material.opacity = 1;
        material.depthWrite = true;
        const base = Number(material.userData.chronoBaseEmissiveIntensity);
        if (Number.isFinite(base)) material.emissiveIntensity = base;
      }
    }
    this.materialSets.clear();
  }
}

function summarize(values: readonly number[]): Readonly<{ min: number; max: number; mean: number }> {
  if (values.length === 0) return Object.freeze({ min: 0, max: 0, mean: 0 });
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let total = 0;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    total += value;
  }
  return Object.freeze({ min, max, mean: total / values.length });
}

/**
 * Builds the block's era-evolving building set.
 *
 * ```ts
 * const buildings = createBuildingsApi({ context, timeline, registry });
 * context.tick(0.1);            // buildings respond to the timeline per frame
 * buildings.snapshot().lots;    // envelope, variants and crossfade weights
 * ```
 */
export function createBuildingsApi(options: BuildingsApiOptions): BuildingsApi {
  return new BuildingsApi(options);
}
