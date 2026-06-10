/**
 * SpriteLoader — graceful sprite asset loader with a procedural fallback.
 *
 * Spec reference: §5.4 Rendering, §6.2 Day/Night cycle (polish).
 *
 * Goal: if the project ships PNG sprites under `/public/assets/sprites/{id}.png`
 * we use them; if not (the default in CI / first run) we generate a tiny
 * canvas-backed procedural sprite. The renderer can call `tryLoadSprite` on
 * every frame because it is synchronous and returns a `Sprite` immediately
 * (either a cached `HTMLImageElement` or a fresh `ProceduralSprite`).
 *
 * The async `loadSprite` is a fire-and-forget warmer: it tries to fetch
 * the PNG and, on success, populates the cache so future `tryLoadSprite`
 * calls return the real image. A failure simply leaves the procedural
 * sprite in place — there is no "throwing" path that could break the
 * render loop.
 *
 * Layer rule: this module is pure TS, no React, no DOM reads (the
 * `Image` / `fetch` globals are referenced via `typeof` guards so it
 * is also safe under Node / SSR).
 */

import type { Vector2 } from '@/types/common';

/** Base path for sprite assets. Relative to the site root. */
export const SPRITE_BASE_PATH = '/assets/sprites';

/** A sprite that the renderer can draw. Either a real image or a canvas fallback. */
export type Sprite = HTMLImageElement | ProceduralSprite;

/**
 * Canvas-backed procedural sprite. It quacks like an `HTMLImageElement`
 * for the two fields the renderer actually reads:
 *   - `width`, `height` (the renderer may use them for sizing)
 *   - `src`            (debug label, never used for drawing)
 * The renderer can detect this branch with `isProceduralSprite` and
 * use `drawProceduralSprite(ctx, ...)` to blit it.
 */
export interface ProceduralSprite {
  readonly kind: 'procedural';
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly src: string;
  /** The backing canvas; the renderer can `drawImage` this directly. */
  readonly canvas: HTMLCanvasElement;
}

/** Type guard. */
export function isProceduralSprite(value: unknown): value is ProceduralSprite {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'procedural' &&
    (value as { canvas?: unknown }).canvas instanceof HTMLCanvasElement
  );
}

/** Whether a value looks like a loaded HTMLImageElement. */
export function isLoadedImage(value: unknown): value is HTMLImageElement {
  return (
    typeof HTMLImageElement !== 'undefined' &&
    value instanceof HTMLImageElement &&
    value.complete &&
    value.naturalWidth > 0
  );
}

// ---------- internal cache ----------

interface CacheEntry {
  /** Either a loaded image or a procedural sprite. */
  sprite: Sprite;
  /** Whether an async fetch is still in-flight. */
  pending: boolean;
}

const cache: Map<string, CacheEntry> = new Map();

/** Maximum cache size to avoid unbounded growth in long sessions. */
const MAX_CACHE_ENTRIES = 256;

/** Default procedural sprite size (CSS pixels). */
const DEFAULT_PROC_SIZE = 16;

// ---------- public API ----------

/**
 * Build the URL where a sprite asset is expected to live.
 * Exposed for tests and for callers that want to <link rel="preload">.
 */
export function spriteUrl(id: string): string {
  return `${SPRITE_BASE_PATH}/${id}.png`;
}

/**
 * Synchronous lookup. Returns the cached image if it has finished
 * loading, otherwise returns a freshly-built procedural sprite. Never
 * returns `null` — the renderer is always able to draw something.
 */
export function tryLoadSprite(id: string): Sprite {
  const entry = cache.get(id);
  if (entry !== undefined && !entry.pending) {
    return entry.sprite;
  }
  // Build a procedural sprite on first sight (or while the async fetch
  // is in flight) so the renderer never blocks.
  const procedural = createProceduralSprite(id);
  if (entry === undefined) {
    cache.set(id, { sprite: procedural, pending: false });
    // Kick off an async load so the next frame may use the real image.
    void loadSprite(id);
  } else {
    // Update the entry so the cached object is the procedural one we
    // just built; the async loader will overwrite it on success.
    entry.sprite = procedural;
  }
  return procedural;
}

/**
 * Async loader. Resolves with the loaded `HTMLImageElement` on success
 * or with a `ProceduralSprite` on failure (404, network error, parse
 * error, server returned non-200). Never throws.
 */
export async function loadSprite(id: string): Promise<Sprite> {
  const existing = cache.get(id);
  if (existing !== undefined && !existing.pending && isLoadedImage(existing.sprite)) {
    return existing.sprite;
  }
  const placeholder: CacheEntry =
    existing ?? { sprite: createProceduralSprite(id), pending: true };
  placeholder.pending = true;
  cache.set(id, placeholder);

  // SSR / Node: nothing to do. The procedural placeholder is already in the cache.
  if (typeof fetch === 'undefined' || typeof Image === 'undefined') {
    placeholder.pending = false;
    return placeholder.sprite;
  }

  try {
    const response = await fetch(spriteUrl(id), { method: 'GET', cache: 'force-cache' });
    if (!response.ok) {
      throw new Error(`SpriteLoader: HTTP ${response.status} for ${id}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = (): void => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = (): void => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(`SpriteLoader: failed to decode ${id}`));
      };
      img.src = objectUrl;
    });
    placeholder.sprite = image;
    placeholder.pending = false;
    evictIfNeeded();
    return image;
  } catch {
    // Keep the procedural sprite we already have. Leave it in the cache
    // so future calls are a no-op until clearCache() is called.
    placeholder.pending = false;
    return placeholder.sprite;
  }
}

/**
 * Drop every cached sprite. Useful between hot-reloads and in tests.
 */
export function clearCache(): void {
  cache.clear();
}

/** Test-only: number of cached entries. */
export function cacheSize(): number {
  return cache.size;
}

// ---------- procedural fallback ----------

/**
 * Build a small canvas-backed sprite for the given id. The shape is
 * derived deterministically from the id so the same sprite is produced
 * for the same id every frame (important for visual stability).
 */
export function createProceduralSprite(id: string): ProceduralSprite {
  const canvas = createCanvas(DEFAULT_PROC_SIZE, DEFAULT_PROC_SIZE);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    // Extremely defensive: jsdom does have a 2D context, but a misconfigured
    // environment may not. Return an uninitialised canvas; drawProceduralSprite
    // will be a no-op against it.
    return {
      kind: 'procedural',
      id,
      width: canvas.width,
      height: canvas.height,
      src: `procedural:${id}`,
      canvas,
    };
  }
  paintProceduralSprite(ctx, id, DEFAULT_PROC_SIZE);
  return {
    kind: 'procedural',
    id,
    width: canvas.width,
    height: canvas.height,
    src: `procedural:${id}`,
    canvas,
  };
}

/**
 * Paint a small iconographic sprite for a given id. We pick a shape and
 * a colour from the id hash so the look is stable across reloads. The
 * palette is the dark-theme Tailwind tokens from spec 6.2.
 */
function paintProceduralSprite(
  ctx: CanvasRenderingContext2D,
  id: string,
  size: number,
): void {
  const h = hashString(id);
  const hue = h % 360;
  const fill = `hsl(${hue} 55% 65%)`;
  const stroke = `hsl(${hue} 55% 45%)`;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(0,0,0,0)';

  // Pick a shape based on the hash. We support four shapes so the
  // "fallback" is visibly distinct from each other.
  switch (h % 4) {
    case 0: {
      // Circle
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = stroke;
      ctx.stroke();
      break;
    }
    case 1: {
      // Square
      ctx.fillStyle = fill;
      ctx.fillRect(size * 0.2, size * 0.2, size * 0.6, size * 0.6);
      ctx.lineWidth = 1;
      ctx.strokeStyle = stroke;
      ctx.strokeRect(size * 0.2, size * 0.2, size * 0.6, size * 0.6);
      break;
    }
    case 2: {
      // Triangle
      ctx.beginPath();
      ctx.moveTo(size / 2, size * 0.2);
      ctx.lineTo(size * 0.8, size * 0.8);
      ctx.lineTo(size * 0.2, size * 0.8);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = stroke;
      ctx.stroke();
      break;
    }
    case 3:
    default: {
      // Diamond
      ctx.beginPath();
      ctx.moveTo(size / 2, size * 0.2);
      ctx.lineTo(size * 0.8, size / 2);
      ctx.lineTo(size / 2, size * 0.8);
      ctx.lineTo(size * 0.2, size / 2);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = stroke;
      ctx.stroke();
      break;
    }
  }
}

/**
 * Convenience for callers that already have a procedural sprite and
 * just want to draw it. Centres it at the world position with the
 * given world->screen mapping. Equivalent to a `drawImage(canvas, ...)`
 * but spares the renderer from thinking about the procedural branch.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  world: Vector2,
  worldToScreen: (world: Vector2) => Vector2,
): void {
  const screen = worldToScreen(world);
  if (isProceduralSprite(sprite)) {
    const w = sprite.width;
    const h = sprite.height;
    ctx.drawImage(sprite.canvas, screen.x - w / 2, screen.y - h / 2, w, h);
    return;
  }
  // HTMLImageElement
  ctx.drawImage(sprite, screen.x - sprite.width / 2, screen.y - sprite.height / 2);
}

// ---------- internal helpers ----------

/** Stable, fast, dependency-free string hash (FNV-1a, 32-bit). */
function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function evictIfNeeded(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  // Drop the oldest entries. Map iteration is insertion-ordered.
  const overflow = cache.size - MAX_CACHE_ENTRIES;
  let i = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    i += 1;
    if (i >= overflow) break;
  }
}

function createCanvas(w: number, h: number): HTMLCanvasElement {
  // Lazily resolve the constructor so this module is also safe to import
  // in environments where HTMLCanvasElement is undefined (theoretical).
  if (typeof HTMLCanvasElement === 'undefined') {
    // Stub object with width/height so the rest of the module can still
    // return a "procedural" record; the renderer will simply fail to
    // draw it, which is the same behaviour as a missing image.
    return { width: w, height: h } as HTMLCanvasElement;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}
