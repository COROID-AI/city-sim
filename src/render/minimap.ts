/**
 * Minimap overlay for the city simulation.
 *
 * `drawMinimap` paints a downscaled view of the entire world in the
 * bottom-right corner of the screen — roads, buildings (coloured by kind),
 * citizens and vehicles as dots — plus a semi-transparent rectangle showing
 * the portion of the city the camera is currently viewing.
 *
 * The minimap is drawn entirely in **screen space** (identity transform).
 * `drawMinimap` resets the transform defensively via `save` /
 * `setTransform` / `restore`, so it is safe to call regardless of the
 * caller's current matrix.
 *
 * World→minimap mapping:
 *   minimapX = originX + worldX * scaleX
 *   minimapY = originY + worldY * scaleY
 *
 * The camera's viewport rectangle is computed from the camera's world-space
 * centre and visible extents (`centerX/centerY`, `visibleWidth/visibleHeight`),
 * then scaled into minimap space using the same factors — so panning the
 * camera visibly moves the rectangle.
 */

import type { World, BuildingKind } from '../sim/types';
import type { Camera } from './camera';

// ─── Layout ──────────────────────────────────────────────────────────────────

/** Maximum edge length of the minimap box, in pixels. */
export const MINIMAP_MAX_SIZE = 200;

/** Pixel gap between the minimap and the screen edges. */
export const MINIMAP_MARGIN = 12;

// ─── Colours ─────────────────────────────────────────────────────────────────

/** Background panel colour (semi-transparent dark). */
const PANEL_FILL = 'rgba(0, 0, 0, 0.55)';

/** Panel outline colour. */
const PANEL_STROKE = 'rgba(255, 255, 255, 0.25)';

/** Road colour on the minimap (light gray). */
const ROAD_COLOR = '#9e9e9e';

/** Citizen dot colour. */
const CITIZEN_COLOR = '#e0e0e0';

/** Vehicle dot colour. */
const VEHICLE_COLOR = '#ef5350';

/** Viewport rectangle fill colour (semi-transparent). */
export const VIEWPORT_FILL = 'rgba(255, 255, 255, 0.15)';

/** Viewport rectangle outline colour. */
export const VIEWPORT_STROKE = 'rgba(255, 255, 255, 0.9)';

/**
 * Building colour by functional kind.
 *
 *  - HOME          — green
 *  - WORK          — blue
 *  - ENTERTAINMENT — orange
 *  - CIVIC         — gold
 */
export const BUILDING_COLORS: Record<BuildingKind, string> = {
  HOME: '#66bb6a',
  WORK: '#42a5f5',
  ENTERTAINMENT: '#ff7043',
  CIVIC: '#ffca28',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Full circle angle (2π). */
const TAU = Math.PI * 2;

/** Radius, in pixels, of a dot drawn for a citizen or vehicle. */
const AGENT_DOT_RADIUS = 1.5;

/** Minimum size (px) of a building rectangle so small buildings stay visible. */
const MIN_BUILDING_PX = 2;

/** Minimum size (px) of a road cell so roads stay visible when zoomed out. */
const MIN_CELL_PX = 1;

/**
 * Compute the minimap box geometry for a given world and viewport.
 *
 * The box preserves the world's aspect ratio, fits within a square of side
 * {@link MINIMAP_MAX_SIZE}, and is anchored to the bottom-right corner.
 */
export interface MinimapBox {
  /** Top-left X of the minimap panel in screen pixels. */
  originX: number;
  /** Top-left Y of the minimap panel in screen pixels. */
  originY: number;
  /** Panel width in pixels. */
  width: number;
  /** Panel height in pixels. */
  height: number;
  /** World→minimap X scale (minimap px per world cell). */
  scaleX: number;
  /** World→minimap Y scale (minimap px per world cell). */
  scaleY: number;
}

/**
 * Resolve the bottom-right-anchored minimap box for a world and viewport.
 */
export function computeMinimapBox(
  world: World,
  viewportWidth: number,
  viewportHeight: number,
): MinimapBox {
  const aspect = world.width / world.height;
  let width: number;
  let height: number;
  if (aspect >= 1) {
    width = MINIMAP_MAX_SIZE;
    height = MINIMAP_MAX_SIZE / aspect;
  } else {
    height = MINIMAP_MAX_SIZE;
    width = MINIMAP_MAX_SIZE * aspect;
  }
  const originX = viewportWidth - width - MINIMAP_MARGIN;
  const originY = viewportHeight - height - MINIMAP_MARGIN;
  return {
    originX,
    originY,
    width,
    height,
    scaleX: width / world.width,
    scaleY: height / world.height,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Draw the minimap onto `ctx` for the given `world` and `camera`.
 *
 * Layers, back-to-front:
 *   1. semi-transparent panel background,
 *   2. roads as light-gray cells (batched into one fill),
 *   3. buildings as coloured rectangles grouped by kind,
 *   4. citizens and vehicles as small dots,
 *   5. a semi-transparent rectangle marking the camera viewport.
 *
 * The camera viewport rectangle is derived from the camera's world-space
 * centre and visible extents, so it moves whenever the camera pans.
 *
 * @param ctx             Canvas 2D context.
 * @param world           Simulation world.
 * @param camera          The camera whose viewport rectangle is drawn.
 * @param viewportWidth   Canvas width in pixels.
 * @param viewportHeight  Canvas height in pixels.
 */
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const box = computeMinimapBox(world, viewportWidth, viewportHeight);
  const { originX, originY, scaleX, scaleY } = box;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // work in screen space

  // ── Panel background ─────────────────────────────────────────────────────
  ctx.fillStyle = PANEL_FILL;
  ctx.fillRect(originX, originY, box.width, box.height);

  // ── Roads (batched into a single fill for performance) ───────────────────
  ctx.fillStyle = ROAD_COLOR;
  ctx.beginPath();
  for (const tile of world.tiles) {
    if (tile.terrain === 'ROAD') {
      ctx.rect(
        originX + tile.x * scaleX,
        originY + tile.y * scaleY,
        Math.max(scaleX, MIN_CELL_PX),
        Math.max(scaleY, MIN_CELL_PX),
      );
    }
  }
  ctx.fill();

  // ── Buildings coloured by kind (batched per kind) ────────────────────────
  for (const kind of Object.keys(BUILDING_COLORS) as BuildingKind[]) {
    const color = BUILDING_COLORS[kind];
    ctx.fillStyle = color;
    ctx.beginPath();
    let drewAny = false;
    for (const b of world.buildings.values()) {
      if (b.kind !== kind) continue;
      drewAny = true;
      ctx.rect(
        originX + b.position.x * scaleX,
        originY + b.position.y * scaleY,
        Math.max(b.size.width * scaleX, MIN_BUILDING_PX),
        Math.max(b.size.height * scaleY, MIN_BUILDING_PX),
      );
    }
    if (drewAny) ctx.fill();
  }

  // ── Citizens (dots) ──────────────────────────────────────────────────────
  ctx.fillStyle = CITIZEN_COLOR;
  for (const c of world.citizens.values()) {
    ctx.beginPath();
    ctx.arc(
      originX + c.position.x * scaleX,
      originY + c.position.y * scaleY,
      AGENT_DOT_RADIUS,
      0,
      TAU,
    );
    ctx.fill();
  }

  // ── Vehicles (dots) ──────────────────────────────────────────────────────
  ctx.fillStyle = VEHICLE_COLOR;
  for (const v of world.vehicles.values()) {
    ctx.beginPath();
    ctx.arc(
      originX + v.position.x * scaleX,
      originY + v.position.y * scaleY,
      AGENT_DOT_RADIUS,
      0,
      TAU,
    );
    ctx.fill();
  }

  // ── Camera viewport rectangle ────────────────────────────────────────────
  const halfW = camera.visibleWidth / 2;
  const halfH = camera.visibleHeight / 2;
  const viewLeft = camera.centerX - halfW;
  const viewTop = camera.centerY - halfH;
  const rectX = originX + viewLeft * scaleX;
  const rectY = originY + viewTop * scaleY;
  const rectW = camera.visibleWidth * scaleX;
  const rectH = camera.visibleHeight * scaleY;

  ctx.fillStyle = VIEWPORT_FILL;
  ctx.fillRect(rectX, rectY, rectW, rectH);
  ctx.strokeStyle = VIEWPORT_STROKE;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(rectX, rectY, rectW, rectH);

  // ── Panel outline (drawn on top) ─────────────────────────────────────────
  ctx.strokeStyle = PANEL_STROKE;
  ctx.lineWidth = 1;
  ctx.strokeRect(originX, originY, box.width, box.height);

  ctx.restore();
}
