/**
 * Chrono City — environment API (the composition root for street + sky).
 *
 * The task's delivered export: one stable handle that owns the whole
 * environment of the block — the street surface, the era street dressing and the
 * sky / fog / lighting rig with its particle beds — and hides the three
 * subsystems behind a headless-testable lifecycle.
 *
 * Lifecycle (matching `scene-context` / `era-contracts` / `timeline-runtime`):
 *   create    → `createEnvironmentApi({ context, timeline?, materials?, registry?,
 *               parent?, initialEra? })` builds the three subsystems under one
 *               root, registers the notable fixtures and the per-frame tick, and
 *               registers itself as an `EraBlendable`.
 *   consume   → `consume({ timeline?, registry? })` attaches the shared runtime
 *               handles when they are not known at construction time; the
 *               `TimelineRuntime` drives every era swap and the
 *               `InspectionRegistry` receives the per-year street fixtures.
 *   integrate → `integrate()` publishes the handle on
 *               `window.__chronoCityEnvironment` for overlays and Playwright.
 *
 * Era response is deliberately single-source: `updateEraTransition(progress)`
 * resolves one era-blended `EraTimelineDescriptor` per frame
 * (`resolveEraBlend`) and pushes it into the surface colours, the dressing
 * crossfade, the sky shader, fog, the lighting rig and the render exposure. The
 * post-processing/colour-grading task reads the result through `gradeState()`
 * and `snapshot()` instead of touching a light.
 *
 * Wiring (the integration owner's half):
 * ```ts
 * const environment = createEnvironmentApi({ context, timeline, registry });
 * environment.integrate(); // publishes `window.__chronoCityEnvironment`
 * ```
 */

import * as THREE from 'three';

import {
  DEFAULT_ERA,
  assertEraId,
  clamp01,
  type EraBlendable,
  type EraId,
  type EraTransitionInfo,
  type EraTransitionOptions,
} from '../core/eraContracts';
import type { FrameInfo, SceneContext, SystemRegistration } from '../core/sceneContext';
import { resolveEraBlend } from '../era/eraDescriptors';
import type { EraBlendableRegistration, TimelineRuntime } from '../era/timelineRuntime';
import type { InspectionRegistry } from '../interaction/inspectionRegistry';
import {
  createMaterialLibraryFromScene,
  type MaterialLibrary,
} from '../materials/materialLibrary';
import {
  Streetscape,
  createStreetscape,
  type StreetscapeSnapshot,
} from './streetscape';
import {
  DRESSING_INSPECTABLE_PREFIX,
  StreetDressing,
  createStreetDressing,
  dressingFixtureName,
  type StreetDressingSnapshot,
} from './streetDressing';
import {
  SkyLightingRig,
  createSkyLighting,
  type EnvironmentGradeState,
  type ParticleBedSnapshot,
  type SkyLightingSnapshot,
} from './skyAndLighting';

export const ENVIRONMENT_API_VERSION = 1;

/** Global key the live environment handle is published on. */
export const ENVIRONMENT_GLOBAL_KEY = '__chronoCityEnvironment';

/** Blendable id the api registers with the timeline. */
export const ENVIRONMENT_BLENDABLE_ID = 'chrono-environment';

/** Tick-system id the api registers on the scene context. */
export const ENVIRONMENT_SYSTEM_ID = 'environment';

/**
 * Tick order: after the timeline (`-1000`, so era progress is fresh) and after
 * the buildings (`-500`), but before gameplay systems.
 */
export const ENVIRONMENT_SYSTEM_ORDER = -420;

/** Name of the single root every environment subsystem hangs from. */
export const ENVIRONMENT_ROOT_NAME = 'chrono-environment';

/** Runtime handles the environment consumes after `create()`. */
export interface EnvironmentDependencies {
  /** Timeline that drives the era swaps. `null` detaches. */
  readonly timeline?: TimelineRuntime | null;
  /** Registry that receives the notable street fixtures. */
  readonly registry?: InspectionRegistry | null;
}

export interface EnvironmentApiOptions {
  /** Shared scene context (required): scene graph, camera, renderer, RNG, ticks. */
  readonly context: SceneContext;
  /** Era timeline; when supplied the api registers as a blendable. */
  readonly timeline?: TimelineRuntime | null;
  /** Shared material library; built from the scene RNG when omitted. */
  readonly materials?: MaterialLibrary | null;
  /** Inspection registry; the notable street fixtures register on it. */
  readonly registry?: InspectionRegistry | null;
  /** Object the environment root is parented to. Defaults to `context.scene`. */
  readonly parent?: THREE.Object3D | null;
  /** Era the environment starts in. Defaults to the timeline's, then `2025`. */
  readonly initialEra?: EraId;
  /** Register the per-frame environment tick. Defaults to `true`. */
  readonly animate?: boolean;
  /** Register notable fixtures. Defaults to `true` when a registry is present. */
  readonly registerFixtures?: boolean;
  /** Pre-built streetscape (tests reuse one); created when omitted. */
  readonly streetscape?: Streetscape | null;
  /** Pre-built dressing set (tests reuse one); created when omitted. */
  readonly dressing?: StreetDressing | null;
  /** Pre-built sky rig (tests reuse one); created when omitted. */
  readonly sky?: SkyLightingRig | null;
  readonly blendableId?: string;
  readonly systemId?: string;
  readonly systemOrder?: number;
}

/** Resolved particle budget, for HUD output and the 60 fps guard. */
export interface ParticleBudgetReport {
  readonly capacity: number;
  readonly active: number;
  /** `active / capacity` in `[0, 1]`. */
  readonly share: number;
  readonly beds: readonly ParticleBedSnapshot[];
}

/** One notable fixture and the name it reads as in the current era. */
export interface EnvironmentFixtureReport {
  readonly id: string;
  readonly name: string;
}

/** Full, read-only state of the environment: sky, fog, exposure, street, dressing. */
export interface EnvironmentSnapshot {
  readonly version: number;
  readonly era: EraId;
  readonly from: EraId;
  readonly to: EraId;
  readonly progress: number;
  readonly transitioning: boolean;
  /* ---- convenience mirrors of the sky rig's grade inputs ---- */
  readonly exposure: number;
  readonly contrast: number;
  readonly fog: SkyLightingSnapshot['fog'];
  readonly sky: SkyLightingSnapshot['sky'];
  readonly lighting: SkyLightingSnapshot['lighting'];
  readonly grade: EnvironmentGradeState;
  /* ---- subsystem detail ---- */
  readonly streetscape: StreetscapeSnapshot;
  readonly dressing: StreetDressingSnapshot;
  readonly skyLighting: SkyLightingSnapshot;
  readonly particles: ParticleBudgetReport;
  readonly fixtures: readonly EnvironmentFixtureReport[];
  readonly registeredInspectables: number;
  readonly tickCount: number;
  readonly registered: boolean;
}

export class EnvironmentApi implements EraBlendable {
  readonly version = ENVIRONMENT_API_VERSION;

  /** Tick-system id; also the id the timeline blendable registers under. */
  readonly id: string;

  /** Root every environment subsystem is parented to. */
  readonly root: THREE.Group;

  readonly streetscape: Streetscape;
  readonly dressing: StreetDressing;
  readonly sky: SkyLightingRig;
  readonly materials: MaterialLibrary;
  readonly scene: SceneContext;
  readonly parent: THREE.Object3D;

  private readonly ownsLibrary: boolean;
  private readonly systemId: string;
  private readonly systemOrder: number;
  private readonly animate: boolean;
  private readonly createFixtures: boolean;
  private readonly registeredIds: string[] = [];

  private timelineState: TimelineRuntime | null;
  private registryState: InspectionRegistry | null;
  private blendableRegistration: EraBlendableRegistration | null = null;
  private systemRegistration: SystemRegistration | null = null;

  private fromEra: EraId;
  private toEra: EraId;
  private progressState = 1;
  private tickCountState = 0;
  private disposedState = false;

  constructor(options: EnvironmentApiOptions) {
    if (!options?.context) throw new TypeError('EnvironmentApi needs a SceneContext.');
    this.scene = options.context;
    this.materials = options.materials ?? createMaterialLibraryFromScene(options.context);
    this.ownsLibrary = options.materials === undefined || options.materials === null;
    this.timelineState = options.timeline ?? null;
    this.registryState = options.registry ?? null;
    this.parent = options.parent ?? options.context.scene;
    this.id = options.blendableId ?? ENVIRONMENT_BLENDABLE_ID;
    this.systemId = options.systemId ?? ENVIRONMENT_SYSTEM_ID;
    this.systemOrder = options.systemOrder ?? ENVIRONMENT_SYSTEM_ORDER;
    this.animate = options.animate ?? true;
    this.createFixtures = options.registerFixtures ?? true;

    this.root = new THREE.Group();
    this.root.name = ENVIRONMENT_ROOT_NAME;
    this.parent.add(this.root);

    const initial = assertEraId(
      options.initialEra ?? this.timelineState?.era ?? DEFAULT_ERA,
    );
    this.fromEra = initial;
    this.toEra = initial;

    this.streetscape = options.streetscape ?? createStreetscape({
      context: options.context,
      library: this.materials,
      parent: this.root,
      initialEra: initial,
    });
    this.dressing = options.dressing ?? createStreetDressing({
      context: options.context,
      library: this.materials,
      parent: this.root,
      initialEra: initial,
    });
    this.sky = options.sky ?? createSkyLighting({
      context: options.context,
      parent: this.root,
      initialEra: initial,
    });

    if (this.createFixtures && this.registryState) this.registerFixtures();

    if (this.timelineState) {
      this.blendableRegistration = this.timelineState.registerBlendable(this, { id: this.id });
    }

    if (this.animate) {
      this.systemRegistration = this.scene.registerSystem(this.systemId, this.tick, {
        order: this.systemOrder,
      });
    }
  }

  /* ---------------- era state ---------------- */

  /** Era the environment is heading to (the tween's target while it runs). */
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

  /** `true` while the per-frame environment tick is registered. */
  get isAnimated(): boolean {
    return this.systemRegistration !== null;
  }

  get blendableId(): string | null {
    return this.blendableRegistration?.id ?? null;
  }

  /** The timeline driving this api, or `null` before `consume()`. */
  get timeline(): TimelineRuntime | null {
    return this.timelineState;
  }

  /** The inspection registry fixtures register on, or `null`. */
  get registry(): InspectionRegistry | null {
    return this.registryState;
  }

  /** Inspectable ids this api registered. */
  inspectables(): readonly string[] {
    return Object.freeze([...this.registeredIds]);
  }

  /**
   * `EraBlendable`: called once when a transition starts. `{ immediate: true }`
   * snaps; otherwise the environment morphs from the era it currently shows,
   * with one era-blended descriptor applied per tween frame.
   */
  setEra(era: EraId, options: EraTransitionOptions = {}): void {
    this.assertUsable();
    const target = assertEraId(era);
    const durationMs = options.durationMs ?? 0;

    if (options.immediate === true || durationMs <= 0) {
      this.fromEra = target;
      this.toEra = target;
      this.progressState = 1;
      this.applyBlend(target, target, 1);
      return;
    }

    this.fromEra = this.toEra;
    this.toEra = target;
    this.progressState = 0;
    this.applyBlend(this.fromEra, this.toEra, 0);
  }

  /** `EraBlendable`: one call per frame while the timeline tween runs. */
  updateEraTransition(progress: number, transition: EraTransitionInfo): void {
    if (this.disposedState) return;
    const target = assertEraId(transition.to);
    const source = assertEraId(transition.from);
    const value = clamp01(progress);
    const complete = !transition.active || value >= 1;

    this.fromEra = complete ? target : source;
    this.toEra = target;
    this.progressState = complete ? 1 : value;
    this.applyBlend(this.fromEra, this.toEra, this.progressState);
  }

  /** Snaps the whole environment to an era without a tween. */
  applyEra(era: EraId): void {
    this.setEra(era, { immediate: true });
  }

  /* ---------------- lifecycle ---------------- */

  /**
   * Attaches the shared runtime handles not known at construction time. Safe to
   * call more than once: a timeline already registered is left alone.
   */
  consume(dependencies: EnvironmentDependencies = {}): this {
    this.assertUsable();

    if (dependencies.timeline !== undefined) {
      if (this.blendableRegistration) {
        this.blendableRegistration.dispose();
        this.blendableRegistration = null;
      }
      const timeline = dependencies.timeline;
      this.timelineState = timeline ?? null;
      if (timeline) {
        this.blendableRegistration = timeline.registerBlendable(this, { id: this.id });
      }
    }

    if (dependencies.registry !== undefined) {
      const next = dependencies.registry ?? null;
      if (next !== this.registryState) {
        this.deregisterFixtures();
        this.registryState = next;
        if (next && this.createFixtures) this.registerFixtures();
      }
    }

    return this;
  }

  /**
   * Publishes the live handle for overlays and browser harnesses. The root is
   * already in the scene graph; this makes the api discoverable and returns it.
   */
  integrate(): this {
    this.assertUsable();
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>)[ENVIRONMENT_GLOBAL_KEY] = this;
      if (typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('chrono-city:environment-ready', { detail: this }));
      }
    }
    return this;
  }

  /* ---------------- observation ---------------- */

  /** Resolved particle budget and per-bed state. */
  particleBudget(): ParticleBudgetReport {
    const sky = this.sky.snapshot();
    return Object.freeze({
      capacity: sky.particleCapacity,
      active: sky.particleActive,
      share: sky.particleBudgetShare,
      beds: sky.particles,
    });
  }

  /** Notable fixtures and the name each reads as in the current era. */
  fixtures(): readonly EnvironmentFixtureReport[] {
    const era = this.toEra;
    const reports: EnvironmentFixtureReport[] = [];
    for (const id of this.registeredIds) {
      const resolved = this.registryState?.resolve(id, era);
      const fallbackId = id.replace(DRESSING_INSPECTABLE_PREFIX, '');
      reports.push(
        Object.freeze({
          id,
          name: resolved?.name ?? dressingFixtureName(fallbackId, era) ?? id,
        }),
      );
    }
    return Object.freeze(reports);
  }

  /** Read-only grade inputs for the post-processing / colour-grading task. */
  gradeState(): EnvironmentGradeState {
    return this.sky.gradeState();
  }

  /** Everything a HUD, a test or the integration task needs to read at once. */
  snapshot(): EnvironmentSnapshot {
    const sky = this.sky.snapshot();
    return Object.freeze({
      version: ENVIRONMENT_API_VERSION,
      era: this.toEra,
      from: this.fromEra,
      to: this.toEra,
      progress: this.progressState,
      transitioning: this.fromEra !== this.toEra,
      exposure: sky.exposure,
      contrast: sky.contrast,
      fog: sky.fog,
      sky: sky.sky,
      lighting: sky.lighting,
      grade: this.gradeState(),
      streetscape: this.streetscape.snapshot(),
      dressing: this.dressing.snapshot(),
      skyLighting: sky,
      particles: this.particleBudget(),
      fixtures: this.fixtures(),
      registeredInspectables: this.registeredIds.length,
      tickCount: this.tickCountState,
      registered: this.systemRegistration !== null,
    });
  }

  /** Detaches from the timeline, registry and scene; releases every geometry. */
  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;

    this.deregisterFixtures();
    this.blendableRegistration?.dispose();
    this.blendableRegistration = null;
    this.systemRegistration?.dispose();
    this.systemRegistration = null;

    this.sky.dispose();
    this.dressing.dispose();
    this.streetscape.dispose();
    if (this.ownsLibrary) this.materials.dispose();

    this.root.removeFromParent();
    this.root.clear();

    if (typeof window !== 'undefined') {
      const global = window as unknown as Record<string, unknown>;
      if (global[ENVIRONMENT_GLOBAL_KEY] === this) delete global[ENVIRONMENT_GLOBAL_KEY];
    }
  }

  /* ---------------- internals ---------------- */

  /**
   * One render frame: the sky rig advances the particle beds and re-centres the
   * dome, and the environment counts its ticks so a probe can prove the tick is
   * live. Era response itself happens in `updateEraTransition`, which the
   * timeline runtime calls from the same shared tick loop.
   */
  private readonly tick = (_context: SceneContext, frame: FrameInfo): void => {
    this.tickCountState += 1;
    this.sky.tick(frame);
  };

  private applyBlend(from: EraId, to: EraId, progress: number): void {
    const descriptor = resolveEraBlend(from, to, progress);
    this.streetscape.applyBlend(from, to, progress, descriptor.palette);
    this.dressing.applyBlend(from, to, progress, descriptor.palette);
    this.sky.applyBlend(from, to, progress, descriptor);
  }

  private registerFixtures(): void {
    const registry = this.registryState;
    if (!registry) return;
    for (const definition of this.dressing.inspectableDefinitions()) {
      if (registry.has(definition.id)) continue;
      registry.register(definition);
      this.registeredIds.push(definition.id);
    }
  }

  private deregisterFixtures(): void {
    const registry = this.registryState;
    if (!registry) {
      this.registeredIds.length = 0;
      return;
    }
    for (const id of this.registeredIds.splice(0)) registry.deregister(id);
  }

  private assertUsable(): void {
    if (this.disposedState) {
      throw new Error(`EnvironmentApi "${this.id}" is disposed and can no longer be driven.`);
    }
  }
}

/* ------------------------------------------------------------------------- *
 * Factories
 * ------------------------------------------------------------------------- */

/**
 * Builds the block's environment.
 *
 * ```ts
 * const environment = createEnvironmentApi({ context, timeline, registry });
 * context.tick(0.1);                    // era swap + particle tick, per frame
 * environment.snapshot().sky.topColor;  // era-blended sky, fog and exposure
 * ```
 */
export function createEnvironmentApi(options: EnvironmentApiOptions): EnvironmentApi {
  return new EnvironmentApi(options);
}

/** Attaches runtime handles to an already-created api. */
export function consumeEnvironment(
  api: EnvironmentApi,
  dependencies: EnvironmentDependencies,
): EnvironmentApi {
  return api.consume(dependencies);
}

/** Publishes the api globally (the integration half of the lifecycle). */
export function integrateEnvironment(api: EnvironmentApi): EnvironmentApi {
  return api.integrate();
}

/** Disposes an api; a thin helper so call sites stay symmetric. */
export function detachEnvironment(api: EnvironmentApi | null | undefined): void {
  api?.dispose();
}

declare global {
  interface Window {
    __chronoCityEnvironment?: EnvironmentApi;
  }
}
