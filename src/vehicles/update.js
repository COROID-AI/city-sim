/**
 * Per-frame vehicle movement.
 *
 * Each vehicle follows its route's waypoints (tile centers, pixels, from
 * routes.js). Movement keeps `vehicle.position` exactly on the road
 * centerline, which guarantees the vehicle never occupies a building or grass
 * tile; lane-following is a small perpendicular offset computed per frame and
 * exposed on the vehicle (`laneOffset`) so traffic keeps to the right side
 * (or left for left-hand traffic). Waypoint arrival advances the vehicle
 * toward the next segment — a direction change behaves as a turn at an
 * intersection. When the route is exhausted the vehicle is left at the final
 * waypoint with state 'arrived' and index.js immediately hands it a new
 * (cached/recycled) destination so motion stays continuous.
 */

import { CONFIG } from '../core/config.js';

/** Right-hand lane offset from the road centerline (tile units). */
export const LANE_OFFSET = 0.2;

/** Maximum interior steps per frame to survive degenerate paths. */
const MAX_STEPS = 1024;

/**
 * Move one vehicle along its route by dt seconds.
 * @param {object} v Vehicle from createVehicle().
 * @param {object} world World/city state ({ tileSize }).
 * @param {number} dt Real seconds since last frame.
 * @returns {boolean} true while still driving; false on arrival.
 */
export function moveVehicle(v, world, dt) {
  const ts = world.tileSize || CONFIG.TILE_SIZE;
  const route = v.route;
  if (!route || !route.points || route.points.length < 2) {
    v.state = 'arrived';
    return false;
  }

  // Lazily convert tile-center waypoints to pixel waypoints.
  if (!route.pxPoints) {
    route.pxPoints = route.points.map((p) => ({ x: p.x * ts, y: p.y * ts }));
  }
  const pts = route.pxPoints;

  // pathIndex = index of the waypoint we are currently heading toward.
  // A freshly assigned route starts at pts[0] heading to pts[1].
  if (typeof v.pathIndex !== 'number' || v.pathIndex < 1) v.pathIndex = 1;
  if (v.pathIndex > pts.length - 1) v.pathIndex = pts.length - 1;

  const speedPx = v.speed * ts;
  let remaining = speedPx * Math.max(0, dt);
  let steps = 0;

  while (remaining > 0 && v.pathIndex < pts.length - 1) {
    const from = pts[v.pathIndex - 1];
    const to = pts[v.pathIndex];
    const segDx = to.x - from.x;
    const segDy = to.y - from.y;
    const segLen = Math.hypot(segDx, segDy) || 1;
    v.heading = { x: segDx / segLen, y: segDy / segLen };

    const dirX = to.x - v.position.x;
    const dirY = to.y - v.position.y;
    const dist = Math.hypot(dirX, dirY);

    if (dist <= remaining + 1e-6) {
      // Reach the waypoint: turn at the intersection onto the next segment.
      remaining -= dist;
      v.position.x = to.x;
      v.position.y = to.y;
      v.pathIndex++;
    } else {
      v.position.x += (dirX / dist) * remaining;
      v.position.y += (dirY / dist) * remaining;
      remaining = 0;
    }
    if (++steps > MAX_STEPS) break;
  }

  // Expose the active segment (pixel waypoints) for the renderer / tooling.
  v.edge = {
    from: pts[Math.max(0, v.pathIndex - 1)],
    to: pts[Math.min(pts.length - 1, v.pathIndex)],
  };

  // Snap back to the road centerline (safety net; position is already on it).
  snapToRoad(v, v.edge);

  if (v.pathIndex >= pts.length - 1) {
    const last = pts[pts.length - 1];
    v.position.x = last.x;
    v.position.y = last.y;
    v.state = 'arrived';
    return false;
  }
  v.state = 'travel';
  return true;
}

/**
 * Set the vehicle's visual lane offset vector. Kept as data on the vehicle so
 * the renderer can draw at position + laneOffset without any movement code.
 * In screen coordinates (y grows downward) the right-hand normal of heading
 * (hx, hy) is (-hy, hx); negate for left-hand traffic.
 * @param {object} v Vehicle.
 * @param {number} ts Tile size in px.
 */
export function computeLaneOffset(v, ts) {
  const off = LANE_OFFSET * ts;
  const hx = v.heading.x || 1;
  const hy = v.heading.y || 0;
  const nx = -hy;
  const ny = hx;
  const sign = v.lane === 'l' ? -1 : 1;
  v.laneOffset = { x: nx * off * sign, y: ny * off * sign };
  return v.laneOffset;
}

/** Project a position onto its segment so it stays exactly on-road. */
function snapToRoad(v, edge) {
  const from = edge.from;
  const to = edge.to;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.max(
    0,
    Math.min(1, ((v.position.x - from.x) * dx + (v.position.y - from.y) * dy) / (len * len)),
  );
  v.position.x = from.x + t * dx;
  v.position.y = from.y + t * dy;
}

/**
 * Tile the vehicle currently occupies.
 *
 * Movement keeps position exactly on road centerlines, which live at tile
 * centers (n + 0.5) * ts, so flooring the pixel position lands on the road
 * tile the vehicle is travelling along. This is exact for both normal span
 * positions and waypoint (segment boundary) positions.
 * @param {object} v Vehicle.
 * @param {number} ts Tile size in px.
 * @returns {{x:number, y:number}}
 */
export function vehicleTile(v, ts) {
  return { x: Math.floor(v.position.x / ts), y: Math.floor(v.position.y / ts) };
}

/**
 * Draw every vehicle as a small oriented rectangle in world space. The
 * renderer invokes this inside the camera transform (same contract as
 * drawCitizens); uses city.vehicles + city.tileSize.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} city CityState ({ vehicles, tileSize }).
 * @param {object} camera Camera ({ zoom }, for future scale-aware effects).
 */
export function drawVehicles(ctx, city, camera) {
  void camera;
  const ts = city.tileSize || CONFIG.TILE_SIZE;
  for (const v of city.vehicles || []) {
    if (v.state !== 'travel' && v.state !== 'arrived') continue;
    const off = v.laneOffset && v.state === 'travel' ? v.laneOffset : { x: 0, y: 0 };
    const px = v.position.x + off.x;
    const py = v.position.y + off.y;

    const angle = Math.atan2(v.heading.y, v.heading.x);
    const s = v.size || { w: 0.5, l: 0.55 };
    const w = s.w * ts;
    const l = s.l * ts;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = v.color;
    ctx.fillRect(-l / 2, -w / 2, l, w);
    // Windshield hint so the driving direction reads clearly.
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(l / 2 - l * 0.2, -w / 2 + w * 0.15, l * 0.12, w * 0.7);
    ctx.restore();
  }
}