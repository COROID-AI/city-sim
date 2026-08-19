/**
 * Per-tick vehicle updates and rendering.
 *
 * Advances every vehicle each frame (passenger pickup/dropoff, refuel when
 * low, per-kind behaviour), publishes the current lighting level onto the
 * CityState for the renderer, and registers a drawDynamic callback that draws
 * top-down vehicle sprites — with working headlights at night — through the
 * renderer's shared dynamic-draw pipeline.
 */

import { laneOffsetFor, rotationFor } from './route.js';
import { updateBus, updateTaxi, updateVan, updateCar } from './behavior.js';
import { registerDrawDynamic } from '../citizens/update.js';

const KIND_COLORS = {
  bus: '#e0b13c',
  taxi: '#f5d442',
  van: '#7cb3e8',
  car: '#e85c5c',
};

/**
 * Advance all vehicles by one frame.
 * @param {object} city   CityState ({ vehicles, citizens }).
 * @param {object} clock  SimClock ({ dayPhase }).
 * @param {number} dt     Real seconds since last frame.
 */
export function updateVehicles(city, clock, dt) {
  if (!city.vehicles) return;

  // Publish lighting for the night-time headlight render.
  city.lighting = {
    night: clock.dayPhase < 0.22 || clock.dayPhase > 0.72,
    phase: clock.dayPhase,
  };

  for (const v of city.vehicles) {
    // Refuel when low: pause and charge back up.
    if (v.fuel < 20 && v.state !== 'refueling') {
      v.prevState = v.state;
      v.state = 'refueling';
      v.path = [];
      v.pathIndex = 0;
    }
    if (v.state === 'refueling') {
      v.fuel = Math.min(100, v.fuel + 12 * dt);
      if (v.fuel >= 95) v.state = v.prevState || 'idle';
      continue;
    }

    // Burn fuel while moving.
    if (v.state !== 'idle' && v.state !== 'dwell') {
      v.fuel = Math.max(0, v.fuel - 0.02 * dt);
    }

    switch (v.kind) {
      case 'bus': updateBus(v, city, clock, dt); break;
      case 'taxi': updateTaxi(v, city, clock, dt); break;
      case 'van': updateVan(v, city, clock, dt); break;
      case 'car': updateCar(v, city, clock, dt); break;
    }
  }
}

/**
 * Draw every vehicle as a top-down sprite, colour-coded by kind and oriented
 * by heading, with lane offset and headlights at night.
 * @param {object} ctx     Canvas 2D context (world transform applied).
 * @param {object} city    CityState ({ vehicles, tileSize, lighting }).
 * @param {object} camera  Camera ({ zoom }).
 */
export function drawVehicles(ctx, city, camera) {
  if (!city.vehicles) return;
  const ts = city.tileSize;
  const night = city.lighting && city.lighting.night;

  for (const v of city.vehicles) {
    const [ox, oy] = laneOffsetFor(v.heading);
    const px = (v.tile.x + ox) * ts;
    const py = (v.tile.y + oy) * ts;
    const w = ts * 0.72;
    const h = ts * 0.4;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rotationFor(v.heading));

    // Body.
    ctx.fillStyle = KIND_COLORS[v.kind] || '#999999';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    // Cabin / roof line.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-w / 2, -h / 2, w, h * 0.16);
    // Windshield near the front (heading direction is +x before rotation).
    ctx.fillStyle = '#9fd8ff';
    ctx.fillRect(w * 0.22, -h * 0.28, w * 0.14, h * 0.2);

    if (night) {
      // Headlights.
      ctx.fillStyle = '#fff9c4';
      ctx.fillRect(w * 0.3, -h * 0.3, w * 0.1, h * 0.16);
      ctx.fillRect(w * 0.3, h * 0.14, w * 0.1, h * 0.16);
      // Forward light beams.
      ctx.strokeStyle = 'rgba(255,240,180,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.4, -h * 0.22);
      ctx.lineTo(w * 0.8, -h * 0.55);
      ctx.moveTo(w * 0.4, h * 0.22);
      ctx.lineTo(w * 0.8, h * 0.55);
      ctx.stroke();
    }

    ctx.restore();
  }
}

// Register our vehicle renderer with the shared dynamic-draw pipeline so it
// renders inside the world transform without changing the render loop.
registerDrawDynamic(drawVehicles);