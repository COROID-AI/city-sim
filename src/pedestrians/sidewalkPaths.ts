/**
 * Sidewalk path definitions for the pedestrians layer.
 *
 * Pedestrians walk on simple closed (looping) rectangular sidewalk rings
 * around the 10x10 city block (which spans x/z in [-5, 5]). The rings sit
 * between the block edge and the roads, keeping every figure on the sidewalk.
 * A normalized parameter t in [0,1) samples a position and heading along the
 * loop, so pedestrians loop seamlessly forever.
 */

export interface SidewalkLoop {
  /** Corner points [x, z] in order; the loop is implicitly closed. */
  points: [number, number][];
  /** Per-segment lengths. */
  lengths: number[];
  /** Total perimeter length. */
  total: number;
}

function buildLoop(points: [number, number][]): SidewalkLoop {
  const n = points.length;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    lengths.push(len);
    total += len;
  }
  return { points, lengths, total };
}

/** Three sidewalk rings between the block edge and the outer road. */
export const SIDEWALK_LOOPS: SidewalkLoop[] = [
  buildLoop([
    [-5.5, -5.5],
    [5.5, -5.5],
    [5.5, 5.5],
    [-5.5, 5.5],
  ]),
  buildLoop([
    [-7.5, -7.5],
    [7.5, -7.5],
    [7.5, 7.5],
    [-7.5, 7.5],
  ]),
  buildLoop([
    [-9.5, -9.5],
    [9.5, -9.5],
    [9.5, 9.5],
    [-9.5, 9.5],
  ]),
];

export interface SidewalkSample {
  x: number;
  y: number;
  z: number;
  /** Yaw about the Y axis; forward is +Z (heading 0). */
  heading: number;
}

/** Sample a position + heading at normalized distance t in [0,1). */
export function sampleSidewalk(loop: SidewalkLoop, t: number): SidewalkSample {
  const tt = ((t % 1) + 1) % 1;
  let target = tt * loop.total;
  const n = loop.points.length;
  for (let i = 0; i < n; i++) {
    const seg = loop.lengths[i];
    if (target <= seg || i === n - 1) {
      const a = loop.points[i];
      const b = loop.points[(i + 1) % n];
      const f = seg === 0 ? 0 : target / seg;
      const x = a[0] + (b[0] - a[0]) * f;
      const z = a[1] + (b[1] - a[1]) * f;
      const heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
      return { x, y: 0, z, heading };
    }
    target -= seg;
  }
  return { x: 0, y: 0, z: 0, heading: 0 };
}