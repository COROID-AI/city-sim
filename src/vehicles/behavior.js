/**
 * Per-kind vehicle behaviour.
 *
 *   - Bus:         loops between residential → office → entertainment stops,
 *                  dwelling at each to pick up / drop off passengers.
 *   - Taxi:        picks up commuting citizens whose commute exceeds a walk
 *                  threshold and drives them to their destination.
 *   - Delivery van:circulates between company offices and shops.
 *   - Private car: carries its owner to/from work when the commute is long.
 *
 * Passenger integration coordinates through CityState: while riding, a
 * citizen's `riding` flag is set and their phase is `riding` so the citizens
 * layer leaves them stationary; on dropoff they resume the appropriate
 * arrival phase. If vehicle modules are absent the citizens simply walk.
 */

import { buildRoute, canEnterTile, headingFor } from './route.js';
import { isTravel } from '../citizens/schedule.js';

/** Commute distance (tiles) beyond which a taxi/car is worth using. */
export const WALK_THRESHOLD = 8;

/** Arrival phase after a ride, mirroring the citizen walker's arrive(). */
export function arrivalPhase(phase) {
  if (phase === 'to-work') return 'work';
  if (phase === 'to-entertain') return 'entertain';
  if (phase === 'to-home') return 'sleep';
  return phase;
}

/** Animation label for an arrival phase. */
function animationFor(phase) {
  switch (phase) {
    case 'work': return 'at-work';
    case 'sleep': return 'asleep';
    case 'entertain': return 'entertain';
    default: return 'idle';
  }
}

/** Advance a vehicle one step along its current road path. */
export function moveAlongPath(v, city, dt) {
  if (!v.path || v.pathIndex >= v.path.length) return;
  const target = v.path[v.pathIndex];
  if (!canEnterTile(v, city)) return; // right-of-way: wait at intersection
  const dx = target.x - v.tile.x;
  const dy = target.y - v.tile.y;
  const dist = Math.hypot(dx, dy);
  const step = v.speed * dt;
  if (dist <= step) {
    v.tile.x = target.x;
    v.tile.y = target.y;
    v.pathIndex++;
    v.heading = headingFor(dx, dy);
  } else {
    v.tile.x += (dx / dist) * step;
    v.tile.y += (dy / dist) * step;
    v.heading = headingFor(dx, dy);
  }
}

/** Keep riding passengers locked to the vehicle's position each tick. */
function syncPassengers(v, city) {
  for (const pid of v.passengers) {
    const c = city.citizens.find((c) => c.id === pid);
    if (c) {
      c.tile = { x: v.tile.x, y: v.tile.y };
      c.phase = 'riding';
      c.animation = 'riding';
    }
  }
}

/** Drop passengers whose destination is this stop. */
function dropOffAtStop(v, city, stopTile) {
  for (let i = v.passengers.length - 1; i >= 0; i--) {
    const c = city.citizens.find((c) => c.id === v.passengers[i]);
    if (!c) continue;
    const d = Math.hypot(c.ridingDest.x - stopTile.x, c.ridingDest.y - stopTile.y);
    if (d < 1.5) {
      c.tile = { x: c.ridingDest.x, y: c.ridingDest.y };
      c.phase = arrivalPhase(c.ridingPhase);
      c.animation = animationFor(c.phase);
      c.riding = null;
      v.passengers.splice(i, 1);
    }
  }
}

/** Board nearby travelling citizens heading somewhere else. */
function pickUpAtStop(v, city, stopTile) {
  if (v.passengers.length >= v.capacity) return;
  for (const c of city.citizens) {
    if (v.passengers.length >= v.capacity) break;
    if (c.riding) continue;
    if (!isTravel(c.phase)) continue;
    const d = Math.hypot(c.tile.x - stopTile.x, c.tile.y - stopTile.y);
    if (d < 2.5) {
      c.riding = v.id;
      c.ridingDest = { x: c.target.x, y: c.target.y };
      c.ridingPhase = c.phase;
      c.phase = 'riding';
      c.animation = 'riding';
      v.passengers.push(c.id);
    }
  }
}

/** Bus: drive the residential → office → entertainment loop, dwelling at stops. */
export function updateBus(v, city, clock, dt) {
  if (v.state === 'dwell') {
    v.holdTime -= dt;
    if (v.holdTime > 0) return;
    v.state = 'traveling';
    v.stopIndex = (v.stopIndex + 1) % v.stops.length;
    v.destination = v.stops[v.stopIndex];
    v.path = buildRoute(city, v.tile, v.destination);
    v.pathIndex = 0;
  }
  if (!v.path || !v.path.length) {
    v.destination = v.stops[v.stopIndex];
    v.path = buildRoute(city, v.tile, v.destination);
    v.pathIndex = 0;
  }
  if (v.pathIndex >= v.path.length) {
    v.state = 'dwell';
    v.holdTime = 1.0;
    dropOffAtStop(v, city, v.destination);
    pickUpAtStop(v, city, v.destination);
    return;
  }
  syncPassengers(v, city);
  moveAlongPath(v, city, dt);
}

/** Find a commuting citizen worth a taxi ride (long commute, not already claimed). */
function findCommuter(v, city) {
  for (const c of city.citizens) {
    if (!isTravel(c.phase) || c.riding) continue;
    const dist = Math.hypot(c.tile.x - c.target.x, c.tile.y - c.target.y);
    if (dist <= WALK_THRESHOLD) continue;
    const claimed = city.vehicles.some(
      (o) => o.kind === 'taxi' && o.id !== v.id &&
        o.state === 'to-passenger' && o.passengerId === c.id,
    );
    if (claimed) continue;
    return c;
  }
  return null;
}

/** Taxi: pick up a long-distance commuter and carry them to their target. */
export function updateTaxi(v, city, clock, dt) {
  if (v.state === 'to-passenger') {
    const c = city.citizens.find((c) => c.id === v.passengerId);
    if (!c) {
      v.state = 'idle';
      v.passengerId = null;
      return;
    }
    if (v.pathIndex >= v.path.length) {
      const d = Math.hypot(v.tile.x - c.tile.x, v.tile.y - c.tile.y);
      if (d <= 2) {
        c.riding = v.id;
        c.ridingDest = { x: c.target.x, y: c.target.y };
        c.ridingPhase = c.phase;
        c.phase = 'riding';
        c.animation = 'riding';
        v.passengers = [c.id];
        v.state = 'to-dest';
        v.destination = { x: c.ridingDest.x, y: c.ridingDest.y };
        v.path = buildRoute(city, v.tile, v.destination);
        v.pathIndex = 0;
      } else {
        // Passenger walked on — reroute to their current tile.
        v.destination = { x: c.tile.x, y: c.tile.y };
        v.path = buildRoute(city, v.tile, v.destination);
        v.pathIndex = 0;
      }
      return;
    }
    moveAlongPath(v, city, dt);
    return;
  }

  if (v.state === 'to-dest') {
    const c = city.citizens.find((c) => c.id === v.passengerId);
    if (!c) {
      v.state = 'idle';
      v.passengerId = null;
      return;
    }
    syncPassengers(v, city);
    if (v.pathIndex >= v.path.length) {
      c.tile = { x: c.ridingDest.x, y: c.ridingDest.y };
      c.phase = arrivalPhase(c.ridingPhase);
      c.animation = animationFor(c.phase);
      c.riding = null;
      v.passengers = [];
      v.passengerId = null;
      v.state = 'idle';
      v.destination = null;
      return;
    }
    moveAlongPath(v, city, dt);
    return;
  }

  // Idle: hunt for a commuting passenger.
  const c = findCommuter(v, city);
  if (c) {
    v.passengerId = c.id;
    v.state = 'to-passenger';
    v.destination = { x: c.tile.x, y: c.tile.y };
    v.path = buildRoute(city, v.tile, v.destination);
    v.pathIndex = 0;
  }
}

/** Delivery van: circulate between offices and shops. */
export function updateVan(v, city, clock, dt) {
  if (v.state === 'dwell') {
    v.holdTime -= dt;
    if (v.holdTime > 0) return;
    v.state = 'traveling';
    v.circuitIndex = (v.circuitIndex + 1) % v.circuit.length;
    v.destination = v.circuit[v.circuitIndex];
    v.path = buildRoute(city, v.tile, v.destination);
    v.pathIndex = 0;
  }
  if (!v.path || !v.path.length) {
    v.path = buildRoute(city, v.tile, v.destination);
    v.pathIndex = 0;
  }
  if (v.pathIndex >= v.path.length) {
    v.state = 'dwell';
    v.holdTime = 0.8;
    v.destination = v.circuit[v.circuitIndex];
    v.path = [];
    return;
  }
  moveAlongPath(v, city, dt);
}

/** Private car: carry the owner to/from work on long commutes. */
export function updateCar(v, city, clock, dt) {
  const owner = city.citizens.find((c) => c.id === v.ownerId);
  if (!owner) return;

  if (v.state === 'to-owner') {
    if (v.pathIndex >= v.path.length) {
      const d = Math.hypot(v.tile.x - owner.tile.x, v.tile.y - owner.tile.y);
      if (d <= 2) {
        owner.riding = v.id;
        owner.ridingDest = { x: owner.target.x, y: owner.target.y };
        owner.ridingPhase = owner.phase;
        owner.phase = 'riding';
        owner.animation = 'riding';
        v.passengers = [owner.id];
        v.state = 'to-dest';
        v.destination = { x: owner.ridingDest.x, y: owner.ridingDest.y };
        v.path = buildRoute(city, v.tile, v.destination);
        v.pathIndex = 0;
      } else {
        v.destination = { x: owner.tile.x, y: owner.tile.y };
        v.path = buildRoute(city, v.tile, v.destination);
        v.pathIndex = 0;
      }
      return;
    }
    moveAlongPath(v, city, dt);
    return;
  }

  if (v.state === 'to-dest' && owner.riding === v.id) {
    syncPassengers(v, city);
    if (v.pathIndex >= v.path.length) {
      owner.tile = { x: owner.ridingDest.x, y: owner.ridingDest.y };
      owner.phase = arrivalPhase(owner.ridingPhase);
      owner.animation = animationFor(owner.phase);
      owner.riding = null;
      v.passengers = [];
      v.state = 'idle';
      v.destination = null;
      return;
    }
    moveAlongPath(v, city, dt);
    return;
  }

  // Owner not being carried: engage only for long commutes.
  if (isTravel(owner.phase) && !owner.riding) {
    const dist = Math.hypot(owner.tile.x - owner.target.x, owner.tile.y - owner.target.y);
    if (dist > WALK_THRESHOLD) {
      v.state = 'to-owner';
      v.destination = { x: owner.tile.x, y: owner.tile.y };
      v.path = buildRoute(city, v.tile, v.destination);
      v.pathIndex = 0;
    }
  } else {
    v.state = 'idle';
  }
}