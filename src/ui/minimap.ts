/**
 * The minimap: a compact second canvas that always shows the whole city.
 *
 * The generated city is 160x120 tiles (5120x3840 world pixels), far larger than
 * any browser window, so the main canvas can only ever show a slice of it. The
 * minimap answers "where am I?" by painting a fixed, complete overview of the
 * world into a small canvas — district fills, the road network and every
 * building footprint — plus two live layers:
 *
 * - a rectangle whose corners are the camera's visible world bounds mapped
 *   through the same fixed scale, so it always shows exactly what the browser
 *   window is looking at;
 * - one dot per vehicle, read from `world.vehicles` at draw time.
 *
 * ## What it owns
 *
 * The minimap owns no simulation state and no camera. It reads the world
 * (`WorldMap`, plus the optional `districts` overview `CityWorld` provides) and
 * it reads the one authoritative {@link ViewportCamera}. Pointer input is
 * translated into `camera.centerOn(...)` calls, and wheel input into
 * `camera.zoomBy(...)`, so gestures recentre *that* camera and inherit its zoom
 * clamping instead of introducing a second viewport.
 *
 * ## Cadence
 *
 * Traffic is the only thing that changes between overview frames, so the
 * minimap does not need the 60 fps main-frame rate:
 *
 * - {@link Minimap.update} redraws at most once per `redrawIntervalMs`
 *   (default {@link MINIMAP_REDRAW_INTERVAL_MS}, 250 ms) no matter how often
 *   the host frame loop calls it;
 * - {@link Minimap.attach} also schedules its own 250 ms timer, so the overview
 *   keeps refreshing even when the host loop is throttled;
 * - {@link Minimap.draw} is the unconditional one-off redraw used by pointer
 *   interaction — so the rectangle follows a click immediately — and by tests.
 *
 * ## Mapping
 *
 * The world -> minimap scale is fixed for the lifetime of the instance:
 *
 *     minimap.x = (world.x / worldWidthInTiles) * width
 *
 * The whole world always maps onto the whole canvas; only the viewport
 * rectangle moves. {@link worldPointToMinimap}, {@link minimapPointToWorld},
 * {@link worldRectToMinimapRect} and {@link minimapRectToWorldRect} expose that
 * mapping for hosts, tests and any future inspector overlay.
 *
 * ## Purity
 *
 * The module never touches a simulation collection it does not own and never
 * mutates the world: drawing only reads `nodes`, `segments`, `buildings` and
 * `vehicles`. Every DOM access (canvas creation, pointer listeners, resize) is
 * guarded, so the class can be constructed around a supplied canvas in a
 * headless test double.
 */

import './minimap.css';

import type { ViewportCamera } from '../render/camera';
import type { EntityId, TileRect, Vec2, WorldMap } from '../sim/types';
import { districtIndexForTile } from '../sim/world';
import type { District } from '../sim/world';

/* -------------------------------------------------------------- constants -- */

/** Default minimap width in logical (CSS) pixels. */
export const MINIMAP_WIDTH = 220;

/** Default minimap height in logical (CSS) pixels: the 4:3 aspect of the city. */
export const MINIMAP_HEIGHT = 165;

/** Default redraw cadence: four overview frames per second. */
export const MINIMAP_REDRAW_INTERVAL_MS = 250;

/** Wheel sensitivity: `factor = exp(-deltaY * MINIMAP_WHEEL_ZOOM_RATE)`. */
export const MINIMAP_WHEEL_ZOOM_RATE = 0.0015;

/** Id given to a canvas the minimap creates itself. */
export const MINIMAP_CANVAS_ID = 'minimap-canvas';

/** Canvas fill behind the overview. */
export const MINIMAP_BACKGROUND = '#0a1120';

/** Road network colour. */
export const MINIMAP_ROAD_COLOR = '#7d8aa3';

/** Baseline road stroke width, in logical pixels. */
export const MINIMAP_ROAD_WIDTH = 1.2;

/** Extra stroke width each road lane adds. */
export const MINIMAP_ROAD_LANE_WIDTH = 0.6;

/** Upper bound for road stroke widths, in logical pixels. */
export const MINIMAP_MAX_ROAD_WIDTH = 3;

/** Alpha district fills are drawn with, so roads and buildings stay readable. */
export const MINIMAP_DISTRICT_ALPHA = 0.55;

/** Hairline separating two neighbouring district fills. */
export const MINIMAP_DISTRICT_BORDER = 'rgba(232, 238, 251, 0.10)';

/** Radius of one traffic dot, in logical pixels. */
export const MINIMAP_TRAFFIC_DOT_RADIUS = 1.6;

/** Translucent wash inside the viewport rectangle. */
export const MINIMAP_VIEWPORT_FILL = 'rgba(245, 247, 255, 0.16)';

/** Stroke colour of the viewport rectangle: the frame of "what you look at". */
export const MINIMAP_VIEWPORT_STROKE = '#f8fbff';

/** Stroke width of the viewport rectangle, in logical pixels. */
export const MINIMAP_VIEWPORT_LINE_WIDTH = 1.5;

/**
 * District fill palette used when a world carries no district metadata. The
 * order matches the generator's nine row-major quarters, so a structural
 * `WorldMap` still reads as nine distinct neighbourhoods.
 */
export const MINIMAP_DISTRICT_PALETTE: readonly string[] = [
  '#8fb7d8',
  '#7fa9c9',
  '#a9b6d6',
  '#d8a25f',
  '#9aa7c8',
  '#c8b6e2',
  '#7dbb6a',
  '#d0a24d',
  '#b08968',
];

/** Highest device pixel ratio the backing store is scaled to. */
export const MAX_MINIMAP_PIXEL_RATIO = 2;

const FULL_TURN = Math.PI * 2;

/* ------------------------------------------------------------------ types -- */

/**
 * The world the minimap draws, plus the optional district overview. `CityWorld`
 * satisfies this structurally; any plain `WorldMap` is accepted too, and the
 * nine quarters are then reconstructed from the declared extent (see
 * {@link collectMinimapDistricts}).
 */
export interface MinimapWorld extends WorldMap {
  /** Named quarters; synthesised when a world does not publish them. */
  readonly districts?: readonly District[];
}

/** The fixed world -> minimap mapping one minimap draws with. */
export interface MinimapView {
  /** Canvas width in logical pixels. */
  readonly width: number;
  /** Canvas height in logical pixels. */
  readonly height: number;
  /** World width in tiles; the overview always spans all of it. */
  readonly worldWidthInTiles: number;
  /** World height in tiles; the overview always spans all of it. */
  readonly worldHeightInTiles: number;
}

/** A rectangle in minimap (canvas) pixels. */
export interface MinimapRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One district as the minimap draws it. */
export interface MinimapDistrict {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  /** District extent in world tile coordinates. */
  readonly bounds: TileRect;
}

/** Anything a canvas can be mounted into (an `HTMLElement`, or a stub). */
export interface MinimapHost {
  appendChild(node: HTMLCanvasElement): unknown;
}

/** Construction options; only `world` and `camera` are required. */
export interface MinimapOptions {
  /** The city to overview. */
  readonly world: MinimapWorld;
  /** The one authoritative camera the rectangle and gestures mirror. */
  readonly camera: ViewportCamera;
  /** Canvas to draw into; one is created when omitted and `document` is set. */
  readonly canvas?: HTMLCanvasElement | null;
  /** Document used to create a canvas and to observe drags outside it. */
  readonly document?: Document | null;
  /** Logical width in CSS pixels. Defaults to {@link MINIMAP_WIDTH}. */
  readonly width?: number;
  /** Logical height in CSS pixels. Defaults to {@link MINIMAP_HEIGHT}. */
  readonly height?: number;
  /** Redraw cadence in milliseconds. Defaults to {@link MINIMAP_REDRAW_INTERVAL_MS}. */
  readonly redrawIntervalMs?: number;
  /** Backing-store scale; defaults to the device pixel ratio, capped at 2. */
  readonly pixelRatio?: number;
  /** District metadata override; defaults to `world.districts`. */
  readonly districts?: readonly District[] | null;
  /** Overview background fill. Defaults to {@link MINIMAP_BACKGROUND}. */
  readonly background?: string;
  /** Road network colour. Defaults to {@link MINIMAP_ROAD_COLOR}. */
  readonly roadColor?: string;
}

/* --------------------------------------------------------------- mapping -- */

/** Maps a world (tile) position onto a minimap pixel position. */
export function worldPointToMinimap(point: Vec2, view: MinimapView): Vec2 {
  return {
    x: (point.x / view.worldWidthInTiles) * view.width,
    y: (point.y / view.worldHeightInTiles) * view.height,
  };
}

/** Maps a minimap pixel position back onto a world (tile) position. */
export function minimapPointToWorld(point: Vec2, view: MinimapView): Vec2 {
  return {
    x: (point.x / view.width) * view.worldWidthInTiles,
    y: (point.y / view.height) * view.worldHeightInTiles,
  };
}

/** Maps a world (tile) rectangle onto a minimap pixel rectangle. */
export function worldRectToMinimapRect(rect: TileRect, view: MinimapView): MinimapRect {
  const topLeft = worldPointToMinimap({ x: rect.x, y: rect.y }, view);
  const bottomRight = worldPointToMinimap(
    { x: rect.x + rect.width, y: rect.y + rect.height },
    view,
  );
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

/** Maps a minimap pixel rectangle back onto a world (tile) rectangle. */
export function minimapRectToWorldRect(rect: MinimapRect, view: MinimapView): TileRect {
  const topLeft = minimapPointToWorld({ x: rect.x, y: rect.y }, view);
  const bottomRight = minimapPointToWorld(
    { x: rect.x + rect.width, y: rect.y + rect.height },
    view,
  );
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

/* ------------------------------------------------------------- districts -- */

/**
 * Resolves the districts the minimap draws: the world's own named quarters when
 * it publishes them, a reconstructed nine-quarter grid otherwise.
 */
export function collectMinimapDistricts(
  world: MinimapWorld,
  provided?: readonly District[] | null,
): MinimapDistrict[] {
  const source = provided ?? world.districts;
  if (source && source.length > 0) {
    return source.map((district) => ({
      id: district.id,
      name: district.name,
      color: district.color,
      bounds: { ...district.bounds },
    }));
  }
  return synthesizeDistricts(world);
}

/** One run of equal district indices along an axis, in tile coordinates. */
interface IndexRun {
  readonly start: number;
  readonly end: number;
}

/**
 * Rebuilds the generator's district grid from the declared world extent alone,
 * so structural `WorldMap`s (fixtures, custom worlds) still get district fills.
 * Boundaries are found by sampling `districtIndexForTile` along each axis, so
 * the fallback always agrees with the world module instead of duplicating its
 * boundary fractions.
 */
function synthesizeDistricts(world: MinimapWorld): MinimapDistrict[] {
  const { widthInTiles, heightInTiles } = world;
  const columns = indexRuns(widthInTiles, (value) =>
    districtIndexForTile(value, 0, widthInTiles, heightInTiles),
  );
  const rows = indexRuns(heightInTiles, (value) =>
    districtIndexForTile(0, value, widthInTiles, heightInTiles),
  );

  const districts: MinimapDistrict[] = [];
  for (const row of rows) {
    for (const column of columns) {
      const index = districtIndexForTile(column.start, row.start, widthInTiles, heightInTiles);
      districts.push({
        id: `district-${index}`,
        name: `District ${index + 1}`,
        color: MINIMAP_DISTRICT_PALETTE[index % MINIMAP_DISTRICT_PALETTE.length],
        bounds: {
          x: column.start,
          y: row.start,
          width: column.end - column.start,
          height: row.end - row.start,
        },
      });
    }
  }
  return districts;
}

/** Splits `0..size` into runs that share one district index on an axis. */
function indexRuns(size: number, indexAt: (value: number) => number): IndexRun[] {
  const runs: IndexRun[] = [];
  let start = 0;
  let current = indexAt(0);
  for (let value = 1; value <= size; value += 1) {
    const index = value === size ? Number.NaN : indexAt(value);
    if (value === size || index !== current) {
      runs.push({ start, end: value });
      start = value;
      current = index;
    }
  }
  return runs;
}

/* ---------------------------------------------------------------- helpers -- */

function assertPositiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite number greater than 0, received ${value}`);
  }
  return value;
}

function currentTimeMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function defaultPixelRatio(): number {
  const ratio =
    typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
      ? window.devicePixelRatio
      : 1;
  return Math.min(MAX_MINIMAP_PIXEL_RATIO, Math.max(1, ratio));
}

/** Node timers must not keep a headless process alive. */
function unrefTimer(handle: ReturnType<typeof setTimeout>): void {
  const candidate = handle as { unref?: () => void };
  if (typeof candidate.unref === 'function') {
    candidate.unref();
  }
}

function resolveCanvas(options: MinimapOptions): HTMLCanvasElement {
  if (options.canvas) {
    return options.canvas;
  }
  const targetDocument =
    options.document ?? (typeof document === 'undefined' ? null : document);
  if (!targetDocument || typeof targetDocument.createElement !== 'function') {
    throw new Error('Minimap needs a canvas or a Document to create one; neither was available.');
  }
  const canvas = targetDocument.createElement('canvas');
  canvas.id = MINIMAP_CANVAS_ID;
  return canvas;
}

function resolveContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  if (typeof canvas.getContext !== 'function') {
    return null;
  }
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- minimap -- */

export class Minimap {
  /** The city being overviewed. Never mutated by this class. */
  readonly world: MinimapWorld;
  /** The one authoritative camera this minimap mirrors. */
  readonly camera: ViewportCamera;
  /** Canvas the overview is painted into. */
  readonly canvas: HTMLCanvasElement;
  /** Logical width in CSS pixels. */
  readonly width: number;
  /** Logical height in CSS pixels. */
  readonly height: number;
  /** Minimum milliseconds between two cadence-driven redraws. */
  readonly redrawIntervalMs: number;
  /** Backing-store scale (`canvas.width = width * pixelRatio`). */
  readonly pixelRatio: number;
  /** Districts as drawn, resolved once because the world geometry is fixed. */
  readonly districts: readonly MinimapDistrict[];

  private readonly contextRef: CanvasRenderingContext2D | null;
  private readonly viewValue: MinimapView;
  private readonly nodePositions: Map<EntityId, Vec2>;
  private readonly background: string;
  private readonly roadColor: string;
  private readonly downEventType: string;
  private readonly moveEventType: string;
  private readonly upEventTypes: readonly string[];

  private attachedFlag = false;
  private listenersBound = false;
  private dragBound = false;
  private draggingFlag = false;
  private disposedFlag = false;
  private lastDrawAtValue: number | null = null;
  private drawCountValue = 0;
  private timerHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(options: MinimapOptions) {
    if (!options || !options.world) {
      throw new TypeError('Minimap needs the world to overview (options.world).');
    }
    if (!options.camera || typeof options.camera.centerOn !== 'function') {
      throw new TypeError('Minimap needs the authoritative ViewportCamera (options.camera).');
    }

    this.world = options.world;
    this.camera = options.camera;
    this.width = assertPositiveFinite(options.width ?? MINIMAP_WIDTH, 'options.width');
    this.height = assertPositiveFinite(options.height ?? MINIMAP_HEIGHT, 'options.height');
    this.redrawIntervalMs = assertPositiveFinite(
      options.redrawIntervalMs ?? MINIMAP_REDRAW_INTERVAL_MS,
      'options.redrawIntervalMs',
    );
    this.pixelRatio = assertPositiveFinite(
      options.pixelRatio ?? defaultPixelRatio(),
      'options.pixelRatio',
    );
    this.canvas = resolveCanvas(options);
    this.contextRef = resolveContext(this.canvas);
    this.background = options.background ?? MINIMAP_BACKGROUND;
    this.roadColor = options.roadColor ?? MINIMAP_ROAD_COLOR;
    this.districts = collectMinimapDistricts(this.world, options.districts);
    this.viewValue = Object.freeze({
      width: this.width,
      height: this.height,
      worldWidthInTiles: this.world.widthInTiles,
      worldHeightInTiles: this.world.heightInTiles,
    });
    this.nodePositions = indexRoadNodes(this.world);

    // A canvas the app styles itself keeps its own box; the minimap only reads
    // it back for pointer mapping, so this is a fallback for hosts without CSS.
    const usesPointerEvents = typeof window !== 'undefined' && 'PointerEvent' in window;
    this.downEventType = usesPointerEvents ? 'pointerdown' : 'mousedown';
    this.moveEventType = usesPointerEvents ? 'pointermove' : 'mousemove';
    this.upEventTypes = usesPointerEvents
      ? ['pointerup', 'pointercancel']
      : ['mouseup'];

    this.configureCanvas();
  }

  /* -------------------------------------------------------------- reading -- */

  /** The fixed world -> minimap mapping this instance draws with. */
  get view(): MinimapView {
    return this.viewValue;
  }

  /** The recording/real 2D context, or null when the canvas cannot provide one. */
  get context(): CanvasRenderingContext2D | null {
    return this.contextRef;
  }

  /** Number of redraws requested since construction (including headless ones). */
  get drawCount(): number {
    return this.drawCountValue;
  }

  /** Timestamp of the last redraw, or null before the first one. */
  get lastDrawAt(): number | null {
    return this.lastDrawAtValue;
  }

  /** True once {@link attach} has bound the canvas, listeners and timer. */
  get isAttached(): boolean {
    return this.attachedFlag;
  }

  /** True while a click or drag on the minimap is steering the camera. */
  get isDragging(): boolean {
    return this.draggingFlag;
  }

  /** True once {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.disposedFlag;
  }

  /**
   * The camera's visible world bounds as a minimap rectangle: the live frame
   * showing exactly what the browser window is looking at. Re-derived on every
   * call, so it can never go stale.
   */
  viewportRect(): MinimapRect {
    return worldRectToMinimapRect(this.camera.viewport, this.viewValue);
  }

  /* ------------------------------------------------------------ lifecycle -- */

  /**
   * Binds the minimap to the page: optionally mounts the canvas into `host`,
   * installs pointer/wheel listeners, paints the first frame and starts the
   * self-scheduled redraw timer. Idempotent.
   */
  attach(host: MinimapHost | null = null): void {
    this.assertUsable('attach');
    const mountable = Boolean(host && typeof host.appendChild === 'function');
    if (this.attachedFlag) {
      // Already bound: only honour a fresh mount request, and never install a
      // second timer or repaint on a redundant call.
      if (mountable) {
        (host as MinimapHost).appendChild(this.canvas);
      }
      return;
    }
    this.attachedFlag = true;
    if (mountable) {
      (host as MinimapHost).appendChild(this.canvas);
    }
    this.bindEventListeners();
    this.scheduleRedraw();
    this.draw();
  }

  /**
   * Render-loop hook. Redraws only when `nowMs` is at least `redrawIntervalMs`
   * past the previous frame, so calling it at 60 fps still yields four overview
   * frames per second. Returns whether a redraw happened.
   */
  update(nowMs: number = currentTimeMs()): boolean {
    if (this.disposedFlag) {
      return false;
    }
    if (this.lastDrawAtValue !== null && nowMs - this.lastDrawAtValue < this.redrawIntervalMs) {
      return false;
    }
    this.draw(nowMs);
    return true;
  }

  /** Paints one overview frame immediately, regardless of cadence. */
  draw(nowMs: number = currentTimeMs()): void {
    this.assertUsable('draw');
    this.drawCountValue += 1;
    this.lastDrawAtValue = nowMs;
    const context = this.contextRef;
    if (!context) {
      return;
    }
    this.applyCanvasSize();
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    context.fillStyle = this.background;
    context.fillRect(0, 0, this.width, this.height);
    this.drawDistricts(context);
    this.drawRoads(context);
    this.drawBuildings(context);
    this.drawTraffic(context);
    this.drawViewportRect(context);
  }

  /**
   * Unbinds listeners and the redraw timer and clears the canvas. Idempotent;
   * after it runs, mutating calls throw so a disposed minimap is never reused.
   */
  dispose(): void {
    if (this.disposedFlag) {
      return;
    }
    this.disposedFlag = true;
    this.draggingFlag = false;
    this.unbindDragListeners();
    this.unbindEventListeners();
    if (this.timerHandle !== null) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
    if (this.contextRef) {
      this.contextRef.clearRect(0, 0, this.width, this.height);
    }
  }

  /* ---------------------------------------------------------- interaction -- */

  /**
   * Handles the start of a click or drag at `point` (minimap pixels): the
   * camera jumps so that world point becomes the viewport centre, and the
   * rectangle is repainted straight away.
   */
  pointerDown(point: Vec2): void {
    this.assertUsable('pointerDown');
    this.draggingFlag = true;
    this.recenterOn(point);
  }

  /** Handles a drag step; ignored unless a drag is in progress. */
  pointerMove(point: Vec2): void {
    this.assertUsable('pointerMove');
    if (!this.draggingFlag) {
      return;
    }
    this.recenterOn(point);
  }

  /** Ends a click or drag. Safe to call when no drag is in progress. */
  pointerUp(): void {
    this.draggingFlag = false;
  }

  /**
   * Recentres the main camera on the world point under `point`, clamped to the
   * world bounds by the camera itself, and repaints. Returns that camera's
   * clamped viewport rectangle.
   */
  recenterOn(point: Vec2): TileRect {
    this.assertUsable('recenterOn');
    const world = minimapPointToWorld(point, this.viewValue);
    const rect = this.camera.centerOn(world.x, world.y);
    this.draw();
    return rect;
  }

  /**
   * Zooms the main camera by `factor` through its own API, so the result is
   * clamped into the camera's zoom range, and repaints.
   */
  zoomBy(factor: number): TileRect {
    this.assertUsable('zoomBy');
    const rect = this.camera.zoomBy(factor);
    this.draw();
    return rect;
  }

  /**
   * Maps a client (page) position onto the minimap's logical pixel grid. Uses
   * the canvas' laid-out CSS box when the layout engine reports one — so a
   * scaled or offset canvas still picks correctly — and falls back to the
   * configured size in headless contexts (unit tests, unlaid-out DOM).
   */
  clientToMinimapPoint(clientX: number, clientY: number): Vec2 {
    const bounds =
      typeof this.canvas.getBoundingClientRect === 'function'
        ? this.canvas.getBoundingClientRect()
        : null;
    const cssWidth = bounds && bounds.width > 0 ? bounds.width : this.width;
    const cssHeight = bounds && bounds.height > 0 ? bounds.height : this.height;
    const left = bounds && Number.isFinite(bounds.left) ? bounds.left : 0;
    const top = bounds && Number.isFinite(bounds.top) ? bounds.top : 0;
    return {
      x: ((clientX - left) / cssWidth) * this.width,
      y: ((clientY - top) / cssHeight) * this.height,
    };
  }

  /* ------------------------------------------------------------- drawing -- */

  private drawDistricts(context: CanvasRenderingContext2D): void {
    const view = this.viewValue;
    context.save();
    context.globalAlpha = MINIMAP_DISTRICT_ALPHA;
    for (const district of this.districts) {
      const rect = worldRectToMinimapRect(district.bounds, view);
      context.fillStyle = district.color;
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    context.restore();
    context.globalAlpha = 1;

    context.strokeStyle = MINIMAP_DISTRICT_BORDER;
    context.lineWidth = 1;
    for (const district of this.districts) {
      const rect = worldRectToMinimapRect(district.bounds, view);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  private drawRoads(context: CanvasRenderingContext2D): void {
    const view = this.viewValue;
    context.strokeStyle = this.roadColor;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const segment of this.world.segments) {
      const from = this.nodePositions.get(segment.fromNodeId);
      const to = this.nodePositions.get(segment.toNodeId);
      if (!from || !to) {
        continue;
      }
      const start = worldPointToMinimap(from, view);
      const end = worldPointToMinimap(to, view);
      context.lineWidth = Math.min(
        MINIMAP_MAX_ROAD_WIDTH,
        MINIMAP_ROAD_WIDTH + segment.lanes * MINIMAP_ROAD_LANE_WIDTH,
      );
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    }
  }

  private drawBuildings(context: CanvasRenderingContext2D): void {
    const view = this.viewValue;
    for (const building of this.world.buildings) {
      const rect = worldRectToMinimapRect(building.footprint, view);
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      context.fillStyle = building.color;
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  /** Live traffic: one dot per vehicle, read from the world at draw time. */
  private drawTraffic(context: CanvasRenderingContext2D): void {
    const view = this.viewValue;
    for (const vehicle of this.world.vehicles) {
      const point = worldPointToMinimap(vehicle.position, view);
      context.beginPath();
      context.arc(point.x, point.y, MINIMAP_TRAFFIC_DOT_RADIUS, 0, FULL_TURN);
      context.fillStyle = vehicle.color;
      context.fill();
    }
  }

  private drawViewportRect(context: CanvasRenderingContext2D): void {
    const rect = this.viewportRect();
    context.save();
    context.fillStyle = MINIMAP_VIEWPORT_FILL;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    context.strokeStyle = MINIMAP_VIEWPORT_STROKE;
    context.lineWidth = MINIMAP_VIEWPORT_LINE_WIDTH;
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    context.restore();
  }

  /* --------------------------------------------------------------- canvas -- */

  private configureCanvas(): void {
    const style = (this.canvas as { style?: CSSStyleDeclaration }).style;
    if (style) {
      style.width = `${this.width}px`;
      style.height = `${this.height}px`;
    }
    if (typeof this.canvas.setAttribute === 'function') {
      this.canvas.setAttribute('role', 'img');
      this.canvas.setAttribute(
        'aria-label',
        `City minimap: overview of the ${this.world.widthInTiles}x${this.world.heightInTiles} tile city with the visible viewport`,
      );
    }
    this.applyCanvasSize();
  }

  private applyCanvasSize(): void {
    const backingWidth = Math.max(1, Math.round(this.width * this.pixelRatio));
    const backingHeight = Math.max(1, Math.round(this.height * this.pixelRatio));
    if (this.canvas.width !== backingWidth) {
      this.canvas.width = backingWidth;
    }
    if (this.canvas.height !== backingHeight) {
      this.canvas.height = backingHeight;
    }
  }

  /* ---------------------------------------------------------------- timer -- */

  private scheduleRedraw(): void {
    if (this.timerHandle !== null || this.disposedFlag || typeof setTimeout !== 'function') {
      return;
    }
    this.timerHandle = setTimeout(() => {
      this.timerHandle = null;
      if (this.disposedFlag) {
        return;
      }
      this.draw();
      this.scheduleRedraw();
    }, this.redrawIntervalMs);
    unrefTimer(this.timerHandle);
  }

  /* -------------------------------------------------------------- events -- */

  private bindEventListeners(): void {
    if (this.listenersBound || typeof this.canvas.addEventListener !== 'function') {
      return;
    }
    this.canvas.addEventListener(this.downEventType, this.onPointerDown);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.listenersBound = true;
  }

  private unbindEventListeners(): void {
    if (!this.listenersBound) {
      return;
    }
    if (typeof this.canvas.removeEventListener === 'function') {
      this.canvas.removeEventListener(this.downEventType, this.onPointerDown);
      this.canvas.removeEventListener('wheel', this.onWheel);
    }
    this.listenersBound = false;
  }

  private bindDragListeners(): void {
    if (this.dragBound) {
      return;
    }
    const target = this.dragTarget();
    if (typeof target.addEventListener !== 'function') {
      return;
    }
    target.addEventListener(this.moveEventType, this.onDragMove);
    for (const type of this.upEventTypes) {
      target.addEventListener(type, this.onDragEnd);
    }
    this.dragBound = true;
  }

  private unbindDragListeners(): void {
    if (!this.dragBound) {
      return;
    }
    const target = this.dragTarget();
    if (typeof target.removeEventListener === 'function') {
      target.removeEventListener(this.moveEventType, this.onDragMove);
      for (const type of this.upEventTypes) {
        target.removeEventListener(type, this.onDragEnd);
      }
    }
    this.dragBound = false;
  }

  /**
   * Where move/end events are observed once a drag starts: the canvas' document
   * so the pointer may leave the minimap mid-drag, or the canvas itself in
   * headless setups without a document.
   */
  private dragTarget(): EventTarget {
    const owner = (this.canvas as { ownerDocument?: Document | null }).ownerDocument;
    if (owner && typeof owner.addEventListener === 'function') {
      return owner;
    }
    return this.canvas;
  }

  private readonly onPointerDown = (event: Event): void => {
    this.draggingFlag = true;
    this.recenterOn(this.eventToMinimapPoint(event));
    this.bindDragListeners();
    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
  };

  private readonly onDragMove = (event: Event): void => {
    if (!this.draggingFlag) {
      return;
    }
    this.pointerMove(this.eventToMinimapPoint(event));
  };

  private readonly onDragEnd = (event: Event): void => {
    this.pointerUp();
    this.unbindDragListeners();
    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
  };

  private readonly onWheel = (event: Event): void => {
    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    const deltaY = (event as WheelEvent).deltaY;
    if (typeof deltaY !== 'number' || !Number.isFinite(deltaY) || deltaY === 0) {
      return;
    }
    this.zoomBy(Math.exp(-deltaY * MINIMAP_WHEEL_ZOOM_RATE));
  };

  private eventToMinimapPoint(event: Event): Vec2 {
    const source = event as { clientX?: number; clientY?: number };
    const clientX =
      typeof source.clientX === 'number' && Number.isFinite(source.clientX) ? source.clientX : 0;
    const clientY =
      typeof source.clientY === 'number' && Number.isFinite(source.clientY) ? source.clientY : 0;
    return this.clientToMinimapPoint(clientX, clientY);
  }

  /* ------------------------------------------------------------- private -- */

  private assertUsable(operation: string): void {
    if (this.disposedFlag) {
      throw new Error(`Minimap.${operation}() called after dispose()`);
    }
  }
}

/* --------------------------------------------------------------- helpers -- */

/** Node id -> position index, so road segments can be stroked without lookups. */
function indexRoadNodes(world: MinimapWorld): Map<EntityId, Vec2> {
  const positions = new Map<EntityId, Vec2>();
  for (const node of world.nodes) {
    positions.set(node.id, { x: node.x, y: node.y });
  }
  return positions;
}

/** Creates a minimap; the class constructor is equivalent and preferred in TS. */
export function createMinimap(options: MinimapOptions): Minimap {
  return new Minimap(options);
}
