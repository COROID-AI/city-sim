/**
 * Chrono City camera controls.
 *
 * This module is the navigation half of the camera API: a damped, bounds-aware
 * orbit/pan/zoom rig driven by mouse, wheel, touch, pinch and keyboard input,
 * with named layout landmarks as preset views, reset and smooth automated
 * glides. It also declares the *pickable / info-card contract* that
 * `./focus` implements, so scene assembly has a single import surface for
 * "navigate around and look at things".
 *
 * Design rules this file follows:
 * - It reads the shared layout contract (`src/scene/layout.ts`) only: block
 *   bounds, lots, streets, sidewalks, prop anchors and camera landmarks. It
 *   never imports scene content modules, so any system's objects can be plugged
 *   in through {@link FocusTarget} registrations instead of hard-coded picks.
 * - Every input and every `update` tick re-clamps the pivot into the block
 *   envelope, the eye into the surrounding navigation volume, the boom length
 *   and the pitch into the configured clamps, and the eye above ground
 *   clearance. Bounds are never violated, even for a single huge delta.
 * - Motion is damped with an exponential (frame-rate independent) filter and
 *   keyboard movement integrates `speed * delta`, so a 30 Hz and a 60 Hz client
 *   end up in exactly the same place after the same wall-clock time.
 * - The rig deliberately ignores era morphs ({@link CameraRig.applyEra} is a
 *   no-op): during a transition the user keeps their pose, and any user input
 *   cancels an in-flight automated glide so interaction always wins.
 */

import * as THREE from "three";

import type { EraAware, EraId, TransitionEasing } from "../era/eraTypes";
import {
  CITY_LAYOUT,
  type Bounds2D,
  type CameraLandmark,
  type CityLayout,
  type WorldPoint,
} from "../scene/layout";

/* -------------------------------------------------------------------------- */
/* Click-to-inspect contract (implemented by `./focus`)                       */
/* -------------------------------------------------------------------------- */

/** Broad category of a pickable, used by the info card for iconography/theming. */
export type FocusKind = "building" | "vehicle" | "pedestrian" | "prop" | "signage" | "landmark" | "other";

/** Why a focus event fired; lets the HUD distinguish clicks from presets. */
export type FocusSource = "raycast" | "landmark" | "api" | "era";

/** Why a focus-clear event fired. */
export type FocusClearSource = "raycast" | "escape" | "api";

/**
 * Era-specific label override.
 *
 * The base {@link FocusTarget} label is era-neutral; an override lets a system
 * describe the *same* object differently in 1945 and in 2025 (for example a
 * haberdashery that becomes a phone-repair shop) without the camera or the HUD
 * knowing anything about eras.
 */
export interface FocusLabelOverride {
  readonly title?: string;
  readonly description?: string;
  readonly facts?: Readonly<Record<string, string | number>>;
}

/**
 * How one pickable object describes itself to the camera and the info card.
 *
 * Scene assembly (or any scene system) supplies these alongside the objects it
 * wants to be clickable; the camera never introspects scene content.
 */
export interface FocusTarget {
  /** Stable id, unique within the registry. */
  readonly id: string;
  readonly kind: FocusKind;
  /** Era-neutral label; superseded by {@link eraLabels} when an override exists. */
  readonly title: string;
  readonly description?: string;
  /** Era-neutral detail rows rendered by the info card. */
  readonly facts?: Readonly<Record<string, string | number>>;
  readonly eraLabels?: Readonly<Partial<Record<EraId, FocusLabelOverride>>>;
  /** Explicit world-space focus point; defaults to the object's bounding-box centre. */
  readonly focusPoint?: WorldPoint;
  /** Explicit framing radius in metres; defaults to the object's bounding sphere. */
  readonly radius?: number;
}

/** Everything the HUD info card needs to render the currently focused object. */
export interface FocusInfo {
  readonly id: string;
  readonly kind: FocusKind;
  /** Era the label data was resolved for. */
  readonly era: EraId;
  readonly title: string;
  readonly description: string;
  readonly facts: Readonly<Record<string, string | number>>;
  /** World-space point the camera framed. */
  readonly worldPosition: WorldPoint;
  /** Framing radius (metres) used to compute the glide distance. */
  readonly radius: number;
  /** Set when the focus came from a layout landmark preset. */
  readonly landmarkId?: string;
}

/** Payload of a `focus` event: the info-card data plus the framed camera pose. */
export interface FocusEventPayload {
  readonly info: FocusInfo;
  /** Picked object, or `null` for landmark presets. */
  readonly object: THREE.Object3D | null;
  /** Goal pose the camera is gliding to (or already at). */
  readonly pose: CameraPose;
  /** Normalized device coordinates of the activating gesture. */
  readonly pointer: Readonly<{ x: number; y: number }>;
  readonly source: FocusSource;
}

/** Payload of a `focus-cleared` event: the info card should hide. */
export interface FocusClearedPayload {
  readonly era: EraId;
  readonly source: FocusClearSource;
}

/** Event map emitted by the click-to-focus controller. */
export interface FocusEventMap {
  readonly focus: FocusEventPayload;
  readonly "focus-cleared": FocusClearedPayload;
}

export type FocusEventName = keyof FocusEventMap;

export type FocusListener<K extends FocusEventName> = (event: FocusEventMap[K]) => void;

/**
 * Minimal shape of a scene system the camera can pick from.
 *
 * Matches `SceneSystem` from `../era/eraTypes` structurally, so a mounted
 * system can be registered directly without the camera depending on its
 * implementation details.
 */
export interface PickableSource {
  readonly id?: string;
  getPickables(): readonly THREE.Object3D[];
}

/* -------------------------------------------------------------------------- */
/* Small shared math                                                          */
/* -------------------------------------------------------------------------- */

/** Clamps `value` into `[min, max]`, mapping non-finite input to `min`. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function lerpPoint(from: WorldPoint, to: WorldPoint, t: number): WorldPoint {
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), z: lerp(from.z, to.z, t) };
}

/** Wraps an angle into `(-PI, PI]`. */
export function wrapAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) return wrapped - Math.PI * 2;
  if (wrapped <= -Math.PI) return wrapped + Math.PI * 2;
  return wrapped;
}

/** Shortest signed angular delta from `from` to `to`, in radians. */
export function shortestAngleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/**
 * Frame-rate independent damping factor for a first-order exponential filter.
 *
 * Subdividing a step in two halves yields the exact same result after the same
 * elapsed time (`alpha(dt1) + alpha(dt2)` composes through the exponential), so
 * the rig behaves identically at 30, 60 or 144 Hz.
 */
export function dampingAlpha(damping: number, deltaSeconds: number): number {
  if (!Number.isFinite(damping) || damping <= 0) return 1;
  const delta = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
  return clamp(1 - Math.exp(-damping * delta), 0, 1);
}

/** Applies one of the era transition easing curves to a `0..1` progress value. */
export function applyEasing(easing: TransitionEasing, progress: number): number {
  const t = clamp(progress, 0, 1);
  switch (easing) {
    case "linear":
      return t;
    case "ease-out":
      return 1 - (1 - t) ** 3;
    case "spring":
      return t >= 1 ? 1 : clamp(1 - Math.exp(-7 * t) * Math.cos(9 * t), 0, 1.2);
    case "ease-in-out":
    default:
      return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  }
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/** Fallback vertical field of view, mirroring the shell camera in `src/core/renderer.ts`. */
export const DEFAULT_CAMERA_FOV = 55;
/** Fallback near plane, mirroring the shell camera. */
export const DEFAULT_CAMERA_NEAR = 0.1;
/** Fallback far plane, mirroring the shell camera. */
export const DEFAULT_CAMERA_FAR = 800;
/** Viewport used when the caller does not supply one (pan/zoom scaling only). */
export const DEFAULT_CAMERA_VIEWPORT: CameraViewport = { width: 1280, height: 720 };
/** Largest delta the rig integrates in one tick, so tab switches cannot teleport it. */
export const MAX_FRAME_DELTA_SECONDS = 0.25;

/** Full tunable surface of the camera rig. */
export interface CameraControlConfig {
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  /** Closest and farthest boom length around the pivot, in metres. */
  readonly minDistance: number;
  readonly maxDistance: number;
  /** Elevation clamp of the eye above the pivot, in radians. */
  readonly minPitch: number;
  readonly maxPitch: number;
  /** Ground clearance: the eye never drops below this height, in metres. */
  readonly minEyeHeight: number;
  /** Pivot height clamp, in metres. */
  readonly minTargetHeight: number;
  readonly maxTargetHeight: number;
  /** Margin added around the block envelope when deriving navigation bounds. */
  readonly boundsPadding: number;
  /** Exponential damping rate in 1/seconds. */
  readonly damping: number;
  /** Radians of orbit per pixel of drag. */
  readonly orbitSensitivity: number;
  /** Multiplier applied to the view-plane metres-per-pixel pan scale. */
  readonly panSensitivity: number;
  /** Exponential zoom response per wheel delta unit. */
  readonly zoomSensitivity: number;
  /** Keyboard movement speed in metres per second. */
  readonly moveSpeed: number;
  readonly boostMultiplier: number;
  /** Keyboard yaw speed in radians per second. */
  readonly yawSpeed: number;
  /** Automated glide defaults. */
  readonly glideDurationMs: number;
  readonly glideEasing: TransitionEasing;
  /** Glide duration used when focusing a scene object or landmark. */
  readonly focusGlideDurationMs: number;
  /** Framing margin (>1 leaves breathing room around the focused object). */
  readonly focusMargin: number;
  /** Elevation kept when framing a focused object, in radians. */
  readonly focusPitch: number;
  /** Pixel movement below which a press/release counts as a click or tap. */
  readonly clickTolerancePx: number;
}

/** Authored defaults for every tunable. */
export const CAMERA_CONTROL_DEFAULTS: CameraControlConfig = {
  fov: DEFAULT_CAMERA_FOV,
  near: DEFAULT_CAMERA_NEAR,
  far: DEFAULT_CAMERA_FAR,
  minDistance: 6,
  maxDistance: 240,
  // ~3 deg above the pivot plane keeps street-level landmark views reachable.
  minPitch: 0.05,
  maxPitch: 1.45,
  minEyeHeight: 1.6,
  minTargetHeight: 0,
  maxTargetHeight: 30,
  boundsPadding: 12,
  damping: 9,
  orbitSensitivity: 0.0055,
  panSensitivity: 1,
  zoomSensitivity: 0.0016,
  moveSpeed: 16,
  boostMultiplier: 2.6,
  yawSpeed: 1.3,
  glideDurationMs: 900,
  glideEasing: "ease-in-out",
  focusGlideDurationMs: 750,
  focusMargin: 1.25,
  focusPitch: 0.5,
  clickTolerancePx: 6,
};

/* -------------------------------------------------------------------------- */
/* Navigation bounds                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Spatial envelope the camera may occupy.
 *
 * `target` is the ground envelope of the block *neighbourhood*: the central
 * block plus its streets and frontage lots, so panning is bounded to the block
 * and every lot can be framed. `eye` is the same envelope grown to include the
 * perimeter streets, sidewalks and every authored landmark position, plus
 * {@link CameraControlConfig.boundsPadding}: it is what stops the eye from
 * flying off into empty space while still allowing the elevated landmark views.
 */
export interface NavigationBounds {
  readonly target: Bounds2D;
  readonly targetMinY: number;
  readonly targetMaxY: number;
  readonly eye: Bounds2D;
  readonly eyeMinY: number;
  readonly eyeMaxY: number;
}

type BoundsConfig = Pick<
  CameraControlConfig,
  "boundsPadding" | "minEyeHeight" | "minTargetHeight" | "maxTargetHeight"
>;

/**
 * Derives the navigation envelope from the shared layout contract.
 *
 * Nothing is hard-coded: streets, lots and landmarks are folded in, so a layout
 * change automatically moves the camera's playable volume with it.
 */
export function createNavigationBounds(
  layout: CityLayout = CITY_LAYOUT,
  config: BoundsConfig = CAMERA_CONTROL_DEFAULTS,
): NavigationBounds {
  let minX = layout.block.bounds.minX;
  let maxX = layout.block.bounds.maxX;
  let minZ = layout.block.bounds.minZ;
  let maxZ = layout.block.bounds.maxZ;

  const include = (x: number, z: number): void => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };

  const includeBounds = (bounds: Bounds2D): void => {
    include(bounds.minX, bounds.minZ);
    include(bounds.maxX, bounds.maxZ);
  };

  for (const lot of layout.lots) includeBounds(lot.bounds);
  for (const street of layout.streets) {
    const vertical = street.side === "east" || street.side === "west";
    const alongX = vertical ? street.width / 2 : street.length / 2;
    const alongZ = vertical ? street.length / 2 : street.width / 2;
    include(street.center.x - alongX, street.center.z - alongZ);
    include(street.center.x + alongX, street.center.z + alongZ);
  }
  for (const slot of layout.propSlots) include(slot.anchor.position.x, slot.anchor.position.z);

  const target: Bounds2D = { minX, maxX, minZ, maxZ };

  let eyeMinX = minX;
  let eyeMaxX = maxX;
  let eyeMinZ = minZ;
  let eyeMaxZ = maxZ;
  let highestEye = layout.block.center.y;
  for (const landmark of layout.cameraLandmarks) {
    eyeMinX = Math.min(eyeMinX, landmark.position.x, landmark.target.x);
    eyeMaxX = Math.max(eyeMaxX, landmark.position.x, landmark.target.x);
    eyeMinZ = Math.min(eyeMinZ, landmark.position.z, landmark.target.z);
    eyeMaxZ = Math.max(eyeMaxZ, landmark.position.z, landmark.target.z);
    highestEye = Math.max(highestEye, landmark.position.y);
  }

  const padding = Math.max(0, config.boundsPadding);
  return {
    target,
    targetMinY: config.minTargetHeight,
    targetMaxY: config.maxTargetHeight,
    eye: {
      minX: eyeMinX - padding,
      maxX: eyeMaxX + padding,
      minZ: eyeMinZ - padding,
      maxZ: eyeMaxZ + padding,
    },
    eyeMinY: config.minEyeHeight,
    eyeMaxY: Math.max(highestEye, config.maxTargetHeight) + padding,
  };
}

/** Navigation envelope derived from the canonical block layout. */
export const DEFAULT_NAVIGATION_BOUNDS: NavigationBounds = createNavigationBounds(CITY_LAYOUT, CAMERA_CONTROL_DEFAULTS);

/* -------------------------------------------------------------------------- */
/* Orbit math                                                                 */
/* -------------------------------------------------------------------------- */

/** A camera pose: eye position plus look-at pivot. */
export interface CameraPose {
  readonly position: WorldPoint;
  readonly target: WorldPoint;
}

/**
 * Spherical orbit state around a pivot.
 *
 * `azimuth` is measured on the ground plane from `+X` towards `+Z`; `pitch` is
 * the elevation of the eye above the pivot plane. This representation is what
 * makes clamping cheap and exactly enforceable: clamps apply to scalars, and the
 * eye is always derived from the clamped state.
 */
export interface OrbitState {
  readonly target: WorldPoint;
  readonly distance: number;
  readonly azimuth: number;
  readonly pitch: number;
}

/** Unit vector from the pivot towards the eye. */
export function orbitOffsetDirection(azimuth: number, pitch: number): WorldPoint {
  const horizontal = Math.cos(pitch);
  return { x: horizontal * Math.cos(azimuth), y: Math.sin(pitch), z: horizontal * Math.sin(azimuth) };
}

/** Converts orbit state to an eye/pivot pose. */
export function orbitToPose(state: OrbitState): CameraPose {
  const direction = orbitOffsetDirection(state.azimuth, state.pitch);
  return {
    position: {
      x: state.target.x + direction.x * state.distance,
      y: state.target.y + direction.y * state.distance,
      z: state.target.z + direction.z * state.distance,
    },
    target: { x: state.target.x, y: state.target.y, z: state.target.z },
  };
}

/** Converts an eye/pivot pose back to orbit state (inverse of {@link orbitToPose}). */
export function poseToOrbit(pose: CameraPose): OrbitState {
  const dx = pose.position.x - pose.target.x;
  const dy = pose.position.y - pose.target.y;
  const dz = pose.position.z - pose.target.z;
  const horizontal = Math.hypot(dx, dz);
  return {
    target: { x: pose.target.x, y: pose.target.y, z: pose.target.z },
    distance: Math.max(1e-6, Math.hypot(horizontal, dy)),
    azimuth: Math.atan2(dz, dx),
    pitch: Math.atan2(dy, horizontal),
  };
}

/**
 * Distance along `direction` from `origin` until the eye envelope is left.
 *
 * `origin` is assumed to be inside the envelope (the pivot always is), so the
 * boom can always be shortened to keep the eye inside without moving the pivot.
 */
export function travelToEyeBounds(
  origin: WorldPoint,
  direction: WorldPoint,
  bounds: NavigationBounds,
): number {
  const axis = (originValue: number, directionValue: number, min: number, max: number): number => {
    if (Math.abs(directionValue) < 1e-9) return Number.POSITIVE_INFINITY;
    const limit = directionValue > 0 ? max : min;
    return (limit - originValue) / directionValue;
  };
  const travel = Math.min(
    axis(origin.x, direction.x, bounds.eye.minX, bounds.eye.maxX),
    axis(origin.z, direction.z, bounds.eye.minZ, bounds.eye.maxZ),
    axis(origin.y, direction.y, bounds.eyeMinY, bounds.eyeMaxY),
  );
  return Number.isFinite(travel) ? Math.max(0, travel) : 0;
}

/**
 * Re-clamps an orbit state into the block envelope, boom clamps, pitch clamps
 * and ground clearance.
 *
 * Applied to the *desired* state on every input and to the *current* state on
 * every tick, so no input path can escape the bounds. Idempotent: normalizing
 * an already-normalized state is a no-op.
 */
export function normalizeOrbit(
  state: OrbitState,
  bounds: NavigationBounds,
  config: CameraControlConfig = CAMERA_CONTROL_DEFAULTS,
): OrbitState {
  const target: WorldPoint = {
    x: clamp(state.target.x, bounds.target.minX, bounds.target.maxX),
    y: clamp(state.target.y, bounds.targetMinY, bounds.targetMaxY),
    z: clamp(state.target.z, bounds.target.minZ, bounds.target.maxZ),
  };
  const azimuth = wrapAngle(state.azimuth);
  const pitch = clamp(state.pitch, config.minPitch, config.maxPitch);
  const direction = orbitOffsetDirection(azimuth, pitch);

  let distance = clamp(state.distance, config.minDistance, config.maxDistance);
  const travel = travelToEyeBounds(target, direction, bounds);
  distance = Math.min(distance, travel);
  distance = Math.max(distance, Math.min(config.minDistance, travel));

  const eye: WorldPoint = {
    x: target.x + direction.x * distance,
    y: target.y + direction.y * distance,
    z: target.z + direction.z * distance,
  };
  // Ground clearance: raising the eye only increases the effective pitch, which
  // is bounded well below `maxPitch` whenever this branch can trigger.
  const clampedEye: WorldPoint = { ...eye, y: clamp(eye.y, bounds.eyeMinY, bounds.eyeMaxY) };

  return poseToOrbit({ position: clampedEye, target });
}

/** Linear interpolation between two orbit states along the shortest arc. */
export function interpolateOrbit(from: OrbitState, to: OrbitState, t: number): OrbitState {
  return {
    target: lerpPoint(from.target, to.target, t),
    distance: lerp(from.distance, to.distance, t),
    azimuth: from.azimuth + shortestAngleDelta(from.azimuth, to.azimuth) * t,
    pitch: lerp(from.pitch, to.pitch, t),
  };
}

/** Boom length that frames a sphere of `radius` inside the vertical field of view. */
export function framingDistance(
  radius: number,
  fovDegrees: number,
  margin: number,
  minDistance: number,
  maxDistance: number,
): number {
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;
  const halfFov = (clamp(fovDegrees, 5, 175) * Math.PI) / 360;
  const fit = safeRadius / Math.max(1e-3, Math.sin(halfFov));
  return clamp(fit * Math.max(0.1, margin), minDistance, maxDistance);
}

/* -------------------------------------------------------------------------- */
/* Input types                                                                */
/* -------------------------------------------------------------------------- */

export interface CameraViewport {
  readonly width: number;
  readonly height: number;
}

/** One touch contact in element-local pixels. */
export interface TouchSample {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

export type DragMode = "orbit" | "pan";

/** Actions the rig understands from the keyboard. */
export type KeyAction =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "yaw-left"
  | "yaw-right"
  | "rise"
  | "lower"
  | "boost";

/**
 * Keyboard bindings, keyed by normalized `KeyboardEvent.key`.
 *
 * WASD and the arrow keys both drive the same planar movement actions, so the
 * two families are exact parity aliases; Q/E yaw, R/F raise and lower, Shift
 * boosts. Digit keys, Escape and Home are owned by the focus controller.
 */
export const CAMERA_KEY_BINDINGS: Readonly<Record<string, KeyAction>> = {
  w: "forward",
  arrowup: "forward",
  s: "back",
  arrowdown: "back",
  a: "left",
  arrowleft: "left",
  d: "right",
  arrowright: "right",
  q: "yaw-left",
  e: "yaw-right",
  r: "rise",
  f: "lower",
  shift: "boost",
};

const MOTION_ACTIONS: readonly KeyAction[] = [
  "forward",
  "back",
  "left",
  "right",
  "yaw-left",
  "yaw-right",
  "rise",
  "lower",
];

/** Options accepted by a glide, a preset or a programmatic pose change. */
export interface GlideOptions {
  readonly durationMs?: number;
  readonly easing?: TransitionEasing;
  /** Snap instead of gliding (used for the very first frame and tests). */
  readonly immediate?: boolean;
}

interface DragPointer {
  x: number;
  y: number;
  mode: DragMode;
  moved: number;
}

interface PinchState {
  readonly x: number;
  readonly y: number;
  readonly distance: number;
}

interface GlideState {
  readonly from: OrbitState;
  readonly to: OrbitState;
  /** Seconds. */
  readonly duration: number;
  readonly easing: TransitionEasing;
  elapsed: number;
}

/** Fallback preset used when a layout carries no camera landmarks at all. */
const FALLBACK_LANDMARK: CameraLandmark = {
  id: "establishing",
  name: "Establishing View",
  description: "Default elevated view over the city block.",
  position: { x: 34, y: 26, z: 38 },
  target: { x: 0, y: 4, z: 0 },
};

export interface CameraRigOptions {
  /** Camera to drive; a configured `PerspectiveCamera` is created when omitted. */
  readonly camera?: THREE.PerspectiveCamera;
  readonly layout?: CityLayout;
  readonly config?: Partial<CameraControlConfig>;
  /** DOM element to bind mouse/wheel/touch/keyboard listeners to. */
  readonly element?: HTMLElement;
  readonly viewport?: CameraViewport;
  readonly bounds?: NavigationBounds;
  readonly initialPose?: CameraPose;
  /** Landmark used by {@link CameraRig.reset}; defaults to the first landmark. */
  readonly defaultLandmarkId?: string;
}

/* -------------------------------------------------------------------------- */
/* Camera rig                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Damped, bounded navigation rig for the city block.
 *
 * All inputs mutate a *desired* orbit state; {@link update} damps the current
 * state towards it, advances an active glide, re-clamps and writes the pose to
 * the Three.js camera. That single funnel is what guarantees the acceptance
 * invariants on every tick.
 */
export class CameraRig implements EraAware {
  readonly camera: THREE.PerspectiveCamera;
  readonly layout: CityLayout;
  readonly config: CameraControlConfig;
  readonly bounds: NavigationBounds;
  readonly landmarks: readonly CameraLandmark[];
  readonly defaultLandmark: CameraLandmark;

  private readonly ownsCamera: boolean;
  private readonly landmarkIndex: ReadonlyMap<string, CameraLandmark>;
  private readonly keys = new Set<KeyAction>();
  private readonly touchPoints = new Map<number, { x: number; y: number }>();
  private current: OrbitState;
  private desired: OrbitState;
  private glideState: GlideState | null = null;
  private pointer: DragPointer | null = null;
  private pinch: PinchState | null = null;
  private element: HTMLElement | null = null;
  private previousTouchAction: string | null = null;
  private viewportSize: CameraViewport;

  constructor(options: CameraRigOptions = {}) {
    this.layout = options.layout ?? CITY_LAYOUT;
    this.config = { ...CAMERA_CONTROL_DEFAULTS, ...options.config };
    this.viewportSize = { ...(options.viewport ?? DEFAULT_CAMERA_VIEWPORT) };
    this.ownsCamera = options.camera === undefined;
    this.camera =
      options.camera ??
      new THREE.PerspectiveCamera(
        this.config.fov,
        Math.max(1e-3, this.viewportSize.width) / Math.max(1e-3, this.viewportSize.height),
        this.config.near,
        this.config.far,
      );
    this.bounds = options.bounds ?? createNavigationBounds(this.layout, this.config);
    this.landmarks = this.layout.cameraLandmarks;
    this.landmarkIndex = new Map(this.landmarks.map((landmark) => [landmark.id, landmark]));
    this.defaultLandmark = options.defaultLandmarkId
      ? this.requireLandmark(options.defaultLandmarkId)
      : (this.landmarks[0] ?? FALLBACK_LANDMARK);

    const start = poseToOrbit(options.initialPose ?? landmarkPose(this.defaultLandmark));
    this.current = normalizeOrbit(start, this.bounds, this.config);
    this.desired = this.current;
    this.syncCamera();

    if (options.element) this.attach(options.element);
  }

  /* ---------------------------------------------------------------- state */

  /** Current pose (eye + pivot), always inside the navigation bounds. */
  get pose(): CameraPose {
    return orbitToPose(this.current);
  }

  /** Current orbit state; the authoritative clamped representation. */
  get orbit(): OrbitState {
    return this.current;
  }

  /** Eye position as a fresh vector, safe for callers to mutate. */
  get position(): THREE.Vector3 {
    const { position } = this.pose;
    return new THREE.Vector3(position.x, position.y, position.z);
  }

  /** Look-at pivot as a fresh vector, safe for callers to mutate. */
  get target(): THREE.Vector3 {
    const { target } = this.pose;
    return new THREE.Vector3(target.x, target.y, target.z);
  }

  get viewport(): CameraViewport {
    return this.viewportSize;
  }

  /** True while an automated glide (preset, focus or reset) is running. */
  get isGliding(): boolean {
    return this.glideState !== null;
  }

  /** True while a mouse or single-touch drag gesture is in progress. */
  get dragging(): boolean {
    return this.pointer !== null;
  }

  /** Actions currently held on the keyboard, in binding order. */
  get activeKeys(): readonly KeyAction[] {
    return MOTION_ACTIONS.filter((action) => this.keys.has(action)).concat(this.keys.has("boost") ? ["boost"] : []);
  }

  get domElement(): HTMLElement | null {
    return this.element;
  }

  /* -------------------------------------------------------------- presets */

  /** Landing pose of a landmark preset, already clamped to the navigation bounds. */
  poseForLandmark(idOrLandmark: string | CameraLandmark): CameraPose {
    const landmark = this.resolveLandmark(idOrLandmark);
    return orbitToPose(normalizeOrbit(poseToOrbit(landmarkPose(landmark)), this.bounds, this.config));
  }

  /** Pose of the default establishing view. */
  get defaultPose(): CameraPose {
    return this.poseForLandmark(this.defaultLandmark);
  }

  /** Glides (or snaps) to a named layout landmark preset. */
  applyLandmark(idOrLandmark: string | CameraLandmark, options?: GlideOptions): CameraPose {
    const pose = this.poseForLandmark(idOrLandmark);
    this.glideTo(pose, options);
    return pose;
  }

  /** Glides (or snaps) back to the default establishing view. */
  reset(options?: GlideOptions): CameraPose {
    return this.applyLandmark(this.defaultLandmark, options);
  }

  /* ---------------------------------------------------------------- glides */

  /**
   * Starts an eased glide to `pose`.
   *
   * Any user input cancels the glide immediately, which is how interaction wins
   * over an era-transition dolly or a focus animation.
   */
  glideTo(pose: CameraPose, options: GlideOptions = {}): void {
    const to = normalizeOrbit(poseToOrbit(pose), this.bounds, this.config);
    const durationMs = options.durationMs ?? this.config.glideDurationMs;
    if (options.immediate === true || durationMs <= 0) {
      this.current = to;
      this.desired = to;
      this.glideState = null;
      this.syncCamera();
      return;
    }
    this.glideState = {
      from: this.current,
      to,
      duration: durationMs / 1000,
      easing: options.easing ?? this.config.glideEasing,
      elapsed: 0,
    };
  }

  /** Programmatic pose change; glides smoothly unless `immediate` is set. */
  setPose(pose: CameraPose, options: GlideOptions = {}): void {
    this.glideTo(pose, options);
  }

  /** Cancels an in-flight glide, leaving the pose where the glide had reached. */
  cancelGlide(): void {
    this.glideState = null;
  }

  /**
   * Era morphs never touch the rig.
   *
   * The camera must survive a transition with the user's pose intact, so this
   * is deliberately a no-op; there is no automated era dolly for the user's
   * input to fight with.
   */
  applyEra(_era: EraId, _blend: number): void {
    // Pose-preserving by design (see the class documentation).
  }

  /* ---------------------------------------------------------------- inputs */

  /** Starts a drag gesture. Panning is normally bound to the middle/right button. */
  onPointerDown(x: number, y: number, mode: DragMode = "orbit"): void {
    this.cancelGlide();
    this.pointer = { x, y, mode, moved: 0 };
  }

  /** Continues a drag gesture; orbits or pans by the pixel delta. */
  onPointerMove(x: number, y: number): void {
    const pointer = this.pointer;
    if (!pointer) return;
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    if (dx === 0 && dy === 0) return;
    pointer.x = x;
    pointer.y = y;
    pointer.moved += Math.hypot(dx, dy);
    this.cancelGlide();
    if (pointer.mode === "pan") this.panBy(dx, dy);
    else this.orbitBy(dx, dy);
  }

  /** Ends a drag gesture; returns `true` when it qualifies as a click or tap. */
  onPointerUp(): boolean {
    const pointer = this.pointer;
    this.pointer = null;
    return pointer !== null && pointer.moved <= this.config.clickTolerancePx;
  }

  /** Orbits the eye around the pivot. */
  orbitBy(deltaXpx: number, deltaYpx: number): void {
    // Any navigation input wins over an automated glide (preset, focus, reset).
    this.cancelGlide();
    const azimuth = this.desired.azimuth + deltaXpx * this.config.orbitSensitivity;
    const pitch = this.desired.pitch + deltaYpx * this.config.orbitSensitivity;
    this.desired = normalizeOrbit({ ...this.desired, azimuth, pitch }, this.bounds, this.config);
  }

  /** Pans the pivot in the view plane; bounded to the block envelope. */
  panBy(deltaXpx: number, deltaYpx: number): void {
    this.cancelGlide();
    const basis = this.cameraBasis();
    const metresPerPixel =
      (2 * this.desired.distance * Math.tan((this.config.fov * Math.PI) / 360) * this.config.panSensitivity) /
      Math.max(1, this.viewportSize.height);
    const dx = -deltaXpx * metresPerPixel;
    const dy = deltaYpx * metresPerPixel;
    const target: WorldPoint = {
      x: this.desired.target.x + basis.right.x * dx + basis.up.x * dy,
      y: this.desired.target.y + basis.right.y * dx + basis.up.y * dy,
      z: this.desired.target.z + basis.right.z * dx + basis.up.z * dy,
    };
    this.desired = normalizeOrbit({ ...this.desired, target }, this.bounds, this.config);
  }

  /** Multiplies the boom length; positive zooms out, negative zooms in. */
  dolly(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.cancelGlide();
    this.desired = normalizeOrbit({ ...this.desired, distance: this.desired.distance * factor }, this.bounds, this.config);
  }

  /** Wheel handler: scroll up (negative delta) zooms in. */
  zoomBy(wheelDeltaY: number): void {
    if (!Number.isFinite(wheelDeltaY) || wheelDeltaY === 0) return;
    this.dolly(Math.exp(wheelDeltaY * this.config.zoomSensitivity));
  }

  /** Starts (or restarts) a touch gesture from the current contact list. */
  onTouchStart(touches: readonly TouchSample[]): void {
    this.cancelGlide();
    this.touchPoints.clear();
    for (const touch of touches) this.touchPoints.set(touch.id, { x: touch.x, y: touch.y });
    if (this.touchPoints.size >= 2) {
      this.pinch = pinchFrom(this.touchPoints.values());
      this.pointer = null;
      return;
    }
    const first = touches[0];
    this.pinch = null;
    this.pointer = first ? { x: first.x, y: first.y, mode: "orbit", moved: 0 } : null;
  }

  /** Touch move: one finger orbits, two fingers pinch-zoom and pan. */
  onTouchMove(touches: readonly TouchSample[]): void {
    for (const touch of touches) this.touchPoints.set(touch.id, { x: touch.x, y: touch.y });
    if (this.touchPoints.size >= 2) {
      const next = pinchFrom(this.touchPoints.values());
      if (this.pinch && next) {
        if (this.pinch.distance > 1e-3) this.dolly(this.pinch.distance / next.distance);
        this.panBy(next.x - this.pinch.x, next.y - this.pinch.y);
      }
      this.pinch = next;
      this.pointer = null;
      return;
    }
    const first = touches[0];
    if (!first) return;
    if (!this.pointer) this.pointer = { x: first.x, y: first.y, mode: "orbit", moved: 0 };
    else this.onPointerMove(first.x, first.y);
  }

  /** Touch end: `remaining` lists the contacts still down. */
  onTouchEnd(remaining: readonly TouchSample[]): void {
    this.touchPoints.clear();
    for (const touch of remaining) this.touchPoints.set(touch.id, { x: touch.x, y: touch.y });
    if (this.touchPoints.size === 0) {
      this.pinch = null;
      this.pointer = null;
      return;
    }
    if (this.touchPoints.size === 1) {
      const [first] = this.touchPoints.values();
      this.pinch = null;
      this.pointer = first ? { x: first.x, y: first.y, mode: "orbit", moved: 0 } : null;
      return;
    }
    this.pinch = pinchFrom(this.touchPoints.values());
  }

  /** Presses a key. Returns `true` when the rig recognised it. */
  onKeyDown(rawKey: string): boolean {
    const action = CAMERA_KEY_BINDINGS[normalizeKey(rawKey)];
    if (!action) return false;
    this.keys.add(action);
    if (MOTION_ACTIONS.includes(action)) this.cancelGlide();
    return true;
  }

  /** Releases a key. Returns `true` when the rig recognised it. */
  onKeyUp(rawKey: string): boolean {
    const action = CAMERA_KEY_BINDINGS[normalizeKey(rawKey)];
    if (!action) return false;
    this.keys.delete(action);
    return true;
  }

  /** Drops every held key (window blur, teardown). */
  clearKeys(): void {
    this.keys.clear();
  }

  /* -------------------------------------------------------------- playback */

  /** Resizes the pan/zoom reference viewport. */
  setViewport(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    this.viewportSize = { width, height };
    if (this.ownsCamera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Advances the rig by `deltaSeconds`: input integration, damping (or glide
   * progress), clamping, then writing the pose to the Three.js camera.
   */
  update(deltaSeconds: number): CameraPose {
    const dt = clamp(deltaSeconds, 0, MAX_FRAME_DELTA_SECONDS);
    if (this.hasMotionKey()) this.cancelGlide();
    this.applyHeldKeys(dt);
    if (this.glideState) this.stepGlide(dt);
    else {
      const alpha = dampingAlpha(this.config.damping, dt);
      this.current = {
        target: lerpPoint(this.current.target, this.desired.target, alpha),
        distance: lerp(this.current.distance, this.desired.distance, alpha),
        azimuth: this.current.azimuth + shortestAngleDelta(this.current.azimuth, this.desired.azimuth) * alpha,
        pitch: lerp(this.current.pitch, this.desired.pitch, alpha),
      };
    }
    this.current = normalizeOrbit(this.current, this.bounds, this.config);
    this.desired = normalizeOrbit(this.desired, this.bounds, this.config);
    this.syncCamera();
    return this.pose;
  }

  /**
   * Pose that frames a sphere of `radius` around `point`.
   *
   * The current azimuth is preserved (so focusing glides rather than teleports
   * the viewer's orientation), while the elevation settles into a comfortable
   * three-quarter angle at the configured focus pitch.
   */
  framingPose(point: WorldPoint, radius: number, options: GlideOptions & { azimuth?: number; pitch?: number } = {}): CameraPose {
    const distance = framingDistance(
      radius,
      this.config.fov,
      this.config.focusMargin,
      this.config.minDistance,
      this.config.maxDistance,
    );
    const state: OrbitState = {
      target: { x: point.x, y: point.y, z: point.z },
      distance,
      azimuth: options.azimuth ?? this.desired.azimuth,
      pitch: clamp(options.pitch ?? this.config.focusPitch, this.config.minPitch, this.config.maxPitch),
    };
    return orbitToPose(normalizeOrbit(state, this.bounds, this.config));
  }

  /* --------------------------------------------------------------- DOM I/O */

  /** Binds mouse, wheel, touch and keyboard listeners to `element`. */
  attach(element: HTMLElement): void {
    if (this.element === element) return;
    this.detach();
    this.element = element;
    if (typeof element.style === "object") {
      this.previousTouchAction = element.style.touchAction || null;
      element.style.touchAction = "none";
    }
    element.addEventListener("mousedown", this.handleMouseDown);
    element.addEventListener("mousemove", this.handleMouseMove);
    element.addEventListener("mouseup", this.handleMouseUp);
    element.addEventListener("mouseleave", this.handleMouseUp);
    element.addEventListener("wheel", this.handleWheel, { passive: false });
    element.addEventListener("contextmenu", this.handleContextMenu);
    element.addEventListener("touchstart", this.handleTouchStart, { passive: false });
    element.addEventListener("touchmove", this.handleTouchMove, { passive: false });
    element.addEventListener("touchend", this.handleTouchEnd, { passive: false });
    element.addEventListener("touchcancel", this.handleTouchEnd, { passive: false });
    element.addEventListener("keydown", this.handleKeyDown);
    element.addEventListener("keyup", this.handleKeyUp);
    if (typeof window !== "undefined") window.addEventListener("blur", this.handleWindowBlur);
  }

  /** Removes every listener added by {@link attach}. */
  detach(): void {
    const element = this.element;
    if (!element) return;
    element.removeEventListener("mousedown", this.handleMouseDown);
    element.removeEventListener("mousemove", this.handleMouseMove);
    element.removeEventListener("mouseup", this.handleMouseUp);
    element.removeEventListener("mouseleave", this.handleMouseUp);
    element.removeEventListener("wheel", this.handleWheel);
    element.removeEventListener("contextmenu", this.handleContextMenu);
    element.removeEventListener("touchstart", this.handleTouchStart);
    element.removeEventListener("touchmove", this.handleTouchMove);
    element.removeEventListener("touchend", this.handleTouchEnd);
    element.removeEventListener("touchcancel", this.handleTouchEnd);
    element.removeEventListener("keydown", this.handleKeyDown);
    element.removeEventListener("keyup", this.handleKeyUp);
    if (typeof window !== "undefined") window.removeEventListener("blur", this.handleWindowBlur);
    if (this.previousTouchAction !== null) element.style.touchAction = this.previousTouchAction;
    this.previousTouchAction = null;
    this.element = null;
  }

  /** Stops the loop-facing listeners and drops held keys. */
  dispose(): void {
    this.detach();
    this.clearKeys();
    this.pointer = null;
    this.pinch = null;
    this.touchPoints.clear();
    this.glideState = null;
  }

  /* ------------------------------------------------------------- internals */

  private requireLandmark(id: string): CameraLandmark {
    const landmark = this.landmarkIndex.get(id);
    if (!landmark) throw new Error(`Unknown Chrono City camera landmark "${id}".`);
    return landmark;
  }

  private resolveLandmark(idOrLandmark: string | CameraLandmark): CameraLandmark {
    return typeof idOrLandmark === "string" ? this.requireLandmark(idOrLandmark) : idOrLandmark;
  }

  private hasMotionKey(): boolean {
    return MOTION_ACTIONS.some((action) => this.keys.has(action));
  }

  /** Orthonormal camera basis derived from the current pose (never from GPU state). */
  private cameraBasis(): { forward: WorldPoint; right: WorldPoint; up: WorldPoint } {
    const pose = this.pose;
    const dx = pose.target.x - pose.position.x;
    const dz = pose.target.z - pose.position.z;
    const length = Math.hypot(dx, dz);
    const forward: WorldPoint =
      length > 1e-6 ? { x: dx / length, y: 0, z: dz / length } : { x: 0, y: 0, z: -1 };
    const right: WorldPoint = { x: -forward.z, y: 0, z: forward.x };
    const up: WorldPoint = {
      x: right.y * forward.z - right.z * forward.y,
      y: right.z * forward.x - right.x * forward.z,
      z: right.x * forward.y - right.y * forward.x,
    };
    return { forward, right, up };
  }

  private applyHeldKeys(dt: number): void {
    if (dt <= 0 || !this.hasMotionKey()) return;
    const boost = this.keys.has("boost");
    const distance = this.config.moveSpeed * (boost ? this.config.boostMultiplier : 1) * dt;
    const yaw = this.config.yawSpeed * dt;
    const basis = this.cameraBasis();
    let dx = 0;
    let dz = 0;
    let dy = 0;
    if (this.keys.has("forward")) {
      dx += basis.forward.x * distance;
      dz += basis.forward.z * distance;
    }
    if (this.keys.has("back")) {
      dx -= basis.forward.x * distance;
      dz -= basis.forward.z * distance;
    }
    if (this.keys.has("right")) {
      dx += basis.right.x * distance;
      dz += basis.right.z * distance;
    }
    if (this.keys.has("left")) {
      dx -= basis.right.x * distance;
      dz -= basis.right.z * distance;
    }
    if (this.keys.has("rise")) dy += distance;
    if (this.keys.has("lower")) dy -= distance;
    let azimuth = this.desired.azimuth;
    if (this.keys.has("yaw-left")) azimuth += yaw;
    if (this.keys.has("yaw-right")) azimuth -= yaw;
    const target: WorldPoint = {
      x: this.desired.target.x + dx,
      y: this.desired.target.y + dy,
      z: this.desired.target.z + dz,
    };
    this.desired = normalizeOrbit({ ...this.desired, target, azimuth }, this.bounds, this.config);
  }

  private stepGlide(dt: number): void {
    const glide = this.glideState;
    if (!glide) return;
    glide.elapsed += dt;
    const progress = clamp(glide.elapsed / Math.max(1e-3, glide.duration), 0, 1);
    const state = interpolateOrbit(glide.from, glide.to, applyEasing(glide.easing, progress));
    this.current = state;
    this.desired = state;
    if (progress >= 1) this.glideState = null;
  }

  private syncCamera(): void {
    const pose = this.pose;
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    this.camera.updateMatrixWorld();
  }

  /* ------------------------------------------------------------- DOM binds */

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button === 1 || event.button === 2 || event.shiftKey) {
      this.onPointerDown(event.clientX, event.clientY, "pan");
      return;
    }
    if (event.button === 0) this.onPointerDown(event.clientX, event.clientY, "orbit");
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    this.onPointerMove(event.clientX, event.clientY);
  };

  private readonly handleMouseUp = (): void => {
    this.onPointerUp();
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (event.cancelable) event.preventDefault();
    this.zoomBy(event.deltaY);
  };

  private readonly handleContextMenu = (event: Event): void => {
    if (event.cancelable) event.preventDefault();
  };

  private readonly handleTouchStart = (event: Event): void => {
    if (event.cancelable) event.preventDefault();
    this.onTouchStart(readTouches(event, "touches"));
  };

  private readonly handleTouchMove = (event: Event): void => {
    if (event.cancelable) event.preventDefault();
    this.onTouchMove(readTouches(event, "touches"));
  };

  private readonly handleTouchEnd = (event: Event): void => {
    if (event.cancelable) event.preventDefault();
    this.onTouchEnd(readTouches(event, "touches"));
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!shouldHandleKeyEvent(event)) return;
    if (this.onKeyDown(event.key) && event.cancelable) event.preventDefault();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.onKeyUp(event.key);
  };

  private readonly handleWindowBlur = (): void => {
    this.clearKeys();
    this.onPointerUp();
  };
}

/** Creates a camera rig with the canonical layout, bounds and input bindings. */
export function createCameraRig(options: CameraRigOptions = {}): CameraRig {
  return new CameraRig(options);
}

/* -------------------------------------------------------------------------- */
/* Module helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Pose described by a layout landmark. */
export function landmarkPose(landmark: CameraLandmark): CameraPose {
  return {
    position: { x: landmark.position.x, y: landmark.position.y, z: landmark.position.z },
    target: { x: landmark.target.x, y: landmark.target.y, z: landmark.target.z },
  };
}

function normalizeKey(rawKey: string): string {
  return rawKey.trim().toLowerCase();
}

function pinchFrom(points: Iterable<{ x: number; y: number }>): PinchState | null {
  const samples = [...points];
  if (samples.length < 2) return null;
  const first = samples[0];
  const second = samples[1];
  if (!first || !second) return null;
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    distance: Math.max(1e-3, Math.hypot(second.x - first.x, second.y - first.y)),
  };
}

/** Reads a `TouchList`-like field off a DOM event (jsdom has no `TouchEvent`). */
function readTouches(event: Event, field: "touches" | "changedTouches"): TouchSample[] {
  const list = (event as unknown as Record<string, unknown>)[field];
  if (!list || typeof list !== "object") return [];
  const arrayLike = list as { length?: number; [index: number]: unknown };
  const length = typeof arrayLike.length === "number" ? arrayLike.length : 0;
  const result: TouchSample[] = [];
  for (let index = 0; index < length; index += 1) {
    const candidate = arrayLike[index] as
      | { identifier?: unknown; clientX?: unknown; clientY?: unknown }
      | undefined;
    if (!candidate) continue;
    result.push({
      id: typeof candidate.identifier === "number" ? candidate.identifier : index,
      x: Number(candidate.clientX ?? 0),
      y: Number(candidate.clientY ?? 0),
    });
  }
  return result;
}

/** Keyboard parity guard: never steal keys from form controls or OS shortcuts. */
function shouldHandleKeyEvent(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const target = event.target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!target) return true;
  const tag = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "textarea" || tag === "select") return false;
  return target.isContentEditable !== true;
}
