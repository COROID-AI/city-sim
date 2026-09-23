/**
 * Chrono City — navigation movement math and input state.
 *
 * This module is pure: no DOM, no Three.js, no `SceneContext`. It owns the
 * numeric navigation state (orbit yaw/pitch/distance, walk position/velocity,
 * eye height, joystick axes) and resolves that state into one camera pose per
 * frame. `NavigationRig` (see `navigationRig.ts`) owns the shared camera, the
 * DOM listeners and the `SceneContext` tick registration, and delegates every
 * number to this controller.
 *
 * Conventions — every value is metres/radians in the shared world frame
 * (`+X` east, `+Z` south, `+Y` up), matching `src/core/blockLayout.ts`:
 *
 *   * `yaw`   — heading the camera looks along. `0` looks north (`-Z`), so a
 *               rightward pointer drag *decreases* yaw. Yaw is unbounded; the
 *               shortest-path helper keeps damping stable across the wrap.
 *   * `pitch` — look elevation. Positive looks up, negative looks down.
 *   * forward = `(-sin(yaw)·cos(pitch), sin(pitch), -cos(yaw)·cos(pitch))`,
 *               the same forward vector a Three.js `PerspectiveCamera` has
 *               after `lookAt(target)` with a `+Y` up vector.
 *   * orbit   — the camera sits at `target - forward · distance`, so one yaw /
 *               pitch pair describes both modes and mode switches keep the view
 *               direction continuous.
 *
 * Damping is exponential — `1 - exp(-lambda · dt)` — which is frame-rate
 * independent: converging input reaches the same pose whether the app runs at
 * 30, 60 or 144 fps; only the easing granularity differs.
 *
 * Lifecycle:
 *   create    → `new MovementController({ bounds })`.
 *   consume   → `setKey` / `addLook` / `addZoom` / `setJoystick` / `setMode`.
 *   integrate → `NavigationRig` calls `update(delta)` once per tick and writes
 *               the returned pose onto the shared camera.
 */

export const MOVEMENT_CONTROLLER_VERSION = 1;

/** The two navigation modes the rig supports. */
export type NavigationMode = 'orbit' | 'walk';

/** Semantic movement intents the controller tracks (layout, not key codes). */
export type NavigationIntent = 'forward' | 'back' | 'left' | 'right' | 'run';

/** A ground-plane point (metres). */
export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

/** A world-space point (metres). */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Axis-aligned walkable rectangle in the shared world frame (metres). */
export interface NavigationBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** One resolved camera pose: everything a consumer needs to frame the block. */
export interface NavigationPose {
  /** Camera position in metres. */
  readonly position: Vec3;
  /**
   * Point the camera looks at. In orbit mode this is the orbit pivot; in walk
   * mode it sits one metre ahead along the look direction, so `lookAt(target)`
   * reproduces the view exactly in both modes.
   */
  readonly target: Vec3;
  /** Smoothing-state heading in radians (`0` looks north / `-Z`). */
  readonly yaw: number;
  /** Smoothing-state elevation in radians (positive looks up). */
  readonly pitch: number;
  /** Orbit zoom radius in metres (preserved while walking, so zoom survives). */
  readonly distance: number;
  /** Camera height in metres: eye height while walking, camera Y while orbiting. */
  readonly eyeHeight: number;
  /** `true` while movement input or residual velocity is still moving the rig. */
  readonly moving: boolean;
}

export interface MovementControllerOptions {
  /** Initial mode. Defaults to `'orbit'`. */
  mode?: NavigationMode;
  /** Walkable rectangle; callers pass the BlockLayout-derived bounds. Required. */
  bounds: NavigationBounds;
  /** Orbit pivot. Defaults to the world origin. */
  orbitTarget?: Vec3;
  /** Initial orbit heading. Defaults to `0` (camera south of the pivot). */
  orbitYaw?: number;
  /** Initial look elevation. Defaults to `DEFAULT_ORBIT_PITCH` in orbit mode. */
  orbitPitch?: number;
  /** Initial zoom radius. Defaults to `DEFAULT_ORBIT_DISTANCE`. */
  orbitDistance?: number;
  /** Closest zoom (metres). Defaults to `DEFAULT_MIN_DISTANCE`. */
  minDistance?: number;
  /** Farthest zoom (metres). Defaults to `DEFAULT_MAX_DISTANCE`. */
  maxDistance?: number;
  /** Steepest orbit elevation. Defaults to `DEFAULT_MIN_ORBIT_PITCH`. */
  minOrbitPitch?: number;
  /** Shallowest orbit elevation. Defaults to `DEFAULT_MAX_ORBIT_PITCH`. */
  maxOrbitPitch?: number;
  /** Steepest walk elevation. Defaults to `DEFAULT_MIN_WALK_PITCH`. */
  minWalkPitch?: number;
  /** Shallowest walk elevation. Defaults to `DEFAULT_MAX_WALK_PITCH`. */
  maxWalkPitch?: number;
  /** Lowest legal eye height. Defaults to `DEFAULT_MIN_EYE_HEIGHT` (1.6 m). */
  minEyeHeight?: number;
  /** Highest legal eye height. Defaults to `DEFAULT_MAX_EYE_HEIGHT` (1.8 m). */
  maxEyeHeight?: number;
  /** Resting eye height. Defaults to `DEFAULT_EYE_HEIGHT` (1.7 m). */
  eyeHeight?: number;
  /** Walking speed in m/s. Defaults to `DEFAULT_WALK_SPEED`. */
  walkSpeed?: number;
  /** Shift modifier multiplier. Defaults to `DEFAULT_RUN_MULTIPLIER`. */
  runMultiplier?: number;
  /** Radians of look per pointer pixel. Defaults to `DEFAULT_LOOK_SENSITIVITY`. */
  lookSensitivity?: number;
  /** Zoom metres per wheel pixel. Defaults to `DEFAULT_ZOOM_SENSITIVITY`. */
  zoomSensitivity?: number;
  /** Damping strength for orbit yaw/pitch/distance. Defaults to `DEFAULT_ORBIT_DAMPING`. */
  orbitDamping?: number;
  /** Damping strength for walk look. Defaults to `DEFAULT_LOOK_DAMPING`. */
  lookDamping?: number;
  /** Damping strength for walk velocity. Defaults to `DEFAULT_MOVE_DAMPING`. */
  moveDamping?: number;
  /** Head-bob amplitude in metres. Defaults to `DEFAULT_HEAD_BOB`. */
  headBob?: number;
  /** Head-bob frequency in Hz. Defaults to `DEFAULT_BOB_FREQUENCY`. */
  bobFrequency?: number;
  /** Lowest camera height the orbit camera may reach. Defaults to `DEFAULT_ORBIT_GROUND_HEIGHT`. */
  groundHeight?: number;
  /** Largest integrated step in seconds. Defaults to `DEFAULT_MAX_FRAME_DELTA`. */
  maxFrameDelta?: number;
  /** Initial walk position. Defaults to the world origin, clamped to `bounds`. */
  walkPosition?: Vec2;
  /** Initial walk heading. Defaults to `orbitYaw`. */
  walkYaw?: number;
}

/** Default orbit radius: the whole 102 x 72 m cell fits comfortably. */
export const DEFAULT_ORBIT_DISTANCE = 96;
/** Default closest zoom. */
export const DEFAULT_MIN_DISTANCE = 18;
/** Default farthest zoom. */
export const DEFAULT_MAX_DISTANCE = 240;
/** Default orbit heading (`0` looks north from the south side of the block). */
export const DEFAULT_ORBIT_YAW = 0;
/** Default orbit elevation: roughly a 31° bird's-eye view of the block. */
export const DEFAULT_ORBIT_PITCH = -0.55;
/** Default orbit pivot height in metres: mid-block, above street clutter. */
export const DEFAULT_ORBIT_TARGET_HEIGHT = 6;
/** Default walk look elevation: level with the horizon. */
export const DEFAULT_WALK_PITCH = 0;
/** Steepest orbit elevation (about -75°). */
export const DEFAULT_MIN_ORBIT_PITCH = -1.31;
/** Shallowest orbit elevation (about -7°), keeping the camera clear of the ground. */
export const DEFAULT_MAX_ORBIT_PITCH = -0.12;
/** Steepest walk elevation (looking almost straight down). */
export const DEFAULT_MIN_WALK_PITCH = -1.2;
/** Shallowest walk elevation (looking almost straight up). */
export const DEFAULT_MAX_WALK_PITCH = 1.2;
/** Lowest legal eye height in metres. */
export const DEFAULT_MIN_EYE_HEIGHT = 1.6;
/** Highest legal eye height in metres. */
export const DEFAULT_MAX_EYE_HEIGHT = 1.8;
/** Resting eye height in metres. */
export const DEFAULT_EYE_HEIGHT = 1.7;
/** Brisk walking speed in m/s. */
export const DEFAULT_WALK_SPEED = 6.5;
/** Shift modifier multiplier: a light jog. */
export const DEFAULT_RUN_MULTIPLIER = 1.9;
/** Look sensitivity in radians per pointer pixel. */
export const DEFAULT_LOOK_SENSITIVITY = 0.0032;
/** Zoom metres per wheel pixel. */
export const DEFAULT_ZOOM_SENSITIVITY = 0.12;
/** Orbit damping strength (larger settles faster). */
export const DEFAULT_ORBIT_DAMPING = 9;
/** Walk-look damping strength. */
export const DEFAULT_LOOK_DAMPING = 14;
/** Walk-velocity damping strength. */
export const DEFAULT_MOVE_DAMPING = 12;
/** Head-bob amplitude in metres, kept inside the 1.6-1.8 m eye band. */
export const DEFAULT_HEAD_BOB = 0.045;
/** Head-bob frequency in Hz at full walking speed. */
export const DEFAULT_BOB_FREQUENCY = 2.1;
/** Lowest orbit camera height in metres; a safety net under the pitch clamp. */
export const DEFAULT_ORBIT_GROUND_HEIGHT = 2;
/** Largest integrated step: keeps a backgrounded tab from teleporting the camera. */
export const DEFAULT_MAX_FRAME_DELTA = 0.1;
/** Look-target distance used to build the walk pose's `target` point. */
export const WALK_TARGET_DISTANCE = 1;
/** Where a walk-mode preview starts looking when entering walk from a steep orbit. */
export const WALK_ENTRY_PITCH_MIN = -0.25;
/** See `WALK_ENTRY_PITCH_MIN`. */
export const WALK_ENTRY_PITCH_MAX = 0.1;

/* ------------------------------------------------------------------------- *
 * Math helpers
 * ------------------------------------------------------------------------- */

/** Clamps `value` into `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Wraps an angle into `(-PI, PI]`. */
export function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = (angle + Math.PI) % twoPi;
  return (wrapped < 0 ? wrapped + twoPi : wrapped) - Math.PI;
}

/**
 * Exponential damping factor for a `delta`-second step.
 * Returns `0` for a zero step and `1` for non-positive damping strengths.
 */
export function dampFactor(lambda: number, delta: number): number {
  if (!(delta > 0)) return 0;
  if (!(lambda > 0)) return 1;
  return 1 - Math.exp(-lambda * delta);
}

/** Frame-rate independent exponential approach from `current` towards `target`. */
export function damp(current: number, target: number, lambda: number, delta: number): number {
  return current + (target - current) * dampFactor(lambda, delta);
}

/** Angle-aware `damp`: eases along the shortest path around the circle. */
export function dampAngle(current: number, target: number, lambda: number, delta: number): number {
  return current + wrapAngle(target - current) * dampFactor(lambda, delta);
}

/** Unit look direction for a yaw/pitch pair. */
export function forwardVector(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  };
}

/** Unit strafe axis (camera right) for a heading, always horizontal. */
export function rightVector(yaw: number): Vec3 {
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
}

/** Nearest point inside `bounds`. */
export function clampToBounds(point: Vec2, bounds: NavigationBounds): Vec2 {
  return {
    x: clamp(point.x, bounds.minX, bounds.maxX),
    z: clamp(point.z, bounds.minZ, bounds.maxZ),
  };
}

/** `true` when the ground point lies inside `bounds` (edges included). */
export function isInsideBounds(point: Vec2, bounds: NavigationBounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.z >= bounds.minZ &&
    point.z <= bounds.maxZ
  );
}

/** Distance between two world points. */
export function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/* ------------------------------------------------------------------------- *
 * Key bindings
 * ------------------------------------------------------------------------- */

/** Physical key codes → movement intents. */
const KEY_INTENTS: Readonly<Record<string, NavigationIntent>> = Object.freeze({
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'run',
  ShiftRight: 'run',
});

interface MutableVec2 {
  x: number;
  z: number;
}

interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

interface ResolvedOptions {
  bounds: NavigationBounds;
  orbitTarget: MutableVec3;
  minDistance: number;
  maxDistance: number;
  minOrbitPitch: number;
  maxOrbitPitch: number;
  minWalkPitch: number;
  maxWalkPitch: number;
  minEyeHeight: number;
  maxEyeHeight: number;
  eyeHeight: number;
  walkSpeed: number;
  runMultiplier: number;
  lookSensitivity: number;
  zoomSensitivity: number;
  orbitDamping: number;
  lookDamping: number;
  moveDamping: number;
  headBob: number;
  bobFrequency: number;
  groundHeight: number;
  maxFrameDelta: number;
}

/** Options accepted by `setMode()`. */
export interface SetModeOptions {
  /** Walk spawn override; clamped to the walkable bounds. */
  walkPosition?: Vec2;
  /** Walk heading override. */
  walkYaw?: number;
  /** Orbit pivot override. */
  orbitTarget?: Vec3;
}

function resolveOptions(options: MovementControllerOptions): ResolvedOptions {
  const bounds = options.bounds;
  const minEyeHeight = options.minEyeHeight ?? DEFAULT_MIN_EYE_HEIGHT;
  const maxEyeHeight = options.maxEyeHeight ?? DEFAULT_MAX_EYE_HEIGHT;
  const minDistance = options.minDistance ?? DEFAULT_MIN_DISTANCE;
  const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;
  const target = options.orbitTarget ?? { x: 0, y: 0, z: 0 };

  return {
    bounds: {
      minX: Math.min(bounds.minX, bounds.maxX),
      maxX: Math.max(bounds.minX, bounds.maxX),
      minZ: Math.min(bounds.minZ, bounds.maxZ),
      maxZ: Math.max(bounds.minZ, bounds.maxZ),
    },
    orbitTarget: { x: target.x, y: target.y, z: target.z },
    minDistance: Math.min(minDistance, maxDistance),
    maxDistance: Math.max(minDistance, maxDistance),
    minOrbitPitch: options.minOrbitPitch ?? DEFAULT_MIN_ORBIT_PITCH,
    maxOrbitPitch: options.maxOrbitPitch ?? DEFAULT_MAX_ORBIT_PITCH,
    minWalkPitch: options.minWalkPitch ?? DEFAULT_MIN_WALK_PITCH,
    maxWalkPitch: options.maxWalkPitch ?? DEFAULT_MAX_WALK_PITCH,
    minEyeHeight: Math.min(minEyeHeight, maxEyeHeight),
    maxEyeHeight: Math.max(minEyeHeight, maxEyeHeight),
    eyeHeight: clamp(options.eyeHeight ?? DEFAULT_EYE_HEIGHT, minEyeHeight, maxEyeHeight),
    walkSpeed: Math.max(0, options.walkSpeed ?? DEFAULT_WALK_SPEED),
    runMultiplier: Math.max(1, options.runMultiplier ?? DEFAULT_RUN_MULTIPLIER),
    lookSensitivity: Math.max(0, options.lookSensitivity ?? DEFAULT_LOOK_SENSITIVITY),
    zoomSensitivity: Math.max(0, options.zoomSensitivity ?? DEFAULT_ZOOM_SENSITIVITY),
    orbitDamping: Math.max(0, options.orbitDamping ?? DEFAULT_ORBIT_DAMPING),
    lookDamping: Math.max(0, options.lookDamping ?? DEFAULT_LOOK_DAMPING),
    moveDamping: Math.max(0, options.moveDamping ?? DEFAULT_MOVE_DAMPING),
    headBob: Math.max(0, options.headBob ?? DEFAULT_HEAD_BOB),
    bobFrequency: Math.max(0, options.bobFrequency ?? DEFAULT_BOB_FREQUENCY),
    groundHeight: options.groundHeight ?? DEFAULT_ORBIT_GROUND_HEIGHT,
    maxFrameDelta: Math.max(0, options.maxFrameDelta ?? DEFAULT_MAX_FRAME_DELTA),
  };
}

/**
 * Owns the damped navigation state. Feed it input (`setKey`, `addLook`,
 * `addZoom`, `setJoystick`) and call `update(delta)` once per frame; it returns
 * the pose the camera should adopt.
 */
export class MovementController {
  readonly version = MOVEMENT_CONTROLLER_VERSION;

  private readonly options: ResolvedOptions;
  private modeState: NavigationMode;

  /** Desired (input-driven) orbit state. */
  private desiredYaw: number;
  private desiredPitch: number;
  private desiredDistance: number;
  /** Damped orbit state actually used to place the camera. */
  private yaw: number;
  private pitch: number;
  private distance: number;

  private walkPosition: MutableVec2;
  /** Configured walk spawn, reused on the first switch into walk mode. */
  private readonly spawnPosition: MutableVec2 | null;
  private velocity: MutableVec2 = { x: 0, z: 0 };
  private eyeHeightState: number;
  private bobPhase = 0;

  private readonly intents = new Set<NavigationIntent>();
  private joystickAxis: MutableVec2 = { x: 0, z: 0 };
  private lookDelta: MutableVec2 = { x: 0, z: 0 };
  private zoomDelta = 0;
  private lockedState = false;
  private movingState = false;
  private frameIndex = 0;
  private pose: NavigationPose;

  constructor(options: MovementControllerOptions) {
    this.options = resolveOptions(options);
    this.modeState = options.mode ?? 'orbit';

    const initialYaw = options.walkYaw ?? options.orbitYaw ?? DEFAULT_ORBIT_YAW;
    this.desiredYaw = initialYaw;
    this.yaw = initialYaw;

    const limits = this.pitchLimits(this.modeState);
    const initialPitch =
      options.orbitPitch ?? (this.modeState === 'walk' ? DEFAULT_WALK_PITCH : DEFAULT_ORBIT_PITCH);
    this.desiredPitch = clamp(initialPitch, limits.min, limits.max);
    this.pitch = this.desiredPitch;

    const requestedDistance = Math.abs(options.orbitDistance ?? DEFAULT_ORBIT_DISTANCE);
    this.desiredDistance = clamp(
      requestedDistance > 0 ? requestedDistance : DEFAULT_ORBIT_DISTANCE,
      this.options.minDistance,
      this.options.maxDistance,
    );
    this.distance = this.desiredDistance;

    this.spawnPosition = options.walkPosition
      ? clampToBounds(options.walkPosition, this.options.bounds)
      : null;
    this.walkPosition = this.spawnPosition ?? clampToBounds({ x: 0, z: 0 }, this.options.bounds);
    this.eyeHeightState = this.options.eyeHeight;
    this.pose = this.resolvePose();
  }

  /* ---------------- read-only state ---------------- */

  get mode(): NavigationMode {
    return this.modeState;
  }

  get bounds(): NavigationBounds {
    return this.options.bounds;
  }

  /** Smoothed navigation parameters (orbit frame of reference). */
  get orbit(): { readonly yaw: number; readonly pitch: number; readonly distance: number } {
    return { yaw: this.yaw, pitch: this.pitch, distance: this.distance };
  }

  /** Desired (target) navigation parameters the damping eases towards. */
  get desired(): { readonly yaw: number; readonly pitch: number; readonly distance: number } {
    return { yaw: this.desiredYaw, pitch: this.desiredPitch, distance: this.desiredDistance };
  }

  /** Most recently resolved pose. */
  get currentPose(): NavigationPose {
    return this.pose;
  }

  /** Ground position of the walker (metres). */
  get position2(): Vec2 {
    return { x: this.walkPosition.x, z: this.walkPosition.z };
  }

  /** Current eye height in metres (walk mode). */
  get eyeHeight(): number {
    return this.eyeHeightState;
  }

  /** `true` while the rig is moving or residual velocity is still decaying. */
  get moving(): boolean {
    return this.movingState;
  }

  /** `true` while a pointer lock request is held. */
  get pointerLocked(): boolean {
    return this.lockedState;
  }

  /** Number of integrated frames. */
  get frame(): number {
    return this.frameIndex;
  }

  /** Currently pressed movement intents. */
  get pressed(): ReadonlySet<NavigationIntent> {
    return this.intents;
  }

  /** Current joystick axes: `x` strafe (+ right), `z` forward (+ ahead). */
  get joystick(): Vec2 {
    return { x: this.joystickAxis.x, z: this.joystickAxis.z };
  }

  /* ---------------- input ---------------- */

  /**
   * Applies a physical key code. Unknown codes are ignored and reported with
   * `false` so the rig only swallows keys it actually consumes.
   */
  setKey(code: string, pressed: boolean): boolean {
    const intent = KEY_INTENTS[code];
    if (!intent) return false;
    if (pressed) this.intents.add(intent);
    else this.intents.delete(intent);
    return true;
  }

  /** Clears every held key (window blur, mode switches, teardown). */
  clearKeys(): void {
    this.intents.clear();
  }

  /**
   * Queues a pointer/touch look delta in pixels. Consumed by the next
   * `update()`, so a burst of events between frames is not lost.
   */
  addLook(deltaX: number, deltaY: number): void {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
    this.lookDelta.x += deltaX;
    this.lookDelta.z += deltaY;
  }

  /** Queues a zoom delta: positive scrolls/pinches towards a wider view. */
  addZoom(delta: number): void {
    if (!Number.isFinite(delta)) return;
    this.zoomDelta += delta;
  }

  /** Sets the analog joystick axes; each axis is clamped to `[-1, 1]`. */
  setJoystick(x: number, forward: number): void {
    this.joystickAxis.x = Number.isFinite(x) ? clamp(x, -1, 1) : 0;
    this.joystickAxis.z = Number.isFinite(forward) ? clamp(forward, -1, 1) : 0;
  }

  /** Records pointer-lock ownership so movement deltas are only honoured when locked. */
  setPointerLocked(locked: boolean): void {
    this.lockedState = locked;
  }

  /** Teleports the walker (used by spawns and tests); clamps to bounds. */
  setWalkPosition(position: Vec2): void {
    this.walkPosition = clampToBounds(position, this.options.bounds);
    this.pose = this.resolvePose();
  }

  /** Replaces the orbit pivot. */
  setOrbitTarget(target: Vec3): void {
    this.options.orbitTarget = { x: target.x, y: target.y, z: target.z };
    this.pose = this.resolvePose();
  }

  /* ---------------- mode switching ---------------- */

  /**
   * Switches navigation mode with a continuous hand-off:
   *   * entering walk   → the walker lands inside the block bounds below the
   *                       current camera, keeping the heading but levelling the
   *                       view into the walk pitch band.
   *   * entering orbit  → yaw/pitch/distance are re-derived from the current
   *                       camera position so the view direction is preserved
   *                       and only the zoom is clamped to the orbit limits.
   */
  setMode(mode: NavigationMode, options: SetModeOptions = {}): NavigationPose {
    if (options.orbitTarget) this.setOrbitTarget(options.orbitTarget);

    if (mode !== this.modeState) {
      if (mode === 'walk') this.enterWalk(options);
      else this.enterOrbit();
      this.modeState = mode;
    } else {
      if (options.walkPosition) this.walkPosition = clampToBounds(options.walkPosition, this.options.bounds);
      if (options.walkYaw !== undefined) {
        this.desiredYaw = options.walkYaw;
        this.yaw = options.walkYaw;
      }
    }

    this.pose = this.resolvePose();
    return this.pose;
  }

  private enterWalk(options: SetModeOptions): void {
    const current = this.pose.position;
    const spawn = options.walkPosition ?? this.spawnPosition ?? { x: current.x, z: current.z };
    this.walkPosition = clampToBounds(spawn, this.options.bounds);
    this.velocity = { x: 0, z: 0 };
    this.bobPhase = 0;
    this.eyeHeightState = this.options.eyeHeight;
    if (options.walkYaw !== undefined) this.desiredYaw = options.walkYaw;
    // Keep the heading, level the view so the walk starts near the horizon.
    this.yaw = this.desiredYaw;
    this.desiredPitch = clamp(this.pitch, WALK_ENTRY_PITCH_MIN, WALK_ENTRY_PITCH_MAX);
    this.pitch = this.desiredPitch;
  }

  private enterOrbit(): void {
    const position = this.pose.position;
    const target = this.options.orbitTarget;
    const dx = target.x - position.x;
    const dy = target.y - position.y;
    const dz = target.z - position.z;
    const length = Math.hypot(dx, dy, dz);

    this.desiredDistance = clamp(
      length > 0 ? length : this.options.minDistance,
      this.options.minDistance,
      this.options.maxDistance,
    );
    this.distance = this.desiredDistance;

    if (length > 0) {
      this.desiredYaw = Math.atan2(-dx / length, -dz / length);
      this.desiredPitch = clamp(
        Math.asin(clamp(dy / length, -1, 1)),
        this.options.minOrbitPitch,
        this.options.maxOrbitPitch,
      );
    } else {
      this.desiredPitch = clamp(
        this.options.maxOrbitPitch,
        this.options.minOrbitPitch,
        this.options.maxOrbitPitch,
      );
    }

    this.yaw = this.desiredYaw;
    this.pitch = this.desiredPitch;
  }

  /* ---------------- integration ---------------- */

  /** Integrates one damped step and resolves the pose. */
  update(delta: number): NavigationPose {
    const step = this.resolveDelta(delta);
    this.frameIndex += 1;

    const look = this.lookDelta;
    this.lookDelta = { x: 0, z: 0 };
    const zoom = this.zoomDelta;
    this.zoomDelta = 0;

    if (this.modeState === 'orbit') this.updateOrbit(look, zoom, step);
    else this.updateWalk(look, step);

    this.pose = this.resolvePose();
    return this.pose;
  }

  private updateOrbit(look: MutableVec2, zoom: number, step: number): void {
    const { lookSensitivity, zoomSensitivity } = this.options;

    this.desiredYaw -= look.x * lookSensitivity;
    // Orbiting: dragging up lifts the camera over the block.
    this.desiredPitch += look.z * lookSensitivity;
    this.desiredPitch = clamp(
      this.desiredPitch,
      this.options.minOrbitPitch,
      this.options.maxOrbitPitch,
    );
    this.desiredDistance = clamp(
      this.desiredDistance + zoom * zoomSensitivity,
      this.options.minDistance,
      this.options.maxDistance,
    );

    this.yaw = dampAngle(this.yaw, this.desiredYaw, this.options.orbitDamping, step);
    this.pitch = damp(this.pitch, this.desiredPitch, this.options.orbitDamping, step);
    this.distance = damp(this.distance, this.desiredDistance, this.options.orbitDamping, step);
    this.movingState = false;
  }

  private updateWalk(look: MutableVec2, step: number): void {
    const { lookSensitivity, lookDamping, moveDamping, minEyeHeight, maxEyeHeight } = this.options;

    this.desiredYaw -= look.x * lookSensitivity;
    // First person: dragging up looks up.
    this.desiredPitch -= look.z * lookSensitivity;
    this.desiredPitch = clamp(this.desiredPitch, this.options.minWalkPitch, this.options.maxWalkPitch);
    this.yaw = dampAngle(this.yaw, this.desiredYaw, lookDamping, step);
    this.pitch = damp(this.pitch, this.desiredPitch, lookDamping, step);

    const axes = this.readMovementAxes();
    const wantsToMove = Math.hypot(axes.x, axes.z) > 0.0001;
    const speed =
      this.options.walkSpeed *
      (this.intents.has('run') ? this.options.runMultiplier : 1) *
      Math.min(1, Math.hypot(axes.x, axes.z));

    const heading = forwardVector(this.yaw, 0);
    const right = rightVector(this.yaw);
    const desiredVelocityX = (right.x * axes.x + heading.x * axes.z) * speed;
    const desiredVelocityZ = (right.z * axes.x + heading.z * axes.z) * speed;

    this.velocity.x = damp(this.velocity.x, desiredVelocityX, moveDamping, step);
    this.velocity.z = damp(this.velocity.z, desiredVelocityZ, moveDamping, step);

    this.walkPosition.x += this.velocity.x * step;
    this.walkPosition.z += this.velocity.z * step;
    this.clampWalkPosition();

    const speedRatio = clamp(
      Math.hypot(this.velocity.x, this.velocity.z) / (this.options.walkSpeed || 1),
      0,
      1,
    );
    this.bobPhase =
      (this.bobPhase + step * Math.PI * 2 * this.options.bobFrequency * speedRatio) % (Math.PI * 2);
    const bob = Math.sin(this.bobPhase) * this.options.headBob * speedRatio;
    this.eyeHeightState = clamp(
      this.options.eyeHeight + bob,
      minEyeHeight,
      maxEyeHeight,
    );
    this.movingState = speedRatio > 0.02 || wantsToMove;
  }

  /** Keyboard intents plus the analog joystick, normalised to a unit disc. */
  private readMovementAxes(): MutableVec2 {
    let x = 0;
    let forward = 0;
    if (this.intents.has('right')) x += 1;
    if (this.intents.has('left')) x -= 1;
    if (this.intents.has('forward')) forward += 1;
    if (this.intents.has('back')) forward -= 1;
    x += this.joystickAxis.x;
    forward += this.joystickAxis.z;

    const magnitude = Math.hypot(x, forward);
    if (magnitude > 1) {
      x /= magnitude;
      forward /= magnitude;
    }
    return { x, z: forward };
  }

  /** Block-bounds collision: clamp the walker and stop the velocity into the wall. */
  private clampWalkPosition(): void {
    const { minX, maxX, minZ, maxZ } = this.options.bounds;
    const position = this.walkPosition;

    if (position.x < minX) {
      position.x = minX;
      if (this.velocity.x < 0) this.velocity.x = 0;
    } else if (position.x > maxX) {
      position.x = maxX;
      if (this.velocity.x > 0) this.velocity.x = 0;
    }

    if (position.z < minZ) {
      position.z = minZ;
      if (this.velocity.z < 0) this.velocity.z = 0;
    } else if (position.z > maxZ) {
      position.z = maxZ;
      if (this.velocity.z > 0) this.velocity.z = 0;
    }
  }

  private pitchLimits(mode: NavigationMode): { min: number; max: number } {
    return mode === 'walk'
      ? { min: this.options.minWalkPitch, max: this.options.maxWalkPitch }
      : { min: this.options.minOrbitPitch, max: this.options.maxOrbitPitch };
  }

  private resolveDelta(delta: number): number {
    if (!Number.isFinite(delta) || delta <= 0) return 0;
    return Math.min(delta, this.options.maxFrameDelta);
  }

  /** Builds a fresh pose object the caller owns. */
  private resolvePose(): NavigationPose {
    if (this.modeState === 'walk') {
      const direction = forwardVector(this.yaw, this.pitch);
      const position: MutableVec3 = {
        x: this.walkPosition.x,
        y: this.eyeHeightState,
        z: this.walkPosition.z,
      };
      return {
        position,
        target: {
          x: position.x + direction.x * WALK_TARGET_DISTANCE,
          y: position.y + direction.y * WALK_TARGET_DISTANCE,
          z: position.z + direction.z * WALK_TARGET_DISTANCE,
        },
        yaw: this.yaw,
        pitch: this.pitch,
        distance: this.distance,
        eyeHeight: this.eyeHeightState,
        moving: this.movingState,
      };
    }

    const direction = forwardVector(this.yaw, this.pitch);
    const target = this.options.orbitTarget;
    const position: MutableVec3 = {
      x: target.x - direction.x * this.distance,
      y: Math.max(target.y - direction.y * this.distance, this.options.groundHeight),
      z: target.z - direction.z * this.distance,
    };
    return {
      position,
      target: { x: target.x, y: target.y, z: target.z },
      yaw: this.yaw,
      pitch: this.pitch,
      distance: this.distance,
      eyeHeight: position.y,
      moving: false,
    };
  }
}
