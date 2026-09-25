/**
 * Chrono City scene assembly - the composition root.
 *
 * This module is the one place where the block's systems meet. It builds the
 * era-morphing world from the real system factories
 * (`environment`, `buildings`, `storefronts`, `advertising`, `vehicles`,
 * `pedestrians`), wraps the shared renderer in the cinematic post-processing
 * chain, hands every era-aware piece to the shared `EraTransitionDriver` and
 * pumps the result from the shared fixed-step loop.
 *
 * ## What it owns
 *
 * - **Composition** - one block group holding every system's `group`, mounted
 *   into the caller's scene; the scaffold's placeholder block is retired.
 * - **The era pipeline** - timeline year in, `applyEra(era, blend)` out to
 *   buildings, vehicles, storefronts, advertising, pedestrians, environment,
 *   post-processing and audio, through the transition driver only. Systems are
 *   driven strictly through the contracts declared in `../era/eraTypes`
 *   (`SceneSystem` + `EraAware`), and inspection descriptors are built from each
 *   system's public getters plus the documented `userData` keys the picking
 *   layer already defines - never from private state.
 * - **The frame** - `update(delta)` advances the transition, then updates every
 *   system with a per-system {@link EraUpdateContext}, then the camera rig;
 *   `render()` draws the composed frame through the post pipeline. Both paths
 *   reuse preallocated records, so a steady-state frame allocates nothing.
 * - **Interaction** - the camera rig and the click-to-inspect controller are
 *   bound to the supplied element (the WebGL canvas), and the pickable registry
 *   is rebuilt whenever an era stage changes which objects are visible.
 * - **Navigation and UI** (see {@link mountChronoCityUi}) - the timeline slider
 *   drives {@link ChronoCityScene.setEra}, the HUD sound control drives the SFX
 *   engine, and focus events fill the HUD inspection card.
 *
 * ## Era blend semantics
 *
 * The driver decides *when* each system morphs and calls `applyEra(era, blend)`
 * with a `blend` of `0` (what you are showing now) to `1` (fully the target).
 * Because the driver's per-system blend is authoritative, every system is
 * registered through a small recording bridge that captures the era and blend
 * the driver applied; `update` then feeds each system *exactly* that pair, so the
 * per-frame context and the transition choreography can never disagree - and the
 * lookup costs no allocation per frame.
 *
 * Camera pose is preserved across era changes by construction: the camera rig's
 * `applyEra` is a no-op and nothing here writes to the rig during a transition.
 */

import * as THREE from "three";

import { createSfxEngine, type SfxEngine } from "../audio/sfx";
import { PLACEHOLDER_BLOCK_NAME, disposeObjectTree } from "../core/renderer";
import {
  ERAS,
  ERA_IDS,
  clampBlend,
  getEraConfig,
  type EraAware,
  type EraId,
  type EraUpdateContext,
  type SceneSystem,
} from "../era/eraTypes";
import {
  createCinematicPostFX,
  type CinematicPostFX,
  type PostFXRenderer,
  type PostFXViewport,
} from "../render/postfx";
import { DEFAULT_INITIAL_ERA, EraTransitionDriver } from "../transitions/eraTransition";
import {
  createCameraRig,
  type CameraPose,
  type CameraRig,
  type FocusInfo,
  type FocusLabelOverride,
  type FocusTarget,
} from "../controls/camera";
import {
  createFocusController,
  defaultFocusTargetResolver,
  type FocusController,
  type FocusTargetResolver,
} from "../controls/focus";
import { createHud, type Hud, type InfoCardContent } from "../ui/hud";
import { createTimeline, type Timeline } from "../ui/timeline";
import { createAdvertisingSystem, type AdvertisingPlacement } from "./advertising";
import { createBuildingsSystem, type BuildingRecord, type BuildingsSystem } from "./buildings";
import {
  createEnvironmentSystem,
  type EnvironmentSystem,
  type StreetPropInstance,
} from "./environment";
import { CITY_LAYOUT, type CityLayout } from "./layout";
import { describeLook } from "./pedestrianOutfits";
import { createPedestrianSystem, type PedestrianFigure, type PedestrianSystem } from "./pedestrians";
import {
  createStorefrontSystem,
  type StorefrontPlan,
  type StorefrontSystem,
} from "./storefronts";
import { createVehicleSystem, type VehicleSystem } from "./vehicles";

/* -------------------------------------------------------------------------- */
/* Public shapes                                                              */
/* -------------------------------------------------------------------------- */

/** Name of the block root group every composed system is mounted under. */
export const CITY_BLOCK_GROUP_NAME = "city-block";

/** Ids of the systems the transition driver drives, in choreography order. */
export const CHRONO_CITY_SYSTEM_IDS = [
  "environment",
  "buildings",
  "storefronts",
  "advertising",
  "vehicles",
  "pedestrians",
  "postfx",
  "sfx",
] as const;

/** Advertising handle: the shared era-aware scene system plus its placements. */
export type AdvertisingSystem = ReturnType<typeof createAdvertisingSystem>;

/**
 * Era each composed system is *showing* right now.
 *
 * Systems expose this differently (a dominant variant for the crossfading
 * systems, the landed era for the morphing generators, the shader grade for
 * post-processing), so scene assembly reads each system's own public surface
 * instead of inferring it.
 */
export interface ChronoCityEraReport {
  readonly environment: EraId;
  readonly buildings: EraId;
  readonly storefronts: EraId;
  readonly advertising: EraId;
  readonly vehicles: EraId;
  readonly pedestrians: EraId;
  readonly postfx: EraId;
  readonly sfx: EraId;
}

/** Era and blend the driver last applied to one composed system. */
export interface ChronoCitySystemState {
  readonly id: string;
  readonly era: EraId;
  readonly blend: number;
}

/** Why a scene event fired. */
export type ChronoCitySceneEventType =
  | "transition-start"
  | "transition-complete"
  | "focus"
  | "focus-cleared";

/** One era/selection event, forwarded to the UI layer. */
export interface ChronoCitySceneEvent {
  readonly type: ChronoCitySceneEventType;
  /** Target era on `transition-start`, settled era on `transition-complete`. */
  readonly era: EraId;
  /** Era the transition left behind. */
  readonly from: EraId;
  /** True when a newer target superseded the leg. */
  readonly interrupted: boolean;
  /** Inspection payload on `focus`, otherwise `null`. */
  readonly info: FocusInfo | null;
}

export type ChronoCitySceneListener = (event: ChronoCitySceneEvent) => void;

export interface ChronoCitySceneOptions {
  /**
   * Renderer the post pipeline wraps. Structurally typed, so the real
   * `THREE.WebGLRenderer` and the GL-free stub used by tests both fit.
   */
  readonly renderer: PostFXRenderer;
  /** Scene every system is mounted into (its fog/background become era-owned). */
  readonly scene: THREE.Scene;
  /** Camera the navigation rig drives and the post pipeline renders from. */
  readonly camera: THREE.PerspectiveCamera;
  /** Initial viewport; keep it in step through {@link ChronoCityScene.resize}. */
  readonly viewport: PostFXViewport;
  /** Layout to populate; defaults to the canonical shared block. */
  readonly layout?: CityLayout;
  /** Timeline stop the block starts in; defaults to 1945. */
  readonly initialEra?: EraId;
  /** Deterministic seed for the generative systems. */
  readonly seed?: number;
  /** DOM element the navigation and picking layers bind to (the canvas). */
  readonly element?: HTMLElement | null;
  /** Audio engine to drive; a headless no-op engine is created when omitted. */
  readonly sfx?: SfxEngine;
  /** Length of one era transformation in milliseconds. */
  readonly durationMs?: number;
  /** Bloom mip-chain scale handed to the post pipeline. */
  readonly bloomScale?: number;
  /** Cap on simultaneously moving vehicles. */
  readonly vehicleCount?: number;
  /** Caps the pedestrian pool; tests use a small crowd. */
  readonly figurePoolSize?: number;
  /** Establishing pose; defaults to the rig's authored landmark view. */
  readonly initialPose?: CameraPose;
}

/** The composed block plus the lifecycle surface the entry point drives. */
export interface ChronoCityScene {
  /** Root of every mounted system; parented into the scene on construction. */
  readonly root: THREE.Group;
  readonly layout: CityLayout;
  /** Era the block is settled in, or travelling to while a leg runs. */
  readonly era: EraId;
  /** Simulated seconds advanced through {@link ChronoCityScene.update}. */
  readonly elapsed: number;

  readonly environment: EnvironmentSystem;
  readonly buildings: BuildingsSystem;
  readonly storefronts: StorefrontSystem;
  readonly advertising: AdvertisingSystem;
  readonly vehicles: VehicleSystem;
  readonly pedestrians: PedestrianSystem;
  readonly postfx: CinematicPostFX;
  readonly transition: EraTransitionDriver;
  readonly camera: CameraRig;
  readonly focus: FocusController;
  readonly sfx: SfxEngine;

  /** Advances the transition, every system and the camera by `delta` seconds. */
  update(delta: number): void;
  /** Draws the composed frame through the post pipeline. */
  render(delta?: number): void;
  /** Re-targets the post pipeline, the camera rig and the SFX engine. */
  resize(viewport: PostFXViewport): void;
  /** Starts (or re-aims) the era transformation towards `era`. */
  setEra(era: EraId): void;
  /** Fast-forwards the running transformation to its target. */
  settle(): void;
  /** Era currently shown by each composed system. */
  eraReport(): ChronoCityEraReport;
  /** Era and blend the driver last applied to each composed system. */
  systemStates(): readonly ChronoCitySystemState[];
  /** Subscribes to era and focus events; returns the unsubscribe function. */
  subscribe(listener: ChronoCitySceneListener): () => void;
  /** Stops everything and releases every GPU resource the block owns. */
  dispose(): void;
}

/** Mount points the UI layer renders into. */
export interface ChronoCityUiRoots {
  /** Container for the timeline slider, normally `#timeline-root`. */
  readonly timeline: HTMLElement;
  /** Container for the HUD, normally `#hud-root`. */
  readonly hud: HTMLElement;
}

/** Live UI handle; disposing it removes the DOM and every listener it added. */
export interface ChronoCityUi {
  readonly timeline: Timeline;
  readonly hud: Hud;
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

/** Prefix the advertising system gives every ad panel mesh. */
const AD_PANEL_PREFIX = "ad-panel-";

/** Stage of the choreography each system travels in. */
type SystemStage = "environment" | "buildings" | "retail" | "street-life";

type ComposedSystemId = (typeof CHRONO_CITY_SYSTEM_IDS)[number];

/** Mutable view of the read-only {@link EraUpdateContext} contract. */
interface MutableEraUpdateContext {
  era: EraId;
  from: EraId;
  blend: number;
  weights: Record<EraId, number>;
  delta: number;
  elapsed: number;
}

/** What the driver most recently applied to one participant. */
interface AppliedState {
  era: EraId;
  blend: number;
}

/** One era-aware scene system plus the machinery that drives and reports it. */
interface ComposedSystemEntry {
  readonly id: ComposedSystemId;
  readonly stage: SystemStage;
  readonly system: SceneSystem & EraAware;
  /** Object registered with the driver; records the era/blend it applies. */
  readonly bridge: EraAware;
  /** Reused per-frame context; never reallocated while the scene lives. */
  readonly context: MutableEraUpdateContext;
  /** Era/blend the driver last applied to this system (`1` when settled). */
  readonly state: AppliedState;
}

/** The two non-system participants the driver also drives. */
type AuxiliaryId = Extract<ComposedSystemId, "postfx" | "sfx">;

/** A driver registration that is not a scene system (post-processing, audio). */
interface AuxiliaryBinding {
  readonly id: AuxiliaryId;
  readonly stage: SystemStage;
  readonly bridge: EraAware;
  /** Era this participant is showing, read from its own public surface. */
  readonly reportedEra: () => EraId;
  readonly state: AppliedState;
}

/** Declarative description of one composed scene system. */
interface SystemDefinition {
  readonly id: ComposedSystemId;
  readonly stage: SystemStage;
  readonly system: SceneSystem & EraAware;
  /** Era the system currently shows, read from its own public surface. */
  readonly reportedEra: () => EraId;
}

/* -------------------------------------------------------------------------- */
/* Composition root                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Builds the complete Chrono City block around an existing view.
 *
 * Everything is created from the real system factories and wired through the
 * shared contracts. The returned handle is the only thing the entry point and
 * the UI need: pump {@link ChronoCityScene.update} from the fixed-step loop,
 * draw with {@link ChronoCityScene.render}, and call
 * {@link ChronoCityScene.setEra} for every timeline year change.
 */
export function createChronoCityScene(options: ChronoCitySceneOptions): ChronoCityScene {
  const layout = options.layout ?? CITY_LAYOUT;
  const scene = options.scene;
  const camera = options.camera;
  const initialEra = options.initialEra ?? DEFAULT_INITIAL_ERA;
  getEraConfig(initialEra);

  const ownsSfx = options.sfx === undefined;
  const sfx = options.sfx ?? createSfxEngine();

  // The scaffold's placeholder block exists only until real geometry lands.
  const placeholder = scene.getObjectByName(PLACEHOLDER_BLOCK_NAME);
  if (placeholder) {
    placeholder.removeFromParent();
    disposeObjectTree(placeholder);
  }

  const root = new THREE.Group();
  root.name = CITY_BLOCK_GROUP_NAME;

  /* ---- systems ---------------------------------------------------------- */

  const environment = createEnvironmentSystem({ layout, scene, seed: options.seed });
  const buildings = createBuildingsSystem({ layout, initialEra, seed: options.seed });
  const storefronts = createStorefrontSystem({ layout, era: initialEra });
  const advertising = createAdvertisingSystem(layout);
  const vehicles = createVehicleSystem({
    layout,
    seed: options.seed,
    vehicleCount: options.vehicleCount,
  });
  const pedestrians = createPedestrianSystem({
    layout,
    era: initialEra,
    seed: options.seed,
    figurePoolSize: options.figurePoolSize,
  });

  const definitions: readonly SystemDefinition[] = [
    {
      id: "environment",
      stage: "environment",
      system: environment,
      reportedEra: () => environment.activeEra,
    },
    { id: "buildings", stage: "buildings", system: buildings, reportedEra: () => buildings.era },
    {
      id: "storefronts",
      stage: "retail",
      system: storefronts,
      reportedEra: () => storefronts.era,
    },
    {
      id: "advertising",
      stage: "retail",
      system: advertising,
      reportedEra: () => dominantAdEra(advertising.placements, initialEra),
    },
    {
      id: "vehicles",
      stage: "street-life",
      system: vehicles,
      reportedEra: () => vehicles.activeEra,
    },
    {
      id: "pedestrians",
      stage: "street-life",
      system: pedestrians,
      reportedEra: () => pedestrians.stats().eraId,
    },
  ];

  for (const definition of definitions) {
    root.add(definition.system.group);
  }
  scene.add(root);

  /* ---- post-processing -------------------------------------------------- */

  const postfx = createCinematicPostFX({
    renderer: options.renderer,
    scene,
    camera,
    viewport: options.viewport,
    bloomScale: options.bloomScale,
    initialEra,
  });

  /* ---- transition driver ------------------------------------------------ */

  const entries: ComposedSystemEntry[] = definitions.map((definition) => {
    const state: AppliedState = { era: initialEra, blend: 1 };
    const system = definition.system;
    return {
      id: definition.id,
      stage: definition.stage,
      system,
      state,
      bridge: {
        applyEra(era: EraId, blend: number): void {
          state.era = era;
          state.blend = blend;
          system.applyEra(era, blend);
        },
      },
      context: createUpdateContext(initialEra),
    };
  });

  const sfxBridge = createSfxEraBridge(sfx, initialEra);
  const postfxState: AppliedState = { era: initialEra, blend: 1 };
  const sfxState: AppliedState = { era: initialEra, blend: 1 };
  const auxiliaries: readonly AuxiliaryBinding[] = [
    {
      id: "postfx",
      stage: "environment",
      reportedEra: () => postfx.toEra,
      state: postfxState,
      bridge: {
        applyEra(era: EraId, blend: number): void {
          postfxState.era = era;
          postfxState.blend = blend;
          postfx.applyEra(era, blend);
        },
      },
    },
    {
      id: "sfx",
      stage: "environment",
      reportedEra: () => sfxBridge.era,
      state: sfxState,
      bridge: {
        applyEra(era: EraId, blend: number): void {
          sfxState.era = era;
          sfxState.blend = blend;
          sfxBridge.applyEra(era, blend);
        },
      },
    },
  ];

  const transition = new EraTransitionDriver({ initialEra, durationMs: options.durationMs });

  // Registration order is stage order, so the driver's stage-major application
  // order matches the order the block reads in: atmosphere first, then
  // architecture, then the commercial layer, then street life.
  for (const entry of entries) {
    transition.register(entry.bridge, { stage: entry.stage, id: entry.id });
  }
  for (const binding of auxiliaries) {
    transition.register(binding.bridge, { stage: binding.stage, id: binding.id });
  }

  /* ---- navigation and picking ------------------------------------------- */

  const rig = createCameraRig({
    camera,
    layout,
    element: options.element ?? undefined,
    viewport: { width: options.viewport.width, height: options.viewport.height },
    initialPose: options.initialPose,
  });
  const focus = createFocusController({
    camera: rig,
    layout,
    element: options.element ?? undefined,
    era: initialEra,
  });

  const buildingLabels = new Map<string, FocusLabelOverride>();
  const pedestrianLabels = new Map<string, Partial<Record<EraId, FocusLabelOverride>>>();

  /** One resolver for every system whose objects carry descriptor `userData`. */
  const resolvePickable: FocusTargetResolver = (object, index) => {
    const buildingOwner = findOwningNode(object, "buildingId");
    if (buildingOwner) {
      return buildingTarget(buildingOwner);
    }
    const vehicleOwner = findOwningNode(object, "modelStyle");
    if (vehicleOwner) {
      return vehicleTarget(vehicleOwner);
    }
    const pedestrianOwner = findOwningNode(object, "pedestrianId");
    if (pedestrianOwner) {
      return pedestrianTarget(pedestrianOwner);
    }
    const storefrontOwner = findOwningNode(object, "storefrontId");
    if (storefrontOwner) {
      return storefrontTarget(storefrontOwner);
    }
    return defaultFocusTargetResolver(object, index);
  };

  /**
   * Re-registers every pickable that is visible right now.
   *
   * Systems swap or dispose geometry while they morph, so the registry is
   * rebuilt whenever a choreography stage closes and when a leg lands - never
   * per frame. Descriptors are cached across rebuilds because era plans and
   * pedestrian appearances are deterministic.
   */
  function refreshPickables(): void {
    focus.clearRegistry();
    for (const entry of entries) {
      focus.registerSystem(entry.system, resolvePickable);
    }
    // Ads and street furniture anchor their group without descriptor data, so
    // they are registered explicitly from the placement/prop records.
    for (const placement of advertising.placements) {
      focus.register(advertisingTarget(placement), placement.group);
    }
    for (const prop of environment.props) {
      focus.register(streetPropTarget(prop), prop.group);
    }
  }

  function buildingTarget(owner: THREE.Object3D): FocusTarget {
    const data = owner.userData as Record<string, unknown>;
    const buildingId = String(data.buildingId);
    const lotId = typeof data.lotId === "string" ? data.lotId : buildingId;
    const generationEra = isEraId(data.eraId) ? data.eraId : currentEra;
    const own = buildingLabel(generationEra, lotId);
    const eraLabels: Partial<Record<EraId, FocusLabelOverride>> = {};
    for (const era of ERAS) {
      const label = buildingLabel(era.id, lotId);
      if (label) {
        eraLabels[era.id] = label;
      }
    }
    const record = findBuildingRecord(generationEra, lotId);
    return {
      id: buildingId,
      kind: "building",
      title: own?.title ?? buildingId,
      description: own?.description ?? "",
      facts: own?.facts ?? {},
      eraLabels,
      focusPoint: record
        ? { x: record.placement.center.x, y: record.height * 0.5, z: record.placement.center.z }
        : undefined,
      radius: record ? Math.max(3, record.height * 0.6) : undefined,
    };
  }

  function vehicleTarget(owner: THREE.Object3D): FocusTarget {
    const data = owner.userData as Record<string, unknown>;
    const eraId = isEraId(data.era) ? data.era : currentEra;
    const kind = typeof data.vehicleClass === "string" ? data.vehicleClass : "vehicle";
    const actor = vehicles.vehicles.find((candidate) => candidate.group === owner);
    const eraLabels: Partial<Record<EraId, FocusLabelOverride>> = {};
    for (const era of ERAS) {
      eraLabels[era.id] = {
        title: `${era.label} ${kind}`,
        description: `${era.title} traffic: ${era.vehicles.mix.map((share) => share.kind).join(", ")}.`,
        facts: {
          Era: era.label,
          Fleet: era.vehicles.mix.map((share) => share.kind).join(", "),
          "Speed limit": `${Math.round(era.vehicles.speedLimit * 3.6)} km/h`,
          Headlights: era.vehicles.headlight,
        },
      };
    }
    const lane = actor?.laneId ?? (typeof data.laneId === "string" ? data.laneId : "unknown lane");
    return {
      id: `vehicle:${actor?.id ?? owner.name}`,
      kind: "vehicle",
      title: `${getEraConfig(eraId).label} ${kind}`,
      description: `Traffic on ${lane}.`,
      facts: {
        Era: getEraConfig(eraId).label,
        Lane: lane,
        Speed: actor ? `${(actor.speed * 3.6).toFixed(1)} km/h` : "n/a",
        Laps: actor?.laps ?? 0,
      },
      eraLabels,
      radius: 3,
    };
  }

  function pedestrianTarget(owner: THREE.Object3D): FocusTarget {
    const data = owner.userData as Record<string, unknown>;
    const id = String(data.pedestrianId);
    const figure = pedestrianFigure(id);
    if (!figure) {
      return { id, kind: "pedestrian", title: "Pedestrian" };
    }
    const look = figure.describe();
    return {
      id: figure.id,
      kind: "pedestrian",
      title: `${figure.ageBracket} pedestrian`,
      description: `${look.fabricLabel} ${look.silhouette.replace(/-/g, " ")}`,
      facts: {
        Era: figure.appearance.eraId,
        Age: figure.ageBracket,
        Outfit: look.outfitId,
        Fabric: look.fabricLabel,
        Hair: look.hairLabel,
        Route: figure.routeId,
      },
      eraLabels: pedestrianEraLabels(figure),
      radius: 1.5,
    };
  }

  function storefrontTarget(owner: THREE.Object3D): FocusTarget {
    const data = owner.userData as Record<string, unknown>;
    const storefrontId = String(data.storefrontId);
    const unit = storefronts.units.find((candidate) => candidate.id === storefrontId);
    const plan = unit?.plan ?? null;
    const eraLabels: Partial<Record<EraId, FocusLabelOverride>> = {};
    if (unit) {
      for (const era of ERAS) {
        const eraPlan = unit.planFor(era.id);
        eraLabels[era.id] = {
          title: `${eraPlan.programme.brand} · ${eraPlan.programme.label}`,
          description: eraPlan.programme.tagline,
          facts: storefrontFacts(eraPlan, era.id),
        };
      }
    }
    return {
      id: storefrontId,
      kind: "signage",
      title: plan ? `${plan.programme.brand} · ${plan.programme.label}` : storefrontId,
      description: plan?.programme.tagline ?? "",
      facts: plan ? storefrontFacts(plan, plan.era) : {},
      eraLabels,
      radius: plan ? Math.max(3, plan.facade.width * 0.4) : undefined,
    };
  }

  function advertisingTarget(placement: AdvertisingPlacement): FocusTarget {
    return {
      id: `ad:${placement.slot.id}`,
      kind: "signage",
      title: `${placement.format.replace(/-/g, " ")} on the ${placement.slot.streetSide} sidewalk`,
      description: `Slot-anchored advertising placement ${placement.slot.id}.`,
      facts: {
        Slot: placement.slot.id,
        Format: placement.format,
        Medium: placement.mediaTo,
        Frontage: `${placement.slot.streetSide} · ${placement.slot.sidewalkEdge}`,
        Animated: placement.animated ? "yes" : "no",
      },
      radius: 3,
    };
  }

  function streetPropTarget(prop: StreetPropInstance): FocusTarget {
    return {
      id: `prop:${prop.slot.id}`,
      kind: "prop",
      title: `${prop.kind} on the ${prop.slot.streetSide} sidewalk`,
      description: `Street furniture anchored to layout slot ${prop.slot.id}.`,
      facts: {
        Slot: prop.slot.id,
        Kind: prop.kind,
        Side: prop.slot.streetSide,
        Edge: prop.slot.sidewalkEdge,
        Primary: prop.primary ? "yes" : "no",
      },
      radius: 1.5,
    };
  }

  /** Cached era label of one lot's building, so registry rebuilds stay cheap. */
  function buildingLabel(era: EraId, lotId: string): FocusLabelOverride | null {
    const key = `${era}:${lotId}`;
    const cached = buildingLabels.get(key);
    if (cached) {
      return cached;
    }
    const record = findBuildingRecord(era, lotId);
    if (!record) {
      return null;
    }
    const config = getEraConfig(era);
    const label: FocusLabelOverride = {
      title: `${record.id} · ${config.buildings.style}`,
      description: `${config.title}: ${config.buildings.roofStyle.replace(/-/g, " ")} over ${config.buildings.style.replace(/-/g, " ")}.`,
      facts: buildingFacts(record, era),
    };
    buildingLabels.set(key, label);
    return label;
  }

  /** Cached per-era wardrobe labels of one pedestrian. */
  function pedestrianEraLabels(
    figure: PedestrianFigure,
  ): Partial<Record<EraId, FocusLabelOverride>> {
    const cached = pedestrianLabels.get(figure.id);
    if (cached) {
      return cached;
    }
    const labels: Partial<Record<EraId, FocusLabelOverride>> = {};
    for (const era of ERAS) {
      const look = describeLook(figure.appearanceFor(era.id));
      labels[era.id] = {
        title: `${era.label} ${figure.ageBracket}`,
        description: `${look.silhouette.replace(/-/g, " ")} in ${look.fabricLabel}.`,
        facts: {
          Era: era.label,
          Outfit: look.outfitId,
          Fabric: look.fabricLabel,
          Hair: look.hairLabel,
        },
      };
    }
    pedestrianLabels.set(figure.id, labels);
    return labels;
  }

  function findBuildingRecord(era: EraId, lotId: string): BuildingRecord | null {
    return buildings.describe(era).find((record) => record.lotId === lotId) ?? null;
  }

  function pedestrianFigure(id: string): PedestrianFigure | null {
    return pedestrians.figures.find((figure) => figure.id === id) ?? null;
  }

  /* ---- era state -------------------------------------------------------- */

  const listeners = new Set<ChronoCitySceneListener>();
  let currentEra: EraId = initialEra;
  let legFrom: EraId = initialEra;
  let elapsed = 0;
  let lastDelta = 1 / 60;
  let disposed = false;

  const unsubscribeTransition = transition.subscribe((event) => {
    if (event.type === "stage") {
      // Stage closures are exactly when systems swap or dispose geometry.
      if (event.phase === "end") {
        refreshPickables();
      }
      return;
    }
    if (event.type === "start") {
      currentEra = event.to;
      legFrom = event.from;
      focus.setEra(event.to);
      sfx.transitionStinger();
      emit({
        type: "transition-start",
        era: event.to,
        from: event.from,
        interrupted: false,
        info: null,
      });
      return;
    }
    currentEra = event.settledEra;
    legFrom = event.settledEra;
    focus.setEra(event.settledEra);
    if (!event.interrupted) {
      sfx.chime();
    }
    refreshPickables();
    emit({
      type: "transition-complete",
      era: event.settledEra,
      from: event.from,
      interrupted: event.interrupted,
      info: null,
    });
  });

  const unsubscribeFocus = focus.on("focus", (event) => {
    emit({
      type: "focus",
      era: event.info.era,
      from: event.info.era,
      interrupted: false,
      info: event.info,
    });
  });
  const unsubscribeFocusCleared = focus.on("focus-cleared", (event) => {
    emit({ type: "focus-cleared", era: event.era, from: event.era, interrupted: false, info: null });
  });

  refreshPickables();

  function emit(event: ChronoCitySceneEvent): void {
    for (const listener of [...listeners]) {
      listener(event);
    }
  }

  /* ---- frame ------------------------------------------------------------ */

  function update(delta: number): void {
    if (disposed) {
      return;
    }
    const step = Number.isFinite(delta) && delta > 0 ? delta : 0;
    elapsed += step;
    lastDelta = step;

    // The driver morphs every system (stage windows, interruption, easing) ...
    transition.update(step);

    // ... and every system then advances its own animation with the exact pair
    // the driver just applied, so morph state and per-frame state never drift.
    for (const entry of entries) {
      entry.system.update(
        publishContext(entry.context, entry.state.era, legFrom, entry.state.blend, step, elapsed),
      );
    }

    // Camera pose survives era changes by construction: the rig only integrates
    // the user's own navigation input here.
    rig.update(step);
  }

  function render(delta: number = lastDelta): void {
    if (disposed) {
      return;
    }
    postfx.render(delta);
  }

  /* ---- public handle ---------------------------------------------------- */

  return {
    root,
    layout,
    get era() {
      return currentEra;
    },
    get elapsed() {
      return elapsed;
    },
    environment,
    buildings,
    storefronts,
    advertising,
    vehicles,
    pedestrians,
    postfx,
    transition,
    camera: rig,
    focus,
    sfx,
    update,
    render,
    resize(next: PostFXViewport) {
      postfx.resize(next);
      rig.setViewport(next.width, next.height);
    },
    setEra(era: EraId) {
      if (disposed) {
        return;
      }
      transition.transitionTo(era);
    },
    settle() {
      transition.settle();
    },
    eraReport(): ChronoCityEraReport {
      const report: Partial<Record<ComposedSystemId, EraId>> = {};
      for (const definition of definitions) {
        report[definition.id] = definition.reportedEra();
      }
      for (const binding of auxiliaries) {
        report[binding.id] = binding.reportedEra();
      }
      return report as ChronoCityEraReport;
    },
    systemStates(): readonly ChronoCitySystemState[] {
      const states: ChronoCitySystemState[] = [];
      for (const entry of entries) {
        states.push({ id: entry.id, era: entry.state.era, blend: entry.state.blend });
      }
      for (const binding of auxiliaries) {
        states.push({ id: binding.id, era: binding.state.era, blend: binding.state.blend });
      }
      return states;
    },
    subscribe(listener: ChronoCitySceneListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribeTransition();
      unsubscribeFocus();
      unsubscribeFocusCleared();
      listeners.clear();
      // The driver goes first so no further `applyEra` reaches a system whose
      // resources are already released.
      transition.dispose();
      focus.dispose();
      rig.dispose();
      advertising.dispose?.();
      vehicles.dispose();
      storefronts.dispose();
      pedestrians.dispose();
      buildings.dispose();
      environment.dispose();
      postfx.dispose();
      root.removeFromParent();
      root.clear();
      if (ownsSfx) {
        sfx.dispose();
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* UI layer                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Mounts the timeline and the HUD and wires them to a composed scene.
 *
 * The timeline's year changes call {@link ChronoCityScene.setEra} - the single
 * entry point into the transition driver - the HUD's sound control drives the
 * SFX engine's mute, the HUD's inspection card is filled from focus events, and
 * the engine is gesture-gated so audio only starts on a real interaction.
 */
export function mountChronoCityUi(scene: ChronoCityScene, roots: ChronoCityUiRoots): ChronoCityUi {
  const timeline = createTimeline({
    container: roots.timeline,
    initialEra: scene.era,
    onYearChange: (event) => {
      scene.setEra(event.era);
    },
  });

  const hud = createHud({
    container: roots.hud,
    initialEra: scene.era,
    muted: scene.sfx.state.muted,
    onMuteToggle: (event) => {
      scene.sfx.setMuted(event.muted);
    },
    onInfoCardDismiss: () => {
      scene.focus.clearFocus("api");
    },
  });

  const unsubscribe = scene.subscribe((event) => {
    if (event.type === "focus") {
      if (event.info) {
        hud.showInfoCard(infoCardContent(event.info));
      }
      return;
    }
    if (event.type === "focus-cleared") {
      hud.hideInfoCard();
      return;
    }
    // Any era change updates the readout immediately, so scrubbing the slider
    // reports the year the user picked while the block is still morphing.
    hud.setEra(event.era);
  });

  // Audio is hard gesture-gated: bind once, and the engine detaches itself as
  // soon as a real interaction resumed its clock.
  const gestureTarget = roots.timeline.ownerDocument.defaultView;
  const detachGesture = gestureTarget ? scene.sfx.attachGestureStart(gestureTarget) : () => {};

  let disposed = false;
  return {
    timeline,
    hud,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      detachGesture();
      unsubscribe();
      timeline.dispose();
      hud.dispose();
    },
  };
}

/** Builds the HUD inspection card from a focus payload. */
export function infoCardContent(info: FocusInfo): InfoCardContent {
  const era = getEraConfig(info.era);
  const rows = Object.entries(info.facts).map(([label, value]) => ({
    label,
    value: String(value),
  }));
  return {
    id: info.id,
    title: info.title,
    subtitle: `${era.label} · ${era.title} · ${info.kind}`,
    rows,
    accent: era.palette.uiAccent,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Allocates the reused per-frame context for one system. */
function createUpdateContext(era: EraId): MutableEraUpdateContext {
  const weights = {} as Record<EraId, number>;
  for (const id of ERA_IDS) {
    weights[id] = 0;
  }
  weights[era] = 1;
  return { era, from: era, blend: 1, weights, delta: 0, elapsed: 0 };
}

/**
 * Writes one frame's context into a reused record and returns it as the shared
 * read-only contract.
 *
 * Keeping one record per system and mutating it is what makes the steady-state
 * frame allocation-free; `from` follows the driver's own semantics (`blend` is
 * "how much of `era`", and a fully applied system is its own `from`).
 */
function publishContext(
  context: MutableEraUpdateContext,
  era: EraId,
  legFrom: EraId,
  rawBlend: number,
  delta: number,
  elapsed: number,
): EraUpdateContext {
  const blend = clampBlend(rawBlend);
  context.era = era;
  context.from = blend < 1 ? legFrom : era;
  context.blend = blend;
  writeWeights(context.weights, context.from, era, blend);
  context.delta = delta;
  context.elapsed = elapsed;
  return context;
}

/**
 * Writes `resolveEraWeights`-equivalent weights into a reusable record.
 *
 * Identical semantics to the shared helper (the weights always sum to 1 and
 * `from === to` means fully that era), but it mutates the caller's record so the
 * frame path never allocates.
 */
function writeWeights(
  weights: Record<EraId, number>,
  from: EraId,
  to: EraId,
  blend: number,
): void {
  for (const id of ERA_IDS) {
    weights[id] = 0;
  }
  if (from === to) {
    weights[from] = 1;
    return;
  }
  const progress = clampBlend(blend);
  weights[from] = 1 - progress;
  weights[to] = progress;
}

/**
 * `EraAware` bridge that re-voices the SFX engine for the active timeline stop.
 *
 * The engine's own API is era-neutral (`setReverb`), so this bridge is what
 * makes audio a first-class participant in the choreography: it joins the
 * environment stage and morphs the street reverb between the two stops.
 */
interface SfxEraBridge extends EraAware {
  /** Era the bridge has been driven to. */
  readonly era: EraId;
}

function createSfxEraBridge(sfx: SfxEngine, initialEra: EraId): SfxEraBridge {
  let era: EraId = initialEra;
  let previous: EraId = initialEra;
  return {
    get era() {
      return era;
    },
    applyEra(next: EraId, blend: number): void {
      const progress = clampBlend(blend);
      if (next !== era) {
        previous = progress < 1 ? era : next;
        era = next;
      }
      const fromSeconds = getEraConfig(previous).sound.reverbSeconds;
      const toSeconds = getEraConfig(era).sound.reverbSeconds;
      sfx.setReverb(progress >= 1 ? toSeconds : fromSeconds + (toSeconds - fromSeconds) * progress);
    },
  };
}

/** Walks up from `object` and returns the outermost node carrying `key`. */
function findOwningNode(object: THREE.Object3D, key: string): THREE.Object3D | null {
  let owner: THREE.Object3D | null = null;
  let node: THREE.Object3D | null = object;
  while (node) {
    const value = (node.userData as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length > 0) {
      owner = node;
    }
    node = node.parent;
  }
  return owner;
}

function isEraId(value: unknown): value is EraId {
  return typeof value === "string" && (ERA_IDS as readonly string[]).includes(value);
}

/** Real per-era facts of one generated building. */
function buildingFacts(
  record: BuildingRecord,
  era: EraId,
): Readonly<Record<string, string | number>> {
  const descriptor = getEraConfig(era).buildings;
  return {
    Lot: record.lotId,
    Style: descriptor.style,
    Storeys: record.storeys,
    "Wall height": `${record.height.toFixed(1)} m`,
    "Window panes": record.windowPanes,
    "Rooftop sign": record.rooftopSign,
    "Ad medium": record.advertisingMedium ?? "none",
    "Storefront bays": record.storefrontBays,
  };
}

/** Real retail facts of one storefront plan. */
function storefrontFacts(
  plan: StorefrontPlan,
  era: EraId,
): Readonly<Record<string, string | number>> {
  const descriptor = getEraConfig(era).storefronts;
  return {
    Era: getEraConfig(era).label,
    Shop: plan.programme.label,
    Trading: plan.trading ? "open" : "boarded",
    Hours: `${descriptor.hours.openHour}:00 – ${descriptor.hours.closeHour}:00`,
    "Sign style": plan.signage.signStyle,
    "Price tier": descriptor.priceTier,
    Awning: plan.awning.kind,
  };
}

/**
 * Era the installed advertising creatives are showing.
 *
 * Advertising panels are named `ad-panel-<era>` by the advertising system, so
 * the dominant era is read straight off that system's own products - no era
 * table is duplicated here, and the answer is exact once a swap has completed.
 */
function dominantAdEra(placements: readonly AdvertisingPlacement[], fallback: EraId): EraId {
  let dominant = fallback;
  let best = -1;
  const totals = new Map<EraId, number>();
  for (const placement of placements) {
    placement.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.name.startsWith(AD_PANEL_PREFIX)) {
        return;
      }
      const era = object.name.slice(AD_PANEL_PREFIX.length);
      if (!isEraId(era)) {
        return;
      }
      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      const opacity =
        material && "opacity" in material && typeof material.opacity === "number"
          ? material.opacity
          : 1;
      const weight = object.visible ? opacity : 0;
      totals.set(era, (totals.get(era) ?? 0) + weight);
    });
  }
  for (const [era, weight] of totals) {
    if (weight > best) {
      best = weight;
      dominant = era;
    }
  }
  return dominant;
}
