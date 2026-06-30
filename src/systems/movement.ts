/**
 * Movement system — pure, framework-agnostic path math.
 *
 * Defines closed-loop rectangular paths for sidewalks (pedestrians) and
 * roads (vehicles), plus helpers to compute world-space position and
 * heading from a normalised progress value. All functions are pure so they
 * can be unit-tested without a WebGL context.
 */
import type { Vector3Tuple } from 'three';

/**
 * A closed rectangular loop path centred on the origin.
 *
 * Agents travel clockwise around the perimeter. `halfWidth` and `halfDepth`
 * are the half-extents of the rectangle; `offset` shifts the path laterally
 * so multiple lanes can run parallel without overlapping.
 */
export interface LoopPath {
  /** Half-extent along the X axis. */
  readonly halfWidth: number;
  /** Half-extent along the Z axis. */
  readonly halfDepth: number;
  /** Lateral lane offset (positive = further from centre). */
  readonly offset: number;
}

/**
 * Sidewalk loop: runs along the outer edge of the block.
 * Pedestrians walk here.
 */
export const SIDEWALK_PATH: LoopPath = {
  halfWidth: 24,
  halfDepth: 24,
  offset: 0,
};

/**
 * Road loop: runs inside the sidewalk, where vehicles drive.
 */
export const ROAD_PATH: LoopPath = {
  halfWidth: 20,
  halfDepth: 20,
  offset: 0,
};

/** Total perimeter length of a rectangular loop (including offset). */
export function pathPerimeter(path: LoopPath): number {
  const w = (path.halfWidth + path.offset) * 2;
  const d = (path.halfDepth + path.offset) * 2;
  return 2 * (w + d);
}

/**
 * Compute the world-space position on a loop at normalised progress `t`
 * (0..1, wraps around). The path is traversed clockwise when viewed from
 * above (+Y).
 *
 * Segment layout (clockwise from the +X mid-edge):
 *   0.00–0.25  →  +X edge heading −Z (north side, moving east→west)
 *   0.25–0.50  →  −Z edge heading −X
 *   0.50–0.75  →  −X edge heading +Z
 *   0.75–1.00  →  +Z edge heading +X
 */
export function positionOnPath(path: LoopPath, t: number): Vector3Tuple {
  const progress = ((t % 1) + 1) % 1; // wrap to [0, 1)
  const x = path.halfWidth + path.offset;
  const z = path.halfDepth + path.offset;
  const seg = progress * 4; // 0..4 across four edges

  if (seg < 1) {
    // +X edge: from +Z to −Z
    const f = seg;
    return [x, 0, z * (1 - 2 * f)];
  }
  if (seg < 2) {
    // −Z edge: from +X to −X
    const f = seg - 1;
    return [x * (1 - 2 * f), 0, -z];
  }
  if (seg < 3) {
    // −X edge: from −Z to +Z
    const f = seg - 2;
    return [-x, 0, -z * (1 - 2 * f)];
  }
  // +Z edge: from −X to +X
  const f = seg - 3;
  return [-x * (1 - 2 * f), 0, z];
}

/**
 * Compute the heading (rotation about Y, in radians) for an agent at
 * progress `t` on the loop. The heading points along the direction of
 * travel so the model faces forward.
 */
export function headingOnPath(path: LoopPath, t: number): number {
  const progress = ((t % 1) + 1) % 1;
  const seg = progress * 4;
  void path; // heading is segment-derived; path kept for API symmetry

  if (seg < 1) return Math.PI; // moving −Z → face −Z (PI)
  if (seg < 2) return -Math.PI / 2; // moving −X
  if (seg < 3) return 0; // moving +Z → face +Z (0)
  return Math.PI / 2; // moving +X
}

/**
 * Advance a progress value by `delta` (in world units) given a speed and
 * the path perimeter. Returns the new normalised progress in [0, 1).
 */
export function advanceProgress(
  current: number,
  delta: number,
  speed: number,
  perimeter: number,
): number {
  if (perimeter <= 0) return 0;
  const distance = delta * speed;
  return (((current + distance / perimeter) % 1) + 1) % 1;
}

/**
 * Agent descriptor: a moving entity on a loop path.
 */
export interface MovementAgent {
  /** Normalised progress along the path [0, 1). */
  progress: number;
  /** Speed in world units per second. */
  speed: number;
  /** Lateral lane offset for staggering. */
  readonly laneOffset: number;
}

/**
 * Create an array of agents with evenly distributed starting progress and
 * slight random-ish lane offsets. `count` is clamped so total agents never
 * exceed `maxTotal`.
 */
export function createAgents(
  count: number,
  speedRange: readonly [number, number],
  maxTotal: number,
): MovementAgent[] {
  const n = Math.max(0, Math.min(count, maxTotal));
  const agents: MovementAgent[] = [];
  for (let i = 0; i < n; i++) {
    const progress = n > 0 ? i / n : 0;
    const [minSpeed, maxSpeed] = speedRange;
    const speed =
      minSpeed + ((maxSpeed - minSpeed) * (i + 1)) / (n + 1);
    const laneOffset = ((i % 3) - 1) * 0.6; // −0.6, 0, +0.6
    agents.push({ progress, speed, laneOffset });
  }
  return agents;
}

/**
 * Step all agents forward by `deltaSeconds`, mutating their progress in place.
 */
export function stepAgents(
  agents: MovementAgent[],
  deltaSeconds: number,
  perimeter: number,
): void {
  for (const agent of agents) {
    agent.progress = advanceProgress(
      agent.progress,
      deltaSeconds,
      agent.speed,
      perimeter,
    );
  }
}

/**
 * Build a LoopPath with a per-agent lateral offset applied.
 */
export function withLaneOffset(
  path: LoopPath,
  laneOffset: number,
): LoopPath {
  return {
    halfWidth: path.halfWidth,
    halfDepth: path.halfDepth,
    offset: path.offset + laneOffset,
  };
}
