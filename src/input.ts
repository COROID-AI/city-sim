/**
 * Browser input wiring for the live city app.
 *
 * Every gesture the user can make against the running simulation is bound here,
 * in one place, so the composition root (`src/main.ts`) stays declarative and
 * the whole input layer can be torn down with a single `dispose()`:
 *
 * | gesture                        | effect                                         |
 * | ------------------------------ | ---------------------------------------------- |
 * | drag on the city canvas        | pan the camera (`ViewportCamera.panByScreen`)  |
 * | wheel over the city canvas     | zoom around the pointer (`ViewportCamera.zoomBy`) |
 * | click on the city canvas       | pick the entity and select it in the inspector |
 * | `+` / `-`                      | zoom one step around the viewport centre       |
 * | arrow keys                     | pan one step in that direction                 |
 * | `Space`                        | pause / resume the simulation                  |
 * | `1` / `2` / `3`                | set the speed multiplier                       |
 * | window resize                  | re-clamp the camera to the new viewport size   |
 *
 * The minimap binds its own pointer handling (click and drag jump the camera)
 * through `Minimap.attach`, so nothing here duplicates that path.
 *
 * ## Click versus drag
 *
 * A press that travels no further than {@link CLICK_SLOP_PX} logical pixels is
 * treated as a click and selects; anything further is a drag and only pans, so
 * grabbing the city never silently changes the inspector's selection.
 *
 * Zoom is always delegated to the camera, which owns the clamped zoom range
 * (`ViewportCamera.zoomBy`), and panning always goes through
 * `ViewportCamera.panByScreen`, so the camera stays the single authority over
 * what part of the city is on screen — the renderer, the picker and the minimap
 * keep reading the same object.
 *
 * ## Lifecycle
 *
 * `attach()` installs every listener; `dispose()` removes all of them (canvas,
 * drag, wheel, keyboard and resize) and is idempotent, which is what keeps a
 * page reload — or a boot/dispose/boot cycle in a test — free of duplicates.
 * Nothing here touches the DOM except through listeners and
 * `getBoundingClientRect`, so it can be exercised headlessly against a jsdom
 * canvas.
 */

import type { ViewportCamera, ViewportSize } from './render/camera';
import type { EntityPick, EntityPicker } from './render/picking';
import type { SimulationEngine } from './sim/engine';
import type { Vec2 } from './sim/types';
import type { EntityInspector } from './ui/inspector';

/* -------------------------------------------------------------- constants -- */

/** Wheel sensitivity: `factor = exp(-deltaY * WHEEL_ZOOM_RATE)`. */
export const WHEEL_ZOOM_RATE = 0.0015;

/** Zoom step applied by the `+` and `-` keys. */
export const KEYBOARD_ZOOM_FACTOR = 1.25;

/** Screen pixels one arrow-key press pans by. */
export const KEYBOARD_PAN_STEP_PX = 96;

/** Movement within this many screen pixels counts as a click, not a drag. */
export const CLICK_SLOP_PX = 4;

/** Speed multipliers selected by the `1`, `2` and `3` keys. */
export const SPEED_MULTIPLIERS: readonly number[] = [1, 2, 3];

/** Wheel deltas reported in lines/pages are normalised to pixels. */
const LINE_DELTA_PX = 16;
const PAGE_DELTA_PX = 100;

/** Viewport used when neither layout nor the window reports a size. */
const FALLBACK_VIEWPORT_WIDTH = 1280;
const FALLBACK_VIEWPORT_HEIGHT = 720;

/* ------------------------------------------------------------------ types -- */

/** Constructor options for {@link AppInput}. */
export interface AppInputOptions {
  /** Element receiving pan/zoom/click gestures; the city canvas in the app. */
  readonly canvas: HTMLElement;
  /** The one authoritative camera every gesture moves. */
  readonly camera: ViewportCamera;
  /** Engine whose pause state and speed the keyboard drives. */
  readonly engine: SimulationEngine;
  /** Picker resolving a click to an entity (or the ground). */
  readonly picker: EntityPicker;
  /** Panel a click selects into. */
  readonly inspector: EntityInspector;
  /** Window providing keyboard and resize events; defaults to the canvas'. */
  readonly window?: Window | null;
  /** Document the in-flight drag listeners are bound to; defaults to the canvas'. */
  readonly document?: Document | null;
  /**
   * Measures the host viewport on resize. The composition root passes its own
   * measurement so the app and the input layer can never disagree about the
   * viewport size; when omitted the canvas' CSS box is used.
   */
  readonly viewportSize?: (() => ViewportSize) | null;
  /** Speed multipliers for the number keys. Defaults to {@link SPEED_MULTIPLIERS}. */
  readonly speeds?: readonly number[];
}

/* ------------------------------------------------------------------ input -- */

export class AppInput {
  /** Element the gestures are bound to. */
  readonly canvas: HTMLElement;
  readonly camera: ViewportCamera;
  readonly engine: SimulationEngine;
  readonly picker: EntityPicker;
  readonly inspector: EntityInspector;
  /** Speed multipliers the number keys select, in key order (`1`, `2`, `3`, ...). */
  readonly speeds: readonly number[];
  /** Press event this host uses: `pointerdown`, or `mousedown` without PointerEvent. */
  readonly downEventType: 'pointerdown' | 'mousedown';

  private readonly win: Window | null;
  private readonly doc: Document | null;
  private readonly measureViewport: (() => ViewportSize) | null;

  private attachedFlag = false;
  private disposedFlag = false;
  private draggingFlag = false;
  private dragBound = false;
  private lastClientX = 0;
  private lastClientY = 0;
  private dragDistancePx = 0;
  private panCountValue = 0;
  private zoomCountValue = 0;
  private selectionCountValue = 0;
  private groundClickCountValue = 0;
  private pauseToggleCountValue = 0;
  private speedChangeCountValue = 0;
  private resizeCountValue = 0;
  private lastPickValue: EntityPick | null = null;
  private lastSpeedValue = 1;

  constructor(options: AppInputOptions) {
    if (!options || !options.canvas) {
      throw new TypeError('new AppInput(options) expects the canvas to listen on');
    }
    if (!options.camera || !options.engine || !options.picker || !options.inspector) {
      throw new TypeError(
        'new AppInput(options) expects camera, engine, picker and inspector to drive',
      );
    }
    this.canvas = options.canvas;
    this.camera = options.camera;
    this.engine = options.engine;
    this.picker = options.picker;
    this.inspector = options.inspector;

    const owner = (options.canvas as { ownerDocument?: Document | null }).ownerDocument ?? null;
    this.doc = options.document ?? owner;
    this.win =
      options.window ??
      (owner && owner.defaultView) ??
      (typeof window === 'undefined' ? null : window);
    this.measureViewport = options.viewportSize ?? null;

    const speeds = options.speeds ?? SPEED_MULTIPLIERS;
    if (!Array.isArray(speeds) || speeds.length === 0) {
      throw new RangeError('new AppInput(options) expects at least one speed multiplier');
    }
    for (const speed of speeds) {
      if (!Number.isFinite(speed) || speed <= 0) {
        throw new RangeError(`speed multipliers must be finite and greater than 0, received ${speed}`);
      }
    }
    this.speeds = [...speeds];

    // Mirrors the minimap: browsers with PointerEvent get the richer event,
    // everything else (older engines, tiny DOM shims) falls back to mouse events.
    const usesPointerEvents = this.win !== null && 'PointerEvent' in this.win;
    this.downEventType = usesPointerEvents ? 'pointerdown' : 'mousedown';
  }

  /* -------------------------------------------------------------- reading -- */

  /** True while every listener is installed. */
  get isAttached(): boolean {
    return this.attachedFlag;
  }

  /** True once {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.disposedFlag;
  }

  /** True while a drag on the canvas is in progress. */
  get isDragging(): boolean {
    return this.draggingFlag;
  }

  /** Drag steps that reached the camera. */
  get panCount(): number {
    return this.panCountValue;
  }

  /** Wheel and keyboard zooms that reached the camera. */
  get zoomCount(): number {
    return this.zoomCountValue;
  }

  /** Clicks that selected an entity. */
  get selectionCount(): number {
    return this.selectionCountValue;
  }

  /** Clicks that hit the ground and therefore cleared the inspector. */
  get groundClickCount(): number {
    return this.groundClickCountValue;
  }

  /** `Space` presses handled. */
  get pauseToggleCount(): number {
    return this.pauseToggleCountValue;
  }

  /** Number-key speed changes handled. */
  get speedChangeCount(): number {
    return this.speedChangeCountValue;
  }

  /** Window resize events handled. */
  get resizeCount(): number {
    return this.resizeCountValue;
  }

  /** Pick result of the most recent click, or `null` before the first one. */
  get lastPick(): EntityPick | null {
    return this.lastPickValue;
  }

  /** Speed multiplier applied by the most recent speed key. */
  get lastSpeed(): number {
    return this.lastSpeedValue;
  }

  /* ------------------------------------------------------------ lifecycle -- */

  /** Installs every listener and re-clamps the camera to the host viewport. */
  attach(): void {
    this.assertUsable('attach');
    if (this.attachedFlag) {
      return;
    }
    this.attachedFlag = true;
    const canvas = this.canvas;
    if (typeof canvas.addEventListener === 'function') {
      canvas.addEventListener(this.downEventType, this.onPointerDown);
      // Explicitly non-passive: zooming must be able to cancel page scrolling.
      canvas.addEventListener('wheel', this.onWheel, { passive: false });
    }
    this.win?.addEventListener('keydown', this.onKeyDown);
    this.win?.addEventListener('resize', this.onResize);
    this.syncViewport();
  }

  /** Removes every listener and ends any drag in flight. Idempotent. */
  dispose(): void {
    if (this.disposedFlag) {
      return;
    }
    this.disposedFlag = true;
    this.draggingFlag = false;
    this.unbindDragListeners();
    const canvas = this.canvas;
    if (typeof canvas.removeEventListener === 'function') {
      canvas.removeEventListener(this.downEventType, this.onPointerDown);
      canvas.removeEventListener('wheel', this.onWheel);
    }
    this.win?.removeEventListener('keydown', this.onKeyDown);
    this.win?.removeEventListener('resize', this.onResize);
    this.attachedFlag = false;
  }

  /**
   * Re-measures the host viewport and re-clamps the camera to it. Called on
   * attach and on every window resize; safe to call by hand after the shell has
   * been re-laid out.
   */
  syncViewport(): ViewportSize {
    const size = this.measureViewportSize();
    if (!this.disposedFlag) {
      this.camera.attach(size);
    }
    return size;
  }

  /* ------------------------------------------------------------- handlers -- */

  private readonly onPointerDown = (event: Event): void => {
    if (this.disposedFlag) {
      return;
    }
    const press = event as MouseEvent;
    if (typeof press.button === 'number' && press.button !== 0) {
      // Only the primary button pans/selects; the rest is left to the browser.
      return;
    }
    this.draggingFlag = true;
    this.lastClientX = clientCoordinate(press.clientX);
    this.lastClientY = clientCoordinate(press.clientY);
    this.dragDistancePx = 0;
    this.bindDragListeners();
    if (typeof event.preventDefault === 'function') {
      // Keeps the platform from starting a native text/image drag on the canvas.
      event.preventDefault();
    }
  };

  private readonly onDragMove = (event: Event): void => {
    if (!this.draggingFlag || this.disposedFlag) {
      return;
    }
    const move = event as MouseEvent;
    const x = clientCoordinate(move.clientX);
    const y = clientCoordinate(move.clientY);
    const deltaX = x - this.lastClientX;
    const deltaY = y - this.lastClientY;
    this.lastClientX = x;
    this.lastClientY = y;
    if (deltaX === 0 && deltaY === 0) {
      return;
    }
    this.dragDistancePx += Math.hypot(deltaX, deltaY);
    // The camera slides by the opposite amount, so the grabbed city follows.
    this.camera.panByScreen(deltaX, deltaY);
    this.panCountValue += 1;
  };

  private readonly onDragEnd = (event: Event): void => {
    if (!this.draggingFlag) {
      this.unbindDragListeners();
      return;
    }
    const travelled = this.dragDistancePx;
    this.draggingFlag = false;
    this.dragDistancePx = 0;
    this.unbindDragListeners();
    if (this.disposedFlag || travelled > CLICK_SLOP_PX) {
      // A real drag only paned; it must not change the selection.
      return;
    }
    this.selectAt(this.canvasPoint(event));
  };

  private readonly onDragCancel = (): void => {
    this.draggingFlag = false;
    this.dragDistancePx = 0;
    this.unbindDragListeners();
  };

  private readonly onWheel = (event: Event): void => {
    if (this.disposedFlag) {
      return;
    }
    const wheel = event as WheelEvent;
    const delta = wheelDeltaPx(wheel);
    if (delta === 0) {
      return;
    }
    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    // Cursor-anchored: the tile under the pointer stays put while everything
    // scales around it, and the camera clamps the resulting zoom.
    this.camera.zoomBy(Math.exp(-delta * WHEEL_ZOOM_RATE), this.canvasPoint(event));
    this.zoomCountValue += 1;
  };

  private readonly onKeyDown = (event: Event): void => {
    if (this.disposedFlag || isEditableTarget(event)) {
      return;
    }
    const key = (event as KeyboardEvent).key;
    if (typeof key !== 'string' || key.length === 0) {
      return;
    }
    const press = event as KeyboardEvent;
    if (press.ctrlKey || press.metaKey || press.altKey) {
      // Leave shortcuts (`Ctrl`-click, `Cmd`-wheel, ...) to the browser.
      return;
    }

    const speedIndex = speedIndexForKey(key);
    if (speedIndex >= 0) {
      if (speedIndex >= this.speeds.length) {
        return;
      }
      const speed = this.speeds[speedIndex];
      this.engine.setSpeed(speed);
      this.lastSpeedValue = speed;
      this.speedChangeCountValue += 1;
      this.consume(event);
      return;
    }

    switch (key) {
      case ' ':
      case 'Spacebar':
      case 'Pause':
        this.engine.togglePause();
        this.pauseToggleCountValue += 1;
        this.consume(event);
        return;
      case '+':
      case '=':
        this.camera.zoomBy(KEYBOARD_ZOOM_FACTOR);
        this.zoomCountValue += 1;
        this.consume(event);
        return;
      case '-':
      case '_':
        this.camera.zoomBy(1 / KEYBOARD_ZOOM_FACTOR);
        this.zoomCountValue += 1;
        this.consume(event);
        return;
      case 'ArrowLeft':
        this.panByKeyboard(-KEYBOARD_PAN_STEP_PX, 0);
        this.consume(event);
        return;
      case 'ArrowRight':
        this.panByKeyboard(KEYBOARD_PAN_STEP_PX, 0);
        this.consume(event);
        return;
      case 'ArrowUp':
        this.panByKeyboard(0, -KEYBOARD_PAN_STEP_PX);
        this.consume(event);
        return;
      case 'ArrowDown':
        this.panByKeyboard(0, KEYBOARD_PAN_STEP_PX);
        this.consume(event);
        return;
      default:
        // Every other key belongs to the browser (or the inspector's Escape).
        return;
    }
  };

  private readonly onResize = (): void => {
    if (this.disposedFlag) {
      return;
    }
    this.resizeCountValue += 1;
    this.syncViewport();
  };

  /* ------------------------------------------------------------ internals -- */

  /** Picks at a screen point and hands the result to the inspector. */
  private selectAt(point: Vec2): void {
    const pick = this.picker.pickScreen(point);
    this.lastPickValue = pick;
    this.inspector.applyPick(pick);
    if (pick.kind === 'ground' || pick.id === null) {
      this.groundClickCountValue += 1;
      return;
    }
    this.selectionCountValue += 1;
  }

  /**
   * Keyboard panning: the arrow points at the direction the *view* should move,
   * which is the opposite of the screen delta a drag of the same size uses.
   */
  private panByKeyboard(deltaXScreen: number, deltaYScreen: number): void {
    this.camera.panByScreen(-deltaXScreen, -deltaYScreen);
    this.panCountValue += 1;
  }

  private canvasPoint(event: Event): Vec2 {
    const source = event as MouseEvent;
    const rect =
      typeof this.canvas.getBoundingClientRect === 'function'
        ? this.canvas.getBoundingClientRect()
        : null;
    const left = rect && Number.isFinite(rect.left) ? rect.left : 0;
    const top = rect && Number.isFinite(rect.top) ? rect.top : 0;
    return {
      x: clientCoordinate(source.clientX) - left,
      y: clientCoordinate(source.clientY) - top,
    };
  }

  private measureViewportSize(): ViewportSize {
    if (this.measureViewport) {
      return this.measureViewport();
    }
    const bounds =
      typeof this.canvas.getBoundingClientRect === 'function'
        ? this.canvas.getBoundingClientRect()
        : null;
    let width = bounds && Number.isFinite(bounds.width) ? bounds.width : 0;
    let height = bounds && Number.isFinite(bounds.height) ? bounds.height : 0;
    if (width <= 0) {
      width = this.win?.innerWidth || this.canvas.clientWidth || FALLBACK_VIEWPORT_WIDTH;
    }
    if (height <= 0) {
      height = this.win?.innerHeight || this.canvas.clientHeight || FALLBACK_VIEWPORT_HEIGHT;
    }
    return { width: Math.max(1, width), height: Math.max(1, height) };
  }

  private bindDragListeners(): void {
    if (this.dragBound) {
      return;
    }
    const target = this.dragTarget();
    if (typeof target.addEventListener !== 'function') {
      return;
    }
    // Only one family is ever bound: in a PointerEvent browser the compat mouse
    // events would otherwise pan twice for a single gesture.
    if (this.downEventType === 'pointerdown') {
      target.addEventListener('pointermove', this.onDragMove);
      target.addEventListener('pointerup', this.onDragEnd);
      target.addEventListener('pointercancel', this.onDragCancel);
    } else {
      target.addEventListener('mousemove', this.onDragMove);
      target.addEventListener('mouseup', this.onDragEnd);
    }
    this.dragBound = true;
  }

  private unbindDragListeners(): void {
    if (!this.dragBound) {
      return;
    }
    const target = this.dragTarget();
    if (typeof target.removeEventListener === 'function') {
      if (this.downEventType === 'pointerdown') {
        target.removeEventListener('pointermove', this.onDragMove);
        target.removeEventListener('pointerup', this.onDragEnd);
        target.removeEventListener('pointercancel', this.onDragCancel);
      } else {
        target.removeEventListener('mousemove', this.onDragMove);
        target.removeEventListener('mouseup', this.onDragEnd);
      }
    }
    this.dragBound = false;
  }

  /** Where move/end events are observed once a drag starts. */
  private dragTarget(): EventTarget {
    if (this.doc && typeof this.doc.addEventListener === 'function') {
      return this.doc;
    }
    return this.canvas;
  }

  private consume(event: Event): void {
    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
  }

  private assertUsable(operation: string): void {
    if (this.disposedFlag) {
      throw new Error(`AppInput.${operation}() cannot be used after dispose()`);
    }
  }
}

/* ---------------------------------------------------------------- helpers -- */

/** Creates the input layer for a city app; equivalent to `new AppInput(...)`. */
export function createAppInput(options: AppInputOptions): AppInput {
  return new AppInput(options);
}

/** Numeric index of the `1`..`9` key, or `-1` for any other key. */
function speedIndexForKey(key: string): number {
  if (key.length !== 1) {
    return -1;
  }
  const code = key.charCodeAt(0);
  if (code < 49 || code > 57) {
    return -1;
  }
  return code - 49;
}

/** Wheel delta normalised to pixels, honouring the event's `deltaMode`. */
function wheelDeltaPx(wheel: WheelEvent): number {
  const raw = wheel.deltaY;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw === 0) {
    return 0;
  }
  switch (wheel.deltaMode) {
    case 1:
      return raw * LINE_DELTA_PX;
    case 2:
      return raw * PAGE_DELTA_PX;
    default:
      return raw;
  }
}

function clientCoordinate(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Whether a key event came from a field the user is typing into. */
function isEditableTarget(event: Event): boolean {
  const target = (event as { target?: unknown }).target as HTMLElement | null;
  if (!target || typeof target !== 'object') {
    return false;
  }
  if ((target as { isContentEditable?: boolean }).isContentEditable) {
    return true;
  }
  const tag = typeof target.tagName === 'string' ? target.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}
