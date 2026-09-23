/**
 * Chrono City — top-of-screen timeline slider.
 *
 * The primary control of the experience: a five-stop era slider pinned to the
 * top of the viewport, presenting exactly 1945 / 1965 / 1985 / 2005 / 2025.
 *
 * The slider is a *pure view* over the selected era. The authoritative year
 * lives in `TimelineRuntime`; the slider mirrors it through `setEra()` and
 * reports user intent back through `onInteract`. It never mutates scene systems
 * itself, which keeps the timeline runtime the single source of truth for the
 * year and makes the HUD safe to re-render from a `SceneContext` tick.
 *
 * Interaction contract:
 *   * click / tap a stop   → select that year (`source: 'click' | 'touch'`)
 *   * drag the thumb       → snap to the nearest stop while dragging (`'drag'`)
 *   * Arrow / PageUp / Down → step one year from the focused track (`'keyboard'`)
 *   * Home / End           → jump to the oldest / newest stop
 *   * Enter / Space        → re-activate the focused year (announce + SFX)
 *   * Tab                  → the track is a single tab stop with a focus ring
 *
 * Lifecycle:
 *   create    → `createTimelineSlider()` / `new TimelineSlider(options)`.
 *   consume   → `setEra()` mirrors timeline state, `setTransitionProgress()`
 *               paints the tween, `onInteract` reports intent.
 *   integrate → `createHudApi()` mounts one slider in the overlay root and
 *               wires both directions together.
 */

import { ERA_IDS, clamp01, isEraId, type EraId } from '../core/eraContracts';
import { getEraDescriptor } from '../era/eraDescriptors';

export const TIMELINE_SLIDER_VERSION = 1;

/** Root attribute marking the slider (and its state) for harness probes. */
export const TIMELINE_ATTRIBUTE = 'data-chrono-timeline';

/**
 * Stable query hooks for Playwright/harness code, so specs never depend on
 * class names or DOM depth.
 */
export const TIMELINE_SELECTORS = Object.freeze({
  root: `[${TIMELINE_ATTRIBUTE}="root"]`,
  track: `[${TIMELINE_ATTRIBUTE}="track"]`,
  rail: `[${TIMELINE_ATTRIBUTE}="rail"]`,
  fill: `[${TIMELINE_ATTRIBUTE}="fill"]`,
  thumb: `[${TIMELINE_ATTRIBUTE}="thumb"]`,
  stop: `[${TIMELINE_ATTRIBUTE}="stop"]`,
  title: `[${TIMELINE_ATTRIBUTE}="title"]`,
  year: `[${TIMELINE_ATTRIBUTE}="year"]`,
  tooltip: `[${TIMELINE_ATTRIBUTE}="tooltip"]`,
  tooltipLabel: `[${TIMELINE_ATTRIBUTE}="tooltip-label"]`,
  tooltipCopy: `[${TIMELINE_ATTRIBUTE}="tooltip-copy"]`,
});

/** Where a year change came from. `'api'` marks a mirror of external state. */
export type TimelineInputSource = 'click' | 'drag' | 'keyboard' | 'touch' | 'api';

/** Which UI cue the interaction should voice. */
export type TimelineSoundKind = 'click' | 'tick';

/** One authored stop on the timeline. */
export interface TimelineStop {
  readonly era: EraId;
  readonly year: number;
  readonly label: string;
  readonly description: string;
}

/** A single user (or API) interaction with the slider. */
export interface TimelineInteraction {
  readonly era: EraId;
  readonly year: number;
  readonly index: number;
  readonly source: TimelineInputSource;
  /** `true` when the interaction moves the selected year. */
  readonly selection: boolean;
  /** `true` for an explicit Enter/Space activation of the current year. */
  readonly activation: boolean;
  readonly sound: TimelineSoundKind;
}

export interface TimelineSliderOptions {
  /** Stops to present, oldest first. Defaults to the five canonical eras. */
  readonly stops?: readonly TimelineStop[];
  /** Initial selected year. Defaults to the newest stop. */
  readonly value?: EraId | number | string;
  /** Accessible name of the track. Defaults to `Era timeline`. */
  readonly label?: string;
  /** Small kicker shown above the era title. Defaults to `Timeline`. */
  readonly caption?: string;
  /** Element the slider is appended to. */
  readonly root?: HTMLElement;
  /** Document override (defaults to the root's owner document). */
  readonly document?: Document;
  /** Called for every user interaction; the HUD wires this to the runtime. */
  readonly onInteract?: (interaction: TimelineInteraction) => void;
}

/**
 * The default stop table, derived from the shared era contracts so the slider
 * can never drift from the five authored years.
 */
export const TIMELINE_STOPS: readonly TimelineStop[] = Object.freeze(
  ERA_IDS.map((era) => {
    const descriptor = getEraDescriptor(era);
    return Object.freeze({
      era,
      year: descriptor.year,
      label: descriptor.label,
      description: descriptor.description,
    });
  }),
);

/* ------------------------------------------------------------------------- *
 * DOM helpers
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

function resolveDocument(options: TimelineSliderOptions): Document {
  if (options.document) return options.document;
  if (options.root?.ownerDocument) return options.root.ownerDocument;
  if (typeof document !== 'undefined') return document;
  throw new Error('createTimelineSlider() needs a DOM document.');
}

function resolveRoot(documentRef: Document, provided?: HTMLElement): HTMLElement {
  if (provided) return provided;
  const existing = documentRef.querySelector<HTMLElement>('[data-chrono-overlay]');
  if (existing) return existing;
  if (documentRef.body) return documentRef.body;
  throw new Error('createTimelineSlider() needs an overlay root or a document body.');
}

function normalizeStops(stops: readonly TimelineStop[]): readonly TimelineStop[] {
  if (stops.length < 2) {
    throw new RangeError('createTimelineSlider() needs at least two stops.');
  }
  const ordered = [...stops].sort((left, right) => left.year - right.year);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].year <= ordered[index - 1].year) {
      throw new RangeError('createTimelineSlider() stops must have unique ascending years.');
    }
  }
  return ordered;
}

/** Percentage position of stop `index` along the rail. */
function positionPercent(index: number, count: number): number {
  if (count <= 1) return 0;
  return (index / (count - 1)) * 100;
}

/* ------------------------------------------------------------------------- *
 * TimelineSlider
 * ------------------------------------------------------------------------- */

/**
 * The era slider widget. Every DOM mutation funnels through
 * `applySelection()` / `render()`, so the markup is always a direct projection
 * of the last known year plus the live hover/drag preview.
 */
export class TimelineSlider {
  readonly version = TIMELINE_SLIDER_VERSION;

  /** Root element (`<section>`); carries the slider state attributes. */
  readonly root: HTMLElement;
  /** The focusable `role="slider"` track. */
  readonly track: HTMLElement;
  /** Header showing the active era title / year. */
  readonly titleElement: HTMLElement;
  readonly yearElement: HTMLElement;
  /** Floating tooltip describing the active (or hovered) era. */
  readonly tooltipElement: HTMLElement;
  readonly tooltipLabelElement: HTMLElement;
  readonly tooltipCopyElement: HTMLElement;
  readonly fillElement: HTMLElement;
  readonly thumbElement: HTMLElement;
  /** One button per stop, in chronological order. */
  readonly stopElements: readonly HTMLButtonElement[];

  readonly stops: readonly TimelineStop[];

  private readonly documentRef: Document;
  private readonly trackElement: HTMLElement;
  private readonly stopsContainer: HTMLElement;
  private readonly onInteract: ((interaction: TimelineInteraction) => void) | undefined;
  private readonly label: string;

  private selectedIndexState: number;
  private previewIndexState: number | null = null;
  private progressState = 1;
  private draggingState = false;
  private dragPointerId: number | null = null;
  private disposedState = false;

  constructor(options: TimelineSliderOptions = {}) {
    this.stops = normalizeStops(options.stops ?? TIMELINE_STOPS);
    this.documentRef = resolveDocument(options);
    this.onInteract = options.onInteract;
    this.label = options.label ?? 'Era timeline';
    this.selectedIndexState = this.resolveIndex(options.value ?? this.stops[this.stops.length - 1].era);

    const root = createElement(this.documentRef, 'section', 'chrono-timeline', {
      [TIMELINE_ATTRIBUTE]: 'root',
      'data-chrono-timeline-count': String(this.stops.length),
      'aria-label': this.label,
    });
    Object.assign(root.style, {
      pointerEvents: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);

    const head = createElement(this.documentRef, 'div', 'chrono-timeline__head');
    const caption = createElement(this.documentRef, 'span', 'chrono-timeline__caption');
    caption.textContent = options.caption ?? 'Timeline';
    const title = createElement(this.documentRef, 'span', 'chrono-timeline__title', {
      [TIMELINE_ATTRIBUTE]: 'title',
    });
    const year = createElement(this.documentRef, 'span', 'chrono-timeline__year', {
      [TIMELINE_ATTRIBUTE]: 'year',
    });
    head.appendChild(caption);
    head.appendChild(title);
    head.appendChild(year);

    const track = createElement(this.documentRef, 'div', 'chrono-timeline__track', {
      [TIMELINE_ATTRIBUTE]: 'track',
      role: 'slider',
      tabindex: '0',
      'aria-label': this.label,
      'aria-orientation': 'horizontal',
    });
    Object.assign(track.style, {
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    const rail = createElement(this.documentRef, 'div', 'chrono-timeline__rail', {
      [TIMELINE_ATTRIBUTE]: 'rail',
    });
    const fill = createElement(this.documentRef, 'div', 'chrono-timeline__fill', {
      [TIMELINE_ATTRIBUTE]: 'fill',
    });
    const thumb = createElement(this.documentRef, 'div', 'chrono-timeline__thumb', {
      [TIMELINE_ATTRIBUTE]: 'thumb',
      'aria-hidden': 'true',
    });
    const stopsContainer = createElement(this.documentRef, 'div', 'chrono-timeline__stops');
    track.appendChild(rail);
    track.appendChild(fill);
    track.appendChild(thumb);

    const stopElements = this.stops.map((stop, index) =>
      this.createStop(stop, index),
    );
    for (const element of stopElements) stopsContainer.appendChild(element);
    track.appendChild(stopsContainer);

    const tooltip = createElement(this.documentRef, 'div', 'chrono-timeline__tooltip', {
      [TIMELINE_ATTRIBUTE]: 'tooltip',
      role: 'tooltip',
    });
    const tooltipLabel = createElement(this.documentRef, 'strong', 'chrono-timeline__tooltip-label', {
      [TIMELINE_ATTRIBUTE]: 'tooltip-label',
    });
    const tooltipCopy = createElement(this.documentRef, 'span', 'chrono-timeline__tooltip-copy', {
      [TIMELINE_ATTRIBUTE]: 'tooltip-copy',
    });
    tooltip.appendChild(tooltipLabel);
    tooltip.appendChild(tooltipCopy);

    root.appendChild(head);
    root.appendChild(track);
    root.appendChild(tooltip);
    resolveRoot(this.documentRef, options.root).appendChild(root);

    this.root = root;
    this.track = track;
    this.trackElement = track;
    this.stopsContainer = stopsContainer;
    this.titleElement = title;
    this.yearElement = year;
    this.tooltipElement = tooltip;
    this.tooltipLabelElement = tooltipLabel;
    this.tooltipCopyElement = tooltipCopy;
    this.fillElement = fill;
    this.thumbElement = thumb;
    this.stopElements = stopElements;

    track.addEventListener('keydown', this.handleKeyDown);
    track.addEventListener('pointerdown', this.handlePointerDown);
    track.addEventListener('pointermove', this.handlePointerMove);
    track.addEventListener('pointerup', this.handlePointerUp);
    track.addEventListener('pointercancel', this.handlePointerUp);
    track.addEventListener('pointerleave', this.handlePointerLeave);
    track.addEventListener('focus', this.handleFocus);
    track.addEventListener('blur', this.handleBlur);

    this.render();
  }

  /* ---------------- state ---------------- */

  /** Era currently mirrored from the timeline. */
  get selectedEra(): EraId {
    return this.stops[this.selectedIndexState].era;
  }

  /** Numeric year currently mirrored from the timeline. */
  get selectedYear(): number {
    return this.stops[this.selectedIndexState].year;
  }

  /** Index of the mirrored stop. */
  get selectedIndex(): number {
    return this.selectedIndexState;
  }

  /** `true` while a pointer/touch drag is moving the thumb. */
  get isDragging(): boolean {
    return this.draggingState;
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  /**
   * Mirrors an externally-owned year into the slider. `source` is informational
   * (defaults to `'api'`) and never triggers `onInteract`: mirroring must never
   * bounce back into the timeline.
   */
  setEra(value: EraId | number | string): void {
    this.applySelection(this.resolveIndex(value));
  }

  /** Selects the stop at `index` (clamped). */
  setIndex(index: number): void {
    this.applySelection(clampIndex(index, this.stops.length));
  }

  /** Paints the running era tween: `1` (settled) shows no transition glow. */
  setTransitionProgress(progress: number): void {
    const next = Number.isFinite(progress) ? clamp01(progress) : 1;
    if (next === this.progressState) return;
    this.progressState = next;
    this.root.style.setProperty('--chrono-timeline-progress', next.toFixed(3));
    this.root.dataset.chronoTimelineProgress = next.toFixed(3);
  }

  /** Moves DOM focus to the track (the single tab stop). */
  focus(): void {
    if (this.disposedState) return;
    try {
      this.track.focus({ preventScroll: true });
    } catch {
      this.track.focus();
    }
  }

  /** Removes listeners and the root element. */
  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.track.removeEventListener('keydown', this.handleKeyDown);
    this.track.removeEventListener('pointerdown', this.handlePointerDown);
    this.track.removeEventListener('pointermove', this.handlePointerMove);
    this.track.removeEventListener('pointerup', this.handlePointerUp);
    this.track.removeEventListener('pointercancel', this.handlePointerUp);
    this.track.removeEventListener('pointerleave', this.handlePointerLeave);
    this.track.removeEventListener('focus', this.handleFocus);
    this.track.removeEventListener('blur', this.handleBlur);
    for (const element of this.stopElements) {
      element.removeEventListener('click', this.handleStopClick);
      element.removeEventListener('pointerenter', this.handleStopEnter);
    }
    this.root.remove();
  }

  /* ---------------- construction ---------------- */

  private createStop(stop: TimelineStop, index: number): HTMLButtonElement {
    const element = createElement(this.documentRef, 'button', 'chrono-timeline__stop', {
      type: 'button',
      [TIMELINE_ATTRIBUTE]: 'stop',
      'data-chrono-timeline-index': String(index),
      'data-chrono-timeline-year': String(stop.year),
      'data-chrono-timeline-era': stop.era,
      tabindex: '-1',
      title: `${stop.year} — ${stop.label}`,
      'aria-label': `${stop.year} — ${stop.label}`,
    });
    Object.assign(element.style, {
      left: `${positionPercent(index, this.stops.length)}%`,
    } satisfies Partial<CSSStyleDeclaration>);

    const dot = createElement(this.documentRef, 'span', 'chrono-timeline__stop-dot', {
      'aria-hidden': 'true',
    });
    const caption = createElement(this.documentRef, 'span', 'chrono-timeline__stop-year');
    caption.textContent = String(stop.year);
    element.appendChild(dot);
    element.appendChild(caption);

    element.addEventListener('click', this.handleStopClick);
    element.addEventListener('pointerenter', this.handleStopEnter);
    return element;
  }

  /* ---------------- index maths ---------------- */

  private resolveIndex(value: EraId | number | string): number {
    if (typeof value === 'number') return this.nearestIndex(value);
    if (isEraId(value)) {
      const index = this.stops.findIndex((stop) => stop.era === value);
      if (index >= 0) return index;
    }
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return this.nearestIndex(parsed);
    throw new RangeError(`TimelineSlider cannot resolve year "${String(value)}".`);
  }

  private nearestIndex(year: number): number {
    const first = this.stops[0].year;
    const last = this.stops[this.stops.length - 1].year;
    const clamped = Math.min(last, Math.max(first, year));
    let best = 0;
    let bestDelta = Number.POSITIVE_INFINITY;
    this.stops.forEach((stop, index) => {
      const delta = Math.abs(stop.year - clamped);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = index;
      }
    });
    return best;
  }

  private indexFromClientX(clientX: number): number {
    const rect = this.trackElement.getBoundingClientRect();
    const width = rect.width || this.trackElement.clientWidth || 0;
    if (!(width > 0) || !Number.isFinite(clientX)) return this.selectedIndexState;
    const ratio = clamp01((clientX - rect.left) / width);
    return Math.round(ratio * (this.stops.length - 1));
  }

  /* ---------------- interactions ---------------- */

  /**
   * Reports a user interaction and mirrors it optimistically, so the thumb
   * tracks a drag without waiting for the timeline. The timeline stays
   * authoritative: the next `setEra()` corrects any drift.
   */
  private requestSelection(index: number, source: TimelineInputSource, activation = false): void {
    if (this.disposedState) return;
    const next = clampIndex(index, this.stops.length);
    const stop = this.stops[next];
    const selection = next !== this.selectedIndexState;
    if (selection) {
      this.applySelection(next);
    } else if (activation) {
      this.render();
    }
    const sound: TimelineSoundKind =
      activation || source === 'click' || source === 'touch' ? 'click' : 'tick';
    this.onInteract?.({
      era: stop.era,
      year: stop.year,
      index: next,
      source,
      selection,
      activation,
      sound,
    });
  }

  private applySelection(index: number): void {
    const next = clampIndex(index, this.stops.length);
    this.selectedIndexState = next;
    this.previewIndexState = null;
    this.render();
  }

  /** Previews a stop in the tooltip without selecting it. */
  private preview(index: number | null): void {
    const next = index === null ? null : clampIndex(index, this.stops.length);
    if (next === this.previewIndexState) return;
    this.previewIndexState = next;
    this.render();
  }

  private readonly handleStopClick = (event: MouseEvent): void => {
    // Pointer-generated clicks are already handled by the track's pointer path;
    // only keyboard / programmatic activation (detail 0) arrives here.
    if (event.detail > 0) return;
    const index = this.indexOfTarget(event.currentTarget);
    if (index === null) return;
    this.requestSelection(index, 'keyboard', true);
  };

  private readonly handleStopEnter = (event: Event): void => {
    const index = this.indexOfTarget(event.currentTarget);
    if (index !== null) this.preview(index);
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.disposedState) return;
    if (event.pointerType !== 'touch' && typeof event.button === 'number' && event.button !== 0) {
      return;
    }
    this.consume(event);
    this.draggingState = true;
    this.dragPointerId = event.pointerId;
    this.root.dataset.chronoTimelineState = 'dragging';
    this.capturePointer(event.pointerId);
    this.focus();
    this.requestSelection(
      this.indexFromClientX(event.clientX),
      event.pointerType === 'touch' ? 'touch' : 'click',
    );
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.draggingState) return;
    if (this.dragPointerId !== null && event.pointerId !== this.dragPointerId) return;
    const index = this.indexFromClientX(event.clientX);
    // Only report a move that actually changes the year: dragging inside one
    // stop must not machine-gun the tick SFX.
    if (index === this.selectedIndexState) return;
    this.consume(event);
    const source: TimelineInputSource = event.pointerType === 'touch' ? 'touch' : 'drag';
    this.requestSelection(index, source);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.draggingState) return;
    if (this.dragPointerId !== null && event.pointerId !== this.dragPointerId) return;
    this.draggingState = false;
    this.dragPointerId = null;
    this.releasePointer(event.pointerId);
    this.root.dataset.chronoTimelineState = 'settled';
    if (event.pointerType === 'touch') {
      this.requestSelection(this.indexFromClientX(event.clientX), 'touch');
    }
  };

  private readonly handlePointerLeave = (): void => {
    if (!this.draggingState) this.preview(null);
  };

  private readonly handleFocus = (): void => {
    this.root.dataset.chronoTimelineFocus = 'true';
  };

  private readonly handleBlur = (): void => {
    this.root.dataset.chronoTimelineFocus = 'false';
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.disposedState) return;
    const last = this.stops.length - 1;
    let nextIndex: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        nextIndex = Math.min(last, this.selectedIndexState + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        nextIndex = Math.max(0, this.selectedIndexState - 1);
        break;
      case 'PageUp':
        nextIndex = 0;
        break;
      case 'PageDown':
        nextIndex = last;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = last;
        break;
      case 'Enter':
      case ' ':
        this.consume(event);
        this.requestSelection(this.selectedIndexState, 'keyboard', true);
        return;
      default:
        return;
    }
    this.consume(event);
    if (nextIndex !== null) this.requestSelection(nextIndex, 'keyboard');
  };

  /* ---------------- pointer plumbing ---------------- */

  private consume(event: Event): void {
    if (event.cancelable) event.preventDefault();
    // The navigation rig listens for keys/pointers above the overlay; a HUD
    // gesture must never leak into camera control.
    event.stopPropagation();
  }

  private capturePointer(pointerId: number): void {
    const target = this.trackElement as HTMLElement & {
      setPointerCapture?: (id: number) => void;
    };
    try {
      target.setPointerCapture?.(pointerId);
    } catch {
      // jsdom and older engines have no pointer capture; window listeners cover it.
    }
  }

  private releasePointer(pointerId: number): void {
    const target = this.trackElement as HTMLElement & {
      releasePointerCapture?: (id: number) => void;
      hasPointerCapture?: (id: number) => boolean;
    };
    try {
      if (target.hasPointerCapture?.(pointerId) ?? true) target.releasePointerCapture?.(pointerId);
    } catch {
      // No capture to release.
    }
  }

  private indexOfTarget(target: EventTarget | null): number | null {
    if (!(target instanceof HTMLElement)) return null;
    const raw = target.getAttribute('data-chrono-timeline-index');
    if (raw === null) return null;
    const index = Number.parseInt(raw, 10);
    return Number.isFinite(index) ? index : null;
  }

  /* ---------------- rendering ---------------- */

  private render(): void {
    if (this.disposedState) return;
    const count = this.stops.length;
    const selected = this.stops[this.selectedIndexState];
    const preview = this.previewIndexState === null ? null : this.stops[this.previewIndexState];
    const focused = preview ?? selected;
    const focusedIndex = this.previewIndexState ?? this.selectedIndexState;
    const percent = positionPercent(this.selectedIndexState, count);
    const focusedPercent = positionPercent(focusedIndex, count);

    this.root.dataset.chronoTimelineEra = selected.era;
    this.root.dataset.chronoTimelineYear = String(selected.year);
    this.root.dataset.chronoTimelineSelected = String(this.selectedIndexState);
    this.root.dataset.chronoTimelineState = this.draggingState ? 'dragging' : 'settled';
    this.root.dataset.chronoTimelinePreview = preview ? preview.era : '';
    this.root.style.setProperty('--chrono-timeline-position', `${percent}%`);
    this.root.style.setProperty('--chrono-timeline-progress', this.progressState.toFixed(3));

    this.titleElement.textContent = focused.label;
    this.yearElement.textContent = String(focused.year);
    this.tooltipElement.dataset.chronoTimelineTooltipEra = focused.era;
    this.tooltipElement.style.left = `${focusedPercent}%`;
    this.tooltipLabelElement.textContent = `${focused.year} — ${focused.label}`;
    this.tooltipCopyElement.textContent = focused.description;

    this.fillElement.style.width = `${percent}%`;
    this.thumbElement.style.left = `${percent}%`;

    this.trackElement.setAttribute('aria-valuemin', String(this.stops[0].year));
    this.trackElement.setAttribute('aria-valuemax', String(this.stops[count - 1].year));
    this.trackElement.setAttribute('aria-valuenow', String(selected.year));
    this.trackElement.setAttribute('aria-valuetext', `${selected.year} — ${selected.label}`);

    this.stopElements.forEach((element, index) => {
      const active = index === this.selectedIndexState;
      const highlighted = index === focusedIndex;
      element.dataset.chronoTimelineActive = active ? 'true' : 'false';
      element.dataset.chronoTimelineHighlighted = highlighted ? 'true' : 'false';
      element.setAttribute('aria-current', active ? 'true' : 'false');
      element.tabIndex = -1;
    });

    this.stopsContainer.dataset.chronoTimelineCount = String(count);
  }
}

/* ------------------------------------------------------------------------- *
 * Helpers + factory
 * ------------------------------------------------------------------------- */

function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(index)));
}

/** Creates one slider (`create` half of the lifecycle). */
export function createTimelineSlider(options: TimelineSliderOptions = {}): TimelineSlider {
  return new TimelineSlider(options);
}
