/**
 * Route selection for vehicles.
 *
 * Every route is a path between two "road anchors" (road tiles sampled from
 * the shared road grid) computed with the citizens' BFS/A* pathfinder
 * (src/citizens/pathfinding.js), so road connectivity has exactly one source
 * of truth. Routes are cached per (start, goal) anchor pair and recycled when
 * a vehicle arrives, which keeps vehicles on continuous routes without
 * re-running the search every frame and prevents idle-at-spawn vehicles.
 */

import { findPath } from '../citizens/pathfinding.js';
import { RNG } from '../core/rng.js';

const MAX_CACHE_ENTRIES = 512;

/**
 * Create the shared route cache for a world.
 * @param {object} world City/world state ({ roads, gridSize }).
 * @returns {{ get: Function, size: Function, clear: Function }}
 */
export function createRouteCache(world) {
  const cache = new Map();

  return {
    /** True when the (start, goal) pair already has a cached route. */
    has(start, goal) {
      return cache.has(`${start.x},${start.y}->${goal.x},${goal.y}`);
    },
    /** Look up a cached tile path or compute + cache it via findPath. */
    get(start, goal) {
      const key = `${start.x},${start.y}->${goal.x},${goal.y}`;
      if (cache.has(key)) return cache.get(key);
      const tiles = findPath(world, start, goal);
      if (!tiles || tiles.length < 2) return null;
      if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
      cache.set(key, tiles);
      return tiles;
    },
    /** Number of cached routes (for diagnostics). */
    size() {
      return cache.size;
    },
    /** Drop all cached routes (e.g. after a world rebuild). */
    clear() {
      cache.clear();
    },
  };
}

/**
 * Pick a deterministic random road anchor from the shared road grid.
 * @param {object} world World state ({ roads, gridSize }).
 * @param {RNG} rng Seeded RNG for reproducibility.
 * @returns {{x:number, y:number}} Tile coords of a road tile, or null.
 */
export function randomRoadAnchor(world, rng) {
  if (!world.roads || !world.roads.length) return null;
  const r = rng.pick(world.roads);
  return { x: r.x, y: r.y };
}

/**
 * Random route between two distinct road anchors, cached and recycled.
 *
 * When the anchor pair was seen before the cached tile path is returned
 * wholesale; otherwise the path is computed with the shared road-grid BFS and
 * stored. A "recycled" route is the same cached path object, so vehicles that
 * keep re-drawing it stay in continuous motion deterministically.
 * @param {object} world World with { roads, gridSize }.
 * @param {RNG} rng Deterministic RNG.
 * @param {object} routeCache Cache created with createRouteCache(world).
 * @param {{x:number,y:number}} [anchorA] Fixed start (optional; random when omitted).
 * @param {{x:number,y:number}} [anchorB] Fixed goal.
 * @returns {{tiles: Array<{x:number,y:number}>, start: {x:number,y:number},
 *            goal: {x:number,y:number}, recycled: boolean}}
 */
export function selectRoute(world, rng, routeCache, anchorA, anchorB) {
  const a = anchorA || randomRoadAnchor(world, rng);
  const b = anchorB || randomRoadAnchor(world, rng);
  if (!a || !b) return null;
  if (a.x === b.x && a.y === b.y) {
    // Same tile: ask for a different goal once before falling back to the
    // original anchor (still uses the cache when the pair repeats).
    const alt = randomRoadAnchor(world, rng);
    if (alt && (alt.x !== a.x || alt.y !== a.y)) {
      const tiles = routeCache.get(a, alt);
      if (tiles) {
        return {
          tiles,
          points: routePoints(tiles),
          start: a,
          goal: alt,
          recycled: routeCache.has(a, alt),
        };
      }
    }
  }
  const wasCached = routeCache.has(a, b);
  const tiles = routeCache.get(a, b);
  if (!tiles) return null;
  return {
    tiles,
    points: routePoints(tiles),
    start: a,
    goal: b,
    recycled: wasCached,
  };
}

/**
 * Convert a tile path into smooth world-space waypoints (tile centers).
 * The cache stores the raw tile array; each route uses the same point array
 * so all vehicles share one representation.
 * @param {Array<{x:number,y:number}>} tiles Tile path (inclusive of both ends).
 * @returns {Array<{x:number,y:number}>} Waypoints in pixel coordinates.
 */
function routePoints(tiles) {
  if (!Array.isArray(tiles)) return [];
  // Point tile centers from the tile path; first point is the start tile.
  const pts = tiles.map((t) => ({ x: t.x + 0.5, y: t.y + 0.5 }));
  // Remove consecutive duplicate waypoints (pathfinder may repeat first tile).
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  if (out.length < 2) return [];
  return out;
}