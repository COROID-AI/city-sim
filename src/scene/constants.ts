/**
 * Shared geometric constants for the city block layout.
 *
 * Layout: a 4-quadrant block centered on the origin. Two roads cross at the
 * center (one along X, one along Z). Each quadrant is a sidewalk slab holding
 * buildings, lamps, trees, and street furniture. Roads extend well past the
 * block so vehicles loop naturally.
 */

/** Half-extent of the full asphalt ground plane. */
export const GROUND_HALF = 30;

/** Half-width of each crossing road. */
export const ROAD_HALF_W = 3.6;
export const ROAD_WIDTH = ROAD_HALF_W * 2;

/** Cut lines: roads occupy |x| <= ROAD_HALF_W and |z| <= ROAD_HALF_W. */
export const ROAD_CUT = ROAD_HALF_W;

/** Center of each driving lane, offset from the road centerline. */
export const LANE_OFFSET = ROAD_HALF_W * 0.55;

/** Half-extent of the central sidewalk blocs. */
export const BLOCK_HALF = 12.5;
export const BLOCK_MIN = ROAD_HALF_W + 0.55;
export const BLOCK_MAX = BLOCK_HALF;

/** Building placement zone inside each quadrant. */
export const BUILD_MIN = ROAD_CUT + 1.25;
export const BUILD_MAX = BLOCK_HALF - 0.7;

/** Pedestrian walkway lanes (world positions) around blocs. */
export const WALK_LINE_A = BUILD_MIN - 0.55;
export const WALK_LINE_B = BUILD_MAX + 0.55;

/** Numbers of moving pieces. */
export const VEHICLE_COUNT = 14;
export const PEDESTRIAN_COUNT = 48;
export const TREE_SLOTS = 22;
export const LAMP_SLOTS = 26;
export const BILLBOARD_SLOTS = 12;

/** Small deterministic PRNG (mulberry32) for layout data. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Resolve (x, z) inside a quadrant with sign multipliers. */
export function quadrantPoint(
  qx: number,
  qz: number,
  min: number,
  max: number,
  rand: () => number,
): [number, number] {
  return [
    qx * (min + rand() * (max - min)),
    qz * (min + rand() * (max - min)),
  ];
}