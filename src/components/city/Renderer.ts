/**
 * Renderer — pure-TS canvas drawing module for the city simulation.
 *
 * Spec reference: §5.4 Rendering, §6.2 Day/Night cycle, §7.2 Citizen Behaviour.
 *
 * The renderer is intentionally framework-agnostic. It owns a 2D canvas
 * context, knows how to map world coordinates to screen pixels, and
 * draws the small set of primitives the city sim needs today
 * (citizens with activity halos, vehicles, particles, and a
 * day/night lighting overlay). It does NOT depend on React; the
 * React layer (`CityCanvas.tsx`) calls `createRenderer` once on mount
 * and invokes the per-frame draw methods on each tick.
 *
 * Visual decisions (per the supplied mockup):
 *   - Each citizen is a small filled dot (~3.5 px) plus a low-alpha
 *     ring halo (~6.5 px) that reads as a soft glow.
 *   - Activity -> color is a static table sourced from the Tailwind v4
 *     @theme tokens. If the CSS hasn't been parsed yet we fall back to
 *     a hard-coded palette so the canvas is never blank.
 *   - HiDPI: the canvas backing store is sized to `devicePixelRatio`
 *     so edges stay crisp on retina displays.
 *   - Viewport culling uses a 10% margin (VIEWPORT_CULL_MARGIN) so
 *     entities just outside the visible area are still drawn, hiding
 *     edge-popping during camera animation.
 *   - Lighting overlay: a screen-space radial gradient whose alpha
 *     tracks the time of day. 0 at noon, ~0.275 at 6/18, 0.55 at
 *     midnight (per spec 6.2).
 *
 * Test strategy: drawing tests are unit-tested via the pure helpers
 * (resolveCitizenStyle, ACTIVITY_COLORS, computeLightingAlpha,
 * getViewportRect from Camera). The actual `ctx.draw*` path is
 * exercised in jsdom with a spy on `ctx.arc` to verify culling.
 */
import type { Citizen, Vehicle } from '@/entities';
import {
  ACTIVITY_IDS,
  type ActivityId,
  type CitizenId,
  type Vector2,
} from '@/types/common';
import {
  CAMERA_LERP,
  VIEWPORT_CULL_MARGIN,
  getViewportRect,
  isPointInRect,
  type Camera as CameraState,
  type WorldRect,
} from './Camera';
import {
  type Particle,
  type ParticleKind,
} from './Particles';

// Re-export the Camera + rect types so the React layer doesn't need
// to import from `Camera.ts` separately.
export type { Camera, WorldRect } from './Camera';
export { CAMERA_LERP, VIEWPORT_CULL_MARGIN };

/** A hit-test record the React layer can use to drive a tooltip. */
export interface HitRecord {
  id: CitizenId;
  /** Screen-space (CSS pixel) coordinates of the citizen. */
  screen: Vector2;
}

const DOT_RADIUS = 3.5;
const HALO_RADIUS = 6.5;
const HALO_ALPHA = 0.35;
const HIT_RADIUS = 8;

// Vehicle drawing constants (mockup direction: small orange rounded
// rects with a 2px arrow head, drawn at 70% opacity over road tiles).
const VEHICLE_WIDTH = 3.5;
const VEHICLE_LENGTH = 7;
const VEHICLE_ARROW_LENGTH = 2;
const VEHICLE_ALPHA = 0.7;
const VEHICLE_CORNER_RADIUS = 1.5;

// Building drawing constants.
const BUILDING_WIDTH = 8;
const BUILDING_HEIGHT = 8;
const BUILDING_ALPHA = 0.85;
const BUILDING_CORNER_RADIUS = 1.5;

// Lighting overlay constants (spec 6.2).
const LIGHTING_ALPHA_MIDNIGHT = 0.55;
const LIGHTING_ALPHA_DAWN_DUSK = 0.275;
const LIGHTING_BUCKETS = 16;

/**
 * Per-activity color table. Keys MUST match the `ActivityId` union so
 * TS exhaustiveness-checks the map. Values are Tailwind v4 theme token
 * names that get resolved through `getComputedStyle` at draw time, with
 * a hard-coded fallback if the CSS hasn't loaded.
 */
export const ACTIVITY_COLORS: Readonly<Record<ActivityId, string>> = Object.freeze({
  sleep: '--color-citizen',
  work: '--color-accent',
  commute: '--color-warning',
  leisure: '--color-accent',
  eat: '--color-warning',
  socialize: '--color-citizen',
  errand: '--color-building',
});

/** Hard-coded fallback palette in case getComputedStyle returns ''. */
const FALLBACK_COLORS: Readonly<Record<ActivityId, string>> = Object.freeze({
  sleep: '#bfe4ee',
  work: '#8be0b5',
  commute: '#e8b878',
  leisure: '#8be0b5',
  eat: '#e8b878',
  socialize: '#bfe4ee',
  errand: '#9aa3b2',
});

/** Resolved style for a single citizen (pure, fully testable). */
export interface CitizenStyle {
  fill: string;
  halo: string;
}

/** CSS variable name for the vehicle body color. */
export const VEHICLE_COLOR = '--color-warning';

/** Hard-coded fallback for the vehicle body when CSS isn't available. */
const VEHICLE_COLOR_FALLBACK = '#e8b878';

/** Resolved style for a single vehicle (pure, fully testable). */
export interface VehicleStyle {
  body: string;
}

/** Resolved style for a building. */
export interface BuildingStyle {
  fill: string;
  stroke: string;
}

/** CSS variables for buildings. */
export const BUILDING_COLOR = '--color-building';
export const BUILDING_STROKE_COLOR = '--color-surface';
const BUILDING_COLOR_FALLBACK = '#9aa3b2';
const BUILDING_STROKE_FALLBACK = '#1a1d24';

/**
 * Resolve a vehicle's body color. Mirrors `resolveCitizenStyle`: reads
 * the `--color-warning` CSS custom property from `:root` and falls
 * back to a hard-coded orange when the CSS hasn't been parsed yet.
 */
export function resolveVehicleStyle(
  root: Element | null = typeof document !== 'undefined' ? document.documentElement : null,
): VehicleStyle {
  const cssValue =
    root !== null
      ? getComputedStyle(root).getPropertyValue(VEHICLE_COLOR).trim()
      : '';
  return { body: cssValue.length > 0 ? cssValue : VEHICLE_COLOR_FALLBACK };
}

/**
 * Resolve building colours. Reads `--color-building` and
 * `--color-surface` from the root; falls back to a hard-coded pair.
 */
export function resolveBuildingStyle(
  root: Element | null = typeof document !== 'undefined' ? document.documentElement : null,
): BuildingStyle {
  if (root === null) {
    return { fill: BUILDING_COLOR_FALLBACK, stroke: BUILDING_STROKE_FALLBACK };
  }
  const style = getComputedStyle(root);
  const fill = style.getPropertyValue(BUILDING_COLOR).trim() || BUILDING_COLOR_FALLBACK;
  const stroke = style.getPropertyValue(BUILDING_STROKE_COLOR).trim() || BUILDING_STROKE_FALLBACK;
  return { fill, stroke };
}

/**
 * Resolve a citizen's draw style for the given activity.
 * Pure function; the only DOM access is `getComputedStyle` on `:root`
 * which is mocked in jsdom tests by stubbing the global. When the
 * resolved CSS variable is empty (e.g. SSR or before-stylesheet-loaded)
 * we fall back to the hard-coded palette so the canvas is never blank.
 */
export function resolveCitizenStyle(
  activity: ActivityId,
  root: Element | null = typeof document !== 'undefined' ? document.documentElement : null,
): CitizenStyle {
  const token = ACTIVITY_COLORS[activity];
  const cssValue =
    root !== null
      ? getComputedStyle(root).getPropertyValue(token).trim()
      : '';
  const fallback = FALLBACK_COLORS[activity] ?? '#cccccc';
  const fill = cssValue.length > 0 ? cssValue : fallback;
  return { fill, halo: fill };
}

/**
 * Compute the lighting overlay alpha for a given in-game hour (0..23).
 *
 *   hour 0  (midnight)         -> 0.55
 *   hour 6  (dawn)             -> ~0.275
 *   hour 12 (noon)             -> 0
 *   hour 18 (dusk)             -> ~0.275
 *   between is linearly interpolated
 *
 * Pure, exported for unit tests.
 */
export function computeLightingAlpha(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  // Normalise hour to [0, 24) so the caller can pass any real number.
  const h = ((hour % 24) + 24) % 24;
  if (h <= 6) {
    // Midnight (0) -> 0.55, dawn (6) -> 0.275
    const t = h / 6;
    return LIGHTING_ALPHA_MIDNIGHT + (LIGHTING_ALPHA_DAWN_DUSK - LIGHTING_ALPHA_MIDNIGHT) * t;
  }
  if (h <= 12) {
    // Dawn (6) -> 0.275, noon (12) -> 0
    const t = (h - 6) / 6;
    return LIGHTING_ALPHA_DAWN_DUSK * (1 - t);
  }
  if (h <= 18) {
    // Noon (12) -> 0, dusk (18) -> 0.275
    const t = (h - 12) / 6;
    return LIGHTING_ALPHA_DAWN_DUSK * t;
  }
  // Dusk (18) -> 0.275, midnight (24) -> 0.55
  const t = (h - 18) / 6;
  return LIGHTING_ALPHA_DAWN_DUSK + (LIGHTING_ALPHA_MIDNIGHT - LIGHTING_ALPHA_DAWN_DUSK) * t;
}

/**
 * Bucket an alpha value into one of `LIGHTING_BUCKETS` discrete values.
 * Used to cache radial gradients so we don't recreate them every frame.
 */
export function bucketAlpha(alpha: number): number {
  if (!Number.isFinite(alpha)) return 0;
  const clamped = Math.max(0, Math.min(1, alpha));
  const bucket = Math.round(clamped * LIGHTING_BUCKETS);
  return bucket / LIGHTING_BUCKETS;
}

export interface Renderer {
  /** Repaint the canvas with the current world state. */
  drawCitizens(citizens: readonly Citizen[], camera: CameraState): void;
  /**
   * Repaint the vehicle layer. Vehicles are drawn AFTER citizens so
   * they read on top; their orientation is derived from the velocity
   * (next tile - previous tile). No-op for an empty list.
   */
  drawVehicles(vehicles: readonly Vehicle[], camera: CameraState): void;
  /**
   * Repaint the buildings layer. Buildings are drawn before citizens
   * and vehicles so they sit on the "ground" plane.
   */
  drawBuildings(
    buildings: readonly { id: string; position: Vector2 }[],
    camera: CameraState,
  ): void;
  /**
   * Repaint the particles layer (dust + zzz). Drawn LAST so the
   * particles read as a foreground detail.
   */
  drawParticles(particles: readonly Particle[], camera: CameraState): void;
  /**
   * Repaint the day/night lighting overlay. The overlay is a
   * full-canvas radial gradient whose alpha tracks the in-game
   * hour (0 at noon, 0.55 at midnight, ~0.275 at dawn/dusk per
   * spec 6.2). The gradient is cached per alpha bucket so the
   * cost is O(1) per frame after the first.
   */
  drawLightingOverlay(hour: number, camera: CameraState): void;
  /** Hit-test the screen for a citizen under (x, y) in CSS pixels. */
  hitTest(
    x: number,
    y: number,
    citizens: readonly Citizen[],
    camera: CameraState,
  ): HitRecord | null;
  /** Release any cached resources. Safe to call multiple times. */
  dispose(): void;
  /** The underlying canvas element. Exposed for tests and pointer wiring. */
  readonly canvas: HTMLCanvasElement;
}

/** Optional overrides for tests and SSR fallback. */
export interface RendererOptions {
  /** Pixel ratio override (defaults to `window.devicePixelRatio`). */
  pixelRatio?: number;
  /** Width in CSS pixels. */
  width?: number;
  /** Height in CSS pixels. */
  height?: number;
}

/**
 * Create a renderer bound to a canvas. The caller owns the element and
 * is responsible for inserting it into the DOM. The renderer attaches
 * a `resize` listener so the canvas stays crisp on window resize.
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  options: RendererOptions = {},
): Renderer {
  const maybeCtx = canvas.getContext('2d');
  if (maybeCtx === null) {
    throw new Error('Renderer: 2D canvas context unavailable');
  }
  // After the null check, narrow to the non-null type for all the closures
  // below without re-checking (TS otherwise widens back to CanvasRenderingContext2D | null).
  const ctx: CanvasRenderingContext2D = maybeCtx;

  let disposed = false;
  let cssW = options.width ?? 800;
  let cssH = options.height ?? 480;
  // Cache of radial lighting gradients, keyed by bucketed alpha. We
  // recreate the gradient on a resize (canvas size changed) or on a
  // new alpha bucket (different time of day). Declared above
  // `applySize` so the resize hook can clear it without TDZ error.
  const gradientCache: Map<number, CanvasGradient> = new Map();
  const applySize = (): void => {
    if (disposed) return;
    const dpr = options.pixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const computedW = options.width ?? canvas.clientWidth ?? cssW;
    const computedH = options.height ?? canvas.clientHeight ?? cssH;
    cssW = computedW;
    cssH = computedH;
    canvas.width = Math.max(1, Math.round(computedW * dpr));
    canvas.height = Math.max(1, Math.round(computedH * dpr));
    canvas.style.width = `${computedW}px`;
    canvas.style.height = `${computedH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Drop the gradient cache: the gradient is sized to the canvas.
    gradientCache.clear();
  };
  applySize();

  const onResize = (): void => applySize();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onResize);
  }

  function worldToScreen(world: Vector2, camera: CameraState): Vector2 {
    return {
      x: (world.x - camera.origin.x) * camera.scale,
      y: (world.y - camera.origin.y) * camera.scale,
    };
  }

  function getViewport(camera: CameraState): WorldRect {
    return getViewportRect(camera, cssW, cssH, VIEWPORT_CULL_MARGIN);
  }

  function drawBuildings(
    buildings: readonly { id: string; position: Vector2 }[],
    camera: CameraState,
  ): void {
    if (disposed) return;
    if (buildings.length === 0) return;
    const style = resolveBuildingStyle();
    const viewport = getViewport(camera);

    for (const building of buildings) {
      if (!isPointInRect(building.position, viewport)) continue;
      const screen = worldToScreen(building.position, camera);

      ctx.save();
      ctx.globalAlpha = BUILDING_ALPHA;
      ctx.fillStyle = style.fill;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 1;
      const w = BUILDING_WIDTH * camera.scale;
      const h = BUILDING_HEIGHT * camera.scale;
      const x = screen.x - w / 2;
      const y = screen.y - h / 2;
      const r = Math.max(0, Math.min(BUILDING_CORNER_RADIUS, Math.min(w, h) / 2));
      roundRectPath(ctx, x, y, w, h, r);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawVehicles(vehicles: readonly Vehicle[], camera: CameraState): void {
    if (disposed) return;
    if (vehicles.length === 0) return;
    const style = resolveVehicleStyle();
    const viewport = getViewport(camera);

    for (const vehicle of vehicles) {
      if (!isPointInRect(vehicle.position, viewport)) continue;
      const screen = worldToScreen(vehicle.position, camera);
      const { dx, dy } = vehicleVelocity(vehicle);
      const angle = Math.atan2(dy, dx);

      ctx.save();
      ctx.translate(screen.x, screen.y);
      ctx.rotate(angle);

      // Body: rounded rect, 3.5px wide x 7px long, oriented along +x.
      ctx.globalAlpha = VEHICLE_ALPHA;
      ctx.fillStyle = style.body;
      const halfW = VEHICLE_WIDTH / 2;
      const halfL = VEHICLE_LENGTH / 2;
      roundRectPath(ctx, -halfL, -halfW, VEHICLE_LENGTH, VEHICLE_WIDTH, VEHICLE_CORNER_RADIUS);
      ctx.fill();

      // Arrow head: 2px triangle pointing along +x.
      ctx.beginPath();
      ctx.moveTo(halfL + VEHICLE_ARROW_LENGTH, 0);
      ctx.lineTo(halfL, -VEHICLE_WIDTH / 2);
      ctx.lineTo(halfL, VEHICLE_WIDTH / 2);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    // Reset alpha so subsequent callers (e.g. debug overlays) start clean.
    ctx.globalAlpha = 1;
  }

  function drawCitizens(citizens: readonly Citizen[], camera: CameraState): void {
    if (disposed) return;
    // Clear in CSS-pixel space (transform was reset by setTransform above).
    ctx.clearRect(0, 0, cssW, cssH);

    const viewport = getViewport(camera);

    for (const citizen of citizens) {
      if (!isPointInRect(citizen.position, viewport)) continue;
      const screen = worldToScreen(citizen.position, camera);
      const style = resolveCitizenStyle(citizen.currentActivity);

      // Halo (soft glow): low-alpha stroke ring, slightly larger than the dot.
      ctx.globalAlpha = HALO_ALPHA;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, HALO_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = style.halo;
      ctx.fill();

      // Core dot.
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = style.fill;
      ctx.fill();
    }

    // Reset alpha so subsequent callers (e.g. debug overlays) start clean.
    ctx.globalAlpha = 1;
  }

  function drawParticles(particles: readonly Particle[], camera: CameraState): void {
    if (disposed) return;
    if (particles.length === 0) return;
    const viewport = getViewport(camera);

    for (const p of particles) {
      if (!isPointInRect(p.position, viewport)) continue;
      const screen = worldToScreen(p.position, camera);
      const t = Math.max(0, Math.min(1, 1 - p.age / p.maxAge));
      const alpha = p.alpha * t;
      if (alpha <= 0) continue;

      if (p.kind === 'dust') {
        const r = Math.max(0.4, p.size * camera.scale * t);
        ctx.save();
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillStyle = `hsla(${p.hue} 35% 70% / ${alpha})`;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        // 'zzz'
        const size = Math.max(4, p.size * 10 * camera.scale);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `hsla(${p.hue} 45% 75% / ${alpha})`;
        ctx.font = `bold ${size}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const glyph = p.size > 1.0 ? 'Z' : 'z';
        ctx.fillText(glyph, screen.x, screen.y);
        ctx.restore();
      }
    }

    ctx.globalAlpha = 1;
  }

  // (gradientCache is declared above `applySize` so the resize hook
  //  can clear it without hitting a temporal-dead-zone error.)

  function getOrCreateGradient(alphaBucket: number): CanvasGradient {
    const cached = gradientCache.get(alphaBucket);
    if (cached !== undefined) return cached;
    // Cap the radius to the viewport diagonal so a resized canvas
    // doesn't produce an unnecessarily large gradient.
    const radius = Math.hypot(cssW, cssH);
    const gradient = ctx.createRadialGradient(
      cssW / 2,
      cssH / 2,
      0,
      cssW / 2,
      cssH / 2,
      radius,
    );
    gradient.addColorStop(0, `rgba(8, 10, 18, ${alphaBucket})`);
    gradient.addColorStop(1, `rgba(8, 10, 18, ${alphaBucket})`);
    gradientCache.set(alphaBucket, gradient);
    return gradient;
  }

  function drawLightingOverlay(hour: number, _camera: CameraState): void {
    if (disposed) return;
    const alpha = computeLightingAlpha(hour);
    if (alpha <= 0) return;
    const bucket = bucketAlpha(alpha);
    const gradient = getOrCreateGradient(bucket);

    ctx.save();
    ctx.fillStyle = gradient;
    // Fill in screen space; restore the transform afterwards.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // The setTransform call above overwrote our DPR transform; the
    // next draw call (in the next frame) will re-apply it via applySize.
    // We re-apply eagerly so a caller that draws something after the
    // overlay sees the correct transform.
    const dpr = options.pixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function hitTest(
    x: number,
    y: number,
    citizens: readonly Citizen[],
    camera: CameraState,
  ): HitRecord | null {
    let best: HitRecord | null = null;
    let bestDist = HIT_RADIUS;
    for (const citizen of citizens) {
      const screen = worldToScreen(citizen.position, camera);
      const dx = screen.x - x;
      const dy = screen.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= bestDist) {
        bestDist = dist;
        best = { id: citizen.id, screen };
      }
    }
    return best;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', onResize);
    }
    gradientCache.clear();
  }

  return {
    drawCitizens,
    drawVehicles,
    drawBuildings,
    drawParticles,
    drawLightingOverlay,
    hitTest,
    dispose,
    get canvas() {
      return canvas;
    },
  };
}

/**
 * Derive a vehicle's velocity vector from its path. We look at the
 * next tile (path[pathIndex]) and the previous tile (path[pathIndex-1])
 * and return their delta. If pathIndex === 0 we don't have a previous
 * tile; we fall back to (0, 1) so the arrow points "down" (toward
 * the next intersection) on the very first tick.
 */
function vehicleVelocity(vehicle: Vehicle): { dx: number; dy: number } {
  if (vehicle.path.length === 0) {
    return { dx: 0, dy: 1 };
  }
  const next = vehicle.path[vehicle.pathIndex] ?? vehicle.path[vehicle.path.length - 1]!;
  const prev = vehicle.pathIndex > 0 ? vehicle.path[vehicle.pathIndex - 1]! : null;
  if (prev === null) {
    // First tick: there's no previous tile. Default to "down" so the
    // arrow points somewhere sensible; a future renderer can blend
    // toward the next tile over the first few ticks if desired.
    return { dx: 0, dy: 1 };
  }
  return { dx: next.x - prev.x, dy: next.y - prev.y };
}

/**
 * Append a rounded-rect path to the current 2D context. Kept tiny
 * because the only consumer is the vehicle body and the buildings.
 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Assert that the activity color table is exhaustive and has the right
 * shape. Exposed for tests; pure.
 */
export function assertActivityColorsComplete(table: Readonly<Record<string, string>>): void {
  for (const id of ACTIVITY_IDS) {
    if (typeof table[id] !== 'string' || table[id] === undefined) {
      throw new Error(`ACTIVITY_COLORS missing entry for "${id}"`);
    }
  }
}

/**
 * Assert that the vehicle color token is a non-empty CSS custom-property
 * name (must start with '--') and that the fallback is a non-empty
 * string. Exposed for tests; pure.
 */
export function assertVehicleColorsComplete(
  token: string,
  fallback: string,
): void {
  if (typeof token !== 'string' || token.length === 0 || !token.startsWith('--')) {
    throw new Error(`VEHICLE_COLOR must be a CSS custom property (got "${token}")`);
  }
  if (typeof fallback !== 'string' || fallback.length === 0) {
    throw new Error('VEHICLE_COLOR_FALLBACK must be a non-empty string');
  }
}

// Silence the unused-import warning for the ParticleKind type alias
// (re-exported above for downstream consumers).
export type { ParticleKind };
