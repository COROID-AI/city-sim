/**
 * The viewport camera: the single authoritative world <-> screen transform.
 *
 * Every draw call, the picking layer and the minimap rectangle read this one
 * object, so they cannot disagree about which part of the city is on screen:
 *
 * - the renderer draws tiles, buildings, citizens and vehicles through
 *   {@link ViewportCamera.worldToScreen} (or applies {@link ViewportCamera.transform}
 *   with a single context `setTransform` call) and culls with
 *   {@link ViewportCamera.visibleWorldBounds};
 * - the picking layer turns pointer positions back into world coordinates with
 *   {@link ViewportCamera.screenToWorld};
 * - the minimap draws {@link ViewportCamera.viewport} as the rectangle that
 *   shows which piece of the city the view is currently looking at.
 *
 * ## Coordinate systems
 *
 * - **world**: tile coordinates, the system used by every domain contract in
 *   `src/sim/types.ts` (`Vec2`, `TileRect`, `WorldMap`). `x` grows east, `y`
 *   grows south, and the city spans `0..widthInTiles` by `0..heightInTiles`.
 * - **screen**: logical (CSS) pixels inside the host viewport, origin at its
 *   top-left corner.
 *
 * The mapping is one uniform scale plus a translation:
 *
 *     screen.x = (world.x - viewport.x) * scale
 *     world.x  = viewport.x + screen.x / scale
 *
 * with `scale = tileSize * zoom`. At zoom 1 one tile therefore covers exactly
 * `tileSize` logical pixels, which is the meaning the domain contract gives
 * `WorldMap.tileSize`. `worldToScreen` and `screenToWorld` are exact inverses:
 * no rounding, no snapping, no hidden context state.
 *
 * ## Clamping
 *
 * The visible rectangle never leaves the world:
 *
 * - zoom is floored at the "fit" zoom, the zoom at which the whole city exactly
 *   fits the host viewport. {@link MIN_ZOOM} is the absolute floor used while
 *   the city is larger than the viewport, and {@link MAX_ZOOM} the ceiling; a
 *   city small enough to fit is never zoomed out past its own edges.
 * - panning and centring clamp the viewport to the world edges, so
 *   `viewport` is always inside `worldBounds`.
 *
 * ## Purity
 *
 * The camera is pure data plus arithmetic on that data. It never touches a
 * canvas context, a DOM node or a browser global, so it can be built and
 * asserted headlessly, and the minimap and picking layers can share it.
 */

import type { TileRect, Vec2, WorldMap } from '../sim/types';

/* -------------------------------------------------------------- constants -- */

/**
 * Absolute lower zoom bound. It applies while the city is larger than the host
 * viewport; smaller cities stop zooming out earlier so they never leave a gap
 * around the world edges (see {@link ViewportCamera.fitZoom}).
 */
export const MIN_ZOOM = 0.25;

/** Upper zoom bound: at zoom 8 one tile covers eight times its `tileSize`. */
export const MAX_ZOOM = 8;

/** Zoom a freshly created camera starts at when none is supplied. */
export const DEFAULT_ZOOM = 1;

/**
 * Relative tolerance used when the whole world fits the viewport on an axis:
 * the reported rect is snapped flush with the world edge so floating point
 * error can never report a viewport poking outside the city.
 */
const FIT_EPSILON = 1e-9;

/* --------------------------------------------------------------- geometry -- */

/** Size of the camera's host viewport, in logical (CSS) pixels. */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The extent of the world the camera looks at, in tile coordinates. This is
 * exactly the geometry the domain contract `WorldMap` declares, so a camera can
 * be built straight from a world instance without knowing anything else about
 * it — and without importing the world generator.
 */
export interface WorldExtent {
  readonly widthInTiles: number;
  readonly heightInTiles: number;
  /** Logical pixels one tile covers at zoom 1 (`WorldMap.tileSize`). */
  readonly tileSize: number;
}

/** Construction options; every field is optional. */
export interface CameraOptions {
  /** Initial zoom, clamped into the camera's allowed range. Defaults to 1. */
  readonly zoom?: number;
  /** Initial centre in world (tile) coordinates. Defaults to the world centre. */
  readonly center?: Vec2;
  /** Lowest zoom this camera may use. Defaults to {@link MIN_ZOOM}. */
  readonly minZoom?: number;
  /** Highest zoom this camera may use. Defaults to {@link MAX_ZOOM}. */
  readonly maxZoom?: number;
}

/**
 * The affine world -> screen transform, ready to drive a canvas 2D context:
 * `setTransform(scale, 0, 0, scale, offsetX, offsetY)`.
 */
export interface CameraTransform {
  /** Screen pixels per world tile (`tileSize * zoom`). */
  readonly scale: number;
  /** Screen offset: `screenX = worldX * scale + offsetX`. */
  readonly offsetX: number;
  readonly offsetY: number;
}

/* ---------------------------------------------------------------- helpers -- */

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite number greater than 0, received ${value}`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Reads the world extent declared by the domain contract `WorldMap`, e.g.
 * `worldExtentOf(world)` for a generated city.
 */
export function worldExtentOf(
  map: Pick<WorldMap, 'widthInTiles' | 'heightInTiles' | 'tileSize'>,
): WorldExtent {
  return {
    widthInTiles: map.widthInTiles,
    heightInTiles: map.heightInTiles,
    tileSize: map.tileSize,
  };
}

/* ----------------------------------------------------------------- camera -- */

export class ViewportCamera {
  /** World extent the camera looks at; frozen at construction. */
  readonly world: WorldExtent;
  /** Configured lower zoom bound (the usable floor is `minAllowedZoom`). */
  readonly minZoom: number;
  /** Configured upper zoom bound. */
  readonly maxZoom: number;

  /**
   * The authoritative visible rectangle, in world (tile) coordinates. Kept as
   * one object identity so the minimap and picking always read the same state.
   */
  private readonly viewportRect: TileRect = { x: 0, y: 0, width: 0, height: 0 };

  private zoomValue = DEFAULT_ZOOM;
  private centerXValue = 0;
  private centerYValue = 0;
  private viewportWidthValue = 0;
  private viewportHeightValue = 0;
  private disposedFlag = false;

  constructor(world: WorldExtent, viewport: ViewportSize, options: CameraOptions = {}) {
    assertFinitePositive(world.widthInTiles, 'world.widthInTiles');
    assertFinitePositive(world.heightInTiles, 'world.heightInTiles');
    assertFinitePositive(world.tileSize, 'world.tileSize');
    assertFinitePositive(viewport.width, 'viewport.width');
    assertFinitePositive(viewport.height, 'viewport.height');
    const minZoom = options.minZoom ?? MIN_ZOOM;
    const maxZoom = options.maxZoom ?? MAX_ZOOM;
    assertFinitePositive(minZoom, 'options.minZoom');
    assertFinitePositive(maxZoom, 'options.maxZoom');

    this.world = Object.freeze({ ...world });
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.viewportWidthValue = viewport.width;
    this.viewportHeightValue = viewport.height;

    if (options.center) {
      if (!Number.isFinite(options.center.x) || !Number.isFinite(options.center.y)) {
        throw new RangeError(
          `options.center must be finite, received (${options.center.x}, ${options.center.y})`,
        );
      }
      this.centerXValue = options.center.x;
      this.centerYValue = options.center.y;
    } else {
      this.centerXValue = this.world.widthInTiles / 2;
      this.centerYValue = this.world.heightInTiles / 2;
    }

    const zoom = options.zoom ?? DEFAULT_ZOOM;
    if (!Number.isFinite(zoom)) {
      throw new RangeError(`options.zoom must be a finite number, received ${zoom}`);
    }
    this.zoomValue = clamp(zoom, this.minAllowedZoom, this.maxAllowedZoom);
    this.applyClamp();
  }

  /* -------------------------------------------------------------- reading -- */

  /** Current zoom factor; `scale = world.tileSize * zoom`. */
  get zoom(): number {
    return this.zoomValue;
  }

  /** True once {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.disposedFlag;
  }

  /** Screen pixels per world tile. */
  get scale(): number {
    return this.world.tileSize * this.zoomValue;
  }

  /** Host viewport size in logical pixels. */
  get viewportSize(): ViewportSize {
    return { width: this.viewportWidthValue, height: this.viewportHeightValue };
  }

  /**
   * The world rectangle the camera looks at: the minimap draws this as "the
   * part of the city you are looking at", and picking answers screen positions
   * against it. The returned object is the live, authoritative one — read it,
   * do not mutate it; use {@link visibleWorldBounds} for a private copy.
   */
  get viewport(): TileRect {
    return this.viewportRect;
  }

  /** The full world rectangle: `{ x: 0, y: 0, width: widthInTiles, height: heightInTiles }`. */
  get worldBounds(): TileRect {
    return { x: 0, y: 0, width: this.world.widthInTiles, height: this.world.heightInTiles };
  }

  /** Viewport centre in world (tile) coordinates. */
  get center(): Vec2 {
    return { x: this.centerXValue, y: this.centerYValue };
  }

  /**
   * Zoom at which the whole city exactly fits the host viewport. The camera
   * never zooms out past this, so the viewport can never exceed world bounds.
   */
  get fitZoom(): number {
    const worldWidth = this.world.widthInTiles * this.world.tileSize;
    const worldHeight = this.world.heightInTiles * this.world.tileSize;
    return Math.max(this.viewportWidthValue / worldWidth, this.viewportHeightValue / worldHeight);
  }

  /** Lowest zoom usable right now: the configured floor, raised by {@link fitZoom}. */
  get minAllowedZoom(): number {
    return Math.max(this.minZoom, this.fitZoom);
  }

  /** Highest zoom usable right now (never below {@link minAllowedZoom}). */
  get maxAllowedZoom(): number {
    return Math.max(this.maxZoom, this.minAllowedZoom);
  }

  /** The affine transform every draw call applies. */
  get transform(): CameraTransform {
    const scale = this.scale;
    return {
      scale,
      offsetX: -this.viewportRect.x * scale,
      offsetY: -this.viewportRect.y * scale,
    };
  }

  /**
   * Visible world bounds used by the renderer for culling. Equals
   * {@link viewport} exactly, but returns a private copy the caller may keep.
   */
  visibleWorldBounds(): TileRect {
    return {
      x: this.viewportRect.x,
      y: this.viewportRect.y,
      width: this.viewportRect.width,
      height: this.viewportRect.height,
    };
  }

  /** Converts a world (tile) position into viewport pixels. */
  worldToScreen(point: Vec2): Vec2 {
    const { scale, offsetX, offsetY } = this.transform;
    return { x: point.x * scale + offsetX, y: point.y * scale + offsetY };
  }

  /** Converts a viewport pixel position into world (tile) coordinates for picking. */
  screenToWorld(point: Vec2): Vec2 {
    const scale = this.scale;
    return {
      x: this.viewportRect.x + point.x / scale,
      y: this.viewportRect.y + point.y / scale,
    };
  }

  /* ------------------------------------------------------------- controls -- */

  /**
   * Pans by a screen-pixel delta, e.g. the pointer movement of a drag: the
   * viewport slides by the opposite amount so the grabbed city follows the
   * pointer. Returns the clamped viewport rect.
   */
  panByScreen(deltaXScreen: number, deltaYScreen: number): TileRect {
    this.assertUsable('panByScreen');
    if (!Number.isFinite(deltaXScreen) || !Number.isFinite(deltaYScreen)) {
      throw new RangeError(
        `panByScreen() expects finite deltas, received (${deltaXScreen}, ${deltaYScreen})`,
      );
    }
    const scale = this.scale;
    this.centerXValue -= deltaXScreen / scale;
    this.centerYValue -= deltaYScreen / scale;
    return this.applyClamp();
  }

  /** Pans by a delta expressed in world (tile) units. Returns the clamped rect. */
  panByWorld(deltaXWorld: number, deltaYWorld: number): TileRect {
    this.assertUsable('panByWorld');
    if (!Number.isFinite(deltaXWorld) || !Number.isFinite(deltaYWorld)) {
      throw new RangeError(
        `panByWorld() expects finite deltas, received (${deltaXWorld}, ${deltaYWorld})`,
      );
    }
    this.centerXValue += deltaXWorld;
    this.centerYValue += deltaYWorld;
    return this.applyClamp();
  }

  /** Jumps the viewport centre to a world position, clamped to the world edges. */
  centerOn(worldX: number, worldY: number): TileRect {
    this.assertUsable('centerOn');
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) {
      throw new RangeError(`centerOn() expects finite coordinates, received (${worldX}, ${worldY})`);
    }
    this.centerXValue = worldX;
    this.centerYValue = worldY;
    return this.applyClamp();
  }

  /**
   * Multiplies the zoom by `factor`, keeping the world point under
   * `anchorScreen` (default: the viewport centre) exactly where it is. Zooming
   * is therefore cursor-anchored, not origin-anchored: the pixel the user
   * points at stays over the same tile while everything else scales around it.
   */
  zoomBy(factor: number, anchorScreen?: Vec2): TileRect {
    this.assertUsable('zoomBy');
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new RangeError(`zoomBy() expects a finite factor greater than 0, received ${factor}`);
    }
    return this.zoomTo(this.zoomValue * factor, anchorScreen);
  }

  /** Sets an absolute zoom, keeping `anchorScreen` (default: viewport centre) fixed. */
  zoomTo(zoom: number, anchorScreen?: Vec2): TileRect {
    this.assertUsable('zoomTo');
    if (!Number.isFinite(zoom) || zoom <= 0) {
      throw new RangeError(`zoomTo() expects a finite zoom greater than 0, received ${zoom}`);
    }
    const anchor = anchorScreen ?? {
      x: this.viewportWidthValue / 2,
      y: this.viewportHeightValue / 2,
    };
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
      throw new RangeError(
        `zoomTo() expects a finite anchor, received (${anchor.x}, ${anchor.y})`,
      );
    }

    // Remember the tile under the anchor, then re-centre around it at the new
    // scale: centre = anchorWorld + (viewportCentre - anchor) / scale.
    const anchorWorld = this.screenToWorld(anchor);
    this.zoomValue = clamp(zoom, this.minAllowedZoom, this.maxAllowedZoom);
    const scale = this.scale;
    this.centerXValue = anchorWorld.x + (this.viewportWidthValue / 2 - anchor.x) / scale;
    this.centerYValue = anchorWorld.y + (this.viewportHeightValue / 2 - anchor.y) / scale;
    return this.applyClamp();
  }

  /**
   * Resizes the host viewport. The world-space centre is preserved, the visible
   * rect is re-derived, and zoom/centre are re-clamped, so the viewport stays
   * inside the world after both growing and shrinking.
   */
  resize(viewport: ViewportSize): TileRect {
    this.assertUsable('resize');
    assertFinitePositive(viewport.width, 'viewport.width');
    assertFinitePositive(viewport.height, 'viewport.height');
    this.viewportWidthValue = viewport.width;
    this.viewportHeightValue = viewport.height;
    // The fit floor moves with the viewport size, so a larger host may force a
    // larger zoom (and a smaller host simply keeps the current one).
    this.zoomValue = clamp(this.zoomValue, this.minAllowedZoom, this.maxAllowedZoom);
    return this.applyClamp();
  }

  /* ------------------------------------------------------------ lifecycle -- */

  /**
   * Binds the camera to a host viewport size (renderer mount or re-mount).
   * Same effect as {@link resize}; named for the shared render lifecycle.
   */
  attach(viewport: ViewportSize): TileRect {
    return this.resize(viewport);
  }

  /**
   * Render-loop hook. The camera has no time-dependent state, so this only
   * re-clamps against the current world bounds and returns the authoritative
   * viewport rect. It is idempotent and stays safe after {@link dispose}.
   */
  update(): TileRect {
    if (this.disposedFlag) {
      return this.viewportRect;
    }
    return this.applyClamp();
  }

  /**
   * Idempotent teardown. Reads keep working on the last derived viewport;
   * further mutations throw so a disposed camera is never silently reused.
   */
  dispose(): void {
    this.disposedFlag = true;
  }

  /* -------------------------------------------------------------- private -- */

  /**
   * Clamps the centre so the viewport stays inside the world, re-derives the
   * visible rect from centre + zoom + host size, and returns that rect.
   */
  private applyClamp(): TileRect {
    const scale = this.scale;
    const worldWidth = this.world.widthInTiles;
    const worldHeight = this.world.heightInTiles;
    let width = this.viewportWidthValue / scale;
    let height = this.viewportHeightValue / scale;

    if (worldWidth - width <= FIT_EPSILON * worldWidth) {
      // The whole city is visible on this axis: snap flush to the world edge
      // instead of leaving a floating point sliver outside it.
      width = worldWidth;
      this.centerXValue = worldWidth / 2;
    } else {
      this.centerXValue = clamp(this.centerXValue, width / 2, worldWidth - width / 2);
    }
    if (worldHeight - height <= FIT_EPSILON * worldHeight) {
      height = worldHeight;
      this.centerYValue = worldHeight / 2;
    } else {
      this.centerYValue = clamp(this.centerYValue, height / 2, worldHeight - height / 2);
    }

    this.viewportRect.x = this.centerXValue - width / 2;
    this.viewportRect.y = this.centerYValue - height / 2;
    this.viewportRect.width = width;
    this.viewportRect.height = height;
    return this.viewportRect;
  }

  private assertUsable(operation: string): void {
    if (this.disposedFlag) {
      throw new Error(`ViewportCamera.${operation}() called after dispose()`);
    }
  }
}

/**
 * Creates a camera over the world extent declared by the domain contracts: pass
 * the `WorldMap` (or anything with its extent fields) and the host viewport
 * size.
 */
export function createViewportCamera(
  world: Pick<WorldMap, 'widthInTiles' | 'heightInTiles' | 'tileSize'>,
  viewport: ViewportSize,
  options: CameraOptions = {},
): ViewportCamera {
  return new ViewportCamera(worldExtentOf(world), viewport, options);
}
