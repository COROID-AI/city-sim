/**
 * Chrono City — era-transition orchestrator.
 *
 * One year selection must transform the *entire* block in front of the user:
 * the shared ~1.2 s tween across buildings, storefronts and their advertising,
 * vehicles, pedestrian outfits, street dressing, the soundscape, the colour
 * grade and the HUD — with an era whoosh, a grading sweep and a HUD caption,
 * and with no subsystem left behind in another year.
 *
 * This module is that single orchestration seam. It does **not** own content and
 * it never reaches into a sibling system directly: every era change goes through
 * `TimelineRuntime.selectEra()`, which fans out to each system that registered
 * as an `EraBlendable`. What the orchestrator adds on top is:
 *
 *   * **one entry point** — `selectYear()` / `selectEra()` — so the app, the HUD
 *     slider and browser harnesses all move the year the same way;
 *   * **one audible-seam rule** — the `AudioDirector` is registered with the
 *     timeline (when it is not already), so the timeline voices the era whoosh
 *     exactly once per change instead of every consumer playing its own;
 *   * **one caption** — each change announces itself through `HudApi.announceEra`
 *     so the year lands in the same live region as the rest of the HUD;
 *   * **one era event** — `EraChangeEvent` records the tween length, caption,
 *     whoosh provenance, peak grading sweep and the per-subsystem era state at
 *     the moment the change landed;
 *   * **one leak audit** — `audit()` compares every wired subsystem's reported
 *     era (and the era it is tweening from) with the timeline, and reports any
 *     disagreement as an era leak;
 *   * **peripheral sync** — systems that are not timeline blendables follow the
 *     selection through this seam (the inspection layer's per-year labels), so
 *     nothing keeps resolving copy in the previous era.
 *
 * Lifecycle:
 *   create    → `new EraTransitionOrchestrator({ timeline, systems })`.
 *   consume   → `selectYear()`, `snapshot()`, `audit()`, `lastEvent`.
 *   integrate → the startup sequence hands it every produced handle and
 *               publishes it on `window.__chronoCityEraOrchestrator`.
 *
 * The orchestrator is deliberately read-only with respect to visual content: it
 * composes, observes and reports; the producing modules keep owning their looks.
 */

import { eraYear, type EraId, type EraTransitionOptions } from '../core/eraContracts';
import type { SceneContext } from '../core/sceneContext';
import { getEraDescriptor } from '../era/eraDescriptors';
import {
  DEFAULT_ERA_TRANSITION_MS,
  type EraProgressSnapshot,
  type TimelineRuntime,
} from '../era/timelineRuntime';
import { ERA_WHOOSH_CUE } from '../audio/sfxSynth';
import type { AudioDirector } from '../audio/audioDirector';
import type { SoundscapeApi } from '../audio/soundscapeApi';
import type { BuildingsApi } from '../city/buildings/buildingsApi';
import type { PedestriansApi } from '../city/pedestrians/pedestriansApi';
import type { StorefrontsApi } from '../city/storefronts/storefrontsApi';
import type { TrafficApi } from '../city/traffic/trafficApi';
import type { EnvironmentApi } from '../environment/environmentApi';
import type { InspectionLayer } from '../interaction/pickingController';
import type { NavigationRig } from '../navigation/navigationRig';
import type { SweepState } from '../rendering/eraGrading';
import type { RenderPipelineApi } from '../rendering/renderPipelineApi';
import type { TourApi } from '../tour/tourApi';
import type { HudApi } from '../ui/hudApi';
import type { AdaptiveQualityMonitor } from './adaptiveQuality';

export const ERA_ORCHESTRATOR_VERSION = 1;

/** Global key the live orchestrator is published on for browser harnesses. */
export const ERA_ORCHESTRATOR_GLOBAL_KEY = '__chronoCityEraOrchestrator';

/** Blendable id the audio director registers under when the orchestrator wires it. */
export const ORCHESTRATOR_AUDIO_BLENDABLE_ID = 'era-transition-audio';

/** How many completed era events are retained for inspection. */
export const ERA_EVENT_HISTORY_LIMIT = 32;

/**
 * Every subsystem the orchestrator audits. The ids are the contract between the
 * composition test, the readiness report and the browser harness.
 */
export const ORCHESTRATED_SUBSYSTEM_IDS = Object.freeze([
  'buildings',
  'storefronts',
  'traffic',
  'pedestrians',
  'environment',
  'soundscape',
  'hud',
  'render',
  'tour',
  'navigation',
  'inspection',
  'audio',
] as const);

export type OrchestratedSubsystemId = (typeof ORCHESTRATED_SUBSYSTEM_IDS)[number];

/** The produced handles the orchestrator composes and audits. */
export interface OrchestratedSystems {
  readonly buildings?: BuildingsApi | null;
  readonly storefronts?: StorefrontsApi | null;
  readonly traffic?: TrafficApi | null;
  readonly pedestrians?: PedestriansApi | null;
  readonly environment?: EnvironmentApi | null;
  readonly soundscape?: SoundscapeApi | null;
  readonly hud?: HudApi | null;
  readonly render?: RenderPipelineApi | null;
  readonly tour?: TourApi | null;
  readonly navigation?: NavigationRig | null;
  readonly inspection?: InspectionLayer | null;
  readonly audio?: AudioDirector | null;
  /** Adaptive-quality guardrail, reported alongside the era systems. */
  readonly quality?: AdaptiveQualityMonitor | null;
}

/** One subsystem's era state, as the orchestrator reads it off the live handle. */
export interface SubsystemEraState {
  readonly id: OrchestratedSubsystemId;
  /** Era the subsystem is heading to / showing as its active era. */
  readonly era: EraId | null;
  /** Era the subsystem is heading to; `era` when settled. */
  readonly targetEra: EraId | null;
  /** Era the running tween departed from, or `null` when settled. */
  readonly fromEra: EraId | null;
  /**
   * Era the subsystem's content actually reads as once it is not morphing
   * (`null` while it is mid-tween). Never compared during a tween.
   */
  readonly settledEra: EraId | null;
  readonly transitioning: boolean;
  readonly progress: number;
  /** Small, primitives-only extra evidence (counts, ratios, modes). */
  readonly detail: Readonly<Record<string, number | string | boolean>>;
}

/** A subsystem era state plus the leak verdict for the current timeline phase. */
export interface SubsystemEraReport extends SubsystemEraState {
  /** `true` when this subsystem disagrees with the timeline. */
  readonly leaking: boolean;
  /** Why it disagrees, or `null` when it agrees. */
  readonly leakReason: string | null;
}

/** The no-era-leak verdict for one instant of the timeline. */
export interface EraLeakAudit {
  readonly era: EraId;
  readonly from: EraId;
  readonly to: EraId;
  readonly phase: 'settled' | 'transitioning';
  readonly ok: boolean;
  readonly leaks: readonly SubsystemEraReport[];
  readonly reports: readonly SubsystemEraReport[];
}

/** One orchestrated year change: the tween, its cues and what landed. */
export interface EraChangeEvent {
  readonly from: EraId;
  readonly to: EraId;
  readonly year: number;
  readonly durationMs: number;
  readonly caption: string;
  /** `true` when an audible era whoosh was voiced (unmuted). */
  readonly whoosh: boolean;
  readonly whooshSource: 'audio-blendable' | 'orchestrator' | 'none';
  /** `true` when a HUD caption toast was raised for this change. */
  readonly announced: boolean;
  /** Milliseconds since the orchestrator was created. */
  readonly startedAt: number;
  readonly completedAt: number | null;
  /** Peak grading-sweep amplitude observed during the tween, in `[0, 1]`. */
  readonly peakSweepIntensity: number;
  readonly sweepColor: number | null;
  readonly complete: boolean;
  /** `true` when another selection superseded this tween before it landed. */
  readonly superseded: boolean;
  readonly reports: readonly SubsystemEraReport[];
  readonly leaks: readonly SubsystemEraReport[];
}

/** Flat, serialisable view of the whole orchestration for tests and harnesses. */
export interface EraOrchestratorSnapshot {
  readonly version: number;
  readonly era: EraId;
  readonly year: number;
  readonly from: EraId;
  readonly to: EraId;
  readonly progress: number;
  readonly transitioning: boolean;
  /** Tween length the timeline is using (its default is the shared 1200 ms). */
  readonly tweenMs: number;
  readonly durationMs: number;
  readonly eventCount: number;
  readonly lastEvent: EraChangeEvent | null;
  readonly caption: string | null;
  readonly sweep: SweepState | null;
  readonly reports: readonly SubsystemEraReport[];
  readonly leaks: readonly SubsystemEraReport[];
  readonly quality: ReturnType<AdaptiveQualityMonitor['snapshot']> | null;
  readonly audio: {
    readonly unlocked: boolean;
    readonly muted: boolean;
    readonly era: EraId;
    readonly blendable: boolean;
  } | null;
  readonly navigation: { readonly mode: string; readonly moving: boolean } | null;
}

/** Called whenever an era change completes (or is superseded). */
export type EraChangeListener = (event: EraChangeEvent, orchestrator: EraTransitionOrchestrator) => void;

export interface EraTransitionOrchestratorOptions {
  /** The single year store every era change goes through. Required. */
  readonly timeline: TimelineRuntime;
  /** Scene context the app handle belongs to (used for discovery/reporting). */
  readonly context?: SceneContext | null;
  /** Produced handles to compose and audit. `connect()` adds more later. */
  readonly systems?: OrchestratedSystems;
  /** Announce every change through the HUD. Defaults to `true`. */
  readonly announce?: boolean;
  /**
   * Register the audio director with the timeline so the director's own
   * `setEra()` voices the era whoosh once per change. Defaults to `true`;
   * set `false` to have the orchestrator play the cue itself instead.
   */
  readonly attachAudioToTimeline?: boolean;
  readonly blendableId?: string;
}

interface MutableEvent {
  from: EraId;
  to: EraId;
  year: number;
  durationMs: number;
  caption: string;
  whoosh: boolean;
  whooshSource: EraChangeEvent['whooshSource'];
  announced: boolean;
  startedAt: number;
  completedAt: number | null;
  peakSweepIntensity: number;
  sweepColor: number | null;
  complete: boolean;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function captionFor(era: EraId): string {
  const descriptor = getEraDescriptor(era);
  return `${descriptor.year} — ${descriptor.label}`;
}

/**
 * Composes every produced system into one orchestrated era change and audits the
 * result for era leaks.
 */
export class EraTransitionOrchestrator {
  readonly version = ERA_ORCHESTRATOR_VERSION;

  readonly timeline: TimelineRuntime;
  readonly context: SceneContext | null;
  readonly tweenMs: number;

  private systemsState: OrchestratedSystems;
  private readonly announceEnabled: boolean;
  private readonly audioBlendableId: string;

  private readonly listeners = new Set<EraChangeListener>();
  private readonly history: EraChangeEvent[] = [];
  private readonly startedAtMs = nowMs();

  private audioBlendableState = false;
  private pendingSelection: EraId | null = null;
  private currentEvent: MutableEvent | null = null;
  private lastEventState: EraChangeEvent | null = null;
  private unsubscribeSelection: (() => void) | null = null;
  private unsubscribeProgress: (() => void) | null = null;
  private disposedState = false;

  constructor(options: EraTransitionOrchestratorOptions) {
    if (!options?.timeline) {
      throw new TypeError('EraTransitionOrchestrator needs a TimelineRuntime.');
    }
    this.timeline = options.timeline;
    this.context = options.context ?? null;
    this.tweenMs = DEFAULT_ERA_TRANSITION_MS;
    this.systemsState = { ...options.systems };
    this.announceEnabled = options.announce ?? true;
    this.audioBlendableId = options.blendableId ?? ORCHESTRATOR_AUDIO_BLENDABLE_ID;

    if (options.attachAudioToTimeline ?? true) this.attachAudioToTimeline();

    // The selection hook fires *before* the timeline starts the tween, so it only
    // records intent and syncs the peripherals; the event itself is built on the
    // first progress frame, after every blendable has been handed `setEra()`.
    this.unsubscribeSelection = this.timeline.subscribe((era) => this.handleSelection(era));
    this.unsubscribeProgress = this.timeline.onProgress((snapshot) =>
      this.handleProgress(snapshot),
    );
  }

  /* ------------------------------------------------------------------ *
   * composition
   * ------------------------------------------------------------------ */

  /** Adds or replaces produced handles after construction. */
  connect(systems: OrchestratedSystems): this {
    this.systemsState = { ...this.systemsState, ...systems };
    return this;
  }

  /** The handles currently composed. */
  get systems(): OrchestratedSystems {
    return this.systemsState;
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  /** `true` when the audio director voices the era seam through the timeline. */
  get isAudioBlendable(): boolean {
    return this.audioBlendableState;
  }

  /* ------------------------------------------------------------------ *
   * year selection
   * ------------------------------------------------------------------ */

  /**
   * Moves the whole city to a year through the timeline. Accepts any of the five
   * era ids, a numeric year or a numeric string; intermediate years snap to the
   * nearest authored era and out-of-range years clamp.
   */
  selectEra(value: EraId | number | string, options: EraTransitionOptions = {}): EraId {
    if (this.disposedState) throw new Error('EraTransitionOrchestrator has been disposed.');
    return this.timeline.selectEra(value, options);
  }

  /** Convenience wrapper for slider input: `selectYear(1985)`. */
  selectYear(year: number, options: EraTransitionOptions = {}): EraId {
    return this.selectEra(year, options);
  }

  /** The era the timeline currently has selected. */
  get era(): EraId {
    return this.timeline.era;
  }

  get year(): number {
    return this.timeline.year;
  }

  /* ------------------------------------------------------------------ *
   * observation
   * ------------------------------------------------------------------ */

  /** Every era event retained, oldest first. */
  get events(): readonly EraChangeEvent[] {
    return this.history;
  }

  /**
   * The most recent era event: the in-flight change while a tween runs, then the
   * last change that landed (or was superseded).
   */
  get lastEvent(): EraChangeEvent | null {
    const current = this.currentEvent;
    if (current) {
      return this.buildEvent(current, { complete: false, superseded: false, completedAt: null });
    }
    return this.lastEventState;
  }

  /** The grading sweep currently applied to the frame, if a pipeline is wired. */
  sweep(): SweepState | null {
    return this.systemsState.render?.gradeState().sweep ?? null;
  }

  /**
   * Reads every wired subsystem's era state. Subsystems that are not wired (or
   * that carry no era, like the navigation rig) are simply absent.
   */
  reports(): readonly SubsystemEraReport[] {
    const snapshot = this.timeline.snapshot;
    const settled = !snapshot.transitioning;
    const out: SubsystemEraReport[] = [];
    for (const id of ORCHESTRATED_SUBSYSTEM_IDS) {
      const state = this.readState(id, snapshot, settled);
      if (!state) continue;
      out.push(this.judge(state, snapshot, settled));
    }
    return out;
  }

  /**
   * The no-era-leak verdict for the timeline's current phase: every subsystem
   * must target the timeline's era (and tween from its source era), and once the
   * tween has landed every subsystem must actually read as that era.
   */
  audit(): EraLeakAudit {
    const snapshot = this.timeline.snapshot;
    const settled = !snapshot.transitioning;
    const reports = this.reports();
    const leaks = reports.filter((report) => report.leaking);
    return Object.freeze({
      era: snapshot.era,
      from: snapshot.from,
      to: snapshot.to,
      phase: settled ? 'settled' : 'transitioning',
      ok: leaks.length === 0,
      leaks: Object.freeze(leaks),
      reports: Object.freeze(reports),
    });
  }

  snapshot(): EraOrchestratorSnapshot {
    const snapshot = this.timeline.snapshot;
    const reports = this.reports();
    const audio = this.systemsState.audio;
    const navigation = this.systemsState.navigation;
    const quality = this.systemsState.quality;
    return Object.freeze({
      version: ERA_ORCHESTRATOR_VERSION,
      era: snapshot.era,
      year: snapshot.year,
      from: snapshot.from,
      to: snapshot.to,
      progress: snapshot.progress,
      transitioning: snapshot.transitioning,
      tweenMs: this.tweenMs,
      durationMs: snapshot.durationMs,
      eventCount: this.history.length,
      lastEvent: this.lastEventState,
      caption: this.lastEventState ? this.lastEventState.caption : null,
      sweep: this.sweep(),
      reports: Object.freeze(reports),
      leaks: Object.freeze(reports.filter((report) => report.leaking)),
      quality: quality ? quality.snapshot() : null,
      audio: audio
        ? {
            unlocked: audio.isUnlocked,
            muted: audio.isMuted,
            era: audio.eraTarget,
            blendable: this.audioBlendableState,
          }
        : null,
      navigation: navigation
        ? { mode: navigation.mode, moving: navigation.moving }
        : null,
    });
  }

  /** Subscribes to completed era events. Returns an unsubscribe function. */
  subscribe(listener: EraChangeListener): () => void {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.unsubscribeSelection?.();
    this.unsubscribeSelection = null;
    this.unsubscribeProgress?.();
    this.unsubscribeProgress = null;
    if (this.audioBlendableState) {
      const audio = this.systemsState.audio;
      if (audio) this.timeline.unregisterBlendable(audio);
      this.audioBlendableState = false;
    }
    this.listeners.clear();
  }

  /* ------------------------------------------------------------------ *
   * internals — audio seam
   * ------------------------------------------------------------------ */

  /**
   * Registers the audio director with the timeline so the era whoosh is voiced
   * exactly once, by the director's own `setEra()`. Falls back silently when the
   * director is already registered or cannot be registered, in which case the
   * orchestrator voices the cue itself on each change.
   */
  private attachAudioToTimeline(): void {
    const audio = this.systemsState.audio;
    if (!audio || this.timeline.isDisposed) {
      this.audioBlendableState = false;
      return;
    }
    try {
      if (this.timeline.hasBlendable(this.audioBlendableId)) {
        this.audioBlendableState = true;
        return;
      }
      this.timeline.registerBlendable(audio, { id: this.audioBlendableId });
      this.audioBlendableState = true;
    } catch (error) {
      this.audioBlendableState = false;
      if (typeof console !== 'undefined') {
        console.warn(
          '[chrono-city] era orchestrator: audio will voice the whoosh itself',
          error,
        );
      }
    }
  }

  private voiceWhoosh(era: EraId): void {
    const audio = this.systemsState.audio;
    if (!audio) return;
    try {
      audio.play(ERA_WHOOSH_CUE, { gain: 1, era });
    } catch (error) {
      if (typeof console !== 'undefined') {
        console.warn('[chrono-city] era orchestrator: whoosh failed', error);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * internals — events
   * ------------------------------------------------------------------ */

  private handleSelection(era: EraId): void {
    if (this.disposedState) return;
    this.pendingSelection = era;
    // The inspection layer resolves per-year labels but is not a timeline
    // blendable, so the orchestrator is the single place that keeps it in sync.
    this.systemsState.inspection?.setEra(era);
  }

  private handleProgress(snapshot: EraProgressSnapshot): void {
    if (this.disposedState) return;
    const settled = !snapshot.transitioning;

    const sweep = this.sweep();
    if (sweep && this.currentEvent) {
      this.currentEvent.peakSweepIntensity = Math.max(
        this.currentEvent.peakSweepIntensity,
        sweep.intensity,
      );
      if (sweep.intensity > 0) this.currentEvent.sweepColor = sweep.color;
    }

    const pending = this.pendingSelection;
    if (pending !== null) {
      this.pendingSelection = null;
      this.closeCurrentEvent(snapshot, true);
      this.beginEvent(snapshot, pending, settled);
    }

    if (settled) this.closeCurrentEvent(snapshot, false);
  }

  private beginEvent(snapshot: EraProgressSnapshot, to: EraId, settled: boolean): void {
    const from = snapshot.from;
    const durationMs = settled ? 0 : snapshot.durationMs;
    const tweening = durationMs > 0;
    const audio = this.systemsState.audio;
    const muted = audio ? audio.isMuted : false;

    let whoosh = false;
    let whooshSource: EraChangeEvent['whooshSource'] = 'none';
    if (tweening && audio && !muted) {
      if (this.audioBlendableState) {
        whoosh = true;
        whooshSource = 'audio-blendable';
      } else {
        this.voiceWhoosh(to);
        whoosh = true;
        whooshSource = 'orchestrator';
      }
    }

    let announced = false;
    const hud = this.systemsState.hud;
    if (hud && this.announceEnabled) {
      try {
        hud.announceEra(to);
        announced = true;
      } catch (error) {
        if (typeof console !== 'undefined') {
          console.warn('[chrono-city] era orchestrator: caption failed', error);
        }
      }
    }

    const sweep = this.sweep();
    this.currentEvent = {
      from,
      to,
      year: eraYear(to),
      durationMs,
      caption: captionFor(to),
      whoosh,
      whooshSource,
      announced,
      startedAt: nowMs() - this.startedAtMs,
      completedAt: null,
      peakSweepIntensity: sweep ? sweep.intensity : 0,
      sweepColor: sweep && sweep.intensity > 0 ? sweep.color : null,
      complete: false,
    };
  }

  private closeCurrentEvent(snapshot: EraProgressSnapshot, superseded: boolean): void {
    const event = this.currentEvent;
    if (!event) return;
    this.currentEvent = null;
    const finished = this.buildEvent(event, {
      complete: !superseded && snapshot.era === event.to,
      superseded,
      completedAt: nowMs() - this.startedAtMs,
    });

    this.lastEventState = finished;
    this.history.push(finished);
    while (this.history.length > ERA_EVENT_HISTORY_LIMIT) this.history.shift();
    for (const listener of [...this.listeners]) {
      try {
        listener(finished, this);
      } catch (error) {
        if (typeof console !== 'undefined') {
          console.error('[chrono-city] era orchestrator listener failed', error);
        }
      }
    }
  }

  /**
   * Freezes one event with its leak verdict for the current instant. A superseded
   * tween claims nothing (its tween never landed); an in-flight event reports the
   * state it is in right now.
   */
  private buildEvent(
    event: MutableEvent,
    options: { complete: boolean; superseded: boolean; completedAt: number | null },
  ): EraChangeEvent {
    const audit = this.audit();
    return Object.freeze({
      from: event.from,
      to: event.to,
      year: event.year,
      durationMs: event.durationMs,
      caption: event.caption,
      whoosh: event.whoosh,
      whooshSource: event.whooshSource,
      announced: event.announced,
      startedAt: event.startedAt,
      completedAt: options.completedAt,
      peakSweepIntensity: event.peakSweepIntensity,
      sweepColor: event.sweepColor,
      complete: options.complete,
      superseded: options.superseded,
      reports: audit.reports,
      leaks: options.superseded
        ? Object.freeze([])
        : Object.freeze(audit.reports.filter((report) => report.leaking)),
    });
  }

  /* ------------------------------------------------------------------ *
   * internals — subsystem reading
   * ------------------------------------------------------------------ */

  private readState(
    id: OrchestratedSubsystemId,
    snapshot: EraProgressSnapshot,
    settled: boolean,
  ): SubsystemEraState | null {
    switch (id) {
      case 'buildings': {
        const api = this.systemsState.buildings;
        if (!api) return null;
        const morphing = api.isTransitioning;
        return {
          id,
          era: api.era,
          targetEra: api.era,
          fromEra: morphing ? api.from : null,
          settledEra: morphing ? null : api.era,
          transitioning: morphing,
          progress: api.progress,
          detail: { animated: api.isAnimated },
        };
      }
      case 'storefronts': {
        const api = this.systemsState.storefronts;
        if (!api) return null;
        const morphing = api.isTransitioning;
        return {
          id,
          era: api.era,
          targetEra: api.era,
          fromEra: morphing ? api.from : null,
          settledEra: morphing ? null : api.era,
          transitioning: morphing,
          progress: api.progress,
          detail: { animated: api.isAnimated },
        };
      }
      case 'traffic': {
        const api = this.systemsState.traffic;
        if (!api) return null;
        const fleet = api.snapshot();
        return {
          id,
          era: fleet.targetEra,
          targetEra: fleet.targetEra,
          fromEra: null,
          settledEra: fleet.transitioning ? null : fleet.era,
          transitioning: fleet.transitioning,
          progress: fleet.transitioning ? snapshot.progress : 1,
          detail: {
            fleetEra: fleet.era,
            vehicles: fleet.fleetSize,
            activeEras: [...fleet.activeEras].join(','),
          },
        };
      }
      case 'pedestrians': {
        const api = this.systemsState.pedestrians;
        if (!api) return null;
        return {
          id,
          era: api.era,
          targetEra: api.era,
          fromEra: null,
          settledEra: api.outfitEra,
          transitioning: api.outfitBlend < 1,
          progress: api.outfitBlend,
          detail: {
            outfitEra: api.outfitEra,
            outfitBlend: api.outfitBlend,
            crowd: api.snapshots.length,
          },
        };
      }
      case 'environment': {
        const api = this.systemsState.environment;
        if (!api) return null;
        const morphing = api.isTransitioning;
        const grade = api.gradeState();
        const dressing = api.snapshot().dressing;
        return {
          id,
          era: api.era,
          targetEra: api.era,
          fromEra: morphing ? api.from : null,
          settledEra: morphing ? null : api.era,
          transitioning: morphing,
          progress: api.progress,
          detail: {
            exposure: grade.exposure,
            contrast: grade.contrast,
            dressingEra: dressing.era,
            dressingPlacements: dressing.totalPlacements,
            lampStyle: dressing.lampStyle,
          },
        };
      }
      case 'soundscape': {
        const api = this.systemsState.soundscape;
        if (!api) return null;
        const state = api.snapshot();
        return {
          id,
          era: state.era,
          targetEra: state.era,
          fromEra: state.transitioning ? state.from : null,
          settledEra: state.transitioning ? null : state.era,
          transitioning: state.transitioning,
          progress: state.progress,
          detail: {
            audibleLayers: state.audibleLayers.length,
            layerCount: state.layerCount,
            enabled: state.enabled,
          },
        };
      }
      case 'hud': {
        const api = this.systemsState.hud;
        if (!api) return null;
        const state = api.snapshot();
        return {
          id,
          era: state.era,
          targetEra: state.era,
          fromEra: null,
          settledEra: state.era,
          transitioning: state.transitioning,
          progress: state.progress,
          detail: { year: state.year, attached: state.attached, toasts: state.toasts.length },
        };
      }
      case 'render': {
        const api = this.systemsState.render;
        if (!api) return null;
        const state = api.snapshot();
        return {
          id,
          era: state.era,
          targetEra: state.era,
          fromEra: state.transitioning ? state.from : null,
          settledEra: state.transitioning ? null : state.era,
          transitioning: state.transitioning,
          progress: state.progress,
          detail: {
            look: api.gradeState().look.id,
            quality: state.postFx.quality,
            renderAttached: state.renderAttached,
          },
        };
      }
      case 'tour': {
        const api = this.systemsState.tour;
        if (!api) return null;
        const state = api.snapshot();
        return {
          id,
          era: state.era,
          targetEra: state.era,
          fromEra: null,
          settledEra: state.era,
          transitioning: state.introActive || state.running,
          progress: settled ? 1 : snapshot.progress,
          detail: {
            state: state.state,
            intro: state.introActive,
            caption: state.caption ?? '',
          },
        };
      }
      case 'navigation': {
        const api = this.systemsState.navigation;
        if (!api) return null;
        // The rig carries no era by design: it is reported as composed evidence
        // that navigation keeps working through every era change.
        return {
          id,
          era: null,
          targetEra: null,
          fromEra: null,
          settledEra: null,
          transitioning: false,
          progress: 1,
          detail: { mode: api.mode, moving: api.moving, pointerLocked: api.pointerLocked },
        };
      }
      case 'inspection': {
        const api = this.systemsState.inspection;
        if (!api) return null;
        return {
          id,
          era: api.era,
          targetEra: api.era,
          fromEra: null,
          settledEra: api.era,
          transitioning: false,
          progress: 1,
          detail: { open: api.isOpen },
        };
      }
      case 'audio': {
        const api = this.systemsState.audio;
        if (!api) return null;
        const morphing = api.eraTransitionActive;
        return {
          id,
          era: api.eraTarget,
          targetEra: api.eraTarget,
          fromEra: morphing ? api.eraFrom : null,
          settledEra: morphing ? null : api.era,
          transitioning: morphing,
          progress: api.eraBlend,
          detail: {
            blendable: this.audioBlendableState,
            unlocked: api.isUnlocked,
            muted: api.isMuted,
            activeVoices: api.activeVoiceCount,
          },
        };
      }
      default:
        return null;
    }
  }

  private judge(
    state: SubsystemEraState,
    snapshot: EraProgressSnapshot,
    settled: boolean,
  ): SubsystemEraReport {
    const expectedEra = snapshot.era;
    const expectedFrom = snapshot.from;
    let leakReason: string | null = null;

    if (state.targetEra !== null && state.targetEra !== expectedEra) {
      leakReason = `targets ${state.targetEra} while the timeline is at ${expectedEra}`;
    } else if (state.era !== null && state.era !== expectedEra) {
      leakReason = `reports ${state.era} while the timeline is at ${expectedEra}`;
    } else if (!settled && state.fromEra !== null && state.fromEra !== expectedFrom) {
      leakReason = `tweens from ${state.fromEra} while the timeline departs ${expectedFrom}`;
    } else if (settled && state.settledEra !== null && state.settledEra !== expectedEra) {
      leakReason = `still reads as ${state.settledEra} after the tween landed on ${expectedEra}`;
    }

    return Object.freeze({
      ...state,
      leaking: leakReason !== null,
      leakReason,
    });
  }
}

/** Creates an orchestrator (the `create` half of the lifecycle). */
export function createEraTransitionOrchestrator(
  options: EraTransitionOrchestratorOptions,
): EraTransitionOrchestrator {
  return new EraTransitionOrchestrator(options);
}

/** Publishes the orchestrator on `window` for overlays and browser harnesses. */
export function integrateOrchestratorGlobal(
  orchestrator: EraTransitionOrchestrator,
  key: string = ERA_ORCHESTRATOR_GLOBAL_KEY,
): EraTransitionOrchestrator {
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>)[key] = orchestrator;
    if (typeof CustomEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent('chrono-city:orchestrator-ready', { detail: orchestrator }),
      );
    }
  }
  return orchestrator;
}

/** Removes a published orchestrator (only when the handle still points at it). */
export function detachOrchestratorGlobal(
  key: string = ERA_ORCHESTRATOR_GLOBAL_KEY,
  orchestrator?: EraTransitionOrchestrator,
): void {
  if (typeof window === 'undefined') return;
  const scope = window as unknown as Record<string, unknown>;
  if (orchestrator && scope[key] !== orchestrator) return;
  delete scope[key];
}

/** The published orchestrator, or `null` before the city is composed. */
export function getEraTransitionOrchestrator(
  key: string = ERA_ORCHESTRATOR_GLOBAL_KEY,
): EraTransitionOrchestrator | null {
  if (typeof window === 'undefined') return null;
  const value = (window as unknown as Record<string, unknown>)[key];
  return value instanceof EraTransitionOrchestrator ? value : null;
}

declare global {
  interface Window {
    __chronoCityEraOrchestrator?: EraTransitionOrchestrator;
  }
}
