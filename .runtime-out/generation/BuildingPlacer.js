"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildingPlacer = void 0;
/**
 * Lays down non-overlapping building plots in a deterministic order.
 *
 * Algorithm:
 *   1. For each zone, iterate its pre-computed plot rectangles.
 *   2. For each plot, walk the cells in scan order and try to fit
 *      a 2x2 (or 3x3 for industrial) building footprint that is
 *      fully inside the plot, on non-road cells, outside the
 *      setback mask, and disjoint from previously placed buildings.
 *   3. Record each successful placement.
 */
class BuildingPlacer {
    constructor(opts) {
        this.nextBuildingId = 0;
        this.opts = opts;
        this.occupied = new Uint8Array(opts.width * opts.height);
    }
    /**
     * Run placement. Returns all building plots placed across all
     * zones, in stable order. Buildings are sorted by (y, x) of their
     * top-left cell for renderer-friendly iteration.
     */
    place() {
        const out = [];
        // Deterministic zone order.
        const order = [
            'civic',
            'commercial',
            'residential',
            'industrial',
            'park',
        ];
        for (const zone of order) {
            const plots = this.opts.plotsByZone.get(zone);
            if (plots === undefined)
                continue;
            for (const rect of plots) {
                this.fillPlot(zone, rect, out);
            }
        }
        out.sort((a, b) => {
            if (a.footprint.y !== b.footprint.y)
                return a.footprint.y - b.footprint.y;
            if (a.footprint.x !== b.footprint.x)
                return a.footprint.x - b.footprint.x;
            return a.id.localeCompare(b.id);
        });
        return out;
    }
    fillPlot(zone, plot, out) {
        // Industrial gets 3x3 candidates, others 2x2. As a last resort we
        // try 1x1 to guarantee that even tiny zones (e.g. the central
        // 3x3 civic plaza) yield at least one building per plot, which
        // keeps the "every company has a building in its allowed zone"
        // invariant satisfiable for every zone.
        const minSize = 1;
        const maxSize = zone === 'industrial' ? 3 : 2;
        for (let y = plot.y; y < plot.y + plot.height; y += 1) {
            for (let x = plot.x; x < plot.x + plot.width; x += 1) {
                // Try the largest possible footprint first, then fall back.
                for (let size = maxSize; size >= minSize; size--) {
                    if (this.tryPlace(x, y, size, zone, out)) {
                        break; // placed; move to next anchor
                    }
                }
            }
        }
    }
    tryPlace(x, y, size, zone, out) {
        const { width: gw, height: gh, roads, zones, setbackMask } = this.opts;
        if (x + size > gw || y + size > gh)
            return false;
        if (x < 0 || y < 0)
            return false;
        // Validate every cell in the footprint.
        for (let yy = y; yy < y + size; yy++) {
            for (let xx = x; xx < x + size; xx++) {
                if (roads.get(xx, yy) !== 'none')
                    return false;
                if (setbackMask.get(xx, yy))
                    return false;
                if (zones.get(xx, yy) !== zone)
                    return false;
                if (this.occupied[yy * gw + xx] !== 0)
                    return false;
            }
        }
        // Commit placement.
        const cells = [];
        for (let yy = y; yy < y + size; yy++) {
            for (let xx = x; xx < x + size; xx++) {
                this.occupied[yy * gw + xx] = 1;
                cells.push({ x: xx, y: yy });
            }
        }
        const id = `b${this.nextBuildingId.toString().padStart(4, '0')}`;
        this.nextBuildingId++;
        out.push({
            id,
            companyId: null,
            zone,
            footprint: { x, y, width: size, height: size },
            cells,
        });
        return true;
    }
}
exports.BuildingPlacer = BuildingPlacer;
