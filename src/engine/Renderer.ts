/**
 * Renderer — layered Canvas 2D renderer for the generated city (spec §3.3, §6.1).
 *
 * Layer order per frame: ground → roads → buildings.
 *
 * KEY DECISIONS (see plan notes):
 *  - SPEC PALETTE OVER DEF COLOR: ZONE_COLORS holds the spec §6.1 hex values
 *    and buildings are colored by `building.zone`, NOT `building.def.color`.
 *    BuildingPlacer's def colors are gameplay/economy-oriented and differ from
 *    the art spec; the acceptance criteria assert the exact spec hex values.
 *  - CAMERA-FORWARD DESIGN: an optional camera {x,y,zoom} is accepted now
 *    (identity default) so the downstream Camera task can inject pan/zoom
 *    without modifying this class. applyCameraTransform() does translate+scale
 *    inside save/restore.
 *  - DEPTH SORT KEY: buildings are sorted by (y + height) — the south/bottom
 *    edge — so a 3-tall building at y=5 correctly draws behind a 1-tall
 *    building at y=6 (painter's algorithm).
 *  - CANVAS 2D ONLY: no WebGL, no sprites, no external rendering deps.
 */
import type { Building, CityTime, ZoneType } from './types';
import { TILE_SIZE, World } from './World';
import {
  computeLightingState,
  hashToUnit,
  STREET_LIGHT_GLOW_COLOR,
  WINDOW_LIGHT_COLOR,
  type LightingState,
} from './Lighting';

/** Spec §6.1 zone → render color map. */
export const ZONE_COLORS: Record<ZoneType, string> = {
  residential: '#7cb342',
  commercial: '#42a5f5',
  industrial: '#8d6e63',
  entertainment: '#ab47bc',
  park: '#7ec850',
};

// Spec §6.1 night overlay color is re-exported for tests/consumers.
export { NIGHT_OVERLAY_COLOR } from './Lighting';

/** Spec §3.3 ground / road palette. */
const GROUND_COLOR = '#e8e0d5';
const ROAD_SURFACE = '#4a4a4a';
const ROAD_CENTER_LINE = '#ffffff';
const SIDEWALK_COLOR = '#c0b8ae';

/** Sidewalk border thickness in world pixels (per road tile edge). */
const SIDEWALK_INSET = 2;
/** Center-line thickness in world pixels. */
const CENTER_LINE_THICKNESS = 1;

/** Street lights are placed every N road tiles (spec §6.1). */
const STREET_LIGHT_STRIDE = 6;
/** Fraction of buildings that have lit windows at night (~40%). */
const WINDOW_LIGHT_THRESHOLD = 0.4;
/** Street light glow radius in world pixels. */
const STREET_LIGHT_RADIUS = 24;
/** Window light dot size in world pixels. */
const WINDOW_LIGHT_SIZE = 2;

/** Optional camera transform injected by the downstream Camera system. */
export interface CameraTransform {
  /** Pan offset in world pixels applied as translate(-x, -y). */
  x: number;
  /** Pan offset in world pixels applied as translate(-x, -y). */
  y: number;
  /** Zoom scale factor (1 = identity). */
  zoom: number;
}

export interface RendererOptions {
  /** Optional camera; defaults to identity (no pan/zoom). */
  camera?: CameraTransform;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly world: World;
  private camera: CameraTransform;
  /** Current city time used for lighting computation. Defaults to noon. */
  private time: CityTime = { day: 0, hour: 12, minute: 0, totalMs: 0 };

  constructor(
    ctx: CanvasRenderingContext2D,
    world: World,
    options: RendererOptions = {},
  ) {
    this.ctx = ctx;
    this.world = world;
    this.camera = options.camera ?? { x: 0, y: 0, zoom: 1 };
  }

  /** Update the active camera transform (used by the downstream Camera task). */
  setCamera(camera: CameraTransform): void {
    this.camera = camera;
  }

  /**
   * Update the city time used for day/night lighting computation. Called each
   * frame by the host (page.tsx) with timeSystem.getTime().
   */
  setTime(time: CityTime): void {
    this.time = time;
  }

  /**
   * Full frame render. Matches GameLoop's RenderCallback signature so it can be
   * wired directly as `render: (alpha) => renderer.render(alpha)`.
   *
   * `alpha` is the interpolation fraction [0..1]; unused for static geometry
   * but reserved for future interpolated entity positions (vehicles/citizens).
   */
  render(alpha: number): void {
    void alpha; // Reserved for future interpolated entity positions.
    const { ctx } = this;
    ctx.save();
    this.applyCameraTransform();

    // Layer order (spec §3.3 + §6.1):
    // ground → roads → buildings → lightingOverlay → windowLights → streetLights
    this.drawGround();
    this.drawRoads();
    this.drawBuildings();
    this.drawLightingOverlay();
    this.drawWindowLights();
    this.drawStreetLights();

    ctx.restore();
  }

  /** Fill the entire world rectangle with the beige ground color. */
  drawGround(): void {
    const { ctx, world } = this;
    const w = world.width * TILE_SIZE;
    const h = world.height * TILE_SIZE;
    ctx.fillStyle = GROUND_COLOR;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * Draw the road network: for every road tile, a dark-grey surface with a
   * light sidewalk border and a white center line. Per-tile rendering keeps
   * the geometry deterministic and makes sidewalks/center lines straightforward.
   */
  drawRoads(): void {
    const { ctx, world } = this;
    world.grid.forEach((tile) => {
      if (tile.type !== 'road') return;
      const px = tile.x * TILE_SIZE;
      const py = tile.y * TILE_SIZE;

      // Sidewalk border (light) fills the full tile.
      ctx.fillStyle = SIDEWALK_COLOR;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

      // Road surface inset by the sidewalk border.
      ctx.fillStyle = ROAD_SURFACE;
      ctx.fillRect(
        px + SIDEWALK_INSET,
        py + SIDEWALK_INSET,
        TILE_SIZE - SIDEWALK_INSET * 2,
        TILE_SIZE - SIDEWALK_INSET * 2,
      );

      // White center line down the middle of the tile.
      ctx.fillStyle = ROAD_CENTER_LINE;
      const clOffset = (TILE_SIZE - CENTER_LINE_THICKNESS) / 2;
      ctx.fillRect(px + clOffset, py, CENTER_LINE_THICKNESS, TILE_SIZE);
    });
  }

  /**
   * Draw all buildings as colored rectangles, depth-sorted by south edge
   * (y + height) ascending so lower-Y buildings render first (painter's).
   * Color comes from ZONE_COLORS keyed by `building.zone`, NOT def.color.
   */
  drawBuildings(): void {
    const { ctx, world } = this;
    const buildings = Array.from(world.buildings.values());
    // Painter's algorithm: sort by south edge (y + height) ascending.
    const sorted = this.sortByDepth(buildings);

    for (const building of sorted) {
      const color = ZONE_COLORS[building.zone] ?? building.def.color;
      ctx.fillStyle = color;
      ctx.fillRect(
        building.x * TILE_SIZE,
        building.y * TILE_SIZE,
        building.width * TILE_SIZE,
        building.height * TILE_SIZE,
      );
    }
  }

  /**
   * Return buildings sorted by south edge (y + height) ascending. Exposed for
   * unit testing the depth order without a canvas.
   */
  sortByDepth(buildings: Building[]): Building[] {
    return [...buildings].sort((a, b) => {
      const aSouth = a.y + a.height;
      const bSouth = b.y + b.height;
      if (aSouth !== bSouth) return aSouth - bSouth;
      // Stable tiebreak by x then id for deterministic output.
      if (a.x !== b.x) return a.x - b.x;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  /** Apply the current camera translate+scale inside the active save/restore. */
  private applyCameraTransform(): void {
    const { ctx, camera } = this;
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
  }

  // ----------------------------------------------------------------
  // Day/night lighting layers (spec §6.1, §6.2).
  // ----------------------------------------------------------------

  /**
   * Compute the current lighting state from the injected city time. Exposed
   * for unit testing the Renderer↔Lighting delegation without a canvas.
   */
  getLightingState(): LightingState {
    return computeLightingState(this.time);
  }

  /**
   * Draw the global darkness overlay. At noon the alpha is ~0 (no fill); at
   * midnight it is rgba(10,15,40,0.55). During dawn/dusk a subtle tinted
   * gradient is layered on top (orange-blue dawn, blue-purple dusk).
   */
  drawLightingOverlay(): void {
    const { ctx, world } = this;
    const state = computeLightingState(this.time);
    if (state.overlayAlpha < 0.001) return;

    const w = world.width * TILE_SIZE;
    const h = world.height * TILE_SIZE;

    // Base darkness overlay (rgba with interpolated alpha).
    ctx.fillStyle = state.overlayColor;
    ctx.fillRect(0, 0, w, h);

    // Dawn/dusk tint gradient layered on top for warmth.
    if (state.tint && state.tintStrength > 0.01) {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      if (state.tint === 'dawn') {
        // Warm orange near horizon, cooler blue above.
        grad.addColorStop(0, `rgba(255,160,90,${(state.tintStrength * 0.25).toFixed(4)})`);
        grad.addColorStop(1, `rgba(90,130,200,${(state.tintStrength * 0.15).toFixed(4)})`);
      } else {
        // Cool blue-purple dusk.
        grad.addColorStop(0, `rgba(200,120,200,${(state.tintStrength * 0.2).toFixed(4)})`);
        grad.addColorStop(1, `rgba(60,70,140,${(state.tintStrength * 0.2).toFixed(4)})`);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /**
   * Draw lit window dots (#ffeb3b) on a deterministic subset of buildings.
   * Lights only render when isNight is true (overlayAlpha above threshold).
   * Selection uses a hash of building.id so it is stable across frames.
   */
  drawWindowLights(): void {
    const { ctx, world } = this;
    const state = computeLightingState(this.time);
    if (!state.isNight) return;

    const prevFillStyle = ctx.fillStyle;
    const prevComposite = ctx.globalCompositeOperation;
    // Additive blend so lights glow on top of the darkness.
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = WINDOW_LIGHT_COLOR;

    for (const building of world.buildings.values()) {
      if (hashToUnit(building.id) >= WINDOW_LIGHT_THRESHOLD) continue;
      const bx = building.x * TILE_SIZE;
      const by = building.y * TILE_SIZE;
      const bw = building.width * TILE_SIZE;
      const bh = building.height * TILE_SIZE;
      // Place a couple of window dots within the building footprint.
      const cols = Math.max(1, Math.floor(bw / 6));
      const rows = Math.max(1, Math.floor(bh / 6));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Deterministic per-cell on/off via hash of building id + cell.
          const cellHash = hashToUnit(`${building.id}-${r}-${c}`);
          if (cellHash >= 0.5) continue;
          const wx = bx + ((c + 1) / (cols + 1)) * bw - WINDOW_LIGHT_SIZE / 2;
          const wy = by + ((r + 1) / (rows + 1)) * bh - WINDOW_LIGHT_SIZE / 2;
          ctx.fillRect(wx, wy, WINDOW_LIGHT_SIZE, WINDOW_LIGHT_SIZE);
        }
      }
    }

    ctx.globalCompositeOperation = prevComposite;
    ctx.fillStyle = prevFillStyle;
  }

  /**
   * Draw street light glows (radial gradient rgba(255,220,100,0.3)) on road
   * tiles selected by a grid stride: (x + y * gridWidth) % 6 === 0. This gives
   * even spatial distribution (~every 6 road tiles) without tracing paths.
   */
  drawStreetLights(): void {
    const { ctx, world } = this;
    const state = computeLightingState(this.time);
    if (!state.isNight) return;

    const prevComposite = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';

    world.grid.forEach((tile) => {
      if (tile.type !== 'road') return;
      const strideIndex = tile.x + tile.y * world.width;
      if (strideIndex % STREET_LIGHT_STRIDE !== 0) return;

      const cx = tile.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = tile.y * TILE_SIZE + TILE_SIZE / 2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, STREET_LIGHT_RADIUS);
      grad.addColorStop(0, STREET_LIGHT_GLOW_COLOR);
      grad.addColorStop(1, 'rgba(255,220,100,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(
        cx - STREET_LIGHT_RADIUS,
        cy - STREET_LIGHT_RADIUS,
        STREET_LIGHT_RADIUS * 2,
        STREET_LIGHT_RADIUS * 2,
      );
    });

    ctx.globalCompositeOperation = prevComposite;
  }
}
