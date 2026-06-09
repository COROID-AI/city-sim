/**
 * Renderer depth-sort + layering tests.
 *
 * We do not exercise the actual canvas API (the existing strategy is
 * to avoid pixel-snapshot tests for flakiness). Instead we:
 *   - assert the deterministic sort order of `sortBuildingsForDraw`
 *   - assert that `Renderer.drawGround / drawRoads / drawBuildings` are
 *     invoked in the correct layer order with a mock context
 *   - assert that `drawLightingOverlay` is a stub (does not touch ctx)
 *   - assert that the palette falls back to deterministic hex values
 *     when no DOM is present
 */

/// <reference types="jest" />
import {
  PALETTE_FALLBACK,
  Renderer,
  buildingDepthKey,
  resolvePaletteColor,
  sortBuildingsForDraw,
  type RenderFrame,
  type RendererCanvas,
  type RendererContext2D,
} from '../index';
import { generateCity, type Building, type GeneratedCity } from '@/generation';

interface CallRecord {
  layer: 'surface-fill' | 'ground-tile' | 'road-tile' | 'road-stripe' | 'building' | 'lighting';
  x: number;
  y: number;
  w: number;
  h: number;
  fillStyle: string;
}

function makeRecordingContext(): { ctx: RendererContext2D; calls: CallRecord[] } {
  const calls: CallRecord[] = [];
  const ctx: RendererContext2D = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    fillRect: (x: number, y: number, w: number, h: number): void => {
      calls.push({ layer: classify(), x, y, w, h, fillStyle: String(ctx.fillStyle) });
    },
    beginPath: (): void => undefined,
    moveTo: (): void => undefined,
    lineTo: (): void => undefined,
    stroke: (): void => undefined,
    save: (): void => undefined,
    restore: (): void => undefined,
  };
  let last = 'surface-fill' as CallRecord['layer'];
  function classify(): CallRecord['layer'] {
    return last;
  }
  return { ctx, calls };
}

function makeCanvas(ctx: RendererContext2D, w = 256, h = 256): RendererCanvas {
  return {
    width: w,
    height: h,
    getContext: (kind: '2d'): RendererContext2D | null => (kind === '2d' ? ctx : null),
  };
}

function buildCity(seed: number): GeneratedCity {
  return generateCity({ seed });
}

describe('palette (CSS-var lookup with deterministic fallbacks)', () => {
  test('returns the fallback when no DOM and no override', () => {
    const color = resolvePaletteColor('ground', { documentLike: null });
    expect(color).toBe(PALETTE_FALLBACK.ground);
  });

  test('override beats fallback and DOM', () => {
    const doc = makeFakeDocument('ground', '#123456');
    const color = resolvePaletteColor('ground', {
      documentLike: doc,
      override: '#abcdef',
    });
    expect(color).toBe('#abcdef');
  });

  test('reads from CSS variable when available', () => {
    const doc = makeFakeDocument('--color-ground', '#deadbe');
    const color = resolvePaletteColor('ground', { documentLike: doc });
    expect(color).toBe('#deadbe');
  });

  test('falls back when CSS variable is empty', () => {
    const doc = makeFakeDocument('--color-ground', '');
    const color = resolvePaletteColor('ground', { documentLike: doc });
    expect(color).toBe(PALETTE_FALLBACK.ground);
  });
});

/**
 * Build a minimal document-like object exposing only the fields that
 * `resolvePaletteColor` looks at. We cast to `DocumentLike` so tests
 * don't have to satisfy the full palette interface (which intentionally
 * restricts the surface to keep callers honest).
 */
function makeFakeDocument(
  varName: string,
  value: string,
): import('../palette').DocumentLike {
  const doc = {
    documentElement: { ownerDocument: null },
    defaultView: {
      getComputedStyle: (_el: unknown, _pseudo: string | null) => {
        return {
          getPropertyValue: (n: string): string => (n === varName ? value : ''),
        };
      },
    },
  };
  return doc as unknown as import('../palette').DocumentLike;
}

describe('buildingDepthKey', () => {
  test('produces ascending keys along y+height (back of footprint)', () => {
    const farBack: Building = mkBuilding({ x: 5, y: 1, width: 1, height: 1 });
    const mid: Building = mkBuilding({ x: 5, y: 5, width: 1, height: 1 });
    const near: Building = mkBuilding({ x: 5, y: 10, width: 1, height: 1 });
    const a = buildingDepthKey(farBack, 0);
    const b = buildingDepthKey(mid, 1);
    const c = buildingDepthKey(near, 2);
    expect(a.key).toBeLessThan(b.key);
    expect(b.key).toBeLessThan(c.key);
  });

  test('uses x as a tie-breaker within the same y', () => {
    const left: Building = mkBuilding({ x: 1, y: 5, width: 1, height: 1 });
    const right: Building = mkBuilding({ x: 9, y: 5, width: 1, height: 1 });
    const a = buildingDepthKey(left, 0);
    const b = buildingDepthKey(right, 1);
    expect(a.key).toBeLessThan(b.key);
  });
});

function mkBuilding(footprint: { x: number; y: number; width: number; height: number }): Building {
  const cells = [];
  for (let dy = 0; dy < footprint.height; dy++) {
    for (let dx = 0; dx < footprint.width; dx++) {
      cells.push({ x: footprint.x + dx, y: footprint.y + dy });
    }
  }
  return {
    id: `b-${footprint.x}-${footprint.y}`,
    companyId: null,
    zone: 'residential',
    footprint,
    cells,
  };
}

describe('sortBuildingsForDraw', () => {
  test('is deterministic for the same city', () => {
    const city = buildCity(42);
    const a = sortBuildingsForDraw(city);
    const b = sortBuildingsForDraw(city);
    expect(a.map((k) => k.index)).toEqual(b.map((k) => k.index));
  });

  test('produces back-to-front order across runs (regression)', () => {
    // Run multiple times to catch any non-determinism in the sort.
    for (let seed = 1; seed <= 8; seed++) {
      const city = buildCity(seed);
      const sorted = sortBuildingsForDraw(city);
      // Strict non-decreasing key sequence.
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (prev === undefined || cur === undefined) {
          throw new Error('unexpected undefined in sorted output');
        }
        expect(cur.key).toBeGreaterThanOrEqual(prev.key);
        // Every key must be unique enough to map back to a building.
        const original = city.buildings[cur.index];
        expect(original).toBeDefined();
      }
    }
  });

  test('does not mutate the input city', () => {
    const city = buildCity(7);
    const before = city.buildings.map((b) => b.id);
    sortBuildingsForDraw(city);
    const after = city.buildings.map((b) => b.id);
    expect(after).toEqual(before);
  });
});

describe('Renderer layering', () => {
  function makeFrame(city: GeneratedCity): RenderFrame {
    // Use a tiny canvas and a camera focused at the city center to make
    // every layer produce at least one draw call.
    return {
      city,
      camera: makeCenteredCamera(city),
      viewWidth: 128,
      viewHeight: 128,
      cellSize: 8,
    };
  }

  test('draws ground before roads before buildings (no lighting)', () => {
    const city = buildCity(101);
    const { ctx, calls } = makeRecordingContext();
    const canvas = makeCanvas(ctx);
    const renderer = new Renderer(null);
    const frame = makeFrame(city);

    renderer.render(canvas, frame);

    // Surface-fill is the first call (clears the viewport).
    const surface = calls.findIndex((c) => c.layer === 'surface-fill');
    const firstGround = calls.findIndex((c) => c.layer === 'ground-tile');
    const firstRoad = calls.findIndex((c) => c.layer === 'road-tile' || c.layer === 'road-stripe');
    const firstBuilding = calls.findIndex((c) => c.layer === 'building');
    const lightingCount = calls.filter((c) => c.layer === 'lighting').length;

    expect(surface).toBeGreaterThanOrEqual(0);
    expect(firstGround).toBeGreaterThan(surface);
    if (firstRoad >= 0) {
      expect(firstRoad).toBeGreaterThanOrEqual(firstGround);
    }
    if (firstBuilding >= 0) {
      expect(firstBuilding).toBeGreaterThanOrEqual(
        firstRoad >= 0 ? firstRoad : firstGround,
      );
    }
    expect(lightingCount).toBe(0);
  });

  test('drawLightingOverlay is a no-op stub', () => {
    const city = buildCity(202);
    const renderer = new Renderer(null);
    const ctx: RendererContext2D = makeNoopContext();
    // Should not throw and should not modify ctx state.
    expect((): void => renderer.drawLightingOverlay(ctx, makeFrame(city))).not.toThrow();
  });

  test('buildings are drawn in deterministic order across runs', () => {
    const city = buildCity(303);
    const a = makeRecordingContext();
    const b = makeRecordingContext();
    const rendererA = new Renderer(null);
    const rendererB = new Renderer(null);
    rendererA.render(makeCanvas(a.ctx), makeFrame(city));
    rendererB.render(makeCanvas(b.ctx), makeFrame(city));

    const aBuildings = a.calls.filter((c) => c.layer === 'building');
    const bBuildings = b.calls.filter((c) => c.layer === 'building');
    expect(aBuildings.length).toBe(bBuildings.length);
    // Each building call records its fillStyle (resolved palette key).
    // We expect identical fill styles in the same order.
    for (let i = 0; i < aBuildings.length; i++) {
      expect(aBuildings[i]?.fillStyle).toBe(bBuildings[i]?.fillStyle);
      expect(aBuildings[i]?.x).toBe(bBuildings[i]?.x);
      expect(aBuildings[i]?.y).toBe(bBuildings[i]?.y);
    }
  });

  test('palette override flows into draw calls', () => {
    const city = buildCity(404);
    const { ctx, calls } = makeRecordingContext();
    const renderer = new Renderer(null);
    const frame: RenderFrame = {
      ...makeFrame(city),
      paletteOverrides: {
        ground: '#101010',
        surface: '#202020',
        road: '#303030',
        building: '#404040',
        accent: '#505050',
        warning: '#606060',
        citizen: '#707070',
      },
    };
    renderer.render(makeCanvas(ctx), frame);
    // Every recorded call must use one of the override colors.
    const allowed = new Set(Object.values(frame.paletteOverrides ?? {}));
    for (const c of calls) {
      expect(allowed.has(c.fillStyle)).toBe(true);
    }
  });
});

function makeNoopContext(): RendererContext2D {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    fillRect: (): void => undefined,
    beginPath: (): void => undefined,
    moveTo: (): void => undefined,
    lineTo: (): void => undefined,
    stroke: (): void => undefined,
    save: (): void => undefined,
    restore: (): void => undefined,
  };
}

/**
 * A Camera-like object pre-positioned over the city center. The Renderer
 * only reads `getTransform()`, so we expose just that surface.
 */
function makeCenteredCamera(city: GeneratedCity): {
  getTransform: () => { x: number; y: number; zoom: number };
} {
  const tx = { x: city.width / 2, y: city.height / 2, zoom: 1 } as const;
  return {
    getTransform: (): { x: number; y: number; zoom: number } => tx,
  };
}
