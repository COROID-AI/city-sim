/**
 * Sidewalk looping paths for the pedestrians module.
 *
 * Each path is a closed loop (a rectangle around the city block on the
 * sidewalk). Pedestrians advance along a loop cyclically, giving a simple
 * looping walk with no need for pathfinding.
 */

export interface LoopPoint {
  x: number;
  z: number;
}

interface LoopSegment {
  a: LoopPoint;
  b: LoopPoint;
  len: number;
  start: number;
}

export interface LoopData {
  segs: LoopSegment[];
  total: number;
}

/** Sidewalk radius around the 12x12 block footprint. */
const OUTER = 7.0;
const MID = 6.5;

/** The loops pedestrians travel along (closed rectangles). */
const RAW_LOOPS: Array<Array<[number, number]>> = [
  [
    [-OUTER, -OUTER],
    [OUTER, -OUTER],
    [OUTER, OUTER],
    [-OUTER, OUTER],
  ],
  [
    [-MID, -MID],
    [MID, -MID],
    [MID, MID],
    [-MID, MID],
  ],
  [
    [-OUTER, -MID],
    [OUTER, MID],
    [MID, OUTER],
    [-MID, OUTER],
    [-OUTER, MID],
    [-OUTER, -MID],
  ],
];

function buildLoop(points: Array<[number, number]>): LoopData {
  const segs: LoopSegment[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = { x: points[i][0], z: points[i][1] };
    const b = {
      x: points[(i + 1) % points.length][0],
      z: points[(i + 1) % points.length][1],
    };
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    segs.push({ a, b, len, start: total });
    total += len;
  }
  return { segs, total };
}

/** Precomputed loop data, indexed by path index. */
export const LOOP_DATA: LoopData[] = RAW_LOOPS.map(buildLoop);

export interface SampledLoop {
  x: number;
  z: number;
  /** Tangent direction of travel (unit vector). */
  tx: number;
  tz: number;
}

/**
 * Sample a closed loop at parameter u in [0, 1). Returns the position and
 * the tangent direction of the segment being traversed.
 */
export function sampleLoop(data: LoopData, u: number): SampledLoop {
  let d = (((u % 1) + 1) % 1) * data.total;
  for (const s of data.segs) {
    if (d <= s.len) {
      const f = s.len === 0 ? 0 : d / s.len;
      const tx = s.b.x - s.a.x;
      const tz = s.b.z - s.a.z;
      return {
        x: s.a.x + (s.b.x - s.a.x) * f,
        z: s.a.z + (s.b.z - s.a.z) * f,
        tx,
        tz,
      };
    }
    d -= s.len;
  }
  const s = data.segs[0];
  return { x: s.a.x, z: s.a.z, tx: s.b.x - s.a.x, tz: s.b.z - s.a.z };
}
