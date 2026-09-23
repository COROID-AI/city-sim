/**
 * Chrono City — traffic API.
 *
 * The task's delivered export: one small, stable surface that owns the traffic
 * system's lifecycle and hides the simulation, the factory and the mesh pool
 * behind a headless-testable handle.
 *
 * Lifecycle:
 *   create    → `createTrafficApi({ library?, audio?, registry?, fleetSize? })`
 *               builds the factory, the lane loop and the starting era's fleet.
 *   consume   → `consume({ timeline?, audio?, registry? })` takes the shared
 *               runtime handles: the `TimelineRuntime` drives the era swaps
 *               (this api registers itself as an `EraBlendable`), the
 *               `AudioDirector` receives positional engine loops and horns, and
 *               the `InspectionRegistry` receives the current notable vehicle.
 *   integrate → `integrate(context)` adds the vehicle group to the scene,
 *               registers the per-frame tick and publishes the handle on
 *               `globalThis.__chronoCityTraffic` for HUD and browser harnesses.
 *
 * `snapshot()` is the observation seam: JSON-safe, era-aware and complete enough
 * for a Playwright probe to assert the fleet, the lane geometry on the asphalt
 * ring, wheel rotation, stop/park behaviour and positional SFX.
 *
 * Wiring (the integration owner's half):
 * ```ts
 * const traffic = createTrafficApi({ library, initialEra: timeline.era });
 * traffic.consume({ timeline, audio: director, registry });
 * traffic.integrate(context); // scene + tick + `window.__chronoCityTraffic`
 * ```
 */

import * as THREE from 'three';

import {
  ERA_IDS,
  type EraBlendable,
  type EraId,
  type EraTransitionInfo,
  type EraTransitionOptions,
} from '../../core/eraContracts';
import type { FrameInfo, SceneContext, SystemRegistration } from '../../core/sceneContext';
import { createSeededRng, type RandomSource } from '../../core/sceneContext';
import type { EraBlendableRegistration, TimelineRuntime } from '../../era/timelineRuntime';
import type { AudioDirector } from '../../audio/audioDirector';
import type { InspectionRegistry } from '../../interaction/inspectionRegistry';
import {
  createMaterialLibrary,
  type MaterialLibrary,
} from '../../materials/materialLibrary';
import {
  DEFAULT_FLEET_SIZE,
  buildEraFleetPlan,
  createVehicleFactory,
  vehicleModel,
  type VehicleFactory,
  type VehicleModelSpec,
} from './vehicleFactory';
import {
  TRAFFIC_SYSTEM_ID,
  TRAFFIC_SYSTEM_ORDER,
  TrafficSystem,
  buildTrafficLanePath,
  type LanePath,
  type TrafficHornEvent,
  type TrafficSnapshot,
  type TrafficSystemOptions,
  type TrafficVehicle,
} from './trafficSystem';

export const TRAFFIC_API_VERSION = 1;

/** Global key the live traffic handle is published on. */
export const TRAFFIC_GLOBAL_KEY = '__chronoCityTraffic';

/** Blendable id the api registers with the timeline. */
export const TRAFFIC_BLENDABLE_ID = 'city-traffic';

/** Deterministic seed used when the caller supplies none. */
export const TRAFFIC_DEFAULT_SEED = 20250101;

/** Hot spots in one era, for HUDs and diagnostics. */
export interface TrafficFleetSummary {
  readonly era: EraId;
  readonly size: number;
  readonly models: readonly { readonly id: string; readonly count: number }[];
  readonly label: string;
}

/** Runtime handles a traffic api consumes after `create()`. */
export interface TrafficDependencies {
  /** Timeline that drives the era swaps. `null` detaches. */
  readonly timeline?: TimelineRuntime | null;
  /** Audio engine that receives the positional engine loops and horns. */
  readonly audio?: AudioDirector | null;
  /** Registry that receives the current notable vehicle. */
  readonly registry?: InspectionRegistry | null;
}

export interface TrafficApiOptions {
  /** Shared material library; one is created (and owned) when omitted. */
  readonly library?: MaterialLibrary | null;
  readonly context?: SceneContext | null;
  readonly timeline?: TimelineRuntime | null;
  readonly audio?: AudioDirector | null;
  readonly registry?: InspectionRegistry | null;
  /** Deterministic seed for traffic placement and fleet choice. */
  readonly seed?: number;
  readonly fleetSize?: number;
  readonly initialEra?: EraId;
  readonly parking?: boolean;
  readonly signals?: boolean;
  readonly maxParked?: number;
  readonly parkDwellMs?: readonly [number, number];
  /** Lane loop override; defaults to the `BlockLayout` derivation. */
  readonly lane?: LanePath;
  /** Group override; the api creates and owns one when omitted. */
  readonly group?: THREE.Group | null;
  /** Random source override (tests inject a fixed one). */
  readonly random?: RandomSource | null;
}

export interface TrafficIntegrateOptions {
  readonly context?: SceneContext | null;
  readonly systemId?: string;
  readonly order?: number;
  readonly globalKey?: string;
  /** Publish the handle on `globalThis` (default `true`). */
  readonly publish?: boolean;
}

function isSceneContext(value: unknown): value is SceneContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SceneContext).registerSystem === 'function' &&
    (value as SceneContext).scene instanceof THREE.Scene
  );
}

/**
 * The traffic api. Wraps one `TrafficSystem`, owns the material library when it
 * created it, and keeps the timeline, audio and inspection wiring in one place.
 */
export class TrafficApi implements EraBlendable {
  readonly version = TRAFFIC_API_VERSION;
  readonly system: TrafficSystem;
  readonly group: THREE.Group;
  readonly lane: LanePath;
  readonly factory: VehicleFactory;

  private readonly library: MaterialLibrary;
  private readonly ownsLibrary: boolean;
  private readonly seed: number;

  private context: SceneContext | null = null;
  private registration: SystemRegistration | null = null;
  private timeline: TimelineRuntime | null = null;
  private timelineRegistration: EraBlendableRegistration | null = null;
  private unsubscribe: (() => void) | null = null;
  private publishedKey: string | null = null;
  private eraState: EraId;
  private apiDisposed = false;

  constructor(options: TrafficApiOptions = {}) {
    this.seed = options.seed ?? TRAFFIC_DEFAULT_SEED;
    this.ownsLibrary = !options.library;
    this.library =
      options.library ??
      createMaterialLibrary({ random: options.random ?? createSeededRng(this.seed) });
    this.factory = createVehicleFactory({ library: this.library });

    const random = options.random ?? createSeededRng(this.seed).fork('traffic');
    const systemOptions: TrafficSystemOptions = {
      factory: this.factory,
      random,
      ...(options.lane === undefined ? {} : { lane: options.lane }),
      ...(options.fleetSize === undefined ? {} : { fleetSize: options.fleetSize }),
      ...(options.initialEra === undefined ? {} : { initialEra: options.initialEra }),
      ...(options.parking === undefined ? {} : { parking: options.parking }),
      ...(options.signals === undefined ? {} : { signals: options.signals }),
      ...(options.maxParked === undefined ? {} : { maxParked: options.maxParked }),
      ...(options.parkDwellMs === undefined ? {} : { parkDwellMs: options.parkDwellMs }),
      ...(options.group === undefined ? {} : { group: options.group }),
      audio: options.audio ?? null,
      registry: options.registry ?? null,
    };

    this.system = new TrafficSystem(systemOptions);
    this.group = this.system.group;
    this.lane = this.system.lane;
    this.eraState = this.system.era;

    if (options.timeline) this.consume({ timeline: options.timeline });
    if (options.context) this.integrate(options.context, { publish: false });
  }

  /* ---------------- state ---------------- */

  /** Era the fleet currently belongs to. */
  get era(): EraId {
    return this.eraState;
  }

  get isDisposed(): boolean {
    return this.apiDisposed;
  }

  get isIntegrated(): boolean {
    return this.registration !== null;
  }

  get isConsumingTimeline(): boolean {
    return this.timelineRegistration !== null;
  }

  get vehicles(): readonly TrafficVehicle[] {
    return this.system.vehicles;
  }

  get fleetSize(): number {
    return this.system.fleetPlan.size;
  }

  /** Fleet line-up of one era, straight from the authored catalogue. */
  fleet(era: EraId = this.eraState): TrafficFleetSummary {
    const plan = buildEraFleetPlan(era, this.system.fleetPlan.size);
    const counts = new Map<string, number>();
    for (const entry of plan.entries) {
      counts.set(entry.spec.id, (counts.get(entry.spec.id) ?? 0) + entry.count);
    }
    return Object.freeze({
      era: plan.era,
      size: plan.size,
      label: plan.style,
      models: Object.freeze(
        [...counts.entries()].map(([id, count]) => Object.freeze({ id, count })),
      ),
    });
  }

  /** Authored model for one id, from the era catalogue. */
  model(id: string): VehicleModelSpec | null {
    return vehicleModel(id) ?? null;
  }

  /** Inspection ids this api currently owns. */
  inspectableIds(): readonly string[] {
    const value = this.system.snapshot().inspection.notableId;
    return value ? Object.freeze([value]) : Object.freeze([]);
  }

  /* ---------------- lifecycle: consume ---------------- */

  /**
   * Consumes the shared runtime handles. Safe to call repeatedly: only the
   * dependencies supplied in `dependencies` are touched.
   */
  consume(dependencies: TrafficDependencies = {}): this {
    if (this.apiDisposed) return this;
    if (dependencies.audio !== undefined) this.system.attachAudio(dependencies.audio);
    if (dependencies.registry !== undefined) this.system.attachRegistry(dependencies.registry);
    if (dependencies.timeline !== undefined) this.consumeTimeline(dependencies.timeline);
    return this;
  }

  private consumeTimeline(timeline: TimelineRuntime | null): void {
    if (this.timeline === timeline) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.timelineRegistration?.dispose();
    this.timelineRegistration = null;
    this.timeline = timeline;
    if (!timeline) return;

    // Adopt the timeline's era immediately, then let its tween drive the swaps.
    this.system.setEra(timeline.era, { immediate: true });
    this.eraState = timeline.era;
    this.timelineRegistration = timeline.registerBlendable(this, { id: TRAFFIC_BLENDABLE_ID });
    this.unsubscribe = timeline.subscribe((era) => {
      this.eraState = era;
    });
  }

  /* ---------------- lifecycle: integrate ---------------- */

  /**
   * Adds the fleet to the scene, registers the tick and publishes the handle.
   * Accepts either `integrate(context)` or `integrate({ context, order })`.
   */
  integrate(
    target: SceneContext | TrafficIntegrateOptions = {},
    options: TrafficIntegrateOptions = {},
  ): this {
    if (this.apiDisposed) return this;
    const resolved: TrafficIntegrateOptions = isSceneContext(target)
      ? { ...options, context: target }
      : target;
    const context = resolved.context ?? this.context;
    if (!context) throw new TypeError('TrafficApi.integrate() needs a SceneContext.');

    this.context = context;
    if (!context.scene.children.includes(this.group)) context.scene.add(this.group);

    if (!this.registration) {
      this.registration = context.registerSystem(
        resolved.systemId ?? TRAFFIC_SYSTEM_ID,
        (_scene: SceneContext, frame: FrameInfo) => {
          this.update(frame.delta);
        },
        { order: resolved.order ?? TRAFFIC_SYSTEM_ORDER },
      );
    }

    if (resolved.publish ?? true) this.publish(resolved.globalKey ?? TRAFFIC_GLOBAL_KEY);
    return this;
  }

  /** Publishes this handle on `globalThis` for overlays and browser probes. */
  publish(key: string = TRAFFIC_GLOBAL_KEY): TrafficApi {
    if (typeof globalThis !== 'undefined') {
      (globalThis as unknown as Record<string, unknown>)[key] = this;
    }
    this.publishedKey = key;
    return this;
  }

  /** Detaches the tick without tearing the fleet down. */
  detach(): void {
    this.registration?.dispose();
    this.registration = null;
  }

  /* ---------------- era blending ---------------- */

  /** Forwards an era change to the system (orchestrated by the timeline). */
  setEra(era: EraId, options: EraTransitionOptions = {}): void {
    if (this.apiDisposed) return;
    this.eraState = era;
    this.system.setEra(era, options);
  }

  /** Forwards one tween frame; fleets swap progressively across the tween. */
  updateEraTransition(progress: number, transition: EraTransitionInfo): void {
    if (this.apiDisposed) return;
    this.eraState = transition.to ?? this.eraState;
    this.system.updateEraTransition(progress, transition);
  }

  /** Applies the current era's fleet at full strength immediately. */
  applyEra(era: EraId = this.eraState): void {
    this.system.applyEraImmediately(era);
    this.eraState = era;
  }

  /* ---------------- simulation ---------------- */

  /** Advances traffic by `deltaSeconds` (also the `SceneContext` tick body). */
  update(deltaSeconds: number): void {
    if (this.apiDisposed) return;
    const step = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    this.system.update(step);
    this.eraState = this.system.era;
  }

  /** Pushes a vehicle into the next free kerbside bay. */
  requestPark(vehicleId?: string): string | null {
    return this.system.requestPark(vehicleId);
  }

  /** Sounds one vehicle's horn from its world position (or the most blocked one). */
  honk(vehicleId?: string, reason: 'blocked' | 'manual' = 'manual'): TrafficHornEvent | null {
    return this.system.honk(vehicleId, reason);
  }

  /** JSON-safe observation of the whole system. */
  snapshot(): TrafficSnapshot {
    return this.system.snapshot();
  }

  /* ---------------- teardown ---------------- */

  dispose(): void {
    if (this.apiDisposed) return;
    this.apiDisposed = true;
    this.detach();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.timelineRegistration?.dispose();
    this.timelineRegistration = null;
    this.system.dispose();
    this.factory.dispose();
    if (this.publishedKey) {
      detachTrafficGlobal(this.publishedKey, this);
      this.publishedKey = null;
    }
    if (this.ownsLibrary) this.library.dispose();
  }
}

/** Creates the traffic api (the `create` half of the lifecycle). */
export function createTrafficApi(options: TrafficApiOptions = {}): TrafficApi {
  return new TrafficApi(options);
}

/** Consumes the shared runtime handles on an existing api. */
export function consumeTraffic(api: TrafficApi, dependencies: TrafficDependencies): TrafficApi {
  return api.consume(dependencies);
}

/** Integrates an existing api into the scene and publishes its handle. */
export function integrateTraffic(
  api: TrafficApi,
  target: SceneContext | TrafficIntegrateOptions = {},
  options: TrafficIntegrateOptions = {},
): TrafficApi {
  return api.integrate(target, options);
}

/** Removes a published traffic handle (only when it still points at `api`). */
export function detachTrafficGlobal(key: string = TRAFFIC_GLOBAL_KEY, api?: TrafficApi): void {
  if (typeof globalThis === 'undefined') return;
  const scope = globalThis as unknown as Record<string, unknown>;
  if (api && scope[key] !== api) return;
  delete scope[key];
}

/** The published traffic handle, or `null` before boot. */
export function getTrafficApi(key: string = TRAFFIC_GLOBAL_KEY): TrafficApi | null {
  if (typeof globalThis === 'undefined') return null;
  const value = (globalThis as unknown as Record<string, unknown>)[key];
  return value instanceof TrafficApi ? value : null;
}

/** True when `value` is one of the five authored era ids. */
export function isTrafficEra(value: unknown): value is EraId {
  return typeof value === 'string' && (ERA_IDS as readonly string[]).includes(value);
}

export { buildTrafficLanePath, DEFAULT_FLEET_SIZE };
export type {
  LanePath,
  TrafficHornEvent,
  TrafficSnapshot,
  TrafficVehicle,
} from './trafficSystem';

declare global {
  interface Window {
    __chronoCityTraffic?: TrafficApi;
  }
}
