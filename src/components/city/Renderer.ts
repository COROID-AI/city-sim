/**
 * Renderer — pure-TS canvas drawing module for the city simulation.
 *
 * Spec reference: §5.4 Rendering, §7.2 Citizen Behaviour.
 *
 * The renderer is intentionally framework-agnostic. It owns a 2D canvas
 * context, knows how to map world coordinates to screen pixels, and
 * draws the small set of primitives the city sim needs today (citizens
 * with activity halos). It does NOT depend on React; the React layer
 * (`CityCanvas.tsx`) calls `createRenderer` once on mount and invokes
 * `drawCitizens` / `dispose` on lifecycle events.
 *
 * Visual decisions (per the supplied mockup):
 *   - Each citizen is a small filled dot (~3.5 px) plus a low-alpha
 *     ring halo (~6.5 px) that reads as a soft glow.
 *   - Activity -> color is a static table sourced from the Tailwind v4
 *     @theme tokens. If the CSS hasn't been parsed yet we fall back to
 *     a hard-coded palette so the canvas is never blank.
 *   - HiDPI: the canvas backing store is sized to `devicePixelRatio`
 *     so edges stay crisp on retina displays.
 *
 * Test strategy: drawing tests are unit-tested via the pure helpers
 * (resolveCitizenStyle, ACTIVITY_COLORS) only. The actual `ctx.draw*`
 * path is not exercised in jsdom (it has a stub 2D context).
 */
import type { Citizen } from '@/entities';
import {
  ACTIVITY_IDS,
  type ActivityId,
  type CitizenId,
  type Vector2,
} from '@/types/common';

/** World-to-screen camera. The renderer doesn't own world state; it
 *  applies the camera when drawing. */
export interface Camera {
  /** World coordinate at the top-left of the visible viewport. */
  origin: Vector2;
  /** Pixels per world unit. */
  scale: number;
}

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

export interface Renderer {
  /** Repaint the canvas with the current world state. */
  drawCitizens(citizens: readonly Citizen[], camera: Camera): void;
  /** Hit-test the screen for a citizen under (x, y) in CSS pixels. */
  hitTest(
    x: number,
    y: number,
    citizens: readonly Citizen[],
    camera: Camera,
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
  const applySize = (): void => {
    if (disposed) return;
    const dpr = options.pixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const cssW = options.width ?? canvas.clientWidth ?? 800;
    const cssH = options.height ?? canvas.clientHeight ?? 480;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  applySize();

  const onResize = (): void => applySize();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onResize);
  }

  function worldToScreen(world: Vector2, camera: Camera): Vector2 {
    return {
      x: (world.x - camera.origin.x) * camera.scale,
      y: (world.y - camera.origin.y) * camera.scale,
    };
  }

  function drawCitizens(citizens: readonly Citizen[], camera: Camera): void {
    if (disposed) return;
    // Clear in CSS-pixel space (transform was reset by setTransform above).
    ctx.clearRect(0, 0, canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height);

    for (const citizen of citizens) {
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

  function hitTest(
    x: number,
    y: number,
    citizens: readonly Citizen[],
    camera: Camera,
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
  }

  return {
    drawCitizens,
    hitTest,
    dispose,
    get canvas() {
      return canvas;
    },
  };
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
