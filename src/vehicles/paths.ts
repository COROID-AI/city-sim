/**
 * Simple looping road paths for vehicles.
 *
 * Vehicles drive around the city block on closed rectangular loops. Each loop
 * is a set of corners (in order) forming a rectangle; a vehicle's position and
 * heading at any time is derived from its phase, speed and direction along the
 * loop's arc length. Two concentric loops give opposing lanes without
 * vehicles overlapping.
 */
import * as THREE from 'three';

export interface RectLoop {
  /** Corners as [x, z] pairs in order, forming a closed loop. */
  corners: [number, number][];
  /** Height of the road surface. */
  y: number;
}

export interface LoopParams {
  phase: number;
  speed: number;
  direction: 1 | -1;
}

export const ROAD_LOOPS: RectLoop[] = [
  { corners: [[-8, 8], [8, 8], [8, -8], [-8, -8]], y: 0 },
  { corners: [[-6.4, 6.4], [6.4, 6.4], [6.4, -6.4], [-6.4, -6.4]], y: 0 },
];

function segLen(a: [number, number], b: [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function loopLength(corners: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < corners.length; i++) {
    total += segLen(corners[i], corners[(i + 1) % corners.length]);
  }
  return total;
}

/**
 * Resolve a vehicle's world position + heading for a given elapsed time.
 * `t` is the scene clock elapsed time in seconds.
 */
export function pointOnLoop(
  corners: [number, number][],
  params: LoopParams,
  t: number,
): { position: THREE.Vector3; heading: number } {
  const total = loopLength(corners);
  const phase = params.phase + params.direction * params.speed * t;
  let d = (((phase % 1) + 1) % 1) * total;

  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const len = segLen(a, b);
    if (d <= len) {
      const tt = len === 0 ? 0 : d / len;
      const x = a[0] + (b[0] - a[0]) * tt;
      const z = a[1] + (b[1] - a[1]) * tt;
      const heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
      return { position: new THREE.Vector3(x, 0, z), heading };
    }
    d -= len;
  }

  return { position: new THREE.Vector3(corners[0][0], 0, corners[0][1]), heading: 0 };
}
