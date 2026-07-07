/**
 * BFS pathfinding over road tiles.
 *
 * `findRoadPath` returns the shortest 4-connected path (as a list of
 * grid coordinates) between two road tiles, traversing only ROAD
 * terrain.  This is the movement primitive used by vehicle and citizen
 * navigation systems.
 */

import { tileAt } from './world';
import type { Vec2, World } from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** 4-directional (Manhattan) neighbour offsets. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Find the shortest road path from `start` to `goal` using breadth-first
 * search over ROAD tiles.
 *
 * Both endpoints must lie on road tiles; if either is not a road tile,
 * `null` is returned.  When `start` and `goal` are the same coordinate,
 * a single-element path is returned.
 *
 * @param world The world grid to search.
 * @param start Starting road tile coordinate.
 * @param goal  Target road tile coordinate.
 * @returns Array of coordinates from start (inclusive) to goal (inclusive),
 *          or `null` if no road path exists.
 */
export function findRoadPath(
  world: World,
  start: Vec2,
  goal: Vec2,
): Vec2[] | null {
  // ── Validate endpoints ──────────────────────────────────────────────────
  const startTile = tileAt(world, start.x, start.y);
  const goalTile = tileAt(world, goal.x, goal.y);
  if (!startTile || startTile.terrain !== 'ROAD') return null;
  if (!goalTile || goalTile.terrain !== 'ROAD') return null;

  // ── Trivial case ────────────────────────────────────────────────────────
  if (start.x === goal.x && start.y === goal.y) {
    return [{ x: start.x, y: start.y }];
  }

  // ── BFS ─────────────────────────────────────────────────────────────────
  const width = world.width;
  const size = width * world.height;

  // Visited bitmap (0 = unvisited, 1 = visited).
  const visited = new Uint8Array(size);
  // Parent flat-index for path reconstruction (-1 = no parent / root).
  const parent = new Int32Array(size).fill(-1);

  const startFlat = start.y * width + start.x;
  visited[startFlat] = 1;

  // Queue of flat indices.
  const queue: number[] = [startFlat];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head]!;
    head++;

    const cx = current % width;
    const cy = Math.floor(current / width);

    // Goal check.
    if (cx === goal.x && cy === goal.y) {
      return reconstructPath(parent, width, startFlat, current);
    }

    // Explore 4 neighbours.
    for (const [dx, dy] of DIRECTIONS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= world.height) continue;

      const flat = ny * width + nx;
      if (visited[flat]) continue;

      const tile = world.tiles[flat];
      if (!tile || tile.terrain !== 'ROAD') continue;

      visited[flat] = 1;
      parent[flat] = current;
      queue.push(flat);
    }
  }

  // Goal unreachable.
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Walk parent pointers from the goal back to the start, then reverse to
 * produce a start→goal coordinate list.
 */
function reconstructPath(
  parent: Int32Array,
  width: number,
  startFlat: number,
  goalFlat: number,
): Vec2[] {
  const path: Vec2[] = [];
  let current: number = goalFlat;

  while (current !== -1) {
    const x = current % width;
    const y = Math.floor(current / width);
    path.push({ x, y });
    if (current === startFlat) break;
    current = parent[current]!;
  }

  path.reverse();
  return path;
}
