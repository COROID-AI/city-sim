/**
 * Camera — top-down pan/zoom/clamp camera for the city viewport (spec §6.3).
 *
 * KEY ARCHITECTURAL DECISIONS (see plan notes):
 *
 * 1. STORES TOP-LEFT WORLD COORD (not center): camera.x/y is the world-space
 *    point at the top-left of the viewport. This matches Renderer's
 *    applyCameraTransform() which does ctx.scale(zoom) then
 *    ctx.translate(-camera.x, -camera.y).
 *    - worldToScreen(wx) = (wx - camera.x) * zoom
 *    - screenToWorld(sx) = sx / zoom + camera.x
 *    These are exact mathematical inverses (round-trip identity).
 *
 * 2. CLAMPING — VISIBLE RECT: The visible world rectangle is
 *    [camera.x, camera.x + viewportW/zoom] × [camera.y, camera.y + viewportH/zoom].
 *    Clamp this to [0, worldW] × [0, worldH]. If the world is smaller than the
 *    viewport/zoom (over-zoom-out), center the world instead of clamping to a
 *    negative range.
 *
 * 3. ZOOM-AT-CURSOR: To keep the world point under the cursor stationary:
 *    - worldPoint = screenToWorld(cursor)  // before zoom
 *    - zoom = clamp(zoom * factor, MIN, MAX)
 *    - camera.x = worldPoint.x - cursorX / zoom
 *    - camera.y = worldPoint.y - cursorY / zoom
 *    - clamp()
 *
 * 4. PAN: Screen drag delta (dx,dy) maps to world delta (-dx/zoom, -dy/zoom).
 *
 * 5. NO SMOOTHING: Per spec §6.3 and Task 7.4, lerp is deferred to Phase 7.
 *    All updates are instantaneous.
 */
import type { CameraTransform } from './Renderer';

/** Minimum zoom factor (zoomed out). */
export const MIN_ZOOM = 0.25;
/** Maximum zoom factor (zoomed in). */
export const MAX_ZOOM = 3.0;

/** Lerp factor per frame for smooth camera motion (spec §6.3, Phase 7). */
export const LERP_FACTOR = 0.1;
/** Snap-to-target threshold: when within this distance, snap exactly. */
const LERP_SNAP_THRESHOLD = 0.01;

export interface CameraOptions {
  /** Initial viewport width in CSS pixels (canvas.clientWidth). */
  viewportWidth?: number;
  /** Initial viewport height in CSS pixels (canvas.clientHeight). */
  viewportHeight?: number;
  /** Initial zoom (clamped to [MIN_ZOOM, MAX_ZOOM]). */
  initialZoom?: number;
}

export class Camera {
  /** World width in world pixels (world.width * TILE_SIZE). */
  readonly worldWidth: number;
  /** World height in world pixels (world.height * TILE_SIZE). */
  readonly worldHeight: number;

  /** Top-left world-space X of the viewport. */
  x: number;
  /** Top-left world-space Y of the viewport. */
  y: number;
  /** Current zoom factor. */
  zoom: number;

  /** Target X for smooth lerp (spec §6.3 Phase 7). */
  targetX: number;
  /** Target Y for smooth lerp (spec §6.3 Phase 7). */
  targetY: number;
  /** Target zoom for smooth lerp (spec §6.3 Phase 7). */
  targetZoom: number;

  private viewportWidth: number;
  private viewportHeight: number;

  constructor(
    worldWidth: number,
    worldHeight: number,
    options: CameraOptions = {},
  ) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.viewportWidth = options.viewportWidth ?? 0;
    this.viewportHeight = options.viewportHeight ?? 0;
    this.zoom = clampZoom(options.initialZoom ?? 1);
    this.x = 0;
    this.y = 0;
    this.targetX = this.x;
    this.targetY = this.y;
    this.targetZoom = this.zoom;
    this.clamp();
  }

  /**
   * Convert a world-space point to screen-space (CSS pixels).
   * Inverse of screenToWorld. Matches Renderer's scale-then-translate order.
   */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: (worldX - this.x) * this.zoom,
      y: (worldY - this.y) * this.zoom,
    };
  }

  /**
   * Convert a screen-space point (CSS pixels) to world-space.
   * Inverse of worldToScreen.
   */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: screenX / this.zoom + this.x,
      y: screenY / this.zoom + this.y,
    };
  }

  /**
   * Pan the camera by a screen-space delta (dx, dy) in CSS pixels.
   * Dragging right (dx>0) reveals content to the left, so camera.x decreases.
   *
   * BACKWARD COMPATIBLE: mutates x/y/zoom directly (instant). Tests rely on
   * this instant behavior. The smooth (lerped) path uses panTarget().
   */
  pan(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.targetX = this.x;
    this.targetY = this.y;
    this.clamp();
  }

  /**
   * Pan the camera TARGET by a screen-space delta (dx, dy) in CSS pixels.
   * The actual x/y move toward targetX/targetY via update() lerp each frame.
   */
  panTarget(dx: number, dy: number): void {
    this.targetX -= dx / this.targetZoom;
    this.targetY -= dy / this.targetZoom;
    this.clampTarget();
  }

  /**
   * Zoom by a multiplicative factor while keeping the world point under the
   * given screen-space cursor stationary. Zoom is clamped to [MIN_ZOOM, MAX_ZOOM].
   *
   * @param factor  Multiplicative zoom factor (>1 zooms in, <1 zooms out).
   * @param cursorX Screen-space X to keep anchored (CSS pixels).
   * @param cursorY Screen-space Y to keep anchored (CSS pixels).
   */
  zoomAt(factor: number, cursorX: number, cursorY: number): void {
    // World point currently under the cursor (before zoom).
    const worldBefore = this.screenToWorld(cursorX, cursorY);
    this.zoom = clampZoom(this.zoom * factor);
    // Reposition so the same world point stays under the cursor.
    this.x = worldBefore.x - cursorX / this.zoom;
    this.y = worldBefore.y - cursorY / this.zoom;
    this.targetX = this.x;
    this.targetY = this.y;
    this.targetZoom = this.zoom;
    this.clamp();
  }

  /**
   * Zoom the camera TARGET by a multiplicative factor, keeping the world point
   * under the cursor stationary in target space. The actual zoom lerps via
   * update() each frame.
   */
  zoomTargetAt(factor: number, cursorX: number, cursorY: number): void {
    // World point under cursor computed from TARGET state (before zoom).
    const worldBeforeX = cursorX / this.targetZoom + this.targetX;
    const worldBeforeY = cursorY / this.targetZoom + this.targetY;
    this.targetZoom = clampZoom(this.targetZoom * factor);
    this.targetX = worldBeforeX - cursorX / this.targetZoom;
    this.targetY = worldBeforeY - cursorY / this.targetZoom;
    this.clampTarget();
  }

  /**
   * Set the zoom directly (clamped), keeping the world point under the given
   * screen-space cursor stationary.
   */
  setZoom(newZoom: number, cursorX: number, cursorY: number): void {
    const worldBefore = this.screenToWorld(cursorX, cursorY);
    this.zoom = clampZoom(newZoom);
    this.x = worldBefore.x - cursorX / this.zoom;
    this.y = worldBefore.y - cursorY / this.zoom;
    this.targetX = this.x;
    this.targetY = this.y;
    this.targetZoom = this.zoom;
    this.clamp();
  }

  /**
   * Set the camera TARGET zoom directly (clamped), keeping the world point
   * under the cursor stationary in target space. Lerps via update().
   */
  setZoomTarget(newZoom: number, cursorX: number, cursorY: number): void {
    const worldBeforeX = cursorX / this.targetZoom + this.targetX;
    const worldBeforeY = cursorY / this.targetZoom + this.targetY;
    this.targetZoom = clampZoom(newZoom);
    this.targetX = worldBeforeX - cursorX / this.targetZoom;
    this.targetY = worldBeforeY - cursorY / this.targetZoom;
    this.clampTarget();
  }

  /**
   * Clamp the camera position so the visible viewport rectangle never extends
   * beyond [0, worldWidth] × [0, worldHeight]. When the world is smaller than
   * the viewport/zoom (over-zoom-out), the world is centered instead.
   */
  clamp(): void {
    const visibleW = this.viewportWidth / this.zoom;
    const visibleH = this.viewportHeight / this.zoom;

    // X axis.
    if (visibleW >= this.worldWidth) {
      // Over-zoom-out: center the world horizontally.
      this.x = (this.worldWidth - visibleW) / 2;
    } else {
      const maxX = this.worldWidth - visibleW;
      this.x = Math.max(0, Math.min(this.x, maxX));
    }

    // Y axis.
    if (visibleH >= this.worldHeight) {
      this.y = (this.worldHeight - visibleH) / 2;
    } else {
      const maxY = this.worldHeight - visibleH;
      this.y = Math.max(0, Math.min(this.y, maxY));
    }
  }

  /** Update the viewport size (call on canvas resize). Re-clamps to bounds. */
  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.clamp();
    this.clampTarget();
  }

  /**
   * Per-frame smooth update: lerp x/y/zoom toward targetX/targetY/targetZoom
   * at LERP_FACTOR (0.1) per frame (spec §6.3 Phase 7). Call once per render
   * frame. When within LERP_SNAP_THRESHOLD, snaps exactly to the target to
   * avoid infinite micro-creep.
   */
  update(): void {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dz = this.targetZoom - this.zoom;

    if (Math.abs(dx) < LERP_SNAP_THRESHOLD &&
        Math.abs(dy) < LERP_SNAP_THRESHOLD &&
        Math.abs(dz) < LERP_SNAP_THRESHOLD) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.zoom = this.targetZoom;
      return;
    }

    this.x += dx * LERP_FACTOR;
    this.y += dy * LERP_FACTOR;
    this.zoom += dz * LERP_FACTOR;
    this.clamp();
  }

  /** Snap x/y/zoom instantly to their targets (no lerp). */
  snapToTarget(): void {
    this.x = this.targetX;
    this.y = this.targetY;
    this.zoom = this.targetZoom;
    this.clamp();
  }

  /**
   * Clamp the TARGET position so the target visible viewport rectangle never
   * extends beyond world bounds. Mirrors clamp() but for target fields.
   */
  clampTarget(): void {
    const visibleW = this.viewportWidth / this.targetZoom;
    const visibleH = this.viewportHeight / this.targetZoom;

    if (visibleW >= this.worldWidth) {
      this.targetX = (this.worldWidth - visibleW) / 2;
    } else {
      const maxX = this.worldWidth - visibleW;
      this.targetX = Math.max(0, Math.min(this.targetX, maxX));
    }

    if (visibleH >= this.worldHeight) {
      this.targetY = (this.worldHeight - visibleH) / 2;
    } else {
      const maxY = this.worldHeight - visibleH;
      this.targetY = Math.max(0, Math.min(this.targetY, maxY));
    }
  }

  /**
   * Return the transform compatible with Renderer.setCamera() and Renderer's
   * applyCameraTransform order (scale then translate).
   */
  getTransform(): CameraTransform {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }
}

/** Clamp a zoom value to the allowed [MIN_ZOOM, MAX_ZOOM] range. */
function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(value, MAX_ZOOM));
}
