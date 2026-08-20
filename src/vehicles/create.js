/**
 * Vehicle factory + type palette.
 *
 * Vehicles are lightweight entities that drive along the road network. Each
 * vehicle record carries the fields the renderer and sim loop need: id, type,
 * color, speed, position (world px), and live edge/route bookkeeping. The
 * factory is deterministic when given a stable id + seed stream, so a fixed
 * world seed reproduces the exact same fleet.
 */

import { RNG } from '../core/rng.js';

/** Small type palette with per-type color, speed and footprint (in tiles). */
export const VEHICLE_TYPES = {
  car: { color: '#d94848', speed: 11, size: { w: 0.5, l: 0.55 } },
  'delivery van': { color: '#e8953f', speed: 9, size: { w: 0.55, l: 0.6 } },
  taxi: { color: '#f3c623', speed: 13, size: { w: 0.5, l: 0.55 } },
  bus: { color: '#4f7fd9', speed: 8, size: { w: 0.45, l: 0.8 } },
};

/** Ordered list of the supported vehicle types (car, delivery van, taxi, bus). */
export const VEHICLE_PALETTE = Object.keys(VEHICLE_TYPES);

/** @returns {string[]} Copy of the type palette. */
export function vehiclePalette() {
  return VEHICLE_PALETTE.slice();
}

/**
 * Create a single vehicle.
 * @param {number} id Unique vehicle id.
 * @param {string} type One of VEHICLE_PALETTE ('car' | 'delivery van' | 'taxi' | 'bus').
 * @param {{x:number,y:number}} position Start position in world pixels (on a road).
 * @param {object} [opts]
 * @param {number} [opts.seed] Deterministic seed for the detail fields.
 * @param {string} [opts.color] Override the palette color.
 * @param {number} [opts.speed] Override the palette speed (tiles per second).
 * @param {'r'|'l'} [opts.lane] 'r' = right-hand traffic (default), 'l' = left.
 * @returns {object} Vehicle record.
 */
export function createVehicle(id, type, position, opts = {}) {
  const spec = VEHICLE_TYPES[type] || VEHICLE_TYPES.car;
  const rng = new RNG((opts.seed ?? (id * 2654435761)) >>> 0);
  return {
    id,
    kind: type,
    type,
    color: opts.color || spec.color,
    speed: opts.speed ?? spec.speed,
    size: { w: spec.size.w, l: spec.size.l },
    lane: opts.lane ?? 'r',
    position: { x: position.x ?? 0, y: position.y ?? 0 },

    // --- edge / path bookkeeping (filled in by routes.js + update.js) ------
    route: null,      // { tiles: array<{x,y}>, points: array<{x,y}> }
    edge: null,       // { from: {x,y}, to: {x,y} } current road segment
    pathIndex: 0,     // index into route.points / route.tiles
    segmentT: 0,      // progress (px) along the current segment
    heading: { x: 1, y: 0 },
    state: 'travel',
    onRoad: true,
    detailSeed: rng.int(1, 1000000000),
  };
}