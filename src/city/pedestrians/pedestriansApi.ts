/**
 * Chrono City — pedestrian API (the composition root for street life).
 *
 * `createPedestriansApi()` is the single entry point later tasks use: it builds
 * the crowd, wires it into every shared system, and hands back a frozen handle
 * exposing the crowd, the pool, the inspectables and the current wardrobe.
 *
 * Lifecycle (matching `scene-context` / `era-contracts` / `timeline-runtime`):
 *   create    → `createPedestriansApi({ scene, timeline, materials, registry,
 *               audio })` builds the material library (when not supplied), the
 *               figure pool, the crowd group and one scripted pedestrian each.
 *   consume   → the crowd ticks from `SceneContext.registerSystem`, morphs from
 *               `TimelineRuntime.registerBlendable`, reads its palettes from
 *               `eraDescriptors` (through `outfits`), registers per-year info
 *               cards on the `InspectionRegistry`, and drives footsteps plus
 *               crowd murmur through the `AudioDirector`.
 *   integrate → `integratePedestriansGlobal()` publishes the live handle on
 *               `window.__chronoCityPedestrians` for overlays and Playwright.
 *
 * The API owns nothing global unless asked: dispose it and the block is clean
 * again (tick unregistered, blendable removed, inspectables deregistered,
 * emitters removed, figures disposed, group detached).
 */

import * as THREE from 'three';

import type { EraId, EraTransitionOptions } from '../../core/eraContracts';
import type { FrameInfo, SceneContext, SystemRegistration } from '../../core/sceneContext';
import { createMaterialLibraryFromScene, type MaterialLibrary } from '../../materials/materialLibrary';
import type {
  InspectableDefinition,
  InspectableRecord,
  InspectionRegistry,
} from '../../interaction/inspectionRegistry';
import type { EraBlendableRegistration, TimelineRuntime } from '../../era/timelineRuntime';
import {
  CROWD_GROUP_NAME,
  CROWD_MURMUR_CUE,
  CROWD_SYSTEM_ID,
  CROWD_SYSTEM_ORDER,
  CrowdSystem,
  DEFAULT_CROWD_COUNT,
  DEFAULT_MURMUR_EMITTERS,
  createCrowdSystem,
  type CrowdSystemOptions,
  type PedestrianAudioHost,
  type PedestrianSnapshot,
} from './crowdSystem';
import type { FigurePool } from './figureFactory';
import { OUTFIT_COPY_BY_ERA, outfitsSummaryFor } from './outfits';

export const PEDESTRIANS_API_VERSION = 1;

/** Global key the live pedestrian handle is published on. */
export const PEDESTRIANS_GLOBAL_KEY = '__chronoCityPedestrians';

/** Inspectable id of the crowd itself. */
export const CROWD_INSPECTABLE_ID = 'street-life-crowd';

/** Inspectable id prefix for individual pedestrians. */
export const PEDESTRIAN_INSPECTABLE_PREFIX = 'pedestrian';

/** Id the crowd registers as a `TimelineRuntime` blendable. */
export const PEDESTRIANS_BLENDABLE_ID = 'chrono-pedestrians';

export interface PedestriansApiOptions {
  /** Shared scene context (required): tick registry, scene graph and RNG. */
  readonly scene: SceneContext;
  /** Era timeline; when supplied the crowd registers as a blendable. */
  readonly timeline?: TimelineRuntime | null;
  /** Shared material library; built from the scene RNG when omitted. */
  readonly materials?: MaterialLibrary | null;
  /** Inspection registry; per-year pedestrian info cards are registered on it. */
  readonly registry?: InspectionRegistry | null;
  /** Audio director (or an equivalent subset); SFX stay silent without one. */
  readonly audio?: PedestrianAudioHost | null;
  /** Group the crowd is parented to. Defaults to `scene.scene`. */
  readonly parent?: THREE.Object3D | null;
  /** Number of pedestrians. Defaults to `DEFAULT_CROWD_COUNT`. */
  readonly count?: number;
  /** Cap on simultaneous articulated figures. */
  readonly maxFigures?: number;
  readonly minSeparation?: number;
  /** Continuous murmur emitters riding with pedestrians. */
  readonly murmurEmitters?: number;
  /** Register per-pedestrian inspectables. Defaults to `true`. */
  readonly registerInspectables?: boolean;
  /** Register the crowd tick on the scene. Defaults to `true`. */
  readonly autoRegister?: boolean;
  /** Era the crowd starts in. Defaults to the timeline's, then `DEFAULT_ERA`. */
  readonly initialEra?: EraId;
}

/**
 * The live pedestrian handle. Everything a HUD, harness or downstream system
 * needs: the visible group, the crowd, the pool, the era wardrobe and the
 * inspectables it registered.
 */
export interface PedestriansApi {
  readonly version: number;
  readonly group: THREE.Group;
  readonly crowd: CrowdSystem;
  readonly pool: FigurePool;
  readonly materials: MaterialLibrary;
  readonly scene: SceneContext;
  readonly timeline: TimelineRuntime | null;
  readonly registry: InspectionRegistry | null;
  /** `null` before audio is attached. */
  readonly audio: PedestrianAudioHost | null;
  /** Tick registration (or `null` when the crowd runs unregistered). */
  readonly registration: SystemRegistration | null;
  /** Timeline registration (or `null` when no timeline was supplied). */
  readonly blendable: EraBlendableRegistration | null;
  /** Inspectable ids registered by this API. */
  readonly inspectableIds: readonly string[];
  /** Era the crowd is heading to. */
  readonly era: EraId;
  /** Era the wardrobe currently reads as (midpoint-swapped during a tween). */
  readonly outfitEra: EraId;
  /** Eased wardrobe tween progress in `[0, 1]`. */
  readonly outfitBlend: number;
  /** Immutable per-pedestrian snapshots. */
  readonly snapshots: readonly PedestrianSnapshot[];
  /** Systems tick the crowd; exposed so tests can drive frames directly. */
  tick(context: SceneContext, frame: FrameInfo): void;
  /** Moves the block to a year through the timeline (or directly when absent). */
  selectEra(era: EraId, options?: EraTransitionOptions): EraId;
  /** Attaches (or swaps) the audio host. */
  attachAudio(audio: PedestrianAudioHost | null): void;
  /** Builds the inspectable definitions this API registers. */
  createInspectableDefinitions(): readonly InspectableDefinition[];
  /** Releases everything this API created or registered. */
  dispose(): void;
}

/**
 * Builds the whole pedestrian subsystem: materials, pool, crowd, inspectables,
 * timeline blendable and pedestrian audio.
 */
export function createPedestriansApi(options: PedestriansApiOptions): PedestriansApi {
  if (!options || !options.scene) {
    throw new TypeError('createPedestriansApi() needs a SceneContext.');
  }

  const scene = options.scene;
  const timeline = options.timeline ?? null;
  const registry = options.registry ?? null;
  const materials = options.materials ?? createMaterialLibraryFromScene(scene);

  const crowdOptions: CrowdSystemOptions = {
    scene,
    library: materials,
    parent: options.parent ?? scene.scene,
    count: options.count ?? DEFAULT_CROWD_COUNT,
    murmurEmitters: options.murmurEmitters ?? DEFAULT_MURMUR_EMITTERS,
    autoRegister: options.autoRegister ?? true,
    ...(options.maxFigures !== undefined ? { maxFigures: options.maxFigures } : {}),
    ...(options.minSeparation !== undefined ? { minSeparation: options.minSeparation } : {}),
    ...(options.audio ? { audio: options.audio } : {}),
    ...(options.initialEra ? { initialEra: options.initialEra } : {}),
  };

  const crowd = createCrowdSystem(crowdOptions);

  let blendable: EraBlendableRegistration | null = null;
  if (timeline) {
    blendable = timeline.registerBlendable(crowd, { id: PEDESTRIANS_BLENDABLE_ID });
  }

  const inspectableIds: string[] = [];
  const registerInspectables = options.registerInspectables ?? true;
  const definitions = registerInspectables ? buildInspectableDefinitions(crowd) : [];
  if (registry && registerInspectables) {
    const records: InspectableRecord[] = [];
    for (const definition of definitions) {
      if (registry.has(definition.id)) registry.deregister(definition.id);
      records.push(registry.register(definition));
    }
    for (const record of records) inspectableIds.push(record.id);
  }

  const api: PedestriansApi = {
    version: PEDESTRIANS_API_VERSION,
    group: crowd.group,
    crowd,
    pool: crowd.pool,
    materials,
    scene,
    timeline,
    registry,
    get audio(): PedestrianAudioHost | null {
      return crowd.audio;
    },
    registration: crowd.systemRegistration,
    blendable,
    inspectableIds: Object.freeze([...inspectableIds]),
    get era(): EraId {
      return crowd.era;
    },
    get outfitEra(): EraId {
      return crowd.outfitEra;
    },
    get outfitBlend(): number {
      return crowd.outfitBlend;
    },
    get snapshots(): readonly PedestrianSnapshot[] {
      return crowd.snapshots;
    },
    tick(context: SceneContext, frame: FrameInfo): void {
      crowd.tick(context, frame);
    },
    selectEra(era: EraId, transitionOptions: EraTransitionOptions = {}): EraId {
      if (timeline) return timeline.selectEra(era, transitionOptions);
      crowd.setEra(era, transitionOptions);
      return era;
    },
    attachAudio(audio: PedestrianAudioHost | null): void {
      if (audio) crowd.attachAudio(audio);
      else crowd.detachAudio();
    },
    createInspectableDefinitions(): readonly InspectableDefinition[] {
      return definitions;
    },
    dispose(): void {
      blendable?.dispose();
      blendable = null;
      if (registry) {
        for (const id of inspectableIds) registry.deregister(id);
      }
      inspectableIds.length = 0;
      crowd.dispose();
      removePedestriansGlobal();
    },
  };
  return api;
}

/** Aggregate mirroring `BlockLayout` / `EraContracts`, for namespace imports. */
export const PedestriansApi = Object.freeze({
  version: PEDESTRIANS_API_VERSION,
  systemId: CROWD_SYSTEM_ID,
  systemOrder: CROWD_SYSTEM_ORDER,
  groupName: CROWD_GROUP_NAME,
  globalKey: PEDESTRIANS_GLOBAL_KEY,
  murmurCue: CROWD_MURMUR_CUE,
  crowdInspectableId: CROWD_INSPECTABLE_ID,
  pedestrianInspectablePrefix: PEDESTRIAN_INSPECTABLE_PREFIX,
  create: createPedestriansApi,
  integrateGlobal: integratePedestriansGlobal,
  get: getPedestriansApi,
});

/* ------------------------------------------------------------------------- *
 * Inspectables
 * ------------------------------------------------------------------------- */

/**
 * One inspectable per pedestrian plus one for the crowd itself, each carrying
 * per-year copy that names what that era is wearing — which is also how the
 * crowd participates in the shared inspection feature.
 */
export function buildInspectableDefinitions(crowd: CrowdSystem): readonly InspectableDefinition[] {
  const definitions: InspectableDefinition[] = [
    {
      id: CROWD_INSPECTABLE_ID,
      object: crowd.group,
      label: 'Street life',
      copy: OUTFIT_COPY_BY_ERA,
      fallbackCopy: { name: 'Street life', blurb: outfitsSummaryFor(crowd.era) },
      data: { role: 'crowd', systemId: CROWD_SYSTEM_ID, pedestrianCount: crowd.count },
    },
  ];

  for (const snapshot of crowd.snapshots) {
    definitions.push({
      id: `${PEDESTRIAN_INSPECTABLE_PREFIX}-${snapshot.index}`,
      object: crowd.pedestrianObject(snapshot.id) ?? crowd.group,
      label: `Pedestrian ${snapshot.index + 1}`,
      copy: OUTFIT_COPY_BY_ERA,
      fallbackCopy: { name: 'Pedestrian', blurb: outfitsSummaryFor(crowd.era) },
      data: { role: 'pedestrian', pedestrianId: snapshot.id, index: snapshot.index },
    });
  }

  return Object.freeze(definitions);
}

/* ------------------------------------------------------------------------- *
 * Global integration
 * ------------------------------------------------------------------------- */

declare global {
  interface Window {
    __chronoCityPedestrians?: PedestriansApi;
  }
}

/**
 * Publishes the live pedestrian handle on `window` and announces it, so overlays
 * and browser harnesses can drive the real crowd instead of re-creating one.
 */
export function integratePedestriansGlobal(
  api: PedestriansApi,
  key: string = PEDESTRIANS_GLOBAL_KEY,
): PedestriansApi {
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>)[key] = api;
    if (typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('chrono-city:pedestrians-ready', { detail: api }));
    }
  }
  return api;
}

/** Removes the published handle (called by `dispose()`). */
export function removePedestriansGlobal(key: string = PEDESTRIANS_GLOBAL_KEY): void {
  if (typeof window !== 'undefined') {
    delete (window as unknown as Record<string, unknown>)[key];
  }
}

/** The live pedestrian handle, or `null` before it is published. */
export function getPedestriansApi(key: string = PEDESTRIANS_GLOBAL_KEY): PedestriansApi | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as Record<string, unknown>)[key];
  return (candidate as PedestriansApi | undefined) ?? null;
}
