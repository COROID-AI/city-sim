/**
 * SpriteLoader unit tests.
 *
 * Verifies the contract: tryLoadSprite is synchronous and never returns
 * null; loadSprite resolves with either a real image or a procedural
 * fallback; clearCache drops the cache.
 */
import {
  SPRITE_BASE_PATH,
  cacheSize,
  clearCache,
  createProceduralSprite,
  isProceduralSprite,
  loadSprite,
  spriteUrl,
  tryLoadSprite,
} from '@/engine/SpriteLoader';

describe('SpriteLoader', () => {
  beforeEach(() => {
    clearCache();
  });

  describe('module surface', () => {
    it('exposes the canonical sprite base path', () => {
      expect(SPRITE_BASE_PATH).toBe('/assets/sprites');
    });

    it('builds the right url for a given sprite id', () => {
      expect(spriteUrl('citizen')).toBe('/assets/sprites/citizen.png');
    });
  });

  describe('tryLoadSprite (sync)', () => {
    it('returns a procedural sprite on first call (no fetch needed)', () => {
      const sprite = tryLoadSprite('citizen');
      expect(isProceduralSprite(sprite)).toBe(true);
    });

    it('is deterministic for the same id (stable canvas content)', () => {
      const a = tryLoadSprite('tree');
      const b = tryLoadSprite('tree');
      // Both are procedural sprites with stable, deterministic shape
      // (hash-based). They should be the same object because the cache
      // hit returns the same record.
      expect(a).toBe(b);
    });

    it('grows the cache by one entry per new id', () => {
      tryLoadSprite('citizen');
      expect(cacheSize()).toBe(1);
      tryLoadSprite('vehicle');
      expect(cacheSize()).toBe(2);
      tryLoadSprite('citizen');
      expect(cacheSize()).toBe(2);
    });

    it('clearCache empties the cache', () => {
      tryLoadSprite('citizen');
      tryLoadSprite('tree');
      clearCache();
      expect(cacheSize()).toBe(0);
    });

    it('falls back to a procedural sprite when fetch fails', async () => {
      // In jsdom there is no fetch; loadSprite must resolve with a
      // procedural sprite and never throw.
      const sprite = await loadSprite('missing-thing');
      expect(isProceduralSprite(sprite)).toBe(true);
    });

    it('returns a procedural sprite for unknown ids without throwing', async () => {
      await expect(loadSprite('does-not-exist')).resolves.toBeDefined();
    });
  });

  describe('createProceduralSprite', () => {
    it('returns a 16x16 canvas-backed sprite', () => {
      const sprite = createProceduralSprite('hello');
      expect(sprite.width).toBe(16);
      expect(sprite.height).toBe(16);
      expect(sprite.canvas).toBeInstanceOf(HTMLCanvasElement);
    });

    it('returns a canvas with the expected backing-store size', () => {
      // jsdom does not implement getContext('2d') (it returns null), so
      // we only assert the canvas's intrinsic dimensions here. The
      // shape itself is painted at runtime by the renderer, which
      // is the testable surface in the browser.
      const sprite = createProceduralSprite('foo');
      expect(sprite.canvas.width).toBeGreaterThan(0);
      expect(sprite.canvas.height).toBeGreaterThan(0);
    });
  });
});
