/**
 * Sprite loader with a procedural-fallback rule.
 *
 * The renderer is designed to work with no assets on disk: when a sprite
 * file is missing or fails to load (e.g. in jsdom, in a fresh checkout, or
 * behind a flaky network), the renderer falls back to plain colored
 * rectangles and never throws.
 *
 * Loading is best-effort and asynchronous. `tryLoadSprites()` returns a
 * `SpriteAtlas` immediately — slots for missing sprites are `null`. The
 * renderer is expected to draw procedural rects whenever a slot is null.
 *
 * Image elements are only created when a `document` / `Image` global is
 * available, so this module is safe to import in Node (it returns an
 * empty atlas without throwing).
 */

/** All sprite keys known to the renderer. */
export type SpriteKey =
  | 'ground'
  | 'road'
  | 'water'
  | 'park'
  | 'lot'
  | 'building'
  | 'citizen';

/** Atlas: a record from sprite key to the loaded image (or null). */
export type SpriteAtlas = Readonly<Record<SpriteKey, HTMLImageElement | null>>;

/** Public asset base URL (rooted so it works in both dev and prod). */
export const SPRITE_BASE = '/assets/sprites';

/** Construct the public URL for a given sprite key. */
export function spriteUrl(key: SpriteKey, base: string = SPRITE_BASE): string {
  return `${base}/${key}.png`;
}

/**
 * Attempt to load every known sprite. Returns an atlas that maps each
 * key to either the loaded `HTMLImageElement` (on success) or `null`
 * (on failure or when the runtime has no DOM).
 *
 * The function never throws. In environments without `Image` (e.g. Node,
 * jsdom without image polyfill) every slot is null and the atlas is still
 * fully populated.
 *
 * @param base Optional override of the asset base URL. Defaults to
 *             `SPRITE_BASE`. Tests pass a fake base to keep things hermetic.
 */
export function tryLoadSprites(base: string = SPRITE_BASE): SpriteAtlas {
  const makeNull = (): HTMLImageElement | null => null;
  const atlas: Record<SpriteKey, HTMLImageElement | null> = {
    ground: makeNull(),
    road: makeNull(),
    water: makeNull(),
    park: makeNull(),
    lot: makeNull(),
    building: makeNull(),
    citizen: makeNull(),
  };

  // No DOM (e.g. Node): return the empty atlas immediately.
  if (typeof globalThis === 'undefined') return atlas;
  const imageCtor = (globalThis as { Image?: unknown }).Image;
  if (typeof imageCtor !== 'function') return atlas;

  const keys: readonly SpriteKey[] = [
    'ground',
    'road',
    'water',
    'park',
    'lot',
    'building',
    'citizen',
  ];
  for (const key of keys) {
    try {
      const img = new (imageCtor as new () => HTMLImageElement)();
      img.decoding = 'async';
      // Attach handlers BEFORE assigning src so we never miss the event.
      img.onload = () => {
        // Only stamp the slot on success; failures keep the null.
        atlas[key] = img;
      };
      img.onerror = () => {
        // Leave the slot null. Renderer falls back to procedural rects.
      };
      img.src = spriteUrl(key, base);
    } catch {
      // Defensive: any throw leaves the slot null and the renderer
      // falls back to procedural drawing.
    }
  }
  return atlas;
}
