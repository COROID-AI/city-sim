/**
 * Composition suite: the timeline slider bound the way the application will
 * bind it.
 *
 * `app-composition` owns the wiring this file reproduces end to end in the
 * headless DOM:
 *
 *   stage (`#app`)  +  timeline slider  →  `year-change`  →  period lookup
 *
 * The consumer here is contract-typed: it receives the shared `YearId`, indexes
 * a `Record<YearId, PeriodDefinition>` map with it (what the period registry
 * will do) and hands the definition to a stand-in for the era transition. No
 * translation step exists in between, and the slider never learns about the
 * registry, the transition engine or the scene — it only reports a year.
 *
 * The era definitions are fixtures; the production values belong to
 * `period-registry`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  YEAR_IDS,
  isPeriodDefinition,
  isYearId,
  type PeriodDefinition,
  type PeriodLighting,
  type PeriodPalette,
  type YearId,
} from '../../contracts/period';
import sliderSource from './TimelineSlider.ts?raw';
import {
  TIMELINE_YEAR_CHANGE_EVENT,
  createTimelineSlider,
  isTimelineSlider,
  type TimelineSlider,
  type TimelineYearChangeDetail,
} from './TimelineSlider';

/* -------------------------------------------------------------------------- */
/* Fixtures: the period registry and the era transition it feeds              */
/* -------------------------------------------------------------------------- */

const PALETTE: PeriodPalette = Object.freeze({
  background: '#16110d',
  floor: '#4b3524',
  wall: '#8d7457',
  ceiling: '#d9cbb4',
  accent: '#c96a3a',
  lamp: '#ffd9a0',
});

const LIGHTING: PeriodLighting = Object.freeze({
  ambientColor: '#f2e2c8',
  ambientIntensity: 0.35,
  keyColor: '#ffe3b0',
  keyIntensity: 1.1,
  fillColor: '#7d92b5',
  fillIntensity: 0.3,
  lampColor: '#ffcf8a',
  lampIntensity: 0.9,
  fogDensity: 0.02,
});

const ERA_NAMES: Readonly<Record<YearId, string>> = Object.freeze({
  '1945': 'Post-war austerity',
  '1965': 'Mid-century boom',
  '1985': 'Late century',
  '2005': 'New millennium',
  '2025': 'Present day',
});

function periodFixture(year: YearId): PeriodDefinition {
  return Object.freeze({
    year,
    label: year,
    name: ERA_NAMES[year],
    summary: `The café as it stood in ${year}.`,
    palette: PALETTE,
    lighting: LIGHTING,
    details: Object.freeze([`era-${year}`]),
  });
}

/** Stand-in for the period registry: one definition per contract era. */
const PERIODS: Record<YearId, PeriodDefinition> = Object.fromEntries(
  YEAR_IDS.map((year) => [year, periodFixture(year)]),
) as Record<YearId, PeriodDefinition>;

/** The registry lookup the composition root performs: `PERIODS[year]`, no translation. */
function lookupPeriod(year: YearId): PeriodDefinition {
  const period = PERIODS[year];
  if (!period) throw new RangeError(`No period registered for era ${String(year)}.`);
  return period;
}

/** Stand-in for the era transition engine the composition root drives. */
class TransitionStub {
  private readonly history: YearId[] = [];
  private readonly definitions: PeriodDefinition[] = [];

  /** Applies the era the slider named — the application's whole reaction. */
  apply(year: YearId): PeriodDefinition {
    const period = lookupPeriod(year);
    this.history.push(period.year);
    this.definitions.push(period);
    return period;
  }

  get applied(): readonly YearId[] {
    return this.history;
  }

  get periods(): readonly PeriodDefinition[] {
    return this.definitions;
  }
}

/* -------------------------------------------------------------------------- */
/* Harness: the stage the composition root mounts                            */
/* -------------------------------------------------------------------------- */

const openSliders: TimelineSlider[] = [];
const openStages: HTMLElement[] = [];

function stage(): HTMLElement {
  const element = document.createElement('div');
  element.id = 'app';
  element.setAttribute('role', 'img');
  const canvas = document.createElement('canvas');
  element.append(canvas);
  document.body.append(element);
  openStages.push(element);
  return element;
}

function mountSlider(target: HTMLElement): TimelineSlider {
  const control = createTimelineSlider({ container: target });
  openSliders.push(control);
  return control;
}

afterEach(() => {
  for (const control of openSliders.splice(0)) control.dispose();
  for (const element of openStages.splice(0)) element.remove();
  document.body.replaceChildren();
});

const stops = (control: TimelineSlider): HTMLButtonElement[] =>
  Array.from(control.element.querySelectorAll<HTMLButtonElement>('[data-part="stop"]'));

function pointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY: 12,
      pointerId: 7,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
    }),
  );
}

function key(target: EventTarget, name: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

describe('timeline slider composition', () => {
  it('delivers all five contract YearIds to a registry consumer, with no extras', () => {
    const target = stage();
    const control = mountSlider(target);
    const transition = new TransitionStub();
    const received: YearId[] = [];
    const details: TimelineYearChangeDetail[] = [];

    control.onYearChange((year, detail) => {
      received.push(year);
      details.push(detail);
      transition.apply(year);
    });

    for (const stop of stops(control)) stop.click();

    expect(received).toEqual([...YEAR_IDS]);
    expect(new Set(received)).toEqual(new Set(YEAR_IDS));
    expect(received.every(isYearId)).toBe(true);
    expect(details).toHaveLength(YEAR_IDS.length);

    // Each value indexes the PeriodDefinition map as-is: registry key identity.
    YEAR_IDS.forEach((year, index) => {
      expect(received[index]).toBe(year);
      expect(lookupPeriod(received[index]!)).toBe(PERIODS[year]);
      expect(lookupPeriod(received[index]!).year).toBe(year);
      expect(details[index]!.year).toBe(year);
    });

    expect(transition.applied).toEqual([...YEAR_IDS]);
    expect(transition.periods.every(isPeriodDefinition)).toBe(true);
    expect(control.year).toBe('2025');
  });

  it('selects through drag and keyboard as well, always as a registry key', () => {
    const control = mountSlider(stage());
    const transition = new TransitionStub();
    control.onYearChange((year) => {
      transition.apply(year);
    });

    // Drag across the rail: the release settles on 2025.
    pointer(control.rail, 'pointerdown', 0);
    pointer(control.rail, 'pointermove', window.innerWidth);
    pointer(control.rail, 'pointerup', window.innerWidth);
    expect(transition.applied).toEqual(['1945', '2025']);

    // Keyboard: End and Home walk the same map.
    control.rail.focus();
    key(control.rail, 'End');
    key(control.rail, 'Home');
    expect(transition.applied).toEqual(['1945', '2025', '2025', '1945']);

    expect(transition.periods.map((period) => period.label)).toEqual([
      '1945',
      '2025',
      '2025',
      '1945',
    ]);
  });

  it('binds the bubbling change event the way the composition root will', () => {
    const target = stage();
    const control = mountSlider(target);
    const directTransition = new TransitionStub();
    const pageTransition = new TransitionStub();
    const seenFromPage: YearId[] = [];

    // The composition root binds once, at the document level, and reads the type
    // straight out of the event detail.
    const onPage = (event: Event): void => {
      const detail = (event as CustomEvent<TimelineYearChangeDetail>).detail;
      if (!isYearId(detail.year)) throw new TypeError('timeline emitted a non-contract year');
      seenFromPage.push(detail.year);
      pageTransition.apply(detail.year);
    };
    document.addEventListener(TIMELINE_YEAR_CHANGE_EVENT, onPage);
    control.onYearChange((year) => {
      directTransition.apply(year);
    });

    try {
      stops(control)[1]!.click();
      key(control.rail, 'ArrowRight');
    } finally {
      document.removeEventListener(TIMELINE_YEAR_CHANGE_EVENT, onPage);
    }

    expect(seenFromPage).toEqual(['1965', '1985']);
    expect(directTransition.applied).toEqual(['1965', '1985']);
    expect(pageTransition.applied).toEqual(['1965', '1985']);
    expect(pageTransition.periods.every((period) => period.year === period.label)).toBe(true);
  });

  it('hands the selected era to a typed consumer without translation', () => {
    const control = mountSlider(stage());
    let current: PeriodDefinition = lookupPeriod('1945');

    const consume = (year: YearId): PeriodDefinition => {
      current = lookupPeriod(year);
      return current;
    };
    control.onYearChange(consume);

    expect(isTimelineSlider(control)).toBe(true);

    for (const stop of stops(control)) {
      stop.click();
      // The compile-time proof: the emitted value is the lookup key itself.
      const key: YearId = control.year;
      const period: PeriodDefinition = PERIODS[key];
      expect(period).toBe(current);
      expect(period.year).toBe(stop.dataset['year']);
      expect(period.details).toContain(`era-${key}`);
    }

    expect(current.name).toBe(ERA_NAMES['2025']);
    expect(current.year).toBe('2025');
  });

  it('detaches on dispose and stops delivering selections', () => {
    const target = stage();
    const control = mountSlider(target);
    const transition = new TransitionStub();
    control.onYearChange((year) => {
      transition.apply(year);
    });

    stops(control)[2]!.click();
    expect(transition.applied).toEqual(['1985']);

    control.dispose();

    expect(target.querySelector('[data-part="timeline-slider"]')).toBeNull();
    expect(control.attached).toBe(false);
    stops(control)[4]!.click();
    pointer(control.rail, 'pointerdown', window.innerWidth);
    expect(transition.applied).toEqual(['1985']);
  });

  it('adds no scene content: only the era contracts cross the module boundary', () => {
    const target = stage();
    const control = mountSlider(target);

    expect(target.querySelectorAll('canvas')).toHaveLength(1);
    expect(target.children).toHaveLength(2);
    expect(control.element.querySelectorAll('canvas, img, video, iframe')).toHaveLength(0);
    expect(control.element.textContent).toContain('1945');

    const specifiers = Array.from(
      sliderSource.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm),
    ).map((match) => match[1]);
    expect(specifiers).toEqual(['../../contracts/period', './timeline.css?raw']);

    // Ignoring prose, the module never names another system of the application.
    const code = sliderSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/registry|period-transition|AudioEngine|SceneModule|three/i);
  });
});
