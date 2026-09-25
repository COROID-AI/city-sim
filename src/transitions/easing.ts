/**
 * Easing catalogue and stage-window helpers for Chrono City era transitions.
 *
 * Every curve here is a *pure* function of normalised time `t` in `0..1` and
 * satisfies two hard properties the transition driver relies on:
 *
 * 1. **Endpoint exactness** - `f(0) === 0` and `f(1) === 1` exactly, so a stage
 *    always starts at the blend it was handed and finishes at exactly `1`.
 * 2. **Monotonicity** - `f` never decreases and never leaves `0..1`, because the
 *    era contract promises systems monotonically increasing blend values and
 *    clamped input. `spring` is therefore a *critically damped* settle with no
 *    overshoot: an overshooting spring would make blends non-monotonic.
 *
 * The four names in {@link EASINGS} mirror the era contract's `TransitionEasing`
 * union one-for-one, so `getEraConfig(era).transition.easing` can be resolved to
 * a curve without any mapping table drifting out of sync.
 *
 * Nothing here reads a clock or a random source: the same `(progress, stage)`
 * pair always produces the same blend, which is what makes transition tests
 * reproducible.
 */

import type { TransitionEasing } from "../era/eraTypes";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Curve names accepted by {@link resolveEasing}.
 *
 * Aliased to the era contract's `TransitionEasing` on purpose: the driver
 * consumes the era descriptors' easing names verbatim.
 */
export type EasingName = TransitionEasing;

/** Any curve in the catalogue: normalised time in, normalised eased time out. */
export type EasingFunction = (t: number) => number;

/** Fallback curve used when a caller passes an unknown name. */
export const DEFAULT_EASING: EasingName = "ease-in-out";

/* -------------------------------------------------------------------------- */
/* Scalars                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Clamps `value` into `[0, 1]`.
 *
 * `NaN` (a slider that has not been touched yet) resolves to `0`, `±Infinity`
 * to the nearest bound, so callers never have to guard before clamping.
 */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/** Linear interpolation from `from` to `to`; `t` is *not* clamped. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/* -------------------------------------------------------------------------- */
/* Curves                                                                     */
/* -------------------------------------------------------------------------- */

/** Constant-speed ramp: the reference every other curve is compared against. */
export const linear: EasingFunction = (t: number): number => clamp01(t);

/**
 * Cubic acceleration, no deceleration.
 *
 * Not one of the era vocabulary names, but exported because procedural props
 * (particles, camera dollies) frequently want an "ease in" for staging.
 */
export const easeIn: EasingFunction = (t: number): number => {
  const x = clamp01(t);
  return x * x * x;
};

/** Cubic deceleration: fast out of the gate, long settle into the target era. */
export const easeOut: EasingFunction = (t: number): number => {
  const x = clamp01(t);
  const inverse = 1 - x;
  return 1 - inverse * inverse * inverse;
};

/** Symmetric smoothstep (`3t² − 2t³`): the default house curve. */
export const easeInOut: EasingFunction = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/**
 * Critically damped settle (`1 − (1 − t)⁴(1 + 4t)`).
 *
 * Snappy at the start with a long, decelerating tail, but strictly monotonic
 * and bounded by `1` - an overshooting spring would hand `applyEra` blends above
 * `1`, which the contract forbids.
 */
export const spring: EasingFunction = (t: number): number => {
  const x = clamp01(t);
  const inverse = 1 - x;
  return 1 - inverse * inverse * inverse * inverse * (1 + 4 * x);
};

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                  */
/* -------------------------------------------------------------------------- */

/** Canonical order of the era vocabulary, for iteration and UI pickers. */
export const EASING_NAMES: readonly EasingName[] = Object.freeze([
  "linear",
  "ease-in-out",
  "ease-out",
  "spring",
] as const satisfies readonly EasingName[]);

/**
 * The era contract's easing vocabulary, resolved to curves.
 *
 * `Object.freeze` keeps the catalogue immutable; the exhaustive
 * `Record<EasingName, ...>` type means adding a name to `TransitionEasing`
 * without adding a curve here is a compile error.
 */
export const EASINGS: Readonly<Record<EasingName, EasingFunction>> = Object.freeze({
  linear,
  "ease-in-out": easeInOut,
  "ease-out": easeOut,
  spring,
});

/** Narrows an arbitrary value to a catalogue name. */
export function isEasingName(value: unknown): value is EasingName {
  return typeof value === "string" && EASING_NAMES.includes(value as EasingName);
}

/**
 * Normalises an arbitrary value to a catalogue name.
 *
 * Era descriptors are typed, but scene-assembly and UI themes sometimes carry
 * easing names as loose strings; unknown or missing values fall back to
 * `fallback` (or {@link DEFAULT_EASING}) instead of throwing mid-frame.
 */
export function resolveEasingName(value: unknown, fallback: EasingName = DEFAULT_EASING): EasingName {
  if (isEasingName(value)) {
    return value;
  }
  return isEasingName(fallback) ? fallback : DEFAULT_EASING;
}

/** Resolves a curve by name, with a fallback for unknown names. */
export function resolveEasing(name: unknown, fallback: EasingName = DEFAULT_EASING): EasingFunction {
  return EASINGS[resolveEasingName(name, fallback)];
}

/** Evaluates a named curve at `t`, clamping both input and output. */
export function evaluateEasing(name: unknown, t: number): number {
  return clamp01(resolveEasing(name)(t));
}

/* -------------------------------------------------------------------------- */
/* Stage windows                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Local progress of a stage window inside the whole transition.
 *
 * `start` and `end` are fractions of the transition (`0..1`); the result is the
 * clamped `0..1` position inside `[start, end]`. Overlapping windows are the
 * point: two stages can both report a value strictly between `0` and `1`, which
 * is what makes the choreography a stagger instead of one global fade.
 *
 * A degenerate window (`end <= start`) opens only when the transition reaches
 * it, so `progress >= end` reads as "already finished" and anything earlier as
 * "not started yet" - never as `NaN`.
 */
export function stageProgress(progress: number, start: number, end: number): number {
  const span = end - start;
  if (!(span > 0)) {
    return progress >= end ? 1 : 0;
  }
  return clamp01((progress - start) / span);
}

/** {@link stageProgress} followed by the stage's easing curve. */
export function easeStageProgress(
  progress: number,
  start: number,
  end: number,
  easing: EasingFunction,
): number {
  return clamp01(easing(stageProgress(progress, start, end)));
}

/**
 * True once two windows are both partway through the transition.
 *
 * Exposed for tests and debug overlays that assert a plan really staggers its
 * stages instead of running them one after another or all at once.
 */
export function stagesOverlap(
  progress: number,
  first: { readonly start: number; readonly end: number },
  second: { readonly start: number; readonly end: number },
): boolean {
  const a = stageProgress(progress, first.start, first.end);
  const b = stageProgress(progress, second.start, second.end);
  return a > 0 && a < 1 && b > 0 && b < 1;
}
