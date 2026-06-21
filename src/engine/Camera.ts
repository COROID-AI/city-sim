import type { CameraTransform } from './Renderer';

/**
 * Screen pixels per tile at zoom 1.0.
 *
 * Spec: "1 tile = 16 screen pixels". Camera operates in screen-pixel space;
 * Renderer's cellSize is independent and will be reconciled downstream.
 */
export const TILE_SIZE = 16;

/** Minimum zoom level (zoomed out). */
export const MIN_ZOOM = 0.25;

/** Maximum zoom level (zoomed in). */
export const MAX_ZOOM = 3.0;

/** Default zoom level. */
export const DEFAULT_ZOOM = 1.0;

/** Lerp interpolation factor per update() call. Spec mandates 0.1. */
export const LERP_FACTOR = 0.1;

/**
 * Camera options for construction.
 */
export interface CameraOptions {
  /** Viewport width in screen pixels. */
  viewportWidth: number;
  /** Viewport height in screen pixels. */
  viewportHeight: number;
  /** World width in tiles. */
  worldWidth: number;
  /** World height in tiles. */
  worldHeight: number;
}

/**
 * Top-down 2D camera with pan, zoom, smooth lerp, and boundary clamping.
 *
 * State model: `target` (where user wants camera to be) is separate from
 * `current` (rendered position). Each `update()` call lerps `current` toward
 * `target` with factor 0.1, decoupling input from render for smooth motion.
 *
 * Event handling: `attach(canvas)` wires pointerdown/move/up + wheel;
 * `detach()` removes them. Camera is also testable via direct `panBy`/
 * `zoomAt` calls without DOM.
 *
 * Boundary clamping: When zoomed out so the world fits inside the viewport,
 * the world is centered. When zoomed in, viewport edges are clamped so they
 * never expose void beyond the world boundary.
 */
export class Camera {
  // --- Target state (user intent) ---
  private targetX = 0;
  private targetY = 0;
  private targetZoom = DEFAULT_ZOOM;

  // --- Current state (rendered, lerped toward target) ---
  private currentX = 0;
  private currentY = 0;
  private currentZoom = DEFAULT_ZOOM;

  // --- Viewport & world dimensions ---
  private viewportWidth: number;
  private viewportHeight: number;
  private worldPixelWidth: number;
  private worldPixelHeight: number;

  // --- Drag state ---
  private dragging = false;
  private dragStartScreenX = 0;
  private dragStartScreenY = 0;
  private dragStartTargetX = 0;
  private dragStartTargetY = 0;

  // --- Event handler references (for detach) ---
  private boundPointerDown: ((e: PointerEvent) => void) | null = null;
  private boundPointerMove: ((e: PointerEvent) => void) | null = null;
  private boundPointerUp: ((e: PointerEvent) => void) | null = null;
  private boundWheel: ((e: WheelEvent) => void) | null = null;
  private attachedCanvas: HTMLCanvasElement | null = null;

  constructor(options: CameraOptions) {
    if (options.viewportWidth <= 0 || !Number.isFinite(options.viewportWidth)) {
      throw new Error('viewportWidth must be a positive finite number');
    }
    if (options.viewportHeight <= 0 || !Number.isFinite(options.viewportHeight)) {
      throw new Error('viewportHeight must be a positive finite number');
    }
    if (!Number.isInteger(options.worldWidth) || options.worldWidth <= 0) {
      throw new Error('worldWidth must be a positive integer');
    }
    if (!Number.isInteger(options.worldHeight) || options.worldHeight <= 0) {
      throw new Error('worldHeight must be a positive integer');
    }

    this.viewportWidth = options.viewportWidth;
    this.viewportHeight = options.viewportHeight;
    this.worldPixelWidth = options.worldWidth * TILE_SIZE;
    this.worldPixelHeight = options.worldHeight * TILE_SIZE;

    // Center the world in the viewport initially, then clamp so the
    // camera never starts in an invalid position (e.g. when world is
    // larger than viewport, clamp to the nearest valid edge).
    this.targetX = this.computeCenterX(DEFAULT_ZOOM);
    this.targetY = this.computeCenterY(DEFAULT_ZOOM);
    this.clampTarget();
    this.currentX = this.targetX;
    this.currentY = this.targetY;
  }

  // ---------------------------------------------------------------------------
  // Public API — direct manipulation (testable without DOM)
  // ---------------------------------------------------------------------------

  /**
   * Pan the camera by the given screen-pixel delta.
   *
   * The target position is adjusted and then clamped to world boundaries.
   */
  panBy(dx: number, dy: number): void {
    this.targetX -= dx;
    this.targetY -= dy;
    this.clampTarget();
  }

  /**
   * Zoom at a specific screen-pixel anchor point.
   *
   * Converts the anchor to world coordinates, applies the zoom delta, then
   * adjusts the camera position so the world point under the cursor stays
   * fixed. Formula: worldX = (screenX - camX) / camZoom;
   * after zoom: camX = screenX - worldX * newZoom.
   */
  zoomAt(screenX: number, screenY: number, delta: number): void {
    const oldZoom = this.targetZoom;
    const newZoom = this.clampZoom(oldZoom + delta);
    if (newZoom === oldZoom) return;

    // World coords under cursor before zoom.
    const worldX = (screenX - this.targetX) / oldZoom;
    const worldY = (screenY - this.targetY) / oldZoom;

    this.targetZoom = newZoom;

    // Adjust position so the same world point stays under cursor.
    this.targetX = screenX - worldX * newZoom;
    this.targetY = screenY - worldY * newZoom;

    this.clampTarget();
  }

  /**
   * Update the current (rendered) state by lerping toward the target.
   *
   * Call once per frame. Lerp factor is 0.1 as mandated by spec.
   */
  update(): void {
    this.currentX += (this.targetX - this.currentX) * LERP_FACTOR;
    this.currentY += (this.targetY - this.currentY) * LERP_FACTOR;
    this.currentZoom += (this.targetZoom - this.currentZoom) * LERP_FACTOR;
  }

  // ---------------------------------------------------------------------------
  // Public API — matrix / transform output
  // ---------------------------------------------------------------------------

  /**
   * Returns the current camera transform matching Renderer's CameraTransform.
   */
  getTransform(): CameraTransform {
    return { x: this.currentX, y: this.currentY, zoom: this.currentZoom };
  }

  /**
   * Returns the current translation as [tx, ty].
   */
  getTranslateMatrix(): [number, number] {
    return [this.currentX, this.currentY];
  }

  /**
   * Returns the current scale as [zoom, zoom].
   */
  getScaleMatrix(): [number, number] {
    return [this.currentZoom, this.currentZoom];
  }

  // ---------------------------------------------------------------------------
  // Public API — DOM event attachment
  // ---------------------------------------------------------------------------

  /**
   * Attach pointer and wheel event listeners to a canvas element.
   *
   * The canvas overlay div in page.tsx has `pointer-events-none`, so canvas
   * events pass through unimpeded.
   */
  attach(canvas: HTMLCanvasElement): void {
    if (this.attachedCanvas !== null) {
      this.detach();
    }

    this.attachedCanvas = canvas;

    this.boundPointerDown = (e: PointerEvent): void => {
      this.dragging = true;
      this.dragStartScreenX = e.clientX;
      this.dragStartScreenY = e.clientY;
      this.dragStartTargetX = this.targetX;
      this.dragStartTargetY = this.targetY;
    };

    this.boundPointerMove = (e: PointerEvent): void => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragStartScreenX;
      const dy = e.clientY - this.dragStartScreenY;
      this.targetX = this.dragStartTargetX - dx;
      this.targetY = this.dragStartTargetY - dy;
      this.clampTarget();
    };

    this.boundPointerUp = (): void => {
      this.dragging = false;
    };

    this.boundWheel = (e: WheelEvent): void => {
      e.preventDefault();
      // Normalize wheel delta: positive deltaY = zoom out, negative = zoom in.
      // Scale factor tuned for smooth zooming.
      const zoomDelta = -e.deltaY * 0.001;
      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      this.zoomAt(screenX, screenY, zoomDelta);
    };

    canvas.addEventListener('pointerdown', this.boundPointerDown);
    canvas.addEventListener('pointermove', this.boundPointerMove);
    canvas.addEventListener('pointerup', this.boundPointerUp);
    canvas.addEventListener('pointercancel', this.boundPointerUp);
    canvas.addEventListener('wheel', this.boundWheel, { passive: false });
  }

  /**
   * Detach all event listeners from the previously attached canvas.
   */
  detach(): void {
    if (this.attachedCanvas === null) return;

    const canvas = this.attachedCanvas;

    if (this.boundPointerDown !== null) canvas.removeEventListener('pointerdown', this.boundPointerDown);
    if (this.boundPointerMove !== null) canvas.removeEventListener('pointermove', this.boundPointerMove);
    if (this.boundPointerUp !== null) {
      canvas.removeEventListener('pointerup', this.boundPointerUp);
      canvas.removeEventListener('pointercancel', this.boundPointerUp);
    }
    if (this.boundWheel !== null) canvas.removeEventListener('wheel', this.boundWheel);

    this.attachedCanvas = null;
    this.boundPointerDown = null;
    this.boundPointerMove = null;
    this.boundPointerUp = null;
    this.boundWheel = null;
    this.dragging = false;
  }

  // ---------------------------------------------------------------------------
  // Public getters for testing
  // ---------------------------------------------------------------------------

  /** Current rendered X position. */
  get x(): number {
    return this.currentX;
  }

  /** Current rendered Y position. */
  get y(): number {
    return this.currentY;
  }

  /** Current rendered zoom level. */
  get zoom(): number {
    return this.currentZoom;
  }

  /** Target X position. */
  get targetXPos(): number {
    return this.targetX;
  }

  /** Target Y position. */
  get targetYPos(): number {
    return this.targetY;
  }

  /** Target zoom level. */
  get targetZoomLevel(): number {
    return this.targetZoom;
  }

  /** Whether the camera is currently being dragged. */
  get isDragging(): boolean {
    return this.dragging;
  }

  /** Viewport width. */
  get viewWidth(): number {
    return this.viewportWidth;
  }

  /** Viewport height. */
  get viewHeight(): number {
    return this.viewportHeight;
  }

  /**
   * Update viewport dimensions (e.g. on window resize).
   */
  setViewportSize(width: number, height: number): void {
    if (width <= 0 || !Number.isFinite(width)) {
      throw new Error('width must be a positive finite number');
    }
    if (height <= 0 || !Number.isFinite(height)) {
      throw new Error('height must be a positive finite number');
    }
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.clampTarget();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Clamp zoom to [MIN_ZOOM, MAX_ZOOM]. */
  private clampZoom(z: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  }

  /**
   * Clamp target position so the viewport never shows void beyond the world.
   *
   * For each axis:
   * - If viewport >= world * zoom (world fits inside viewport), center the world.
   * - Otherwise, clamp so viewport edges stay within world edges.
   */
  private clampTarget(): void {
    const zoom = this.targetZoom;

    // X axis
    const visibleWorldWidth = this.worldPixelWidth * zoom;
    if (this.viewportWidth >= visibleWorldWidth) {
      // World fits inside viewport — center it.
      this.targetX = this.computeCenterX(zoom);
    } else {
      const minX = this.viewportWidth - visibleWorldWidth;
      const maxX = 0;
      this.targetX = Math.min(maxX, Math.max(minX, this.targetX));
    }

    // Y axis
    const visibleWorldHeight = this.worldPixelHeight * zoom;
    if (this.viewportHeight >= visibleWorldHeight) {
      // World fits inside viewport — center it.
      this.targetY = this.computeCenterY(zoom);
    } else {
      const minY = this.viewportHeight - visibleWorldHeight;
      const maxY = 0;
      this.targetY = Math.min(maxY, Math.max(minY, this.targetY));
    }
  }

  /** Compute the X position that centers the world in the viewport. */
  private computeCenterX(zoom: number): number {
    return (this.viewportWidth - this.worldPixelWidth * zoom) / 2;
  }

  /** Compute the Y position that centers the world in the viewport. */
  private computeCenterY(zoom: number): number {
    return (this.viewportHeight - this.worldPixelHeight * zoom) / 2;
  }
}
