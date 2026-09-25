/**
 * Slider maths for the era timeline - pure, dependency-free and headless.
 *
 * The timeline has five discrete stops (1945, 1965, 1985, 2005, 2025). While
 * the user drags the handle the slider reports a *fractional* position so the
 * scene can blend the two neighbouring eras continuously; on release the value
 * snaps to the nearest stop.
 */

import { YEARS, type Year } from '../config/types';

export const STOP_YEARS: readonly Year[] = YEARS;

/** Fractional index range of the slider: 0 .. 4. */
export const MIN_INDEX = 0;
export const MAX_INDEX = STOP_YEARS.length - 1;

export interface DragPreview {
  /** Lower (older) era of the pair being blended. */
  from: Year;
  /** Upper (newer) era of the pair being blended. */
  to: Year;
  /** Index of `from` in {@link STOP_YEARS}. */
  fromIndex: number;
  /** Weight of `to`, 0..1. `1 - weight` belongs to `from`. */
  weight: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Clamp an arbitrary fractional index into the valid slider range. */
export function clampIndex(index: number): number {
  if (!Number.isFinite(index)) return MIN_INDEX;
  return clamp(index, MIN_INDEX, MAX_INDEX);
}

/** Fractional index 0..4 → fractional slider fraction 0..1. */
export function indexToFraction(index: number): number {
  return clampIndex(index) / MAX_INDEX;
}

/** Slider fraction 0..1 → fractional index 0..4. */
export function fractionToIndex(fraction: number): number {
  if (!Number.isFinite(fraction)) return MIN_INDEX;
  return clampIndex(clamp(fraction, 0, 1) * MAX_INDEX);
}

/** Year at a discrete stop index (clamped/rounded). */
export function yearAtIndex(index: number): Year {
  return STOP_YEARS[Math.round(clampIndex(index))];
}

/** Stop index of a year (falls back to the nearest stop for unknown years). */
export function indexOfYear(year: number): number {
  const exact = STOP_YEARS.indexOf(year as Year);
  if (exact >= 0) return exact;
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  STOP_YEARS.forEach((stop, i) => {
    const delta = Math.abs(stop - year);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  });
  return best;
}

/** Fractional index of a year, e.g. 1985 → 2, 1955 → 0.5. */
export function indexOfYearFractional(year: number): number {
  if (STOP_YEARS.includes(year as Year)) return indexOfYear(year);
  const clampedYear = clamp(year, STOP_YEARS[0], STOP_YEARS[STOP_YEARS.length - 1]);
  for (let i = 0; i < STOP_YEARS.length - 1; i += 1) {
    const a = STOP_YEARS[i];
    const b = STOP_YEARS[i + 1];
    if (clampedYear >= a && clampedYear <= b) {
      return i + (clampedYear - a) / (b - a);
    }
  }
  return MAX_INDEX;
}

/** Nearest discrete stop to a fractional index. */
export function snapIndex(index: number): number {
  return Math.round(clampIndex(index));
}

/** Nearest stop year to a fractional index. */
export function snapYear(index: number): Year {
  return yearAtIndex(snapIndex(index));
}

/** A year is playable if it is one of the five stops. */
export function isStopYear(year: number): year is Year {
  return STOP_YEARS.includes(year as Year);
}

/**
 * Which two eras are blended at a fractional index, and with what weight.
 * At an exact stop the weight is 1 for that stop (no neighbour).
 */
export function dragPreview(index: number): DragPreview {
  const clamped = clampIndex(index);
  const lower = Math.floor(clamped);
  const upper = Math.min(lower + 1, MAX_INDEX);
  const weight = clamped - lower;
  return {
    from: STOP_YEARS[lower],
    to: STOP_YEARS[upper],
    fromIndex: lower,
    weight,
  };
}

/** Step the slider with an arrow key. Returns the new stop index. */
export function stepIndex(index: number, direction: 'left' | 'right'): number {
  const delta = direction === 'left' ? -1 : 1;
  return clamp(Math.round(clampIndex(index)) + delta, MIN_INDEX, MAX_INDEX);
}

/** Keyboard handling for the slider: Home/End/Arrows. */
export function keyboardIndex(
  index: number,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown',
): number {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return stepIndex(index, 'left');
    case 'ArrowRight':
    case 'ArrowUp':
      return stepIndex(index, 'right');
    case 'Home':
    case 'PageDown':
      return MIN_INDEX;
    case 'End':
    case 'PageUp':
      return MAX_INDEX;
    default:
      return clamp(Math.round(clampIndex(index)), MIN_INDEX, MAX_INDEX);
  }
}

/** CSS left offset (0..1) for a stop index, inset so the handle stays visible. */
export function stopOffset(index: number): number {
  return indexToFraction(index);
}

export interface SliderAria {
  role: 'slider';
  min: number;
  max: number;
  now: number;
  valuetext: string;
  orientation: 'horizontal';
}

/** ARIA semantics for the slider element at a (snapped) index. */
export function sliderAria(index: number): SliderAria {
  const snapped = clamp(Math.round(clampIndex(index)), MIN_INDEX, MAX_INDEX);
  const year = STOP_YEARS[snapped];
  return {
    role: 'slider',
    min: MIN_INDEX,
    max: MAX_INDEX,
    now: snapped,
    valuetext: `${year} — stop ${snapped + 1} of ${STOP_YEARS.length}`,
    orientation: 'horizontal',
  };
}
