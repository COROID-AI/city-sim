/**
 * Damped orbit camera controls.
 *
 * The input → camera-state maths is intentionally separated from the DOM
 * listeners: `orbit()`, `zoom()`, `pan()`, `flyTo()`, `reset()` and `update()`
 * only touch plain numbers and a target vector, so behaviour (clamps, damping,
 * never dipping below the street) can be asserted headlessly with synthetic
 * input. `attach()` is the only part that knows about pointer events.
 */

import * as THREE from 'three';

export interface OrbitLimits {
  minDistance: number;
  maxDistance: number;
  /** Polar angle (from +Y) limits; both stay below PI/2 so the camera stays up. */
  minPolar: number;
  maxPolar: number;
  minAzimuth: number;
  maxAzimuth: number;
  /** Half-extent of the look-target wander box, in world units. */
  panBoundsX: number;
  panBoundsZ: number;
  minTargetY: number;
  maxTargetY: number;
  /** Camera y must stay above this after damping. */
  groundY: number;
}

export interface OrbitOptions {
  limits: OrbitLimits;
  /** Higher = snappier damping toward the desired pose. */
  damping: number;
  rotateSpeed: number;
  zoomSpeed: number;
  panSpeed: number;
  /** Pixels of drag per unit of key nudge. */
  keyNudge: number;
}

export interface PoseSnapshot {
  azimuth: number;
  polar: number;
  distance: number;
  target: THREE.Vector3;
}

export const DEFAULT_LIMITS: OrbitLimits = {
  minDistance: 26,
  maxDistance: 320,
  // ~8 deg above the horizon and ~83 deg, so the camera is always above ground.
  minPolar: 0.14,
  maxPolar: 1.44,
  minAzimuth: -Math.PI * 2,
  maxAzimuth: Math.PI * 2,
  panBoundsX: 120,
  panBoundsZ: 120,
  minTargetY: 0,
  maxTargetY: 26,
  groundY: 0.6,
};

export const DEFAULT_OPTIONS: OrbitOptions = {
  limits: DEFAULT_LIMITS,
  damping: 7.5,
  rotateSpeed: 0.0052,
  zoomSpeed: 0.0016,
  panSpeed: 0.0022,
  keyNudge: 0.09,
};

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export class OrbitCameraController {
  readonly camera: THREE.PerspectiveCamera;
  readonly options: OrbitOptions;

  /** Applied (damped) pose. */
  private azimuth: number;
  private polar: number;
  private distance: number;
  private readonly target = new THREE.Vector3();

  /** Pose the damping is chasing. */
  private desiredAzimuth: number;
  private desiredPolar: number;
  private desiredDistance: number;
  private readonly desiredTarget = new THREE.Vector3();

  private flight: { from: PoseSnapshot; to: PoseSnapshot; elapsed: number; duration: number } | null = null;

  private readonly overview: PoseSnapshot;

  private element: HTMLElement | null = null;
  private detach: (() => void) | null = null;
  private pointerId: number | null = null;
  private lastPointer = { x: 0, y: 0 };
  private mode: 'orbit' | 'pan' | null = null;
  private readonly tmpVector = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, options: Partial<OrbitOptions> = {}) {
    this.camera = camera;
    this.options = { ...DEFAULT_OPTIONS, ...options, limits: { ...DEFAULT_LIMITS, ...(options.limits ?? {}) } };

    const overview: PoseSnapshot = {
      azimuth: Math.PI * 0.25,
      polar: 0.95,
      distance: 168,
      target: new THREE.Vector3(0, 6, 0),
    };
    this.overview = overview;

    this.azimuth = overview.azimuth;
    this.polar = overview.polar;
    this.distance = overview.distance;
    this.target.copy(overview.target);
    this.desiredAzimuth = overview.azimuth;
    this.desiredPolar = overview.polar;
    this.desiredDistance = overview.distance;
    this.desiredTarget.copy(overview.target);
    this.applyToCamera();
  }

  /* ------------------------------------------------------------ input ---- */

  /** Orbit by pixel deltas (left-drag). */
  orbit(dx: number, dy: number): void {
    const { limits, rotateSpeed } = this.options;
    this.desiredAzimuth = clamp(
      this.desiredAzimuth - dx * rotateSpeed,
      limits.minAzimuth,
      limits.maxAzimuth,
    );
    this.desiredPolar = clamp(this.desiredPolar + dy * rotateSpeed, limits.minPolar, limits.maxPolar);
    this.flight = null;
  }

  /** Zoom by wheel/step amount; positive scrolls out. */
  zoom(step: number): void {
    const { limits, zoomSpeed } = this.options;
    const factor = Math.exp(step * zoomSpeed * 60);
    this.desiredDistance = clamp(this.desiredDistance * factor, limits.minDistance, limits.maxDistance);
  }

  /** Pan the look target in the screen plane (right-drag / shift-drag). */
  pan(dx: number, dy: number): void {
    const { limits, panSpeed } = this.options;
    const scale = panSpeed * (this.desiredDistance / 140) * 60;
    const sin = Math.sin(this.desiredAzimuth);
    const cos = Math.cos(this.desiredAzimuth);
    // Camera right vector in the XZ plane.
    const rightX = cos;
    const rightZ = -sin;
    // Horizontal forward vector (from camera toward target).
    const forwardX = -sin;
    const forwardZ = -cos;
    this.desiredTarget.x = clamp(
      this.desiredTarget.x - rightX * dx * scale + forwardX * dy * scale,
      -limits.panBoundsX,
      limits.panBoundsX,
    );
    this.desiredTarget.z = clamp(
      this.desiredTarget.z - rightZ * dx * scale + forwardZ * dy * scale,
      -limits.panBoundsZ,
      limits.panBoundsZ,
    );
    this.flight = null;
  }

  /** Keyboard nudge: arrow keys orbit, +/- zoom. */
  nudge(axis: 'left' | 'right' | 'up' | 'down' | 'in' | 'out'): void {
    const amount = this.options.keyNudge / this.options.rotateSpeed;
    switch (axis) {
      case 'left':
        this.orbit(-amount, 0);
        break;
      case 'right':
        this.orbit(amount, 0);
        break;
      case 'up':
        this.orbit(0, -amount);
        break;
      case 'down':
        this.orbit(0, amount);
        break;
      case 'in':
        this.desiredDistance = clamp(
          this.desiredDistance * 0.9,
          this.options.limits.minDistance,
          this.options.limits.maxDistance,
        );
        break;
      case 'out':
        this.desiredDistance = clamp(
          this.desiredDistance * 1.1,
          this.options.limits.minDistance,
          this.options.limits.maxDistance,
        );
        break;
    }
  }

  /** Smoothly fly to a world point, framing it from `distance` away. */
  flyTo(
    point: THREE.Vector3,
    options: { distance?: number; duration?: number; polar?: number; azimuth?: number } = {},
  ): void {
    const { limits } = this.options;
    const distance = clamp(options.distance ?? Math.max(limits.minDistance, 22), limits.minDistance, limits.maxDistance);
    const polar = clamp(options.polar ?? 1.2, limits.minPolar, limits.maxPolar);
    const to: PoseSnapshot = {
      azimuth: options.azimuth ?? this.desiredAzimuth,
      polar,
      distance,
      target: new THREE.Vector3(point.x, clamp(point.y, limits.minTargetY, limits.maxTargetY), point.z),
    };
    this.flight = {
      from: this.snapshotDesired(),
      to,
      elapsed: 0,
      duration: Math.max(0.05, options.duration ?? 0.9),
    };
  }

  /** Fly back to the block overview. */
  reset(duration = 0.9): void {
    this.flight = {
      from: this.snapshotDesired(),
      to: {
        azimuth: this.overview.azimuth,
        polar: this.overview.polar,
        distance: this.overview.distance,
        target: this.overview.target.clone(),
      },
      elapsed: 0,
      duration,
    };
  }

  /** True while a fly-to / reset animation is running. */
  get flying(): boolean {
    return this.flight !== null;
  }

  /* ----------------------------------------------------------- update ---- */

  update(dt: number): void {
    const step = Math.min(Math.max(dt, 0), 0.1);

    if (this.flight) {
      this.flight.elapsed += step;
      const t = Math.min(1, this.flight.elapsed / this.flight.duration);
      const e = easeInOutCubic(t);
      const { from, to } = this.flight;
      this.desiredAzimuth = from.azimuth + (to.azimuth - from.azimuth) * e;
      this.desiredPolar = from.polar + (to.polar - from.polar) * e;
      this.desiredDistance = from.distance + (to.distance - from.distance) * e;
      this.desiredTarget.lerpVectors(from.target, to.target, e);
      if (t >= 1) this.flight = null;
    }

    const k = 1 - Math.exp(-this.options.damping * step);
    this.azimuth += (this.desiredAzimuth - this.azimuth) * k;
    this.polar += (this.desiredPolar - this.polar) * k;
    this.distance += (this.desiredDistance - this.distance) * k;
    this.target.lerp(this.desiredTarget, k);

    this.clampApplied();
    this.applyToCamera();
  }

  /* ------------------------------------------------------------ reads ---- */

  /** Current applied pose (damped). */
  getPose(): PoseSnapshot {
    return {
      azimuth: this.azimuth,
      polar: this.polar,
      distance: this.distance,
      target: this.target.clone(),
    };
  }

  /** Pose the controller is heading toward. */
  snapshotDesired(): PoseSnapshot {
    return {
      azimuth: this.desiredAzimuth,
      polar: this.desiredPolar,
      distance: this.desiredDistance,
      target: this.desiredTarget.clone(),
    };
  }

  /** World position for a pose (exposed for tests and the HUD). */
  static positionFor(pose: PoseSnapshot, out = new THREE.Vector3()): THREE.Vector3 {
    const sinPolar = Math.sin(pose.polar);
    out.set(
      pose.target.x + sinPolar * Math.sin(pose.azimuth) * pose.distance,
      pose.target.y + Math.cos(pose.polar) * pose.distance,
      pose.target.z + sinPolar * Math.cos(pose.azimuth) * pose.distance,
    );
    return out;
  }

  /* ------------------------------------------------------------ DOM ------ */

  /** Attach pointer/wheel listeners. Returns a detach function. */
  attach(element: HTMLElement): () => void {
    this.detach?.();
    this.element = element;

    const onPointerDown = (event: PointerEvent): void => {
      if (this.pointerId !== null) return;
      this.pointerId = event.pointerId;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.mode = event.button === 2 || event.shiftKey ? 'pan' : 'orbit';
      element.setPointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (this.pointerId !== event.pointerId || !this.mode) return;
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      if (this.mode === 'pan') this.pan(dx, dy);
      else this.orbit(dx, dy);
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (this.pointerId !== event.pointerId) return;
      this.pointerId = null;
      this.mode = null;
      element.releasePointerCapture?.(event.pointerId);
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      this.zoom(event.deltaY / 100);
    };

    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('contextmenu', onContextMenu);

    const detach = (): void => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('contextmenu', onContextMenu);
      this.element = null;
      this.pointerId = null;
      this.mode = null;
    };
    this.detach = detach;
    return detach;
  }

  /** Detach listeners (idempotent). */
  dispose(): void {
    this.detach?.();
    this.detach = null;
  }

  /** Screen-space pan scale for tests / HUD readouts. */
  get boundElement(): HTMLElement | null {
    return this.element;
  }

  /* ---------------------------------------------------------- private ---- */

  private clampApplied(): void {
    const { limits } = this.options;
    this.polar = clamp(this.polar, limits.minPolar, limits.maxPolar);
    this.distance = clamp(this.distance, limits.minDistance, limits.maxDistance);
    this.target.x = clamp(this.target.x, -limits.panBoundsX, limits.panBoundsX);
    this.target.z = clamp(this.target.z, -limits.panBoundsZ, limits.panBoundsZ);
    this.target.y = clamp(this.target.y, limits.minTargetY, limits.maxTargetY);

    // Never let the camera fall through the street.
    OrbitCameraController.positionFor(this.getPose(), this.tmpVector);
    if (this.tmpVector.y < limits.groundY) {
      const needed = limits.groundY - this.tmpVector.y;
      this.target.y += needed;
      this.desiredTarget.y = clamp(this.desiredTarget.y + needed, limits.minTargetY, limits.maxTargetY);
      this.desiredPolar = Math.min(this.desiredPolar, limits.minPolar + 0.25);
    }
  }

  private applyToCamera(): void {
    OrbitCameraController.positionFor(this.getPose(), this.tmpVector);
    this.camera.position.copy(this.tmpVector);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
