import { describe, expect, it } from 'vitest';
import {
  MAX_INDEX,
  MIN_INDEX,
  STOP_YEARS,
  clampIndex,
  dragPreview,
  fractionToIndex,
  indexOfYear,
  indexOfYearFractional,
  indexToFraction,
  isStopYear,
  keyboardIndex,
  sliderAria,
  snapIndex,
  snapYear,
  stopOffset,
  yearAtIndex,
} from '../src/ui/timelineModel';

describe('timeline model', () => {
  it('exposes exactly the five stops in order', () => {
    expect(STOP_YEARS).toEqual([1945, 1965, 1985, 2005, 2025]);
    expect(MIN_INDEX).toBe(0);
    expect(MAX_INDEX).toBe(4);
  });

  it('maps every stop index to its year and back', () => {
    STOP_YEARS.forEach((year, index) => {
      expect(yearAtIndex(index)).toBe(year);
      expect(indexOfYear(year)).toBe(index);
      expect(snapYear(index)).toBe(year);
      expect(snapIndex(index)).toBe(index);
      expect(isStopYear(year)).toBe(true);
      expect(indexOfYearFractional(year)).toBeCloseTo(index, 6);
    });
    expect(isStopYear(1955)).toBe(false);
  });

  it('maps slider fractions across the full range', () => {
    expect(indexToFraction(0)).toBeCloseTo(0, 6);
    expect(indexToFraction(4)).toBeCloseTo(1, 6);
    expect(indexToFraction(2)).toBeCloseTo(0.5, 6);
    expect(fractionToIndex(0)).toBeCloseTo(0, 6);
    expect(fractionToIndex(1)).toBeCloseTo(4, 6);
    expect(fractionToIndex(0.5)).toBeCloseTo(2, 6);
    // Out-of-range and non-finite input is clamped, never NaN.
    expect(indexToFraction(-3)).toBe(0);
    expect(indexToFraction(99)).toBe(1);
    expect(fractionToIndex(-1)).toBe(0);
    expect(fractionToIndex(4)).toBe(4);
    expect(clampIndex(Number.NaN)).toBe(0);
    expect(stopOffset(2)).toBeCloseTo(0.5, 6);
  });

  it('interpolates years between stops for the drag preview', () => {
    expect(indexOfYearFractional(1955)).toBeCloseTo(0.5, 6);
    expect(indexOfYearFractional(1975)).toBeCloseTo(1.5, 6);
    expect(indexOfYearFractional(1970)).toBeCloseTo(1.25, 6);
    expect(indexOfYearFractional(1900)).toBeCloseTo(0, 6);
    expect(indexOfYearFractional(2100)).toBeCloseTo(4, 6);
    expect(indexOfYearFractional(2015)).toBeCloseTo(3.5, 6);
  });

  it('snaps to the nearest stop', () => {
    expect(snapIndex(0.49)).toBe(0);
    expect(snapIndex(0.51)).toBe(1);
    expect(snapIndex(1.5)).toBe(2);
    expect(snapIndex(3.49)).toBe(3);
    expect(snapIndex(3.9)).toBe(4);
    expect(snapYear(2.4)).toBe(1985);
    expect(snapYear(2.6)).toBe(2005);
  });

  it('reports the neighbour pair and weights that sum to one while dragging', () => {
    for (let index = 0; index <= 4; index += 0.1) {
      const preview = dragPreview(index);
      expect(preview.weight).toBeGreaterThanOrEqual(0);
      expect(preview.weight).toBeLessThanOrEqual(1);
      expect(1 - preview.weight + preview.weight).toBeCloseTo(1, 10);
      expect(STOP_YEARS).toContain(preview.from);
      expect(STOP_YEARS).toContain(preview.to);
      expect(preview.fromIndex).toBe(STOP_YEARS.indexOf(preview.from));
      if (preview.from !== preview.to) {
        expect(STOP_YEARS.indexOf(preview.to)).toBe(preview.fromIndex + 1);
      }
    }
    const mid = dragPreview(1.5);
    expect(mid.from).toBe(1965);
    expect(mid.to).toBe(1985);
    expect(mid.weight).toBeCloseTo(0.5, 6);

    const exact = dragPreview(2);
    expect(exact.from).toBe(1985);
    expect(exact.weight).toBeCloseTo(0, 6);
    expect(exact.to).toBe(2005);

    const clamped = dragPreview(9);
    expect(clamped.to).toBe(2025);
    expect(clamped.weight).toBeCloseTo(0, 6);
  });

  it('steps through the stops with the keyboard and clamps Home/End', () => {
    expect(keyboardIndex(0, 'ArrowRight')).toBe(1);
    expect(keyboardIndex(1, 'ArrowRight')).toBe(2);
    expect(keyboardIndex(2, 'ArrowLeft')).toBe(1);
    expect(keyboardIndex(0, 'ArrowLeft')).toBe(0);
    expect(keyboardIndex(4, 'ArrowRight')).toBe(4);
    expect(keyboardIndex(3, 'Home')).toBe(0);
    expect(keyboardIndex(1, 'End')).toBe(4);
    expect(keyboardIndex(2, 'ArrowUp')).toBe(3);
    expect(keyboardIndex(2, 'ArrowDown')).toBe(1);

    // A full keyboard walk visits all five stops in order.
    let index = 0;
    const visited = [yearAtIndex(index)];
    for (let i = 0; i < 4; i += 1) {
      index = keyboardIndex(index, 'ArrowRight');
      visited.push(yearAtIndex(index));
    }
    expect(visited).toEqual([...STOP_YEARS]);
  });

  it('exposes correct ARIA slider semantics', () => {
    const aria = sliderAria(2);
    expect(aria.role).toBe('slider');
    expect(aria.min).toBe(0);
    expect(aria.max).toBe(4);
    expect(aria.now).toBe(2);
    expect(aria.orientation).toBe('horizontal');
    expect(aria.valuetext).toContain('1985');
    expect(aria.valuetext).toContain('3 of 5');

    const first = sliderAria(0);
    expect(first.valuetext).toContain('1945');
    expect(first.valuetext).toContain('1 of 5');

    // A fractional drag position reports the snapped stop.
    expect(sliderAria(2.6).now).toBe(3);
    expect(sliderAria(-5).now).toBe(0);
    expect(sliderAria(99).now).toBe(4);
  });
});
