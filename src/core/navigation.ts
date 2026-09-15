/**
 * Navigation controller — the viewer's camera authority for the café.
 *
 * One module owns every way the visitor moves through the scene:
 *
 *  - **orbit / zoom** — a spherical rig around a target, so the room can be
 *    surveyed from a wide vantage and then entered,
 *  - **walk** — a first-person rig with pointer lock, WASD movement, arrow-key
 *    turning, touch drag and gamepad support, held at eye height by a step
 *    limited vertical solve,
 *  - **collision** — analytic clamping against the {@link RoomBounds} supplied
 *    by the environment shell (never hardcoded dimensions), applied through
 *    sub-stepped movement so a high speed frame cannot tunnel through a wall,
 *  - **hotspot focus** — framing any registered object, hotspot or plain
 *    position at a solved close-up distance,
 *  - **inspect** — the close-up presentation plus a documented way back to the
 *    pose the visitor came from.
 *
 * Deliberate boundaries:
 *
 *  - this module creates no scene content (no geometry, light or audio); it only
 *    moves an existing camera (optionally through the kernel's {@link CameraRig}),
 *  - it never touches the projection or the render loop, so the kernel keeps
 *    ownership of `fov`, rendering and resizing,
 *  - every listener, pointer-lock handler and tick subscription is registered
 *    through {@link NavigationController.attach} and released again by
 *    {@link NavigationController.detach} / {@link NavigationController.dispose},
 *  - optional micro-motion (inertia damping, walking head bob) is disabled when
 *    the visitor prefers reduced motion.
 *
 * Typical composition:
 *
 * ```ts
 * const navigation = new NavigationController({
 *   camera: kernel.camera,
 *   rig: kernel.cameraRig,
 *   bounds: environment.bounds,
 *   element: kernel.canvas ?? container,
 *   frameSource: kernel,
 * });
 * navigation.attach();
 * // later, on teardown
 * navigation.dispose();
 * ```
 */

import * as THREE from 'three';
import {
  DEFAULT_ROOM_BOUNDS,
  roomCenter,
  type Hotspot,
  type RoomBounds,
} from '../contracts/period';
import type { CameraRig, Unsubscribe, VectorLike } from './kernel';

/* -------------------------------------------------------------------------- */
/* Input surfaces                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Minimal DOM surface the controller listens on. A real `HTMLElement` (the
 * canvas or its container) satisfies it, and so does a tiny fake in tests, which
 * keeps the input layer headless-testable without `jsdom`.
 */
export interface NavigationEventSource {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
  /** Present on real elements; the controller treats pointer lock as best effort. */
  requestPointerLock?(): void | Promise<void>;
  /** Present on real elements; used to keep receiving drag moves outside the element. */
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
}

/**
 * Document surface used for pointer-lock bookkeeping. A real `Document`
 * satisfies it.
 */
export interface NavigationDocumentSource extends NavigationEventSource {
  exitPointerLock?(): void;
  readonly pointerLockElement?: Element | null;
}

/** A single analogue stick / trigger button as read from the Gamepad API. */
export interface NavigationButtonLike {
  readonly pressed: boolean;
  readonly value: number;
  readonly touched?: boolean;
}

/** Structural subset of `Gamepad` the controller reads. */
export interface NavigationGamepadLike {
  readonly axes: readonly number[];
  readonly buttons: readonly NavigationButtonLike[];
  readonly connected?: boolean;
}

/** Source of connected gamepads (defaults to `navigator.getGamepads`). */
export type NavigationGamepadSource = () => readonly (NavigationGamepadLike | null)[] | null;

/**
 * Tick source the controller subscribes to while attached. `SceneKernel`
 * satisfies this shape through its `onFrame` method.
 */
export interface NavigationFrame {
  readonly deltaSeconds: number;
}

export interface NavigationFrameSource {
  onFrame(listener: (frame: NavigationFrame) => void): Unsubscribe;
}

/* -------------------------------------------------------------------------- */
/* Public vocabulary                                                          */
/* -------------------------------------------------------------------------- */

/** Camera behaviour currently driven by the controller. */
export type NavigationMode = 'orbit' | 'walk';

/** Axis aligned interior volume the camera is allowed to occupy, in metres. */
export interface NavigationInterior {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Tunables of the navigation solve. Every value is a limit or a rate, never a
 * room coordinate: room geometry always comes from {@link RoomBounds}.
 */
export interface NavigationLimits {
  /** Distance kept from the walls (X/Z), in metres. */
  readonly wallMargin: number;
  /** Lowest camera height, in metres. */
  readonly floorMargin: number;
  /** Distance kept below the ceiling, in metres. */
  readonly ceilingMargin: number;
  /** Closest orbit / focus distance, in metres. */
  readonly minDistance: number;
  /** Furthest orbit distance, in metres. */
  readonly maxDistance: number;
  /** Lowest eye height in walk mode (crouch), in metres. */
  readonly minEyeHeight: number;
  /** Highest eye height in walk mode, in metres. */
  readonly maxEyeHeight: number;
  /** Largest position change applied in one collision sub-step, in metres. */
  readonly maxStepDistance: number;
  /** Largest vertical (eye height) change per second, in metres. */
  readonly maxEyeStep: number;
  /** Walking speed, in metres per second. */
  readonly walkSpeed: number;
  /** Speed multiplier while a shift key is held. */
  readonly runMultiplier: number;
  /** Arrow-key / stick turning rate, in radians per second. */
  readonly turnSpeed: number;
  /** Pointer-look sensitivity, in radians per pixel. */
  readonly lookSpeed: number;
  /** Drag-orbit sensitivity, in radians per pixel. */
  readonly orbitSpeed: number;
  /** Wheel zoom exponent per wheel unit. */
  readonly zoomSpeed: number;
  /** Lowest polar angle (measured from +Y), in radians. */
  readonly minPolar: number;
  /** Highest polar angle (measured from +Y), in radians. */
  readonly maxPolar: number;
  /** Pitch clamp for walk mode, in radians. */
  readonly maxPitch: number;
  /** How much of the frame a focused object should fill. */
  readonly focusFill: number;
  /** Framing radius used when a target declares none, in metres. */
  readonly focusRadius: number;
}

/** Optional head-bob micro-motion applied while walking. */
export interface HeadBobOptions {
  /** Vertical travel in metres. */
  readonly amplitude: number;
  /** Cycles per second. */
  readonly frequency: number;
}

/** A plain focusable: any world position plus an optional framing radius. */
export interface FocusDescriptor {
  readonly id?: string;
  readonly position: VectorLike;
  readonly radius?: number;
  readonly anchor?: THREE.Object3D;
}

/**
 * Anything that can be framed: a scene object, a {@link Hotspot} from the
 * frozen contracts, or a plain descriptor. The controller never reaches into
 * domain module internals.
 */
export type Focusable = THREE.Object3D | Hotspot | FocusDescriptor;

/** Options accepted by {@link NavigationController.focus}. */
export interface FocusOptions {
  /** Explicit framing distance, overriding the radius/fov solve. */
  readonly distance?: number;
  /** Unit direction from the target towards the camera; defaults to the current approach. */
  readonly direction?: VectorLike;
  /** Snap instead of easing (damping is opt-in and off by default). */
  readonly immediate?: boolean;
}

/** Archived camera pose used by inspect mode to return the visitor. */
export interface NavigationPose {
  readonly mode: NavigationMode;
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly yaw: number;
  readonly pitch: number;
  readonly eyeHeight: number;
  readonly azimuth: number;
  readonly polar: number;
  readonly distance: number;
}

/** Debug-facing camera state used by tests, overlays and manual review. */
export interface NavigationSnapshot {
  readonly mode: NavigationMode;
  readonly inspecting: boolean;
  readonly attached: boolean;
  readonly pointerLocked: boolean;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly target: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number;
  readonly pitch: number;
  readonly azimuth: number;
  readonly polar: number;
  readonly distance: number;
  readonly eyeHeight: number;
  readonly focusDistance: number | null;
  readonly reducedMotion: boolean;
  readonly listeners: NavigationListenerStats;
}

/** Breakdown of the listeners the controller currently owns. */
export interface NavigationListenerStats {
  /** Pointer / wheel / touch listeners on the input element. */
  readonly input: number;
  /** Keyboard listeners. */
  readonly keyboard: number;
  /** Pointer-lock listeners on the document. */
  readonly document: number;
  /** Frame subscription (1 while attached to a frame source). */
  readonly frame: number;
  readonly total: number;
}

/** Construction options for {@link NavigationController}. */
export interface NavigationControllerOptions {
  /** Camera the controller poses. */
  readonly camera: THREE.PerspectiveCamera;
  /** Room shell dimensions; defaults to the shared {@link DEFAULT_ROOM_BOUNDS}. */
  readonly bounds?: RoomBounds;
  /** Initial mode; defaults to `'orbit'`. */
  readonly mode?: NavigationMode;
  /** Element receiving pointer, wheel and touch input. */
  readonly element?: NavigationEventSource | null;
  /** Document used for pointer lock; defaults to the global document when present. */
  readonly ownerDocument?: NavigationDocumentSource | null;
  /** Keyboard target; defaults to the document, then the element. */
  readonly keyTarget?: NavigationEventSource | null;
  /** Kernel camera rig to drive; when present the rig stays authoritative. */
  readonly rig?: CameraRig | null;
  /** Tick source subscribed while attached (a `SceneKernel` works directly). */
  readonly frameSource?: NavigationFrameSource | null;
  /** Gamepad source; defaults to `navigator.getGamepads`. */
  readonly gamepadSource?: NavigationGamepadSource | null;
  /** Overrides merged over {@link defaultNavigationLimits}. */
  readonly limits?: Partial<NavigationLimits> | null;
  /** Initial orbit target; defaults to the room centre. */
  readonly target?: VectorLike | null;
  /** Initial eye height in walk mode; defaults to a standing 1.62 m. */
  readonly eyeHeight?: number;
  /** Inertia damping rate per second; `0` (the default) applies poses immediately. */
  readonly damping?: number;
  /** Walking head bob; `null` disables it. */
  readonly headBob?: HeadBobOptions | null;
  /** Explicit reduced-motion state, overriding the media query probe. */
  readonly reducedMotion?: boolean;
  /** Custom reduced-motion probe (defaults to `matchMedia('(prefers-reduced-motion: reduce)')`). */
  readonly prefersReducedMotion?: () => boolean;
  /** Upper bound applied to a single tick delta; defaults to 0.1 s. */
  readonly maxDeltaSeconds?: number;
}

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

const EPSILON = 1e-6;

/** Radius relative to frame fill and field of view used when framing a target. */
const DEFAULT_FOCUS_FILL = 1.8;
const DEFAULT_FOCUS_RADIUS = 0.6;

/** Clamp `value`, tolerating an inverted range by returning the mid-point. */
function clamp(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return Math.min(Math.max(value, min), max);
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function detectReducedMotion(): boolean {
  const scope = globalThis as unknown as {
    matchMedia?: (query: string) => { matches?: boolean };
  };
  if (typeof scope.matchMedia !== 'function') return false;
  try {
    return scope.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

function defaultGamepadSource(): NavigationGamepadSource | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
    return null;
  }
  return () => navigator.getGamepads();
}

/** Limits derived from a room shell: no room coordinate is ever hardcoded. */
export function defaultNavigationLimits(bounds: RoomBounds): NavigationLimits {
  return {
    wallMargin: 0.35,
    floorMargin: 0.2,
    ceilingMargin: 0.2,
    minDistance: 1.2,
    maxDistance: Math.min(bounds.width, bounds.depth) * 0.5,
    minEyeHeight: 0.8,
    maxEyeHeight: Math.min(1.75, Math.max(bounds.height - 0.35, 0.8)),
    maxStepDistance: 0.25,
    maxEyeStep: 3,
    walkSpeed: 2.6,
    runMultiplier: 1.8,
    turnSpeed: 1.9,
    lookSpeed: 0.0022,
    orbitSpeed: 0.006,
    zoomSpeed: 0.0012,
    minPolar: 0.08,
    maxPolar: Math.PI - 0.08,
    maxPitch: 1.45,
    focusFill: DEFAULT_FOCUS_FILL,
    focusRadius: DEFAULT_FOCUS_RADIUS,
  };
}

/** Interior volume the camera may occupy, derived from `bounds` and `limits`. */
export function navigationInterior(
  bounds: RoomBounds,
  limits: NavigationLimits,
): NavigationInterior {
  const halfWidth = Math.max(bounds.width / 2 - limits.wallMargin, 0);
  const halfDepth = Math.max(bounds.depth / 2 - limits.wallMargin, 0);
  const minY = Math.max(limits.floorMargin, 0);
  const maxY = Math.max(bounds.height - limits.ceilingMargin, minY);
  return { minX: -halfWidth, maxX: halfWidth, minY, maxY, minZ: -halfDepth, maxZ: halfDepth };
}

/** Projects a point back inside `interior`, mutating and returning it. */
function clampPointToInterior(point: THREE.Vector3, interior: NavigationInterior): THREE.Vector3 {
  point.x = clamp(point.x, interior.minX, interior.maxX);
  point.y = clamp(point.y, interior.minY, interior.maxY);
  point.z = clamp(point.z, interior.minZ, interior.maxZ);
  return point;
}

/** Distance from an interior point along `direction` until it leaves `interior`. */
function rayExitDistance(
  origin: VectorLike,
  direction: VectorLike,
  interior: NavigationInterior,
): number {
  const axis = (o: number, d: number, lo: number, hi: number): number => {
    if (Math.abs(d) < 1e-9) return Infinity;
    return d > 0 ? (hi - o) / d : (lo - o) / d;
  };
  const exit = Math.min(
    axis(origin.x, direction.x, interior.minX, interior.maxX),
    axis(origin.y, direction.y, interior.minY, interior.maxY),
    axis(origin.z, direction.z, interior.minZ, interior.maxZ),
  );
  return Number.isFinite(exit) ? Math.max(exit, 0) : 0;
}

/**
 * Solves the camera distance that frames a sphere of `radius` so it fills
 * roughly `1 / fill` of the smaller screen axis.
 */
export function solveFocusDistance(
  radius: number,
  fovDegrees: number,
  aspect = 1,
  fill = DEFAULT_FOCUS_FILL,
): number {
  const safeRadius = Math.max(finiteOr(radius, DEFAULT_FOCUS_RADIUS), 1e-3);
  const safeFill = Math.max(finiteOr(fill, DEFAULT_FOCUS_FILL), 1e-3);
  const verticalHalf = THREE.MathUtils.degToRad(clamp(fovDegrees, 1, 170)) / 2;
  const horizontalHalf = Math.atan(Math.tan(verticalHalf) * Math.max(aspect, 1e-3));
  const halfAngle = Math.max(Math.min(verticalHalf, horizontalHalf), 1e-3);
  return (safeRadius * safeFill) / Math.max(Math.tan(halfAngle), 1e-3);
}

function isObject3D(value: unknown): value is THREE.Object3D {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isObject3D?: unknown }).isObject3D === true
  );
}

function isHotspotLike(
  value: unknown,
): value is { position: VectorLike; radius?: number; anchor?: THREE.Object3D } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { position?: unknown }).position === 'object' &&
    (value as { position?: unknown }).position !== null
  );
}

/** World position and framing radius of any {@link Focusable}. */
function resolveFocusable(
  target: Focusable,
  fallbackRadius: number,
): { position: THREE.Vector3; radius: number } {
  if (isObject3D(target)) {
    const position = target.getWorldPosition(new THREE.Vector3());
    const sphere = new THREE.Box3().setFromObject(target).getBoundingSphere(new THREE.Sphere());
    const radius = sphere.radius > 0 ? sphere.radius : 0;
    return { position, radius: radius > 0 ? radius : fallbackRadius };
  }
  if (isHotspotLike(target)) {
    const anchor = target.anchor;
    const position = isObject3D(anchor)
      ? anchor.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(target.position.x, target.position.y, target.position.z);
    const declared = typeof target.radius === 'number' ? target.radius : 0;
    return { position, radius: declared > 0 ? declared : fallbackRadius };
  }
  throw new TypeError(
    'NavigationController.focus() expects a THREE.Object3D, a Hotspot or a focus descriptor.',
  );
}

/* -------------------------------------------------------------------------- */
/* Controller                                                                 */
/* -------------------------------------------------------------------------- */

interface ListenerEntry {
  readonly target: NavigationEventSource;
  readonly type: string;
  readonly handler: EventListener;
}

interface GamepadInput {
  readonly forward: number;
  readonly strafe: number;
  readonly turn: number;
  readonly look: number;
  readonly zoom: number;
}

/** Modifier / action keys the controller tracks by `KeyboardEvent.code`. */
const MOVEMENT_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'KeyC',
  'Space',
]);

const GAMEPAD_DEADZONE = 0.15;

/**
 * The café's camera authority. See the module documentation for the feature
 * set; construct one, call {@link NavigationController.attach}, and drive it
 * from the kernel's frame loop (or call {@link NavigationController.update}
 * directly, as the tests do).
 */
export class NavigationController {
  /** Camera posed by this controller. */
  readonly camera: THREE.PerspectiveCamera;
  /** Kernel camera rig, when the controller drives one. */
  readonly rig: CameraRig | null;

  private readonly element: NavigationEventSource | null;
  private readonly ownerDocument: NavigationDocumentSource | null;
  private readonly keyTarget: NavigationEventSource | null;
  private readonly frameSource: NavigationFrameSource | null;
  private readonly gamepadSource: NavigationGamepadSource | null;
  private readonly explicitLimits: Partial<NavigationLimits> | null;
  private readonly maxDeltaSeconds: number;
  private readonly damping: number;
  private readonly headBob: HeadBobOptions | null;
  private readonly prefersReducedMotionProbe: () => boolean;

  private roomBounds: RoomBounds;
  private navigationLimits: NavigationLimits;
  private interiorState: NavigationInterior;

  private navigationMode: NavigationMode;
  private isInspecting = false;
  private focusTarget: THREE.Vector3 | null = null;
  private currentFocusDistance: number | null = null;
  private savedPose: NavigationPose | null = null;

  private orbitAzimuth: number;
  private orbitPolar: number;
  private orbitDistance: number;
  private readonly orbitTarget = new THREE.Vector3();

  private readonly walkPosition = new THREE.Vector3();
  private walkYaw = 0;
  private walkPitch = 0;
  private walkEyeHeight: number;
  private desiredEyeHeight: number;
  private moving = false;

  private readonly controlPosition = new THREE.Vector3();
  private readonly controlTarget = new THREE.Vector3();
  private readonly appliedPosition = new THREE.Vector3();
  private readonly appliedTarget = new THREE.Vector3();
  private hasAppliedPose = false;

  private readonly keys = new Set<string>();
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private activePointerId: number | null = null;
  private touchActive = false;
  private touchIdentifier: number | null = null;
  private lastTouchX = 0;
  private lastTouchY = 0;
  private lastPinchSpan = 0;

  private pointerLockActive = false;
  private isAttached = false;
  private reducedMotionState: boolean;
  private lastDeltaSeconds = 0;
  private bobPhase = 0;
  private bobAmount = 0;

  private inputListeners: ListenerEntry[] = [];
  private keyboardListeners: ListenerEntry[] = [];
  private documentListeners: ListenerEntry[] = [];
  private unsubscribeFrame: Unsubscribe | null = null;

  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchC = new THREE.Vector3();

  constructor(options: NavigationControllerOptions) {
    this.rig = options.rig ?? null;
    // A supplied rig owns its camera: posing anything else would desync the
    // kernel's render loop from the controller's solve.
    this.camera = this.rig ? this.rig.camera : options.camera;
    const globalDocument =
      typeof document !== 'undefined' ? (document as NavigationDocumentSource) : null;
    this.element = options.element ?? null;
    this.ownerDocument = options.ownerDocument !== undefined ? options.ownerDocument : globalDocument;
    this.keyTarget =
      options.keyTarget !== undefined
        ? options.keyTarget
        : (this.ownerDocument ?? this.element);
    this.frameSource = options.frameSource ?? null;
    this.gamepadSource =
      options.gamepadSource !== undefined ? options.gamepadSource : defaultGamepadSource();
    this.explicitLimits = options.limits ?? null;
    this.maxDeltaSeconds = Math.max(options.maxDeltaSeconds ?? 0.1, EPSILON);
    this.damping = Math.max(options.damping ?? 0, 0);
    this.headBob = options.headBob ?? { amplitude: 0.015, frequency: 1.6 };
    this.prefersReducedMotionProbe = options.prefersReducedMotion ?? detectReducedMotion;

    this.roomBounds = options.bounds ?? DEFAULT_ROOM_BOUNDS;
    this.navigationLimits = { ...defaultNavigationLimits(this.roomBounds) };
    if (this.explicitLimits) {
      Object.assign(this.navigationLimits, this.explicitLimits);
    }
    this.interiorState = navigationInterior(this.roomBounds, this.navigationLimits);
    this.reducedMotionState =
      options.reducedMotion ?? (this.prefersReducedMotionProbe() === true);

    const centre = roomCenter(this.roomBounds);
    this.orbitTarget.set(centre.x, centre.y, centre.z);
    if (options.target) {
      this.orbitTarget.set(options.target.x, options.target.y, options.target.z);
    }
    clampPointToInterior(this.orbitTarget, this.interiorState);

    this.orbitDistance = clamp(
      this.navigationLimits.maxDistance * 0.85,
      this.navigationLimits.minDistance,
      this.navigationLimits.maxDistance,
    );
    this.orbitPolar = THREE.MathUtils.degToRad(75);
    this.orbitAzimuth = 0;

    const standing = clamp(1.62, this.navigationLimits.minEyeHeight, this.navigationLimits.maxEyeHeight);
    this.walkEyeHeight = clamp(
      finiteOr(options.eyeHeight ?? standing, standing),
      this.navigationLimits.minEyeHeight,
      this.navigationLimits.maxEyeHeight,
    );
    this.desiredEyeHeight = this.walkEyeHeight;
    // Walk mode starts near the entrance, looking down the room.
    this.walkPosition.set(
      0,
      this.walkEyeHeight,
      clamp(this.roomBounds.depth / 2 - 0.8, this.interiorState.minZ, this.interiorState.maxZ),
    );
    this.navigationMode = options.mode ?? 'orbit';

    if (this.navigationMode === 'walk') {
      // Look down the room from the entrance, mirroring the kernel's default view.
      this.walkYaw = 0;
      this.walkPitch = 0;
    }

    this.recomputeControlPose(0);
    this.appliedPosition.copy(this.controlPosition);
    this.appliedTarget.copy(this.controlTarget);
  }

  /* -- state ------------------------------------------------------------- */

  /** Camera behaviour currently driven. */
  get mode(): NavigationMode {
    return this.navigationMode;
  }

  /** True while a close-up inspect view is presented. */
  get inspecting(): boolean {
    return this.isInspecting;
  }

  /** True between {@link attach} and {@link detach}. */
  get attached(): boolean {
    return this.isAttached;
  }

  /** True while the element owns the pointer lock session. */
  get pointerLocked(): boolean {
    return this.pointerLockActive;
  }

  /** Room shell dimensions driving collision. */
  get bounds(): RoomBounds {
    return this.roomBounds;
  }

  /** Active limits (see {@link NavigationLimits}). */
  get limits(): NavigationLimits {
    return this.navigationLimits;
  }

  /** Interior volume the camera may occupy. */
  get interior(): NavigationInterior {
    return this.interiorState;
  }

  /** Control pose: where the camera is being driven to. */
  get position(): THREE.Vector3 {
    return this.controlPosition;
  }

  /** Control look-at point. */
  get target(): THREE.Vector3 {
    return this.controlTarget;
  }

  /** Current orbit azimuth in radians. */
  get azimuth(): number {
    return this.orbitAzimuth;
  }

  /** Current polar angle from +Y in radians. */
  get polar(): number {
    return this.orbitPolar;
  }

  /** Current orbit distance in metres. */
  get distance(): number {
    return this.orbitDistance;
  }

  /** Current walk yaw in radians. */
  get yaw(): number {
    return this.walkYaw;
  }

  /** Current walk pitch in radians. */
  get pitch(): number {
    return this.walkPitch;
  }

  /** Current eye height in metres. */
  get eyeHeight(): number {
    return this.walkEyeHeight;
  }

  /** Inspect framing distance, or `null` when not inspecting. */
  get focusDistance(): number | null {
    return this.currentFocusDistance;
  }

  /** True when optional micro-motion is suppressed. */
  get reducedMotion(): boolean {
    return this.reducedMotionState;
  }

  /** Total listeners this controller owns (input + keyboard + document + frame). */
  get listenerCount(): number {
    return (
      this.inputListeners.length +
      this.keyboardListeners.length +
      this.documentListeners.length +
      (this.unsubscribeFrame ? 1 : 0)
    );
  }

  /** Detailed listener ownership, handy for lifecycle assertions. */
  getListenerStats(): NavigationListenerStats {
    const input = this.inputListeners.length;
    const keyboard = this.keyboardListeners.length;
    const documentCount = this.documentListeners.length;
    const frame = this.unsubscribeFrame ? 1 : 0;
    return { input, keyboard, document: documentCount, frame, total: input + keyboard + documentCount + frame };
  }

  /** Debug-facing snapshot of the camera state. */
  snapshot(): NavigationSnapshot {
    return {
      mode: this.navigationMode,
      inspecting: this.isInspecting,
      attached: this.isAttached,
      pointerLocked: this.pointerLockActive,
      position: {
        x: this.controlPosition.x,
        y: this.controlPosition.y,
        z: this.controlPosition.z,
      },
      target: {
        x: this.controlTarget.x,
        y: this.controlTarget.y,
        z: this.controlTarget.z,
      },
      yaw: this.walkYaw,
      pitch: this.walkPitch,
      azimuth: this.orbitAzimuth,
      polar: this.orbitPolar,
      distance: this.orbitDistance,
      eyeHeight: this.walkEyeHeight,
      focusDistance: this.currentFocusDistance,
      reducedMotion: this.reducedMotionState,
      listeners: this.getListenerStats(),
    };
  }

  /* -- lifecycle --------------------------------------------------------- */

  /**
   * Registers every input listener and the frame subscription. Idempotent, and
   * safe to call again after {@link detach} or {@link dispose}.
   */
  attach(): void {
    if (this.isAttached) return;
    this.isAttached = true;

    const element = this.element;
    if (element) {
      this.bind(element, 'pointerdown', this.handlePointerDown);
      this.bind(element, 'pointermove', this.handlePointerMove);
      this.bind(element, 'pointerup', this.handlePointerEnd);
      this.bind(element, 'pointercancel', this.handlePointerEnd);
      this.bind(element, 'wheel', this.handleWheel);
      this.bind(element, 'touchstart', this.handleTouchStart);
      this.bind(element, 'touchmove', this.handleTouchMove);
      this.bind(element, 'touchend', this.handleTouchEnd);
      this.bind(element, 'touchcancel', this.handleTouchEnd);
    }

    const keyTarget = this.keyTarget;
    if (keyTarget) {
      this.bind(keyTarget, 'keydown', this.handleKeyDown, 'keyboard');
      this.bind(keyTarget, 'keyup', this.handleKeyUp, 'keyboard');
    }

    const ownerDocument = this.ownerDocument;
    if (ownerDocument && ownerDocument !== element) {
      this.bind(ownerDocument, 'pointerlockchange', this.handlePointerLockChange, 'document');
      this.bind(ownerDocument, 'pointerlockerror', this.handlePointerLockError, 'document');
    }

    this.unsubscribeFrame = this.frameSource
      ? this.frameSource.onFrame((frame) => this.update(frame.deltaSeconds))
      : null;

    this.recomputeControlPose(0);
    this.applyPose(true);
  }

  /**
   * Releases every listener, pointer-lock handler and tick subscription it
   * added. The kernel's render loop, camera rig and scene are untouched, and
   * {@link attach} can be called again on the resulting controller.
   */
  detach(): void {
    for (const entry of this.inputListeners.splice(0)) {
      entry.target.removeEventListener(entry.type, entry.handler);
    }
    for (const entry of this.keyboardListeners.splice(0)) {
      entry.target.removeEventListener(entry.type, entry.handler);
    }
    for (const entry of this.documentListeners.splice(0)) {
      entry.target.removeEventListener(entry.type, entry.handler);
    }
    if (this.unsubscribeFrame) {
      this.unsubscribeFrame();
      this.unsubscribeFrame = null;
    }
    if (this.pointerLockActive) {
      this.releasePointerLock();
    }
    this.keys.clear();
    this.dragging = false;
    this.touchActive = false;
    this.touchIdentifier = null;
    this.isAttached = false;
  }

  /** Releases everything (alias of {@link detach}); the controller stays reusable. */
  dispose(): void {
    this.detach();
  }

  /* -- manual input (pointer lock, tests, programmatic control) ----------- */

  /** Requests pointer lock on the input element, if the browser offers it. */
  requestPointerLock(): void {
    const element = this.element;
    if (!element || typeof element.requestPointerLock !== 'function') return;
    try {
      const result = element.requestPointerLock();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => undefined);
      }
    } catch {
      // Pointer lock is a progressive enhancement: ignore refusals.
    }
  }

  /** Ends the pointer lock session, if one is active. */
  releasePointerLock(): void {
    const ownerDocument = this.ownerDocument;
    if (ownerDocument && typeof ownerDocument.exitPointerLock === 'function') {
      ownerDocument.exitPointerLock();
    }
    this.pointerLockActive = false;
    this.dragging = false;
  }

  /* -- orbit / zoom ------------------------------------------------------ */

  /**
   * Adds a delta to the orbit angles. Polar is clamped every step so the camera
   * cannot pass through the floor or the ceiling.
   */
  orbit(deltaAzimuth: number, deltaPolar: number): void {
    this.orbitAzimuth += finiteOr(deltaAzimuth, 0);
    this.orbitPolar += finiteOr(deltaPolar, 0);
    this.recomputeControlPose(0);
    this.applyPose(false);
  }

  /** Multiplies the orbit distance (wheel / pinch). `factor > 1` zooms out. */
  zoomBy(factor: number): void {
    const safe = finiteOr(factor, 1);
    this.orbitDistance = clamp(
      this.orbitDistance * Math.max(safe, EPSILON),
      this.navigationLimits.minDistance,
      this.navigationLimits.maxDistance,
    );
    this.recomputeControlPose(0);
    this.applyPose(false);
  }

  /** Sets the orbit distance directly, clamped to the configured range. */
  setDistance(distance: number): void {
    this.orbitDistance = clamp(
      finiteOr(distance, this.orbitDistance),
      this.navigationLimits.minDistance,
      this.navigationLimits.maxDistance,
    );
    this.recomputeControlPose(0);
    this.applyPose(false);
  }

  /** Moves the orbit centre; the target is clamped inside the room volume. */
  setTarget(point: VectorLike): void {
    this.orbitTarget.set(
      finiteOr(point.x, this.orbitTarget.x),
      finiteOr(point.y, this.orbitTarget.y),
      finiteOr(point.z, this.orbitTarget.z),
    );
    clampPointToInterior(this.orbitTarget, this.interiorState);
    this.recomputeControlPose(0);
    this.applyPose(false);
  }

  /* -- hotspot focus / inspect ------------------------------------------ */

  /**
   * Frames `target` up close and returns the resulting camera distance.
   *
   * The distance is `options.distance` when supplied, otherwise solved from the
   * target's radius and the camera field of view (see {@link solveFocusDistance}).
   * The camera approaches from its current side of the object, and the pose is
   * clamped inside the room shell. Focusing switches the controller to orbit
   * mode so the close-up can be inspected from around the object.
   */
  focus(target: Focusable, options: FocusOptions = {}): number {
    const resolved = resolveFocusable(target, this.navigationLimits.focusRadius);
    if (this.navigationMode !== 'orbit') {
      this.switchMode('orbit');
    }

    const requested = clamp(
      finiteOr(
        options.distance ?? solveFocusDistance(
          resolved.radius,
          this.camera.fov,
          this.camera.aspect,
          this.navigationLimits.focusFill,
        ),
        this.navigationLimits.minDistance,
      ),
      this.navigationLimits.minDistance,
      this.navigationLimits.maxDistance,
    );

    // Come at the object from wherever the visitor already stands.
    const direction = this.scratchA.copy(this.controlPosition).sub(resolved.position);
    if (direction.lengthSq() < 1e-8) {
      direction.copy(this.lookDirection(this.scratchB)).multiplyScalar(-1);
    }
    direction.normalize();
    if (options.direction) {
      direction.set(options.direction.x, options.direction.y, options.direction.z);
      if (direction.lengthSq() < 1e-8) direction.set(0, 0, 1);
      direction.normalize();
    }

    this.orbitTarget.copy(resolved.position);
    clampPointToInterior(this.orbitTarget, this.interiorState);

    // Keep the framing distance whenever the room has room for it.
    const available = rayExitDistance(
      this.orbitTarget,
      direction,
      this.interiorState,
    );
    const upper = Math.max(Math.min(requested, available), EPSILON);
    const lower = Math.min(this.navigationLimits.minDistance, upper);
    const distance = clamp(requested, lower, upper);

    this.orbitDistance = distance;
    this.orbitPolar = clamp(
      Math.acos(clamp(direction.y, -1, 1)),
      this.navigationLimits.minPolar,
      this.navigationLimits.maxPolar,
    );
    this.orbitAzimuth = Math.atan2(direction.x, direction.z);

    this.focusTarget = resolved.position.clone();
    this.recomputeControlPose(0);
    this.currentFocusDistance = this.controlPosition.distanceTo(this.focusTarget);
    this.applyPose(options.immediate ?? false);
    return this.currentFocusDistance;
  }

  /**
   * Presents the close-up view of `target`.
   *
   * The current pose (mode, position, orientation and orbit state) is archived
   * first, so {@link exitInspect} — and the `Escape` key while attached —
   * returns the visitor exactly where they were.
   */
  inspect(target: Focusable, options: FocusOptions = {}): number {
    if (!this.isInspecting) {
      this.savedPose = this.savePose();
    }
    this.isInspecting = true;
    const distance = this.focus(target, { ...options, immediate: true });
    return distance;
  }

  /** Leaves inspect mode and restores the archived pose. Returns whether it restored. */
  exitInspect(): boolean {
    if (!this.isInspecting) return false;
    const pose = this.savedPose;
    this.isInspecting = false;
    this.savedPose = null;
    this.focusTarget = null;
    this.currentFocusDistance = null;
    if (pose) this.restorePose(pose);
    this.recomputeControlPose(0);
    this.applyPose(true);
    return true;
  }

  /** Archives the current pose, so it can be restored later. */
  savePose(): NavigationPose {
    return {
      mode: this.navigationMode,
      position: this.controlPosition.clone(),
      target: this.controlTarget.clone(),
      yaw: this.walkYaw,
      pitch: this.walkPitch,
      eyeHeight: this.walkEyeHeight,
      azimuth: this.orbitAzimuth,
      polar: this.orbitPolar,
      distance: this.orbitDistance,
    };
  }

  /** Restores a pose produced by {@link savePose}. */
  restorePose(pose: NavigationPose): void {
    this.navigationMode = pose.mode;
    this.walkYaw = finiteOr(pose.yaw, this.walkYaw);
    this.walkPitch = clamp(finiteOr(pose.pitch, this.walkPitch), -this.navigationLimits.maxPitch, this.navigationLimits.maxPitch);
    this.walkEyeHeight = clamp(
      finiteOr(pose.eyeHeight, this.walkEyeHeight),
      this.navigationLimits.minEyeHeight,
      this.navigationLimits.maxEyeHeight,
    );
    this.desiredEyeHeight = this.walkEyeHeight;
    this.walkPosition.set(pose.position.x, pose.position.y, pose.position.z);
    this.walkPosition.y = this.walkEyeHeight;
    clampPointToInterior(this.walkPosition, this.interiorState);
    this.orbitAzimuth = finiteOr(pose.azimuth, this.orbitAzimuth);
    this.orbitPolar = finiteOr(pose.polar, this.orbitPolar);
    this.orbitDistance = finiteOr(pose.distance, this.orbitDistance);
    this.orbitTarget.copy(pose.target);
    clampPointToInterior(this.orbitTarget, this.interiorState);
    this.moving = false;
    this.bobAmount = 0;
    this.recomputeControlPose(0);
    this.applyPose(true);
  }

  /* -- modes, bounds, motion preferences --------------------------------- */

  /** Switches between orbit and first-person walk. */
  setMode(mode: NavigationMode): void {
    if (mode === this.navigationMode) return;
    this.switchMode(mode);
    this.recomputeControlPose(0);
    this.applyPose(true);
  }

  /** Replaces the room shell; the visitor's pose is re-clamped to the new volume. */
  setBounds(bounds: RoomBounds, limits?: Partial<NavigationLimits> | null): void {
    this.roomBounds = bounds;
    this.navigationLimits = { ...defaultNavigationLimits(bounds) };
    if (this.explicitLimits) Object.assign(this.navigationLimits, this.explicitLimits);
    if (limits) Object.assign(this.navigationLimits, limits);
    this.interiorState = navigationInterior(this.roomBounds, this.navigationLimits);
    clampPointToInterior(this.orbitTarget, this.interiorState);
    clampPointToInterior(this.walkPosition, this.interiorState);
    this.walkEyeHeight = clamp(
      this.walkEyeHeight,
      this.navigationLimits.minEyeHeight,
      this.navigationLimits.maxEyeHeight,
    );
    this.desiredEyeHeight = clamp(
      this.desiredEyeHeight,
      this.navigationLimits.minEyeHeight,
      this.navigationLimits.maxEyeHeight,
    );
    this.orbitDistance = clamp(
      this.orbitDistance,
      this.navigationLimits.minDistance,
      this.navigationLimits.maxDistance,
    );
    this.recomputeControlPose(0);
    this.applyPose(true);
  }

  /** Sets reduced motion explicitly (damping and head bob are suppressed). */
  setReducedMotion(reduced: boolean): void {
    this.reducedMotionState = reduced;
    if (reduced) {
      this.bobAmount = 0;
      this.applyPose(true);
    }
  }

  /** Re-probes `prefers-reduced-motion` and applies the result. */
  refreshReducedMotion(): boolean {
    const reduced = this.prefersReducedMotionProbe() === true;
    this.setReducedMotion(reduced);
    return reduced;
  }

  /** Sets the walk eye height target; the pose steps towards it at the step limit. */
  setEyeHeight(height: number): void {
    this.desiredEyeHeight = clamp(
      finiteOr(height, this.desiredEyeHeight),
      this.navigationLimits.minEyeHeight,
      this.navigationLimits.maxEyeHeight,
    );
  }

  /* -- frame integration ------------------------------------------------- */

  /** Advances the controller by `deltaSeconds`; frame-rate independent. */
  update(deltaSeconds: number): void {
    const dt = Math.min(Math.max(finiteOr(deltaSeconds, 0), 0), this.maxDeltaSeconds);
    this.lastDeltaSeconds = dt;

    const gamepad = this.readGamepad();
    if (this.navigationMode === 'walk' && !this.isInspecting) {
      this.applyWalkInput(dt, gamepad);
    } else {
      this.applyOrbitInput(dt, gamepad);
    }

    this.recomputeControlPose(dt);
    this.applyPose(false);
    if (this.isInspecting && this.focusTarget) {
      this.currentFocusDistance = this.controlPosition.distanceTo(this.focusTarget);
    }
  }

  /* -- internals --------------------------------------------------------- */

  private bind(
    target: NavigationEventSource,
    type: string,
    handler: EventListener,
    group: 'input' | 'keyboard' | 'document' = 'input',
  ): void {
    target.addEventListener(type, handler);
    const entry: ListenerEntry = { target, type, handler };
    if (group === 'input') this.inputListeners.push(entry);
    else if (group === 'keyboard') this.keyboardListeners.push(entry);
    else this.documentListeners.push(entry);
  }

  private switchMode(mode: NavigationMode): void {
    const fromPosition = this.scratchA.copy(this.controlPosition);
    const fromTarget = this.scratchB.copy(this.controlTarget);
    this.navigationMode = mode;

    if (mode === 'walk') {
      this.walkEyeHeight = clamp(
        fromPosition.y,
        this.navigationLimits.minEyeHeight,
        this.navigationLimits.maxEyeHeight,
      );
      this.desiredEyeHeight = this.walkEyeHeight;
      this.walkPosition.set(fromPosition.x, this.walkEyeHeight, fromPosition.z);
      clampPointToInterior(this.walkPosition, this.interiorState);
      const direction = this.scratchC.copy(fromTarget).sub(fromPosition);
      if (direction.lengthSq() > 1e-8) {
        direction.normalize();
        this.walkYaw = Math.atan2(-direction.x, -direction.z);
        this.walkPitch = clamp(
          Math.asin(clamp(direction.y, -1, 1)),
          -this.navigationLimits.maxPitch,
          this.navigationLimits.maxPitch,
        );
      }
      return;
    }

    this.orbitTarget.copy(fromTarget);
    clampPointToInterior(this.orbitTarget, this.interiorState);
    const offset = this.scratchA.copy(fromPosition).sub(this.orbitTarget);
    const length = offset.length();
    if (length > EPSILON) {
      this.orbitDistance = clamp(
        length,
        this.navigationLimits.minDistance,
        this.navigationLimits.maxDistance,
      );
      this.orbitPolar = Math.acos(clamp(offset.y / length, -1, 1));
      this.orbitAzimuth = Math.atan2(offset.x, offset.z);
    }
  }

  private isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  private clampEyeHeight(height: number): number {
    return clamp(
      finiteOr(height, this.walkEyeHeight),
      this.navigationLimits.minEyeHeight,
      this.navigationLimits.maxEyeHeight,
    );
  }

  private lookDirection(out: THREE.Vector3): THREE.Vector3 {
    const cosPitch = Math.cos(this.walkPitch);
    return out
      .set(
        -Math.sin(this.walkYaw) * cosPitch,
        Math.sin(this.walkPitch),
        -Math.cos(this.walkYaw) * cosPitch,
      )
      .normalize();
  }

  private horizontalForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.walkYaw), 0, -Math.cos(this.walkYaw));
  }

  private horizontalRight(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.cos(this.walkYaw), 0, -Math.sin(this.walkYaw));
  }

  private applyWalkInput(dt: number, gamepad: GamepadInput | null): void {
    const forwardInput =
      (this.isKeyDown('KeyW') ? 1 : 0) - (this.isKeyDown('KeyS') ? 1 : 0) + (gamepad?.forward ?? 0);
    const strafeInput =
      (this.isKeyDown('KeyD') ? 1 : 0) - (this.isKeyDown('KeyA') ? 1 : 0) + (gamepad?.strafe ?? 0);
    const turnInput =
      (this.isKeyDown('ArrowRight') ? 1 : 0) - (this.isKeyDown('ArrowLeft') ? 1 : 0) + (gamepad?.turn ?? 0);
    const pitchInput =
      (this.isKeyDown('ArrowDown') ? 1 : 0) - (this.isKeyDown('ArrowUp') ? 1 : 0) + (gamepad?.look ?? 0);

    this.walkYaw -= turnInput * this.navigationLimits.turnSpeed * dt;
    this.walkPitch = clamp(
      this.walkPitch - pitchInput * this.navigationLimits.turnSpeed * dt,
      -this.navigationLimits.maxPitch,
      this.navigationLimits.maxPitch,
    );

    // Crouch: the vertical solve steps towards the target eye height.
    const crouching = this.isKeyDown('ControlLeft') || this.isKeyDown('ControlRight') || this.isKeyDown('KeyC');
    const targetEye = crouching
      ? this.navigationLimits.minEyeHeight
      : this.desiredEyeHeight;
    const maxEyeDelta = this.navigationLimits.maxEyeStep * dt;
    this.walkEyeHeight = this.clampEyeHeight(
      this.walkEyeHeight + clamp(targetEye - this.walkEyeHeight, -maxEyeDelta, maxEyeDelta),
    );

    const run =
      this.isKeyDown('ShiftLeft') || this.isKeyDown('ShiftRight')
        ? this.navigationLimits.runMultiplier
        : 1;
    const magnitude = Math.hypot(forwardInput, strafeInput);
    if (magnitude <= 1e-4) {
      this.moving = false;
      return;
    }
    this.moving = true;

    const forward = forwardInput / Math.max(magnitude, 1);
    const strafe = strafeInput / Math.max(magnitude, 1);
    const heading = this.horizontalForward(this.scratchA);
    const right = this.horizontalRight(this.scratchB);
    const speed = this.navigationLimits.walkSpeed * run;
    const dx = (heading.x * forward + right.x * strafe) * speed * dt;
    const dz = (heading.z * forward + right.z * strafe) * speed * dt;
    this.moveHorizontal(dx, dz);
  }

  /**
   * Moves on the ground plane in sub-steps of at most `maxStepDistance`, so a
   * single high-speed frame can never tunnel through the room shell.
   */
  private moveHorizontal(dx: number, dz: number): void {
    const distance = Math.hypot(dx, dz);
    if (!Number.isFinite(distance) || distance <= 0) return;
    const maxStep = Math.max(this.navigationLimits.maxStepDistance, 1e-3);
    const steps = Math.min(Math.max(Math.ceil(distance / maxStep), 1), 4096);
    const stepX = dx / steps;
    const stepZ = dz / steps;
    for (let index = 0; index < steps; index += 1) {
      this.walkPosition.x += stepX;
      this.walkPosition.z += stepZ;
      clampPointToInterior(this.walkPosition, this.interiorState);
    }
  }

  private applyOrbitInput(dt: number, gamepad: GamepadInput | null): void {
    const turnInput =
      (this.isKeyDown('ArrowRight') ? 1 : 0) - (this.isKeyDown('ArrowLeft') ? 1 : 0) + (gamepad?.turn ?? 0);
    const pitchInput =
      (this.isKeyDown('ArrowDown') ? 1 : 0) - (this.isKeyDown('ArrowUp') ? 1 : 0) + (gamepad?.look ?? 0);
    if (turnInput !== 0) {
      this.orbitAzimuth -= turnInput * this.navigationLimits.turnSpeed * dt;
    }
    if (pitchInput !== 0) {
      this.orbitPolar += pitchInput * this.navigationLimits.turnSpeed * dt;
    }
    const zoomInput = gamepad?.zoom ?? 0;
    if (Math.abs(zoomInput) > 1e-4) {
      this.orbitDistance = clamp(
        this.orbitDistance * Math.exp(-zoomInput * this.navigationLimits.zoomSpeed * 60 * dt),
        this.navigationLimits.minDistance,
        this.navigationLimits.maxDistance,
      );
    }
  }

  /** Polar range that keeps the camera between the floor and the ceiling. */
  private polarLimits(distance: number, target: THREE.Vector3): { min: number; max: number } {
    const { minY, maxY } = this.interiorState;
    let dynamicMin = 0;
    let dynamicMax = Math.PI;
    const headroom = maxY - target.y;
    if (headroom < distance) {
      dynamicMin = Math.acos(clamp(headroom / distance, -1, 1));
    }
    const footroom = minY - target.y;
    if (footroom > -distance) {
      dynamicMax = Math.acos(clamp(footroom / distance, -1, 1));
    }
    const min = Math.max(this.navigationLimits.minPolar, dynamicMin);
    const max = Math.min(this.navigationLimits.maxPolar, dynamicMax);
    if (min > max) {
      const mid = (min + max) / 2;
      return { min: mid, max: mid };
    }
    return { min, max };
  }

  private updateBob(dt: number): number {
    if (!this.headBob || this.reducedMotionState) {
      this.bobAmount = 0;
      return 0;
    }
    const target = this.moving ? 1 : 0;
    const rate = 6;
    this.bobAmount += clamp(target - this.bobAmount, -rate * dt, rate * dt);
    if (this.bobAmount <= 1e-4) return 0;
    this.bobPhase += dt * this.headBob.frequency * Math.PI * 2;
    return Math.sin(this.bobPhase) * this.headBob.amplitude * this.bobAmount;
  }

  /** Derives the control pose (clamped) from the active mode's state. */
  private recomputeControlPose(dt: number): void {
    if (this.navigationMode === 'walk' && !this.isInspecting) {
      this.walkEyeHeight = this.clampEyeHeight(this.walkEyeHeight);
      this.walkPosition.y = this.walkEyeHeight;
      clampPointToInterior(this.walkPosition, this.interiorState);
      this.controlPosition.copy(this.walkPosition);
      const bob = this.updateBob(dt);
      if (bob !== 0) {
        this.controlPosition.y = clamp(
          this.walkPosition.y + bob,
          this.interiorState.minY,
          this.interiorState.maxY,
        );
      }
      this.controlTarget.copy(this.controlPosition).add(this.lookDirection(this.scratchA));
      return;
    }

    const target = this.orbitTarget;
    let distance = clamp(
      this.orbitDistance,
      this.navigationLimits.minDistance,
      this.navigationLimits.maxDistance,
    );
    const polar = this.polarLimits(distance, target);
    this.orbitPolar = clamp(this.orbitPolar, polar.min, polar.max);

    const sinPolar = Math.sin(this.orbitPolar);
    const cosPolar = Math.cos(this.orbitPolar);
    const direction = this.scratchA.set(
      sinPolar * Math.sin(this.orbitAzimuth),
      cosPolar,
      sinPolar * Math.cos(this.orbitAzimuth),
    );

    // Never place the camera outside the shell: limit the radius by the room.
    const available = rayExitDistance(target, direction, this.interiorState);
    const upper = Math.max(Math.min(this.navigationLimits.maxDistance, available), EPSILON);
    const lower = Math.min(this.navigationLimits.minDistance, upper);
    distance = clamp(distance, lower, upper);

    const position = this.scratchB
      .copy(target)
      .addScaledVector(direction, distance);
    clampPointToInterior(position, this.interiorState);

    this.controlPosition.copy(position);
    this.controlTarget.copy(target);

    // Keep the spherical state consistent with whatever survived the clamps.
    const offset = position.sub(target);
    const length = offset.length();
    if (length > EPSILON) {
      this.orbitDistance = length;
      this.orbitPolar = clamp(Math.acos(clamp(offset.y / length, -1, 1)), 0, Math.PI);
      this.orbitAzimuth = Math.atan2(offset.x, offset.z);
    } else {
      this.orbitDistance = this.navigationLimits.minDistance;
    }
  }

  private applyPose(immediate: boolean): void {
    const snap = immediate || this.damping <= 0 || this.reducedMotionState || !this.hasAppliedPose;
    if (snap) {
      this.appliedPosition.copy(this.controlPosition);
      this.appliedTarget.copy(this.controlTarget);
      this.hasAppliedPose = true;
    } else {
      const alpha = 1 - Math.exp(-this.damping * this.lastDeltaSeconds);
      this.appliedPosition.lerp(this.controlPosition, alpha);
      this.appliedTarget.lerp(this.controlTarget, alpha);
    }

    if (this.appliedTarget.distanceToSquared(this.appliedPosition) < 1e-10) {
      this.appliedTarget.copy(this.appliedPosition).add(this.lookDirection(this.scratchA));
    }
    this.writeCamera();
  }

  private writeCamera(): void {
    if (this.rig) {
      // Immediate: the controller owns the frame-rate independent solve, and the
      // projection (fov, near, far) stays with the kernel's rig.
      this.rig.view({ position: this.appliedPosition, target: this.appliedTarget }, true);
      return;
    }
    this.camera.position.copy(this.appliedPosition);
    this.camera.lookAt(this.appliedTarget);
  }

  private readGamepad(): GamepadInput | null {
    const source = this.gamepadSource;
    if (!source) return null;
    let pads: readonly (NavigationGamepadLike | null)[] | null;
    try {
      pads = source();
    } catch {
      return null;
    }
    if (!pads) return null;
    for (const pad of pads) {
      if (!pad) continue;
      const axes = pad.axes;
      const forward = -deadzone(axisValue(axes, 1));
      const strafe = deadzone(axisValue(axes, 0));
      const turn = deadzone(axisValue(axes, 2));
      const look = deadzone(axisValue(axes, 3));
      const zoom = deadzone(buttonValue(pad, 7)) - deadzone(buttonValue(pad, 6));
      if (forward !== 0 || strafe !== 0 || turn !== 0 || look !== 0 || zoom !== 0) {
        return { forward, strafe, turn, look, zoom };
      }
    }
    return null;
  }

  private applyLook(deltaX: number, deltaY: number): void {
    this.walkYaw -= finiteOr(deltaX, 0) * this.navigationLimits.lookSpeed;
    this.walkPitch = clamp(
      this.walkPitch - finiteOr(deltaY, 0) * this.navigationLimits.lookSpeed,
      -this.navigationLimits.maxPitch,
      this.navigationLimits.maxPitch,
    );
  }

  private applyDragOrbit(deltaX: number, deltaY: number): void {
    this.orbit(-finiteOr(deltaX, 0) * this.navigationLimits.orbitSpeed, finiteOr(deltaY, 0) * this.navigationLimits.orbitSpeed);
  }

  /* -- event handlers ---------------------------------------------------- */

  private readonly handlePointerDown = (event: Event): void => {
    const pointer = event as PointerEvent & { pointerId?: number; pointerType?: string };
    const button = readNumber((pointer as { button?: unknown }).button, 0);
    if (button !== 0) return;
    if (pointer.pointerType === 'touch') return; // touch is handled by the touch listeners

    const clientX = readNumber((pointer as { clientX?: unknown }).clientX, 0);
    const clientY = readNumber((pointer as { clientY?: unknown }).clientY, 0);

    if (this.navigationMode === 'walk' && !this.isInspecting) {
      this.requestPointerLock();
    }
    this.dragging = true;
    this.lastPointerX = clientX;
    this.lastPointerY = clientY;
    const pointerId = pointer.pointerId;
    if (typeof pointerId === 'number' && typeof this.element?.setPointerCapture === 'function') {
      this.activePointerId = pointerId;
      try {
        this.element.setPointerCapture(pointerId);
      } catch {
        // Capture is best effort; dragging still works from client coordinates.
      }
    }
  };

  private readonly handlePointerMove = (event: Event): void => {
    const pointer = event as PointerEvent & {
      pointerId?: number;
      pointerType?: string;
      movementX?: number;
      movementY?: number;
      clientX?: number;
      clientY?: number;
    };
    if (pointer.pointerType === 'touch') return;

    if (this.pointerLockActive) {
      const movementX = readNumber(pointer.movementX, 0);
      const movementY = readNumber(pointer.movementY, 0);
      if (this.navigationMode === 'walk' && !this.isInspecting) {
        this.applyLook(movementX, movementY);
      } else {
        this.applyDragOrbit(movementX, movementY);
      }
      return;
    }

    if (!this.dragging) return;
    const clientX = readNumber(pointer.clientX, this.lastPointerX);
    const clientY = readNumber(pointer.clientY, this.lastPointerY);
    const deltaX = clientX - this.lastPointerX;
    const deltaY = clientY - this.lastPointerY;
    this.lastPointerX = clientX;
    this.lastPointerY = clientY;

    if (this.navigationMode === 'walk' && !this.isInspecting) {
      this.applyLook(deltaX, deltaY);
    } else {
      this.applyDragOrbit(deltaX, deltaY);
    }
  };

  private readonly handlePointerEnd = (event: Event): void => {
    const pointerId = readNumber((event as { pointerId?: unknown }).pointerId, -1);
    this.dragging = false;
    if (
      this.activePointerId !== null &&
      (pointerId === -1 || pointerId === this.activePointerId) &&
      typeof this.element?.releasePointerCapture === 'function'
    ) {
      try {
        this.element.releasePointerCapture(this.activePointerId);
      } catch {
        // Ignore: the capture may already be gone.
      }
    }
    this.activePointerId = null;
  };

  private readonly handleWheel = (event: Event): void => {
    const wheel = event as WheelEvent;
    if (this.navigationMode === 'walk' && !this.isInspecting) return;
    const deltaY = readNumber((wheel as { deltaY?: unknown }).deltaY, 0);
    if (deltaY === 0) return;
    this.zoomBy(Math.exp(deltaY * this.navigationLimits.zoomSpeed));
    if (wheel.cancelable === true && typeof wheel.preventDefault === 'function') {
      wheel.preventDefault();
    }
  };

  private readonly handleKeyDown = (event: Event): void => {
    const keyboard = event as KeyboardEvent;
    const code = keyCode(keyboard);
    if (code === null) return;
    if (code === 'Escape') {
      if (this.isInspecting) this.exitInspect();
      return;
    }
    this.keys.add(code);
    if (MOVEMENT_CODES.has(code) && keyboard.cancelable === true && typeof keyboard.preventDefault === 'function') {
      keyboard.preventDefault();
    }
  };

  private readonly handleKeyUp = (event: Event): void => {
    const code = keyCode(event as KeyboardEvent);
    if (code === null) return;
    this.keys.delete(code);
  };

  private readonly handleTouchStart = (event: Event): void => {
    const touches = touchList(event);
    if (touches.length === 0) return;
    this.touchActive = true;
    if (touches.length >= 2) {
      const first = touches[0];
      const second = touches[1];
      this.lastPinchSpan = first && second ? touchSpan(first, second) : 0;
      this.touchIdentifier = null;
      return;
    }
    const touch = touches[0];
    if (!touch) return;
    this.touchIdentifier = touch.identifier;
    this.lastTouchX = touch.clientX;
    this.lastTouchY = touch.clientY;
  };

  private readonly handleTouchMove = (event: Event): void => {
    if (!this.touchActive) return;
    const touches = touchList(event);
    if (touches.length === 0) return;

    if (touches.length >= 2) {
      const first = touches[0];
      const second = touches[1];
      if (!first || !second) return;
      const span = touchSpan(first, second);
      if (this.lastPinchSpan > EPSILON && span > EPSILON && this.navigationMode !== 'walk') {
        this.zoomBy(this.lastPinchSpan / span);
      }
      this.lastPinchSpan = span;
      return;
    }

    const touch = touches[0];
    if (!touch) return;
    if (this.touchIdentifier !== null && touch.identifier !== this.touchIdentifier) return;
    const deltaX = touch.clientX - this.lastTouchX;
    const deltaY = touch.clientY - this.lastTouchY;
    this.lastTouchX = touch.clientX;
    this.lastTouchY = touch.clientY;

    if (this.navigationMode === 'walk' && !this.isInspecting) {
      this.applyLook(deltaX * 1.4, deltaY * 1.4);
    } else {
      this.applyDragOrbit(deltaX, deltaY);
    }
  };

  private readonly handleTouchEnd = (event: Event): void => {
    const touches = touchList(event);
    if (touches.length === 0) {
      this.touchActive = false;
      this.touchIdentifier = null;
      this.lastPinchSpan = 0;
      return;
    }
    const remaining = touches[0];
    if (remaining && touches.length < 2) {
      this.touchIdentifier = remaining.identifier;
      this.lastTouchX = remaining.clientX;
      this.lastTouchY = remaining.clientY;
      this.lastPinchSpan = 0;
      return;
    }
    this.lastPinchSpan = 0;
  };

  private readonly handlePointerLockChange = (): void => {
    const ownerDocument = this.ownerDocument;
    const locked = Boolean(
      ownerDocument && this.element && ownerDocument.pointerLockElement === this.element,
    );
    this.pointerLockActive = locked;
    if (!locked) this.dragging = false;
  };

  private readonly handlePointerLockError = (): void => {
    this.pointerLockActive = false;
    this.dragging = false;
  };
}

/* -------------------------------------------------------------------------- */
/* Input reading helpers                                                      */
/* -------------------------------------------------------------------------- */

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function keyCode(event: KeyboardEvent): string | null {
  const code = (event as { code?: unknown }).code;
  if (typeof code === 'string' && code.length > 0) return code;
  const key = (event as { key?: unknown }).key;
  if (typeof key === 'string' && key.length > 0) return key;
  return null;
}

interface TouchPointLike {
  readonly identifier: number;
  readonly clientX: number;
  readonly clientY: number;
}

function touchList(event: Event): readonly TouchPointLike[] {
  const touches = (event as { touches?: unknown }).touches;
  if (!touches || typeof touches !== 'object') return [];
  const list = touches as ArrayLike<unknown>;
  const result: TouchPointLike[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index] as Partial<TouchPointLike> | undefined;
    if (!entry) continue;
    result.push({
      identifier: readNumber(entry.identifier, index),
      clientX: readNumber(entry.clientX, 0),
      clientY: readNumber(entry.clientY, 0),
    });
  }
  return result;
}

function touchSpan(a: TouchPointLike, b: TouchPointLike): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function axisValue(axes: readonly number[], index: number): number {
  const value = axes[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function buttonValue(gamepad: NavigationGamepadLike, index: number): number {
  const button = gamepad.buttons[index];
  if (!button) return 0;
  if (typeof button.value === 'number' && Number.isFinite(button.value) && button.value > 0) {
    return button.value;
  }
  return button.pressed ? 1 : 0;
}

function deadzone(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= GAMEPAD_DEADZONE) return 0;
  const scaled = (magnitude - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE);
  return Math.sign(value) * Math.min(scaled, 1);
}

/* -------------------------------------------------------------------------- */
/* Factory                                                                    */
/* -------------------------------------------------------------------------- */

/** Convenience constructor mirroring the class API. */
export function createNavigationController(
  options: NavigationControllerOptions,
): NavigationController {
  return new NavigationController(options);
}
