import { CityGenerator, readCityBenchmark, generateCity } from '@/generation/CityGenerator';

describe('CityGenerator', () => {
  it('returns a World with bounds 80x80 for the default size', () => {
    const result = new CityGenerator().generate({ seed: 42 });
    expect(result.world.bounds).toEqual({ width: 80, height: 80 });
    expect(result.bounds).toEqual({ width: 80, height: 80 });
  });

  it('emits all five required zone kinds', () => {
    const result = new CityGenerator().generate({ seed: 42 });
    const kinds = new Set(result.zoneKinds);
    for (const k of ['residential', 'commercial', 'industrial', 'entertainment', 'park'] as const) {
      expect(kinds.has(k)).toBe(true);
    }
  });

  it('places non-overlapping building origins', () => {
    const result = new CityGenerator().generate({ seed: 42, density: 1 });
    const seen = new Set<string>();
    for (const b of result.buildings) {
      const key = `${b.origin.x},${b.origin.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    // World agrees with our return value.
    expect(result.world.buildingCount).toBe(result.buildings.length);
  });

  it('keeps every building footprint inside its zone rect', () => {
    const result = new CityGenerator().generate({ seed: 42, density: 1 });
    for (const b of result.buildings) {
      const inside = result.zones.find((z) =>
        b.origin.x >= z.origin.x &&
        b.origin.x + b.size.width - 1 <= z.end.x &&
        b.origin.y >= z.origin.y &&
        b.origin.y + b.size.height - 1 <= z.end.y,
      );
      expect(inside).toBeDefined();
      expect(inside!.kind).not.toBe('park');
    }
  });

  it('paints road tiles along zone borders', () => {
    const result = new CityGenerator().generate({ seed: 42 });
    for (const zone of result.zones) {
      // Check a sample border cell on each edge of the zone.
      const samples: { x: number; y: number }[] = [
        { x: zone.origin.x, y: Math.floor((zone.origin.y + zone.end.y) / 2) },
        { x: zone.end.x, y: Math.floor((zone.origin.y + zone.end.y) / 2) },
        { x: Math.floor((zone.origin.x + zone.end.x) / 2), y: zone.origin.y },
        { x: Math.floor((zone.origin.x + zone.end.x) / 2), y: zone.end.y },
      ];
      for (const s of samples) {
        const t = result.world.getTile(s);
        // Border cells may be inside a neighbouring zone, so we check the
        // immediate outer row/column instead. We pick a 2-tile border so
        // one tile out from the perimeter must be a road.
        const outer: { x: number; y: number } = s.x === zone.origin.x
          ? { x: s.x - 1, y: s.y }
          : s.x === zone.end.x
            ? { x: s.x + 1, y: s.y }
            : s.y === zone.origin.y
              ? { x: s.x, y: s.y - 1 }
              : { x: s.x, y: s.y + 1 };
        const tOuter = result.world.getTile(outer);
        // The outer cell must be a road (or out of bounds, e.g. world edge).
        if (tOuter) {
          expect(tOuter.kind).toBe('road');
        } else {
          // We made it to the world edge; that's still a valid paint.
          expect(t).not.toBeNull();
        }
      }
    }
  });

  it('places no buildings inside the park zone', () => {
    const result = new CityGenerator().generate({ seed: 42, density: 1 });
    const park = result.zones.find((z) => z.kind === 'park')!;
    for (let y = park.origin.y; y <= park.end.y; y++) {
      for (let x = park.origin.x; x <= park.end.x; x++) {
        expect(result.world.getBuildingAt({ x, y })).toBeNull();
      }
    }
  });

  it('exposes __CITY_BENCHMARK__ on window with the required shape', () => {
    new CityGenerator().generate({ seed: 7 });
    const bench = readCityBenchmark();
    expect(bench).not.toBeNull();
    expect(bench!.tiles).toBe(80 * 80);
    expect(typeof bench!.buildings).toBe('number');
    expect(bench!.zones).toBe(5);
    expect(typeof bench!.roads).toBe('number');
    expect(bench!.citizens).toBe(0);
    expect(bench!.seed).toBe(7);
    expect(typeof bench!.generatedAtMs).toBe('number');
    expect(bench!.bounds).toEqual({ width: 80, height: 80 });
  });

  it('is deterministic across runs with the same seed', () => {
    const a = new CityGenerator().generate({ seed: 1234 });
    const b = new CityGenerator().generate({ seed: 1234 });
    expect(a.buildings).toHaveLength(b.buildings.length);
    expect(a.buildings.map((x) => x.id)).toEqual(b.buildings.map((x) => x.id));
    expect(a.world.buildingCount).toBe(b.world.buildingCount);
  });

  it('produces a render-ready world: every tile referenced by a building exists and is in-bounds', () => {
    const result = new CityGenerator().generate({ seed: 99, density: 1 });
    for (const b of result.buildings) {
      for (let dy = 0; dy < b.size.height; dy++) {
        for (let dx = 0; dx < b.size.width; dx++) {
          const x = b.origin.x + dx;
          const y = b.origin.y + dy;
          expect(result.world.inBounds({ x, y })).toBe(true);
          expect(result.world.getTile({ x, y })).not.toBeNull();
        }
      }
    }
  });

  it('roads connect adjacent zones via shared borders', () => {
    const result = new CityGenerator().generate({ seed: 11 });
    // Build a spatial index of road tiles by (x, y) using the World, which
    // is the source of truth.
    const roadTiles = new Set<string>();
    for (const tile of result.world.tiles_()) {
      if (tile.kind === 'road') roadTiles.add(`${tile.coord.x},${tile.coord.y}`);
    }
    const colSplit = Math.floor(80 / 2);
    // The central vertical road is the 2-tile gap between top-band
    // residential (right edge at colSplit - 2) and commercial (left edge
    // at colSplit + 2). It must be present above the park zone.
    const park = result.zones.find((z) => z.kind === 'park')!;
    for (let y = 2; y < park.origin.y; y++) {
      expect(roadTiles.has(`${colSplit},${y}`)).toBe(true);
      expect(roadTiles.has(`${colSplit + 1},${y}`)).toBe(true);
    }
    // And below the park zone.
    for (let y = park.end.y + 1; y < 80 - 2; y++) {
      expect(roadTiles.has(`${colSplit},${y}`)).toBe(true);
      expect(roadTiles.has(`${colSplit + 1},${y}`)).toBe(true);
    }
  });

  it('generateCity() convenience wrapper matches CityGenerator output shape', () => {
    const result = generateCity(5);
    expect(result.bounds).toEqual({ width: 80, height: 80 });
    expect(result.seed).toBe(5);
    expect(result.zones).toHaveLength(5);
  });

  it('rejects non-positive world dimensions', () => {
    const gen = new CityGenerator();
    expect(() => gen.generate({ seed: 1, width: 0, height: 80 })).toThrow(RangeError);
    expect(() => gen.generate({ seed: 1, width: 80, height: -1 })).toThrow(RangeError);
  });
});
