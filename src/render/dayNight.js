/**
 * dayNight.js — global ambient light and phase rendering.
 *
 * The scene's daylight is derived from the SimClock's current sim-hour. The
 * module maps hours to four named phases (dawn, day, dusk, night) and to a
 * continuous 0-1 "ambient factor" (1 = full daylight, 0 = darkest night).
 *
 * The Lighting class tints the whole screen with an overlay color each frame
 * so the day/night cycle is visibly continuous. Night-time glows (streetlamps,
 * lit windows) are drawn from a pre-rendered night layer by the frame
 * orchestrator; vehicle headlights are wired later by the vehicle task through
 * the exposed drawDynamic hook.
 */

import { CONFIG } from '../core/config.js';

export const PHASE = {
  DAWN: 'dawn',
  DAY: 'day',
  DUSK: 'dusk',
  NIGHT: 'night',
};

/**
 * Hour -> ambient factor key frames. Linear interpolation fills the gaps so
 * the light curve is smooth across a full sim-day.
 *   0 = darkest night, 1 = brightest day.
 */
const LIGHT_CURVE = [
  [0, 0.1],
  [4, 0.1],
  [5, 0.16],
  [6, 0.35],
  [7, 0.7],
  [8, 0.96],
  [9, 1.0],
  [16, 1.0],
  [17, 0.86],
  [18, 0.55],
  [19, 0.3],
  [20, 0.18],
  [21, 0.12],
  [23, 0.1],
];

/** Named phase for a given sim-hour. */
export function getPhase(hour) {
  if (hour >= 5 && hour < 8) return PHASE.DAWN;
  if (hour >= 8 && hour < 17) return PHASE.DAY;
  if (hour >= 17 && hour < 20) return PHASE.DUSK;
  return PHASE.NIGHT;
}

/** Continuous 0-1 daylight factor for a given sim-hour. */
export function ambientFactor(hour) {
  const curve = LIGHT_CURVE;
  if (hour <= curve[0][0]) return curve[0][1];
  if (hour >= curve[curve.length - 1][0]) return curve[curve.length - 1][1];
  for (let i = 0; i < curve.length - 1; i++) {
    const [h0, f0] = curve[i];
    const [h1, f1] = curve[i + 1];
    if (hour >= h0 && hour <= h1) {
      const t = (hour - h0) / (h1 - h0);
      return f0 + (f1 - f0) * t;
    }
  }
  return 1;
}

/**
 * Screen-space tint overlay color for a sim-time snapshot.
 * @returns {{r:number,g:number,b:number,a:number}}
 */
export function lightingOverlay(simTime) {
  const hour = simTime.simHour;
  const phase = getPhase(hour);
  const factor = ambientFactor(hour);
  switch (phase) {
    case PHASE.DAY:
      return { r: 255, g: 248, b: 232, a: 0.03 };
    case PHASE.DAWN:
      return { r: 255, g: 176, b: 120, a: 0.1 + (1 - factor) * 0.2 };
    case PHASE.DUSK:
      return { r: 255, g: 128, b: 70, a: 0.16 + (1 - factor) * 0.18 };
    default: // night
      return { r: 24, g: 34, b: 78, a: 0.3 + (1 - factor) * 0.22 };
  }
}

/**
 * Ambient background color (clear fill) for a sim-time snapshot. Blends
 * between a light daytime sky and a dark night sky by the daylight factor.
 */
export function backgroundAt(simTime) {
  const factor = ambientFactor(simTime.simHour);
  const day = { r: 176, g: 188, b: 200 };
  const night = { r: 12, g: 16, b: 26 };
  return {
    r: Math.round(day.r * factor + night.r * (1 - factor)),
    g: Math.round(day.g * factor + night.g * (1 - factor)),
    b: Math.round(day.b * factor + night.b * (1 - factor)),
  };
}

/**
 * Applies the ambient tint overlay to a screen-space context. Kept as a small
 * class so the frame orchestrator can update it with the latest sim time.
 */
export class Lighting {
  constructor(simTime) {
    this.simTime = simTime;
  }

  update(simTime) {
    this.simTime = simTime;
  }

  get phase() {
    return getPhase(this.simTime.simHour);
  }

  get factor() {
    return ambientFactor(this.simTime.simHour);
  }

  /** True when the scene should show night glows (dusk onward). */
  get isNight() {
    return this.phase === PHASE.NIGHT || this.phase === PHASE.DUSK;
  }

  apply(ctx, width, height) {
    const { r, g, b, a } = lightingOverlay(this.simTime);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
    ctx.fillRect(0, 0, width, height);
  }
}