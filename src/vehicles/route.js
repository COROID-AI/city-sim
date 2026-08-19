/**
 * Road-graph routing for vehicles.
 *
 * Vehicles drive along the same road lattice citizens walk. Routes are built
 * with the shared A* pathfinder, then vehicles follow lane-offset waypoints
 * (right-hand traffic) and apply a basic right-of-way rule at intersections:
 * a vehicle waits for any other vehicle already occupying the intersection
 * tile before entering. Movement never mutates road/world structures.
 */

import { findPath } from '../citizens/pathfinding.js';

/**
 * Build a road-following route between two tiles (building doors or road
 * tiles). Returns an array of {x,y} waypoints (start + road tiles + goal).
 * @param {object} city  CityState ({ roads, gridSize }).
 * @param {{x:number,y:number}} start  Start tile.
 * @param {{x:number,y:number}} goal   Goal tile.
 * @returns {Array<{x:number,y:number}>}
 */
export function buildRoute(city, start, goal) {
  const path = findPath(city, start, goal);
  // Keep only road tiles so vehicles never leave the road network. findPath
  // returns [start, ...roadTiles, goal]; start/goal may be off-road doors.
  const roadTiles = path.filter((t) => isRoadTile(city, t.x, t.y));
  return roadTiles.length ? roadTiles : path;
}

/** True when the tile (integer or fractional coords) is a road tile. */
function isRoadTile(city, x, y) {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= city.gridSize || ty >= city.gridSize) {
    return false;
  }
  return city.tiles[ty][tx].type === 'road';
}

/** Cardinal label for a movement vector (used to orient the sprite + lane). */
export function headingFor(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'e' : 'w';
  return dy >= 0 ? 's' : 'n';
}

/**
 * Right-hand-traffic lane offset (in tile units) for a heading. Vehicles on
 * the same road keep to their own side so they do not overlap head-on.
 */
export function laneOffsetFor(heading) {
  switch (heading) {
    case 'e': return [0, 0.24]; // east -> right side is south
    case 'w': return [0, -0.24]; // west -> right side is north
    case 's': return [-0.24, 0]; // south -> right side is west
    case 'n': return [0.24, 0]; // north -> right side is east
    default: return [0, 0];
  }
}

/** Rotation (radians) that orients a sprite's front toward `heading`. */
export function rotationFor(heading) {
  switch (heading) {
    case 'e': return 0;
    case 's': return Math.PI / 2;
    case 'w': return Math.PI;
    case 'n': return -Math.PI / 2;
    default: return 0;
  }
}

/** True when a road tile is a crossing (both axes have road neighbours). */
export function isIntersection(city, x, y) {
  const road = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= city.gridSize || ty >= city.gridSize) {
      return false;
    }
    return city.tiles[ty][tx].type === 'road';
  };
  const horiz = road(x - 1, y) || road(x + 1, y);
  const vert = road(x, y - 1) || road(x, y + 1);
  return horiz && vert;
}

/**
 * Basic right-of-way: a vehicle may enter its next waypoint only when no other
 * vehicle currently occupies that intersection tile. This prevents head-on
 * gridlock at crossings without mutating the road graph.
 * @param {object} vehicle  Moving vehicle.
 * @param {object} city     CityState ({ vehicles, gridSize, tiles }).
 * @returns {boolean} True when it is safe to advance into the next tile.
 */
export function canEnterTile(vehicle, city) {
  const target = vehicle.path[vehicle.pathIndex];
  if (!target) return true;
  const tx = Math.round(target.x);
  const ty = Math.round(target.y);
  if (!isIntersection(city, tx, ty)) return true;
  for (const other of city.vehicles) {
    if (other.id === vehicle.id) continue;
    if (other.state !== 'traveling' && other.state !== 'to-dest' &&
        other.state !== 'to-passenger' && other.state !== 'to-owner') {
      continue;
    }
    const ox = Math.round(other.tile.x);
    const oy = Math.round(other.tile.y);
    if (ox === tx && oy === ty) return false;
  }
  return true;
}