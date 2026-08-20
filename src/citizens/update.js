/**
 * Per-tick citizen updates.
 *
 * Moves traveling citizens along their A* path each frame, advances their
 * walking/idle/at-work/asleep animation state, decays needs over time, and
 * draws every citizen as a small top-down sprite through a pluggable
 * drawDynamic hook the renderer invokes inside the world transform.
 */

import { isTravel } from './schedule.js';

const drawDynamicCallbacks = [];

/**
 * Register a dynamic draw callback invoked each frame inside the world
 * transform (world coordinates already applied). Returns an unsubscribe fn.
 * @param {(ctx: object, city: object, camera: object) => void} cb
 */
export function registerDrawDynamic(cb) {
  if (typeof cb === 'function') drawDynamicCallbacks.push(cb);
  return () => {
    const i = drawDynamicCallbacks.indexOf(cb);
    if (i >= 0) drawDynamicCallbacks.splice(i, 1);
  };
}

/** Run all registered dynamic draw callbacks. Called by the renderer. */
export function drawDynamic(ctx, city, camera) {
  for (const cb of drawDynamicCallbacks) cb(ctx, city, camera);
}

/** Settle a citizen that has reached its travel destination. */
function arrive(c) {
  if (c.phase === 'to-work') {
    c.phase = 'work';
    c.animation = 'at-work';
  } else if (c.phase === 'to-entertain') {
    c.phase = 'entertain';
    c.animation = 'entertain';
  } else if (c.phase === 'to-home') {
    c.phase = 'sleep';
    c.animation = 'asleep';
  }
  c.tile.x = c.target.x;
  c.tile.y = c.target.y;
}

/** Cardinal label for a movement vector (used to orient the walking sprite). */
function facingFor(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'e' : 'w';
  return dy >= 0 ? 's' : 'n';
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

/** Slow drift of needs over real time; happiness reflects overall wellbeing. */
function decayNeeds(c, dt) {
  const n = c.needs;
  if (c.phase === 'work') {
    n.energy = Math.max(0, n.energy - 0.18 * dt);
    n.hunger = Math.max(0, n.hunger - 0.22 * dt);
    n.fun = Math.max(0, n.fun - 0.12 * dt);
  } else if (c.phase === 'entertain') {
    n.fun = Math.min(100, n.fun + 0.5 * dt);
    n.hunger = Math.max(0, n.hunger - 0.05 * dt);
  } else if (c.phase === 'sleep') {
    n.energy = Math.min(100, n.energy + 0.6 * dt);
  } else if (isTravel(c.phase)) {
    n.energy = Math.max(0, n.energy - 0.05 * dt);
  }
  const base = (n.hunger + n.energy + n.fun) / 3;
  c.happiness = Math.round(Math.max(0, Math.min(100, base + (c.employed ? 4 : -6))));
}

/**
 * Advance all citizens by one frame. Moves travelers along their path and
 * updates animation + needs.
 * @param {object} city  CityState ({ citizens }).
 * @param {object} clock  SimClock (unused here).
 * @param {number} dt  Real seconds since last frame.
 */
export function updateCitizens(city, clock, dt) {
  for (const c of city.citizens) {
    if (isTravel(c.phase) && c.path && c.pathIndex < c.path.length) {
      const target = c.path[c.pathIndex];
      const dx = target.x - c.tile.x;
      const dy = target.y - c.tile.y;
      const dist = Math.hypot(dx, dy);
      const step = c.speed * dt;
      if (dist <= step) {
        c.tile.x = target.x;
        c.tile.y = target.y;
        c.pathIndex++;
        if (c.pathIndex >= c.path.length) arrive(c);
      } else {
        c.tile.x += (dx / dist) * step;
        c.tile.y += (dy / dist) * step;
        c.animation = 'walking';
        c.facing = facingFor(dx, dy);
      }
    } else if (isTravel(c.phase)) {
      // No route or leg finished: settle into the arrival state.
      arrive(c);
    } else {
      c.animation = animationFor(c.phase);
    }
    decayNeeds(c, dt);
  }
}

const STATE_COLORS = {
  idle: '#c9d1d9',
  walking: '#7ee081',
  'at-work': '#f0a35e',
  asleep: '#5b7bb5',
  entertain: '#d06fe0',
};

/**
 * Draw every citizen as a small top-down sprite, color-coded by animation
 * state so idle / walking / at-work / asleep are visually distinct.
 * @param {object} ctx  Canvas 2D context (world transform already applied).
 * @param {object} city  CityState ({ citizens, tileSize }).
 * @param {object} camera  Camera ({ zoom }).
 */
export function drawCitizens(ctx, city, camera) {
  const ts = city.tileSize;
  for (const c of city.citizens) {
    const px = c.tile.x * ts;
    const py = c.tile.y * ts;
    const r = ts * 0.3;
    ctx.fillStyle = STATE_COLORS[c.animation] || STATE_COLORS.idle;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();

    if (c.animation === 'walking') {
      const dirs = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
      const dir = dirs[c.facing] || [0, 1];
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + dir[0] * r, py + dir[1] * r);
      ctx.stroke();
    }
  }
}