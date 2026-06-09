/**
 * Renderer — layered draw for the city view.
 *
 * Layer order (back to front, painter's algorithm):
 *   1. drawGround          — base tile for every cell
 *   2. drawRoads           — main + secondary road overlay
 *   3. drawBuildings       — depth-sorted building footprints
 *   4. drawLightingOverlay — full-viewport tint when frame.lighting is set
 *
 * Determinism:
 *   - Draw order is fully determined by `(cityData, camera, lighting)` snapshots.
 *   - Building depth key = `footprint.y + footprint.height` (the "back"
 *     of the footprint in world space) with `footprint.x` as a stable
 *     tie-breaker. Sorting by ascending key gives a back-to-front
 *     painter's order without floating-point or pseudo-random sources.
 *
 * Palette:
 *   - Colors come from the shared palette (see `palette.ts`). They are
 *     resolved lazily so node tests get deterministic fallbacks.
 *
 * Canvas strategy:
 *   - The renderer takes a 2D context + dimensions in world units. The
 *     caller is responsible for sizing the underlying `<canvas>` and
 *     applying the camera transform. This keeps the renderer pure and
 *     trivially testable without a real DOM.
 *
 * Lighting overlay:
 *   - When `frame.lighting` is provided, drawLightingOverlay paints a
 *     single full-viewport rect using `phaseColor` and `globalAlpha =
 *     phaseAlpha`. The overlay is a strict no-op when `frame.lighting`
 *     is undefined, so the cost is paid only when a lighting system
 *     is actually wired up.
 */

import type { Camera } from './Camera';
import type { Building, GeneratedCity, RoadKind, ZoneId } from '@/generation';
import type { Lighting } from '@/systems';
import {
  PALETTE_FALLBACK,
  type DocumentLike,
  type PaletteKey,
  resolvePaletteColor,
} from './palette';

/** Minimal 2D context surface we need from a canvas. */
export interface RendererContext2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  save(): void;
  restore(): void;
}

/** A canvas the renderer can draw to. */
export interface RendererCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): RendererContext2D | null;
}

/** Render-time snapshot of inputs. Captured each frame for determinism. */
export interface RenderFrame {
  readonly city: GeneratedCity;
  readonly camera: Camera;
  /** Width of the canvas in CSS pixels. */
  readonly viewWidth: number;
  /** Height of the canvas in CSS pixels. */
  readonly viewHeight: number;
  /** Pixel size of one world cell at zoom 1. Default 16. */
  readonly cellSize?: number;
  /**
   * Optional explicit palette overrides. When set, the renderer uses
   * these instead of resolving from CSS variables. Useful for tests and
   * for providing static fallbacks.
   */
  readonly paletteOverrides?: Partial<Record<PaletteKey, string>>;
  /**
   * Optional lighting snapshot. When provided, drawLightingOverlay
   * paints a full-viewport tint with fillStyle = phaseColor (or the
   * blended color) and globalAlpha = phaseAlpha. When undefined, the
   * overlay is a strict no-op.
   */
  readonly lighting?: Lighting;
}

/** Public, side-effect-free depth-sort key. Exported for tests. */
export interface BuildingDepthKey {
  /** Building index in the city.buildings array. */
  readonly index: number;
  /** Stable sort key: `footprint.y + footprint.height`, tie-broken by x. */
  readonly key: number;
  /** The building this key refers to (cached for renderers/tests). */
  readonly building: Building;
}

/**
 * Compute a deterministic depth-sort key for a single building.
 *
 * Exported so the renderer and the tests can share the exact same rule.
 */
export function buildingDepthKey(building: Building, index: number): BuildingDepthKey {
  const f = building.footprint;
  // y is the back-row of the footprint in world space. Tie-break
  // by x so the order is stable across runs (no JS engine sort quirks).
  const y = f.y * 100000 + f.x;
  return { index, key: y, building };
}

/**
 * Sort buildings back-to-front for painter's-algorithm drawing.
 *
 * The returned array is a fresh array; the input is not mutated. The
 * sort is stable (Array.prototype.sort is stable in ES2019+).
 */
export function sortBuildingsForDraw(city: GeneratedCity): BuildingDepthKey[] {
  const out: BuildingDepthKey[] = new Array(city.buildings.length);
  for (let i = 0; i < city.buildings.length; i++) {
    const b = city.buildings[i];
    if (b === undefined) continue;
    out[i] = buildingDepthKey(b, i);
  }
  return out.sort((a, b) => a.key - b.key);
}

/**
 * Color tint per zone. The renderer maps a zone to a single base color
 * (from the palette or an override) and draws a building footprint in
 * that color. This is intentionally simple; the citizen/lighting tasks
 * will add per-building variation later.
 */
const ZONE_BASE_COLOR: Readonly<Record<ZoneId, PaletteKey>> = Object.freeze({
  residential: 'building',
  commercial: 'accent',
  industrial: 'warning',
  civic: 'accent',
  park: 'ground',
});

/** Pick the palette key for a building's zone. */
function zonePaletteKey(zone: ZoneId): PaletteKey {
  return ZONE_BASE_COLOR[zone];
}

/** Read a color, applying per-frame overrides and falling back to CSS vars. */
function colorFor(
  key: PaletteKey,
  frame: RenderFrame,
  documentLike: DocumentLike | null,
): string {
  const override = frame.paletteOverrides?.[key];
  return resolvePaletteColor(key, { override, documentLike });
}

/**
 * The Renderer encapsulates the layered draw. It is stateless: each
 * `render(frame)` call consumes the inputs and produces a frame of
 * pixels. There is no internal buffer; downstream code can choose to
 * use one canvas or several stacked canvases.
 */
export class Renderer {
  private readonly documentLike: DocumentLike | null;

  /**
   * @param documentLike Optional injected document for CSS-variable
   *   resolution. Defaults to the global `document` when available.
   *   Tests pass `null` to force the deterministic fallbacks.
   */
  constructor(documentLike: DocumentLike | null = defaultDocument()) {
    this.documentLike = documentLike;
  }

  /**
   * Draw a single frame. Calls each layer in order. The caller is
   * expected to have already cleared/resized the canvas.
   */
  render(canvas: RendererCanvas, frame: RenderFrame): void {
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      // No 2D context available (e.g. SSR or unsupported env). Nothing
      // to draw. We intentionally do not throw: rendering should be
      // best-effort and not crash the simulation.
      return;
    }
    this.drawGround(ctx, frame);
    this.drawRoads(ctx, frame);
    this.drawBuildings(ctx, frame);
    this.drawLightingOverlay(ctx, frame);
  }

  /** Layer 1: base ground tile for every cell in the city. */
  drawGround(ctx: RendererContext2D, frame: RenderFrame): void {
    const { city, viewWidth, viewHeight, camera } = frame;
    const cellSize = frame.cellSize ?? 16;
    const t = camera.getTransform();
    const groundColor = colorFor('ground', frame, this.documentLike);
    const surfaceColor = colorFor('surface', frame, this.documentLike);

    // Fill the entire viewport with the surface first; this avoids
    // showing through outside the city bounds.
    ctx.fillStyle = surfaceColor;
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    // Determine the visible world rectangle (clipped to city bounds).
    const visible = visibleWorldRect(city, t, viewWidth, viewHeight, cellSize);

    ctx.fillStyle = groundColor;
    for (let y = visible.minY; y <= visible.maxY; y++) {
      for (let x = visible.minX; x <= visible.maxX; x++) {
        const r = worldToScreenRect(x, y, t, viewWidth, viewHeight, cellSize);
        if (r.w <= 0 || r.h <= 0) continue;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    }
  }

  /** Layer 2: paint road cells on top of the ground. */
  drawRoads(ctx: RendererContext2D, frame: RenderFrame): void {
    const { city, viewWidth, viewHeight, camera } = frame;
    const cellSize = frame.cellSize ?? 16;
    const t = camera.getTransform();
    const roadColor = colorFor('road', frame, this.documentLike);
    const accentColor = colorFor('accent', frame, this.documentLike);
    const visible = visibleWorldRect(city, t, viewWidth, viewHeight, cellSize);

    ctx.fillStyle = roadColor;
    for (let y = visible.minY; y <= visible.maxY; y++) {
      for (let x = visible.minX; x <= visible.maxX; x++) {
        const kind: RoadKind = city.roads[y * city.width + x] ?? 'none';
        if (kind === 'none') continue;
        const r = worldToScreenRect(x, y, t, viewWidth, viewHeight, cellSize);
        if (r.w <= 0 || r.h <= 0) continue;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        if (kind === 'main') {
          // Main road gets a thin accent stripe down its center for
          // visual hierarchy.
          ctx.fillStyle = accentColor;
          const stripe = Math.max(1, Math.floor(r.w * 0.08));
          ctx.fillRect(
            r.x + Math.floor((r.w - stripe) / 2),
            r.y,
            stripe,
            r.h,
          );
          ctx.fillStyle = roadColor;
        }
      }
    }
  }

  /**
   * Layer 3: depth-sorted building footprints.
   *
   * Each footprint is drawn as a filled rect spanning its cells. A
   * tiny inset is applied so adjacent buildings read as distinct.
   * Painter's algorithm: back-to-front by (y + height, x).
   */
  drawBuildings(ctx: RendererContext2D, frame: RenderFrame): void {
    const { city, viewWidth, viewHeight, camera } = frame;
    const cellSize = frame.cellSize ?? 16;
    const t = camera.getTransform();
    const visible = visibleWorldRect(city, t, viewWidth, viewHeight, cellSize);

    const ordered = sortBuildingsForDraw(city);
    for (const item of ordered) {
      const b = item.building;
      const f = b.footprint;
      // Skip buildings outside the visible rect.
      if (f.x + f.width < visible.minX) continue;
      if (f.x > visible.maxX) continue;
      if (f.y + f.height < visible.minY) continue;
      if (f.y > visible.maxY) continue;

      const r = worldToScreenRect(f.x, f.y, t, viewWidth, viewHeight, cellSize);
      const wCells = f.width * cellSize * t.zoom;
      const hCells = f.height * cellSize * t.zoom;
      if (wCells <= 0 || hCells <= 0) continue;
      const key = zonePaletteKey(b.zone);
      ctx.fillStyle = colorFor(key, frame, this.documentLike);
      // Inset by 1px to separate adjacent buildings.
      const inset = Math.min(1, Math.floor(Math.min(wCells, hCells) * 0.05));
      ctx.fillRect(r.x + inset, r.y + inset, wCells - inset * 2, hCells - inset * 2);
    }
  }

  /**
   * Layer 4: lighting overlay.
   *
   * When `frame.lighting` is provided, paint a single full-viewport
   * rect with `fillStyle = blended tint` and `globalAlpha =
   * phaseAlpha`. We honor the existing `globalAlpha` contract on the
   * minimal context interface (added in the lighting task) and reset
   * it after the fill so subsequent layers (or the next frame's
   * background pass) are not dimmed.
   *
   * When `frame.lighting` is undefined, this method is a strict
   * no-op. We intentionally do not touch `ctx.globalAlpha` in that
   * case so the renderer stays a safe drop-in for tests that do not
   * exercise the lighting system.
   */
  drawLightingOverlay(ctx: RendererContext2D, frame: RenderFrame): void {
    const lighting = frame.lighting;
    if (lighting === undefined) return;
    const a = clampUnit(lighting.phaseAlpha);
    if (a <= 0) return;
    const color = rgbToCss(lighting.blended);
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = a;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, frame.viewWidth, frame.viewHeight);
    ctx.globalAlpha = prevAlpha;
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

/** Clamp a number to [0, 1] without allocating. */
function clampUnit(n: number): number {
  if (!(n > 0)) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Convert an Rgb tint to a CSS `rgb(r, g, b)` string with components
 * in [0, 255]. Values outside the range are clamped.
 */
function rgbToCss(c: { r: number; g: number; b: number }): string {
  const r = Math.round(clampUnit(c.r) * 255);
  const g = Math.round(clampUnit(c.g) * 255);
  const b = Math.round(clampUnit(c.b) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface VisibleRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Project the top-left of a world cell to screen space (px). */
function worldToScreenRect(
  wx: number,
  wy: number,
  camera: { x: number; y: number; zoom: number },
  viewWidth: number,
  viewHeight: number,
  cellSize: number,
): ScreenRect {
  const halfW = viewWidth / 2;
  const halfH = viewHeight / 2;
  const px = halfW + (wx - camera.x) * cellSize * camera.zoom;
  const py = halfH + (wy - camera.y) * cellSize * camera.zoom;
  return {
    x: Math.floor(px),
    y: Math.floor(py),
    w: Math.max(1, Math.floor(cellSize * camera.zoom)),
    h: Math.max(1, Math.floor(cellSize * camera.zoom)),
  };
}

/** World-space rectangle currently visible on screen (clipped to city). */
function visibleWorldRect(
  city: { width: number; height: number },
  camera: { x: number; y: number; zoom: number },
  viewWidth: number,
  viewHeight: number,
  cellSize: number,
): VisibleRect {
  const halfW = viewWidth / 2;
  const halfH = viewHeight / 2;
  const cellsAcrossX = Math.ceil(halfW / Math.max(0.0001, cellSize * camera.zoom)) + 1;
  const cellsAcrossY = Math.ceil(halfH / Math.max(0.0001, cellSize * camera.zoom)) + 1;
  const minX = Math.max(0, Math.floor(camera.x - cellsAcrossX));
  const minY = Math.max(0, Math.floor(camera.y - cellsAcrossY));
  const maxX = Math.min(city.width - 1, Math.ceil(camera.x + cellsAcrossX));
  const maxY = Math.min(city.height - 1, Math.ceil(camera.y + cellsAcrossY));
  return { minX, minY, maxX, maxY };
}

function defaultDocument(): DocumentLike | null {
  const g = globalThis as { document?: DocumentLike };
  return g.document ?? null;
}

export { PALETTE_FALLBACK };
