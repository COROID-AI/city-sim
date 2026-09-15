/**
 * Timeline slider suite (jsdom).
 *
 * Covers the control contract the request mandates:
 *  - exactly five stops labelled 1945, 1965, 1985, 2005 and 2025, with era tick
 *    captions, an active-year indicator and a top-anchored, contract-pinned chrome,
 *  - selection through clicking a stop, dragging the thumb and Left/Right arrow
 *    keys (plus Home/End), each emitting the matching `YearId`,
 *  - clamping to the five valid eras for pointer, keyboard and programmatic input,
 *  - the `role="slider"` / `radiogroup` assistive model and focus handling,
 *  - reduced motion: zero-duration thumb transitions with selection unchanged,
 *  - event binding, unsubscribe and detached-on-dispose lifecycle,
 *  - the module boundary (era contracts only — no scene content).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_YEAR_ID, YEAR_IDS, isYearId, type YearId } from '../../contracts/period';
import sliderSource from './TimelineSlider.ts?raw';
import {
  ERA_TICK_CAPTIONS,
  TIMELINE_CHANGE_EVENT,
  TIMELINE_SLIDER_PARTS,
  TIMELINE_SLIDER_STYLE_ATTRIBUTE,
  TIMELINE_SLIDER_STYLE_ID,
  TIMELINE_YEAR_CHANGE_EVENT,
  createTimelineSlider,
  isTimelineSlider,
  type MediaQueryListLike,
  type TimelineSlider,
  type TimelineSliderOptions,
  type TimelineYearChangeDetail,
} from './TimelineSlider';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const openSliders: TimelineSlider[] = [];
const openHosts: HTMLElement[] = [];

function stage(): HTMLElement {
  const host = document.createElement('div');
  host.className = 'scene-stage';
  document.body.appendChild(host);
  openHosts.push(host);
  return host;
}

function mount(options: TimelineSliderOptions = {}): TimelineSlider {
  const control = createTimelineSlider({ container: stage(), ...options });
  openSliders.push(control);
  return control;
}

function adopt(control: TimelineSlider): TimelineSlider {
  openSliders.push(control);
  return control;
}

afterEach(() => {
  for (const control of openSliders.splice(0)) control.dispose();
  for (const host of openHosts.splice(0)) host.remove();
  document.body.replaceChildren();
});

const stops = (control: TimelineSlider): HTMLButtonElement[] =>
  Array.from(control.element.querySelectorAll<HTMLButtonElement>('[data-part="stop"]'));

const stopTexts = (control: TimelineSlider): Array<string | null> =>
  Array.from(control.element.querySelectorAll('[data-part="stop-label"]')).map((node) =>
    node.textContent?.trim() ?? null,
  );

const tickTexts = (control: TimelineSlider): Array<string | undefined> =>
  Array.from(control.element.querySelectorAll<HTMLElement>('[data-part="stop-caption"]')).map(
    (node) => node.textContent ?? undefined,
  );

const tickLefts = (control: TimelineSlider): string[] =>
  Array.from(control.element.querySelectorAll<HTMLElement>('[data-part="tick"]')).map(
    (node) => node.style.left,
  );

const activeYear = (control: TimelineSlider): HTMLElement => {
  const node = control.element.querySelector<HTMLElement>('[data-part="active-year"]');
  if (!node) throw new Error('active-year readout missing');
  return node;
};

const activeYearValue = (control: TimelineSlider): HTMLElement => {
  const node = control.element.querySelector<HTMLElement>('[data-part="active-year-value"]');
  if (!node) throw new Error('active-year value missing');
  return node;
};

const activeYearCaption = (control: TimelineSlider): HTMLElement => {
  const node = control.element.querySelector<HTMLElement>('[data-part="active-year-caption"]');
  if (!node) throw new Error('active-year caption missing');
  return node;
};

const injectedCss = (): string => {
  const style = document.querySelector(
    `style[${TIMELINE_SLIDER_STYLE_ATTRIBUTE}="${TIMELINE_SLIDER_STYLE_ID}"]`,
  );
  return style?.textContent ?? '';
};

interface Recording {
  readonly years: YearId[];
  readonly details: TimelineYearChangeDetail[];
  readonly from: YearId[];
}

function record(control: TimelineSlider): Recording {
  const years: YearId[] = [];
  const details: TimelineYearChangeDetail[] = [];
  control.onYearChange((year, detail) => {
    years.push(year);
    details.push(detail);
  });
  return { years, details, from: [] };
}

/** jsdom performs no layout, so a drag test supplies the rail's box. */
function stubRailBox(control: TimelineSlider, left: number, width: number): void {
  Object.defineProperty(control.rail, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: (): DOMRect => ({
      x: left,
      y: 0,
      left,
      right: left + width,
      top: 0,
      bottom: 24,
      width,
      height: 24,
      toJSON: () => ({}),
    }),
  });
}

function pointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  clientX: number,
  pointerId = 1,
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY: 12,
    pointerId,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
  });
  target.dispatchEvent(event);
  return event;
}

function key(target: EventTarget, name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

/* -------------------------------------------------------------------------- */
/* Stops, labels and chrome                                                   */
/* -------------------------------------------------------------------------- */

describe('stops, labels and chrome', () => {
  it('renders exactly the five contract stops in chronological order', () => {
    const control = mount();
    const buttons = stops(control);

    expect(buttons).toHaveLength(5);
    expect(buttons.map((button) => button.dataset['year'])).toEqual([...YEAR_IDS]);
    expect(stopTexts(control)).toEqual(['1945', '1965', '1985', '2005', '2025']);
    expect(new Set(stopTexts(control)).size).toBe(5);
    expect(control.years).toEqual([...YEAR_IDS]);
    expect(control.stops.map((handle) => handle.year)).toEqual([...YEAR_IDS]);
  });

  it('exposes each stop as a focusable radio labelled with its year and its tick caption', () => {
    const control = mount();
    const buttons = stops(control);

    YEAR_IDS.forEach((year, index) => {
      const button = buttons[index]!;
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('role')).toBe('radio');
      expect(button.getAttribute('aria-label')).toBe(year);
      expect(button.textContent?.trim()).toBe(year);
      expect(button.tabIndex).toBeGreaterThanOrEqual(0);

      const describedBy = button.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const caption = document.getElementById(describedBy ?? '');
      expect(caption?.textContent).toBe(ERA_TICK_CAPTIONS[year]);
      expect(button.contains(caption)).toBe(false);
    });

    expect(document.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toContain(
      'timeline',
    );
    expect(tickTexts(control)).toEqual(YEAR_IDS.map((year) => ERA_TICK_CAPTIONS[year]));
    expect(tickLefts(control)).toEqual(['0%', '25%', '50%', '75%', '100%']);
  });

  it('indicates the active year through the thumb, the stop state and the live readout', () => {
    const control = mount();
    const buttons = stops(control);

    expect(activeYearValue(control).textContent).toBe('1945');
    expect(activeYearCaption(control).textContent).toBe(ERA_TICK_CAPTIONS['1945']);
    expect(activeYear(control).getAttribute('role')).toBe('status');
    expect(activeYear(control).getAttribute('aria-live')).toBe('polite');
    expect(activeYear(control).textContent).toBe(`1945 ${ERA_TICK_CAPTIONS['1945']}`);
    expect(control.thumb.style.left).toBe('0%');
    expect(control.progress.style.transform).toBe('scaleX(0)');
    expect(buttons[0]!.getAttribute('aria-checked')).toBe('true');
    expect(buttons[0]!.dataset['active']).toBe('true');
    expect(buttons.slice(1).every((button) => button.getAttribute('aria-checked') === 'false')).toBe(
      true,
    );

    control.select('2005', { silent: true });

    expect(control.thumb.style.left).toBe('75%');
    expect(control.progress.style.transform).toBe('scaleX(0.75)');
    expect(control.element.dataset['year']).toBe('2005');
    expect(activeYearValue(control).textContent).toBe('2005');
    expect(activeYearCaption(control).textContent).toBe(ERA_TICK_CAPTIONS['2005']);
    expect(buttons[3]!.getAttribute('aria-checked')).toBe('true');
    expect(buttons[3]!.getAttribute('aria-current')).toBe('true');
    expect(buttons[0]!.getAttribute('aria-checked')).toBe('false');
    expect(buttons[0]!.hasAttribute('aria-current')).toBe(false);
  });

  it('pins the control to the top of the stage and leaves the canvas interactive', () => {
    const control = mount();

    expect(control.element.dataset['part']).toBe(TIMELINE_SLIDER_PARTS.root);
    expect(control.element.getAttribute('role')).toBe('group');
    expect(control.element.getAttribute('aria-label')).toBe(control.label);
    expect(control.element.style.position).toBe('absolute');
    expect(control.element.style.top).toBe('0px');
    expect(control.element.style.pointerEvents).toBe('none');
    expect(control.element.style.fontFamily).toContain('system-ui');

    const panel = control.element.querySelector<HTMLElement>('[data-part="panel"]');
    expect(panel?.style.pointerEvents).toBe('auto');

    const css = injectedCss();
    expect(css).toContain('.cafe-timeline {');
    expect(css).toContain('position: absolute;');
    expect(css).toContain('top: 0;');
    expect(css).toContain('pointer-events: none;');
  });

  it('exposes a slider role whose aria value names the current year', () => {
    const control = mount();

    expect(control.rail.getAttribute('role')).toBe('slider');
    expect(control.rail.getAttribute('aria-valuemin')).toBe('0');
    expect(control.rail.getAttribute('aria-valuemax')).toBe('4');
    expect(control.rail.getAttribute('aria-valuenow')).toBe('0');
    expect(control.rail.getAttribute('aria-valuetext')).toBe('1945');
    expect(control.rail.tabIndex).toBe(0);

    control.select('2025', { silent: true });

    expect(control.rail.getAttribute('aria-valuenow')).toBe('4');
    expect(control.rail.getAttribute('aria-valuetext')).toBe('2025');
  });

  it('injects its stylesheet once, with no remote asset or webfont', () => {
    mount();
    mount();

    const styles = document.querySelectorAll(
      `style[${TIMELINE_SLIDER_STYLE_ATTRIBUTE}="${TIMELINE_SLIDER_STYLE_ID}"]`,
    );
    expect(styles).toHaveLength(1);

    const css = injectedCss();
    expect(css).toContain('system-ui');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('[data-reduced-motion="true"]');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).not.toMatch(/https?:\/\//);

    // Comments aside, nothing in the stylesheet loads an asset or a webfont.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toContain('@font-face');
    expect(rules).not.toContain('url(');
    expect(rules).not.toContain('@import');

    const thumbRule = css.split('}').find((rule) => rule.includes('.cafe-timeline__thumb {'));
    expect(thumbRule).toBeDefined();
    expect(thumbRule).toContain('transition: left');
    expect(thumbRule).toContain('top: 12px');
  });

  it('owns no scene content: the era contracts and its own stylesheet are its whole world', () => {
    const specifiers = Array.from(
      sliderSource.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm),
    ).map((match) => match[1]);

    expect(specifiers).toEqual(['../../contracts/period', './timeline.css?raw']);
    expect(sliderSource).not.toMatch(/from '.*(registry|transition|audio|kernel|three)/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Selection inputs                                                           */
/* -------------------------------------------------------------------------- */

describe('selection inputs', () => {
  it('emits the matching YearId when each of the five stops is clicked', () => {
    const control = mount();
    const seen = record(control);

    for (const button of stops(control)) button.click();

    expect(seen.years).toEqual([...YEAR_IDS]);
    expect(seen.years.every(isYearId)).toBe(true);
    expect(new Set(seen.years)).toEqual(new Set(YEAR_IDS));
    expect(seen.details.map((detail) => detail.source)).toEqual([
      'click',
      'click',
      'click',
      'click',
      'click',
    ]);
    expect(seen.details.map((detail) => detail.changed)).toEqual([false, true, true, true, true]);
    expect(seen.details[1]!.previousYear).toBe('1945');
    expect(seen.details[1]!.index).toBe(1);
    expect(control.year).toBe('2025');
  });

  it('emits exactly once per pointer press on a stop', () => {
    const control = mount();
    const seen = record(control);
    const button = stops(control)[2]!;

    pointer(button, 'pointerdown', 0);
    expect(control.element.dataset['dragging']).toBe('true');
    pointer(document, 'pointerup', 0);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(seen.years).toEqual(['1985']);
    expect(control.year).toBe('1985');
    expect(control.element.dataset['dragging']).toBeUndefined();
  });

  it('drags the thumb across stops, emitting every crossed era in order', () => {
    const control = mount();
    stubRailBox(control, 100, 400);
    const seen = record(control);

    pointer(control.rail, 'pointerdown', 100); // 0% -> 1945
    pointer(document, 'pointermove', 300); // 50% -> 1985
    pointer(document, 'pointermove', 500); // 100% -> 2025
    pointer(document, 'pointerup', 500);

    expect(seen.years).toEqual(['1945', '1985', '2025']);
    expect(seen.details.every((detail) => detail.source === 'drag')).toBe(true);
    expect(control.year).toBe('2025');
    expect(control.thumb.style.left).toBe('100%');
  });

  it('resolves drag positions in a headless DOM without layout', () => {
    const control = mount();
    const seen = record(control);

    pointer(control.rail, 'pointerdown', 0); // viewport start -> 1945
    pointer(control.rail, 'pointermove', window.innerWidth); // viewport end -> 2025
    pointer(control.rail, 'pointerup', window.innerWidth);

    expect(seen.years).toEqual(['1945', '2025']);
    expect(control.year).toBe('2025');
  });

  it('follows the stop under the pointer when a drag passes over the stops', () => {
    const control = mount();
    const buttons = stops(control);
    const seen = record(control);

    pointer(buttons[0]!, 'pointerdown', 0);
    pointer(buttons[3]!, 'pointermove', 0);
    pointer(buttons[3]!, 'pointerup', 0);

    expect(seen.years).toEqual(['1945', '2005']);
    expect(control.year).toBe('2005');
  });

  it('steps through the eras with arrow keys, Home and End, clamping at both ends', () => {
    const control = mount();
    const seen = record(control);

    control.rail.focus();
    expect(document.activeElement).toBe(control.rail);

    const right = key(control.rail, 'ArrowRight');
    expect(control.year).toBe('1965');
    expect(right.defaultPrevented).toBe(true);

    key(control.rail, 'ArrowLeft');
    expect(control.year).toBe('1945');

    key(control.rail, 'ArrowLeft'); // clamped at the first era
    expect(control.year).toBe('1945');

    key(control.rail, 'End');
    expect(control.year).toBe('2025');

    key(control.rail, 'ArrowRight'); // clamped at the last era
    expect(control.year).toBe('2025');

    key(control.rail, 'Home');
    expect(control.year).toBe('1945');

    key(control.rail, 'ArrowDown');
    expect(control.year).toBe('1965');
    key(control.rail, 'ArrowUp');
    expect(control.year).toBe('1945');

    key(control.rail, 'Tab'); // not ours: the timeline stays put
    expect(control.year).toBe('1945');

    expect(seen.years).toEqual([
      '1965',
      '1945',
      '1945',
      '2025',
      '2025',
      '1945',
      '1965',
      '1945',
    ]);
    expect(seen.details.every((detail) => detail.source === 'keyboard')).toBe(true);
    expect(isYearId(seen.years.at(-1))).toBe(true);
    expect(document.activeElement).toBe(control.rail);
  });

  it('moves focus with the selection when a stop has focus', () => {
    const control = mount();
    const buttons = stops(control);

    buttons[2]!.click();
    buttons[2]!.focus();
    const seen = record(control);

    key(buttons[2]!, 'ArrowRight');

    expect(control.year).toBe('2005');
    expect(document.activeElement).toBe(buttons[3]);
    expect(buttons[3]!.getAttribute('aria-checked')).toBe('true');
    expect(buttons[2]!.getAttribute('aria-checked')).toBe('false');
    expect(seen.years).toEqual(['2005']);
  });

  it('clamps programmatic selection to the five contract eras', () => {
    const control = mount();
    control.select('2005');
    const seen = record(control);

    expect(control.selectIndex(-40)).toBe(true);
    expect(control.year).toBe('1945');
    expect(control.selectIndex(97)).toBe(true);
    expect(control.year).toBe('2025');
    expect(control.select('1975' as YearId)).toBe(false);
    expect(control.year).toBe('2025');
    expect(control.step(-1)).toBe(true);
    expect(control.year).toBe('2005');
    expect(control.step(-99)).toBe(true);
    expect(control.year).toBe('1945');
    expect(control.step(-1)).toBe(false);
    expect(control.year).toBe('1945');

    expect(seen.years).toEqual(['1945', '2025', '2005', '1945', '1945']);
    expect(seen.years.every(isYearId)).toBe(true);
    expect(seen.details.every((detail) => detail.source === 'programmatic')).toBe(true);
  });

  it('keeps the keys and pointer presses it handles away from the page beneath', () => {
    const control = mount();
    const pageKeys: string[] = [];
    const pagePointers: string[] = [];
    const onKey = (event: Event): void => {
      pageKeys.push((event as KeyboardEvent).key);
    };
    const onPointer = (): void => {
      pagePointers.push('pointerdown');
    };
    const onWheel = (): void => {
      pagePointers.push('wheel');
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('wheel', onWheel);

    try {
      control.focus();
      key(control.rail, 'ArrowRight');
      const stop = stops(control)[3]!;
      pointer(stop, 'pointerdown', 0);
      pointer(document, 'pointerup', 0);
      stop.dispatchEvent(new Event('wheel', { bubbles: true }));
    } finally {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('wheel', onWheel);
    }

    expect(pageKeys).toEqual([]);
    expect(pagePointers).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Reduced motion                                                             */
/* -------------------------------------------------------------------------- */

describe('reduced motion', () => {
  it('honours the prefers-reduced-motion media query without losing selection', () => {
    const control = mount({ matchMedia: (): MediaQueryListLike => ({ matches: true }) });
    const seen = record(control);

    expect(control.reducedMotion).toBe(true);
    expect(control.element.dataset['reducedMotion']).toBe('true');
    expect(control.thumb.style.transitionProperty).toBe('none');
    expect(control.thumb.style.transitionDuration).toBe('0s');
    expect(control.progress.style.transitionDuration).toBe('0s');

    stops(control)[4]!.click();

    expect(seen.years).toEqual(['2025']);
    expect(control.year).toBe('2025');
    expect(control.thumb.style.left).toBe('100%');
    expect(control.thumb.style.transitionDuration).toBe('0s');
  });

  it('keeps the animated thumb transition when motion is allowed', () => {
    const control = mount({ matchMedia: (): MediaQueryListLike => ({ matches: false }) });

    expect(control.reducedMotion).toBe(false);
    expect(control.element.dataset['reducedMotion']).toBe('false');
    expect(control.thumb.style.transitionProperty).toBe('');
    expect(control.thumb.style.transitionDuration).toBe('');
    expect(injectedCss()).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('follows media query changes through its live subscription', () => {
    const listeners: Array<(event: { readonly matches: boolean }) => void> = [];
    const list: MediaQueryListLike = {
      matches: false,
      addEventListener: (_type, listener) => {
        listeners.push(listener);
      },
      removeEventListener: () => {
        listeners.length = 0;
      },
    };
    const control = mount({ matchMedia: (): MediaQueryListLike => list });

    expect(control.reducedMotion).toBe(false);
    expect(listeners).toHaveLength(1);

    listeners.forEach((listener) => listener({ matches: true }));
    expect(control.reducedMotion).toBe(true);
    expect(control.thumb.style.transitionDuration).toBe('0s');

    listeners.forEach((listener) => listener({ matches: false }));
    expect(control.reducedMotion).toBe(false);
    expect(control.thumb.style.transitionDuration).toBe('');
  });

  it('lets an explicit preference win, and toggles it at runtime', () => {
    const control = mount({
      reducedMotion: true,
      matchMedia: (): MediaQueryListLike => ({ matches: false }),
    });

    expect(control.reducedMotion).toBe(true);
    expect(control.thumb.style.transitionDuration).toBe('0s');

    control.setReducedMotion(false);
    expect(control.reducedMotion).toBe(false);
    expect(control.thumb.style.transitionDuration).toBe('');

    control.setReducedMotion(true);
    expect(control.thumb.style.transitionDuration).toBe('0s');
    expect(mount({ prefersReducedMotion: () => true }).reducedMotion).toBe(true);
  });

  it('treats a host without matchMedia as motion allowed', () => {
    const control = mount();
    expect(control.reducedMotion).toBe(false);

    const disabled = mount({ matchMedia: null });
    expect(disabled.reducedMotion).toBe(false);

    const probe: NonNullable<TimelineSliderOptions['matchMedia']> = (query) =>
      window.matchMedia(query);
    expect(typeof probe).toBe('function');
  });
});

/* -------------------------------------------------------------------------- */
/* Binding and lifecycle                                                      */
/* -------------------------------------------------------------------------- */

describe('binding and lifecycle', () => {
  it('delivers the selection through every binding surface', () => {
    const received: Array<{ year: YearId; detail: TimelineYearChangeDetail }> = [];
    const control = mount({
      onChange: (year, detail) => {
        received.push({ year, detail });
      },
    });

    const elementEvents: YearId[] = [];
    const aliasEvents: YearId[] = [];
    const pageEvents: YearId[] = [];
    const onElement = (event: Event): void => {
      elementEvents.push((event as CustomEvent<TimelineYearChangeDetail>).detail.year);
    };
    const onAlias = (event: Event): void => {
      aliasEvents.push((event as CustomEvent<TimelineYearChangeDetail>).detail.year);
    };
    const onPage = (event: Event): void => {
      pageEvents.push((event as CustomEvent<TimelineYearChangeDetail>).detail.year);
    };
    control.element.addEventListener(TIMELINE_YEAR_CHANGE_EVENT, onElement);
    control.element.addEventListener(TIMELINE_CHANGE_EVENT, onAlias);
    document.addEventListener(TIMELINE_YEAR_CHANGE_EVENT, onPage);

    try {
      stops(control)[1]!.click();
    } finally {
      document.removeEventListener(TIMELINE_YEAR_CHANGE_EVENT, onPage);
    }

    expect(received.map((entry) => entry.year)).toEqual(['1965']);
    expect(isYearId(received[0]!.detail.year)).toBe(true);
    expect(received[0]!.detail).toMatchObject({
      year: '1965',
      index: 1,
      previousYear: '1945',
      changed: true,
      source: 'click',
    });
    expect(elementEvents).toEqual(['1965']);
    expect(aliasEvents).toEqual(['1965']);
    expect(pageEvents).toEqual(['1965']);
  });

  it('stops notifying listeners that unsubscribed', () => {
    const control = mount();
    let calls = 0;
    const off = control.onYearChange(() => {
      calls += 1;
    });

    stops(control)[3]!.click();
    expect(calls).toBe(1);

    off();
    stops(control)[4]!.click();
    expect(calls).toBe(1);
  });

  it('detaches on dispose and ignores further input', () => {
    const host = stage();
    const control = adopt(createTimelineSlider({ container: host }));
    const seen = record(control);

    expect(control.attached).toBe(true);
    expect(host.contains(control.element)).toBe(true);

    control.dispose();

    expect(control.disposed).toBe(true);
    expect(control.attached).toBe(false);
    expect(host.querySelector('[data-part="timeline-slider"]')).toBeNull();

    stops(control)[4]!.click();
    pointer(control.rail, 'pointerdown', 300);
    expect(control.select('2025')).toBe(false);
    expect(control.year).toBe('1945');
    expect(seen.years).toEqual([]);

    control.dispose();
    expect(control.disposed).toBe(true);
  });

  it('mounts later and describes what it holds', () => {
    const control = adopt(createTimelineSlider({ initialYear: '2005' }));

    expect(control.attached).toBe(false);
    const host = stage();
    control.mount(host);
    expect(control.attached).toBe(true);
    expect(host.contains(control.element)).toBe(true);

    expect(control.year).toBe('2005');
    expect(control.index).toBe(3);
    expect(control.label).toBe('Café era timeline');
    expect(control.captionOf('2025')).toBe(ERA_TICK_CAPTIONS['2025']);
    expect(control.stops[2]!.caption).toBe(ERA_TICK_CAPTIONS['1985']);
    expect(isTimelineSlider(control)).toBe(true);
    expect(isTimelineSlider({})).toBe(false);
    expect(isTimelineSlider(null)).toBe(false);
    expect(mount({ initialYear: '1975' as YearId }).year).toBe(DEFAULT_YEAR_ID);
    expect(mount({ captions: { '1985': 'Neon nights' } }).captionOf('1985')).toBe('Neon nights');
    expect(mount({ label: '  ' }).label).toBe('Café era timeline');
    expect(mount({ label: 'Café eras' }).label).toBe('Café eras');
    expect(mount({ className: 'custom-chrome' }).element.classList.contains('custom-chrome')).toBe(
      true,
    );
  });
});
