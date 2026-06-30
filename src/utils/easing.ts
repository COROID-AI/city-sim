/**
 * Easing functions for year-transition animations.
 *
 * These pure helpers map a linear progress value in [0, 1] to an eased
 * progress value, giving the cross-era morph a cinematic feel. They are kept
 * side-effect free so they can be unit-tested in isolation and reused by both
 * the imperative animation loop and declarative interpolators.
 */

/** Clamp a number into the inclusive [0, 1] range. */
export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Smoothstep easing — slow-in/slow-out S-curve.
 *
 * `3t² - 2t³` produces zero velocity at both endpoints, ideal for a morph
 * that settles gently into the target era.
 */
export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/**
 * Smootherstep — Ken Perlin's `6t⁵ - 15t⁴ + 10t³`.
 *
 * Zero first *and* second derivatives at the endpoints; even softer than
 * smoothstep. Used for the primary building morph so height changes never pop.
 */
export function smootherstep(t: number): number {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * Cubic ease-in-out. Accelerates from rest, peaks at the midpoint, then
 * decelerates back to rest.
 */
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * Linear interpolation between two numbers. `t` is clamped to [0, 1].
 *
 * Kept here so animation consumers can import both easing and lerp from a
 * single module.
 */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}
