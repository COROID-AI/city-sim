/**
 * Chrono City — era timeline runtime.
 *
 * The single source of truth for *which year the city is currently in* and the
 * only module that schedules the cross-era transformation. Systems never read a
 * year from anywhere else: they register as an `EraBlendable` and get driven by
 * this runtime.
 *
 * Responsibilities:
 *   create    → `new TimelineRuntime()` / `createTimelineRuntime()` holds the
 *               selected era and the default 1.2 s tween length.
 *   consume   → `selectEra()` / `selectYear()` move the timeline (clamped or
 *               snapped to the five valid years), `subscribe()` reports the
 *               selected year, `onProgress()` reports every tween frame, and
 *               `registerBlendable()` hands a system its era updates.
 *   integrate → `attach(context)` registers one system tick on the shared
 *               `SceneContext`, so `advance()` runs with the render loop and
 *               every registered `EraBlendable` transforms in front of the user.
 *
 * Transition semantics (matching the `era-contracts` lifecycle):
 *   - `selectEra(target, { immediate: true })` (or `durationMs: 0`) applies the
 *     target at full strength in one step and emits `progress === 1` once.
 *   - Otherwise a tween of `durationMs` (default 1200 ms) starts: each blendable
 *     receives `setEra(target)` once, then `updateEraTransition(progress, info)`
 *     every frame with an eased progress and one final call where
 *     `info.active === false`.
 *   - `progress` is smoothed (Hermite) so the whole block accelerates out of the
 *     old era and eases into the new one.
 *   - Re-selecting a different era mid-tween restarts the tween from the current
 *     selection, which is what makes rapid slider scrubbing stable: blendables
 *     capture their state in `setEra()` and therefore never snap backwards.
 */

import {
  DEFAULT_ERA,
  ERA_IDS,
  FIRST_ERA,
  LAST_ERA,
  clamp01,
  eraYear,
  isEraId,
  smoothStep01,
  type EraBlendable,
  type EraId,
  type EraTransitionInfo,
  type EraTransitionOptions,
} from '../core/eraContracts';
import type { FrameInfo, SceneContext, SystemRegistration } from '../core/sceneContext';
import { getEraDescriptor, type EraTimelineDescriptor } from './eraDescriptors';

export const TIMELINE_RUNTIME_VERSION = 1;

/** Default tween length: long enough to read the morph, short enough to feel live. */
export const DEFAULT_ERA_TRANSITION_MS = 1200;

/** System id the runtime registers on the `SceneContext` tick registry. */
export const TIMELINE_SYSTEM_ID = 'era-timeline';

/**
 * Systems run in ascending order, and the timeline must run before the systems
 * it drives, so a blendable updated later in the same frame sees fresh progress.
 */
export const TIMELINE_SYSTEM_ORDER = -1000;

/* ------------------------------------------------------------------------- *
 * Public shapes
 * ------------------------------------------------------------------------- */

/** Options accepted by `registerBlendable()`. */
export interface TimelineBlendableOptions {
  /** Stable id; auto-generated when omitted. Ids must be unique. */
  readonly id?: string;
  /**
   * Push the current era (or the in-flight eased progress) into the blendable
   * as soon as it registers. Defaults to `true` so a late joiner never pops.
   */
  readonly syncOnRegister?: boolean;
}

/** Handle returned by `registerBlendable()`; use it to unregister. */
export interface EraBlendableRegistration {
  readonly id: string;
  readonly blendable: EraBlendable;
  dispose(): void;
}

/** Immutable view of the timeline for subscribers, HUD systems and tests. */
export interface EraProgressSnapshot {
  /** Era currently selected (the target of the running tween). */
  readonly era: EraId;
  readonly year: number;
  /** Era the running transition departed from. */
  readonly from: EraId;
  /** Era the running transition is heading to. */
  readonly to: EraId;
  /** Eased tween progress in `[0, 1]`; `1` when settled. */
  readonly progress: number;
  /** Linear tween progress in `[0, 1]` before easing. */
  readonly rawProgress: number;
  readonly elapsedMs: number;
  readonly durationMs: number;
  /** `true` while the tween is still running. */
  readonly transitioning: boolean;
  readonly descriptor: EraTimelineDescriptor;
}

/** Called whenever the selected year changes (selection, not each tween frame). */
export type EraSelectionListener = (era: EraId, runtime: TimelineRuntime) => void;

/** Called every tween frame (and once on completion). */
export type EraProgressListener = (snapshot: EraProgressSnapshot, runtime: TimelineRuntime) => void;

export interface TimelineRuntimeOptions {
  /** Era the runtime starts in. Defaults to `DEFAULT_ERA`. Numbers snap to the nearest year. */
  readonly initialEra?: EraId | number | string;
  /** Default tween length in ms. Defaults to `DEFAULT_ERA_TRANSITION_MS`. */
  readonly durationMs?: number;
  /** Context to immediately register the tick system on. */
  readonly context?: SceneContext | null;
  /** Attach automatically when a context is supplied. Defaults to `true`. */
  readonly autoAttach?: boolean;
  /** Tick-system id. Defaults to `TIMELINE_SYSTEM_ID`. */
  readonly systemId?: string;
  /** Tick-system order. Defaults to `TIMELINE_SYSTEM_ORDER`. */
  readonly order?: number;
}

interface TransitionState {
  readonly from: EraId;
  readonly to: EraId;
  readonly durationMs: number;
  elapsedMs: number;
}

interface BlendableEntry {
  readonly id: string;
  readonly blendable: EraBlendable;
  readonly sequence: number;
}

class BlendableHandle implements EraBlendableRegistration {
  private readonly runtime: TimelineRuntime;
  private readonly entry: BlendableEntry;
  private disposed = false;

  constructor(runtime: TimelineRuntime, entry: BlendableEntry) {
    this.runtime = runtime;
    this.entry = entry;
  }

  get id(): string {
    return this.entry.id;
  }

  get blendable(): EraBlendable {
    return this.entry.blendable;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runtime.unregisterBlendable(this.entry.id);
  }
}

/* ------------------------------------------------------------------------- *
 * Era normalisation
 * ------------------------------------------------------------------------- */

/** Snaps an arbitrary year to the nearest of the five valid eras. */
function nearestEraId(year: number): EraId {
  if (!Number.isFinite(year)) {
    throw new RangeError(`Era year must be a finite number, received ${String(year)}.`);
  }
  const first = eraYear(FIRST_ERA);
  const last = eraYear(LAST_ERA);
  const clamped = Math.min(last, Math.max(first, year));
  let best: EraId = FIRST_ERA;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const era of ERA_IDS) {
    const delta = Math.abs(eraYear(era) - clamped);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = era;
    }
  }
  return best;
}

/**
 * Clamps/normalises any input into one of the five valid eras.
 * Numbers and numeric strings snap to the nearest era; unknown non-numeric
 * values fail loudly rather than silently showing the wrong year.
 */
function normalizeEra(value: EraId | number | string): EraId {
  if (typeof value === 'number') return nearestEraId(value);
  if (isEraId(value)) return value;
  const parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed)) return nearestEraId(parsed);
  throw new RangeError(
    `Unknown era "${value}"; expected one of ${ERA_IDS.join(', ')} or a year between ${FIRST_ERA} and ${LAST_ERA}.`,
  );
}

function resolveDuration(options: EraTransitionOptions, fallbackMs: number): number {
  if (options.immediate === true) return 0;
  const requested = options.durationMs ?? fallbackMs;
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  return requested;
}

/* ------------------------------------------------------------------------- *
 * TimelineRuntime
 * ------------------------------------------------------------------------- */

/**
 * Holds the selected year, runs the eased era tween and drives every registered
 * `EraBlendable`. Attach it to a `SceneContext` so transitions advance with the
 * render loop, or call `advance(deltaMs)` directly from tests.
 */
export class TimelineRuntime {
  readonly version = TIMELINE_RUNTIME_VERSION;

  /** Tick-system id this runtime registers under. */
  readonly systemId: string;
  /** Tick-system order this runtime registers with. */
  readonly order: number;

  private readonly defaultDurationMs: number;
  private readonly blendables = new Map<string, BlendableEntry>();
  private readonly selectionListeners = new Set<EraSelectionListener>();
  private readonly progressListeners = new Set<EraProgressListener>();

  private currentEra: EraId;
  private appliedEra: EraId;
  private transition: TransitionState | null = null;
  private registration: SystemRegistration | null = null;
  private sequence = 0;
  private disposedState = false;

  constructor(options: TimelineRuntimeOptions = {}) {
    this.systemId = options.systemId ?? TIMELINE_SYSTEM_ID;
    this.order = options.order ?? TIMELINE_SYSTEM_ORDER;
    this.defaultDurationMs =
      options.durationMs === undefined || !Number.isFinite(options.durationMs) || options.durationMs < 0
        ? DEFAULT_ERA_TRANSITION_MS
        : options.durationMs;

    const initial = options.initialEra === undefined ? DEFAULT_ERA : normalizeEra(options.initialEra);
    this.currentEra = initial;
    this.appliedEra = initial;

    if (options.context) {
      if (options.autoAttach ?? true) this.attach(options.context);
    } else if (options.autoAttach === true) {
      throw new TypeError('TimelineRuntime cannot auto-attach without a SceneContext.');
    }
  }

  /* ---------------- state ---------------- */

  /** Era currently selected — the single source of truth for year state. */
  get era(): EraId {
    return this.currentEra;
  }

  /** Alias of `era`, for readability in UI code. */
  get selectedEra(): EraId {
    return this.currentEra;
  }

  /** Numeric year of the selected era (e.g. `1985`). */
  get year(): number {
    return eraYear(this.currentEra);
  }

  /** Era last applied at full strength (lags `era` while a tween runs). */
  get settledEra(): EraId {
    return this.appliedEra;
  }

  /** Full descriptor table of the selected era. */
  get descriptor(): EraTimelineDescriptor {
    return getEraDescriptor(this.currentEra);
  }

  /** `true` while the tween is still running. */
  get isTransitioning(): boolean {
    return this.transition !== null;
  }

  /** Eased progress of the running tween; `1` when settled. */
  get progress(): number {
    return this.transition ? smoothStep01(this.rawProgress) : 1;
  }

  /** Linear progress of the running tween; `1` when settled. */
  get rawProgress(): number {
    const active = this.transition;
    if (!active) return 1;
    if (active.durationMs <= 0) return 1;
    return clamp01(active.elapsedMs / active.durationMs);
  }

  /** Snapshot of the running tween, or `null` when settled. */
  get transitionInfo(): EraTransitionInfo | null {
    const active = this.transition;
    if (!active) return null;
    return {
      from: active.from,
      to: active.to,
      elapsedMs: active.elapsedMs,
      durationMs: active.durationMs,
      active: true,
    };
  }

  /** Full timeline snapshot, safe to hand to HUD systems. */
  get snapshot(): EraProgressSnapshot {
    const info = this.transitionInfo ?? this.settledInfo();
    return {
      era: this.currentEra,
      year: eraYear(this.currentEra),
      from: info.from,
      to: info.to,
      progress: this.progress,
      rawProgress: this.rawProgress,
      elapsedMs: info.elapsedMs,
      durationMs: info.durationMs,
      transitioning: this.transition !== null,
      descriptor: getEraDescriptor(this.currentEra),
    };
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  get isAttached(): boolean {
    return this.registration !== null;
  }

  get blendableCount(): number {
    return this.blendables.size;
  }

  get blendableIds(): readonly string[] {
    return [...this.blendables.keys()];
  }

  /* ---------------- selection ---------------- */

  /**
   * Moves the timeline to a year. Accepts an `EraId`, a numeric year or a
   * numeric string; anything between the five authored years snaps to the
   * nearest one and out-of-range years clamp to 1945 / 2025.
   *
   * Returns the era that is now selected.
   */
  selectEra(value: EraId | number | string, options: EraTransitionOptions = {}): EraId {
    this.assertUsable();
    const target = normalizeEra(value);
    // Already selected: a running tween towards it continues untouched.
    if (target === this.currentEra) return target;

    const durationMs = resolveDuration(options, this.defaultDurationMs);
    const from = this.currentEra;
    this.currentEra = target;

    this.notifySelection(target);
    if (durationMs <= 0) {
      this.applyInstant(from, target);
    } else {
      this.beginTransition(from, target, durationMs);
    }
    return target;
  }

  /** Convenience wrapper for slider input: `selectYear(1985)`. */
  selectYear(year: number, options: EraTransitionOptions = {}): EraId {
    return this.selectEra(year, options);
  }

  /* ---------------- subscriptions ---------------- */

  /**
   * Subscribes to selected-year changes (fires once per selection, not per
   * tween frame). Returns an unsubscribe function.
   */
  subscribe(listener: EraSelectionListener): () => void {
    this.selectionListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.selectionListeners.delete(listener);
    };
  }

  /**
   * Subscribes to per-frame tween progress, including the final frame where
   * `snapshot.transitioning === false`. Returns an unsubscribe function.
   */
  onProgress(listener: EraProgressListener): () => void {
    this.progressListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.progressListeners.delete(listener);
    };
  }

  /* ---------------- blendables ---------------- */

  /**
   * Registers an era-blendable system. By default it is immediately pushed into
   * sync: either `setEra(current, { immediate: true })` + `progress === 1` when
   * the timeline is settled, or the current eased progress when a tween is
   * already running.
   */
  registerBlendable(
    blendable: EraBlendable,
    options: TimelineBlendableOptions = {},
  ): EraBlendableRegistration {
    this.assertUsable();
    if (
      !blendable ||
      typeof blendable.setEra !== 'function' ||
      typeof blendable.updateEraTransition !== 'function'
    ) {
      throw new TypeError('registerBlendable() requires an object implementing EraBlendable.');
    }

    const id = options.id ?? `${this.systemId}-blendable-${this.sequence}`;
    if (this.blendables.has(id)) {
      throw new Error(`Blendable "${id}" is already registered.`);
    }

    const entry: BlendableEntry = { id, blendable, sequence: this.sequence };
    this.sequence += 1;
    this.blendables.set(id, entry);

    if (options.syncOnRegister ?? true) {
      const active = this.transition;
      const info: EraTransitionInfo = active
        ? {
            from: active.from,
            to: active.to,
            elapsedMs: active.elapsedMs,
            durationMs: active.durationMs,
            active: true,
          }
        : this.settledInfo();
      blendable.setEra(
        this.currentEra,
        active ? { durationMs: active.durationMs } : { immediate: true },
      );
      blendable.updateEraTransition(active ? this.progress : 1, info);
    }

    return new BlendableHandle(this, entry);
  }

  /**
   * Unregisters a blendable by handle, by the blendable itself, or by id.
   * Returns `false` when it was not registered.
   */
  unregisterBlendable(target: EraBlendableRegistration | EraBlendable | string): boolean {
    if (typeof target === 'string') return this.blendables.delete(target);
    if (target instanceof BlendableHandle) return this.blendables.delete(target.id);
    for (const entry of this.blendables.values()) {
      if (entry.blendable === target) {
        this.blendables.delete(entry.id);
        return true;
      }
    }
    return false;
  }

  hasBlendable(id: string): boolean {
    return this.blendables.has(id);
  }

  /* ---------------- tick integration ---------------- */

  /** Registers the timeline as a `SceneContext` system so it ticks with the loop. */
  attach(context: SceneContext, options: { id?: string; order?: number } = {}): this {
    this.assertUsable();
    if (this.registration) this.detach();
    const id = options.id ?? this.systemId;
    const order = options.order ?? this.order;
    this.registration = context.registerSystem(
      id,
      (_context: SceneContext, frame: FrameInfo) => {
        this.advance(frame.delta * 1000);
      },
      { order },
    );
    return this;
  }

  /** Removes the tick system; the timeline state and blendables stay intact. */
  detach(): void {
    this.registration?.dispose();
    this.registration = null;
  }

  /**
   * Advances the running tween by `deltaMs`. Called once per frame by the
   * registered `SceneContext` system; safe to call directly from tests.
   *
   * Returns `true` when a transition was advanced or completed.
   */
  advance(deltaMs: number): boolean {
    const active = this.transition;
    if (!active) return false;

    const step = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
    active.elapsedMs = Math.min(active.durationMs, active.elapsedMs + step);

    const rawProgress = active.durationMs <= 0 ? 1 : clamp01(active.elapsedMs / active.durationMs);
    const eased = smoothStep01(rawProgress);
    const complete = rawProgress >= 1;
    const info: EraTransitionInfo = {
      from: active.from,
      to: active.to,
      elapsedMs: active.elapsedMs,
      durationMs: active.durationMs,
      active: !complete,
    };

    for (const entry of this.blendables.values()) {
      entry.blendable.updateEraTransition(complete ? 1 : eased, info);
    }

    if (complete) {
      this.transition = null;
      this.appliedEra = active.to;
      this.publishProgress(info, 1, 1, false);
    } else {
      this.publishProgress(info, eased, rawProgress, true);
    }
    return true;
  }

  /** Detaches from the context, clears listeners and forgets every blendable. */
  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.detach();
    this.transition = null;
    this.blendables.clear();
    this.selectionListeners.clear();
    this.progressListeners.clear();
  }

  /* ---------------- internals ---------------- */

  private beginTransition(from: EraId, to: EraId, durationMs: number): void {
    this.transition = { from, to, durationMs, elapsedMs: 0 };
    const info: EraTransitionInfo = { from, to, elapsedMs: 0, durationMs, active: true };
    for (const entry of this.blendables.values()) {
      entry.blendable.setEra(to, { durationMs });
      entry.blendable.updateEraTransition(0, info);
    }
    this.publishProgress(info, 0, 0, true);
  }

  private applyInstant(from: EraId, to: EraId): void {
    this.transition = null;
    this.appliedEra = to;
    const info: EraTransitionInfo = { from, to, elapsedMs: 0, durationMs: 0, active: false };
    for (const entry of this.blendables.values()) {
      entry.blendable.setEra(to, { immediate: true });
      entry.blendable.updateEraTransition(1, info);
    }
    this.publishProgress(info, 1, 1, false);
  }

  private settledInfo(): EraTransitionInfo {
    return {
      from: this.currentEra,
      to: this.currentEra,
      elapsedMs: 0,
      durationMs: 0,
      active: false,
    };
  }

  private notifySelection(era: EraId): void {
    for (const listener of [...this.selectionListeners]) listener(era, this);
  }

  private publishProgress(
    info: EraTransitionInfo,
    progress: number,
    rawProgress: number,
    transitioning: boolean,
  ): void {
    if (this.progressListeners.size === 0) return;
    const snapshot: EraProgressSnapshot = {
      era: this.currentEra,
      year: eraYear(this.currentEra),
      from: info.from,
      to: info.to,
      progress,
      rawProgress,
      elapsedMs: info.elapsedMs,
      durationMs: info.durationMs,
      transitioning,
      descriptor: getEraDescriptor(this.currentEra),
    };
    for (const listener of [...this.progressListeners]) listener(snapshot, this);
  }

  private assertUsable(): void {
    if (this.disposedState) throw new Error('TimelineRuntime has been disposed.');
  }
}

/** Creates a timeline runtime (the `create` half of the lifecycle). */
export function createTimelineRuntime(options: TimelineRuntimeOptions = {}): TimelineRuntime {
  return new TimelineRuntime(options);
}
