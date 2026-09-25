/**
 * Staged, interruptible era transformation driver.
 *
 * The driver is the one piece of Chrono City that knows *when* each era-aware
 * system should morph; it deliberately knows nothing about *what* a system
 * looks like. It walks a registered set of {@link EraAware} instances through a
 * ~2.5 s choreography in a fixed stage order, calling exactly
 * `applyEra(era, blend)` - never `update`, never geometry, never the camera - so
 * the camera pose is preserved by construction and any system that honours the
 * era contract can be driven without changing this file.
 *
 * ## Choreography
 *
 * Four stages run in order - environment and lighting, buildings, storefronts
 * and ads, vehicles and pedestrians - each with its own *overlapping* window
 * inside the transition. Because the windows stagger and overlap, atmosphere
 * has already started moving while storefronts are still mid-morph: the
 * transformation reads as a timelapse of the block, not as one global fade.
 * Every stage is eased with the target era's declared curve
 * (`getEraConfig(era).transition.easing`) unless the caller overrides it, so the
 * block morphs into an era the way that era's descriptor asks for.
 *
 * ## Blends
 *
 * Within one leg every system receives a non-decreasing blend in `0..1` that
 * reaches exactly `1` as soon as its stage closes:
 *
 * ```text
 * blend(t) = startBlend + (1 - startBlend) * easing(stageProgress(t))
 * ```
 *
 * `startBlend` is `0` when the leg begins: the era contract defines blend `0` as
 * "what you are showing now", and at that moment every system is showing the era
 * the leg is leaving. When a retarget lands while a stage is still in flight,
 * that stage carries the blend it had already reached, so an interrupted morph
 * continues from where it was instead of snapping back through the year it had
 * left.
 *
 * ## Interruption
 *
 * `transitionTo(era)` may be called at any time - mid-scrub, mid-stage, on the
 * frame a leg ends - and the driver re-aims the running transition:
 *
 * - a system whose stage is still in flight keeps its blend exactly and eases on
 *   towards the new target (no rewind, no pop);
 * - a stage that had already finished restarts from `0` for the new target,
 *   which its `applyEra` reads as "keep showing what you show now" - a clean
 *   crossfade into the new era, never a snap into a half-applied one;
 * - the new leg restarts the stage windows, so the replacement choreography
 *   still staggers in stage order;
 * - every registered system is eventually driven to exactly `(finalEra, 1)`, so
 *   rapid slider scrubbing can never leave a system stuck between eras.
 *
 * {@link EraTransitionDriver.cancel} instead aborts the leg and reapplies the
 * era the leg started from at blend `1`, and {@link EraTransitionDriver.settle}
 * fast-forwards the running leg to its target. Both leave every system fully
 * applied, never half-morphed.
 *
 * ## Events
 *
 * `onStart`, `onStage` and `onComplete` (or a single {@link
 * EraTransitionDriver.subscribe} listener) report the transition with era ids
 * plus the target era's `TransitionDescriptor`, so SFX can fire the era's
 * stinger and the HUD can follow the stage labels. Every `start` is matched by
 * exactly one `complete`; `complete.interrupted` distinguishes "the block
 * landed in the new era" from "the leg was re-aimed or cancelled".
 *
 * ## Determinism
 *
 * The driver owns no clock: `update(deltaSeconds)` is pumped by the shared
 * fixed-step loop and events carry leg-relative milliseconds only. Two identical
 * call sequences therefore produce byte-identical `applyEra` sequences, which is
 * what makes the tests below reproducible.
 */

import {
  ERAS,
  getEraConfig,
  type EraAware,
  type EraId,
  type TransitionDescriptor,
} from "../era/eraTypes";
import {
  EASINGS,
  clamp01,
  resolveEasingName,
  stageProgress,
  type EasingFunction,
  type EasingName,
} from "./easing";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Default length of one transformation: the ~2.5 s the user perceives. */
export const DEFAULT_TRANSITION_DURATION_MS = 2500;

/** Era the block is considered to be showing before anything else happens. */
export const DEFAULT_INITIAL_ERA: EraId = "1945";

/* -------------------------------------------------------------------------- */
/* Stage plan                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The four choreography stages, in the order they transform.
 *
 * `environment` (sky, sun, fog, street furniture) leads, then `buildings`,
 * then the commercial layer - storefronts and advertising travel together - and
 * finally the street life: vehicles and pedestrians.
 */
export type EraStageId = "environment" | "buildings" | "retail" | "street-life";

/** One stage of the choreography: a window in transition time plus its curve. */
export interface EraStagePlanEntry {
  readonly id: EraStageId;
  /** Human-readable name for HUD status text. */
  readonly label: string;
  /** Window start as a fraction of the transition (`0..1`). */
  readonly start: number;
  /** Window end as a fraction of the transition (`0..1`, exclusive of the next). */
  readonly end: number;
  /** Per-stage curve override; defaults to the target era's declared easing. */
  readonly easing?: EasingName;
}

/**
 * Default choreography.
 *
 * Starts are strictly increasing and every window ends after the previous one,
 * so neighbours always overlap: at ~20 % of the transition the environment is
 * still finishing while buildings are already moving, and so on through the
 * block. `retail` groups storefronts with ads and `street-life` groups vehicles
 * with pedestrians, exactly as the timeline's transformation reads.
 */
export const DEFAULT_STAGE_PLAN: readonly EraStagePlanEntry[] = Object.freeze(
  [
    { id: "environment", label: "Environment & lighting", start: 0, end: 0.42 },
    { id: "buildings", label: "Buildings", start: 0.14, end: 0.62 },
    { id: "retail", label: "Storefronts & advertising", start: 0.3, end: 0.78 },
    { id: "street-life", label: "Vehicles & pedestrians", start: 0.46, end: 1 },
  ] satisfies EraStagePlanEntry[],
).map((entry) => Object.freeze(entry));

/** Stage ids in choreography order, derived from {@link DEFAULT_STAGE_PLAN}. */
export const ERA_STAGE_ORDER: readonly EraStageId[] = Object.freeze(
  DEFAULT_STAGE_PLAN.map((entry) => entry.id),
);

/**
 * Stage aliases accepted by {@link resolveEraStage}.
 *
 * Scene systems are named after what they build (`environment`, `storefronts`,
 * `advertising`, `vehicles`, `pedestrians`, ...), not after the stage they
 * belong to, so registration accepts those names and folds them onto the four
 * stages. Anything not listed here is a programming error and throws.
 */
export const ERA_STAGE_ALIASES: Readonly<Record<string, EraStageId>> = Object.freeze({
  environment: "environment",
  lighting: "environment",
  light: "environment",
  sky: "environment",
  weather: "environment",
  atmosphere: "environment",

  buildings: "buildings",
  building: "buildings",
  architecture: "buildings",
  massing: "buildings",
  facade: "buildings",

  retail: "retail",
  storefronts: "retail",
  storefront: "retail",
  shops: "retail",
  advertising: "retail",
  ads: "retail",
  ad: "retail",
  signage: "retail",

  "street-life": "street-life",
  streetlife: "street-life",
  streets: "street-life",
  traffic: "street-life",
  vehicles: "street-life",
  vehicle: "street-life",
  pedestrians: "street-life",
  pedestrian: "street-life",
  crowd: "street-life",
  people: "street-life",
});

/**
 * Resolves a stage id or system-style alias (case-insensitive) to a stage.
 *
 * @throws when the name is not part of the choreography, so a typo in scene
 * assembly fails at registration instead of silently dropping a system out of
 * the transformation.
 */
export function resolveEraStage(stage: EraStageId | string): EraStageId {
  const key = String(stage).trim().toLowerCase();
  if (Object.hasOwn(ERA_STAGE_ALIASES, key)) {
    return ERA_STAGE_ALIASES[key]!;
  }
  throw new Error(
    `Unknown era transition stage "${stage}". Expected one of ${ERA_STAGE_ORDER.join(", ")}.`,
  );
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

/** A leg of the choreography begins. */
export interface EraTransitionStartEvent {
  readonly type: "start";
  /** Era the leg is travelling from. */
  readonly from: EraId;
  /** Era the leg is travelling to. */
  readonly to: EraId;
  /** Length of the leg in milliseconds. */
  readonly durationMs: number;
  /** Curve driving this leg's stages (target era's declared easing by default). */
  readonly easing: EasingName;
  /** Target era's transition descriptor: stinger, particles, dolly, step size. */
  readonly descriptor: TransitionDescriptor;
  /** True when this leg replaced a running one (the slider was scrubbed again). */
  readonly retarget: boolean;
}

/** One stage of the choreography starts or finishes. */
export interface EraStageEvent {
  readonly type: "stage";
  readonly from: EraId;
  readonly to: EraId;
  readonly stage: EraStageId;
  /** Human-readable stage name, ready for HUD status text. */
  readonly label: string;
  /** Zero-based index of the stage in the plan. */
  readonly stageIndex: number;
  /** Number of stages in the plan. */
  readonly stageCount: number;
  readonly phase: "begin" | "end";
  /** Leg progress after the step that produced the event, `0..1`. */
  readonly progress: number;
  /** Registered system ids in this stage; anonymous registrations are omitted. */
  readonly systemIds: readonly string[];
}

/** A leg ends - either because it landed in its target era or was re-aimed. */
export interface EraTransitionCompleteEvent {
  readonly type: "complete";
  readonly from: EraId;
  readonly to: EraId;
  /**
   * `false` when the leg reached its target era (every system at blend `1`),
   * `true` when it was superseded by a retarget or aborted by
   * {@link EraTransitionDriver.cancel}.
   */
  readonly interrupted: boolean;
  /**
   * Era the driver is committed to once the event has been handled.
   *
   * Equals `to` after a natural completion, the replacement target after a
   * retarget (the new leg is already driving every system there) and `from`
   * after a cancel.
   */
  readonly settledEra: EraId;
  /** Leg progress when the leg ended; exactly `1` for a natural completion. */
  readonly progress: number;
  /** Leg-relative milliseconds elapsed when the leg ended. */
  readonly elapsedMs: number;
}

/** Every event the driver emits, discriminated by `type`. */
export type EraTransitionEvent =
  | EraTransitionStartEvent
  | EraStageEvent
  | EraTransitionCompleteEvent;

/** Listener signature for {@link EraTransitionDriver.subscribe}. */
export type EraTransitionListener = (event: EraTransitionEvent) => void;

/** Optional per-kind callbacks; each is also delivered through `subscribe`. */
export interface EraTransitionListeners {
  readonly onStart?: (event: EraTransitionStartEvent) => void;
  readonly onStage?: (event: EraStageEvent) => void;
  readonly onComplete?: (event: EraTransitionCompleteEvent) => void;
}

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

/** Options accepted by {@link EraTransitionDriver.register}. */
export interface EraTransitionRegistrationOptions {
  /** Stage the system transforms in, as a stage id or a system-style alias. */
  readonly stage: EraStageId | string;
  /** Stable id, reported in {@link EraStageEvent.systemIds} and debug overlays. */
  readonly id?: string;
}

/** A registration handed back by `register`, usable for later removal. */
export interface EraTransitionHandle {
  readonly id: string | undefined;
  readonly stage: EraStageId;
  /** Removes the system from the choreography; safe to call more than once. */
  unregister(): void;
}

/** Registration accepted by the constructor's `systems` shorthand. */
export interface EraTransitionRegistrationInput extends EraTransitionRegistrationOptions {
  readonly system: EraAware;
}

/** Read-only snapshot of a registration, for tests, UI and debug overlays. */
export interface EraTransitionRegistration {
  readonly system: EraAware;
  readonly id: string | undefined;
  readonly stage: EraStageId;
  /** Era most recently applied to this system. */
  readonly era: EraId;
  /** Blend that era was applied at; `1` means fully applied. */
  readonly blend: number;
}

/** Options accepted by {@link EraTransitionDriver} / `createEraTransition`. */
export interface EraTransitionDriverOptions extends EraTransitionListeners {
  /** Systems to register up front, in registration order. */
  readonly systems?: readonly EraTransitionRegistrationInput[];
  /** Leg length in milliseconds; defaults to {@link DEFAULT_TRANSITION_DURATION_MS}. */
  readonly durationMs?: number;
  /** Choreography override; defaults to {@link DEFAULT_STAGE_PLAN}. */
  readonly stagePlan?: readonly EraStagePlanEntry[];
  /** Curve override for every stage, ignoring each era's declared easing. */
  readonly easing?: EasingName;
  /** Era the block is considered to be showing initially. */
  readonly initialEra?: EraId;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

/** One live registration. */
interface Registration {
  readonly system: EraAware;
  readonly id: string | undefined;
  readonly stage: EraStageId;
  readonly handle: EraTransitionHandle;
  /** Era applied most recently. */
  era: EraId;
  /** Blend applied most recently; `1` while the stage is closed or settled. */
  blend: number;
  /** Blend the running leg started from. */
  startBlend: number;
}

/** Per-leg stage bookkeeping: window, resolved curve and last local progress. */
interface StageState {
  readonly entry: EraStagePlanEntry;
  readonly index: number;
  readonly easing: EasingFunction;
  readonly systemIds: readonly string[];
  local: number;
}

/** One transformation leg: a from/to pair plus its stage timeline. */
interface Leg {
  readonly from: EraId;
  readonly target: EraId;
  readonly durationMs: number;
  readonly easingName: EasingName;
  readonly descriptor: TransitionDescriptor;
  readonly stages: readonly StageState[];
  elapsedMs: number;
}

/** Sanitises a per-step delta in seconds into a finite, non-negative number. */
function sanitizeDelta(deltaSeconds: number): number {
  return Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
}

/**
 * Residue treated as "the leg has arrived".
 *
 * Fixed-step deltas are accumulated in floating point, so 150 steps of 1/60 s
 * land a hair short of 2500 ms. Snapping that residue away keeps the step count
 * for a leg independent of binary rounding: identical scripts produce identical
 * step counts on every machine.
 */
const ARRIVAL_EPSILON_MS = 0.01;

/** Raw (un-eased) progress of a leg, `1` for a zero-length or arrived leg. */
function legProgress(leg: Leg): number {
  if (!(leg.durationMs > 0)) {
    return 1;
  }
  const elapsed =
    leg.durationMs - leg.elapsedMs <= ARRIVAL_EPSILON_MS ? leg.durationMs : leg.elapsedMs;
  return clamp01(elapsed / leg.durationMs);
}

/* -------------------------------------------------------------------------- */
/* Driver                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Drives every registered {@link EraAware} system through the staged
 * transformation.
 *
 * Scene assembly owns the surrounding lifecycle: it constructs the driver with
 * the systems it just mounted, forwards the timeline's year changes to
 * {@link transitionTo}, pumps {@link update} from the shared fixed-step loop and
 * calls {@link dispose} on teardown. The driver never touches a system's
 * geometry, `update` or the camera - only `applyEra(era, blend)`.
 */
export class EraTransitionDriver {
  /** Leg length in milliseconds used for every transformation. */
  readonly durationMs: number;

  /** Choreography in force, frozen and ordered. */
  readonly stagePlan: readonly EraStagePlanEntry[];

  private readonly easingOverride: EasingName | undefined;
  private readonly registrations: Registration[] = [];
  private readonly listeners = new Set<EraTransitionListener>();

  private leg: Leg | null = null;
  private settled: EraId;
  private disposed = false;

  constructor(options: EraTransitionDriverOptions = {}) {
    this.durationMs =
      typeof options.durationMs === "number" && Number.isFinite(options.durationMs) && options.durationMs >= 0
        ? options.durationMs
        : DEFAULT_TRANSITION_DURATION_MS;
    this.stagePlan = Object.freeze(
      (options.stagePlan ?? DEFAULT_STAGE_PLAN).map((entry) =>
        Object.freeze({ ...entry, id: resolveEraStage(entry.id) }),
      ),
    );
    this.easingOverride = options.easing === undefined ? undefined : resolveEasingName(options.easing);
    this.settled = options.initialEra ?? DEFAULT_INITIAL_ERA;
    getEraConfig(this.settled);

    if (options.onStart || options.onStage || options.onComplete) {
      this.subscribe((event) => {
        if (event.type === "start") options.onStart?.(event);
        else if (event.type === "stage") options.onStage?.(event);
        else options.onComplete?.(event);
      });
    }

    for (const entry of options.systems ?? []) {
      this.register(entry.system, { stage: entry.stage, id: entry.id });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* State                                                                  */
  /* ---------------------------------------------------------------------- */

  /** Era every system is settled at, or the driver is currently travelling to. */
  get targetEra(): EraId {
    return this.leg ? this.leg.target : this.settled;
  }

  /** Era the block is fully applied to; does not change while a leg runs. */
  get settledEra(): EraId {
    return this.settled;
  }

  /** True while a leg is being driven. */
  get transitioning(): boolean {
    return this.leg !== null;
  }

  /** Raw progress of the running leg (`1` when idle); `0..1`. */
  get progress(): number {
    return this.leg ? legProgress(this.leg) : 1;
  }

  /** Millisecond offset inside the running leg. */
  get elapsedMs(): number {
    return this.leg ? this.leg.elapsedMs : 0;
  }

  /** Targets of the running leg, or `null` when idle. */
  get activeLeg(): { readonly from: EraId; readonly target: EraId; readonly easing: EasingName } | null {
    if (!this.leg) {
      return null;
    }
    return Object.freeze({ from: this.leg.from, target: this.leg.target, easing: this.leg.easingName });
  }

  /** Frozen snapshot of the current registrations, in registration order. */
  get registered(): readonly EraTransitionRegistration[] {
    return Object.freeze(
      this.registrations.map((registration) =>
        Object.freeze({
          system: registration.system,
          id: registration.id,
          stage: registration.stage,
          era: registration.era,
          blend: registration.blend,
        }),
      ),
    );
  }

  /** Blend most recently applied to `system`, or `undefined` when unregistered. */
  blendFor(system: EraAware): number | undefined {
    return this.registrations.find((registration) => registration.system === system)?.blend;
  }

  /* ---------------------------------------------------------------------- */
  /* Registration                                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * Adds a system to the choreography.
   *
   * The newcomer is immediately brought in line with the rest of the block: it
   * receives the settled era at blend `1` when idle, or the running leg's target
   * at the blend its stage has already reached - so a system mounted after the
   * transformation started never lags behind its stage-mates.
   *
   * @throws when the driver has been disposed, the system is already
   * registered, or `stage` is not part of the choreography.
   */
  register(system: EraAware, options: EraTransitionRegistrationOptions): EraTransitionHandle {
    if (this.disposed) {
      throw new Error("Cannot register a system on a disposed era transition driver.");
    }
    if (this.registrations.some((registration) => registration.system === system)) {
      throw new Error(
        `System${options.id ? ` "${options.id}"` : ""} is already registered with the era transition driver.`,
      );
    }
    const stage = resolveEraStage(options.stage);
    const handle: EraTransitionHandle = Object.freeze({
      id: options.id,
      stage,
      unregister: (): void => {
        this.unregister(handle);
      },
    });
    const registration: Registration = {
      system,
      id: options.id,
      stage,
      handle,
      blend: 0,
      startBlend: 0,
    };
    this.registrations.push(registration);

    const leg = this.leg;
    if (!leg) {
      registration.blend = 1;
      registration.startBlend = 1;
      system.applyEra(this.settled, 1);
      return handle;
    }

    const state = leg.stages.find((candidate) => candidate.entry.id === stage)!;
    const local = stageProgress(legProgress(leg), state.entry.start, state.entry.end);
    const blend = local >= 1 ? 1 : state.easing(local);
    registration.blend = blend;
    registration.startBlend = 0;
    system.applyEra(leg.target, blend);
    return handle;
  }

  /**
   * Removes a system (by handle or by instance) from the choreography.
   *
   * Returns `false` when it was not registered. A removed system keeps whatever
   * blend was last applied to it: the timeline's current era is scene
   * assembly's business, not the driver's.
   */
  unregister(target: EraTransitionHandle | EraAware): boolean {
    const index = this.registrations.findIndex((registration) =>
      typeof target === "object" && target !== null && "unregister" in target
        ? registration.handle === target
        : registration.system === target,
    );
    if (index < 0) {
      return false;
    }
    this.registrations.splice(index, 1);
    return true;
  }

  /* ---------------------------------------------------------------------- */
  /* Events                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Subscribes to every event; returns the unsubscribe function.
   *
   * The driver dispatches synchronously from `transitionTo` and `update`, so a
   * listener that calls back into the driver (a retarget from a UI handler, for
   * instance) is safe: the driver stops emitting for a superseded leg as soon as
   * it notices the leg changed.
   */
  subscribe(listener: EraTransitionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Driving                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Starts - or re-aims - the transformation towards `era`.
   *
   * Idempotent for the era already being travelled to (and for the settled era
   * when idle): scrubbing the slider back onto the same stop does not restart a
   * leg. A retarget supersedes the running leg, carries every system's current
   * blend into the new leg so nothing jumps backwards, and restarts the stage
   * windows so the new choreography still staggers.
   *
   * @throws when `era` is not one of the contract's era ids.
   */
  transitionTo(era: EraId): void {
    if (this.disposed) {
      return;
    }
    const config = getEraConfig(era);
    const previous = this.leg;
    if (previous ? previous.target === era : this.settled === era) {
      return;
    }

    const from: EraId = previous ? previous.target : this.settled;
    if (previous) {
      this.supersedeLeg(previous, era);
    }

    // Continuity, in the era contract's own terms: `blend` is "how much of the
    // target era", and `0` already means "exactly what you are showing now".
    // A system mid-stage therefore keeps its exact blend and eases on from
    // there, while a system that is fully applied (blend `1` for the era this
    // leg is leaving) restarts at `0` - which reads as its current state, so it
    // crossfades into the new target instead of snapping into it.
    for (const registration of this.registrations) {
      registration.startBlend = registration.blend < 1 ? registration.blend : 0;
    }

    const descriptor = config.transition;
    const easingName = resolveEasingName(this.easingOverride ?? descriptor.easing);
    const leg: Leg = {
      from,
      target: era,
      durationMs: this.durationMs,
      easingName,
      descriptor,
      stages: this.stagePlan.map((entry, index) => ({
        entry,
        index,
        easing: EASINGS[resolveEasingName(entry.easing ?? easingName)],
        systemIds: Object.freeze(
          this.registrations
            .filter((registration) => registration.stage === entry.id && registration.id !== undefined)
            .map((registration) => registration.id!),
        ),
        local: 0,
      })),
      elapsedMs: 0,
    };
    this.leg = leg;
    this.settled = era;

    this.emit({
      type: "start",
      from,
      to: era,
      durationMs: leg.durationMs,
      easing: easingName,
      descriptor,
      retarget: previous !== null,
    });

    if (leg.durationMs <= 0) {
      this.update(0);
    }
  }

  /** {@link transitionTo} by timeline year; see {@link eraForYear}. */
  transitionToYear(year: number): void {
    this.transitionTo(eraForYear(year));
  }

  /** Alias for {@link transitionTo}, named for the interruption case. */
  retarget(era: EraId): void {
    this.transitionTo(era);
  }

  /**
   * Advances the running leg by `deltaSeconds` of fixed-step time.
   *
   * Applies the current blend of every registered system in stage order, then
   * reports stage boundaries crossed by this step (begin before end, in plan
   * order) and, on the final step, completes the leg with every system at
   * exactly blend `1`. Calling it while idle is a no-op, so scene assembly can
   * pump it unconditionally from the shared loop.
   */
  update(deltaSeconds: number): void {
    const leg = this.leg;
    if (this.disposed || !leg) {
      return;
    }

    leg.elapsedMs = Math.min(leg.durationMs, leg.elapsedMs + sanitizeDelta(deltaSeconds) * 1000);
    const progress = legProgress(leg);

    for (const state of leg.stages) {
      const local = stageProgress(progress, state.entry.start, state.entry.end);
      const eased = state.easing(local);
      for (const registration of this.registrations) {
        if (registration.stage !== state.entry.id) {
          continue;
        }
        const blend = local >= 1 ? 1 : registration.startBlend + (1 - registration.startBlend) * eased;
        registration.era = leg.target;
        registration.blend = blend;
        registration.system.applyEra(leg.target, blend);
      }
    }

    // A listener may have re-aimed or cancelled the leg while systems were being
    // applied; the superseded leg stops reporting immediately.
    if (this.leg !== leg) {
      return;
    }

    for (const state of leg.stages) {
      const local = stageProgress(progress, state.entry.start, state.entry.end);
      const previous = state.local;
      state.local = local;
      if (local <= 0) {
        continue;
      }
      // Independent checks, not `else if`: a stage whose whole window fits
      // inside one step still reports its begin *and* its end, so every begin is
      // matched by an end even when the caller settles or steps coarsely.
      if (previous <= 0) {
        this.emitStage(leg, state, "begin", progress);
      }
      if (previous < 1 && local >= 1) {
        this.emitStage(leg, state, "end", progress);
      }
      if (this.leg !== leg) {
        return;
      }
    }

    if (this.leg === leg && progress >= 1) {
      this.finishLeg(leg, false, leg.target);
    }
  }

  /**
   * Fast-forwards the running leg to its target in a single step.
   *
   * Stages that had not started yet report a paired `begin`/`end`, so stage
   * listeners still see the whole choreography close out. No-op while idle.
   */
  settle(): void {
    const leg = this.leg;
    if (!leg) {
      return;
    }
    this.update(Math.max(0, leg.durationMs - leg.elapsedMs) / 1000);
  }

  /**
   * Aborts the running leg and returns the block to the era it started from.
   *
   * Every system is reapplied at blend `1` for that era - a fully applied state,
   * never a half-morphed one - and a single `complete` event with
   * `interrupted: true` is emitted. No-op while idle.
   */
  cancel(): void {
    const leg = this.leg;
    if (!leg) {
      return;
    }
    const origin = leg.from;
    this.leg = null;
    this.applyEraToAll(origin, 1);
    this.settled = origin;
    this.emit({
      type: "complete",
      from: leg.from,
      to: leg.target,
      interrupted: true,
      settledEra: origin,
      progress: legProgress(leg),
      elapsedMs: leg.elapsedMs,
    });
  }

  /**
   * Drops every registration and listener.
   *
   * The leg is abandoned without emitting: teardown is not a transformation
   * result. Later `register`, `transitionTo` and `update` calls are safe no-ops
   * (register throws, since a disposed driver can never drive the system).
   */
  dispose(): void {
    this.disposed = true;
    this.leg = null;
    this.registrations.length = 0;
    this.listeners.clear();
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Applies `era` at `blend` to every registered system in choreography order.
   *
   * Stage-major order (plan order, then registration order inside a stage) is
   * the call order the driver guarantees, so `applyEra` implementations may rely
   * on earlier stages already having been applied for this step. Used for the
   * forced transitions - completion, settle and cancel - where the whole block
   * must land on one era at once.
   */
  private applyEraToAll(era: EraId, blend: number): void {
    for (const entry of this.stagePlan) {
      for (const registration of this.registrations) {
        if (registration.stage !== entry.id) {
          continue;
        }
        registration.era = era;
        registration.blend = blend;
        registration.startBlend = blend;
        registration.system.applyEra(era, blend);
      }
    }
  }

  /** Ends `leg` because a newer target superseded it, without re-applying. */
  private supersedeLeg(leg: Leg, replacement: EraId): void {
    this.leg = null;
    this.emit({
      type: "complete",
      from: leg.from,
      to: leg.target,
      interrupted: true,
      settledEra: replacement,
      progress: legProgress(leg),
      elapsedMs: leg.elapsedMs,
    });
  }

  /** Lands `leg`: every system at blend `1` for `settledEra`. */
  private finishLeg(leg: Leg, interrupted: boolean, settledEra: EraId): void {
    leg.elapsedMs = leg.durationMs;
    this.applyEraToAll(settledEra, 1);
    this.leg = null;
    this.settled = settledEra;
    this.emit({
      type: "complete",
      from: leg.from,
      to: leg.target,
      interrupted,
      settledEra,
      progress: legProgress(leg),
      elapsedMs: leg.elapsedMs,
    });
  }

  private emitStage(leg: Leg, state: StageState, phase: "begin" | "end", progress: number): void {
    this.emit({
      type: "stage",
      from: leg.from,
      to: leg.target,
      stage: state.entry.id,
      label: state.entry.label,
      stageIndex: state.index,
      stageCount: leg.stages.length,
      phase,
      progress,
      systemIds: state.systemIds,
    });
  }

  private emit(event: EraTransitionEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Resolves a timeline year to its era id.
 *
 * An exact match wins; otherwise the nearest era on the timeline is returned,
 * ties resolving to the earlier era so the mapping stays deterministic for any
 * slider value a draggable control can produce.
 *
 * @throws when `year` is not a finite number.
 */
export function eraForYear(year: number): EraId {
  if (!Number.isFinite(year)) {
    throw new Error(`Cannot resolve an era for year "${String(year)}".`);
  }
  let best = ERAS[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const era of ERAS) {
    const distance = Math.abs(era.year - year);
    if (distance < bestDistance) {
      best = era;
      bestDistance = distance;
    }
  }
  return best.id;
}

/** Creates a driver; sugar for `new EraTransitionDriver(options)`. */
export function createEraTransition(options: EraTransitionDriverOptions = {}): EraTransitionDriver {
  return new EraTransitionDriver(options);
}
