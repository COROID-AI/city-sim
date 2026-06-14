import type { CameraState, Vector2, WorldBounds } from './types';

/** Default zoom bounds. */
export const DEFAULT_MIN_ZOOM = 0.25;
export const DEFAULT_MAX_ZOOM = 4;

/** Pan/zoom smoothing rate. Higher = snappier. */
export const DEFAULT_SMOOTHING_RATE = 12;

/** Cap on `dt` consumed per update to avoid huge jumps after tab refocus. */
export const MAX_DT = 0.25;

/**
 * 2D camera with smoothly-damped pan and zoom that is clamped to the world
 * bounds. The camera itself is framework-agnostic; the renderer is
 * responsible for applying the resulting transform to its canvas.
 */
export class Camera {
  readonly minZoom: number;
  readonly maxZoom: number;
  /** Exponential smoothing rate; larger = faster convergence. */
  readonly smoothingRate: number;

  position: Vector2 = { x: 0, y: 0 };
  zoom = 1;
  readonly targetPosition: Vector2 = { x: 0, y: 0 };
  targetZoom = 1;
  viewport: { width: number; height: number } = { width: 0, height: 0 };

  private worldBounds: WorldBounds;

  constructor(
    worldBounds: WorldBounds,
    options: {
      minZoom?: number;
      maxZoom?: number;
      smoothingRate?: number;
    } = {},
  ) {
    this.worldBounds = { ...worldBounds };
    const minZoom = options.minZoom ?? DEFAULT_MIN_ZOOM;
    const maxZoom = options.maxZoom ?? DEFAULT_MAX_ZOOM;
    if (!(minZoom > 0) || !(maxZoom >= minZoom)) {
      throw new RangeError('Camera zoom bounds invalid');
    }
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.smoothingRate = options.smoothingRate ?? DEFAULT_SMOOTHING_RATE;
  }

  /**
   * Set the camera viewport (in CSS pixels). Re-clamps the current position
   * so the viewport stays inside the world. The target is left untouched so
   * that incremental pan deltas (which add to the target) behave intuitively.
   */
  setViewport(width: number, height: number): void {
    if (!(width >= 0) || !(height >= 0)) {
      throw new RangeError('Camera viewport must be non-negative');
    }
    this.viewport = { width, height };
    this.clampPositionToWorld();
  }

  /**
   * Set the world bounds used for clamping. The camera re-clamps its current
   * position immediately so it never lies outside the new world.
   */
  /**
   * Set the world bounds used for clamping. The camera re-clamps its current
   * position immediately so it never lies outside the new world. The target
   * is left untouched for the same reason as setViewport().
   */
  setWorldBounds(bounds: WorldBounds): void {
    if (!Number.isInteger(bounds.width) || bounds.width <= 0) {
      throw new RangeError('Camera world bounds width must be a positive integer');
    }
    if (!Number.isInteger(bounds.height) || bounds.height <= 0) {
      throw new RangeError('Camera world bounds height must be a positive integer');
    }
    this.worldBounds = { width: bounds.width, height: bounds.height };
    this.clampPositionToWorld();
  }

  /** Read-only view of the camera's state for snapshotting. */
  getState(): CameraState {
    return {
      position: { x: this.position.x, y: this.position.y },
      targetPosition: { x: this.targetPosition.x, y: this.targetPosition.y },
      zoom: this.zoom,
      targetZoom: this.targetZoom,
      viewport: { ...this.viewport },
    };
  }

  /** Replace the camera state wholesale (e.g. from save data). */
  setState(state: Partial<CameraState>): void {
    if (state.position) this.position = { ...state.position };
    if (state.targetPosition) {
      this.targetPosition.x = state.targetPosition.x;
      this.targetPosition.y = state.targetPosition.y;
    }
    if (typeof state.zoom === 'number') this.zoom = state.zoom;
    if (typeof state.targetZoom === 'number') this.targetZoom = state.targetZoom;
    if (state.viewport) this.viewport = { ...state.viewport };
    this.zoom = this.clampZoom(this.zoom);
    this.targetZoom = this.clampZoom(this.targetZoom);
    this.clampToWorld();
  }

  /**
   * Test-only / advanced: force the target position to lie inside the world
   * bounds without touching the current position. panTo() already does this
   * implicitly because it sets the target absolutely.
   */
  clampTargetToWorldBounds(): void {
    this.clampTargetToWorld();
  }

  /* ---------------------------------------------------------------------- */
  /* Input                                                                  */
  /* ---------------------------------------------------------------------- */

  panBy(dx: number, dy: number): void {
    // panBy intentionally does NOT clamp the target. This allows incremental
    // input (e.g. drag deltas, keyboard arrows) to accumulate naturally;
    // the target is only clamped when it is set absolutely via panTo() or
    // when the current position is re-clamped by update() / setWorldBounds().
    this.targetPosition.x += dx;
    this.targetPosition.y += dy;
  }

  panTo(x: number, y: number): void {
    this.targetPosition.x = x;
    this.targetPosition.y = y;
    this.clampToWorld();
  }

  setZoom(z: number): void {
    this.targetZoom = this.clampZoom(z);
  }

  zoomBy(delta: number): void {
    this.setZoom(this.targetZoom * (1 + delta));
  }

  /* ---------------------------------------------------------------------- */
  /* Simulation                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Damp the camera toward its target using frame-rate-independent
   * exponential smoothing. The `dt` argument is capped to `MAX_DT` to avoid
   * huge jumps after long pauses.
   */
  update(dt: number): void {
    const clampedDt = Math.min(Math.max(dt, 0), MAX_DT);
    // factor = 1 - exp(-rate * dt) — the canonical exp-smoothing formula.
    const factor = 1 - Math.exp(-this.smoothingRate * clampedDt);

    this.position.x += (this.targetPosition.x - this.position.x) * factor;
    this.position.y += (this.targetPosition.y - this.position.y) * factor;
    this.zoom += (this.targetZoom - this.zoom) * factor;

    // Snap to target once close enough to avoid endless tiny updates.
    if (Math.abs(this.targetPosition.x - this.position.x) < 1e-4) {
      this.position.x = this.targetPosition.x;
    }
    if (Math.abs(this.targetPosition.y - this.position.y) < 1e-4) {
      this.position.y = this.targetPosition.y;
    }
    if (Math.abs(this.targetZoom - this.zoom) < 1e-4) {
      this.zoom = this.targetZoom;
    }

    this.zoom = this.clampZoom(this.zoom);
    // Do NOT clamp the current position to viewport-aware bounds here.
    // The position is allowed to temporarily sit outside the viewport
    // bounds while it lerps toward a target that was set via panBy().
    // Position is re-clamped at the next viewport / world-bounds change
    // (setViewport / setWorldBounds / setState) and at the next absolute
    // target set (panTo).
  }

  /**
   * Returns the world-space rectangle currently visible. Useful for culling
   * and for debug overlays.
   */
  visibleRect(): { minX: number; minY: number; maxX: number; maxY: number } {
    const halfW = this.viewport.width / 2 / this.zoom;
    const halfH = this.viewport.height / 2 / this.zoom;
    // We assume 1 world unit = 1 CSS pixel at zoom 1; the renderer can
    // override the unit-to-pixel scale with `pixelsPerUnit` if needed.
    return {
      minX: this.position.x - halfW,
      minY: this.position.y - halfH,
      maxX: this.position.x + halfW,
      maxY: this.position.y + halfH,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                              */
  /* ---------------------------------------------------------------------- */

  private clampZoom(z: number): number {
    if (!Number.isFinite(z)) return this.zoom;
    if (z < this.minZoom) return this.minZoom;
    if (z > this.maxZoom) return this.maxZoom;
    return z;
  }

  /**
   * Clamp the current and target pan positions so the viewport stays inside
   * the world. If the viewport is larger than the world, the camera is
   * centred on the world instead. Used by panTo / setWorldBounds / etc.
   */
  private clampToWorld(): void {
    this.clampPositionToWorld();
    this.clampTargetToWorld();
  }

  /** Clamp only the current position. */
  private clampPositionToWorld(): void {
    const { minX, maxX, minY, maxY, worldW, worldH } = this.clampBounds();
    const x = minX > maxX ? worldW / 2 : clamp(this.position.x, minX, maxX);
    const y = minY > maxY ? worldH / 2 : clamp(this.position.y, minY, maxY);
    this.position.x = x;
    this.position.y = y;
  }

  /** Clamp only the target position. */
  private clampTargetToWorld(): void {
    const { minX, maxX, minY, maxY, worldW, worldH } = this.clampBounds();
    const tx = minX > maxX ? worldW / 2 : clamp(this.targetPosition.x, minX, maxX);
    const ty = minY > maxY ? worldH / 2 : clamp(this.targetPosition.y, minY, maxY);
    this.targetPosition.x = tx;
    this.targetPosition.y = ty;
  }

  private clampBounds(): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    worldW: number;
    worldH: number;
  } {
    const halfW = this.viewport.width / 2;
    const halfH = this.viewport.height / 2;
    const worldW = this.worldBounds.width;
    const worldH = this.worldBounds.height;
    return {
      minX: halfW,
      maxX: worldW - halfW,
      minY: halfH,
      maxY: worldH - halfH,
      worldW,
      worldH,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
