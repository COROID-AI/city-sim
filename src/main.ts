/**
 * Composition root of the live city application.
 *
 * Importing this module is all a browser has to do: it builds the seeded city,
 * the clock, the engine and every subsystem (citizens, companies, vehicles,
 * hourly economy, day/night lighting, canvas renderer, HUD, minimap, picking
 * and the entity inspector), wires them together, then starts a frame loop that
 * runs a **fixed-step simulation** with a **frame-driven render**:
 *
 * ```
 * every animation frame:  engine.update(realDeltaMs)   -> 0..n fixed ticks
 *                         lighting.update()            -> palette for that time
 *                         renderer.frame(lighting)     -> exactly one canvas frame
 *                         minimap / inspector cadence  -> throttled overlays
 * ```
 *
 * The engine owns the accumulator, so the number of fixed steps per frame adapts
 * to the elapsed real time while the render stays at one frame per animation
 * frame; the speed multiplier scales simulated minutes per real second and never
 * the render rate (see `SimulationEngine.update`). A single `pump(deltaMs)` seam
 * is exposed for headless drives and tests.
 *
 * The app starts by itself on load (no start button, no user gesture) and is
 * torn down through one `dispose()` path that removes the rAF loop, every
 * listener and every overlay, so a reload — or a boot/dispose/boot cycle — can
 * never double-advance sim time or duplicate a surface.
 *
 * ## Mount points
 *
 * The page shell (`index.html`) provides the canvas and the overlay slots; the
 * root mounts into them when they exist:
 *
 * - `#city-canvas` — the city canvas (created under `#app` if the shell is bare);
 * - `#app` — the HUD and the inspector panel are appended here;
 * - `#minimap` — the minimap's canvas is mounted here.
 *
 * The first frame opens on the city's central landmark (see
 * {@link openingCameraCenter}), so the app shows a built-up core — with
 * citizens and traffic on the streets — instead of whatever happens to sit at
 * the geometric middle of the map.
 *
 * ## Input
 *
 * Pan/zoom/click/pause/speed gestures all live in `src/input.ts`; the minimap
 * binds its own click-to-jump on `attach`. This file only composes.
 */

import './style.css';

import { createAppInput } from './input';
import type { AppInput } from './input';
import { SPEED_MULTIPLIERS } from './input';
import { createViewportCamera } from './render/camera';
import type { ViewportCamera, ViewportSize } from './render/camera';
import { DayNightLighting } from './render/daynight';
import { EntityPicker } from './render/picking';
import { CityRenderer } from './render/renderer';
import type { FrameStats } from './render/renderer';
import { CitizensSystem } from './sim/citizens';
import { DEFAULT_CITIZEN_COUNT } from './sim/citizens';
import { SimClock } from './sim/clock';
import type { SimTime } from './sim/clock';
import { CompaniesSystem } from './sim/companies';
import { EconomySystem } from './sim/economy';
import { SimulationEngine } from './sim/engine';
import type { SimSystem } from './sim/engine';
import { VehiclesSystem } from './sim/vehicles';
import type { Vec2 } from './sim/types';
import { createCityWorld } from './sim/world';
import type { CityWorld, WorldStats } from './sim/world';
import { HudOverlay } from './ui/hud';
import { EntityInspector } from './ui/inspector';
import { Minimap } from './ui/minimap';

/* -------------------------------------------------------------- constants -- */

/** Hour a fresh city starts at, so the first minutes already show daylight. */
export const DEFAULT_START_HOUR = 6;

/** Seed of the city a boot without options generates. */
export const DEFAULT_SEED = 20240917;

/** Speed multiplier a boot without options runs at. */
export const DEFAULT_SPEED = 1;

/** Zoom a boot without options starts at (clamped into the camera's range). */
export const DEFAULT_ZOOM = 1;

/**
 * On-screen pick tolerance, in logical pixels. Slightly wider than the picker's
 * own default so clicking a citizen or a vehicle in a busy street is
 * comfortable at the default zoom.
 */
const PICK_TOLERANCE_PX = 20;

/** Sim-minutes per fixed step; one tick is one sim-minute. */
export const MINUTES_PER_TICK = 1;

/** Fixed steps per real second at speed 1. */
export const TICKS_PER_SECOND = 60;

/** Largest real-time slice fed to the engine, so a tab switch cannot burst. */
export const MAX_FRAME_DELTA_MS = 250;

/** System name of the internal "drive the world clock" system. */
export const WORLD_SYSTEM_NAME = 'world';

/** Overlay slot the minimap canvas is mounted into. */
export const MINIMAP_HOST_ID = 'minimap';

/** Overlay slot the HUD and the inspector are mounted into. */
export const APP_HOST_ID = 'app';

/** Canvas the renderer draws into, matching the page shell. */
export const CITY_CANVAS_ID = 'city-canvas';

/** Viewport used when neither layout nor the window reports a size. */
const FALLBACK_VIEWPORT_WIDTH = 1280;
const FALLBACK_VIEWPORT_HEIGHT = 720;
/** Fallback animation-frame period when the host has no rAF. */
const FALLBACK_FRAME_MS = 16;

/* ------------------------------------------------------------------ types -- */

/** Construction options for {@link createCityApp}; every field is optional. */
export interface CityAppOptions {
  /** Document the shell is resolved in. Defaults to the global one. */
  readonly document?: Document;
  /** Canvas to render into. Defaults to `#city-canvas`, then a fresh canvas. */
  readonly canvas?: HTMLCanvasElement | null;
  /** City seed; the same seed always composes the same city. */
  readonly seed?: number | string;
  readonly startDay?: number;
  readonly startHour?: number;
  readonly startMinute?: number;
  /** Sim speed multiplier (see `SimulationEngine.setSpeed`). */
  readonly speed?: number;
  readonly minutesPerTick?: number;
  readonly ticksPerSecond?: number;
  /** Size of the generated citizen roster. Defaults to `DEFAULT_CITIZEN_COUNT`. */
  readonly citizenCount?: number;
  /** Initial camera zoom; clamped into the camera's own range. */
  readonly zoom?: number;
  /** Initial camera centre in world tiles. Defaults to {@link openingCameraCenter}. */
  readonly center?: Vec2;
  /** Explicit host viewport size; defaults to the measured canvas/window box. */
  readonly viewport?: ViewportSize;
  /** Overlay slot for the HUD; defaults to `#app`, then `document.body`. */
  readonly hudContainer?: HTMLElement | null;
  /** Overlay slot for the minimap. Defaults to `#minimap`; `null` disables it. */
  readonly minimapHost?: HTMLElement | null;
  /** Overlay slot for the inspector panel. Defaults to `#app`; `null` skips it. */
  readonly inspectorContainer?: HTMLElement | null;
  /** Monotonic millisecond clock for the UI cadences. Defaults to `performance.now`. */
  readonly now?: () => number;
  /** Device pixels per logical pixel of the canvas backing store. */
  readonly pixelRatio?: number;
  /** Set to false to compose without starting the frame loop. */
  readonly autoStart?: boolean;
}

/** What one frame of the loop did. */
export interface FrameResult {
  /** 1-based frame index. */
  readonly frame: number;
  /** Fixed simulation steps executed by this frame. */
  readonly ticks: number;
  /** Real-time slice fed to the engine, clamped to {@link MAX_FRAME_DELTA_MS}. */
  readonly deltaMs: number;
  /** Sim time after the frame's last fixed step. */
  readonly simTime: SimTime;
  /** Renderer stats, or `null` when the host cannot provide a 2D context. */
  readonly stats: FrameStats | null;
}

/** The composed application; also what `window.__citySim` points at. */
export type CitySimHandle = LiveCityApp;

/* --------------------------------------------------------------- app root -- */

/**
 * The wired application. Every subsystem is a public readonly field, so a host
 * (or a test) can assert on the exact instance the loop is driving, and the
 * lifecycle is one `dispose()` call.
 */
export class LiveCityApp {
  readonly document: Document;
  /** Window supplying the frame loop, the keyboard and resize events. */
  readonly window: Window | null;

  /* The simulation, in attach order. */
  readonly world: CityWorld;
  readonly clock: SimClock;
  readonly engine: SimulationEngine;
  readonly citizens: CitizensSystem;
  readonly companies: CompaniesSystem;
  readonly vehicles: VehiclesSystem;
  readonly economy: EconomySystem;

  /* The view and the surfaces. */
  readonly camera: ViewportCamera;
  readonly lighting: DayNightLighting;
  readonly renderer: CityRenderer;
  readonly hud: HudOverlay;
  readonly minimap: Minimap | null;
  readonly picker: EntityPicker;
  readonly inspector: EntityInspector;
  readonly input: AppInput;
  readonly canvas: HTMLCanvasElement;

  private readonly nowFn: () => number;
  private readonly canRender: boolean;
  private readonly autoStartFlag: boolean;

  private frameHandle: number | null = null;
  private lastTimestamp: number | null = null;
  private frameCountValue = 0;
  private disposedFlag = false;
  private worldStatsValue: WorldStats;

  constructor(options: CityAppOptions = {}) {
    const doc = options.document ?? (typeof document === 'undefined' ? undefined : document);
    if (!doc) {
      throw new Error('createCityApp() needs a Document; pass options.document outside a browser.');
    }
    this.document = doc;
    this.window = resolveWindow(doc);
    this.nowFn = options.now ?? defaultNow;
    this.autoStartFlag = options.autoStart ?? true;

    const canvas = resolveCanvas(doc, options.canvas ?? null);
    this.canvas = canvas;

    /* ---------------------------------------------------- simulation ---- */

    const minutesPerTick = options.minutesPerTick ?? MINUTES_PER_TICK;
    this.world = createCityWorld({ seed: options.seed ?? DEFAULT_SEED });
    this.clock = new SimClock({
      startDay: options.startDay ?? 0,
      startHour: options.startHour ?? DEFAULT_START_HOUR,
      startMinute: options.startMinute ?? 0,
      minutesPerTick,
    });
    this.engine = new SimulationEngine({
      clock: this.clock,
      minutesPerTick,
      ticksPerSecond: options.ticksPerSecond ?? TICKS_PER_SECOND,
      speed: options.speed ?? DEFAULT_SPEED,
    });
    this.citizens = new CitizensSystem({
      world: this.world,
      count: options.citizenCount ?? DEFAULT_CITIZEN_COUNT,
    });
    // The economy owns the labour market and the demand adapter the companies
    // hire and price through, so it is built first and bound to both sides.
    this.economy = new EconomySystem(this.world, { citizens: this.citizens });
    this.companies = new CompaniesSystem(this.world, {
      labourMarket: this.economy.createLabourMarket(),
      demandModel: this.economy.createDemandModel(),
      startDay: this.clock.day,
      startHour: this.clock.hourOfDay,
    });
    this.economy.bindCompanies(this.companies);
    this.vehicles = new VehiclesSystem({ world: this.world, citizens: this.citizens });

    this.worldStatsValue = this.world.stats();
    this.engine.attach(this.createWorldSystem());
    this.engine.attach(this.citizens);
    this.engine.attach(this.companies);
    this.engine.attach(this.vehicles);
    this.engine.attach(this.economy);

    /* -------------------------------------------------------- surfaces ---- */

    const viewport = options.viewport ?? measureViewport(canvas, this.window);
    this.camera = createViewportCamera(this.world, viewport, {
      zoom: options.zoom ?? DEFAULT_ZOOM,
      center: options.center ?? openingCameraCenter(this.world),
    });
    this.lighting = new DayNightLighting(this.clock);

    this.picker = new EntityPicker({
      camera: this.camera,
      world: this.world,
      baseTolerancePx: PICK_TOLERANCE_PX,
    });
    this.inspector = new EntityInspector({
      sources: {
        world: this.world,
        citizens: this.citizens,
        companies: this.companies,
        vehicles: this.vehicles,
        clock: this.clock,
      },
      now: this.nowFn,
    });
    mountInspector(this.inspector, doc, options.inspectorContainer);

    this.hud = new HudOverlay({
      document: doc,
      container: options.hudContainer,
      economy: this.economy,
      companies: this.companies,
      clock: this.clock,
      now: this.nowFn,
    });
    this.hud.attach(this.engine);

    this.minimap = mountMinimap(doc, options.minimapHost, this.world, this.camera, options.pixelRatio);

    /* ----------------------------------------------------------- input ---- */

    // Input attaches before the renderer so the camera is already bound to the
    // real host viewport when the first frame sizes the canvas backing store.
    this.input = createAppInput({
      canvas,
      camera: this.camera,
      engine: this.engine,
      picker: this.picker,
      inspector: this.inspector,
      window: this.window,
      document: doc,
      speeds: SPEED_MULTIPLIERS,
      viewportSize: () => measureViewport(canvas, this.window),
    });
    this.input.attach();

    const context = get2dContext(canvas);
    this.canRender = context !== null;
    this.renderer = new CityRenderer({
      world: this.world,
      camera: this.camera,
      context,
      citizens: this.citizens,
      vehicles: this.vehicles,
      lighting: this.lighting,
      pixelRatio: options.pixelRatio ?? resolvePixelRatio(this.window),
    });
    if (context) {
      this.renderer.attach(context, this.camera);
    }

    if (this.autoStartFlag) {
      this.start();
    }
  }

  /* -------------------------------------------------------------- reading -- */

  /** True when the boot was asked to start the frame loop by itself. */
  get autoStart(): boolean {
    return this.autoStartFlag;
  }

  /** Frames the loop has drawn since construction. */
  get frames(): number {
    return this.frameCountValue;
  }

  /** True once the frame loop has been scheduled or run. */
  get isRunning(): boolean {
    return this.frameHandle !== null;
  }

  /** True once {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.disposedFlag;
  }

  /** Latest aggregate reading of the world clock's geometry. */
  get worldStats(): WorldStats {
    return this.worldStatsValue;
  }

  /** Names of the systems attached to the engine, in attach order. */
  get systemNames(): readonly string[] {
    return this.engine.systems.map((system) => system.name);
  }

  /* ------------------------------------------------------------ lifecycle -- */

  /**
   * Starts the animation-frame loop. Idempotent, and a no-op after dispose.
   * The first frame only renders (there is no elapsed time yet), so a page load
   * shows the city before any sim minute has passed.
   */
  start(): void {
    if (this.disposedFlag || this.frameHandle !== null) {
      return;
    }
    this.lastTimestamp = null;
    this.frameHandle = requestFrame(this.onFrame);
  }

  /**
   * Runs one frame: the engine converts `realDeltaMs` of real time into fixed
   * simulation steps, the lighting samples the sim time just reached, and one
   * canvas frame is drawn. The overlays then refresh on their own cadence.
   *
   * This is the exact body of the animation-frame callback, exposed so tests and
   * hosts can drive the loop deterministically.
   */
  pump(realDeltaMs: number): FrameResult {
    if (this.disposedFlag) {
      return {
        frame: this.frameCountValue,
        ticks: 0,
        deltaMs: 0,
        simTime: this.clock.time,
        stats: null,
      };
    }
    const deltaMs = clampDelta(realDeltaMs);
    // Fixed steps: the engine drops the backlog beyond its step budget instead
    // of spiralling, and a paused engine runs none.
    const ticks = this.engine.update(deltaMs);
    // One palette per sim time, shared by the frame that follows.
    const sample = this.lighting.update();
    this.camera.update();
    this.picker.update(this.world);
    const stats = this.canRender ? this.renderer.frame(sample) : null;

    const nowMs = this.nowFn();
    this.minimap?.update(nowMs);
    this.inspector.update(nowMs);

    this.frameCountValue += 1;
    return {
      frame: this.frameCountValue,
      ticks,
      deltaMs,
      simTime: this.clock.time,
      stats,
    };
  }

  /** Pauses simulation time; the frame loop keeps rendering. */
  pause(): void {
    this.engine.pause();
  }

  /** Resumes simulation time. */
  resume(): void {
    this.engine.resume();
  }

  /** Flips pause state and returns the new value (`true` = paused). */
  togglePause(): boolean {
    return this.engine.togglePause();
  }

  /** Sets the speed multiplier (sim minutes per real second scale). */
  setSpeed(multiplier: number): void {
    this.engine.setSpeed(multiplier);
  }

  /** Alias of {@link dispose}, kept for hosts that only stop the loop. */
  stop(): void {
    this.dispose();
  }

  /**
   * Tears the whole application down: the rAF loop, every input listener, the
   * overlays (HUD, inspector, minimap canvas), the renderer, the picker, the
   * camera and the engine with all of its systems. Idempotent, and it also
   * clears the module-level boot handle and `window.__citySim`.
   */
  dispose(): void {
    if (this.disposedFlag) {
      return;
    }
    this.disposedFlag = true;
    if (this.frameHandle !== null) {
      cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.input.dispose();

    const minimap = this.minimap;
    if (minimap) {
      minimap.dispose();
      // The minimap owns its canvas but not the mount it was handed, so the
      // composition root takes it back out: a re-boot never leaves two behind.
      const minimapCanvas = minimap.canvas;
      if (minimapCanvas.parentElement) {
        minimapCanvas.parentElement.removeChild(minimapCanvas);
      }
    }

    this.inspector.dispose();
    this.hud.dispose();
    this.renderer.dispose();
    this.picker.dispose();
    // Detaches citizens, companies, vehicles, the economy and the world driver.
    this.engine.dispose();
    this.camera.dispose();

    if (activeApp === this) {
      activeApp = null;
    }
    if (this.window && this.window.__citySim === this) {
      delete this.window.__citySim;
    }
  }

  /* ------------------------------------------------------------ internals -- */

  private readonly onFrame = (timestamp: number): void => {
    this.frameHandle = null;
    if (this.disposedFlag) {
      return;
    }
    const delta = this.lastTimestamp === null ? 0 : Math.max(0, timestamp - this.lastTimestamp);
    this.lastTimestamp = timestamp;
    this.pump(delta);
    if (!this.disposedFlag) {
      this.frameHandle = requestFrame(this.onFrame);
    }
  };

  /** Drives the world clock once per fixed step, before every other system. */
  private createWorldSystem(): SimSystem {
    return {
      name: WORLD_SYSTEM_NAME,
      update: (context) => {
        this.worldStatsValue = this.world.update(context.deltaMinutes);
      },
    };
  }
}

/* -------------------------------------------------------------- boot glue -- */

/** The app the module-level boot created, when there is one. */
let activeApp: CitySimHandle | null = null;

/** The app currently booted by the module, or `null`. */
export function getActiveCityApp(): CitySimHandle | null {
  return activeApp;
}

/** Composes a city app; pass `autoStart: false` to drive `pump()` by hand. */
export function createCityApp(options: CityAppOptions = {}): CitySimHandle {
  return new LiveCityApp(options);
}

/**
 * Composes a city app and (by default) starts its frame loop immediately.
 * A second boot in the same page first disposes the previous one, so no loop,
 * listener or overlay can ever be duplicated.
 */
export function bootCityApp(options: CityAppOptions = {}): CitySimHandle {
  activeApp?.dispose();
  const app = createCityApp(options);
  activeApp = app;
  if (app.window) {
    app.window.__citySim = app;
  }
  return app;
}

/** Stops the app the module booted, disposing every subsystem. */
export function stopCitySimulation(): void {
  activeApp?.dispose();
}

/* ----------------------------------------------------------------- helpers -- */

function resolveWindow(doc: Document): Window | null {
  const view = doc.defaultView;
  if (view) {
    return view;
  }
  return typeof window === 'undefined' ? null : window;
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function resolvePixelRatio(win: Window | null): number {
  return win && typeof win.devicePixelRatio === 'number' && win.devicePixelRatio > 0
    ? win.devicePixelRatio
    : 1;
}

function clampDelta(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(MAX_FRAME_DELTA_MS, value);
}

function requestFrame(callback: (timestamp: number) => void): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(defaultNow()), FALLBACK_FRAME_MS) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}

/** The canvas to render the city into: supplied, `#city-canvas`, or a new one. */
function resolveCanvas(targetDocument: Document, provided: HTMLCanvasElement | null): HTMLCanvasElement {
  if (provided) {
    return provided;
  }
  const existing = targetDocument.getElementById(CITY_CANVAS_ID);
  if (existing && existing.tagName === 'CANVAS') {
    return existing as HTMLCanvasElement;
  }
  const canvas = targetDocument.createElement('canvas');
  canvas.id = CITY_CANVAS_ID;
  const host = targetDocument.getElementById(APP_HOST_ID) ?? targetDocument.body;
  host.appendChild(canvas);
  return canvas;
}

function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  } catch {
    return null;
  }
}

/**
 * Host viewport in logical pixels: the canvas' laid-out box when the layout
 * engine reports one, the window, then the fallback. The renderer derives its
 * backing store from the camera, so this is the one measurement the whole view
 * shares.
 */
export function measureViewport(canvas: HTMLElement, win: Window | null): ViewportSize {
  const bounds =
    typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
  let width = bounds && Number.isFinite(bounds.width) ? bounds.width : 0;
  let height = bounds && Number.isFinite(bounds.height) ? bounds.height : 0;
  if (width <= 0) {
    width = (win ? win.innerWidth : 0) || canvas.clientWidth || FALLBACK_VIEWPORT_WIDTH;
  }
  if (height <= 0) {
    height = (win ? win.innerHeight : 0) || canvas.clientHeight || FALLBACK_VIEWPORT_HEIGHT;
  }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

/**
 * Where a fresh city opens: the landmark building closest to the geometric
 * centre of the map. The geometric centre can be a road junction or a patch of
 * grass, which makes for a dull first frame and a dead spot in the middle of
 * the screen; the central landmark puts the city's core — and an inspectable
 * entity — right in front of the player. Falls back to the map centre when the
 * world has no landmarks.
 */
export function openingCameraCenter(world: Pick<CityWorld, 'widthInTiles' | 'heightInTiles' | 'buildings'>): Vec2 {
  const center: Vec2 = { x: world.widthInTiles / 2, y: world.heightInTiles / 2 };
  let best: Vec2 | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const building of world.buildings) {
    if (!building.landmark) {
      continue;
    }
    const point: Vec2 = {
      x: building.footprint.x + building.footprint.width / 2,
      y: building.footprint.y + building.footprint.height / 2,
    };
    const distance = Math.hypot(point.x - center.x, point.y - center.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best ?? center;
}

/**
 * Mounts the inspector panel when the shell provides an overlay slot. A bare
 * document (headless render, unit test) gets the inspector object without a
 * panel: `select()` still records the selection for hosts that only read state.
 */
function mountInspector(
  inspector: EntityInspector,
  doc: Document,
  provided: HTMLElement | null | undefined,
): void {
  const container = provided === undefined ? doc.getElementById(APP_HOST_ID) : provided;
  if (container) {
    inspector.attach(container);
  }
}

/**
 * Creates and attaches the minimap when the page provides its overlay slot.
 * `options.minimapHost` forces the decision: `null` disables the minimap.
 */
function mountMinimap(
  doc: Document,
  provided: HTMLElement | null | undefined,
  world: CityWorld,
  camera: ViewportCamera,
  pixelRatio: number | undefined,
): Minimap | null {
  const host = provided === undefined ? doc.getElementById(MINIMAP_HOST_ID) : provided;
  if (!host) {
    return null;
  }
  const minimap = new Minimap({
    world,
    camera,
    document: doc,
    pixelRatio:
      typeof pixelRatio === 'number' && pixelRatio > 0
        ? Math.min(2, pixelRatio)
        : undefined,
  });
  minimap.attach(host);
  return minimap;
}

/* -------------------------------------------------------------- browser -- */

declare global {
  interface Window {
    /** Set while the simulation is running; handy for smoke checks in devtools. */
    __citySim?: CitySimHandle;
  }
}

// Auto boot: loading the page is all it takes to start the simulation.
if (typeof document !== 'undefined') {
  bootCityApp({ document });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activeApp?.dispose();
  });
}
