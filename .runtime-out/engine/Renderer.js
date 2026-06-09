"use strict";
/**
 * Renderer — layered draw for the city view.
 *
 * Layer order (back to front, painter's algorithm):
 *   1. drawGround          — base tile for every cell
 *   2. drawRoads           — main + secondary road overlay
 *   3. drawBuildings       — depth-sorted building footprints
 *   4. drawLightingOverlay — stub; populated by the time/lighting task
 *
 * Determinism:
 *   - Draw order is fully determined by `(cityData, camera)` snapshots.
 *   - Building depth key = `footprint.y + footprint.height` (the "back"
 *     of the footprint in world space) with `footprint.x` as a stable
 *     tie-breaker. Sorting by ascending key gives a back-to-front
 *     painter's order without floating-point or pseudo-random sources.
 *
 * Palette:
 *   - Colors come from the shared palette (see `palette.ts`). They are
 *     resolved lazily so node tests get deterministic fallbacks.
 *
 * Canvas strategy:
 *   - The renderer takes a 2D context + dimensions in world units. The
 *     caller is responsible for sizing the underlying `<canvas>` and
 *     applying the camera transform. This keeps the renderer pure and
 *     trivially testable without a real DOM.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PALETTE_FALLBACK = exports.Renderer = void 0;
exports.buildingDepthKey = buildingDepthKey;
exports.sortBuildingsForDraw = sortBuildingsForDraw;
const palette_1 = require("./palette");
Object.defineProperty(exports, "PALETTE_FALLBACK", { enumerable: true, get: function () { return palette_1.PALETTE_FALLBACK; } });
/**
 * Compute a deterministic depth-sort key for a single building.
 *
 * Exported so the renderer and the tests can share the exact same rule.
 */
function buildingDepthKey(building, index) {
    const f = building.footprint;
    // y + height is the back-row of the footprint in world space. Tie-break
    // by x so the order is stable across runs (no JS engine sort quirks).
    const y = f.y * 100000 + f.x;
    return { index, key: y, building };
}
/**
 * Sort buildings back-to-front for painter's-algorithm drawing.
 *
 * The returned array is a fresh array; the input is not mutated. The
 * sort is stable (Array.prototype.sort is stable in ES2019+).
 */
function sortBuildingsForDraw(city) {
    const out = new Array(city.buildings.length);
    for (let i = 0; i < city.buildings.length; i++) {
        const b = city.buildings[i];
        if (b === undefined)
            continue;
        out[i] = buildingDepthKey(b, i);
    }
    return out.sort((a, b) => a.key - b.key);
}
const ROAD_LANE_WIDTH = 0.7; // fraction of cell width painted as road
/**
 * Color tint per zone. The renderer maps a zone to a single base color
 * (from the palette or an override) and draws a building footprint in
 * that color. This is intentionally simple; the citizen/lighting tasks
 * will add per-building variation later.
 */
const ZONE_BASE_COLOR = Object.freeze({
    residential: 'building',
    commercial: 'accent',
    industrial: 'warning',
    civic: 'accent',
    park: 'ground',
});
/** Pick the palette key for a building's zone. */
function zonePaletteKey(zone) {
    return ZONE_BASE_COLOR[zone];
}
/** Read a color, applying per-frame overrides and falling back to CSS vars. */
function colorFor(key, frame, documentLike) {
    const override = frame.paletteOverrides?.[key];
    return (0, palette_1.resolvePaletteColor)(key, { override, documentLike });
}
/**
 * The Renderer encapsulates the layered draw. It is stateless: each
 * `render(frame)` call consumes the inputs and produces a frame of
 * pixels. There is no internal buffer; downstream code can choose to
 * use one canvas or several stacked canvases.
 */
class Renderer {
    /**
     * @param documentLike Optional injected document for CSS-variable
     *   resolution. Defaults to the global `document` when available.
     *   Tests pass `null` to force the deterministic fallbacks.
     */
    constructor(documentLike = defaultDocument()) {
        this.documentLike = documentLike;
    }
    /**
     * Draw a single frame. Calls each layer in order. The caller is
     * expected to have already cleared/resized the canvas.
     */
    render(canvas, frame) {
        const ctx = canvas.getContext('2d');
        if (ctx === null) {
            // No 2D context available (e.g. SSR or unsupported env). Nothing
            // to draw. We intentionally do not throw: rendering should be
            // best-effort and not crash the simulation.
            return;
        }
        this.drawGround(ctx, frame);
        this.drawRoads(ctx, frame);
        this.drawBuildings(ctx, frame);
        this.drawLightingOverlay(ctx, frame);
    }
    /** Layer 1: base ground tile for every cell in the city. */
    drawGround(ctx, frame) {
        const { city, viewWidth, viewHeight, camera } = frame;
        const cellSize = frame.cellSize ?? 16;
        const t = camera.getTransform();
        const groundColor = colorFor('ground', frame, this.documentLike);
        const surfaceColor = colorFor('surface', frame, this.documentLike);
        // Fill the entire viewport with the surface first; this avoids
        // showing through outside the city bounds.
        ctx.fillStyle = surfaceColor;
        ctx.fillRect(0, 0, viewWidth, viewHeight);
        // Determine the visible world rectangle (clipped to city bounds).
        const visible = visibleWorldRect(city, t, viewWidth, viewHeight, cellSize);
        ctx.fillStyle = groundColor;
        for (let y = visible.minY; y <= visible.maxY; y++) {
            for (let x = visible.minX; x <= visible.maxX; x++) {
                const r = worldToScreenRect(x, y, t, viewWidth, viewHeight, cellSize);
                if (r.w <= 0 || r.h <= 0)
                    continue;
                ctx.fillRect(r.x, r.y, r.w, r.h);
            }
        }
    }
    /** Layer 2: paint road cells on top of the ground. */
    drawRoads(ctx, frame) {
        const { city, viewWidth, viewHeight, camera } = frame;
        const cellSize = frame.cellSize ?? 16;
        const t = camera.getTransform();
        const roadColor = colorFor('road', frame, this.documentLike);
        const accentColor = colorFor('accent', frame, this.documentLike);
        const visible = visibleWorldRect(city, t, viewWidth, viewHeight, cellSize);
        ctx.fillStyle = roadColor;
        for (let y = visible.minY; y <= visible.maxY; y++) {
            for (let x = visible.minX; x <= visible.maxX; x++) {
                const kind = city.roads[y * city.width + x] ?? 'none';
                if (kind === 'none')
                    continue;
                const r = worldToScreenRect(x, y, t, viewWidth, viewHeight, cellSize);
                if (r.w <= 0 || r.h <= 0)
                    continue;
                ctx.fillRect(r.x, r.y, r.w, r.h);
                if (kind === 'main') {
                    // Main road gets a thin accent stripe down its center for
                    // visual hierarchy.
                    ctx.fillStyle = accentColor;
                    const stripe = Math.max(1, Math.floor(r.w * 0.08));
                    ctx.fillRect(r.x + Math.floor((r.w - stripe) / 2), r.y, stripe, r.h);
                    ctx.fillStyle = roadColor;
                }
            }
        }
    }
    /**
     * Layer 3: depth-sorted building footprints.
     *
     * Each footprint is drawn as a filled rect spanning its cells. A
     * tiny inset is applied so adjacent buildings read as distinct.
     * Painter's algorithm: back-to-front by (y + height, x).
     */
    drawBuildings(ctx, frame) {
        const { city, viewWidth, viewHeight, camera } = frame;
        const cellSize = frame.cellSize ?? 16;
        const t = camera.getTransform();
        const visible = visibleWorldRect(city, t, viewWidth, viewHeight, cellSize);
        const ordered = sortBuildingsForDraw(city);
        for (const item of ordered) {
            const b = item.building;
            const f = b.footprint;
            // Skip buildings outside the visible rect.
            if (f.x + f.width < visible.minX)
                continue;
            if (f.x > visible.maxX)
                continue;
            if (f.y + f.height < visible.minY)
                continue;
            if (f.y > visible.maxY)
                continue;
            const r = worldToScreenRect(f.x, f.y, t, viewWidth, viewHeight, cellSize);
            const wCells = f.width * cellSize * t.zoom;
            const hCells = f.height * cellSize * t.zoom;
            if (wCells <= 0 || hCells <= 0)
                continue;
            const key = zonePaletteKey(b.zone);
            ctx.fillStyle = colorFor(key, frame, this.documentLike);
            // Inset by 1px to separate adjacent buildings.
            const inset = Math.min(1, Math.floor(Math.min(wCells, hCells) * 0.05));
            ctx.fillRect(r.x + inset, r.y + inset, wCells - inset * 2, hCells - inset * 2);
        }
    }
    /**
     * Layer 4: lighting overlay stub.
     *
     * Intentionally a no-op for this phase. The time/lighting task will
     * fill this in with day/night tinting.
     */
    drawLightingOverlay(_ctx, _frame) {
        // No-op until the lighting system ships.
    }
}
exports.Renderer = Renderer;
/** Project the top-left of a world cell to screen space (px). */
function worldToScreenRect(wx, wy, camera, viewWidth, viewHeight, cellSize) {
    const halfW = viewWidth / 2;
    const halfH = viewHeight / 2;
    const px = halfW + (wx - camera.x) * cellSize * camera.zoom;
    const py = halfH + (wy - camera.y) * cellSize * camera.zoom;
    return {
        x: Math.floor(px),
        y: Math.floor(py),
        w: Math.max(1, Math.floor(cellSize * camera.zoom)),
        h: Math.max(1, Math.floor(cellSize * camera.zoom)),
    };
}
/** World-space rectangle currently visible on screen (clipped to city). */
function visibleWorldRect(city, camera, viewWidth, viewHeight, cellSize) {
    const halfW = viewWidth / 2;
    const halfH = viewHeight / 2;
    const cellsAcrossX = Math.ceil(halfW / Math.max(0.0001, cellSize * camera.zoom)) + 1;
    const cellsAcrossY = Math.ceil(halfH / Math.max(0.0001, cellSize * camera.zoom)) + 1;
    const minX = Math.max(0, Math.floor(camera.x - cellsAcrossX));
    const minY = Math.max(0, Math.floor(camera.y - cellsAcrossY));
    const maxX = Math.min(city.width - 1, Math.ceil(camera.x + cellsAcrossX));
    const maxY = Math.min(city.height - 1, Math.ceil(camera.y + cellsAcrossY));
    return { minX, minY, maxX, maxY };
}
function defaultDocument() {
    const g = globalThis;
    return g.document ?? null;
}
