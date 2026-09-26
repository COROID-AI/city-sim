/**
 * Camera rig for the holographic factory floor: orbit, pan and zoom around a
 * focus target, plus deterministic cinematic transitions between the six named
 * screen states the flow layer drives.
 *
 * The rig is a spherical-camera controller with an explicit pose:
 *
 *   `{ focus, azimuth, polar, distance, fov }`
 *
 * Every named state is a fixed pose (see `CAMERA_SCREEN_STATES`), and every
 * transition is sampled from a **pure** curve (`sampleCameraTransition`) — fixed
 * easing, no `Math.random`, no wall clock — so replaying the same transition
 * from the same pose yields the same sampled poses. Tests can therefore prove
 * determinism by sampling the curve twice.
 *
 * Motion has two layers:
 *
 *  1. the *desired* pose — either the cinematic curve for the active transition,
 *     the active named state (plus a slow idle drift), or the free pose the user
 *     is steering;
 *  2. the *current* pose, which follows the desired pose with an exponential
 *     half-life damping. Damping is what makes a transition interruptible: the
 *     first pointer or wheel event re-seeds the free pose from the pose that is
 *     on screen right now, so grabbing the camera mid-flight never snaps.
 *
 * Input is optional: `attach(element)` binds pointer and wheel listeners and
 * returns a detach function; `dispose()` releases them exactly once.
 */

import { Vector3, type PerspectiveCamera } from 'three';

import type { GameSystem, SystemContext, SystemUpdate } from '../game/systems';

/* -------------------------------------------------------------------------- */
/* Named screen states                                                        */
/* -------------------------------------------------------------------------- */

/** The six presentations the flow layer asks the camera for. */
export const CAMERA_STATES = ['brief', 'plan', 'execute', 'verify', 'repair', 'release'] as const;

export type CameraStateName = (typeof CAMERA_STATES)[number];

/** One named camera presentation. */
export interface CameraScreenState {
  readonly name: CameraStateName;
  /** Short label for menus and preview legends. */
  readonly label: string;
  /** One-line art-direction note: what this framing is for. */
  readonly description: string;
  /** Orbit target in world units. */
  readonly focus: readonly [number, number, number];
  /** Orbit angle around +Y, radians. */
  readonly azimuth: number;
  /** Angle from +Y, radians (`0` looks straight down). */
  readonly polar: number;
  /** Eye distance from the focus point, world units. */
  readonly distance: number;
  /** Vertical field of view, degrees. */
  readonly fov: number;
  /** Cinematic duration of the transition *into* this state, milliseconds. */
  readonly transitionMs: number;
  /** Idle azimuth drift amplitude, radians. */
  readonly drift: number;
}

/**
 * The six mandated states.
 *
 * They are staged around one floor (88 world units across, lane pylons at
 * `z = -16`, verification beacons at `z = 30`, the holo core at the origin):
 * `brief` is the wide establishing shot, `plan` leans over the lane row,
 * `execute` drops low and close on the core, `verify` swings behind the beacons,
 * `repair` picks out the west service bay, and `release` lifts to a hero shot.
 */
export const CAMERA_SCREEN_STATES: Readonly<Record<CameraStateName, CameraScreenState>> = {
  brief: {
    name: 'brief',
    label: 'Brief',
    description: 'wide establishing push-in over the whole floor',
    focus: [0, 4, 2],
    azimuth: 0.86,
    polar: 1.03,
    distance: 58,
    fov: 46,
    transitionMs: 1600,
    drift: 0.05,
  },
  plan: {
    name: 'plan',
    label: 'Plan',
    description: 'three-quarter view down the lane pylon row',
    focus: [0, 3.5, -8],
    azimuth: 0.34,
    polar: 1.17,
    distance: 44,
    fov: 44,
    transitionMs: 1400,
    drift: 0.03,
  },
  execute: {
    name: 'execute',
    label: 'Execute',
    description: 'low, close tracking shot of the holo core',
    focus: [0, 2.6, 0],
    azimuth: -0.42,
    polar: 0.87,
    distance: 33,
    fov: 50,
    transitionMs: 1200,
    drift: 0.05,
  },
  verify: {
    name: 'verify',
    label: 'Verify',
    description: 'crane behind the gate beacons looking back at the floor',
    focus: [0, 5, 22],
    azimuth: 2.62,
    polar: 1.06,
    distance: 40,
    fov: 42,
    transitionMs: 1300,
    drift: 0.02,
  },
  repair: {
    name: 'repair',
    label: 'Repair',
    description: 'tilted close pass over the west service bay',
    focus: [-14, 6, 6],
    azimuth: 2.1,
    polar: 0.95,
    distance: 30,
    fov: 48,
    transitionMs: 1100,
    drift: 0.04,
  },
  release: {
    name: 'release',
    label: 'Release',
    description: 'high hero shot holding the lit floor and the god rays',
    focus: [0, 9, 0],
    azimuth: 1.6,
    polar: 0.62,
    distance: 74,
    fov: 52,
    transitionMs: 2000,
    drift: 0.06,
  },
};

/** Hard limits every orbit, pan, zoom and transition is clamped to. */
export interface CameraLimits {
  minDistance: number;
  maxDistance: number;
  minPolar: number;
  maxPolar: number;
  minFov: number;
  maxFov: number;
}

export const CAMERA_LIMITS: CameraLimits = {
  minDistance: 9,
  maxDistance: 96,
  minPolar: 0.12,
  maxPolar: 1.38,
  minFov: 28,
  maxFov: 66,
};

/* -------------------------------------------------------------------------- */
/* Poses and the transition curve                                             */
/* -------------------------------------------------------------------------- */

/** An orbit pose: spherical camera coordinates around `focus`. */
export interface CameraPose {
  focus: Vector3;
  azimuth: number;
  polar: number;
  distance: number;
  fov: number;
}

/** Extra lift applied at the midpoint of a transition, world units. */
export const TRANSITION_FOCUS_LIFT = 1.2;

const TWO_PI = Math.PI * 2;

/** Build a pose from primitives. */
export function createCameraPose(
  focus: readonly [number, number, number],
  azimuth: number,
  polar: number,
  distance: number,
  fov: number,
): CameraPose {
  return {
    focus: new Vector3(focus[0], focus[1], focus[2]),
    azimuth,
    polar,
    distance,
    fov,
  };
}

/** An independent copy of a pose. */
export function cloneCameraPose(pose: CameraPose): CameraPose {
  return {
    focus: pose.focus.clone(),
    azimuth: pose.azimuth,
    polar: pose.polar,
    distance: pose.distance,
    fov: pose.fov,
  };
}

/** Overwrite `target` with `source` without allocating. */
export function copyCameraPose(target: CameraPose, source: CameraPose): CameraPose {
  target.focus.copy(source.focus);
  target.azimuth = source.azimuth;
  target.polar = source.polar;
  target.distance = source.distance;
  target.fov = source.fov;
  return target;
}

/** The fixed pose a named state frames. */
export function poseOfState(name: CameraStateName): CameraPose {
  const state = CAMERA_SCREEN_STATES[name];
  return createCameraPose(state.focus, state.azimuth, state.polar, state.distance, state.fov);
}

/** Normalize an angle into `(-π, π]`, the shortest arc between two headings. */
export function wrapAngle(angle: number): number {
  let wrapped = angle % TWO_PI;
  if (wrapped > Math.PI) wrapped -= TWO_PI;
  if (wrapped <= -Math.PI) wrapped += TWO_PI;
  return wrapped;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Fixed ease for cinematic transitions: symmetric, zero velocity at both ends. */
export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * Sample a transition between two poses at normalized time `t`.
 *
 * Pure and total: the same `from`, `to` and `t` always produce the same pose.
 * Azimuth takes the shortest arc, distance and fov ease with the same cubic, and
 * the focus lifts by `TRANSITION_FOCUS_LIFT` at the midpoint so every cinematic
 * move arcs upward instead of sliding through the floor.
 */
export function sampleCameraTransition(
  from: CameraPose,
  to: CameraPose,
  t: number,
  out?: CameraPose,
): CameraPose {
  const eased = easeInOutCubic(t);
  const lift = Math.sin(Math.PI * clamp(t, 0, 1)) * TRANSITION_FOCUS_LIFT;
  const target =
    out ??
    createCameraPose(
      [from.focus.x, from.focus.y, from.focus.z],
      from.azimuth,
      from.polar,
      from.distance,
      from.fov,
    );

  target.focus.set(
    from.focus.x + (to.focus.x - from.focus.x) * eased,
    from.focus.y + (to.focus.y - from.focus.y) * eased + lift,
    from.focus.z + (to.focus.z - from.focus.z) * eased,
  );
  target.azimuth = from.azimuth + wrapAngle(to.azimuth - from.azimuth) * eased;
  target.polar = from.polar + (to.polar - from.polar) * eased;
  target.distance = from.distance + (to.distance - from.distance) * eased;
  target.fov = from.fov + (to.fov - from.fov) * eased;
  return target;
}

/** Sample a named transition between two states at normalized time `t`. */
export function sampleStateTransition(
  from: CameraStateName,
  to: CameraStateName,
  t: number,
  out?: CameraPose,
): CameraPose {
  return sampleCameraTransition(poseOfState(from), poseOfState(to), t, out);
}

/**
 * The full sampled curve of a transition, for previews, scrubbing and tests.
 *
 * `steps` samples are produced at `t = i / (steps - 1)`, so `steps = 5` yields
 * the start, three interior samples and the end pose.
 */
export function transitionCurve(
  from: CameraStateName,
  to: CameraStateName,
  steps = 8,
): readonly CameraPose[] {
  const count = Math.max(2, Math.floor(steps));
  const origin = poseOfState(from);
  const destination = poseOfState(to);
  const poses: CameraPose[] = [];
  for (let index = 0; index < count; index += 1) {
    poses.push(sampleCameraTransition(origin, destination, index / (count - 1)));
  }
  return poses;
}

/* -------------------------------------------------------------------------- */
/* Rig                                                                        */
/* -------------------------------------------------------------------------- */

/** Damping half-lives, milliseconds: how long a value takes to close half the gap. */
export interface CameraDamping {
  readonly angleMs: number;
  readonly focusMs: number;
  readonly distanceMs: number;
  readonly fovMs: number;
}

export const CAMERA_DAMPING: CameraDamping = {
  angleMs: 110,
  focusMs: 130,
  distanceMs: 120,
  fovMs: 150,
};

/** Longest delta a single `update` will integrate, so a hitch cannot teleport. */
export const MAX_CAMERA_STEP_MS = 100;

/** Orbit radians per viewport width dragged. */
export const ORBIT_RADIANS_PER_WIDTH = Math.PI * 1.6;
/** Orbit radians per viewport height dragged. */
export const ORBIT_RADIANS_PER_HEIGHT = Math.PI * 0.9;
/** Wheel-delta to zoom-factor exponent. */
export const ZOOM_PER_WHEEL_UNIT = 0.0011;

export interface CameraRigOptions {
  /** Camera the rig drives (usually `adapter.camera`). */
  camera: PerspectiveCamera;
  /** Starting named state. Defaults to `brief`. */
  state?: CameraStateName;
  /** Starting state is transitioned into immediately (`true`, the default). */
  immediate?: boolean;
  limits?: Partial<CameraLimits>;
  damping?: Partial<CameraDamping>;
  /**
   * Gentle idle drift while a named state holds. Defaults to `true`, and is
   * forced off when the host asks for reduced motion.
   */
  drift?: boolean;
  /** Element to bind pointer/wheel controls to. Nothing is bound when omitted. */
  element?: HTMLElement | null;
}

/** What the rig is currently doing. */
export type CameraRigMode = 'named' | 'free';

export interface CameraRig {
  readonly camera: PerspectiveCamera;
  /** Last named state the rig was asked for. */
  readonly state: CameraStateName;
  /** `named` while a state or transition owns the camera, `free` after user input. */
  readonly mode: CameraRigMode;
  /** The pose on screen: what `apply()` writes into the camera. */
  readonly pose: CameraPose;
  /** The pose the damping is heading for. */
  readonly target: CameraPose;
  readonly limits: CameraLimits;
  readonly transitioning: boolean;
  /** Normalized progress of the active transition, `1` when idle. */
  readonly transitionProgress: number;
  /** Seconds of rig time integrated so far; drives the idle drift. */
  readonly time: number;
  readonly disposed: boolean;
  /** Cinematic transition into `name`, interrupting whatever is playing. */
  setState(name: CameraStateName, options?: { immediate?: boolean; durationMs?: number }): void;
  /** Orbit by delta radians, clamped to the polar limits. */
  orbit(deltaAzimuth: number, deltaPolar: number): void;
  /** Pan the focus target. Deltas are fractions of the viewport. */
  pan(deltaRight: number, deltaUp: number): void;
  /** Zoom by a distance multiplier (`>1` pulls back), clamped to the limits. */
  zoom(factor: number): void;
  /** Turn the idle drift on or off (reduced-motion hosts turn it off). */
  setDrift(enabled: boolean): void;
  /** Bind pointer and wheel controls. Returns a detach function. */
  attach(element: HTMLElement): () => void;
  /** Release bound controls. Safe to call with nothing bound. */
  detach(): void;
  /** Advance the damping and write the result into the camera. */
  update(deltaMs: number): void;
  /** Write the current pose into the camera without advancing time. */
  apply(): void;
  /** Detach every listener and mark the rig disposed. Idempotent. */
  dispose(): void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  const matchMedia = (window as { matchMedia?: (query: string) => MediaQueryList }).matchMedia;
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Create the camera rig.
 *
 * The rig applies the starting state immediately, so the very first frame after
 * creation is already framed cinematically instead of snapping from the
 * adapter's default camera pose.
 */
export function createCameraRig(options: CameraRigOptions): CameraRig {
  const camera = options.camera;
  const limits: CameraLimits = { ...CAMERA_LIMITS, ...options.limits };
  const damping: CameraDamping = { ...CAMERA_DAMPING, ...options.damping };

  let state: CameraStateName = options.state ?? 'brief';
  let mode: CameraRigMode = 'named';
  let drift = (options.drift ?? true) && !prefersReducedMotion();
  let disposed = false;
  let time = 0;

  const pose = poseOfState(state);
  const target = cloneCameraPose(pose);
  const scratch: CameraPose = cloneCameraPose(pose);

  let transitioning = false;
  let transitionElapsed = 0;
  let transitionDuration = 0;
  const transitionFrom: CameraPose = cloneCameraPose(pose);
  const transitionTo: CameraPose = cloneCameraPose(pose);

  if (options.immediate !== false) {
    // Starting pose: no flight, the caller asked for a framed first frame.
    copyCameraPose(transitionFrom, pose);
    copyCameraPose(transitionTo, pose);
  }

  /**
   * Take the camera off its named state.
   *
   * A cinematic flight is cancelled by seeding the free pose from what is on
   * screen *right now*, so grabbing the camera mid-flight never snaps. Once the
   * user already owns the camera the in-flight free pose is kept, so successive
   * gestures accumulate instead of cancelling each other.
   */
  function takeControl(): void {
    if (mode === 'free') return;
    transitioning = false;
    transitionElapsed = 0;
    transitionDuration = 0;
    mode = 'free';
    copyCameraPose(target, pose);
  }

  function desiredPose(): CameraPose {
    if (transitioning) {
      return sampleCameraTransition(transitionFrom, transitionTo, transitionDuration <= 0 ? 1 : transitionElapsed / transitionDuration, scratch);
    }
    if (mode === 'free') return target;
    copyCameraPose(scratch, poseOfState(state));
    if (drift) {
      scratch.azimuth += CAMERA_SCREEN_STATES[state].drift * Math.sin(time * 0.15);
      scratch.polar += CAMERA_SCREEN_STATES[state].drift * 0.15 * Math.sin(time * 0.09 + 1.1);
    }
    return scratch;
  }

  function dampingFactor(halfLifeMs: number, deltaMs: number): number {
    if (halfLifeMs <= 0) return 1;
    return 1 - Math.pow(0.5, deltaMs / halfLifeMs);
  }

  function apply(): void {
    const sinPolar = Math.sin(pose.polar);
    camera.position.set(
      pose.focus.x + pose.distance * sinPolar * Math.sin(pose.azimuth),
      pose.focus.y + pose.distance * Math.cos(pose.polar),
      pose.focus.z + pose.distance * sinPolar * Math.cos(pose.azimuth),
    );
    camera.lookAt(pose.focus);
    if (Math.abs(camera.fov - pose.fov) > 1e-4) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  function setState(next: CameraStateName, setOptions: { immediate?: boolean; durationMs?: number } = {}): void {
    if (disposed) return;
    state = next;
    mode = 'named';
    const destination = poseOfState(next);
    copyCameraPose(transitionTo, destination);

    const immediate = setOptions.immediate ?? false;
    const duration = setOptions.durationMs ?? CAMERA_SCREEN_STATES[next].transitionMs;
    if (immediate || duration <= 0) {
      copyCameraPose(pose, destination);
      copyCameraPose(target, destination);
      copyCameraPose(transitionFrom, destination);
      transitioning = false;
      transitionElapsed = 0;
      transitionDuration = 0;
      apply();
      return;
    }

    copyCameraPose(transitionFrom, pose);
    transitioning = true;
    transitionElapsed = 0;
    transitionDuration = duration;
  }

  function orbit(deltaAzimuth: number, deltaPolar: number): void {
    if (disposed) return;
    takeControl();
    target.azimuth = wrapAngle(target.azimuth + deltaAzimuth);
    target.polar = clamp(target.polar + deltaPolar, limits.minPolar, limits.maxPolar);
  }

  function pan(deltaRight: number, deltaUp: number): void {
    if (disposed) return;
    takeControl();

    // Camera basis at the current pose: 1 unit of `delta` is a full viewport at
    // the focus distance, so panning feels identical at every zoom level.
    const sinPolar = Math.sin(pose.polar);
    const forward = new Vector3(
      -sinPolar * Math.sin(pose.azimuth),
      -Math.cos(pose.polar),
      -sinPolar * Math.cos(pose.azimuth),
    ).normalize();
    const right = new Vector3().crossVectors(forward, UP).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();
    const worldPerUnit = 2 * pose.distance * Math.tan(((pose.fov * Math.PI) / 180) / 2);
    target.focus.addScaledVector(right, deltaRight * worldPerUnit);
    target.focus.addScaledVector(up, deltaUp * worldPerUnit);
    target.focus.y = clamp(target.focus.y, -4, 24);
  }

  function zoom(factor: number): void {
    if (disposed) return;
    takeControl();
    target.distance = clamp(target.distance * factor, limits.minDistance, limits.maxDistance);
  }

  /* ------------------------------------------------------------- controls */
  interface PointerState {
    x: number;
    y: number;
    /** Whether this drag pans (right/middle button or a modifier) instead of orbiting. */
    pan: boolean;
  }

  const activePointers = new Map<number, PointerState>();
  let detachControls: (() => void) | null = null;

  function pointerIdOf(event: MouseEvent | PointerEvent): number {
    const id = (event as PointerEvent).pointerId;
    return typeof id === 'number' ? id : 0;
  }

  function attach(element: HTMLElement): () => void {
    if (disposed) return () => undefined;
    detach();

    const sizeOf = (): { width: number; height: number } => ({
      width: Math.max(1, element.clientWidth || 1),
      height: Math.max(1, element.clientHeight || 1),
    });

    const onPointerDown = (event: MouseEvent | PointerEvent): void => {
      activePointers.set(pointerIdOf(event), {
        x: event.clientX,
        y: event.clientY,
        pan: event.button === 1 || event.button === 2 || event.shiftKey || event.altKey || event.metaKey,
      });
      const capture = (element as { setPointerCapture?: (id: number) => void }).setPointerCapture;
      if (typeof capture === 'function' && typeof (event as PointerEvent).pointerId === 'number') {
        try {
          capture.call(element, (event as PointerEvent).pointerId);
        } catch {
          // Pointer capture is a nicety; dragging still works without it.
        }
      }
    };

    const onPointerMove = (event: MouseEvent | PointerEvent): void => {
      const id = pointerIdOf(event);
      const previous = activePointers.get(id);
      if (!previous) return;
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      previous.x = event.clientX;
      previous.y = event.clientY;

      const size = sizeOf();
      const others = [...activePointers.entries()].filter(([key]) => key !== id);

      if (others.length > 0) {
        // Two fingers: pinch the distance and drag the focus together.
        const other = others[others.length - 1];
        if (!other) return;
        const [, second] = other;
        const spread = Math.hypot(event.clientX - second.x, event.clientY - second.y);
        const previousSpread = Math.max(1, spread - Math.hypot(dx, dy));
        zoom(clamp(previousSpread / Math.max(1, spread), 0.5, 2));
        panLocal(-dx / size.width, dy / size.height);
        return;
      }

      const panning = previous.pan || event.shiftKey || event.altKey || event.metaKey;
      if (panning) panLocal(-dx / size.width, dy / size.height);
      else orbit(-(dx / size.width) * ORBIT_RADIANS_PER_WIDTH, -(dy / size.height) * ORBIT_RADIANS_PER_HEIGHT);
    };

    const onPointerUp = (event: MouseEvent | PointerEvent): void => {
      activePointers.delete(pointerIdOf(event));
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      zoom(Math.exp(event.deltaY * ZOOM_PER_WHEEL_UNIT));
    };

    const onContextMenu = (event: Event): void => {
      event.preventDefault();
    };

    element.addEventListener('pointerdown', onPointerDown as EventListener);
    element.addEventListener('pointermove', onPointerMove as EventListener);
    element.addEventListener('pointerup', onPointerUp as EventListener);
    element.addEventListener('pointercancel', onPointerUp as EventListener);
    if (typeof element.addEventListener === 'function') {
      element.addEventListener('wheel', onWheel as EventListener, { passive: false });
      element.addEventListener('contextmenu', onContextMenu);
    }

    detachControls = () => {
      element.removeEventListener('pointerdown', onPointerDown as EventListener);
      element.removeEventListener('pointermove', onPointerMove as EventListener);
      element.removeEventListener('pointerup', onPointerUp as EventListener);
      element.removeEventListener('pointercancel', onPointerUp as EventListener);
      element.removeEventListener('wheel', onWheel as EventListener);
      element.removeEventListener('contextmenu', onContextMenu);
      activePointers.clear();
    };
    return detachControls;
  }

  /** Pan with deltas already normalized to the viewport. */
  function panLocal(deltaRight: number, deltaUp: number): void {
    pan(deltaRight, deltaUp);
  }

  function detach(): void {
    detachControls?.();
    detachControls = null;
  }

  // Seed the camera: `immediate: false` starts from the adapter's default pose and
  // flies into the first state instead of jumping.
  if (options.immediate === false) {
    const seededFocus = new Vector3(0, 2, 0);
    const offset = camera.position.clone().sub(seededFocus);
    copyCameraPose(pose, {
      focus: seededFocus,
      azimuth: Math.atan2(offset.x, offset.z),
      polar: Math.acos(clamp(offset.y / Math.max(1e-4, offset.length()), -1, 1)),
      distance: Math.max(limits.minDistance, offset.length()),
      fov: camera.fov,
    });
    copyCameraPose(transitionFrom, pose);
    transitioning = true;
    transitionElapsed = 0;
    transitionDuration = CAMERA_SCREEN_STATES[state].transitionMs;
  }
  apply();

  if (options.element) attach(options.element);

  return {
    camera,
    get state() {
      return state;
    },
    get mode() {
      return mode;
    },
    pose,
    target,
    limits,
    get transitioning() {
      return transitioning;
    },
    get transitionProgress() {
      return transitionDuration <= 0 ? 1 : clamp(transitionElapsed / transitionDuration, 0, 1);
    },
    get time() {
      return time;
    },
    get disposed() {
      return disposed;
    },
    setState,
    orbit,
    pan,
    zoom,
    setDrift(enabled: boolean): void {
      drift = enabled && !prefersReducedMotion();
    },
    attach,
    detach,
    update(deltaMs: number): void {
      if (disposed) return;
      const dt = clamp(deltaMs, 0, MAX_CAMERA_STEP_MS);
      if (dt <= 0) return;

      time += dt / 1000;
      if (transitioning) {
        transitionElapsed += dt;
        if (transitionElapsed >= transitionDuration) {
          transitionElapsed = transitionDuration;
          transitioning = false;
        }
      }

      const desired = desiredPose();
      pose.focus.lerp(desired.focus, dampingFactor(damping.focusMs, dt));
      pose.azimuth += wrapAngle(desired.azimuth - pose.azimuth) * dampingFactor(damping.angleMs, dt);
      pose.polar += (desired.polar - pose.polar) * dampingFactor(damping.angleMs, dt);
      pose.distance += (desired.distance - pose.distance) * dampingFactor(damping.distanceMs, dt);
      pose.fov += (desired.fov - pose.fov) * dampingFactor(damping.fovMs, dt);

      pose.polar = clamp(pose.polar, limits.minPolar, limits.maxPolar);
      pose.distance = clamp(pose.distance, limits.minDistance, limits.maxDistance);
      pose.fov = clamp(pose.fov, limits.minFov, limits.maxFov);

      apply();
    },
    apply,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      detach();
    },
  };
}

/** World up: the axis the orbit and the pan basis are built from. */
const UP = new Vector3(0, 1, 0);

/* -------------------------------------------------------------------------- */
/* Game system adapter                                                        */
/* -------------------------------------------------------------------------- */

/** A `GameSystem` that owns a rig over the runtime's camera. */
export interface CameraRigSystem extends GameSystem {
  readonly id: 'camera-rig';
  /** The rig, available after `attach` has run. */
  readonly rig: CameraRig | null;
  /** Cinematic transition into a named state, if the rig exists. */
  setState(name: CameraStateName, options?: { immediate?: boolean; durationMs?: number }): void;
}

export interface CameraRigSystemOptions {
  /** Starting state. Defaults to `brief`. */
  state?: CameraStateName;
  /** Element for pointer controls. Defaults to the adapter canvas (if any). */
  element?: HTMLElement | null;
  /** Bind pointer controls automatically. Defaults to `true`. */
  controls?: boolean;
  limits?: Partial<CameraLimits>;
  damping?: Partial<CameraDamping>;
  drift?: boolean;
}

/**
 * Compose the rig as a game system.
 *
 * `update()` runs once per fixed step, so camera motion is part of the
 * deterministic simulation rather than the wall clock. The world's post chain
 * reads the camera, so register the rig **before** the world system.
 */
export function createCameraRigSystem(options: CameraRigSystemOptions = {}): CameraRigSystem {
  let rig: CameraRig | null = null;

  return {
    id: 'camera-rig',
    get rig() {
      return rig;
    },
    setState(name: CameraStateName, setOptions?: { immediate?: boolean; durationMs?: number }): void {
      rig?.setState(name, setOptions);
    },
    attach(context: SystemContext): void {
      const element =
        options.element !== undefined
          ? options.element
          : options.controls === false
            ? null
            : context.adapter.canvas;
      rig = createCameraRig({
        camera: context.camera,
        state: options.state,
        limits: options.limits,
        damping: options.damping,
        drift: options.drift,
        element,
      });
    },
    update(update: SystemUpdate): void {
      rig?.update(update.deltaMs);
    },
    dispose(): void {
      rig?.dispose();
      rig = null;
    },
  };
}
