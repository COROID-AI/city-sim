/**
 * The top-of-screen era timeline.
 *
 * All slider *behaviour* lives in `timelineModel.ts`; this module is only the
 * DOM binding: five labelled stops, a draggable handle, keyboard operation,
 * live drag scrubbing (which reports fractional indices upward so the scene can
 * blend neighbours) and full ARIA slider semantics.
 */

import { ERAS } from '../config/eras';
import type { Year } from '../config/types';
import {
  STOP_YEARS,
  fractionToIndex,
  indexToFraction,
  keyboardIndex,
  sliderAria,
  snapIndex,
  snapYear,
} from './timelineModel';

export interface TimelineElements {
  root: HTMLElement;
  track: HTMLElement;
  stops: HTMLElement;
  progress: HTMLElement;
  handle: HTMLElement;
}

export interface TimelineCallbacks {
  /** Fired continuously while dragging (fractional index) or `null` on release. */
  onPreview(index: number | null): void;
  /** Fired on release / click / keyboard step with the snapped stop index. */
  onCommit(index: number): void;
  /** Fired whenever the displayed year changes (styling, audio, hash). */
  onYearChange(year: Year): void;
  /** Any UI interaction - used to unlock audio and dim the hint pill. */
  onInteraction?(): void;
}

/** Accent colour per era, driving the `--era-accent` CSS variable. */
export function eraAccent(year: Year): string {
  return ERAS[year].palette.sun;
}

export class TimelineUI {
  private readonly elements: TimelineElements;
  private readonly callbacks: TimelineCallbacks;
  private readonly stopButtons: HTMLButtonElement[] = [];
  private currentIndex = 0;
  private dragging = false;
  private detach: Array<() => void> = [];

  constructor(elements: TimelineElements, callbacks: TimelineCallbacks) {
    this.elements = elements;
    this.callbacks = callbacks;
    this.buildStops();
    this.bind();
    this.render(0);
  }

  get index(): number {
    return this.currentIndex;
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  /** Move to a snapped stop (e.g. the 1–5 shortcuts). Animates the scene. */
  selectIndex(index: number, notify = true): void {
    const snapped = snapIndex(index);
    this.currentIndex = snapped;
    this.render(snapped);
    if (notify) this.callbacks.onCommit(snapped);
  }

  /** Move to a year without committing (deep links restore state silently). */
  setYear(year: Year, notify = false): void {
    const index = STOP_YEARS.indexOf(year);
    if (index < 0) return;
    if (notify) this.selectIndex(index);
    else {
      this.currentIndex = index;
      this.render(index);
    }
  }

  /** Reflect an externally-driven fractional index (drag from the store). */
  setFractionalIndex(index: number): void {
    this.render(index);
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach = [];
    this.elements.stops.replaceChildren();
  }

  /* ------------------------------------------------------------ private -- */

  private buildStops(): void {
    this.elements.stops.replaceChildren();
    this.stopButtons.length = 0;
    STOP_YEARS.forEach((year, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'timeline-stop';
      button.dataset.index = String(index);
      button.style.left = `${indexToFraction(index) * 100}%`;
      button.setAttribute('aria-label', `Show ${year}: ${ERAS[year].title}`);
      button.innerHTML = `<span class="tick" aria-hidden="true"></span><span class="stop-year">${year}</span>`;
      const onClick = (event: MouseEvent): void => {
        event.stopPropagation();
        this.callbacks.onInteraction?.();
        this.callbacks.onPreview(null);
        this.selectIndex(index);
      };
      button.addEventListener('click', onClick);
      this.detach.push(() => button.removeEventListener('click', onClick));
      this.elements.stops.appendChild(button);
      this.stopButtons.push(button);
    });
  }

  private bind(): void {
    const root = this.elements.root;

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      // Stop buttons own their own click: pressing one must not start a drag
      // scrub, which would cut straight to the target era instead of morphing
      // the scene from the era currently on screen.
      const origin = event.target as Element | null;
      if (origin && typeof origin.closest === 'function' && origin.closest('.timeline-stop')) return;
      this.dragging = true;
      this.elements.handle.classList.add('dragging');
      root.setPointerCapture?.(event.pointerId);
      this.callbacks.onInteraction?.();
      this.applyPointer(event, true);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!this.dragging) return;
      this.applyPointer(event, true);
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (!this.dragging) return;
      this.dragging = false;
      this.elements.handle.classList.remove('dragging');
      root.releasePointerCapture?.(event.pointerId);
      const snapped = snapIndex(this.currentIndex);
      this.callbacks.onPreview(null);
      this.selectIndex(snapped);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const keys = [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'PageUp',
        'PageDown',
      ] as const;
      if (!(keys as readonly string[]).includes(event.key)) return;
      event.preventDefault();
      // Keep the app-level arrow shortcuts from stepping a second time.
      event.stopPropagation();
      this.callbacks.onInteraction?.();
      const next = keyboardIndex(this.currentIndex, event.key as (typeof keys)[number]);
      this.selectIndex(next);
    };

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerUp);
    root.addEventListener('keydown', onKeyDown);

    this.detach.push(
      () => root.removeEventListener('pointerdown', onPointerDown),
      () => root.removeEventListener('pointermove', onPointerMove),
      () => root.removeEventListener('pointerup', onPointerUp),
      () => root.removeEventListener('pointercancel', onPointerUp),
      () => root.removeEventListener('keydown', onKeyDown),
    );
  }

  private applyPointer(event: PointerEvent, preview: boolean): void {
    const rect = this.elements.track.getBoundingClientRect();
    const width = rect.width || 1;
    const fraction = (event.clientX - rect.left) / width;
    const index = fractionToIndex(fraction);
    this.currentIndex = index;
    this.render(index);
    if (preview) this.callbacks.onPreview(index);
  }

  /** Paint the slider for a (possibly fractional) index. */
  private render(index: number): void {
    const fraction = indexToFraction(index);
    this.elements.handle.style.left = `${fraction * 100}%`;
    // scaleX keeps the progress bar off the layout path (no width animation).
    this.elements.progress.style.transform = `scaleX(${fraction})`;

    const aria = sliderAria(index);
    this.elements.root.setAttribute('aria-valuemin', String(aria.min));
    this.elements.root.setAttribute('aria-valuemax', String(aria.max));
    this.elements.root.setAttribute('aria-valuenow', String(aria.now));
    this.elements.root.setAttribute('aria-valuetext', aria.valuetext);
    this.elements.root.setAttribute('role', 'slider');

    const activeIndex = snapIndex(index);
    this.stopButtons.forEach((button, i) => {
      if (i === activeIndex) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });

    const year = snapYear(index);
    const previousYear = STOP_YEARS[this.lastRenderedYearIndex];
    if (year !== previousYear || this.lastRenderedYearIndex === -1) {
      this.lastRenderedYearIndex = STOP_YEARS.indexOf(year);
      document.documentElement.style.setProperty('--era-accent', eraAccent(year));
      this.callbacks.onYearChange(year);
    }
  }

  private lastRenderedYearIndex = -1;
}
