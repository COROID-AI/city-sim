/**
 * `cafe-timeline-ui` — the top-anchored period slider.
 *
 * The visitor's single entry point for era changes: five stops labelled
 * 1945, 1965, 1985, 2005 and 2025, an active-year indicator, era tick captions,
 * and a thumb that can be clicked, dragged or stepped with the keyboard.
 *
 * Design contract
 * ---------------
 * - **Contract typed.** The selection is the shared {@link YearId} from
 *   `src/contracts/period.ts`; {@link TimelineYearChangeDetail.year} can be
 *   handed straight to a period lookup (`PERIODS[year]`) with no translation.
 * - **No scene content.** This module imports the era contracts and its own
 *   stylesheet — nothing else. It never reaches for the period registry, the
 *   transition engine, the audio engine, the kernel or a scene module: driving
 *   the café from the emitted year is the composition root's job.
 * - **Change event.** Every explicit selection emits a bubbling `CustomEvent`
 *   named `year-change` (canonical) and `change` (alias), each carrying
 *   {@link TimelineYearChangeDetail}. The composition root may bind whichever
 *   surface fits:
 *   - `slider.element.addEventListener('year-change', (event) => apply(event.detail.year))`,
 *   - `slider.onYearChange((year, detail) => …)` — returns an unsubscribe,
 *   - `createTimelineSlider({ onChange })`.
 *   Interactions always emit, even when the year is unchanged (an arrow press
 *   clamped at 1945 still reports `1945`); `detail.changed` marks a real era
 *   move so a consumer can skip a redundant transition, and `detail.source`
 *   (`'click' | 'drag' | 'keyboard' | 'programmatic'`) says what moved it.
 * - **Assistive technology.** The rail is a `role="slider"` with `aria-valuenow`
 *   and an `aria-valuetext` naming the active year; the five stops form a
 *   `role="radiogroup"` of focusable `role="radio"` buttons, each labelled
 *   exactly `1945` … `2025` and described by its era tick caption. The active
 *   year is announced through a polite live region.
 * - **Reduced motion.** `setReducedMotion`, an explicit `reducedMotion` option,
 *   an injected `prefersReducedMotion`/`matchMedia` probe, or the subscribed
 *   `prefers-reduced-motion` media query all drop the animated thumb and
 *   progress transitions to zero duration. Selection behaviour is identical.
 * - **No network.** The stylesheet is injected inline from the bundled
 *   `timeline.css`; labels use a system font stack, so nothing is fetched.
 */

import {
  DEFAULT_YEAR_ID,
  YEAR_IDS,
  isYearId,
  toYearId,
  yearAt,
  yearIndex,
  type YearId,
} from '../../contracts/period';
import timelineStyles from './timeline.css?raw';

/* -------------------------------------------------------------------------- */
/* Public constants                                                           */
/* -------------------------------------------------------------------------- */

/** Attribute marking the injected `<style>` element. */
export const TIMELINE_SLIDER_STYLE_ATTRIBUTE = 'data-timeline-styles';

/** Value of {@link TIMELINE_SLIDER_STYLE_ATTRIBUTE} identifying this control. */
export const TIMELINE_SLIDER_STYLE_ID = 'cafe-timeline-slider';

/** Canonical change event: a bubbling `CustomEvent<TimelineYearChangeDetail>`. */
export const TIMELINE_YEAR_CHANGE_EVENT = 'year-change';

/** Alias of {@link TIMELINE_YEAR_CHANGE_EVENT}, carrying the same detail. */
export const TIMELINE_CHANGE_EVENT = 'change';

/** Number of selectable stops: exactly the five contract eras. */
export const TIMELINE_SLIDER_STOP_COUNT = YEAR_IDS.length;

/** Media query consulted when no reduced-motion preference is injected. */
export const TIMELINE_REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Font stack for the chrome: no webfont, no icon asset, no network request. */
export const TIMELINE_FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** `data-part` hooks, so tests, QA and the composition root can query the chrome. */
export const TIMELINE_SLIDER_PARTS = Object.freeze({
  root: 'timeline-slider',
  panel: 'panel',
  readout: 'readout',
  activeYear: 'active-year',
  activeYearValue: 'active-year-value',
  activeYearCaption: 'active-year-caption',
  hint: 'hint',
  trackArea: 'track-area',
  rail: 'rail',
  track: 'track',
  progress: 'progress',
  thumb: 'thumb',
  stops: 'stops',
  tick: 'tick',
  stop: 'stop',
  stopLabel: 'stop-label',
  stopCaption: 'stop-caption',
  dot: 'dot',
} as const);

/**
 * Captions under the five ticks: pure timeline chrome, deliberately decade-level
 * rather than era names (era prose belongs to the period registry, which this
 * module must not import). Override per instance through `options.captions`.
 */
export const ERA_TICK_CAPTIONS: Readonly<Record<YearId, string>> = Object.freeze({
  '1945': 'Post-war',
  '1965': 'Mid-century',
  '1985': 'Late century',
  '2005': 'New millennium',
  '2025': 'Present day',
});

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

/** Removes a previously registered listener. Safe to call more than once. */
export type Unsubscribe = () => void;

/**
 * Structural view of `MediaQueryList`, so a preference probe can be injected
 * (and faked) without depending on a real `window.matchMedia` being present.
 */
export interface MediaQueryListLike {
  readonly matches: boolean;
  addEventListener?(type: 'change', listener: (event: { readonly matches: boolean }) => void): void;
  removeEventListener?(
    type: 'change',
    listener: (event: { readonly matches: boolean }) => void,
  ): void;
  addListener?(listener: (event: { readonly matches: boolean }) => void): void;
  removeListener?(listener: (event: { readonly matches: boolean }) => void): void;
}

/** What moved the timeline; reported through {@link TimelineYearChangeDetail.source}. */
export type TimelineInteractionSource = 'click' | 'drag' | 'keyboard' | 'programmatic';

/** Payload of every change event: the contract era plus how it was chosen. */
export interface TimelineYearChangeDetail {
  /** Selected era — the period registry lookup key. */
  readonly year: YearId;
  /** Position of `year` on the timeline (`0` … `4`). */
  readonly index: number;
  /** Era selected before this interaction. */
  readonly previousYear: YearId;
  /** `false` when the interaction re-selected the year already active. */
  readonly changed: boolean;
  /** Interaction that produced the selection. */
  readonly source: TimelineInteractionSource;
}

/** Subscriber signature for {@link TimelineSlider.onYearChange}. */
export type TimelineYearChangeListener = (year: YearId, detail: TimelineYearChangeDetail) => void;

/** Construction options for {@link createTimelineSlider}. */
export interface TimelineSliderOptions {
  /** Element the control is appended to; omit to mount later with `mount`. */
  readonly container?: Element | null;
  /** Document that owns the control; defaults to the ambient `document`. */
  readonly ownerDocument?: Document | null;
  /** Era shown before the visitor selects one; defaults to `'1945'`. */
  readonly initialYear?: YearId;
  /** Era tick caption overrides, merged over {@link ERA_TICK_CAPTIONS}. */
  readonly captions?: Partial<Record<YearId, string>>;
  /** Accessible name of the control; defaults to `'Café era timeline'`. */
  readonly label?: string;
  /** Extra class name on the root element. */
  readonly className?: string;
  /** Explicit reduced-motion preference; wins over every probe when set. */
  readonly reducedMotion?: boolean;
  /** Reduced-motion probe, called once at construction. */
  readonly prefersReducedMotion?: () => boolean;
  /** `matchMedia` replacement; `null` disables media query probing entirely. */
  readonly matchMedia?: ((query: string) => MediaQueryListLike | null) | null;
  /** Convenience listener, equivalent to one {@link TimelineSlider.onYearChange} call. */
  readonly onChange?: TimelineYearChangeListener;
}

/** One selectable stop of the timeline. */
export interface TimelineStopHandle {
  /** Era this stop selects. */
  readonly year: YearId;
  /** Position on the timeline (`0` … `4`). */
  readonly index: number;
  /** Visible label, exactly the year (`'1985'`). */
  readonly label: string;
  /** Era tick caption shown under the label. */
  readonly caption: string;
  /** Focusable `role="radio"` button. */
  readonly button: HTMLButtonElement;
  /** Visible caption element referenced by the button's `aria-describedby`. */
  readonly captionElement: HTMLElement;
}

/**
 * The control surface handed to the composition root. It owns no scene content:
 * it reports the chosen {@link YearId} and nothing else.
 */
export interface TimelineSlider {
  /** Root element: the top-anchored overlay the composition mounts on the stage. */
  readonly element: HTMLElement;
  /** Focusable `role="slider"` rail (drop area for pointer drags). */
  readonly rail: HTMLElement;
  /** Moving thumb; its inline `left` tracks the active stop. */
  readonly thumb: HTMLElement;
  /** Filled portion of the rail: scaled from 1945 to the active year. */
  readonly progress: HTMLElement;
  /** The five contract eras, in chronological order. */
  readonly years: readonly YearId[];
  /** Stop handles, in the same order as {@link years}. */
  readonly stops: readonly TimelineStopHandle[];
  /** Accessible name of the control. */
  readonly label: string;
  /** Era currently selected. */
  readonly year: YearId;
  /** Index of {@link year} on the timeline. */
  readonly index: number;
  /** `true` while the root element is attached to a document. */
  readonly attached: boolean;
  /** `true` once {@link dispose} has run. */
  readonly disposed: boolean;
  /** `true` while animations are suppressed. */
  readonly reducedMotion: boolean;
  /** Era tick caption shown for `year`. */
  captionOf(year: YearId): string;
  /** Select `year`; returns `true` when the selection actually moved. */
  select(year: YearId, options?: { readonly silent?: boolean }): boolean;
  /** Select the era at `index`, clamped to `0` … `4`. */
  selectIndex(index: number, options?: { readonly silent?: boolean }): boolean;
  /** Move `delta` eras from the current selection, clamped at both ends. */
  step(delta: number, options?: { readonly silent?: boolean }): boolean;
  /** Focus the control (the active stop's button). */
  focus(options?: { readonly preventScroll?: boolean }): void;
  /** Append the root element to `target`; the control may be mounted once. */
  mount(target: Element): TimelineSlider;
  /** Override the reduced-motion state and re-apply the styles. */
  setReducedMotion(reduced: boolean): void;
  /** Subscribe to year selections; returns an unsubscribe function. */
  onYearChange(listener: TimelineYearChangeListener): Unsubscribe;
  /** Remove every listener and detach the root element. Safe to call twice. */
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Milliseconds during which a click produced by our own pointer gesture is ignored. */
const CLICK_SUPPRESSION_MS = 500;

/** Structural view of the window owning the control. */
interface SliderHostWindow {
  readonly matchMedia?: ((query: string) => MediaQueryListLike | null) | null;
  readonly CustomEvent?: typeof CustomEvent | null;
  readonly innerWidth?: number | null;
}

/** Minimal pointer/mouse event shape the position maths needs. */
interface PointerLikeEvent {
  readonly clientX?: number;
  readonly target?: EventTarget | null;
  readonly pointerId?: number;
  readonly button?: number;
}

interface ListenerEntry {
  readonly target: EventTarget;
  readonly type: string;
  readonly handler: EventListener;
  readonly capture: boolean;
}

interface Gesture {
  readonly pointerId: number | null;
  emitted: YearId | null;
}

/** Cross realm safe element test (jsdom, iframes and plain objects all differ). */
function isElement(value: unknown): value is Element {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { nodeType?: unknown; getAttribute?: unknown };
  return candidate.nodeType === 1 && typeof candidate.getAttribute === 'function';
}

/** Percentage of the rail for timeline index `index`, rounded to 0.01. */
function railPercent(index: number, maxIndex: number): string {
  if (maxIndex <= 0) return '0%';
  const ratio = Math.min(Math.max(index / maxIndex, 0), 1);
  return `${Math.round(ratio * 10000) / 100}%`;
}

/** The era a keyboard event asks for, or `null` when the key is not ours. */
function keyTargetYear(key: string, year: YearId): YearId | null {
  const index = yearIndex(year);
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return yearAt(index + 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return yearAt(index - 1);
    case 'Home':
    case 'PageUp':
      return yearAt(0);
    case 'End':
    case 'PageDown':
      return yearAt(YEAR_IDS.length - 1);
    default:
      return null;
  }
}

function hostWindow(doc: Document): SliderHostWindow | null {
  return (doc.defaultView as unknown as SliderHostWindow | null) ?? null;
}

/** Wraps the ambient `window.matchMedia`, tolerating hosts that do not implement it. */
function windowMatchMedia(
  view: SliderHostWindow | null,
): ((query: string) => MediaQueryListLike | null) | null {
  const probe = view?.matchMedia;
  if (typeof probe !== 'function') return null;
  return (query: string): MediaQueryListLike | null => {
    try {
      return probe.call(view as object, query) ?? null;
    } catch {
      return null;
    }
  };
}

/** Injects the bundled stylesheet once per document; the page never fetches it. */
function ensureStyles(doc: Document): void {
  const transport = doc.head ?? doc.documentElement;
  if (!transport) return;
  const selector = `style[${TIMELINE_SLIDER_STYLE_ATTRIBUTE}="${TIMELINE_SLIDER_STYLE_ID}"]`;
  if (doc.querySelector(selector)) return;
  const style = doc.createElement('style');
  style.setAttribute(TIMELINE_SLIDER_STYLE_ATTRIBUTE, TIMELINE_SLIDER_STYLE_ID);
  style.textContent = timelineStyles;
  transport.appendChild(style);
}

/* -------------------------------------------------------------------------- */
/* Control                                                                    */
/* -------------------------------------------------------------------------- */

let instanceCounter = 0;

/**
 * Framework-free DOM implementation of {@link TimelineSlider}. Prefer the
 * {@link createTimelineSlider} factory.
 */
export class TimelineSliderControl implements TimelineSlider {
  /** Root element: the top-anchored overlay the composition mounts on the stage. */
  readonly element: HTMLElement;
  /** Focusable `role="slider"` rail. */
  readonly rail: HTMLElement;
  /** Moving thumb. */
  readonly thumb: HTMLElement;
  /** Filled portion of the rail. */
  readonly progress: HTMLElement;
  /** The five contract eras, in chronological order. */
  readonly years: readonly YearId[] = YEAR_IDS;
  /** Stop handles, in the same order as {@link years}. */
  readonly stops: readonly TimelineStopHandle[];
  /** Accessible name of the control. */
  readonly label: string;

  private readonly ownerDocument: Document;
  private readonly ownerWindow: SliderHostWindow | null;
  private readonly panel: HTMLElement;
  private readonly activeYearElement: HTMLElement;
  private readonly activeYearValue: HTMLElement;
  private readonly activeYearCaption: HTMLElement;
  private readonly captions: Readonly<Record<YearId, string>>;
  private readonly onChangeOption: TimelineYearChangeListener | null;
  private readonly prefersReducedMotionProbe: (() => boolean) | null;
  private readonly matchMediaProbe: ((query: string) => MediaQueryListLike | null) | null;

  private readonly teardowns: Array<() => void> = [];
  private readonly gestureListeners: ListenerEntry[] = [];
  private readonly changeListeners: TimelineYearChangeListener[] = [];

  private mediaQuerySubscription: {
    readonly list: MediaQueryListLike;
    readonly handler: (event: { readonly matches: boolean }) => void;
  } | null = null;

  private currentYear: YearId = DEFAULT_YEAR_ID;
  private reducedMotionState = false;
  private gesture: Gesture | null = null;
  private lastGesturePointerId: number | null = null;
  private suppressClickUntil = 0;
  private disposedState = false;

  constructor(options: TimelineSliderOptions = {}) {
    const ambientDocument = typeof document === 'undefined' ? null : document;
    const ownerDocument = options.ownerDocument ?? ambientDocument;
    if (!ownerDocument) {
      throw new Error('[timeline] a document is required to build the timeline slider.');
    }

    this.ownerDocument = ownerDocument;
    this.ownerWindow = hostWindow(ownerDocument);
    this.label = options.label?.trim() || 'Café era timeline';
    this.captions = Object.freeze({ ...ERA_TICK_CAPTIONS, ...(options.captions ?? {}) });
    this.onChangeOption = options.onChange ?? null;
    this.prefersReducedMotionProbe = options.prefersReducedMotion ?? null;
    this.matchMediaProbe =
      options.matchMedia !== undefined ? options.matchMedia : windowMatchMedia(this.ownerWindow);

    const explicitReducedMotion = options.reducedMotion ?? null;
    this.reducedMotionState =
      explicitReducedMotion ??
      this.prefersReducedMotionProbe?.() ??
      this.matchMediaProbe?.(TIMELINE_REDUCED_MOTION_QUERY)?.matches ??
      false;

    ensureStyles(ownerDocument);

    const uid = `cafe-timeline-${(instanceCounter += 1)}`;
    const dom = this.buildDom(uid, options.className);
    this.element = dom.root;
    this.panel = dom.panel;
    this.rail = dom.rail;
    this.thumb = dom.thumb;
    this.progress = dom.progress;
    this.activeYearElement = dom.activeYear;
    this.activeYearValue = dom.activeYearValue;
    this.activeYearCaption = dom.activeYearCaption;
    this.stops = Object.freeze(dom.stops.map((stop) => Object.freeze(stop)));

    this.currentYear = toYearId(options.initialYear, DEFAULT_YEAR_ID);
    this.attachListeners();
    if (explicitReducedMotion === null && this.prefersReducedMotionProbe === null) {
      this.bindMediaQuery();
    }
    this.render();
    if (options.container) this.mount(options.container);
  }

  /* ---------------------------------------------------------------------- */
  /* Public surface                                                         */
  /* ---------------------------------------------------------------------- */

  get year(): YearId {
    return this.currentYear;
  }

  get index(): number {
    return yearIndex(this.currentYear);
  }

  get attached(): boolean {
    return this.element.isConnected;
  }

  get disposed(): boolean {
    return this.disposedState;
  }

  get reducedMotion(): boolean {
    return this.reducedMotionState;
  }

  captionOf(year: YearId): string {
    return this.captions[year] ?? '';
  }

  select(year: YearId, options?: { readonly silent?: boolean }): boolean {
    if (this.disposedState || !isYearId(year)) return false;
    return this.applySelection(year, 'programmatic', !(options?.silent ?? false));
  }

  selectIndex(index: number, options?: { readonly silent?: boolean }): boolean {
    if (this.disposedState || !Number.isFinite(index)) return false;
    return this.applySelection(yearAt(Math.trunc(index)), 'programmatic', !(options?.silent ?? false));
  }

  step(delta: number, options?: { readonly silent?: boolean }): boolean {
    if (this.disposedState || !Number.isFinite(delta)) return false;
    const next = yearAt(yearIndex(this.currentYear) + Math.trunc(delta));
    return this.applySelection(next, 'programmatic', !(options?.silent ?? false));
  }

  focus(options?: { readonly preventScroll?: boolean }): void {
    const active = this.stopFor(this.currentYear);
    if (!active) return;
    try {
      active.button.focus(options);
    } catch {
      active.button.focus();
    }
  }

  mount(target: Element): TimelineSlider {
    if (this.disposedState) return this;
    target.appendChild(this.element);
    return this;
  }

  setReducedMotion(reduced: boolean): void {
    const next = Boolean(reduced);
    if (next === this.reducedMotionState) {
      this.applyMotionStyles();
      return;
    }
    this.reducedMotionState = next;
    this.render();
  }

  onYearChange(listener: TimelineYearChangeListener): Unsubscribe {
    if (typeof listener !== 'function') return () => undefined;
    this.changeListeners.push(listener);
    return () => {
      const index = this.changeListeners.indexOf(listener);
      if (index >= 0) this.changeListeners.splice(index, 1);
    };
  }

  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.endGesture();
    for (const teardown of this.teardowns.splice(0)) {
      try {
        teardown();
      } catch {
        /* a detached target is harmless during teardown */
      }
    }
    this.unbindMediaQuery();
    this.changeListeners.length = 0;
    const parent = this.element.parentNode;
    if (parent) parent.removeChild(this.element);
  }

  /* ---------------------------------------------------------------------- */
  /* DOM construction                                                       */
  /* ---------------------------------------------------------------------- */

  private buildDom(
    uid: string,
    className: string | undefined,
  ): {
    root: HTMLElement;
    panel: HTMLElement;
    rail: HTMLElement;
    thumb: HTMLElement;
    progress: HTMLElement;
    activeYear: HTMLElement;
    activeYearValue: HTMLElement;
    activeYearCaption: HTMLElement;
    stops: TimelineStopHandle[];
  } {
    const doc = this.ownerDocument;
    const parts = TIMELINE_SLIDER_PARTS;

    const root = doc.createElement('div');
    root.className = className ? `cafe-timeline ${className}` : 'cafe-timeline';
    root.dataset['part'] = parts.root;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', this.label);
    // Structural styles are inline so the overlay is pinned even before (or
    // without) the injected stylesheet; the rest of the chrome lives in CSS.
    root.style.position = 'absolute';
    root.style.top = '0px';
    root.style.left = '0px';
    root.style.right = '0px';
    root.style.zIndex = '10';
    root.style.pointerEvents = 'none';
    root.style.fontFamily = TIMELINE_FONT_STACK;

    const panel = doc.createElement('div');
    panel.className = 'cafe-timeline__panel';
    panel.dataset['part'] = parts.panel;
    panel.style.pointerEvents = 'auto';

    const readout = doc.createElement('div');
    readout.className = 'cafe-timeline__readout';
    readout.dataset['part'] = parts.readout;

    const activeYear = doc.createElement('div');
    activeYear.className = 'cafe-timeline__active-year';
    activeYear.dataset['part'] = parts.activeYear;
    activeYear.setAttribute('role', 'status');
    activeYear.setAttribute('aria-live', 'polite');
    activeYear.setAttribute('aria-atomic', 'true');

    const activeYearValue = doc.createElement('span');
    activeYearValue.className = 'cafe-timeline__active-year-value';
    activeYearValue.dataset['part'] = parts.activeYearValue;
    activeYearValue.textContent = DEFAULT_YEAR_ID;

    const activeYearCaption = doc.createElement('span');
    activeYearCaption.className = 'cafe-timeline__active-year-caption';
    activeYearCaption.dataset['part'] = parts.activeYearCaption;

    // The separating space keeps the live-region announcement readable
    // ("2025 Present day"); the flex row never renders the whitespace itself.
    activeYear.append(activeYearValue, doc.createTextNode(' '), activeYearCaption);

    const hint = doc.createElement('span');
    hint.className = 'cafe-timeline__hint';
    hint.dataset['part'] = parts.hint;
    hint.textContent = 'Drag the thumb, or use the arrow keys';

    readout.append(activeYear, hint);

    const trackArea = doc.createElement('div');
    trackArea.className = 'cafe-timeline__track-area';
    trackArea.dataset['part'] = parts.trackArea;

    const rail = doc.createElement('div');
    rail.className = 'cafe-timeline__rail';
    rail.dataset['part'] = parts.rail;
    rail.setAttribute('role', 'slider');
    rail.setAttribute('aria-label', this.label);
    rail.setAttribute('aria-orientation', 'horizontal');
    rail.setAttribute('aria-valuemin', '0');
    rail.setAttribute('aria-valuemax', String(Math.max(this.years.length - 1, 0)));
    rail.setAttribute('aria-valuenow', '0');
    rail.setAttribute('aria-valuetext', DEFAULT_YEAR_ID);
    rail.tabIndex = 0;
    rail.style.touchAction = 'none';

    const track = doc.createElement('span');
    track.className = 'cafe-timeline__track';
    track.dataset['part'] = parts.track;
    track.setAttribute('aria-hidden', 'true');

    const progress = doc.createElement('span');
    progress.className = 'cafe-timeline__progress';
    progress.dataset['part'] = parts.progress;
    progress.setAttribute('aria-hidden', 'true');

    const thumb = doc.createElement('span');
    thumb.className = 'cafe-timeline__thumb';
    thumb.dataset['part'] = parts.thumb;
    thumb.setAttribute('aria-hidden', 'true');

    rail.append(track, progress, thumb);

    const stopList = doc.createElement('div');
    stopList.className = 'cafe-timeline__stops';
    stopList.dataset['part'] = parts.stops;
    stopList.setAttribute('role', 'radiogroup');
    stopList.setAttribute('aria-label', `${this.label} stops`);

    const stops: TimelineStopHandle[] = [];
    this.years.forEach((year, index) => {
      const captionId = `${uid}-caption-${year}`;

      const tick = doc.createElement('div');
      tick.className = 'cafe-timeline__tick';
      tick.dataset['part'] = parts.tick;
      tick.style.left = railPercent(index, this.years.length - 1);

      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'cafe-timeline__stop';
      button.dataset['part'] = parts.stop;
      button.dataset['year'] = year;
      button.dataset['index'] = String(index);
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', 'false');
      button.setAttribute('aria-label', year);
      button.setAttribute('aria-describedby', captionId);
      button.tabIndex = 0;
      button.style.touchAction = 'none';

      const dot = doc.createElement('span');
      dot.className = 'cafe-timeline__dot';
      dot.dataset['part'] = parts.dot;
      dot.setAttribute('aria-hidden', 'true');

      const label = doc.createElement('span');
      label.className = 'cafe-timeline__stop-label';
      label.dataset['part'] = parts.stopLabel;
      label.textContent = year;

      button.append(dot, label);

      const captionElement = doc.createElement('span');
      captionElement.className = 'cafe-timeline__stop-caption';
      captionElement.dataset['part'] = parts.stopCaption;
      captionElement.id = captionId;
      captionElement.textContent = this.captions[year] ?? '';

      tick.append(button, captionElement);
      stopList.append(tick);

      stops.push({
        year,
        index,
        label: year,
        caption: this.captions[year] ?? '',
        button,
        captionElement,
      });
    });

    trackArea.append(rail, stopList);
    panel.append(readout, trackArea);
    root.append(panel);

    return {
      root,
      panel,
      rail,
      thumb,
      progress,
      activeYear,
      activeYearValue,
      activeYearCaption,
      stops,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Interaction                                                            */
  /* ---------------------------------------------------------------------- */

  private attachListeners(): void {
    const area = this.panel;
    this.listen(area, 'pointerdown', this.handlePointerDown);
    this.listen(area, 'click', this.handleClick);
    this.listen(area, 'keydown', this.handleKeyDown);
    this.listen(area, 'wheel', this.handleWheel, { passive: true });
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: EventListener,
    options: { readonly passive?: boolean } = {},
  ): void {
    const listenerOptions: AddEventListenerOptions = { capture: false, passive: options.passive ?? false };
    target.addEventListener(type, handler, listenerOptions);
    this.teardowns.push(() => {
      target.removeEventListener(type, handler, listenerOptions);
    });
  }

  /** Primary-button pointer press anywhere on the chrome: start a drag gesture. */
  private handlePointerDown = (event: Event): void => {
    if (this.disposedState) return;
    const pointer = event as PointerEvent;
    if (typeof pointer.button === 'number' && pointer.button !== 0) return;

    // The press belongs to the timeline: the camera controls on the canvas
    // underneath the overlay must not start an orbit from it.
    event.stopPropagation();

    this.lastGesturePointerId = null;
    this.suppressClickUntil = 0;
    this.gesture = {
      pointerId: typeof pointer.pointerId === 'number' ? pointer.pointerId : null,
      emitted: null,
    };
    this.element.dataset['dragging'] = 'true';
    this.listenToGesture();

    const year = this.yearFromPointer(pointer);
    if (year) {
      this.gesture.emitted = year;
      this.applySelection(year, 'drag', true);
    }
    this.capturePointer(pointer);
  };

  /** Pointer moved during a gesture: follow it across the stops. */
  private handleGestureMove = (event: Event): void => {
    const gesture = this.gesture;
    if (!gesture || this.disposedState) return;
    const pointer = event as PointerEvent;
    if (!this.matchesGesture(gesture, pointer)) return;
    event.stopPropagation();
    const year = this.yearFromPointer(pointer);
    if (!year || year === gesture.emitted) return;
    gesture.emitted = year;
    this.applySelection(year, 'drag', true);
  };

  /** Pointer released: settle on the stop under the pointer and end the gesture. */
  private handleGestureEnd = (event: Event): void => {
    const gesture = this.gesture;
    if (!gesture) return;
    const pointer = event as PointerEvent;
    if (this.matchesGesture(gesture, pointer)) {
      event.stopPropagation();
      // Only a measurable release position settles the drag: without layout the
      // gesture already ended on the last position it could resolve.
      const year = this.yearFromPointer(pointer, { viewportFallback: false });
      if (year && year !== gesture.emitted) {
        gesture.emitted = year;
        this.applySelection(year, 'drag', true);
      }
    }
    this.endGesture(pointer);
  };

  /**
   * Click on a stop (pointer, keyboard `Enter`/`Space` or assistive technology).
   * Clicks already handled by the preceding pointer gesture are ignored so a
   * press produces exactly one selection event.
   */
  private handleClick = (event: Event): void => {
    if (this.disposedState) return;
    event.stopPropagation();
    const mouse = event as MouseEvent & PointerLikeEvent;
    const pointerId = mouse.pointerId;
    const handledByGesture = typeof pointerId === 'number' && pointerId === this.lastGesturePointerId;
    const followsGesture =
      typeof mouse.detail === 'number' &&
      mouse.detail > 0 &&
      this.suppressClickUntil > 0 &&
      Date.now() < this.suppressClickUntil;
    if (handledByGesture || followsGesture) return;

    const stop = this.stopFromTarget(mouse.target ?? null);
    const year = stop ? stop.year : this.yearFromPointer(mouse);
    if (year) this.applySelection(year, 'click', true);
  };

  /** Arrow keys, Home and End walk the timeline; everything else is left alone. */
  private handleKeyDown = (event: Event): void => {
    if (this.disposedState) return;
    const keyboard = event as KeyboardEvent;
    const year = keyTargetYear(keyboard.key, this.currentYear);
    if (year === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.applySelection(year, 'keyboard', true);
    // Radio semantics: when a stop has focus, the selection takes focus with it.
    if (this.stopFromTarget(keyboard.target ?? null)) this.focus();
  };

  /** Wheel over the chrome must not zoom the camera underneath the overlay. */
  private handleWheel = (event: Event): void => {
    event.stopPropagation();
  };

  private capturePointer(pointer: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId === null) return;
    const rail = this.rail as HTMLElement & { setPointerCapture?: (pointerId: number) => void };
    if (typeof rail.setPointerCapture !== 'function') return;
    try {
      rail.setPointerCapture(gesture.pointerId);
    } catch {
      /* pointer capture is an optimisation: dragging works without it */
    }
  }

  private listenToGesture(): void {
    if (this.gestureListeners.length > 0) return;
    const doc = this.ownerDocument;
    const add = (type: string, handler: EventListener): void => {
      // Capture phase: while the visitor drags the thumb, pointer events must not
      // reach the camera controls on the canvas underneath the overlay.
      doc.addEventListener(type, handler, true);
      this.gestureListeners.push({ target: doc, type, handler, capture: true });
    };
    add('pointermove', this.handleGestureMove);
    add('pointerup', this.handleGestureEnd);
    add('pointercancel', this.handleGestureEnd);
  }

  private endGesture(pointer?: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;
    if (pointer && typeof pointer.pointerId === 'number') {
      const rail = this.rail as HTMLElement & { releasePointerCapture?: (pointerId: number) => void };
      if (typeof rail.releasePointerCapture === 'function') {
        try {
          rail.releasePointerCapture(pointer.pointerId);
        } catch {
          /* capture may never have been taken */
        }
      }
      this.lastGesturePointerId = pointer.pointerId;
    }
    this.gesture = null;
    delete this.element.dataset['dragging'];
    for (const entry of this.gestureListeners.splice(0)) {
      entry.target.removeEventListener(entry.type, entry.handler, entry.capture);
    }
    // A click event follows the release; the pointer gesture already emitted.
    this.suppressClickUntil = Date.now() + CLICK_SUPPRESSION_MS;
  }

  private matchesGesture(gesture: Gesture, pointer: PointerEvent): boolean {
    if (gesture.pointerId === null || typeof pointer.pointerId !== 'number') return true;
    return gesture.pointerId === pointer.pointerId;
  }

  /**
   * Era under a pointer or click position.
   *
   * A laid-out rail is measured directly. Headless DOMs report a zero-width box,
   * so the stop under the event is used when there is one, and the viewport width
   * is the last resort — that keeps drag interactions deterministic in tests
   * without changing behaviour in a laid-out browser.
   */
  private yearFromPointer(
    event: PointerLikeEvent,
    options: { readonly viewportFallback?: boolean } = {},
  ): YearId | null {
    const clientX = event.clientX;
    const usableX = typeof clientX === 'number' && Number.isFinite(clientX);
    if (usableX) {
      const rect = this.rail.getBoundingClientRect();
      if (Number.isFinite(rect.width) && rect.width > 0) {
        return this.yearForRatio((clientX - rect.left) / rect.width);
      }
    }
    const fromTarget = this.stopFromTarget(event.target ?? null);
    if (fromTarget) return fromTarget.year;
    const width = this.ownerWindow?.innerWidth;
    if (
      options.viewportFallback !== false &&
      usableX &&
      typeof width === 'number' &&
      Number.isFinite(width) &&
      width > 0
    ) {
      return this.yearForRatio(clientX / width);
    }
    return null;
  }

  private yearForRatio(ratio: number): YearId | null {
    const maxIndex = this.years.length - 1;
    if (maxIndex <= 0) return this.years[0] ?? null;
    const index = Math.round(Math.min(Math.max(ratio, 0), 1) * maxIndex);
    return this.years[index] ?? null;
  }

  private stopFromTarget(target: EventTarget | null): TimelineStopHandle | null {
    let node: Node | null = isElement(target) ? target : null;
    while (node !== null) {
      if (isElement(node)) {
        if (node === this.element) return null;
        if (node.getAttribute('data-part') === TIMELINE_SLIDER_PARTS.stop) {
          const year = node.getAttribute('data-year');
          return year === null ? null : (this.stopFor(year) ?? null);
        }
      }
      node = node.parentNode;
    }
    return null;
  }

  private stopFor(year: string): TimelineStopHandle | undefined {
    return this.stops.find((stop) => stop.year === year);
  }

  /* ---------------------------------------------------------------------- */
  /* Selection and rendering                                                */
  /* ---------------------------------------------------------------------- */

  private applySelection(
    year: YearId,
    source: TimelineInteractionSource,
    emit: boolean,
  ): boolean {
    const previousYear = this.currentYear;
    const changed = previousYear !== year;
    this.currentYear = year;
    this.render();
    if (emit) {
      this.emitChange({
        year,
        index: yearIndex(year),
        previousYear,
        changed,
        source,
      });
    }
    return changed;
  }

  private emitChange(detail: TimelineYearChangeDetail): void {
    const payload = Object.freeze({ ...detail });
    const listeners = this.changeListeners.slice();
    const option = this.onChangeOption;
    const dispatch = (listener: TimelineYearChangeListener): void => {
      try {
        listener(payload.year, payload);
      } catch (error) {
        console.error('[timeline] year-change listener failed', error);
      }
    };
    if (option) dispatch(option);
    for (const listener of listeners) dispatch(listener);
    this.dispatchDomEvent(TIMELINE_YEAR_CHANGE_EVENT, payload);
    this.dispatchDomEvent(TIMELINE_CHANGE_EVENT, payload);
  }

  private dispatchDomEvent(type: string, detail: TimelineYearChangeDetail): void {
    const Ctor = this.ownerWindow?.CustomEvent ?? (typeof CustomEvent === 'function' ? CustomEvent : null);
    if (!Ctor) return;
    this.element.dispatchEvent(new Ctor(type, { detail, bubbles: true, cancelable: false }));
  }

  private render(): void {
    const index = yearIndex(this.currentYear);
    const maxIndex = this.years.length - 1;
    const percent = railPercent(index, maxIndex);
    const ratio = maxIndex > 0 ? Math.min(Math.max(index / maxIndex, 0), 1) : 0;
    const caption = this.captionOf(this.currentYear);

    this.element.dataset['year'] = this.currentYear;
    this.element.dataset['index'] = String(index);
    this.element.dataset['reducedMotion'] = this.reducedMotionState ? 'true' : 'false';

    this.rail.setAttribute('aria-valuenow', String(index));
    this.rail.setAttribute('aria-valuetext', this.currentYear);

    this.progress.style.transform = `scaleX(${ratio})`;
    this.thumb.style.left = percent;
    this.thumb.dataset['year'] = this.currentYear;

    this.activeYearElement.dataset['year'] = this.currentYear;
    this.activeYearValue.textContent = this.currentYear;
    this.activeYearCaption.textContent = caption;

    for (const stop of this.stops) {
      const active = stop.year === this.currentYear;
      stop.button.setAttribute('aria-checked', active ? 'true' : 'false');
      stop.button.dataset['active'] = active ? 'true' : 'false';
      if (active) stop.button.setAttribute('aria-current', 'true');
      else stop.button.removeAttribute('aria-current');
    }

    this.applyMotionStyles();
  }

  /** Zero-duration transitions when motion is reduced; stylesheet otherwise. */
  private applyMotionStyles(): void {
    const animated: HTMLElement[] = [this.thumb, this.progress];
    for (const element of animated) {
      if (this.reducedMotionState) {
        element.style.transitionProperty = 'none';
        element.style.transitionDuration = '0s';
        element.style.transitionDelay = '0s';
        element.style.transitionTimingFunction = 'linear';
      } else {
        element.style.transitionProperty = '';
        element.style.transitionDuration = '';
        element.style.transitionDelay = '';
        element.style.transitionTimingFunction = '';
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Reduced motion                                                         */
  /* ---------------------------------------------------------------------- */

  private bindMediaQuery(): void {
    const probe = this.matchMediaProbe;
    if (!probe) return;
    const list = probe(TIMELINE_REDUCED_MOTION_QUERY);
    if (!list) return;
    const handler = (event: { readonly matches?: boolean }): void => {
      this.setReducedMotion(event.matches === true);
    };
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', handler);
      this.mediaQuerySubscription = { list, handler };
      return;
    }
    if (typeof list.addListener === 'function') {
      list.addListener(handler);
      this.mediaQuerySubscription = { list, handler };
    }
  }

  private unbindMediaQuery(): void {
    const subscription = this.mediaQuerySubscription;
    if (!subscription) return;
    this.mediaQuerySubscription = null;
    const { list, handler } = subscription;
    if (typeof list.removeEventListener === 'function') {
      list.removeEventListener('change', handler);
      return;
    }
    if (typeof list.removeListener === 'function') list.removeListener(handler);
  }
}

/* -------------------------------------------------------------------------- */
/* Factory                                                                    */
/* -------------------------------------------------------------------------- */

/** Creates the top timeline slider. Pass `container` to mount it immediately. */
export function createTimelineSlider(options: TimelineSliderOptions = {}): TimelineSlider {
  return new TimelineSliderControl(options);
}

/** Runtime guard for an object handed around as a {@link TimelineSlider}. */
export function isTimelineSlider(value: unknown): value is TimelineSlider {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['select'] === 'function' &&
    typeof candidate['selectIndex'] === 'function' &&
    typeof candidate['step'] === 'function' &&
    typeof candidate['onYearChange'] === 'function' &&
    typeof candidate['dispose'] === 'function' &&
    isElement(candidate['element']) &&
    Array.isArray(candidate['years']) &&
    isYearId(candidate['year'])
  );
}
