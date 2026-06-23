/**
 * SpriteLoader — lazy-loading sprite cache with procedural fallback (spec §3.3).
 *
 * Sprites are looked up at `/assets/sprites/<category>/<name>.png` (served from
 * `public/assets/sprites/`). The loader is intentionally lazy: a sprite is only
 * fetched the first time it is requested, and the result (HTMLImageElement on
 * success, or a `null` sentinel on failure) is cached so we never re-fetch a
 * 404 every frame.
 *
 * DESIGN (see plan notes):
 *  - `load(category, name)` is async (returns Promise<HTMLImageElement|null>)
 *    for initial/preload usage.
 *  - `get(category, name)` is SYNC (returns HTMLImageElement|null from cache)
 *    and is what the Renderer calls every frame.
 *  - Failed loads cache a `null` sentinel to prevent re-fetching 404s.
 *  - SSR-safe: all `Image`/`window` access is guarded. In Node SSR every
 *    lookup returns `null` → the Renderer falls back to procedural drawing.
 */

/** Cache entry: a loaded image, or `null` for a confirmed-failed load. */
type CacheEntry = HTMLImageElement | null;

/** Sentinel value distinguishing "not yet requested" from "failed". */
const NOT_LOADED = Symbol('not-loaded');

export class SpriteLoader {
  /** category/name → loaded image, null (failed), or NOT_LOADED (pending/untried). */
  private readonly cache = new Map<string, CacheEntry | typeof NOT_LOADED>();

  /**
   * Build the public URL for a sprite.
   * Static export serves `public/` at the site root, so the path is
   * `/assets/sprites/<category>/<name>.png`.
   */
  private url(category: string, name: string): string {
    return `/assets/sprites/${category}/${name}.png`;
  }

  /** Cache key combining category + name. */
  private key(category: string, name: string): string {
    return `${category}/${name}`;
  }

  /**
   * Asynchronously load a sprite. Resolves to the HTMLImageElement on success,
   * or `null` on failure (404 / decode error / SSR). The result is cached so
   * subsequent `get()` calls are synchronous.
   *
   * SSR-safe: if `Image` is undefined (Node), resolves `null` immediately.
   */
  load(category: string, name: string): Promise<HTMLImageElement | null> {
    // SSR guard: no Image constructor in Node → procedural fallback.
    if (typeof Image === 'undefined') {
      return Promise.resolve(null);
    }

    const key = this.key(category, name);
    const cached = this.cache.get(key);
    // Already loaded (success or failure) — return cached result.
    if (cached !== NOT_LOADED && cached !== undefined) {
      return Promise.resolve(cached);
    }

    const url = this.url(category, name);
    return new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.cache.set(key, img);
        resolve(img);
      };
      img.onerror = () => {
        // Cache the failure so we don't re-fetch the 404 every frame.
        this.cache.set(key, null);
        resolve(null);
      };
      img.src = url;
    });
  }

  /**
   * Synchronously get a cached sprite. Returns the HTMLImageElement if loaded,
   * or `null` if not yet loaded, failed, or in SSR. This is the hot path the
   * Renderer calls every frame.
   *
   * SSR-safe: in Node, `Image` is undefined so everything returns `null`.
   */
  get(category: string, name: string): HTMLImageElement | null {
    if (typeof Image === 'undefined') return null;
    const entry = this.cache.get(this.key(category, name));
    if (entry === undefined || entry === NOT_LOADED) return null;
    return entry;
  }

  /**
   * Preload a batch of sprites. Resolves once all loads settle (success or
   * failure). Useful for a loading screen to show progress.
   */
  preload(
    entries: ReadonlyArray<{ category: string; name: string }>,
  ): Promise<void> {
    return Promise.all(entries.map((e) => this.load(e.category, e.name))).then(
      () => undefined,
    );
  }

  /** Clear the cache (test/reset helper). */
  clear(): void {
    this.cache.clear();
  }
}

/** Shared singleton instance used by the Renderer and page bootstrap. */
export const spriteLoader = new SpriteLoader();
