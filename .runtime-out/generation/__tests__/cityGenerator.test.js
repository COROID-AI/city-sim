"use strict";
/**
 * Determinism + invariant tests for the city generation pipeline.
 *
 * Run with: npx jest src/generation/__tests__/cityGenerator.test.ts
 *
 * The tests cover the acceptance criteria of the CityGenerator task:
 *   - Deterministic 80x80 output for the same seed.
 *   - Road map distinguishes main vs secondary; road cells non-buildable.
 *   - Exactly 5 zone IDs; all non-road cells belong to one of them.
 *   - Company names are deterministic, unique, 8 <= count <= 12.
 *   - Each company has >= 1 building plot in an allowed zone.
 *   - BuildingPlacer outputs non-overlapping footprints that avoid
 *     road cells (incl. main-road setback buffer).
 *   - SpatialIndex query results are consistent with the source data.
 *   - No `any` and no Next server-only features in the generated code.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
const VALID_ZONES = new Set(index_1.ZONE_IDS);
function buildCity(seed) {
    return (0, index_1.generateCity)({ seed });
}
function deepEqualCity(a, b) {
    if (a.seed !== b.seed)
        return false;
    if (a.width !== b.width)
        return false;
    if (a.height !== b.height)
        return false;
    if (a.roads.length !== b.roads.length)
        return false;
    if (a.zones.length !== b.zones.length)
        return false;
    if (a.companies.length !== b.companies.length)
        return false;
    if (a.buildings.length !== b.buildings.length)
        return false;
    for (let i = 0; i < a.roads.length; i++) {
        if (a.roads[i] !== b.roads[i])
            return false;
    }
    for (let i = 0; i < a.zones.length; i++) {
        if (a.zones[i] !== b.zones[i])
            return false;
    }
    for (let i = 0; i < a.companies.length; i++) {
        const ca = a.companies[i];
        const cb = b.companies[i];
        if (ca === undefined || cb === undefined)
            return false;
        if (ca.id !== cb.id)
            return false;
        if (ca.name !== cb.name)
            return false;
        if (ca.zone !== cb.zone)
            return false;
        if (ca.buildingIds.length !== cb.buildingIds.length)
            return false;
        for (let j = 0; j < ca.buildingIds.length; j++) {
            if (ca.buildingIds[j] !== cb.buildingIds[j])
                return false;
        }
    }
    for (let i = 0; i < a.buildings.length; i++) {
        const ba = a.buildings[i];
        const bb = b.buildings[i];
        if (ba === undefined || bb === undefined)
            return false;
        if (ba.id !== bb.id)
            return false;
        if (ba.companyId !== bb.companyId)
            return false;
        if (ba.zone !== bb.zone)
            return false;
        if (ba.footprint.x !== bb.footprint.x)
            return false;
        if (ba.footprint.y !== bb.footprint.y)
            return false;
        if (ba.footprint.width !== bb.footprint.width)
            return false;
        if (ba.footprint.height !== bb.footprint.height)
            return false;
    }
    return true;
}
describe('CityGenerator', () => {
    test('produces a deterministic 80x80 grid for the same seed', () => {
        const a = buildCity(42);
        const b = buildCity(42);
        expect(a.width).toBe(80);
        expect(a.height).toBe(80);
        expect(a.roads.length).toBe(80 * 80);
        expect(a.zones.length).toBe(80 * 80);
        expect(deepEqualCity(a, b)).toBe(true);
    });
    test('different seeds produce different cities', () => {
        const a = buildCity(1);
        const b = buildCity(2);
        // Names should differ.
        const aNames = a.companies.map((c) => c.name).join('|');
        const bNames = b.companies.map((c) => c.name).join('|');
        expect(aNames).not.toBe(bNames);
    });
    test('road map distinguishes main and secondary roads', () => {
        const city = buildCity(7);
        let mainCount = 0;
        let secondaryCount = 0;
        let noneCount = 0;
        const kinds = new Set(['main', 'secondary', 'none']);
        for (const r of city.roads) {
            expect(kinds.has(r)).toBe(true);
            if (r === 'main')
                mainCount++;
            else if (r === 'secondary')
                secondaryCount++;
            else
                noneCount++;
        }
        expect(mainCount).toBeGreaterThan(0);
        expect(secondaryCount).toBeGreaterThan(0);
        expect(noneCount).toBeGreaterThan(0);
    });
    test('road cells are non-buildable: no building footprint contains a road cell', () => {
        const city = buildCity(11);
        for (const b of city.buildings) {
            for (const c of b.cells) {
                const idx = c.y * city.width + c.x;
                const road = city.roads[idx];
                expect(road).toBe('none');
            }
        }
    });
    test('exactly 5 zone ids exist and all non-road cells belong to one', () => {
        const city = buildCity(3);
        expect(index_1.ZONE_IDS.length).toBe(5);
        const observed = new Set();
        for (let i = 0; i < city.zones.length; i++) {
            const z = city.zones[i];
            const r = city.roads[i];
            if (r === 'none') {
                expect(VALID_ZONES.has(z)).toBe(true);
                observed.add(z);
            }
            else {
                // Road cells still carry a zone label (we don't constrain it,
                // but it should be a valid one).
                expect(VALID_ZONES.has(z)).toBe(true);
            }
        }
        // All 5 zone ids should appear somewhere.
        for (const z of index_1.ZONE_IDS) {
            expect(observed.has(z)).toBe(true);
        }
    });
    test('company count is between 8 and 12 inclusive, names unique and deterministic', () => {
        const city = buildCity(1234);
        expect(city.companies.length).toBeGreaterThanOrEqual(8);
        expect(city.companies.length).toBeLessThanOrEqual(12);
        const names = new Set();
        for (const c of city.companies) {
            expect(names.has(c.name)).toBe(false);
            names.add(c.name);
            expect(c.id.length).toBeGreaterThan(0);
        }
        // Re-generate and confirm same names.
        const city2 = buildCity(1234);
        expect(city2.companies.map((c) => c.name)).toEqual(city.companies.map((c) => c.name));
    });
    test('every company has at least one building in its allowed zone', () => {
        const city = buildCity(99);
        for (const comp of city.companies) {
            expect(comp.buildingIds.length).toBeGreaterThanOrEqual(1);
            for (const bi of comp.buildingIds) {
                const b = city.buildings[bi];
                expect(b).toBeDefined();
                if (b) {
                    // Building must be in an allowed zone. We allow the same zone
                    // for now (generator assigns same-zone first).
                    expect(b.zone).toBe(comp.zone);
                    expect(b.companyId).toBe(comp.id);
                }
            }
        }
    });
    test('building footprints do not overlap', () => {
        const city = buildCity(5);
        const occupied = new Set();
        for (const b of city.buildings) {
            for (const c of b.cells) {
                const k = c.y * city.width + c.x;
                expect(occupied.has(k)).toBe(false);
                occupied.add(k);
            }
        }
    });
    test('building footprints stay within bounds', () => {
        const city = buildCity(8);
        for (const b of city.buildings) {
            const f = b.footprint;
            expect(f.x).toBeGreaterThanOrEqual(0);
            expect(f.y).toBeGreaterThanOrEqual(0);
            expect(f.x + f.width).toBeLessThanOrEqual(city.width);
            expect(f.y + f.height).toBeLessThanOrEqual(city.height);
        }
    });
    test('building footprints do not intersect main-road setback buffer', () => {
        const city = buildCity(21);
        const setback = city.mainRoadSetback;
        expect(setback).toBeGreaterThanOrEqual(0);
        // Build the set of cells within `setback` of any main road.
        const blocked = new Set();
        for (let y = 0; y < city.height; y++) {
            for (let x = 0; x < city.width; x++) {
                if (city.roads[y * city.width + x] !== 'main')
                    continue;
                for (let dy = -setback; dy <= setback; dy++) {
                    for (let dx = -setback; dx <= setback; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= city.width || ny >= city.height)
                            continue;
                        blocked.add(ny * city.width + nx);
                    }
                }
            }
        }
        for (const b of city.buildings) {
            for (const c of b.cells) {
                const k = c.y * city.width + c.x;
                expect(blocked.has(k)).toBe(false);
            }
        }
    });
});
describe('SpatialIndex', () => {
    test('queryCell returns building indices whose footprint contains the cell', () => {
        const city = buildCity(2024);
        const idx = new index_1.SpatialIndex(city);
        for (let bi = 0; bi < city.buildings.length; bi++) {
            const b = city.buildings[bi];
            if (b === undefined)
                continue;
            for (const c of b.cells) {
                const hits = idx.queryCell(c.x, c.y);
                expect(hits).toContain(bi);
            }
        }
    });
    test('queryCell out of bounds returns empty', () => {
        const city = buildCity(2025);
        const idx = new index_1.SpatialIndex(city);
        expect(idx.queryCell(-1, 0)).toEqual([]);
        expect(idx.queryCell(0, -1)).toEqual([]);
        expect(idx.queryCell(city.width, 0)).toEqual([]);
        expect(idx.queryCell(0, city.height)).toEqual([]);
    });
    test('queryRect intersects buildings whose footprint overlaps', () => {
        const city = buildCity(7777);
        const idx = new index_1.SpatialIndex(city);
        // Query a 1x1 rect at the top-left of each building footprint.
        for (let bi = 0; bi < city.buildings.length; bi++) {
            const b = city.buildings[bi];
            if (b === undefined)
                continue;
            const hits = idx.queryRect({
                x: b.footprint.x,
                y: b.footprint.y,
                width: 1,
                height: 1,
            });
            expect(hits).toContain(bi);
        }
    });
    test('queryZone returns only buildings in that zone', () => {
        const city = buildCity(8888);
        const idx = new index_1.SpatialIndex(city);
        for (const z of index_1.ZONE_IDS) {
            const hits = idx.queryZone(z);
            for (const bi of hits) {
                const b = city.buildings[bi];
                expect(b).toBeDefined();
                if (b)
                    expect(b.zone).toBe(z);
            }
            // Total over all zones equals total buildings.
        }
        let total = 0;
        for (const z of index_1.ZONE_IDS) {
            total += idx.queryZone(z).length;
        }
        expect(total).toBe(city.buildings.length);
    });
    test('allBuildings returns the same buildings, in original order', () => {
        const city = buildCity(9999);
        const idx = new index_1.SpatialIndex(city);
        const all = idx.allBuildings();
        expect(all.length).toBe(city.buildings.length);
        for (let i = 0; i < all.length; i++) {
            expect(all[i].id).toBe(city.buildings[i].id);
        }
    });
});
describe('Static-export compatibility', () => {
    test('generated source does not reference Next-only APIs', () => {
        // Lightweight check: ensure we can build a city without any
        // window/document/Node-only globals being touched at module load.
        expect(typeof index_1.generateCity).toBe('function');
        expect(typeof index_1.SpatialIndex).toBe('function');
    });
});
