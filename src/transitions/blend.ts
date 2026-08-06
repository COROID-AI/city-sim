import * as THREE from 'three';

/**
 * Interpolation helpers used by the era-transition orchestration.
 *
 * Everything here is a pure function so the blended configs can be computed
 * straight in render (re-rendered each frame while a morph runs) without
 * mutating shared config objects.
 */

/** Linear interpolation between two numbers. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Interpolate two hex color strings and return the blended hex string. */
export function lerpColor(from: string, to: string, t: number): string {
  const a = new THREE.Color(from);
  const b = new THREE.Color(to);
  return `#${a.lerp(b, t).getHexString()}`;
}

/** Interpolate two 3-component vectors component-wise. */
export function lerpVector3(
  from: [number, number, number],
  to: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)];
}
