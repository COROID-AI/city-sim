/**
 * Camera — pan/zoom viewport over the city world.
 *
 * The camera is the single source of truth for what the main view (and later
 * the minimap) shows. It tracks a center point in world pixel coordinates and
 * a zoom factor, and converts between world and screen coordinates. Panning
 * is driven by WASD/arrow keys and by mouse drag; zooming by the mouse wheel,
 * keeping the world point under the cursor fixed.
 *
 * The camera's x/y/zoom state is public and drives both the main view and the
 * minimap viewport rectangle.
 */

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export class Camera {
  /**
   * @param {object} [opts]
   * @param {number} [opts.viewportWidth]  Viewport width in CSS pixels.
   * @param {number} [opts.viewportHeight] Viewport height in CSS pixels.
   * @param {number} [opts.x] World-space center x (px).
   * @param {number} [opts.y] World-space center y (px).
   * @param {number} [opts.zoom] Initial zoom (1 = 100%).
   * @param {number} [opts.minZoom]
   * @param {number} [opts.maxZoom]
   * @param {number} [opts.panSpeed] World px/sec keyboard pan speed at zoom 1.
   */
  constructor(opts = {}) {
    this.viewportWidth = opts.viewportWidth ?? 800;
    this.viewportHeight = opts.viewportHeight ?? 600;
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.zoom = opts.zoom ?? 1;
    this.minZoom = opts.minZoom ?? 0.2;
    this.maxZoom = opts.maxZoom ?? 5;
    this.panSpeed = opts.panSpeed ?? 600;

    this._keys = new Set();
    this._dragging = false;
    this._dragStart = null;
  }

  /** Viewport size in world pixels at the current zoom. */
  get viewWorldW() {
    return this.viewportWidth / this.zoom;
  }

  get viewWorldH() {
    return this.viewportHeight / this.zoom;
  }

  /** World-space rectangle currently visible (for minimap + entity culling). */
  viewport() {
    return {
      x: this.x - this.viewWorldW / 2,
      y: this.y - this.viewWorldH / 2,
      width: this.viewWorldW,
      height: this.viewWorldH,
    };
  }

  /** Map a world-space point to screen (CSS px) coordinates. */
  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.viewportWidth / 2,
      y: (wy - this.y) * this.zoom + this.viewportHeight / 2,
    };
  }

  /** Map a screen (CSS px) point to world-space coordinates. */
  screenToWorld(sx, sy) {
    return {
      x: (sx - this.viewportWidth / 2) / this.zoom + this.x,
      y: (sy - this.viewportHeight / 2) / this.zoom + this.y,
    };
  }

  /** Pan by a screen-space delta (e.g. drag). */
  panByScreen(dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }

  /** Pan by a world-space delta. */
  panByWorld(dx, dy) {
    this.x += dx;
    this.y += dy;
  }

  /**
   * Zoom by a multiplicative factor, keeping the world point under the given
   * screen coordinate stationary.
   */
  zoomAt(factor, screenX, screenY) {
    const before = this.screenToWorld(screenX, screenY);
    const next = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    if (Math.abs(next - this.zoom) < 1e-6) return;
    this.zoom = next;
    const after = this.screenToWorld(screenX, screenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  /**
   * Keep the viewport inside the world bounds. When the viewport is larger
   * than the world (zoomed far out) the camera centers on the world.
   */
  clampToBounds(worldW, worldH) {
    const vw = this.viewWorldW;
    const vh = this.viewWorldH;
    const minX = vw >= worldW ? worldW / 2 : vw / 2;
    const maxX = vw >= worldW ? worldW / 2 : worldW - vw / 2;
    const minY = vh >= worldH ? worldH / 2 : vh / 2;
    const maxY = vh >= worldH ? worldH / 2 : worldH - vh / 2;
    this.x = clamp(this.x, minX, maxX);
    this.y = clamp(this.y, minY, maxY);
  }

  /** Advance keyboard panning by a real-time delta (seconds). */
  update(dt) {
    let dx = 0;
    let dy = 0;
    if (this._keys.has('a') || this._keys.has('ArrowLeft')) dx -= 1;
    if (this._keys.has('d') || this._keys.has('ArrowRight')) dx += 1;
    if (this._keys.has('w') || this._keys.has('ArrowUp')) dy -= 1;
    if (this._keys.has('s') || this._keys.has('ArrowDown')) dy += 1;
    if (dx || dy) {
      const speed = this.panSpeed / this.zoom;
      this.panByWorld(dx * speed * dt, dy * speed * dt);
    }
  }

  /**
   * Attach keyboard (WASD/arrows), mouse drag, and wheel-zoom listeners.
   * @param {object} [win] Optional window-like object (defaults to window).
   */
  bindInput(win) {
    const w = win || window;
    w.addEventListener('keydown', (e) => this._keys.add(e.key));
    w.addEventListener('keyup', (e) => this._keys.delete(e.key));

    w.addEventListener('wheel', (e) => {
      const factor = e.deltaY < 0 ? 0.9 : 1.1;
      this.zoomAt(factor, e.clientX || 0, e.clientY || 0);
    });

    w.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this._dragging = true;
        this._dragStart = { sx: e.clientX, sy: e.clientY, x: this.x, y: this.y };
      }
    });
    w.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._dragging = false;
    });
    w.addEventListener('mousemove', (e) => {
      if (this._dragging && this._dragStart) {
        const dx = (e.clientX - this._dragStart.sx) / this.zoom;
        const dy = (e.clientY - this._dragStart.sy) / this.zoom;
        this.x = this._dragStart.x - dx;
        this.y = this._dragStart.y - dy;
      }
    });
  }
}