/**
 * Panable camera with world↔screen transforms and input handling.
 *
 * The camera maps between **world coordinates** (grid cells, origin at the
 * top-left of the city) and **screen coordinates** (canvas pixels, origin at
 * the top-left of the viewport).  `zoom` is the number of screen pixels per
 * world unit, so a larger zoom shows more detail.
 *
 *   worldToScreen : world  → screen
 *   screenToWorld : screen → world
 *
 * The two transforms are exact mathematical inverses of one another.
 *
 * Input is consumed by {@link Camera.tick}, which reads a held-key set
 * (Arrow keys / WASD) and a mouse-drag delta (screen pixels) to pan the
 * viewport.  Panning is clamped so the viewport can never leave the world
 * bounds.
 */

import { GRID_WIDTH, GRID_HEIGHT } from '../sim/constants';
import type { Vec2 } from '../sim/types';

// ─── Tunables ────────────────────────────────────────────────────────────────

/** Default zoom level: screen pixels per world unit (cell). */
export const DEFAULT_ZOOM = 32;

/** Keyboard / WASD pan speed in world units per second. */
export const KEYBOARD_PAN_SPEED = 24;

/** Most zoomed-out allowed (pixels per world unit). */
export const MIN_ZOOM = 4;

/** Most zoomed-in allowed (pixels per world unit). */
export const MAX_ZOOM = 128;

/** Default fixed step (ms) used when `tick` is called without a delta. */
export const DEFAULT_TICK_MS = 1000 / 60;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Clamp `value` into the inclusive range `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// ─── Input ───────────────────────────────────────────────────────────────────

/**
 * Input snapshot consumed by {@link Camera.tick}.
 *
 * Callers accumulate this from DOM events and hand it to the camera once per
 * simulation step, then reset the transient fields (mouse deltas).
 */
export interface CameraInput {
  /**
   * Lowercased key names currently held down.
   *
   * Recognised panning keys: `arrowleft`, `arrowright`, `arrowup`,
   * `arrowdown`, `w`, `a`, `s`, `d`.
   */
  readonly keys: ReadonlySet<string>;
  /** Mouse drag delta along X in screen pixels since the last tick. */
  readonly mouseDragX: number;
  /** Mouse drag delta along Y in screen pixels since the last tick. */
  readonly mouseDragY: number;
}

/** An inert input with no keys held and no drag — handy for tests/defaults. */
export const EMPTY_INPUT: CameraInput = {
  keys: new Set<string>(),
  mouseDragX: 0,
  mouseDragY: 0,
};

/** Constructor options for {@link Camera}. */
export interface CameraOptions {
  /** World width in cells (defaults to {@link GRID_WIDTH}). */
  worldWidth?: number;
  /** World height in cells (defaults to {@link GRID_HEIGHT}). */
  worldHeight?: number;
  /** Initial zoom in pixels-per-world-unit (defaults to {@link DEFAULT_ZOOM}). */
  zoom?: number;
  /** Initial viewport width in pixels. */
  viewportWidth?: number;
  /** Initial viewport height in pixels. */
  viewportHeight?: number;
  /** Initial world-space center X. */
  centerX?: number;
  /** Initial world-space center Y. */
  centerY?: number;
}

// ─── Camera ──────────────────────────────────────────────────────────────────

/**
 * A 2D panable camera.
 *
 * Viewport state is fully exposed as public fields so the renderer and
 * minimap can read it directly:
 *   - `centerX` / `centerY` — viewport center in world coordinates.
 *   - `zoom`                 — pixels per world unit.
 *   - `viewportWidth` / `viewportHeight` — canvas size in pixels.
 */
export class Camera {
  /** Viewport center X in world coordinates. */
  centerX: number;
  /** Viewport center Y in world coordinates. */
  centerY: number;
  /** Pixels per world unit (higher = more zoomed in). */
  zoom: number;
  /** Viewport width in pixels. */
  viewportWidth: number;
  /** Viewport height in pixels. */
  viewportHeight: number;

  /** World width in cells (immutable). */
  readonly worldWidth: number;
  /** World height in cells (immutable). */
  readonly worldHeight: number;

  constructor(options: CameraOptions = {}) {
    this.worldWidth = options.worldWidth ?? GRID_WIDTH;
    this.worldHeight = options.worldHeight ?? GRID_HEIGHT;
    this.zoom = clamp(options.zoom ?? DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM);
    this.viewportWidth = options.viewportWidth ?? 0;
    this.viewportHeight = options.viewportHeight ?? 0;

    this.centerX = options.centerX ?? this.worldWidth / 2;
    this.centerY = options.centerY ?? this.worldHeight / 2;
    // Clamp the supplied/derived center to valid bounds.
    this.centerX = this.clampX(this.centerX);
    this.centerY = this.clampY(this.centerY);
  }

  // ─── Visible extents ──────────────────────────────────────────────────────

  /** Number of world units visible across the viewport width. */
  get visibleWidth(): number {
    return this.zoom > 0 ? this.viewportWidth / this.zoom : 0;
  }

  /** Number of world units visible across the viewport height. */
  get visibleHeight(): number {
    return this.zoom > 0 ? this.viewportHeight / this.zoom : 0;
  }

  // ─── Transforms ───────────────────────────────────────────────────────────

  /**
   * Convert a world-space point to screen-space pixels.
   *
   * The world center maps to the viewport center.
   */
  worldToScreen(x: number, y: number): Vec2 {
    return {
      x: (x - this.centerX) * this.zoom + this.viewportWidth / 2,
      y: (y - this.centerY) * this.zoom + this.viewportHeight / 2,
    };
  }

  /**
   * Convert a screen-space pixel point to world coordinates.
   *
   * This is the exact inverse of {@link worldToScreen}.
   */
  screenToWorld(px: number, py: number): Vec2 {
    return {
      x: (px - this.viewportWidth / 2) / this.zoom + this.centerX,
      y: (py - this.viewportHeight / 2) / this.zoom + this.centerY,
    };
  }

  /**
   * Apply this camera's world→screen transform to a 2D canvas context.
   *
   * After calling, drawing in world coordinates lands in the correct screen
   * position.  Always wrap in `ctx.save()` / `ctx.restore()`.
   */
  applyTransform(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.viewportWidth / 2, this.viewportHeight / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.centerX, -this.centerY);
  }

  // ─── Movement ─────────────────────────────────────────────────────────────

  /**
   * Move the viewport center by `(dx, dy)` world units, clamped so the
   * viewport never leaves the world bounds.
   */
  panBy(dx: number, dy: number): void {
    this.setCenter(this.centerX + dx, this.centerY + dy);
  }

  /**
   * Set the viewport center, clamped so the viewport never leaves the world
   * bounds.  When the viewport is larger than the world (extreme zoom-out),
   * the world is centered instead.
   */
  setCenter(x: number, y: number): void {
    this.centerX = this.clampX(x);
    this.centerY = this.clampY(y);
  }

  /** Set the zoom (pixels per world unit), clamped to `[MIN_ZOOM, MAX_ZOOM]`. */
  setZoom(z: number): void {
    this.zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
  }

  /**
   * Update the canvas size.  Re-clamps the center in case the new viewport
   * shrinks the valid range.
   */
  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.centerX = this.clampX(this.centerX);
    this.centerY = this.clampY(this.centerY);
  }

  // ─── Per-step input ───────────────────────────────────────────────────────

  /**
   * Advance the camera by one step, consuming keyboard and mouse input.
   *
   * Held Arrow keys / WASD pan at {@link KEYBOARD_PAN_SPEED} world units per
   * second (scaled by `dtMs`).  Mouse drag deltas are in screen pixels and
   * move the camera in the *opposite* direction of the drag, so the world
   * appears to follow the cursor — standard “grab and drag” panning.
   *
   * @param input Input snapshot for this step.
   * @param dtMs  Elapsed milliseconds since the last tick (default ~60 Hz).
   */
  tick(input: CameraInput, dtMs: number = DEFAULT_TICK_MS): void {
    const dtSec = dtMs / 1000;
    const dist = KEYBOARD_PAN_SPEED * dtSec;

    let dx = 0;
    let dy = 0;

    const keys = input.keys;
    if (keys.has('arrowleft') || keys.has('a')) dx -= dist;
    if (keys.has('arrowright') || keys.has('d')) dx += dist;
    if (keys.has('arrowup') || keys.has('w')) dy -= dist;
    if (keys.has('arrowdown') || keys.has('s')) dy += dist;

    // Drag: screen-pixel delta → world delta (invert so the world follows).
    dx -= input.mouseDragX / this.zoom;
    dy -= input.mouseDragY / this.zoom;

    if (dx !== 0 || dy !== 0) {
      this.panBy(dx, dy);
    }
  }

  // ─── Clamping ─────────────────────────────────────────────────────────────

  /** Clamp a world-X center so the viewport stays within `[0, worldWidth]`. */
  private clampX(x: number): number {
    const half = this.visibleWidth / 2;
    // Viewport wider than the world: centre the world.
    if (this.visibleWidth >= this.worldWidth) {
      return this.worldWidth / 2;
    }
    return clamp(x, half, this.worldWidth - half);
  }

  /** Clamp a world-Y center so the viewport stays within `[0, worldHeight]`. */
  private clampY(y: number): number {
    const half = this.visibleHeight / 2;
    if (this.visibleHeight >= this.worldHeight) {
      return this.worldHeight / 2;
    }
    return clamp(y, half, this.worldHeight - half);
  }
}
