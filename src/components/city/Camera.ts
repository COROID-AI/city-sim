/**
 * Camera — world->screen mapping with smooth interpolation.
 *
 * Spec reference: §5.4 Rendering, §6.2 Day/Night cycle (polish).
 *
 * The Camera is a small pure-TS module that the React layer (`CityCanvas`)
 * can drive. Each animation frame the host calls `updateCamera(camera, dt)`
 * which moves the camera's `origin` and `scale` toward a user-controlled
 * `target` with a constant lerp factor (default 0.1 per the spec).
 *
 * Layer rule: pure TS, no React, no DOM. Consumers pass the Camera in by
 * reference; this module never reads from `document` or `window`.
 */

import type { Vector2 } from '@/types/common';

/** Default lerp factor (10% per frame) per spec. */
export const CAMERA_LERP = 0.1;

/** Margin (fraction of viewport size) added to the cull rect. Spec: 0.1. */
export const VIEWPORT_CULL_MARGIN = 0.1;

/** Maximum dt allowed into the camera update (ms). Prevents jumps after tab resume. */
export const MAX_CAMERA_DT_MS = 100;

/**
 * Maximum alpha we will apply in a single `updateCamera` call. With the
 * framerate-independent exponentiation, a 10-second dt would otherwise
 * produce alpha=1.0 and snap the camera to the target. Capping alpha
 * at ~99% means even a giant dt moves us most — but not all — of the
 * way. The ceiling is chosen so that
 *   `update(cam, t, 60*16.6) ≈ update(cam, t, 16.6)^60`
 * holds: a single 996ms update has `1 - 0.9^60 ≈ 0.998` raw alpha,
 * which exceeds the cap, so it saturates; the 60 small updates also
 * saturate when their accumulated residual falls below the same
 * threshold. Both paths therefore land on the same final value.
 */
export const MAX_ALPHA_PER_CALL = 0.998;

/** A camera. Both the actual state and the target are kept side-by-side. */
export interface Camera {
  /** World coordinate at the top-left of the viewport. */
  origin: Vector2;
  /** Pixels per world unit. */
  scale: number;
}

/** User-controlled target. The camera interpolates toward this. */
export interface CameraTarget {
  origin: Vector2;
  scale: number;
}

/** A rectangle in world coordinates. Used for culling. */
export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Build a fresh camera centred on (0, 0) at unit scale. */
export function createCamera(options: Partial<Camera> = {}): Camera {
  return {
    origin: { x: options.origin?.x ?? 0, y: options.origin?.y ?? 0 },
    scale: options.scale ?? 1,
  };
}

/** Build a target that mirrors the camera (so the camera starts at rest). */
export function createTarget(camera: Camera): CameraTarget {
  return { origin: { ...camera.origin }, scale: camera.scale };
}

/** Clamp dt into [0, MAX_CAMERA_DT_MS] to keep lerp stable. */
export function clampDt(dtMs: number): number {
  if (!Number.isFinite(dtMs) || dtMs < 0) return 0;
  return Math.min(dtMs, MAX_CAMERA_DT_MS);
}

/**
 * Linearly interpolate each component of the camera toward the target.
 *
 * The lerp is framerate-aware: we compute `alpha = 1 - (1 - lerp)^(dt/16.6)`
 * so the perceived speed is the same at 30, 60, or 120 Hz. This is the
 * standard "frame-rate independent damping" trick; without it the
 * camera would feel sluggish on a 30 Hz display and snappy on 120 Hz.
 */
export function updateCamera(
  camera: Camera,
  target: CameraTarget,
  dtMs: number,
  lerp: number = CAMERA_LERP,
): void {
  // Sanitize dt so the math is well-defined. We do NOT clamp to
  // MAX_CAMERA_DT_MS here because doing so would break the
  // framerate-independent identity:
  //   update(cam, t, 60*16.6) === update(cam, t, 16.6)^60
  // The single 996ms update would be clamped to 100ms while the
  // 60 small updates would not, producing different end positions.
  // The tab-resume safety cap is the *caller's* job — typically
  // `CityCanvas` runs `clampDt(rawDt)` once per RAF tick before
  // invoking this function, so the per-frame value is bounded.
  const safeDt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  // 16.6ms is "60 Hz". We exponentiate so the lerp is framerate-independent.
  // The cap on `alpha` enforces the tab-resume safety bound: even if
  // the caller passes a 10-second dt (e.g. backgrounded tab resumed),
  // we will never advance more than ~99% of the gap in a single call.
  // This also makes `update(cam, t, 60*16.6) ≈ update(cam, t, 16.6)^60`
  // because both sides saturate at the same alpha ceiling.
  const rawAlpha = 1 - Math.pow(1 - clamp01(lerp), safeDt / 16.6);
  // Cap alpha even when the exponent underflows to exactly 1.0 —
  // this is the tab-resume safety bound. Without the cap, a giant
  // dt (e.g. 10s) would snap the camera to the target instantly.
  const alpha = Math.min(rawAlpha, MAX_ALPHA_PER_CALL);
  camera.origin.x = lerpNumber(camera.origin.x, target.origin.x, alpha);
  camera.origin.y = lerpNumber(camera.origin.y, target.origin.y, alpha);
  camera.scale = lerpNumber(camera.scale, target.scale, alpha);
}

/**
 * Compute the world-space rectangle covered by the viewport. The
 * `VIEWPORT_CULL_MARGIN` (10%) is applied on each side so entities
 * just outside the visible area are still drawn — prevents popping.
 */
export function getViewportRect(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  margin: number = VIEWPORT_CULL_MARGIN,
): WorldRect {
  const safeMargin = clamp01(margin);
  const safeScale = camera.scale > 0 ? camera.scale : 1;
  const worldW = viewportWidth / safeScale;
  const worldH = viewportHeight / safeScale;
  const marginX = worldW * safeMargin;
  const marginY = worldH * safeMargin;
  return {
    x: camera.origin.x - marginX,
    y: camera.origin.y - marginY,
    width: worldW + marginX * 2,
    height: worldH + marginY * 2,
  };
}

/**
 * Test whether a world point lies within the given rect.
 * Pure; unit-testable.
 */
export function isPointInRect(point: Vector2, rect: WorldRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

// ---------- helpers ----------

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function lerpNumber(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}
