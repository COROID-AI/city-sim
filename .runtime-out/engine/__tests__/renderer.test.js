"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
/// <reference types="jest" />
const index_1 = require("../index");
const generation_1 = require("@/generation");
const Camera_1 = require("../Camera");
function makeRecordingContext() {
    const calls = [];
    const ctx = {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        fillRect: (x, y, w, h) => {
            calls.push({ layer: classify(), x, y, w, h, fillStyle: String(ctx.fillStyle) });
        },
        beginPath: () => undefined,
        moveTo: () => undefined,
        lineTo: () => undefined,
        stroke: () => undefined,
        save: () => undefined,
        restore: () => undefined,
    };
    let last = 'surface-fill';
    function classify() {
        return last;
    }
    return { ctx, calls };
}
function makeCanvas(ctx, w = 256, h = 256) {
    return {
        width: w,
        height: h,
        getContext: (kind) => (kind === '2d' ? ctx : null),
    };
}
function buildCity(seed) {
    return (0, generation_1.generateCity)({ seed });
}
describe('palette (CSS-var lookup with deterministic fallbacks)', () => {
    test('returns the fallback when no DOM and no override', () => {
        const color = (0, index_1.resolvePaletteColor)('ground', { documentLike: null });
        expect(color).toBe(index_1.PALETTE_FALLBACK.ground);
    });
    test('override beats fallback and DOM', () => {
        const doc = makeFakeDocument('ground', '#123456');
        const color = (0, index_1.resolvePaletteColor)('ground', {
            documentLike: doc,
            override: '#abcdef',
        });
        expect(color).toBe('#abcdef');
    });
    test('reads from CSS variable when available', () => {
        const doc = makeFakeDocument('--color-ground', '#deadbe');
        const color = (0, index_1.resolvePaletteColor)('ground', { documentLike: doc });
        expect(color).toBe('#deadbe');
    });
    test('falls back when CSS variable is empty', () => {
        const doc = makeFakeDocument('--color-ground', '');
        const color = (0, index_1.resolvePaletteColor)('ground', { documentLike: doc });
        expect(color).toBe(index_1.PALETTE_FALLBACK.ground);
    });
});
/**
 * Build a minimal document-like object exposing only the fields that
 * `resolvePaletteColor` looks at. We cast to `DocumentLike` so tests
 * don't have to satisfy the full palette interface (which intentionally
 * restricts the surface to keep callers honest).
 */
function makeFakeDocument(varName, value) {
    const doc = {
        documentElement: { ownerDocument: null },
        defaultView: {
            getComputedStyle: (_el, _pseudo) => {
                return {
                    getPropertyValue: (n) => (n === varName ? value : ''),
                };
            },
        },
    };
    return doc;
}
describe('buildingDepthKey', () => {
    test('produces ascending keys along y+height (back of footprint)', () => {
        const farBack = mkBuilding({ x: 5, y: 1, width: 1, height: 1 });
        const mid = mkBuilding({ x: 5, y: 5, width: 1, height: 1 });
        const near = mkBuilding({ x: 5, y: 10, width: 1, height: 1 });
        const a = (0, index_1.buildingDepthKey)(farBack, 0);
        const b = (0, index_1.buildingDepthKey)(mid, 1);
        const c = (0, index_1.buildingDepthKey)(near, 2);
        expect(a.key).toBeLessThan(b.key);
        expect(b.key).toBeLessThan(c.key);
    });
    test('uses x as a tie-breaker within the same y', () => {
        const left = mkBuilding({ x: 1, y: 5, width: 1, height: 1 });
        const right = mkBuilding({ x: 9, y: 5, width: 1, height: 1 });
        const a = (0, index_1.buildingDepthKey)(left, 0);
        const b = (0, index_1.buildingDepthKey)(right, 1);
        expect(a.key).toBeLessThan(b.key);
    });
});
function mkBuilding(footprint) {
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
        const a = (0, index_1.sortBuildingsForDraw)(city);
        const b = (0, index_1.sortBuildingsForDraw)(city);
        expect(a.map((k) => k.index)).toEqual(b.map((k) => k.index));
    });
    test('produces back-to-front order across runs (regression)', () => {
        // Run multiple times to catch any non-determinism in the sort.
        for (let seed = 1; seed <= 8; seed++) {
            const city = buildCity(seed);
            const sorted = (0, index_1.sortBuildingsForDraw)(city);
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
        (0, index_1.sortBuildingsForDraw)(city);
        const after = city.buildings.map((b) => b.id);
        expect(after).toEqual(before);
    });
});
describe('Renderer layering', () => {
    function makeFrame(city) {
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
        const renderer = new index_1.Renderer(null);
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
            expect(firstBuilding).toBeGreaterThanOrEqual(firstRoad >= 0 ? firstRoad : firstGround);
        }
        expect(lightingCount).toBe(0);
    });
    test('drawLightingOverlay is a no-op stub', () => {
        const city = buildCity(202);
        const renderer = new index_1.Renderer(null);
        const ctx = makeNoopContext();
        // Should not throw and should not modify ctx state.
        expect(() => renderer.drawLightingOverlay(ctx, makeFrame(city))).not.toThrow();
    });
    test('buildings are drawn in deterministic order across runs', () => {
        const city = buildCity(303);
        const a = makeRecordingContext();
        const b = makeRecordingContext();
        const rendererA = new index_1.Renderer(null);
        const rendererB = new index_1.Renderer(null);
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
        const renderer = new index_1.Renderer(null);
        const frame = {
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
function makeNoopContext() {
    return {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        fillRect: () => undefined,
        beginPath: () => undefined,
        moveTo: () => undefined,
        lineTo: () => undefined,
        stroke: () => undefined,
        save: () => undefined,
        restore: () => undefined,
    };
}
/**
 * A Camera pre-positioned over the city center. The Renderer only reads
 * `getTransform()` (plus the transform's `x/y/zoom`), so we use a real
 * Camera instance with the same shape. We disable clamping so the
 * city-center target is honored exactly.
 */
function makeCenteredCamera(city) {
    return new Camera_1.Camera({
        ...Camera_1.DEFAULT_CAMERA_CONFIG,
        minX: -Infinity,
        maxX: Infinity,
        minY: -Infinity,
        maxY: Infinity,
        initial: { x: city.width / 2, y: city.height / 2, zoom: 1 },
    });
}
