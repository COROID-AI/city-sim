/**
 * SpriteLoader unit tests.
 *
 * jsdom provides an `Image` constructor but images never actually load (no
 * network). We mock the global Image constructor to simulate onload/onerror
 * so we can test success, failure, caching, and SSR safety.
 */
import { SpriteLoader } from '@/engine/SpriteLoader';

/** A controllable mock Image that lets tests fire onload/onerror manually. */
interface MockImage {
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

/**
 * Install a mock Image constructor. Returns helpers to fire load/error.
 * `autoLoad=true` fires onload synchronously when src is set (success).
 * `autoLoad=false` fires onerror synchronously when src is set (failure).
 */
function mockImage(autoLoad: boolean) {
  const instances: MockImage[] = [];
  const OriginalImage = global.Image;

  class MockImageImpl {
    // Use a private backing field so the prototype src setter doesn't recurse.
    private _src = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      instances.push(this as unknown as MockImage);
    }
  }

  // Use defineProperty so we can restore later.
  Object.defineProperty(global, 'Image', {
    value: MockImageImpl,
    writable: true,
    configurable: true,
  });

  // Patch the src setter to auto-fire onload/onerror. Store the value in a
  // non-enumerable _src field to avoid infinite recursion.
  const proto = MockImageImpl.prototype;
  Object.defineProperty(proto, 'src', {
    set(value: string) {
      (this as unknown as { _src: string })._src = value;
      // Fire after handlers are attached (next microtask is too late for sync
      // tests, so fire synchronously).
      if (autoLoad) {
        (this as unknown as MockImage).onload?.();
      } else {
        (this as unknown as MockImage).onerror?.();
      }
    },
    get() {
      return (this as unknown as { _src: string })._src;
    },
    configurable: true,
  });

  return {
    instances,
    restore() {
      Object.defineProperty(global, 'Image', {
        value: OriginalImage,
        writable: true,
        configurable: true,
      });
    },
  };
}

describe('SpriteLoader', () => {
  it('load() resolves to HTMLImageElement on success', async () => {
    const m = mockImage(true);
    const loader = new SpriteLoader();
    const img = await loader.load('building', 'house');
    expect(img).toBeInstanceOf(global.Image);
    expect((img as MockImage).src).toBe('/assets/sprites/building/house.png');
    m.restore();
  });

  it('load() resolves to null on failure (404/missing)', async () => {
    const m = mockImage(false);
    const loader = new SpriteLoader();
    const img = await loader.load('building', 'nonexistent');
    expect(img).toBeNull();
    m.restore();
  });

  it('get() returns cached sprite synchronously after load', async () => {
    const m = mockImage(true);
    const loader = new SpriteLoader();
    await loader.load('citizen', '#1565c0');
    const cached = loader.get('citizen', '#1565c0');
    expect(cached).toBeInstanceOf(global.Image);
    m.restore();
  });

  it('get() returns null if not loaded or failed', () => {
    const m = mockImage(true);
    const loader = new SpriteLoader();
    expect(loader.get('building', 'never-loaded')).toBeNull();
    m.restore();
  });

  it('does not re-fetch a cached failure (no second Image created)', async () => {
    const m = mockImage(false);
    const loader = new SpriteLoader();
    await loader.load('building', 'missing');
    const countAfterFirst = m.instances.length;
    // Second load should return cached null without creating a new Image.
    const result = await loader.load('building', 'missing');
    expect(result).toBeNull();
    expect(m.instances.length).toBe(countAfterFirst);
    m.restore();
  });

  it('does not re-fetch a cached success', async () => {
    const m = mockImage(true);
    const loader = new SpriteLoader();
    await loader.load('building', 'house');
    const countAfterFirst = m.instances.length;
    await loader.load('building', 'house');
    expect(m.instances.length).toBe(countAfterFirst);
    m.restore();
  });

  it('is SSR-safe: returns null when Image is undefined', async () => {
    const OriginalImage = global.Image;
    // Simulate Node SSR: no Image constructor.
    Object.defineProperty(global, 'Image', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const loader = new SpriteLoader();
    const img = await loader.load('building', 'house');
    expect(img).toBeNull();
    expect(loader.get('building', 'house')).toBeNull();
    // Restore for other tests.
    Object.defineProperty(global, 'Image', {
      value: OriginalImage,
      writable: true,
      configurable: true,
    });
  });

  it('clear() empties the cache', async () => {
    const m = mockImage(true);
    const loader = new SpriteLoader();
    await loader.load('building', 'house');
    expect(loader.get('building', 'house')).not.toBeNull();
    loader.clear();
    expect(loader.get('building', 'house')).toBeNull();
    m.restore();
  });

  it('preload() loads multiple sprites', async () => {
    const m = mockImage(true);
    const loader = new SpriteLoader();
    await loader.preload([
      { category: 'building', name: 'house' },
      { category: 'building', name: 'shop' },
    ]);
    expect(loader.get('building', 'house')).not.toBeNull();
    expect(loader.get('building', 'shop')).not.toBeNull();
    m.restore();
  });
});
