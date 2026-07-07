/**
 * Top-overlay HUD for the city simulation.
 *
 * `drawHud` paints a fixed, semi-transparent rounded bar across the top
 * of the canvas displaying four live readouts:
 *
 *   1. **Population**        — number of citizens (`aggregateStats`).
 *   2. **Employment Rate**   — fraction of citizens employed (`aggregateStats`).
 *   3. **City Time**         — `Day N, HH:00` derived from `world.simTime`.
 *   4. **City Budget**       — city treasury from `world.budget`.
 *
 * Values are read freshly every frame from {@link aggregateStats} and
 * `world.budget`, so the overlay always reflects the current state.
 *
 * `drawHud` assumes it is invoked in **screen space** (identity transform)
 * and as the **last** render step so it sits on top of lighting, minimap,
 * and all other layers.
 */

import { aggregateStats } from '../sim/economy';
import { HOURS_PER_DAY } from '../sim/constants';
import type { World } from '../sim/types';

// ─── Layout constants ────────────────────────────────────────────────────────

/** Height of the HUD bar in pixels. */
const BAR_HEIGHT = 52;

/** Horizontal inset of the bar from the canvas edges. */
const BAR_MARGIN_X = 12;

/** Vertical inset of the bar from the top edge. */
const BAR_MARGIN_TOP = 12;

/** Corner radius of the rounded bar. */
const BAR_RADIUS = 14;

/** Font for the muted uppercase labels above each value. */
const LABEL_FONT = '11px system-ui, -apple-system, sans-serif';

/** Font for the bright readout values. */
const VALUE_FONT = '16px system-ui, -apple-system, sans-serif';

// ─── Formatting helpers ──────────────────────────────────────────────────────

/**
 * Zero-pad an integer to two digits.
 */
function pad2(n: number): string {
  return Math.floor(n).toString().padStart(2, '0');
}

/**
 * Format the simulation clock as `Day N, HH:00`.
 *
 * `Day N` is the number of whole elapsed days; `HH` is the hour-of-day
 * zero-padded. Minutes are always shown as `:00` per the HUD spec.
 *
 * @param elapsedHours Total elapsed sim-hours (may be fractional).
 * @returns A string such as `"Day 2, 09:00"`.
 */
export function formatCityTime(elapsedHours: number): string {
  const day = Math.floor(elapsedHours / HOURS_PER_DAY);
  const hourOfDay =
    ((elapsedHours % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  return `Day ${day}, ${pad2(hourOfDay)}:00`;
}

// ─── Drawing helpers ─────────────────────────────────────────────────────────

/**
 * Trace a rounded-rectangle path (without filling or stroking).
 *
 * Implemented manually with `arcTo` so it works regardless of canvas
 * `roundRect` support.
 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Paint the top-overlay HUD for the current simulation state.
 *
 * Draws a semi-transparent rounded bar spanning the canvas width with
 * four evenly-spaced readouts. All values are recomputed on each call
 * from {@link aggregateStats} and `world.budget`.
 *
 * @param ctx   The 2D canvas context (must be in screen space).
 * @param world The simulation world to read stats, time, and budget from.
 */
export function drawHud(ctx: CanvasRenderingContext2D, world: World): void {
  const width = ctx.canvas.width;

  const x = BAR_MARGIN_X;
  const y = BAR_MARGIN_TOP;
  const w = Math.max(0, width - BAR_MARGIN_X * 2);
  const h = BAR_HEIGHT;

  // ── Semi-transparent rounded background bar ─────────────────────────────
  ctx.save();

  roundRectPath(ctx, x, y, w, h, BAR_RADIUS);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
  ctx.fill();

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.stroke();

  // ── Compute live readouts ───────────────────────────────────────────────
  const stats = aggregateStats(world);
  const population = stats.population.toLocaleString('en-US');
  const employment = `${(stats.employmentRate * 100).toFixed(0)}%`;
  const cityTime = formatCityTime(world.simTime.elapsedHours);
  const budget = `$${world.budget.toLocaleString('en-US')}`;

  const readouts: ReadonlyArray<{ label: string; value: string }> = [
    { label: 'Population', value: population },
    { label: 'Employment Rate', value: employment },
    { label: 'City Time', value: cityTime },
    { label: 'City Budget', value: budget },
  ];

  // ── Render readouts evenly across the bar ───────────────────────────────
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const segmentW = w / readouts.length;
  const centerY = y + h / 2;

  for (let i = 0; i < readouts.length; i++) {
    const readout = readouts[i]!;
    const centerX = x + segmentW * i + segmentW / 2;

    // Muted uppercase label above the value.
    ctx.fillStyle = 'rgba(148, 163, 184, 0.95)';
    ctx.font = LABEL_FONT;
    ctx.fillText(readout.label.toUpperCase(), centerX, centerY - 10);

    // Bright value below the label.
    ctx.fillStyle = '#f8fafc';
    ctx.font = VALUE_FONT;
    ctx.fillText(readout.value, centerX, centerY + 10);
  }

  ctx.restore();
}
