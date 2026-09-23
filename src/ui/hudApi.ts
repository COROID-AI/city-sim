/**
 * Chrono City — HudApi: the application's heads-up display.
 *
 * `HudApi` owns the polished top-of-screen chrome and is the single object the
 * rest of the app talks to about HUD concerns:
 *
 *  - a top-centre `TimelineSlider` with exactly five era stops (1945, 1965,
 *    1985, 2005, 2025) driven by click, drag, touch and the keyboard;
 *  - the active era title / tooltip, rendered from the shared era descriptors;
 *  - an audio unlock / mute toggle wired to the `AudioDirector`, plus the
 *    UI click/tick SFX every slider and HUD interaction voices;
 *  - a controls help overlay (`HelpOverlay`), kept mode-aware from
 *    `NavigationRig.mode`;
 *  - `toast()` / `eraInfo()` helpers for every other system, and a global
 *    handle (`window.__chronoCityHud`) for browser harnesses.
 *
 * Year state flows in exactly one direction at a time:
 *   user gesture → slider `onInteract` → `HudApi` → `TimelineRuntime.selectEra`
 *   `TimelineRuntime` → `SceneContext` tick → `HudApi.refresh` → slider mirror
 *                                  → aria + era title/tooltip readouts
 *
 * The HUD never mutates scene systems directly — pointer and key gestures are
 * consumed before they can reach the camera rig, and the overlay root is
 * pointer-transparent outside each widget's own bounds.
 *
 * Lifecycle:
 *   create    → `createHudApi()` / `new HudApi(options)`; `bootHudApi()`
 *               discovers the live scene, audio and timeline handles.
 *   consume   → `toast()`, `eraInfo()`, `selectEra()`, `toggleMute()`,
 *               `toggleHelp()`, `snapshot()`.
 *   integrate → the app boots one `HudApi` (usually `bootHudApi()` once the
 *               scene is live) and publishes it on `window.__chronoCityHud`.
 *               Publish the shared year store on `window.__chronoCityTimeline`
 *               first, so the HUD mirrors that runtime instead of creating one.
 */

import './hud.css';

import { UI_CLICK_CUE } from '../audio/sfxSynth';
import { AUDIO_GLOBAL_KEY, getAudioDirector, type AudioDirector } from '../audio/audioDirector';
import {
  ERA_IDS,
  assertEraId,
  isEraId,
  type EraId,
  type EraTransitionOptions,
} from '../core/eraContracts';
import {
  CHRONO_CITY_GLOBAL_KEY,
  SceneContext,
  type SystemRegistration,
} from '../core/sceneContext';
import { getEraDescriptor } from '../era/eraDescriptors';
import { createTimelineRuntime, type TimelineRuntime } from '../era/timelineRuntime';
import { createHelpOverlay, type HelpOverlay } from './helpOverlay';
import {
  createTimelineSlider,
  type TimelineInteraction,
  type TimelineSlider,
  type TimelineSoundKind,
} from './timelineSlider';

export const HUD_API_VERSION = 1;

/** Global key the live HUD is published on for overlays and harnesses. */
export const HUD_GLOBAL_KEY = '__chronoCityHud';

/** Global key a shared timeline runtime may be published on by the app. */
export const TIMELINE_GLOBAL_KEY = '__chronoCityTimeline';

/** Root attribute marking the HUD (and its state) for harness probes. */
export const HUD_ATTRIBUTE = 'data-chrono-hud';

/** Stable query hooks so browser specs never depend on class names. */
export const HUD_SELECTORS = Object.freeze({
  root: `[${HUD_ATTRIBUTE}="root"]`,
  timelineSlot: `[${HUD_ATTRIBUTE}="timeline-slot"]`,
  actions: `[${HUD_ATTRIBUTE}="actions"]`,
  mute: `[${HUD_ATTRIBUTE}="mute"]`,
  help: `[${HUD_ATTRIBUTE}="help"]`,
  toasts: `[${HUD_ATTRIBUTE}="toasts"]`,
  toast: `[${HUD_ATTRIBUTE}="toast"]`,
});

/** Tick-registry id the HUD sync registers under. */
export const HUD_SYSTEM_ID = 'chrono-hud';

/** Late in the frame: the timeline has advanced and audio has framed. */
export const HUD_SYSTEM_ORDER = 100;

/** Cue voices: a crisp "click" for deliberate picks, a lighter "tick" for steps. */
export const HUD_CLICK_GAIN = 0.9;
export const HUD_CLICK_RATE = 1;
export const HUD_TICK_GAIN = 0.72;
export const HUD_TICK_RATE = 1.24;

/** Default era-change tween length for HUD-driven selections (snappy). */
export const HUD_SELECTION_DURATION_MS = 700;

/** Default toast lifetime in milliseconds. */
export const HUD_TOAST_DURATION_MS = 4200;

export type HudToastTone = 'info' | 'era' | 'audio' | 'warning';

/** Flat, serialisable view of the HUD for tests and browser harnesses. */
export interface HudSnapshot {
  readonly version: number;
  readonly era: EraId;
  readonly year: number;
  readonly stops: readonly number[];
  readonly transitioning: boolean;
  readonly progress: number;
  readonly muted: boolean;
  readonly audioUnlocked: boolean;
  readonly helpOpen: boolean;
  readonly toasts: readonly string[];
  readonly attached: boolean;
  readonly timeline: 'shared' | 'internal';
}

/** Everything the HUD can say about one era. */
export interface HudEraInfo {
  readonly era: EraId;
  readonly year: number;
  readonly label: string;
  readonly description: string;
  /** Zero-based position on the timeline. */
  readonly index: number;
  /** Number of authored eras. */
  readonly total: number;
  readonly soundscapeId: string;
  /** Era the running tween departed from. */
  readonly from: EraId;
  /** Era the running tween is heading to. */
  readonly to: EraId;
  readonly transitioning: boolean;
  readonly progress: number;
}

export interface HudToastOptions {
  /** Stable id; auto-generated when omitted. Re-using an id replaces the toast. */
  readonly id?: string;
  readonly tone?: HudToastTone;
  /** Optional bold lead-in line. */
  readonly title?: string;
  /** Era badge shown on the toast. */
  readonly era?: EraId;
  /** Lifetime in ms; `0` keeps it until dismissed. Defaults to 4200. */
  readonly durationMs?: number;
  /** UI cue to voice; `null` silences this toast. Defaults to a soft tick. */
  readonly sound?: TimelineSoundKind | null;
}

export interface HudToastHandle {
  readonly id: string;
  readonly message: string;
  readonly element: HTMLElement;
  dismiss(): void;
}

/** Select an era through the HUD, optionally announcing it as a toast. */
export interface HudEraSelectOptions extends EraTransitionOptions {
  readonly announce?: boolean;
}

/** Minimal view of the navigation rig the help copy needs. */
export interface NavigationHelpSource {
  readonly mode?: string;
}

export interface HudApiOptions {
  /** Scene to join. When supplied the HUD registers its per-frame sync tick. */
  readonly context?: SceneContext | null;
  /**
   * Authoritative year store. Pass the shared runtime so the HUD can never
   * fork year state; an internal runtime is created when omitted.
   */
  readonly timeline?: TimelineRuntime | null;
  /** Audio engine used for unlock / mute and the UI cues. */
  readonly audio?: AudioDirector | null;
  /** Element the HUD mounts into. Defaults to `context.overlayRoot`, then `[data-chrono-overlay]`. */
  readonly root?: HTMLElement | null;
  readonly document?: Document | null;
  /** Live navigation mode source, used to keep the help copy accurate. */
  readonly navigation?: NavigationHelpSource | null;
  /** Create the timeline slider. Defaults to `true`. */
  readonly slider?: boolean;
  /** Create the controls help overlay. Defaults to `true`. */
  readonly help?: boolean;
  /** Bind the `H` / `M` shortcuts. Defaults to `true`. */
  readonly shortcuts?: boolean;
  /** Tween length for HUD-driven selections. Defaults to `HUD_SELECTION_DURATION_MS`. */
  readonly selectionDurationMs?: number;
  /** Default toast lifetime in ms. Defaults to `HUD_TOAST_DURATION_MS`. */
  readonly toastDurationMs?: number;
  /** Publish the HUD on `window.__chronoCityHud`. Defaults to `true` in a DOM. */
  readonly integrateGlobal?: boolean;
  readonly globalKey?: string;
  readonly systemId?: string;
  readonly order?: number;
  /** Called after a toast is created; handy for harnesses and tests. */
  readonly onToast?: (handle: HudToastHandle) => void;
}

/** Boot options: `bootHudApi()` additionally discovers the live app handles. */
export interface HudBootOptions extends HudApiOptions {
  /** Global key the scene app handle is published on. Defaults to `__chronoCity`. */
  readonly appKey?: string;
  /** Global key the audio director is published on. Defaults to `__chronoCityAudio`. */
  readonly audioKey?: string;
  /** Global key a shared timeline runtime may be published on. */
  readonly timelineKey?: string;
}

/* ------------------------------------------------------------------------- *
 * Helpers
 * ------------------------------------------------------------------------- */

function createElement<K extends keyof HTMLElementTagNameMap>(
  documentRef: Document,
  tag: K,
  className?: string,
  attributes: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const element = documentRef.createElement(tag);
  if (className) element.className = className;
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/** Year lookup used to snap an arbitrary value onto one of the five eras. */
function eraYearOf(era: EraId): number {
  return Number.parseInt(era, 10);
}

/** Normalises `EraId | year | numeric string` onto a canonical era. */
function resolveEraValue(value: EraId | number | string): EraId {
  if (isEraId(value)) return value;
  const year = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(year)) return assertEraId(value);
  let best: EraId = ERA_IDS[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const era of ERA_IDS) {
    const delta = Math.abs(eraYearOf(era) - year);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = era;
    }
  }
  return best;
}

/* ------------------------------------------------------------------------- *
 * HudApi
 * ------------------------------------------------------------------------- */

/**
 * The heads-up display. Builds its chrome inside the scene overlay root, keeps
 * the slider mirrored from the timeline on every tick, and exposes the
 * toast / era-info helpers other systems use to talk to the player.
 */
export class HudApi {
  readonly version = HUD_API_VERSION;

  /** Root element (`<div>`); carries the HUD state attributes. */
  readonly root: HTMLElement;
  /** Mount point for the timeline slider (top centre). */
  readonly timelineSlot: HTMLElement;
  /** Actions cluster (help + mute). */
  readonly actionsElement: HTMLElement;
  /** Toast stack (`aria-live` region). */
  readonly toastsRegion: HTMLElement;
  /** Help toggle button, or `null` when the chrome is disabled. */
  readonly helpButton: HTMLButtonElement | null;
  /** Mute toggle button, or `null` when the chrome is disabled. */
  readonly muteButton: HTMLButtonElement | null;

  private readonly documentRef: Document;
  private readonly ownsTimeline: boolean;
  private readonly selectionDurationMs: number;
  private readonly toastDurationMs: number;
  private readonly systemId: string;
  private readonly systemOrder: number;
  private readonly onToastCallback: ((handle: HudToastHandle) => void) | undefined;
  private readonly shortcutsEnabled: boolean;

  private timelineState: TimelineRuntime;
  private audioState: AudioDirector | null;
  private contextState: SceneContext | null;
  private navigationState: NavigationHelpSource | null;
  private sliderState: TimelineSlider | null = null;
  private helpWidget: HelpOverlay | null = null;

  private registration: SystemRegistration | null = null;
  private muteLabelElement: HTMLElement | null = null;
  private shortcutTarget: EventTarget | null = null;
  private lastEra: EraId | null = null;
  private readonly globalKey: string;
  private toastSequence = 0;
  private readonly toastTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly toastMessages = new Map<string, string>();
  private disposedState = false;

  constructor(options: HudApiOptions = {}) {
    this.documentRef = options.document ?? (typeof document !== 'undefined' ? document : null) ?? resolveOwnerDocument(options.root);
    this.systemId = options.systemId ?? HUD_SYSTEM_ID;
    this.systemOrder = options.order ?? HUD_SYSTEM_ORDER;
    this.selectionDurationMs = options.selectionDurationMs ?? HUD_SELECTION_DURATION_MS;
    this.toastDurationMs = options.toastDurationMs ?? HUD_TOAST_DURATION_MS;
    this.shortcutsEnabled = options.shortcuts ?? true;
    this.globalKey = options.globalKey ?? HUD_GLOBAL_KEY;
    this.onToastCallback = options.onToast;
    this.audioState = options.audio ?? null;
    this.navigationState = options.navigation ?? null;

    this.ownsTimeline = !options.timeline;
    this.timelineState = options.timeline ?? createTimelineRuntime();

    const overlayRoot = options.root ?? options.context?.overlayRoot ?? null;
    const mount = overlayRoot ?? this.documentRef.querySelector<HTMLElement>('[data-chrono-overlay]') ?? this.documentRef.body;
    if (!mount) {
      throw new Error('createHudApi() needs an overlay root or a document body.');
    }

    const root = createElement(this.documentRef, 'div', 'chrono-hud', {
      [HUD_ATTRIBUTE]: 'root',
      'data-chrono-hud-timeline': this.ownsTimeline ? 'internal' : 'shared',
    });
    Object.assign(root.style, {
      // Click-through everywhere except the widgets themselves: camera drags
      // must survive a HUD in the middle of the viewport.
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    const top = createElement(this.documentRef, 'div', 'chrono-hud__top');
    const brand = createElement(this.documentRef, 'div', 'chrono-hud__brand');
    brand.setAttribute('aria-hidden', 'true');
    const mark = createElement(this.documentRef, 'span', 'chrono-hud__mark', { 'aria-hidden': 'true' });
    const wordmark = createElement(this.documentRef, 'span', 'chrono-hud__wordmark');
    wordmark.textContent = 'Chrono City';
    brand.appendChild(mark);
    brand.appendChild(wordmark);

    const slot = createElement(this.documentRef, 'div', 'chrono-hud__center', {
      [HUD_ATTRIBUTE]: 'timeline-slot',
    });
    const actions = createElement(this.documentRef, 'div', 'chrono-hud__actions', {
      [HUD_ATTRIBUTE]: 'actions',
    });
    Object.assign(actions.style, { pointerEvents: 'auto' } satisfies Partial<CSSStyleDeclaration>);

    this.helpButton = this.createActionButton(actions, {
      attribute: 'help',
      label: 'Controls',
      glyph: '?',
      title: 'Controls (H)',
    }).button;
    const muteAction = this.createActionButton(actions, {
      attribute: 'mute',
      label: 'Sound',
      glyph: '♪',
      title: 'Sound (M)',
    });
    this.muteButton = muteAction.button;
    this.muteLabelElement = muteAction.label;

    top.appendChild(brand);
    top.appendChild(slot);
    top.appendChild(actions);
    root.appendChild(top);

    const toasts = createElement(this.documentRef, 'div', 'chrono-hud__toasts', {
      [HUD_ATTRIBUTE]: 'toasts',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'false',
    });
    Object.assign(toasts.style, { pointerEvents: 'auto' } satisfies Partial<CSSStyleDeclaration>);
    root.appendChild(toasts);

    mount.appendChild(root);

    this.root = root;
    this.timelineSlot = slot;
    this.actionsElement = actions;
    this.toastsRegion = toasts;

    if (options.slider ?? true) {
      this.sliderState = createTimelineSlider({
        root: slot,
        document: this.documentRef,
        onInteract: this.handleSliderInteraction,
      });
    }
    if (options.help ?? true) {
      this.helpWidget = createHelpOverlay({
        root,
        document: this.documentRef,
        onOpenChange: this.handleHelpOpenChange,
      });
      this.handleHelpOpenChange(this.helpWidget.isOpen);
    }

    this.helpButton?.addEventListener('click', this.handleHelpClick);
    this.muteButton?.addEventListener('click', this.handleMuteClick);

    if (this.shortcutsEnabled) {
      this.shortcutTarget =
        typeof window !== 'undefined' ? window : this.documentRef;
      this.shortcutTarget.addEventListener('keydown', this.handleShortcut);
    }

    this.contextState = options.context ?? null;
    if (this.contextState) this.attach(this.contextState);
    this.refresh(true);

    if (options.integrateGlobal ?? typeof window !== 'undefined') {
      integrateHudGlobal(this, this.globalKey);
    }
  }

  /* ---------------- accessors ---------------- */

  /** Authoritative year store the HUD mirrors. */
  get timeline(): TimelineRuntime {
    return this.timelineState;
  }

  /** Audio engine, or `null` when the HUD runs without sound. */
  get audio(): AudioDirector | null {
    return this.audioState;
  }

  /** Scene the HUD ticks with, or `null`. */
  get context(): SceneContext | null {
    return this.contextState;
  }

  /** The slider widget, or `null` when the chrome is disabled. */
  get slider(): TimelineSlider | null {
    return this.sliderState;
  }

  /** The help overlay, or `null` when the chrome is disabled. */
  get help(): HelpOverlay | null {
    return this.helpWidget;
  }

  /** Selected era, mirrored from the timeline. */
  get era(): EraId {
    return this.timelineState.era;
  }

  /** Selected year, mirrored from the timeline. */
  get year(): number {
    return this.timelineState.year;
  }

  get isAttached(): boolean {
    return this.registration !== null;
  }

  get isMuted(): boolean {
    return this.audioState?.isMuted ?? false;
  }

  get isAudioUnlocked(): boolean {
    return this.audioState?.isUnlocked ?? false;
  }

  get isHelpOpen(): boolean {
    return this.helpWidget?.isOpen ?? false;
  }

  /** `true` when the HUD created (and therefore owns) its timeline runtime. */
  get ownsTimelineRuntime(): boolean {
    return this.ownsTimeline;
  }

  get toastCount(): number {
    return this.toastMessages.size;
  }

  /* ---------------- timeline sync ---------------- */

  /**
   * Mirrors the timeline into the slider and chrome. Called every registered
   * frame and after every selection, so an external `selectEra()` lands on the
   * HUD on the very next `SceneContext.tick()`.
   */
  refresh(force = false): void {
    if (this.disposedState) return;
    const snapshot = this.timelineState.snapshot;
    const era = snapshot.era;
    if (force || era !== this.lastEra) {
      this.lastEra = era;
      this.root.dataset.chronoHudEra = era;
      this.root.dataset.chronoHudYear = String(snapshot.year);
      this.sliderState?.setEra(era);
    }
    this.writeData('chronoHudTransitioning', snapshot.transitioning ? 'true' : 'false');
    this.sliderState?.setTransitionProgress(snapshot.transitioning ? snapshot.progress : 1);
    this.syncAudioState();
    this.syncNavigation();
  }

  /**
   * Moves the timeline to a year and mirrors the result. This is the *only*
   * way the HUD changes the year, so scene systems always hear about it through
   * `TimelineRuntime`.
   */
  selectEra(value: EraId | number | string, options: HudEraSelectOptions = {}): EraId {
    const era = this.timelineState.selectEra(value, {
      durationMs: options.durationMs ?? this.selectionDurationMs,
      immediate: options.immediate,
    });
    this.refresh(true);
    if (options.announce) this.announceEra(era);
    return era;
  }

  /** Steps `offset` stops from the selected year (clamped by the runtime). */
  stepEra(offset: number, options: HudEraSelectOptions = {}): EraId {
    const index = (ERA_IDS as readonly string[]).indexOf(this.timelineState.era);
    const next = Math.min(ERA_IDS.length - 1, Math.max(0, index + Math.trunc(offset)));
    return this.selectEra(ERA_IDS[next], options);
  }

  /** Announces an era (the active one by default) as a toast. */
  announceEra(value?: EraId | number | string): HudEraInfo {
    const info = this.eraInfo(value);
    this.toast(`${info.year} — ${info.label}`, {
      tone: 'era',
      era: info.era,
      durationMs: this.toastDurationMs,
      sound: null,
    });
    return info;
  }

  /** Everything the HUD knows about an era; the active one by default. */
  eraInfo(value?: EraId | number | string): HudEraInfo {
    const snapshot = this.timelineState.snapshot;
    const era = value === undefined ? snapshot.era : resolveEraValue(value);
    const descriptor = getEraDescriptor(era);
    const current = era === snapshot.era;
    return {
      era,
      year: descriptor.year,
      label: descriptor.label,
      description: descriptor.description,
      index: (ERA_IDS as readonly string[]).indexOf(era),
      total: ERA_IDS.length,
      soundscapeId: descriptor.soundscapeId,
      from: snapshot.from,
      to: snapshot.to,
      transitioning: current ? snapshot.transitioning : false,
      progress: current ? snapshot.progress : 1,
    };
  }

  /* ---------------- toasts ---------------- */

  /**
   * Pushes a toast onto the HUD stack. Returns a handle that can dismiss it;
   * a toast with `durationMs: 0` stays until dismissed or cleared.
   */
  toast(message: string, options: HudToastOptions = {}): HudToastHandle {
    if (this.disposedState) {
      throw new Error('HudApi has been disposed.');
    }
    const id = options.id ?? `${this.systemId}-toast-${(this.toastSequence += 1)}`;
    const tone: HudToastTone = options.tone ?? 'info';
    const durationMs = options.durationMs ?? this.toastDurationMs;
    const sound = options.sound === undefined ? 'tick' : options.sound;

    this.dismissToast(id);

    const element = createElement(this.documentRef, 'div', 'chrono-hud__toast', {
      [HUD_ATTRIBUTE]: 'toast',
      'data-chrono-hud-toast-id': id,
      'data-chrono-hud-toast-tone': tone,
    });

    if (options.era) element.dataset.chronoHudToastEra = options.era;
    if (options.title) {
      const title = createElement(this.documentRef, 'span', 'chrono-hud__toast-title');
      title.textContent = options.title;
      element.appendChild(title);
    }
    const body = createElement(this.documentRef, 'span', 'chrono-hud__toast-message');
    body.textContent = message;
    element.appendChild(body);

    const close = createElement(this.documentRef, 'button', 'chrono-hud__toast-close', {
      type: 'button',
      'data-chrono-hud-toast-close': id,
      'aria-label': 'Dismiss notification',
    });
    close.textContent = '✕';
    close.addEventListener('click', () => this.dismissToast(id));
    element.appendChild(close);

    this.toastsRegion.appendChild(element);
    this.toastMessages.set(id, message);
    if (durationMs > 0) {
      this.toastTimers.set(
        id,
        setTimeout(() => this.dismissToast(id), durationMs),
      );
    }
    if (sound) this.emitUiSound(sound);

    const handle: HudToastHandle = {
      id,
      message,
      element,
      dismiss: () => this.dismissToast(id),
    };
    this.onToastCallback?.(handle);
    return handle;
  }

  /** Removes a toast by id. Returns `false` when it was not present. */
  dismissToast(id: string): boolean {
    const timer = this.toastTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.toastTimers.delete(id);
    }
    const element = this.toastsRegion.querySelector<HTMLElement>(
      `[data-chrono-hud-toast-id="${id}"]`,
    );
    const existed = this.toastMessages.delete(id);
    element?.remove();
    return existed;
  }

  /** Dismisses every toast at once. */
  clearToasts(): void {
    for (const id of [...this.toastMessages.keys()]) this.dismissToast(id);
  }

  /* ---------------- audio ---------------- */

  /** Flips the mute state through the `AudioDirector`; returns the new state. */
  toggleMute(): boolean {
    const audio = this.audioState;
    if (!audio || audio.isDisposed) return this.isMuted;
    if (!audio.isUnlocked) {
      void audio.unlock().then((ok) => {
        this.syncAudioState();
        if (ok) this.emitUiSound('click');
      });
      this.syncAudioState();
      return audio.isMuted;
    }
    const willMute = !audio.isMuted;
    // Voice the cue before the master closes so muting is audible.
    if (willMute) this.emitUiSound('click');
    audio.setMuted(willMute);
    if (!willMute) this.emitUiSound('click');
    this.syncAudioState();
    this.toast(willMute ? 'Sound muted' : 'Sound on', {
      tone: 'audio',
      durationMs: 2000,
      sound: null,
    });
    return audio.isMuted;
  }

  /** Sets the mute state explicitly; returns the resulting state. */
  setMuted(muted: boolean): boolean {
    const audio = this.audioState;
    if (!audio || audio.isDisposed) return this.isMuted;
    if (Boolean(muted) !== audio.isMuted) return this.toggleMute();
    this.syncAudioState();
    return audio.isMuted;
  }

  /** Voices one UI cue through the `AudioDirector`, unlocking on first gesture. */
  playUiSound(sound: TimelineSoundKind = 'click'): void {
    this.emitUiSound(sound);
  }

  /* ---------------- chrome ---------------- */

  /** Flips the controls help overlay; returns the new open state. */
  toggleHelp(): boolean {
    if (!this.helpWidget) return false;
    this.emitUiSound('click');
    return this.helpWidget.toggle();
  }

  /** Opens or closes the controls help overlay. */
  setHelpOpen(open: boolean): boolean {
    const help = this.helpWidget;
    if (!help) return false;
    if (open) help.open();
    else help.close();
    return help.isOpen;
  }

  /* ---------------- scene integration ---------------- */

  /** Registers the per-frame mirror tick and (when owned) the timeline tick. */
  attach(context: SceneContext, options: { systemId?: string; order?: number } = {}): this {
    if (this.disposedState) return this;
    if (this.registration && this.contextState === context) return this;
    this.detach();
    this.contextState = context;
    if (this.ownsTimeline && !this.timelineState.isAttached) {
      this.timelineState.attach(context);
    }
    this.registration = context.registerSystem(
      options.systemId ?? this.systemId,
      this.handleTick,
      { order: options.order ?? this.systemOrder },
    );
    this.refresh(true);
    return this;
  }

  /** Leaves the tick loop; HUD state and listeners stay intact. */
  detach(): void {
    this.registration?.dispose();
    this.registration = null;
    if (this.ownsTimeline) this.timelineState.detach();
  }

  /** Unwinds listeners, widgets, toasts and the timer, then removes the chrome. */
  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.clearToasts();
    this.helpButton?.removeEventListener('click', this.handleHelpClick);
    this.muteButton?.removeEventListener('click', this.handleMuteClick);
    if (this.shortcutTarget) {
      this.shortcutTarget.removeEventListener('keydown', this.handleShortcut);
      this.shortcutTarget = null;
    }
    this.detach();
    this.sliderState?.dispose();
    this.sliderState = null;
    this.helpWidget?.dispose();
    this.helpWidget = null;
    if (this.ownsTimeline) this.timelineState.dispose();
    detachHudGlobal(this.globalKey, this);
    this.root.remove();
  }

  /** Flat view of the HUD for tests and browser harnesses. */
  snapshot(): HudSnapshot {
    const timeline = this.timelineState.snapshot;
    return {
      version: this.version,
      era: timeline.era,
      year: timeline.year,
      stops: [...ERA_IDS].map(eraYearOf),
      transitioning: timeline.transitioning,
      progress: timeline.progress,
      muted: this.isMuted,
      audioUnlocked: this.isAudioUnlocked,
      helpOpen: this.isHelpOpen,
      toasts: [...this.toastMessages.values()],
      attached: this.isAttached,
      timeline: this.ownsTimeline ? 'internal' : 'shared',
    };
  }

  /* ---------------- internals ---------------- */

  private writeData(key: string, value: string): void {
    const data = this.root.dataset as Record<string, string | undefined>;
    if (data[key] !== value) data[key] = value;
  }

  private createActionButton(
    parent: HTMLElement,
    options: { attribute: string; label: string; glyph: string; title: string },
  ): { button: HTMLButtonElement; label: HTMLElement } {
    const button = createElement(this.documentRef, 'button', 'chrono-hud__action', {
      type: 'button',
      [HUD_ATTRIBUTE]: options.attribute,
      title: options.title,
      'aria-label': options.label,
    });
    const glyph = createElement(this.documentRef, 'span', 'chrono-hud__action-glyph', {
      'aria-hidden': 'true',
    });
    glyph.textContent = options.glyph;
    const label = createElement(this.documentRef, 'span', 'chrono-hud__action-label');
    label.textContent = options.label;
    button.appendChild(glyph);
    button.appendChild(label);
    parent.appendChild(button);
    return { button, label };
  }

  private emitUiSound(sound: TimelineSoundKind): void {
    const audio = this.audioState;
    if (!audio || audio.isDisposed || audio.isMuted) return;
    const params =
      sound === 'tick'
        ? { gain: HUD_TICK_GAIN, rate: HUD_TICK_RATE }
        : { gain: HUD_CLICK_GAIN, rate: HUD_CLICK_RATE };
    if (audio.isUnlocked) {
      audio.play(UI_CLICK_CUE, params);
      return;
    }
    // A HUD gesture is a user activation: spend it on the autoplay unlock, then
    // voice the cue once the context is actually running.
    void audio.unlock().then((ok) => {
      if (ok && !audio.isMuted) audio.play(UI_CLICK_CUE, params);
    });
  }

  private syncAudioState(): void {
    const button = this.muteButton;
    if (!button) return;
    const audio = this.audioState;
    const unavailable = !audio || audio.isDisposed || !audio.canCreateContext();
    const muted = audio?.isMuted ?? false;
    const unlocked = audio?.isUnlocked ?? false;
    const state = unavailable ? 'unavailable' : muted ? 'muted' : unlocked ? 'on' : 'locked';
    button.disabled = unavailable;
    button.dataset.chronoHudMuteState = state;
    button.setAttribute('aria-pressed', muted ? 'true' : 'false');
    const label = state === 'muted' ? 'Muted' : state === 'unavailable' ? 'No audio' : 'Sound';
    const text = this.muteLabelElement;
    if (text && text.textContent !== label) text.textContent = label;
    button.title =
      state === 'locked'
        ? 'Enable sound (M)'
        : state === 'muted'
          ? 'Unmute (M)'
          : 'Sound (M)';
    this.writeData('chronoHudAudioState', state);
  }

  private syncNavigation(): void {
    const help = this.helpWidget;
    const mode = this.navigationState?.mode;
    if (help && typeof mode === 'string' && mode.length > 0) help.setNavigationMode(mode);
  }

  private readonly handleTick = (): void => {
    this.refresh();
  };

  private readonly handleSliderInteraction = (interaction: TimelineInteraction): void => {
    this.emitUiSound(interaction.sound);
    if (interaction.selection) {
      this.selectEra(interaction.era, { durationMs: this.selectionDurationMs });
      return;
    }
    this.refresh(true);
    if (interaction.activation) this.announceEra(interaction.era);
  };

  private readonly handleHelpClick = (): void => {
    this.emitUiSound('click');
    this.helpWidget?.toggle();
  };

  private readonly handleMuteClick = (): void => {
    this.toggleMute();
  };

  private readonly handleHelpOpenChange = (open: boolean): void => {
    const button = this.helpButton;
    if (!button) return;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.dataset.chronoHudHelpState = open ? 'open' : 'closed';
  };

  private readonly handleShortcut = (event: Event): void => {
    const keyboard = event as KeyboardEvent;
    if (this.disposedState || keyboard.defaultPrevented || keyboard.repeat) return;
    if (keyboard.ctrlKey || keyboard.metaKey || keyboard.altKey) return;
    if (isTextEntryTarget(keyboard.target)) return;
    switch (keyboard.key) {
      case 'm':
      case 'M':
        this.consumeShortcut(keyboard);
        this.toggleMute();
        break;
      case 'h':
      case 'H':
      case '?':
        this.consumeShortcut(keyboard);
        this.handleHelpClick();
        break;
      default:
        break;
    }
  };

  private consumeShortcut(event: KeyboardEvent): void {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  }
}

/* ------------------------------------------------------------------------- *
 * Global integration
 * ------------------------------------------------------------------------- */

function resolveOwnerDocument(root: HTMLElement | null | undefined): Document {
  if (root?.ownerDocument) return root.ownerDocument;
  throw new Error('createHudApi() needs a DOM document or an overlay root element.');
}

/** Publishes the live HUD on `window` so overlays and harnesses can drive it. */
export function integrateHudGlobal(api: HudApi, key: string = HUD_GLOBAL_KEY): HudApi {
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>)[key] = api;
  }
  return api;
}

/** Removes a published HUD (only when the handle still points at it). */
export function detachHudGlobal(key: string = HUD_GLOBAL_KEY, api?: HudApi): void {
  if (typeof window === 'undefined') return;
  const scope = window as unknown as Record<string, unknown>;
  if (api && scope[key] !== api) return;
  delete scope[key];
}

/** The published HUD, or `null` before boot. */
export function getHudApi(key: string = HUD_GLOBAL_KEY): HudApi | null {
  if (typeof window === 'undefined') return null;
  const value = (window as unknown as Record<string, unknown>)[key];
  return value instanceof HudApi ? value : null;
}

function readGlobal(key: string): unknown {
  if (typeof globalThis === 'undefined') return undefined;
  return (globalThis as unknown as Record<string, unknown>)[key];
}

/** Discovers the scene context published by the app shell, if any. */
export function discoverSceneContext(appKey: string = CHRONO_CITY_GLOBAL_KEY): SceneContext | null {
  const app = readGlobal(appKey);
  if (app && typeof app === 'object' && 'context' in app) {
    const context = (app as { context?: unknown }).context;
    if (context instanceof SceneContext) return context;
  }
  return null;
}

/** Discovers a timeline runtime published by the integration layer, if any. */
export function discoverTimelineRuntime(
  timelineKey: string = TIMELINE_GLOBAL_KEY,
): TimelineRuntime | null {
  const timeline = readGlobal(timelineKey);
  if (
    timeline &&
    typeof timeline === 'object' &&
    typeof (timeline as TimelineRuntime).selectEra === 'function' &&
    typeof (timeline as TimelineRuntime).snapshot === 'object'
  ) {
    return timeline as TimelineRuntime;
  }
  return null;
}

/** Creates the HUD (`create` half of the lifecycle). */
export function createHudApi(options: HudApiOptions = {}): HudApi {
  return new HudApi(options);
}

/**
 * Boots the HUD against the live application: discovers the scene context, the
 * audio director and (when published) the shared timeline runtime, then mounts
 * one HUD. Defensive by design — a HUD failure must never stop the city, and
 * booting twice returns the already-running HUD instead of a second one.
 */
export function bootHudApi(options: HudBootOptions = {}): HudApi | null {
  const existing = getHudApi(options.globalKey ?? HUD_GLOBAL_KEY);
  if (existing) return existing;
  try {
    const context = options.context ?? discoverSceneContext(options.appKey);
    const audio =
      options.audio ?? getAudioDirector(options.audioKey ?? AUDIO_GLOBAL_KEY);
    const timeline = options.timeline ?? discoverTimelineRuntime(options.timelineKey);
    return new HudApi({
      ...options,
      context: context ?? undefined,
      audio,
      timeline: timeline ?? undefined,
    });
  } catch (error) {
    console.warn('[chrono-city] hud: boot failed', error);
    return null;
  }
}

declare global {
  interface Window {
    __chronoCityHud?: HudApi;
  }
}
