/**
 * Day/night lighting overlay for the city simulation.
 *
 * `applyLighting` reads the simulation clock and paints two tint layers
 * over the scene so the day/night cycle is visible:
 *
 *   1. **Night darkening** — a deep indigo overlay whose alpha grows as
 *      daylight fades (0 at noon, ~0.55 at midnight).
 *   2. **Daytime warmth** — a soft amber wash whose alpha grows with
 *      daylight (0 at midnight, ~0.08 at noon).
 *
 * `drawSun` paints a sun (day) or moon (night) disk whose screen
 * position traces a rising/setting arc from horizon to horizon.
 */

import type { World } from '../sim/types';
import { HOURS_PER_DAY } from '../sim/constants';
import { getDaylightFactor } from '../sim/world';

// ─── Night / day tint colours ────────────────────────────────────────────────

/** Maximum alpha of the night-darkening overlay (applied at midnight). */
const NIGHT_OVERLAY_MAX_ALPHA = 0.55;

/** Maximum alpha of the daytime warm tint (applied at noon). */
const DAY_WARM_TINT_MAX_ALPHA = 0.08;

/** RGB night overlay colour (deep indigo). */
const NIGHT_RGB: Readonly<[number, number, number]> = [10, 15, 40];

/** RGB daytime warm-tint colour (soft amber). */
const DAY_WARM_RGB: Readonly<[number, number, number]> = [255, 220, 140];

// ─── Sun / moon arc ──────────────────────────────────────────────────────────

/** Hour at which the sun rises (left horizon). */
const SUNRISE_HOUR = 6;

/** Hour at which the sun sets (right horizon). */
const SUNSET_HOUR = 18;

/** Fraction of viewport height where the horizon sits (0 = top). */
const HORIZON_Y_FRACTION = 0.72;

/** Peak arc height above the horizon, as a fraction of viewport height. */
const ARC_HEIGHT_FRACTION = 0.55;

/** Celestial disk radius in pixels. */
const DISK_RADIUS = 28;

/** Glow halo radius multiplier around the disk. */
const GLOW_RADIUS_MULTIPLIER = 2.6;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the fractional hour-of-day in `[0, 24)` from elapsed hours.
 */
function getHourOfDay(elapsedHours: number): number {
  return ((elapsedHours % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
}

/**
 * Clamp a value into the inclusive `[0, 1]` range.
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Draw a full-viewport rectangle of the given RGBA colour.
 *
 * The colour is always emitted (even at alpha 0) so the computed
 * lighting value is deterministic and directly testable.
 */
function fillOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rgb: Readonly<[number, number, number]>,
  alpha: number,
): void {
  const clamped = clamp01(alpha);
  ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamped})`;
  ctx.fillRect(0, 0, width, height);
}

// ─── applyLighting ───────────────────────────────────────────────────────────

/**
 * Paint the day/night lighting overlays for the current simulation time.
 *
 * Two translucent full-viewport rectangles are drawn on top of the
 * scene:
 *
 *   - **Night darkening**: `rgba(10, 15, 40, 0.55·(1 − daylight))`
 *   - **Daytime warmth**:  `rgba(255, 220, 140, 0.08·daylight)`
 *
 * The daylight factor is derived from `world.simTime` via
 * {@link getDaylightFactor}.
 *
 * @param ctx            The 2D canvas context.
 * @param world          The simulation world (reads `simTime`).
 * @param viewportWidth  Visible canvas width in pixels.
 * @param viewportHeight Visible canvas height in pixels.
 */
export function applyLighting(
  ctx: CanvasRenderingContext2D,
  world: World,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const daylight = getDaylightFactor(world.simTime.elapsedHours);

  // Night darkening grows as daylight fades.
  fillOverlay(
    ctx,
    viewportWidth,
    viewportHeight,
    NIGHT_RGB,
    NIGHT_OVERLAY_MAX_ALPHA * (1 - daylight),
  );

  // Daytime warm tint grows with daylight.
  fillOverlay(
    ctx,
    viewportWidth,
    viewportHeight,
    DAY_WARM_RGB,
    DAY_WARM_TINT_MAX_ALPHA * daylight,
  );
}

// ─── getSunPosition (pure, testable) ─────────────────────────────────────────

/**
 * Compute the screen position of the celestial disk for a given hour.
 *
 * During the **day** (06:00–18:00) the sun rises on the left, peaks at
 * noon, and sets on the right along a parabolic arc.
 *
 * During the **night** (18:00–06:00) the moon traces a mirrored arc so
 * the sky always has a single visible body.
 *
 * @param hourOfDay      Fractional hour in `[0, 24)`.
 * @param viewportWidth  Visible canvas width in pixels.
 * @param viewportHeight Visible canvas height in pixels.
 * @returns Pixel coordinates `{ x, y }` of the disk centre.
 */
export function getSunPosition(
  hourOfDay: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const horizonY = viewportHeight * HORIZON_Y_FRACTION;
  const arcHeight = viewportHeight * ARC_HEIGHT_FRACTION;

  // Normalised progress across the visible arc, [0, 1].
  let progress: number;

  if (hourOfDay >= SUNRISE_HOUR && hourOfDay <= SUNSET_HOUR) {
    // Daytime: left (sunrise) → right (sunset).
    progress = (hourOfDay - SUNRISE_HOUR) / (SUNSET_HOUR - SUNRISE_HOUR);
  } else {
    // Night-time: moon. Map [18, 30) → [0, 1), wrapping past midnight.
    const nightHour = hourOfDay < SUNRISE_HOUR ? hourOfDay + HOURS_PER_DAY : hourOfDay;
    progress =
      (nightHour - SUNSET_HOUR) /
      (HOURS_PER_DAY - (SUNSET_HOUR - SUNRISE_HOUR));
  }

  const t = clamp01(progress);

  // x traverses left → right across the full arc.
  const x = viewportWidth * t;

  // Parabolic arc: y = horizonY − 4·arcHeight·t·(1 − t) (peak at t = 0.5).
  const y = horizonY - 4 * arcHeight * t * (1 - t);

  return { x, y };
}

// ─── drawSun ─────────────────────────────────────────────────────────────────

/**
 * Paint a soft sun (day) or moon (night) disk whose screen position
 * traces a rising/setting arc across the viewport based on the hour.
 *
 * The disk colour and halo shift between a warm sun (amber) and a cool
 * moon (pale blue) depending on the current daylight factor.
 *
 * @param ctx            The 2D canvas context.
 * @param world          The simulation world (reads `simTime`).
 * @param viewportWidth  Visible canvas width in pixels.
 * @param viewportHeight Visible canvas height in pixels.
 */
export function drawSun(
  ctx: CanvasRenderingContext2D,
  world: World,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const hourOfDay = getHourOfDay(world.simTime.elapsedHours);
  const daylight = getDaylightFactor(world.simTime.elapsedHours);
  const { x, y } = getSunPosition(hourOfDay, viewportWidth, viewportHeight);

  // Day → sun, night → moon.
  const isDay = daylight >= 0.5;
  const diskRgb = isDay ? '255, 232, 150' : '210, 222, 255';
  const haloRgb = isDay ? '255, 200, 80' : '150, 170, 230';

  const glowRadius = DISK_RADIUS * GLOW_RADIUS_MULTIPLIER;

  ctx.save();

  // Soft glow halo.
  const glow = ctx.createRadialGradient(
    x,
    y,
    DISK_RADIUS * 0.5,
    x,
    y,
    glowRadius,
  );
  glow.addColorStop(0, `rgba(${haloRgb}, 0.5)`);
  glow.addColorStop(1, `rgba(${haloRgb}, 0)`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  // Core disk.
  ctx.fillStyle = `rgb(${diskRgb})`;
  ctx.beginPath();
  ctx.arc(x, y, DISK_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
