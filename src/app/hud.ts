/**
 * Café HUD and enter-café gate — the app-owned presentation layer.
 *
 * Two framework-free DOM widgets live here, and nothing else:
 *
 *  - {@link createHud} builds the compact heads-up display the composed page
 *    pins to the bottom-right: the current year, the era name and caption, the
 *    control hints, the audio controls (a master mute plus one mute per audio
 *    bus), the render-quality toggle, the orbit/walk toggle, the close-up
 *    viewpoint list and the dispose-and-re-init control.
 *  - {@link createEnterGate} builds the enter-café card. It is the gesture the
 *    composition root unlocks the audio engine with; the veil is click-through,
 *    so the HUD (and its mute toggle) stays reachable before the visitor enters.
 *
 * Contract boundaries honoured here:
 *
 *  - **Presentation only.** This module never touches the scene graph, the
 *    audio graph or the timeline. It renders the state it is handed and reports
 *    user intent back through callbacks, so the composition root stays the one
 *    place that drives the kernel, the transition engine and the audio engine.
 *  - **The slider is the only year control.** The HUD displays the year; it
 *    offers no way to choose one.
 *  - **App-owned styling.** The chrome comes from `hud.css`, imported as text
 *    and injected once per document (reference counted), exactly like the
 *    timeline slider and the inspect overlay ship their own chrome. No module,
 *    slider or overlay internals are restyled.
 *  - **Disposable.** {@link Hud.dispose} removes every listener, the element and
 *    its style lease, so a dispose/re-init cycle leaves no stale DOM behind.
 */

import hudStyles from './hud.css?raw';
import type { AudioEngineState } from '../audio/AudioEngine';
import type { BusId } from '../audio/buses';
import type { YearId } from '../contracts/period';
import type { NavigationMode } from '../core/navigation';

/* -------------------------------------------------------------------------- */
/* Identity and vocabulary                                                    */
/* -------------------------------------------------------------------------- */

/** Attribute naming the injected HUD stylesheet. */
export const HUD_STYLE_ATTRIBUTE = 'data-hud-styles';

/** Id value of the injected HUD stylesheet. */
export const HUD_STYLE_ID = 'cafe-hud';

/** `data-part` value of the HUD root. */
export const HUD_ROOT_PART = 'hud';

/** `data-part` values of the HUD's parts, shared with the tests. */
export const HUD_PARTS = Object.freeze({
  root: HUD_ROOT_PART,
  head: 'hud-head',
  year: 'hud-year',
  era: 'hud-era',
  caption: 'hud-caption',
  hints: 'hud-hints',
  controls: 'hud-controls',
  mute: 'hud-mute',
  quality: 'hud-quality',
  mode: 'hud-mode',
  rebuild: 'hud-rebuild',
  buses: 'hud-buses',
  busesLabel: 'hud-buses-label',
  busPrefix: 'hud-bus-',
  views: 'hud-views',
  viewsLabel: 'hud-views-label',
  view: 'hud-view',
  status: 'hud-status',
} as const);

/** Audio buses the HUD exposes a mute for, in reading order. */
export const HUD_BUS_IDS: readonly BusId[] = Object.freeze(['music', 'ambience', 'machine']);

/** Human labels of the three café audio buses. */
export const HUD_BUS_LABELS: Readonly<Record<BusId, string>> = Object.freeze({
  music: 'Music',
  ambience: 'Murmur',
  machine: 'Machine SFX',
});

/** `data-part` of one bus mute button, keyed by bus id. */
export const HUD_BUS_PARTS: Readonly<Record<BusId, string>> = Object.freeze({
  music: `${HUD_PARTS.busPrefix}music`,
  ambience: `${HUD_PARTS.busPrefix}ambience`,
  machine: `${HUD_PARTS.busPrefix}machine`,
});

/** Button copy of the quality toggle. */
export const HUD_QUALITY_LABELS: Readonly<Record<RenderQuality, string>> = Object.freeze({
  high: 'Quality: high',
  low: 'Quality: low',
});

/** Control hints shown in the compact HUD, in reading order. */
export const HUD_CONTROL_HINTS: readonly string[] = Object.freeze([
  'Drag to orbit',
  'Scroll to zoom',
  'Walk mode: WASD',
  'Pick a viewpoint',
  'Esc returns',
]);

/** Upper bound on the viewpoint buttons the HUD renders (the rest are counted). */
export const HUD_HOTSPOT_LIMIT = 12;

/** Status copy before the visitor has entered (audio still locked). */
export const HUD_STATUS_LOCKED =
  'Audio locked — enter the café to start the music, murmur and machine SFX.';

/** Status copy while the era choreography plays. */
export function hudTransitionStatus(year: YearId): string {
  return `Transforming the café to ${year}…`;
}

/** Label of the enter-café control. */
export const HUD_ENTER_LABEL = 'Enter the café';

/** Hint shown on the enter-café card. */
export const HUD_ENTER_HINT =
  '1945 · 1965 · 1985 · 2005 · 2025. Drag to look around, pick a viewpoint to look closer — sound starts when you enter.';

/** Title of the enter-café card. */
export const HUD_ENTER_TITLE = 'Café Timelapse';

/** `data-part` values of the enter gate. */
export const ENTER_GATE_PARTS = Object.freeze({
  gate: 'enter-gate',
  card: 'enter-card',
  title: 'enter-title',
  hint: 'enter-hint',
  button: 'enter-cafe',
} as const);

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

/** Render quality the HUD offers; the composition root maps it onto the renderer. */
export type RenderQuality = 'high' | 'low';

/** One close-up viewpoint offered by the HUD, projected from the hotspot registry. */
export interface HudHotspot {
  readonly id: string;
  readonly label: string;
  /** Domain (publisher) the viewpoint belongs to. */
  readonly moduleId: string;
}

/** The subset of a `PeriodDefinition` the HUD renders. */
export interface HudPeriod {
  readonly year: YearId;
  readonly label: string;
  readonly name: string;
  readonly summary: string;
}

/** Everything the HUD presents, as plain comparable data. */
export interface HudState {
  readonly year: YearId;
  /** Era name shown next to the year. */
  readonly eraName: string;
  /** Era caption (the period definition's summary). */
  readonly caption: string;
  readonly hints: readonly string[];
  readonly muted: boolean;
  readonly busMutes: Readonly<Record<BusId, boolean>>;
  readonly quality: RenderQuality;
  readonly mode: NavigationMode;
  readonly reducedMotion: boolean;
  readonly audioState: AudioEngineState | 'unavailable';
  /** Every viewpoint the HUD was handed (some may not be rendered). */
  readonly hotspots: readonly HudHotspot[];
  /** How many viewpoint buttons are actually mounted. */
  readonly shownHotspots: number;
  readonly status: string;
}

/** Listener ownership the HUD reports, for lifecycle assertions. */
export interface HudListenerStats {
  readonly buttons: number;
  readonly views: number;
  readonly document: number;
  readonly total: number;
}

/** The HUD surface handed to the composition root. */
export interface Hud {
  readonly element: HTMLElement;
  readonly state: HudState;
  readonly isDisposed: boolean;
  readonly year: YearId;
  /** Points the year readout at `year` (used the moment a selection is made). */
  setYear(year: YearId): HudState;
  /** Applies a whole era: year, era name and caption. */
  setPeriod(period: HudPeriod): HudState;
  setStatus(text: string): HudState;
  setMuted(muted: boolean): HudState;
  setBusMute(bus: BusId, muted: boolean): HudState;
  setQuality(quality: RenderQuality): HudState;
  setMode(mode: NavigationMode): HudState;
  setReducedMotion(reduced: boolean): HudState;
  setAudioState(state: AudioEngineState | 'unavailable'): HudState;
  setHotspots(hotspots: readonly HudHotspot[]): HudState;
  getListenerStats(): HudListenerStats;
  dispose(): void;
}

/** Construction options for {@link createHud}. */
export interface HudOptions {
  /** Document that owns the HUD; defaults to the ambient `document`. */
  readonly ownerDocument?: Document | null;
  /** Element the panel is appended to; omit to append to the document body. */
  readonly container?: Element | null;
  /** Era shown before the timeline moves. */
  readonly period: HudPeriod;
  readonly hints?: readonly string[];
  readonly quality?: RenderQuality;
  readonly muted?: boolean;
  readonly busMutes?: Partial<Record<BusId, boolean>>;
  readonly mode?: NavigationMode;
  readonly reducedMotion?: boolean;
  readonly audioState?: AudioEngineState | 'unavailable';
  readonly hotspots?: readonly HudHotspot[];
  readonly status?: string;
  /** Master mute intent. Returns nothing: the composition root owns the engine. */
  readonly onToggleMute?: (muted: boolean) => void;
  /** Per-bus mute intent. */
  readonly onToggleBus?: (bus: BusId, muted: boolean) => void;
  /** Quality intent. */
  readonly onToggleQuality?: (quality: RenderQuality) => void;
  /** Orbit/walk intent. */
  readonly onToggleMode?: (mode: NavigationMode) => void;
  /** A viewpoint button was pressed. */
  readonly onSelectHotspot?: (id: string) => void;
  /** The dispose-and-re-init control was pressed. */
  readonly onRebuild?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Styling                                                                    */
/* -------------------------------------------------------------------------- */

/** One injected stylesheet per document, reference counted per widget. */
interface StyleLease {
  readonly element: HTMLStyleElement;
  refs: number;
}

const styleLeases = new WeakMap<Document, StyleLease>();

function acquireStyles(doc: Document): StyleLease {
  const existing = styleLeases.get(doc);
  if (existing) {
    existing.refs += 1;
    return existing;
  }
  const element = doc.createElement('style');
  element.setAttribute(HUD_STYLE_ATTRIBUTE, HUD_STYLE_ID);
  element.textContent = hudStyles;
  const parent = doc.head ?? doc.documentElement ?? doc.body;
  parent?.appendChild(element);
  const lease: StyleLease = { element, refs: 1 };
  styleLeases.set(doc, lease);
  return lease;
}

function releaseStyles(doc: Document, lease: StyleLease): void {
  lease.refs -= 1;
  if (lease.refs > 0) return;
  lease.element.remove();
  styleLeases.delete(doc);
}

/* -------------------------------------------------------------------------- */
/* Small DOM helpers                                                          */
/* -------------------------------------------------------------------------- */

interface ListenerEntry {
  readonly target: EventTarget;
  readonly type: string;
  readonly handler: EventListener;
  readonly group: 'button' | 'view' | 'document';
}

function createPart<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  part: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  element.setAttribute('data-part', part);
  return element;
}

function defaultBusMutes(): Record<BusId, boolean> {
  return { music: false, ambience: false, machine: false };
}

function resolveDocument(options: { ownerDocument?: Document | null }): Document {
  const doc = options.ownerDocument ?? (typeof document === 'undefined' ? null : document);
  if (doc === null) {
    throw new Error(
      'The café HUD needs a DOM document: pass `ownerDocument` when no ambient document exists.',
    );
  }
  return doc;
}

/* -------------------------------------------------------------------------- */
/* HUD panel                                                                  */
/* -------------------------------------------------------------------------- */

/** Framework-free DOM implementation of {@link Hud}. Prefer {@link createHud}. */
export class HudPanel implements Hud {
  readonly element: HTMLElement;

  private readonly doc: Document;
  private readonly styles: StyleLease;
  private readonly yearEl: HTMLElement;
  private readonly eraEl: HTMLElement;
  private readonly captionEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly muteButton: HTMLButtonElement;
  private readonly qualityButton: HTMLButtonElement;
  private readonly modeButton: HTMLButtonElement;
  private readonly rebuildButton: HTMLButtonElement;
  private readonly busGroup: HTMLElement;
  private readonly viewsGroup: HTMLElement;
  private readonly busButtons = new Map<BusId, HTMLButtonElement>();
  private readonly onToggleMute: ((muted: boolean) => void) | null;
  private readonly onToggleBus: ((bus: BusId, muted: boolean) => void) | null;
  private readonly onToggleQuality: ((quality: RenderQuality) => void) | null;
  private readonly onToggleMode: ((mode: NavigationMode) => void) | null;
  private readonly onSelectHotspot: ((id: string) => void) | null;
  private readonly onRebuild: (() => void) | null;

  private entries: ListenerEntry[] = [];
  private viewButtons: HTMLButtonElement[] = [];
  private value: HudState;
  private disposed = false;

  constructor(options: HudOptions) {
    const doc = resolveDocument(options);
    this.doc = doc;
    this.styles = acquireStyles(doc);
    this.onToggleMute = options.onToggleMute ?? null;
    this.onToggleBus = options.onToggleBus ?? null;
    this.onToggleQuality = options.onToggleQuality ?? null;
    this.onToggleMode = options.onToggleMode ?? null;
    this.onSelectHotspot = options.onSelectHotspot ?? null;
    this.onRebuild = options.onRebuild ?? null;

    const hints = options.hints ?? HUD_CONTROL_HINTS;
    const busMutes = { ...defaultBusMutes(), ...(options.busMutes ?? {}) };

    this.element = createPart(doc, 'section', HUD_PARTS.root);
    this.element.setAttribute('aria-label', 'Café heads-up display');

    const head = createPart(doc, 'header', HUD_PARTS.head);
    this.yearEl = createPart(doc, 'p', HUD_PARTS.year);
    this.eraEl = createPart(doc, 'p', HUD_PARTS.era);
    head.append(this.yearEl, this.eraEl);

    this.captionEl = createPart(doc, 'p', HUD_PARTS.caption);
    this.captionEl.setAttribute('aria-live', 'polite');

    const hintList = createPart(doc, 'ul', HUD_PARTS.hints);
    for (const hint of hints) {
      const item = doc.createElement('li');
      item.textContent = hint;
      hintList.appendChild(item);
    }

    const controls = createPart(doc, 'div', HUD_PARTS.controls);
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Scene controls');
    this.muteButton = createPart(doc, 'button', HUD_PARTS.mute);
    this.qualityButton = createPart(doc, 'button', HUD_PARTS.quality);
    this.modeButton = createPart(doc, 'button', HUD_PARTS.mode);
    this.rebuildButton = createPart(doc, 'button', HUD_PARTS.rebuild);
    for (const button of [
      this.muteButton,
      this.qualityButton,
      this.modeButton,
      this.rebuildButton,
    ]) {
      button.type = 'button';
    }
    this.rebuildButton.textContent = 'Rebuild scene';
    controls.append(this.muteButton, this.qualityButton, this.modeButton, this.rebuildButton);

    const busLabel = createPart(doc, 'p', HUD_PARTS.busesLabel);
    busLabel.textContent = 'Audio buses';
    this.busGroup = createPart(doc, 'div', HUD_PARTS.buses);
    this.busGroup.setAttribute('role', 'group');
    this.busGroup.setAttribute('aria-label', 'Audio buses');
    for (const bus of HUD_BUS_IDS) {
      const button = createPart(doc, 'button', HUD_BUS_PARTS[bus]);
      button.type = 'button';
      button.textContent = HUD_BUS_LABELS[bus];
      this.busButtons.set(bus, button);
      this.busGroup.appendChild(button);
    }

    const viewsLabel = createPart(doc, 'p', HUD_PARTS.viewsLabel);
    viewsLabel.textContent = 'Look closer';
    this.viewsGroup = createPart(doc, 'div', HUD_PARTS.views);
    this.viewsGroup.setAttribute('role', 'group');
    this.viewsGroup.setAttribute('aria-label', 'Close-up viewpoints');

    this.statusEl = createPart(doc, 'p', HUD_PARTS.status);
    this.statusEl.setAttribute('role', 'status');

    this.element.append(
      head,
      this.captionEl,
      hintList,
      controls,
      busLabel,
      this.busGroup,
      viewsLabel,
      this.viewsGroup,
      this.statusEl,
    );

    this.value = Object.freeze({
      year: options.period.year,
      eraName: options.period.name,
      caption: options.period.summary,
      hints: Object.freeze([...hints]),
      muted: options.muted === true,
      busMutes: Object.freeze({ ...busMutes }),
      quality: options.quality === 'low' ? 'low' : 'high',
      mode: options.mode ?? 'orbit',
      reducedMotion: options.reducedMotion === true,
      audioState: options.audioState ?? 'locked',
      hotspots: Object.freeze([]),
      shownHotspots: 0,
      status: options.status ?? HUD_STATUS_LOCKED,
    });

    this.bind(this.muteButton, 'click', () => this.handleMute(), 'button');
    this.bind(this.qualityButton, 'click', () => this.handleQuality(), 'button');
    this.bind(this.modeButton, 'click', () => this.handleMode(), 'button');
    this.bind(this.rebuildButton, 'click', () => this.onRebuild?.(), 'button');
    for (const bus of HUD_BUS_IDS) {
      const button = this.busButtons.get(bus);
      if (button) this.bind(button, 'click', () => this.handleBus(bus), 'button');
    }

    this.setHotspots(options.hotspots ?? []);
    this.render();

    const container = options.container ?? doc.body ?? doc.documentElement;
    container?.appendChild(this.element);
  }

  /* -- state -------------------------------------------------------------- */

  get state(): HudState {
    return this.value;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get year(): YearId {
    return this.value.year;
  }

  setYear(year: YearId): HudState {
    return this.commit({ year });
  }

  setPeriod(period: HudPeriod): HudState {
    return this.commit({ year: period.year, eraName: period.name, caption: period.summary });
  }

  setStatus(text: string): HudState {
    return this.commit({ status: text });
  }

  setMuted(muted: boolean): HudState {
    return this.commit({ muted: muted === true });
  }

  setBusMute(bus: BusId, muted: boolean): HudState {
    if (!HUD_BUS_IDS.includes(bus)) {
      throw new Error(`Unknown audio bus "${String(bus)}"; expected one of ${HUD_BUS_IDS.join(', ')}.`);
    }
    return this.commit({ busMutes: { ...this.value.busMutes, [bus]: muted === true } });
  }

  setQuality(quality: RenderQuality): HudState {
    return this.commit({ quality: quality === 'low' ? 'low' : 'high' });
  }

  setMode(mode: NavigationMode): HudState {
    return this.commit({ mode: mode === 'walk' ? 'walk' : 'orbit' });
  }

  setReducedMotion(reduced: boolean): HudState {
    return this.commit({ reducedMotion: reduced === true });
  }

  setAudioState(state: AudioEngineState | 'unavailable'): HudState {
    return this.commit({ audioState: state });
  }

  setHotspots(hotspots: readonly HudHotspot[]): HudState {
    for (const button of this.viewButtons) {
      const entry = this.entries.find(
        (candidate) => candidate.target === button && candidate.group === 'view',
      );
      if (entry) {
        button.removeEventListener(entry.type, entry.handler);
        this.entries = this.entries.filter((candidate) => candidate !== entry);
      }
      button.remove();
    }
    this.viewButtons = [];

    const shown = hotspots.slice(0, HUD_HOTSPOT_LIMIT);
    for (const hotspot of shown) {
      const button = createPart(this.doc, 'button', HUD_PARTS.view);
      button.type = 'button';
      button.textContent = hotspot.label;
      button.setAttribute('data-hotspot-id', hotspot.id);
      button.setAttribute('data-module-id', hotspot.moduleId);
      button.setAttribute('aria-label', `Look closer: ${hotspot.label}`);
      this.viewButtons.push(button);
      this.viewsGroup.appendChild(button);
      this.bind(button, 'click', () => this.onSelectHotspot?.(hotspot.id), 'view');
    }

    return this.commit({
      hotspots: Object.freeze([...hotspots]),
      shownHotspots: shown.length,
    });
  }

  getListenerStats(): HudListenerStats {
    const buttons = this.entries.filter((entry) => entry.group === 'button').length;
    const views = this.entries.filter((entry) => entry.group === 'view').length;
    const documentCount = this.entries.filter((entry) => entry.group === 'document').length;
    return { buttons, views, document: documentCount, total: this.entries.length };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.splice(0)) {
      entry.target.removeEventListener(entry.type, entry.handler);
    }
    this.viewButtons = [];
    this.busButtons.clear();
    this.element.remove();
    releaseStyles(this.doc, this.styles);
  }

  /* -- internals ---------------------------------------------------------- */

  private handleMute(): void {
    const next = !this.value.muted;
    this.setMuted(next);
    this.onToggleMute?.(next);
  }

  private handleQuality(): void {
    const next: RenderQuality = this.value.quality === 'high' ? 'low' : 'high';
    this.setQuality(next);
    this.onToggleQuality?.(next);
  }

  private handleMode(): void {
    const next: NavigationMode = this.value.mode === 'orbit' ? 'walk' : 'orbit';
    this.setMode(next);
    this.onToggleMode?.(next);
  }

  private handleBus(bus: BusId): void {
    const next = this.value.busMutes[bus] !== true;
    this.setBusMute(bus, next);
    this.onToggleBus?.(bus, next);
  }

  private bind(
    target: EventTarget,
    type: string,
    handler: EventListener,
    group: ListenerEntry['group'],
  ): void {
    target.addEventListener(type, handler);
    this.entries.push({ target, type, handler, group });
  }

  private commit(patch: Partial<HudState>): HudState {
    this.value = Object.freeze({ ...this.value, ...patch });
    this.render();
    return this.value;
  }

  private render(): void {
    const state = this.value;
    this.element.setAttribute('data-year', state.year);
    this.element.setAttribute('data-era', state.eraName);
    this.element.setAttribute('data-quality', state.quality);
    this.element.setAttribute('data-mode', state.mode);
    this.element.setAttribute('data-muted', String(state.muted));
    this.element.setAttribute('data-audio-state', state.audioState);
    this.element.setAttribute('data-reduced-motion', String(state.reducedMotion));
    this.element.setAttribute('data-hotspot-count', String(state.hotspots.length));

    this.yearEl.textContent = state.year;
    this.eraEl.textContent = state.eraName;
    this.captionEl.textContent = state.caption;
    this.statusEl.textContent = state.status;

    this.muteButton.textContent = state.muted ? 'Unmute audio' : 'Mute audio';
    this.muteButton.setAttribute('aria-pressed', String(state.muted));
    this.muteButton.setAttribute('aria-label', state.muted ? 'Unmute the café audio' : 'Mute the café audio');

    this.qualityButton.textContent = HUD_QUALITY_LABELS[state.quality];
    this.qualityButton.setAttribute('aria-pressed', String(state.quality === 'low'));
    this.qualityButton.setAttribute(
      'aria-label',
      `Render quality is ${state.quality}; activate to use ${state.quality === 'high' ? 'low' : 'high'}`,
    );

    this.modeButton.textContent = state.mode === 'walk' ? 'Switch to orbit' : 'Walk mode';
    this.modeButton.setAttribute('aria-pressed', String(state.mode === 'walk'));
    this.modeButton.setAttribute(
      'aria-label',
      state.mode === 'walk' ? 'Leave walk mode for orbit' : 'Enter first-person walk mode',
    );

    this.rebuildButton.setAttribute('aria-label', 'Dispose and rebuild the café scene');

    for (const bus of HUD_BUS_IDS) {
      const button = this.busButtons.get(bus);
      if (!button) continue;
      const muted = state.busMutes[bus] === true;
      button.setAttribute('aria-pressed', String(muted));
      button.setAttribute('data-muted', String(muted));
      button.setAttribute('aria-label', `${muted ? 'Unmute' : 'Mute'} the ${HUD_BUS_LABELS[bus]} bus`);
    }
  }
}

/** Creates the compact café HUD. Pass `container` to mount it immediately. */
export function createHud(options: HudOptions): Hud {
  return new HudPanel(options);
}

/* -------------------------------------------------------------------------- */
/* Enter gate                                                                 */
/* -------------------------------------------------------------------------- */

/** The enter-café control: the gesture that unlocks the audio engine. */
export interface EnterGate {
  readonly element: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly visible: boolean;
  readonly disposed: boolean;
  show(): void;
  hide(): void;
  getListenerStats(): HudListenerStats;
  dispose(): void;
}

/** Construction options for {@link createEnterGate}. */
export interface EnterGateOptions {
  readonly ownerDocument?: Document | null;
  readonly container?: Element | null;
  readonly title?: string;
  readonly hint?: string;
  readonly label?: string;
  readonly reducedMotion?: boolean;
  /** Invoked once, the first time the visitor presses the enter control. */
  readonly onEnter?: () => void | Promise<void>;
}

/** Framework-free DOM implementation of {@link EnterGate}. */
export class EnterGatePanel implements EnterGate {
  readonly element: HTMLElement;
  readonly button: HTMLButtonElement;

  private readonly doc: Document;
  private readonly styles: StyleLease;
  private readonly onEnter: (() => void | Promise<void>) | null;
  private entries: ListenerEntry[] = [];
  private visibleState = true;
  private isDisposed = false;

  constructor(options: EnterGateOptions = {}) {
    const doc = resolveDocument(options);
    this.doc = doc;
    this.styles = acquireStyles(doc);
    this.onEnter = options.onEnter ?? null;

    this.element = createPart(doc, 'div', ENTER_GATE_PARTS.gate);
    this.element.setAttribute('data-visible', 'true');
    this.element.setAttribute('data-reduced-motion', String(options.reducedMotion === true));

    const card = createPart(doc, 'div', ENTER_GATE_PARTS.card);
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-label', options.title ?? HUD_ENTER_TITLE);

    const title = doc.createElement('h1');
    title.setAttribute('data-part', ENTER_GATE_PARTS.title);
    title.textContent = options.title ?? HUD_ENTER_TITLE;

    const hint = createPart(doc, 'p', ENTER_GATE_PARTS.hint);
    hint.textContent = options.hint ?? HUD_ENTER_HINT;

    this.button = createPart(doc, 'button', ENTER_GATE_PARTS.button);
    this.button.type = 'button';
    this.button.textContent = options.label ?? HUD_ENTER_LABEL;

    card.append(title, hint, this.button);
    this.element.appendChild(card);

    this.bind(this.button, 'click', () => this.handleEnter());

    const container = options.container ?? doc.body ?? doc.documentElement;
    container?.appendChild(this.element);
  }

  get visible(): boolean {
    return this.visibleState;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  show(): void {
    if (this.isDisposed) return;
    this.visibleState = true;
    this.element.setAttribute('data-visible', 'true');
    this.element.removeAttribute('hidden');
  }

  hide(): void {
    if (this.isDisposed) return;
    this.visibleState = false;
    this.element.setAttribute('data-visible', 'false');
    this.element.setAttribute('hidden', '');
  }

  getListenerStats(): HudListenerStats {
    const buttons = this.entries.filter((entry) => entry.group === 'button').length;
    const views = this.entries.filter((entry) => entry.group === 'view').length;
    const documentCount = this.entries.filter((entry) => entry.group === 'document').length;
    return { buttons, views, document: documentCount, total: this.entries.length };
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (const entry of this.entries.splice(0)) {
      entry.target.removeEventListener(entry.type, entry.handler);
    }
    this.element.remove();
    releaseStyles(this.doc, this.styles);
  }

  private handleEnter(): void {
    if (this.isDisposed) return;
    this.hide();
    void this.onEnter?.();
  }

  private bind(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler);
    this.entries.push({ target, type, handler, group: 'button' });
  }
}

/** Creates the enter-café gate. Pass `container` to mount it immediately. */
export function createEnterGate(options: EnterGateOptions = {}): EnterGate {
  return new EnterGatePanel(options);
}
