/**
 * Daily routine state machine.
 *
 * Citizens follow a home -> work -> entertainment -> home cycle driven by the
 * SimClock sim-hour, with a per-citizen jitter so the city does not move in
 * lockstep. Needs (hunger/energy/fun) bias which entertainment venue a citizen
 * picks in the evening.
 *
 * Phases (using each citizen's effective hour = simHour + jitter):
 *   0-6   sleep            (at home)
 *   7     to-work          (commute to workplace)
 *   8-16  work             (on shift)
 *   17    to-entertain     (commute to a venue chosen by need)
 *   18-21 entertain        (at the venue)
 *   22-23 to-home          (commute home, then sleep)
 */

import { findPath } from './pathfinding.js';

export const TRAVEL_PHASES = new Set(['to-work', 'to-entertain', 'to-home']);

/** @returns {boolean} Whether a phase involves walking between buildings. */
export function isTravel(phase) {
  return TRAVEL_PHASES.has(phase);
}

/** Map an effective hour of day to the citizen's desired phase. */
export function phaseForHour(effHour) {
  if (effHour < 7) return 'sleep';
  if (effHour < 8) return 'to-work';
  if (effHour < 17) return 'work';
  if (effHour < 18) return 'to-entertain';
  if (effHour < 22) return 'entertain';
  return 'to-home';
}

/** Per-citizen effective hour (sim-hour shifted by their jitter, wrapped 0-23). */
export function effectiveHour(citizen, hour) {
  return (hour + citizen.jitter + 24) % 24;
}

/** Static animation label for a stationary phase. */
function animationFor(phase) {
  switch (phase) {
    case 'sleep': return 'asleep';
    case 'work': return 'at-work';
    case 'entertain': return 'entertain';
    default: return 'idle';
  }
}

/** Resolve the door tile for a building id. */
function doorTile(city, buildingId) {
  const b = city.buildingById.get(buildingId);
  if (!b) return { x: 1, y: 1 };
  return { x: b.door.x, y: b.door.y };
}

/**
 * Choose an entertainment venue biased by the citizen's lowest need:
 * hunger -> restaurant/shop, energy -> park, fun -> entertainment zone.
 */
function chooseVenue(c, city) {
  const venues = city.buildings.filter(
    (b) => b.zone === 'entertainment' || b.zone === 'service',
  );
  if (!venues.length) return c.homeId;
  let best = venues[0];
  let bestScore = -Infinity;
  for (const v of venues) {
    let score = 0;
    if (v.zone === 'entertainment') {
      score += (100 - c.needs.fun) * 1.2;
    } else if (v.subType === 'restaurant') {
      score += (100 - c.needs.hunger) * 1.6;
    } else if (v.subType === 'park') {
      score += (100 - c.needs.energy) * 1.2;
    } else {
      score += (100 - c.needs.fun) * 0.6;
    }
    // Deterministic tie-break so the same citizen reliably picks the same spot.
    score += ((c.id * 31 + v.id * 17) % 7);
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best.id;
}

/** Destination door for a travel phase. */
function travelTarget(c, phase, city) {
  if (phase === 'to-entertain') {
    const venueId = chooseVenue(c, city);
    c.venueId = venueId;
    return doorTile(city, venueId);
  }
  if (phase === 'to-work') return doorTile(city, c.workplaceId);
  return doorTile(city, c.homeId);
}

/**
 * Advance every citizen's schedule on a sim-hour boundary. Called from the
 * clock subscriber. Starts new travel legs when the phase changes, but lets an
 * in-progress leg finish before switching.
 * @param {object} city  CityState ({ citizens, buildingById, buildings }).
 * @param {object} clock  SimClock ({ simHour }).
 */
export function advanceSchedules(city, clock) {
  for (const c of city.citizens) {
    const desired = phaseForHour(effectiveHour(c, clock.simHour));
    if (desired === c.phase) continue;
    // Keep traveling until the current leg finishes.
    if (isTravel(c.phase) && c.pathIndex < c.path.length) continue;
    if (isTravel(desired)) {
      c.phase = desired;
      c.target = travelTarget(c, desired, city);
      c.path = findPath(city, c.tile, c.target);
      c.pathIndex = 0;
      c.animation = 'walking';
    } else {
      c.phase = desired;
      c.animation = animationFor(desired);
    }
  }
}