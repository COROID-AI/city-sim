/**
 * Vehicle subsystem aggregate module.
 *
 * Owns the fleet lifecycle: initVehicles(world, config) creates 10+ vehicles
 * (type palette car / delivery van / taxi / bus), assigns each an immediate
 * route, and updateVehicles(dt, world, camera) advances the whole fleet each
 * frame. Arrived vehicles are handed a fresh destination drawn through the
 * recycled route cache so traffic never idles at spawn. The fleet is exposed
 * through getVehicles() so the renderer can consume position/heading/color
 * data for drawing.
 */

import { CONFIG } from '../core/config.js';
import { RNG } from '../core/rng.js';
import { createVehicle, VEHICLE_PALETTE } from './create.js';
import { createRouteCache, selectRoute, randomRoadAnchor } from './routes.js';
import { moveVehicle, computeLaneOffset, vehicleTile } from './update.js';

/** Fleet aggregate (module-private; getVehicles() exposes it to the renderer). */
const fleet = {
  vehicles: [],
  routeCache: null,
  rng: null,
  count: 0,
};

/** @returns {object[]} Live fleet array (positions/routes mutate in place). */
export function getVehicles() {
  return fleet.vehicles;
}

/** For diagnostics: number of cached routes currently in use. */
export function cachedRouteCount() {
  return fleet.routeCache ? fleet.routeCache.size() : 0;
}

/**
 * Create the vehicle fleet on a world. Each vehicle starts on a road anchor
 * and immediately receives a cached route so every one is driving at boot.
 * @param {object} world World/city state ({ roads, gridSize, tileSize }).
 * @param {object} config Tunables config.
 * @returns {object[]} The fleet (same array as getVehicles()).
 */
export function initVehicles(world, config = CONFIG) {
  const rng = new RNG((config.SEED + 13) >>> 0);
  const routeCache = createRouteCache(world);
  const count = Math.max(config.MIN_VEHICLES || CONFIG.MIN_VEHICLES, 10);
  const ts = world.tileSize || CONFIG.TILE_SIZE;

  fleet.routeCache = routeCache;
  fleet.rng = rng;
  fleet.vehicles = [];
  fleet.count = count;

  for (let i = 0; i < count; i++) {
    const type = VEHICLE_PALETTE[i % VEHICLE_PALETTE.length];
    const r = randomRoadAnchor(world, rng);
    if (!r) break;
    const vehicle = createVehicle(
      i + 1,
      type,
      { x: (r.x + 0.5) * ts, y: (r.y + 0.5) * ts },
      { seed: rng.int(1, 1000000000) },
    );
    const route = selectRoute(world, rng, routeCache, { x: r.x, y: r.y });
    if (route) {
      vehicle.route = route;
      vehicle.pathIndex = 1;
      vehicle.state = 'travel';
      // Align heading + lane offset with the first segment right away so the
      // renderer gets correct orientation even before the first update frame.
      const a = route.points[0];
      const b = route.points[1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      vehicle.heading = { x: dx / len, y: dy / len };
      computeLaneOffset(vehicle, ts);
    } else {
      vehicle.state = 'arrived';
    }
    fleet.vehicles.push(vehicle);
  }

  return fleet.vehicles;
}

/**
 * Advance the entire fleet by dt seconds. Arrived vehicles are immediately
 * given a new destination via the cached route selector (recycled routes keep
 * motion continuous and deterministic).
 * @param {number} dt Real seconds since last frame.
 * @param {object} world World/city state ({ tileSize, gridSize }).
 * @param {object} camera Camera ({ zoom }).
 */
export function updateVehicles(dt, world, camera) {
  void camera;
  const ts = world.tileSize || CONFIG.TILE_SIZE;
  for (const v of fleet.vehicles) {
    const driving = moveVehicle(v, world, dt);
    if (!driving) {
      // Arrived: carry on from the current road tile so driving stays
      // continuous and never cuts across building/grass tiles.
      const tile = vehicleTile(v, ts);
      const next = fleet.routeCache && tile
        ? selectRoute(world, fleet.rng, fleet.routeCache, tile)
        : null;
      if (next) {
        v.route = next;
        v.pathIndex = 1;
        v.state = 'travel';
      } else {
        v.state = 'arrived';
      }
    }
    computeLaneOffset(v, ts);
  }
}

/** Renderer-consumable data: live entities + drawing helper. */
export { drawVehicles, vehicleTile } from './update.js';