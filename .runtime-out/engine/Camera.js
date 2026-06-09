"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Camera = exports.DEFAULT_CAMERA_CONFIG = void 0;
exports.DEFAULT_CAMERA_CONFIG = {
    minZoom: 0.5,
    maxZoom: 4,
    minX: -Infinity,
    maxX: Infinity,
    minY: -Infinity,
    maxY: Infinity,
    smoothing: 12,
    initial: { x: 0, y: 0, zoom: 1 },
};
const clamp = (v, lo, hi) => {
    if (v < lo)
        return lo;
    if (v > hi)
        return hi;
    return v;
};
/**
 * Frame-rate-independent exponential lerp.
 * factor is in "approach rate per second"; alpha = 1 - exp(-factor*dt).
 */
const expLerp = (from, to, factor, dt) => {
    if (factor <= 0)
        return to;
    const alpha = 1 - Math.exp(-factor * dt);
    return from + (to - from) * alpha;
};
class Camera {
    constructor(config = {}) {
        this.config = { ...exports.DEFAULT_CAMERA_CONFIG, ...config };
        const { x, y, zoom } = this.config.initial;
        this.targetX = x;
        this.targetY = y;
        this.targetZoom = zoom;
        this.currentX = x;
        this.currentY = y;
        this.currentZoom = zoom;
    }
    /** Read-only transform snapshot for the current (smoothed) camera state. */
    getTransform() {
        return { x: this.currentX, y: this.currentY, zoom: this.currentZoom };
    }
    /** Target (input) state. Useful for HUD/debug overlays. */
    getTarget() {
        return { x: this.targetX, y: this.targetY, zoom: this.targetZoom };
    }
    /** Pan the camera by a delta in world units. Positive x = east, positive y = south. */
    pan(dx, dy) {
        this.targetX = clamp(this.targetX + dx, this.config.minX, this.config.maxX);
        this.targetY = clamp(this.targetY + dy, this.config.minY, this.config.maxY);
    }
    /** Set the camera focus to an absolute world position. */
    setPosition(x, y) {
        this.targetX = clamp(x, this.config.minX, this.config.maxX);
        this.targetY = clamp(y, this.config.minY, this.config.maxY);
    }
    /**
     * Multiply zoom by a factor around the camera focus point.
     * Keeps the world point under the focus pixel stable.
     */
    zoomBy(factor) {
        this.setZoom(this.targetZoom * factor);
    }
    /** Set zoom to an absolute value (clamped). */
    setZoom(zoom) {
        this.targetZoom = clamp(zoom, this.config.minZoom, this.config.maxZoom);
    }
    /**
     * Zoom while keeping a given screen-relative point (0..1) anchored to the
     * same world location. Useful for cursor-anchored zoom.
     */
    zoomAt(factor, anchorScreenX, anchorScreenY) {
        const oldZoom = this.targetZoom;
        const newZoom = clamp(oldZoom * factor, this.config.minZoom, this.config.maxZoom);
        if (newZoom === oldZoom)
            return;
        // World point currently under the anchor at the old zoom:
        const worldX = this.targetX + (anchorScreenX - 0.5) / oldZoom;
        const worldY = this.targetY + (anchorScreenY - 0.5) / oldZoom;
        this.targetZoom = newZoom;
        // Re-derive focus so that the same world point remains under the anchor.
        this.targetX = clamp(worldX - (anchorScreenX - 0.5) / newZoom, this.config.minX, this.config.maxX);
        this.targetY = clamp(worldY - (anchorScreenY - 0.5) / newZoom, this.config.minY, this.config.maxY);
    }
    /** Advance the smoothed state toward the target. dt is seconds. */
    update(dt) {
        const f = this.config.smoothing;
        this.currentX = expLerp(this.currentX, this.targetX, f, dt);
        this.currentY = expLerp(this.currentY, this.targetY, f, dt);
        this.currentZoom = expLerp(this.currentZoom, this.targetZoom, f, dt);
    }
    /** Snap current state to target (no smoothing). */
    snap() {
        this.currentX = this.targetX;
        this.currentY = this.targetY;
        this.currentZoom = this.targetZoom;
    }
    /**
     * Project a world point to screen-relative coordinates (0..1 range around
     * the center). Provided so downstream renderers can use a stable API.
     */
    worldToScreen(wx, wy) {
        const t = this.getTransform();
        return {
            sx: (wx - t.x) * t.zoom + 0.5,
            sy: (wy - t.y) * t.zoom + 0.5,
        };
    }
}
exports.Camera = Camera;
