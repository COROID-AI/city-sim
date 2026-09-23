/**
 * Chrono City — navigation rig: orbit inspection and first-person walking.
 *
 * The rig is the only system allowed to move the shared camera. It owns the
 * `SceneContext` tick registration, the DOM input listeners (pointer, wheel,
 * keyboard, touch) and the on-screen navigation controls, and it delegates all
 * of the motion maths to `MovementController` (`movementController.ts`).
 * Everything else in the city reads the camera through `rig.state`, a frozen
 * snapshot built once per frame:
 *
 *   create    → `new NavigationRig(context, options)`. Registration with
 *               `SceneContext` and listener binding both happen automatically.
 *   consume   → systems call `rig.state` / `rig.mode` for the live camera pose.
 *   integrate → `createNavigationRig(context)` is the one-liner the application
 *               entry point uses; `setMode` / `toggleMode` switch navigation.
 *
 * Two input modes are supported simultaneously, per the navigation contract:
 *
 *   * orbit — pointer drag (or touch drag) orbits the block, the wheel and
 *     two-finger pinch zoom between `minDistance` and `maxDistance`.
 *   * walk  — WASD / arrow keys move a 1.7 m eye along the block, pointer drag
 *     or pointer-lock mouse deltas look around, and mobile users get an analog
 *     joystick plus drag-look.
 *
 * Motion is exponentially damped (`MovementController`) and clamped, never
 * snapped: the walker collides with `createBlockWalkBounds()`, which is derived
 * from the shared `BlockLayout` cell extents — never a private copy of the
 * block geometry — and the eye height stays inside the 1.6-1.8 m band.
 */

import { BLOCK, CELL, SIDEWALK_CENTER_Z } from '../core/blockLayout';
import type { FrameInfo, SceneContext, SystemRegistration } from '../core/sceneContext';
import {
  DEFAULT_MAX_DISTANCE,
  DEFAULT_MIN_DISTANCE,
  DEFAULT_ORBIT_DISTANCE,
  DEFAULT_ORBIT_PITCH,
  DEFAULT_ORBIT_TARGET_HEIGHT,
  DEFAULT_WALK_PITCH,
  MovementController,
  clamp,
  type MovementControllerOptions,
  type NavigationBounds,
  type NavigationMode,
  type NavigationPose,
  type SetModeOptions,
  type Vec2,
  type Vec3,
} from './movementController';

export const NAVIGATION_RIG_VERSION = 1;

/** Tick-registry id the rig registers itself under. */
export const NAVIGATION_SYSTEM_ID = 'navigation-rig';

/**
 * The rig runs before every other system so HUD, inspection and tour systems
 * always see the camera pose for the frame they are drawing.
 */
export const NAVIGATION_SYSTEM_ORDER = -100;

/** Walk clamp inset from the layout edge, in metres (keeps the walker off the kerb line). */
export const DEFAULT_BLOCK_MARGIN = 1;

/** Joystick travel radius in CSS pixels when the element cannot be measured. */
export const DEFAULT_JOYSTICK_RADIUS = 56;

/** Metres of zoom per pixel of two-finger pinch travel. */
export const DEFAULT_PINCH_ZOOM_GAIN = 1.8;

/** Read-only camera state exposed to every other system. */
export interface NavigationRigState {
  readonly version: number;
  readonly mode: NavigationMode;
  /** Integrated frame counter, matching the `SceneContext` tick count. */
  readonly frame: number;
  /** Camera position in metres. */
  readonly position: Vec3;
  /** Camera look target: the orbit pivot, or a point just ahead while walking. */
  readonly target: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  /** Orbit zoom radius in metres (kept while walking, so zoom survives a mode switch). */
  readonly distance: number;
  /** Camera height in metres: eye height while walking, camera Y while orbiting. */
  readonly eyeHeight: number;
  readonly moving: boolean;
  readonly pointerLocked: boolean;
  /** Walkable rectangle the rig clamps to, derived from `BlockLayout`. */
  readonly bounds: NavigationBounds;
}

/** Overlay controls the rig creates for keyboard-less devices. */
export interface NavigationRigControls {
  readonly root: HTMLElement | null;
  readonly modeToggle: HTMLButtonElement | null;
  readonly joystick: HTMLElement | null;
  readonly joystickKnob: HTMLElement | null;
}

export interface NavigationRigOptions extends Omit<MovementControllerOptions, 'bounds' | 'mode'> {
  /** Initial mode. Defaults to `'orbit'`. */
  mode?: NavigationMode;
  /** Walkable rectangle override. Defaults to `createBlockWalkBounds(boundsMargin)`. */
  bounds?: NavigationBounds;
  /** Inset from the layout edge for the derived bounds. Defaults to `DEFAULT_BLOCK_MARGIN`. */
  boundsMargin?: number;
  /** Register the per-frame tick with `SceneContext`. Defaults to `true`. */
  autoRegister?: boolean;
  /** Bind DOM listeners during construction. Defaults to `true` in a DOM. */
  autoAttach?: boolean;
  /** Create the overlay mode toggle / joystick controls. Defaults to `true`. */
  controls?: boolean;
  /** Force the touch joystick on or off. Defaults to touch-capability detection. */
  touch?: boolean;
  /** Joystick travel radius in CSS pixels. Defaults to `DEFAULT_JOYSTICK_RADIUS`. */
  joystickRadius?: number;
  /** Ask for pointer lock when the walk mode canvas is clicked. Defaults to `true`. */
  pointerLockOnClick?: boolean;
  /** Physical key code that toggles walk/orbit. Defaults to `'KeyF'`; `null` disables it. */
  modeToggleKey?: string | null;
  /** Element that receives pointer/wheel/touch input. Defaults to `context.canvas`. */
  pointerTarget?: EventTarget | null;
  /** Element that receives keyboard input. Defaults to `window`, then `document`. */
  keyboardTarget?: EventTarget | null;
  /** Tick-registry id. Defaults to `NAVIGATION_SYSTEM_ID`. */
  systemId?: string;
  /** Tick-registry order. Defaults to `NAVIGATION_SYSTEM_ORDER`. */
  systemOrder?: number;
}

/**
 * The walkable rectangle for the block, derived from the shared `BlockLayout`
 * cell extents (`CELL`) and inset by `margin` metres so the walker stays inside
 * the road ring. Changing the layout moves the navigation bounds with it.
 */
export function createBlockWalkBounds(margin: number = DEFAULT_BLOCK_MARGIN): NavigationBounds {
  const requested = Number.isFinite(margin) ? margin : DEFAULT_BLOCK_MARGIN;
  // Never invert the rectangle, however large the margin is.
  const limit = Math.max(0, Math.min(CELL.halfWidth, CELL.halfDepth) - 1);
  const inset = clamp(requested, 0, limit);
  return Object.freeze({
    minX: CELL.minX + inset,
    maxX: CELL.maxX - inset,
    minZ: CELL.minZ + inset,
    maxZ: CELL.maxZ - inset,
  });
}

/** Default first-person spawn: the middle of the south sidewalk, facing the block. */
export function blockWalkSpawn(): Vec2 {
  return { x: BLOCK.center.x, z: SIDEWALK_CENTER_Z };
}

/** `true` when the device exposes touch input (joystick becomes reachable). */
export function isTouchCapable(): boolean {
  if (typeof window === 'undefined') return false;
  if ('ontouchstart' in window) return true;
  const points = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints ?? 0;
  return points > 0;
}

/* ------------------------------------------------------------------------- *
 * DOM helpers
 * ------------------------------------------------------------------------- */

interface TouchPoint {
  readonly identifier: number;
  readonly clientX: number;
  readonly clientY: number;
}

interface JoystickMetrics {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function toFinite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readElementRect(element: Element): JoystickMetrics {
  if (typeof element.getBoundingClientRect !== 'function') {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const rect = element.getBoundingClientRect();
  return {
    left: toFinite(rect.left),
    top: toFinite(rect.top),
    width: toFinite(rect.width),
    height: toFinite(rect.height),
  };
}

function pointerIdOf(event: Event): number | null {
  const identifier = (event as PointerEvent).pointerId;
  return typeof identifier === 'number' ? identifier : null;
}

function readTouchPoints(event: Event, key: 'touches' | 'changedTouches'): TouchPoint[] {
  const list = (event as unknown as Record<string, unknown>)[key];
  if (!list || typeof (list as ArrayLike<unknown>).length !== 'number') return [];
  const source = list as ArrayLike<Partial<TouchPoint> | undefined>;
  const points: TouchPoint[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const touch = source[index];
    if (!touch) continue;
    points.push({
      identifier: typeof touch.identifier === 'number' ? touch.identifier : index,
      clientX: toFinite(touch.clientX),
      clientY: toFinite(touch.clientY),
    });
  }
  return points;
}

function touchSpread(points: readonly TouchPoint[]): number {
  if (points.length < 2) return 0;
  return Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY);
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== 'string') return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable === true;
}

/* ------------------------------------------------------------------------- *
 * Navigation rig
 * ------------------------------------------------------------------------- */

/**
 * Damped camera rig: orbit-inspect and first-person walk over the city block,
 * ticked by `SceneContext` and driven by pointer, wheel, keyboard and touch
 * input. Other systems read `rig.state`; nobody else touches the camera.
 */
export class NavigationRig {
  readonly version = NAVIGATION_RIG_VERSION;

  private readonly context: SceneContext;
  private readonly controller: MovementController;
  private readonly pointerTarget: EventTarget | null;
  private readonly eventRoot: EventTarget | null;
  private readonly documentRef: Document | null;
  private readonly overlayRoot: HTMLElement | null;
  private readonly boundsSnapshot: NavigationBounds;
  private readonly controlsEnabled: boolean;
  private readonly joystickEnabled: boolean;
  private readonly joystickRadius: number;
  private readonly pointerLockOnClick: boolean;
  private readonly modeToggleKey: string | null;

  private readonly systemId: string;
  private readonly systemOrder: number;

  private registration: SystemRegistration | null = null;
  private attached = false;
  private disposedState = false;

  private controlsRoot: HTMLElement | null = null;
  private modeButton: HTMLButtonElement | null = null;
  private joystickElement: HTMLElement | null = null;
  private joystickKnob: HTMLElement | null = null;

  private dragPointerId: number | null = null;
  private dragX = 0;
  private dragY = 0;
  private joystickPointerId: number | null = null;
  private joystickOffsetX = 0;
  private joystickOffsetY = 0;
  private lookTouch: { id: number; x: number; y: number } | null = null;
  private pinch: { distance: number } | null = null;

  private stateSnapshot: NavigationRigState;

  constructor(context: SceneContext, options: NavigationRigOptions = {}) {
    this.context = context;
    this.documentRef = typeof document === 'undefined' ? null : document;
    this.eventRoot =
      options.keyboardTarget ?? (typeof window !== 'undefined' ? window : this.documentRef) ?? null;
    this.pointerTarget = options.pointerTarget ?? context.canvas ?? null;
    this.overlayRoot = context.overlayRoot ?? null;

    const mode = options.mode ?? 'orbit';
    this.boundsSnapshot = Object.freeze({
      ...(options.bounds ?? createBlockWalkBounds(options.boundsMargin)),
    });

    this.controller = new MovementController({
      ...options,
      mode,
      bounds: this.boundsSnapshot,
      orbitTarget: options.orbitTarget ?? {
        x: BLOCK.center.x,
        y: DEFAULT_ORBIT_TARGET_HEIGHT,
        z: BLOCK.center.z,
      },
      orbitDistance: options.orbitDistance ?? DEFAULT_ORBIT_DISTANCE,
      orbitPitch:
        options.orbitPitch ?? (mode === 'walk' ? DEFAULT_WALK_PITCH : DEFAULT_ORBIT_PITCH),
      walkPosition: options.walkPosition ?? blockWalkSpawn(),
      walkYaw: options.walkYaw ?? options.orbitYaw,
    });

    this.controlsEnabled = (options.controls ?? true) && this.overlayRoot !== null;
    this.joystickEnabled = options.touch ?? isTouchCapable();
    this.joystickRadius = Math.max(24, options.joystickRadius ?? DEFAULT_JOYSTICK_RADIUS);
    this.pointerLockOnClick = options.pointerLockOnClick ?? true;
    this.modeToggleKey = options.modeToggleKey === undefined ? 'KeyF' : options.modeToggleKey;

    this.systemId = options.systemId ?? NAVIGATION_SYSTEM_ID;
    this.systemOrder = options.systemOrder ?? NAVIGATION_SYSTEM_ORDER;

    this.buildControls();
    this.applyPose(this.controller.currentPose);
    this.stateSnapshot = this.buildState(this.controller.currentPose);
    this.refreshControls();

    if (options.autoRegister ?? true) {
      this.registration = context.registerSystem(this.systemId, this.handleTick, {
        order: this.systemOrder,
      });
    }
    if (options.autoAttach ?? true) this.attach();
  }

  /* ---------------- read-only state ---------------- */

  /** Frozen snapshot of the camera state this system owns. */
  get state(): NavigationRigState {
    return this.stateSnapshot;
  }

  get mode(): NavigationMode {
    return this.controller.mode;
  }

  get moving(): boolean {
    return this.controller.moving;
  }

  get pointerLocked(): boolean {
    return this.controller.pointerLocked;
  }

  /** Walkable rectangle the rig clamps to. */
  get bounds(): NavigationBounds {
    return this.boundsSnapshot;
  }

  /** Overlay controls created by the rig (null when disabled or headless). */
  get controls(): NavigationRigControls {
    return {
      root: this.controlsRoot,
      modeToggle: this.modeButton,
      joystick: this.joystickElement,
      joystickKnob: this.joystickKnob,
    };
  }

  /** Tick-registry handle, when the rig registered itself. */
  get systemRegistration(): SystemRegistration | null {
    return this.registration;
  }

  /* ---------------- lifecycle ---------------- */

  /** Advances one damped frame, writes the camera and refreshes `state`. */
  step(delta: number): NavigationRigState {
    if (this.disposedState) return this.stateSnapshot;
    const pose = this.controller.update(delta);
    this.applyPose(pose);
    this.stateSnapshot = this.buildState(pose);
    this.refreshControls();
    return this.stateSnapshot;
  }

  /** Switches navigation mode with the controller's continuous hand-off. */
  setMode(mode: NavigationMode, options: SetModeOptions = {}): NavigationRigState {
    const pose = this.controller.setMode(mode, options);
    this.controller.clearKeys();
    if (mode !== 'walk') this.releaseJoystick();
    this.applyPose(pose);
    this.stateSnapshot = this.buildState(pose);
    this.refreshControls();
    return this.stateSnapshot;
  }

  /** Flips between orbit inspection and first-person walking. */
  toggleMode(): NavigationRigState {
    return this.setMode(this.controller.mode === 'walk' ? 'orbit' : 'walk');
  }

  /** Binds pointer, wheel, keyboard and touch listeners (idempotent). */
  attach(): void {
    if (this.attached || this.disposedState) return;
    this.attached = true;

    const pointer = this.pointerTarget;
    if (pointer) {
      pointer.addEventListener('pointerdown', this.handlePointerDown);
      pointer.addEventListener('wheel', this.handleWheel, { passive: false });
      pointer.addEventListener('touchstart', this.handleTouchStart, { passive: false });
      pointer.addEventListener('touchmove', this.handleTouchMove, { passive: false });
      pointer.addEventListener('touchend', this.handleTouchEnd);
      pointer.addEventListener('touchcancel', this.handleTouchEnd);
    }

    const root = this.eventRoot;
    if (root) {
      root.addEventListener('pointermove', this.handlePointerMove);
      root.addEventListener('pointerup', this.handlePointerUp);
      root.addEventListener('pointercancel', this.handlePointerUp);
      root.addEventListener('keydown', this.handleKeyDown);
      root.addEventListener('keyup', this.handleKeyUp);
      root.addEventListener('blur', this.handleWindowBlur);
    }

    const doc = this.documentRef;
    if (doc) {
      doc.addEventListener('pointerlockchange', this.handlePointerLockChange);
      doc.addEventListener('pointerlockerror', this.handlePointerLockChange);
      doc.addEventListener('mousemove', this.handleMouseMove);
    }

    this.joystickElement?.addEventListener('pointerdown', this.handleJoystickDown);
  }

  /** Removes every listener; the tick registration is untouched. */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;

    const pointer = this.pointerTarget;
    if (pointer) {
      pointer.removeEventListener('pointerdown', this.handlePointerDown);
      pointer.removeEventListener('wheel', this.handleWheel);
      pointer.removeEventListener('touchstart', this.handleTouchStart);
      pointer.removeEventListener('touchmove', this.handleTouchMove);
      pointer.removeEventListener('touchend', this.handleTouchEnd);
      pointer.removeEventListener('touchcancel', this.handleTouchEnd);
    }

    const root = this.eventRoot;
    if (root) {
      root.removeEventListener('pointermove', this.handlePointerMove);
      root.removeEventListener('pointerup', this.handlePointerUp);
      root.removeEventListener('pointercancel', this.handlePointerUp);
      root.removeEventListener('keydown', this.handleKeyDown);
      root.removeEventListener('keyup', this.handleKeyUp);
      root.removeEventListener('blur', this.handleWindowBlur);
    }

    const doc = this.documentRef;
    if (doc) {
      doc.removeEventListener('pointerlockchange', this.handlePointerLockChange);
      doc.removeEventListener('pointerlockerror', this.handlePointerLockChange);
      doc.removeEventListener('mousemove', this.handleMouseMove);
    }

    this.joystickElement?.removeEventListener('pointerdown', this.handleJoystickDown);
    this.dragPointerId = null;
    this.releaseJoystick();
  }

  /** Detaches input, unregisters the tick and removes the overlay controls. */
  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.detach();
    this.releasePointerLock();
    this.registration?.dispose();
    this.registration = null;
    this.controlsRoot?.remove();
    this.controlsRoot = null;
    this.modeButton = null;
    this.joystickElement = null;
    this.joystickKnob = null;
    this.controller.clearKeys();
    this.controller.setJoystick(0, 0);
  }

  /* ---------------- pointer lock ---------------- */

  /** Asks the browser for pointer lock. Returns `false` when unavailable. */
  requestPointerLock(): boolean {
    const target = this.pointerTarget as
      | (EventTarget & { requestPointerLock?: () => unknown })
      | null;
    if (!target || typeof target.requestPointerLock !== 'function') return false;
    try {
      const result = target.requestPointerLock() as unknown;
      if (result && typeof (result as Promise<void>).catch === 'function') {
        void (result as Promise<void>).catch(() => undefined);
      }
      return true;
    } catch (error) {
      console.warn('[chrono-city] navigation: pointer lock request failed', error);
      return false;
    }
  }

  /** Releases pointer lock, if the browser is holding it. */
  releasePointerLock(): void {
    const doc = this.documentRef;
    if (!doc || typeof doc.exitPointerLock !== 'function') return;
    try {
      doc.exitPointerLock();
    } catch {
      /* The browser can refuse to release a lock it never granted. */
    }
  }

  /* ---------------- camera ---------------- */

  private applyPose(pose: NavigationPose): void {
    const camera = this.context.camera;
    camera.up.set(0, 1, 0);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    camera.updateMatrixWorld();
  }

  private buildState(pose: NavigationPose): NavigationRigState {
    return Object.freeze({
      version: NAVIGATION_RIG_VERSION,
      mode: this.controller.mode,
      frame: this.controller.frame,
      position: Object.freeze({ x: pose.position.x, y: pose.position.y, z: pose.position.z }),
      target: Object.freeze({ x: pose.target.x, y: pose.target.y, z: pose.target.z }),
      yaw: pose.yaw,
      pitch: pose.pitch,
      distance: pose.distance,
      eyeHeight: pose.eyeHeight,
      moving: pose.moving,
      pointerLocked: this.controller.pointerLocked,
      bounds: this.boundsSnapshot,
    });
  }

  private readonly handleTick = (_context: SceneContext, frame: FrameInfo): void => {
    this.step(frame.delta);
  };

  /* ---------------- overlay controls ---------------- */

  private buildControls(): void {
    const doc = this.documentRef;
    const overlay = this.overlayRoot;
    if (!this.controlsEnabled || !doc || !overlay) return;

    const root = doc.createElement('div');
    root.className = 'chrono-nav-controls';
    root.setAttribute('data-chrono-nav', 'controls');
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    const modeToggle = doc.createElement('button');
    modeToggle.type = 'button';
    modeToggle.className = 'chrono-nav-mode chrono-panel';
    modeToggle.setAttribute('data-chrono-nav', 'mode');
    modeToggle.setAttribute('aria-pressed', 'false');
    modeToggle.title = 'Toggle first-person walk mode';
    modeToggle.textContent = 'Orbit';
    Object.assign(modeToggle.style, {
      position: 'absolute',
      left: '16px',
      bottom: '16px',
      minWidth: '84px',
      padding: '10px 14px',
      font: 'inherit',
      fontSize: '11px',
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: 'var(--chrono-ink, #e8eef7)',
      background: 'rgba(6, 12, 22, 0.62)',
      border: '1px solid rgba(111, 211, 255, 0.28)',
      borderRadius: '12px',
      pointerEvents: 'auto',
      cursor: 'pointer',
      touchAction: 'manipulation',
    } satisfies Partial<CSSStyleDeclaration>);
    modeToggle.addEventListener('click', this.handleModeToggleClick);
    root.appendChild(modeToggle);

    const joystick = doc.createElement('div');
    joystick.className = 'chrono-nav-joystick';
    joystick.setAttribute('data-chrono-nav', 'joystick');
    joystick.setAttribute('aria-hidden', 'true');
    Object.assign(joystick.style, {
      position: 'absolute',
      right: '24px',
      bottom: '24px',
      width: `${this.joystickRadius * 2}px`,
      height: `${this.joystickRadius * 2}px`,
      display: 'none',
      borderRadius: '50%',
      border: '1px solid rgba(111, 211, 255, 0.28)',
      background: 'rgba(6, 12, 22, 0.42)',
      pointerEvents: 'auto',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    const knob = doc.createElement('div');
    knob.className = 'chrono-nav-joystick-knob';
    knob.setAttribute('data-chrono-nav', 'joystick-knob');
    Object.assign(knob.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: `${this.joystickRadius}px`,
      height: `${this.joystickRadius}px`,
      marginLeft: `${-this.joystickRadius / 2}px`,
      marginTop: `${-this.joystickRadius / 2}px`,
      borderRadius: '50%',
      background: 'rgba(111, 211, 255, 0.22)',
      border: '1px solid rgba(111, 211, 255, 0.4)',
      transform: 'translate3d(0px, 0px, 0)',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    joystick.appendChild(knob);

    root.appendChild(joystick);
    overlay.appendChild(root);

    this.controlsRoot = root;
    this.modeButton = modeToggle;
    this.joystickElement = joystick;
    this.joystickKnob = knob;
  }

  private refreshControls(): void {
    const mode = this.controller.mode;

    const button = this.modeButton;
    if (button) {
      const label = mode === 'walk' ? 'Walk' : 'Orbit';
      if (button.textContent !== label) button.textContent = label;
      button.setAttribute('aria-pressed', mode === 'walk' ? 'true' : 'false');
    }

    const joystick = this.joystickElement;
    if (joystick) {
      const visible = this.joystickEnabled && mode === 'walk';
      const display = visible ? 'block' : 'none';
      if (joystick.style.display !== display) joystick.style.display = display;
      joystick.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    if (this.controlsRoot) this.controlsRoot.setAttribute('data-chrono-nav-mode', mode);
  }

  private refreshJoystickKnob(): void {
    const knob = this.joystickKnob;
    if (!knob) return;
    knob.style.transform = `translate3d(${this.joystickOffsetX}px, ${this.joystickOffsetY}px, 0)`;
  }

  /* ---------------- input handlers ---------------- */

  private consume(event: Event): void {
    if (event.cancelable) event.preventDefault();
  }

  private readonly handleModeToggleClick = (): void => {
    this.toggleMode();
  };

  private readonly handlePointerDown = (event: Event): void => {
    const pointer = event as PointerEvent;
    // Touch is handled by the touch path so a finger is never looked at twice.
    if (pointer.pointerType === 'touch') return;
    if (typeof pointer.button === 'number' && pointer.button !== 0) return;

    if (this.controller.mode === 'walk' && this.pointerLockOnClick && !this.controller.pointerLocked) {
      // A plain click is the gesture browsers require before granting pointer lock.
      this.requestPointerLock();
    }

    if (this.dragPointerId !== null) return;
    this.dragPointerId = pointerIdOf(pointer) ?? 0;
    this.dragX = toFinite(pointer.clientX);
    this.dragY = toFinite(pointer.clientY);
    this.capturePointer(pointer);
    this.consume(event);
  };

  private readonly handlePointerMove = (event: Event): void => {
    if (this.updateJoystick(event)) {
      this.consume(event);
      return;
    }
    if (this.dragPointerId === null) return;

    const pointer = event as PointerEvent;
    const pointerId = pointerIdOf(pointer);
    if (pointerId !== null && pointerId !== this.dragPointerId) return;

    const x = toFinite(pointer.clientX, this.dragX);
    const y = toFinite(pointer.clientY, this.dragY);
    const deltaX = x - this.dragX;
    const deltaY = y - this.dragY;
    this.dragX = x;
    this.dragY = y;
    if (deltaX !== 0 || deltaY !== 0) this.controller.addLook(deltaX, deltaY);
    this.consume(event);
  };

  private readonly handlePointerUp = (event: Event): void => {
    const pointer = event as PointerEvent;
    const pointerId = pointerIdOf(pointer);

    if (this.joystickPointerId !== null && (pointerId === null || pointerId === this.joystickPointerId)) {
      this.releaseJoystick();
    }
    if (this.dragPointerId !== null && (pointerId === null || pointerId === this.dragPointerId)) {
      this.dragPointerId = null;
    }
  };

  private readonly handleWheel = (event: Event): void => {
    const wheel = event as WheelEvent;
    this.controller.addZoom(toFinite(wheel.deltaY));
    this.consume(event);
  };

  private readonly handleKeyDown = (event: Event): void => {
    const keyboard = event as KeyboardEvent;
    if (isTextEntryTarget(keyboard.target)) return;

    const toggleKey = this.modeToggleKey;
    if (toggleKey !== null && keyboard.code === toggleKey) {
      if (!keyboard.repeat) this.toggleMode();
      this.consume(event);
      return;
    }

    if (this.controller.setKey(keyboard.code, true)) this.consume(event);
  };

  private readonly handleKeyUp = (event: Event): void => {
    const keyboard = event as KeyboardEvent;
    if (this.controller.setKey(keyboard.code, false)) this.consume(event);
  };

  private readonly handleWindowBlur = (): void => {
    this.controller.clearKeys();
    this.dragPointerId = null;
    this.releaseJoystick();
  };

  private readonly handleTouchStart = (event: Event): void => {
    const touches = readTouchPoints(event, 'touches');
    if (touches.length === 0) return;

    if (touches.length >= 2) {
      // Two fingers pinch-zoom and stop looking.
      this.lookTouch = null;
      this.pinch = { distance: touchSpread(touches) };
    } else if (this.lookTouch === null) {
      this.lookTouch = { id: touches[0].identifier, x: touches[0].clientX, y: touches[0].clientY };
    }
    this.consume(event);
  };

  private readonly handleTouchMove = (event: Event): void => {
    const touches = readTouchPoints(event, 'touches');

    if (this.pinch !== null && touches.length >= 2) {
      const spread = touchSpread(touches);
      const delta = (this.pinch.distance - spread) * DEFAULT_PINCH_ZOOM_GAIN;
      this.pinch.distance = spread;
      if (delta !== 0) this.controller.addZoom(delta);
      this.consume(event);
      return;
    }

    const look = this.lookTouch;
    if (look === null) return;
    const touch = touches.find((candidate) => candidate.identifier === look.id);
    if (!touch) return;

    const deltaX = touch.clientX - look.x;
    const deltaY = touch.clientY - look.y;
    look.x = touch.clientX;
    look.y = touch.clientY;
    if (deltaX !== 0 || deltaY !== 0) this.controller.addLook(deltaX, deltaY);
    this.consume(event);
  };

  private readonly handleTouchEnd = (event: Event): void => {
    const remaining = readTouchPoints(event, 'touches');
    const look = this.lookTouch;
    if (look !== null && !remaining.some((touch) => touch.identifier === look.id)) {
      this.lookTouch = null;
    }
    if (this.pinch !== null && remaining.length < 2) this.pinch = null;
  };

  private readonly handleJoystickDown = (event: Event): void => {
    if (this.joystickElement === null) return;
    const pointer = event as PointerEvent;
    this.joystickPointerId = pointerIdOf(pointer) ?? 0;
    this.capturePointer(pointer);
    this.updateJoystick(event);
    this.consume(event);
  };

  private readonly handlePointerLockChange = (): void => {
    const doc = this.documentRef;
    const locked =
      doc !== null &&
      this.pointerTarget !== null &&
      (doc.pointerLockElement as EventTarget | null) === this.pointerTarget;
    this.controller.setPointerLocked(locked);
    if (!locked) this.dragPointerId = null;
    this.stateSnapshot = this.buildState(this.controller.currentPose);
  };

  private readonly handleMouseMove = (event: Event): void => {
    if (!this.controller.pointerLocked) return;
    const mouse = event as MouseEvent;
    const deltaX = toFinite(mouse.movementX);
    const deltaY = toFinite(mouse.movementY);
    if (deltaX !== 0 || deltaY !== 0) this.controller.addLook(deltaX, deltaY);
  };

  /** Feeds the joystick axes, returning `true` when the event was the joystick's. */
  private updateJoystick(event: Event): boolean {
    const base = this.joystickElement;
    if (!base || this.joystickPointerId === null) return false;

    const pointer = event as PointerEvent;
    const pointerId = pointerIdOf(pointer);
    if (pointerId !== null && pointerId !== this.joystickPointerId) return false;

    const rect = readElementRect(base);
    const radius = Math.max(rect.width, rect.height) / 2 || this.joystickRadius;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const offsetX = clamp(toFinite(pointer.clientX) - centerX, -radius, radius);
    const offsetY = clamp(toFinite(pointer.clientY) - centerY, -radius, radius);

    this.joystickOffsetX = offsetX;
    this.joystickOffsetY = offsetY;
    // Screen Y grows downwards; a drag upwards means "walk forwards".
    this.controller.setJoystick(offsetX / radius, -offsetY / radius);
    this.refreshJoystickKnob();
    return true;
  }

  private releaseJoystick(): void {
    this.joystickPointerId = null;
    this.joystickOffsetX = 0;
    this.joystickOffsetY = 0;
    this.controller.setJoystick(0, 0);
    this.refreshJoystickKnob();
  }

  private capturePointer(pointer: PointerEvent): void {
    const target = this.pointerTarget as (EventTarget & { setPointerCapture?: (id: number) => void }) | null;
    if (!target || typeof target.setPointerCapture !== 'function') return;
    const pointerId = pointerIdOf(pointer);
    if (pointerId === null) return;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* Capturing is an optimisation; dragging works without it. */
    }
  }
}

/** Creates the rig: registers its tick and binds input in one call. */
export function createNavigationRig(
  context: SceneContext,
  options: NavigationRigOptions = {},
): NavigationRig {
  return new NavigationRig(context, options);
}

/** Re-exports so inspection/HUD systems can reason about the zoom limits. */
export const NAVIGATION_LIMITS = Object.freeze({
  minDistance: DEFAULT_MIN_DISTANCE,
  maxDistance: DEFAULT_MAX_DISTANCE,
  orbitDistance: DEFAULT_ORBIT_DISTANCE,
});
