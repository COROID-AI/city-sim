/**
 * Camera — pan + zoom with smooth lerp and clamps.
 *
 * World units: integer cell coordinates (1 cell = 1 world unit).
 * The camera is a pure data object with two states:
 *   - target: where the user wants the camera to be (updated via input)
 *   - current: the smoothed, rendered position (interpolated each frame)
 *
 * Consumers read `getTransform()` to get a stable, deterministic snapshot of
 * the current camera state. Input methods (pan, zoom) mutate `target`.
 * Smoothing is applied by `update(dt)` (called once per frame).
 *
 * Units:
 *   - pan: { x, y } in world units
 *   - zoom: scalar multiplier (1 = native, >1 = zoomed in, <1 = zoomed out)
 */

export interface CameraTransform {
  /** Current world-space x of the camera focus point. */
  x: number;
  /** Current world-space y of the camera focus point. */
  y: number;
  /** Current zoom level. */
  zoom: number;
}

export interface CameraConfig {
  /** Minimum allowed zoom. */
  minZoom: number;
  /** Maximum allowed zoom. */
  maxZoom: number;
  /** Minimum allowed pan x (world units). */
  minX: number;
  /** Maximum allowed pan x (world units). */
  maxX: number;
  /** Minimum allowed pan y (world units). */
  minY: number;
  /** Maximum allowed pan y (world units). */
  maxY: number;
  /** Smoothing factor (per second) used by lerp. Higher = snappier. */
  smoothing: number;
  /** Initial camera position. */
  initial: CameraTransform;
}

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  minZoom: 0.5,
  maxZoom: 4,
  minX: -Infinity,
  maxX: Infinity,
  minY: -Infinity,
  maxY: Infinity,
  smoothing: 12,
  initial: { x: 0, y: 0, zoom: 1 },
};

const clamp = (v: number, lo: number, hi: number): number => {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
};

/**
 * Frame-rate-independent exponential lerp.
 * factor is in "approach rate per second"; alpha = 1 - exp(-factor*dt).
 */
const expLerp = (from: number, to: number, factor: number, dt: number): number => {
  if (factor <= 0) return to;
  const alpha = 1 - Math.exp(-factor * dt);
  return from + (to - from) * alpha;
};

export class Camera {
  private readonly config: CameraConfig;
  private targetX: number;
  private targetY: number;
  private targetZoom: number;
  private currentX: number;
  private currentY: number;
  private currentZoom: number;

  constructor(config: Partial<CameraConfig> = {}) {
    this.config = { ...DEFAULT_CAMERA_CONFIG, ...config };
    const { x, y, zoom } = this.config.initial;
    this.targetX = x;
    this.targetY = y;
    this.targetZoom = zoom;
    this.currentX = x;
    this.currentY = y;
    this.currentZoom = zoom;
  }

  /** Read-only transform snapshot for the current (smoothed) camera state. */
  getTransform(): CameraTransform {
    return { x: this.currentX, y: this.currentY, zoom: this.currentZoom };
  }

  /** Target (input) state. Useful for HUD/debug overlays. */
  getTarget(): CameraTransform {
    return { x: this.targetX, y: this.targetY, zoom: this.targetZoom };
  }

  /** Pan the camera by a delta in world units. Positive x = east, positive y = south. */
  pan(dx: number, dy: number): void {
    this.targetX = clamp(this.targetX + dx, this.config.minX, this.config.maxX);
    this.targetY = clamp(this.targetY + dy, this.config.minY, this.config.maxY);
  }

  /** Set the camera focus to an absolute world position. */
  setPosition(x: number, y: number): void {
    this.targetX = clamp(x, this.config.minX, this.config.maxX);
    this.targetY = clamp(y, this.config.minY, this.config.maxY);
  }

  /**
   * Multiply zoom by a factor around the camera focus point.
   * Keeps the world point under the focus pixel stable.
   */
  zoomBy(factor: number): void {
    this.setZoom(this.targetZoom * factor);
  }

  /** Set zoom to an absolute value (clamped). */
  setZoom(zoom: number): void {
    this.targetZoom = clamp(zoom, this.config.minZoom, this.config.maxZoom);
  }

  /**
   * Zoom while keeping a given screen-relative point (0..1) anchored to the
   * same world location. Useful for cursor-anchored zoom.
   */
  zoomAt(factor: number, anchorScreenX: number, anchorScreenY: number): void {
    const oldZoom = this.targetZoom;
    const newZoom = clamp(oldZoom * factor, this.config.minZoom, this.config.maxZoom);
    if (newZoom === oldZoom) return;

    // World point currently under the anchor at the old zoom:
    const worldX = this.targetX + (anchorScreenX - 0.5) / oldZoom;
    const worldY = this.targetY + (anchorScreenY - 0.5) / oldZoom;

    this.targetZoom = newZoom;

    // Re-derive focus so that the same world point remains under the anchor.
    this.targetX = clamp(
      worldX - (anchorScreenX - 0.5) / newZoom,
      this.config.minX,
      this.config.maxX,
    );
    this.targetY = clamp(
      worldY - (anchorScreenY - 0.5) / newZoom,
      this.config.minY,
      this.config.maxY,
    );
  }

  /** Advance the smoothed state toward the target. dt is seconds. */
  update(dt: number): void {
    const f = this.config.smoothing;
    this.currentX = expLerp(this.currentX, this.targetX, f, dt);
    this.currentY = expLerp(this.currentY, this.targetY, f, dt);
    this.currentZoom = expLerp(this.currentZoom, this.targetZoom, f, dt);
  }

  /** Snap current state to target (no smoothing). */
  snap(): void {
    this.currentX = this.targetX;
    this.currentY = this.targetY;
    this.currentZoom = this.targetZoom;
  }

  /**
   * Project a world point to screen-relative coordinates (0..1 range around
   * the center). Provided so downstream renderers can use a stable API.
   */
  worldToScreen(wx: number, wy: number): { sx: number; sy: number } {
    const t = this.getTransform();
    return {
      sx: (wx - t.x) * t.zoom + 0.5,
      sy: (wy - t.y) * t.zoom + 0.5,
    };
  }
}
