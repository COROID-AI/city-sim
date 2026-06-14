import { World } from '@/engine/World';
import { computeZoneLayout, type Zone } from '@/generation/zones';
import { createRng } from '@/generation/random';
import { NameGenerator } from '@/generation/NameGenerator';
import { BuildingPlacer } from '@/generation/BuildingPlacer';

function setup(bounds: { width: number; height: number }) {
  const world = new World(bounds);
  const rng = createRng(1);
  const names = new NameGenerator(rng);
  const zones = computeZoneLayout(bounds);
  return { world, rng, names, zones };
}

describe('BuildingPlacer', () => {
  it('places at least one building in every non-park zone for 80x80', () => {
    const { world, rng, names, zones } = setup({ width: 80, height: 80 });
    const placer = new BuildingPlacer(world, rng, names);
    const placed = placer.placeInZones(zones, { density: 1 });
    const seenKinds = new Set(placed.map((b) => {
      const zone = zones.find((z) =>
        b.origin.x >= z.origin.x && b.origin.x <= z.end.x &&
        b.origin.y >= z.origin.y && b.origin.y <= z.end.y,
      );
      return zone?.kind ?? 'unknown';
    }));
    for (const kind of ['residential', 'commercial', 'industrial', 'entertainment'] as const) {
      expect(seenKinds.has(kind)).toBe(true);
    }
  });

  it('places zero buildings in the park zone', () => {
    const { world, rng, names, zones } = setup({ width: 80, height: 80 });
    const placer = new BuildingPlacer(world, rng, names);
    placer.placeInZones(zones, { density: 1 });
    const park = zones.find((z): z is Zone => z.kind === 'park')!;
    for (let y = park.origin.y; y <= park.end.y; y++) {
      for (let x = park.origin.x; x <= park.end.x; x++) {
        expect(world.getBuildingAt({ x, y })).toBeNull();
      }
    }
  });

  it('produces no overlapping building origins', () => {
    const { world, rng, names, zones } = setup({ width: 80, height: 80 });
    const placer = new BuildingPlacer(world, rng, names);
    const placed = placer.placeInZones(zones, { density: 1 });
    const seen = new Set<string>();
    for (const b of placed) {
      const key = `${b.origin.x},${b.origin.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    // The World's overlap check should agree.
    expect(world.buildingCount).toBe(placed.length);
  });

  it('keeps every building footprint within its zone rect', () => {
    const { world, rng, names, zones } = setup({ width: 80, height: 80 });
    const placer = new BuildingPlacer(world, rng, names);
    const placed = placer.placeInZones(zones, { density: 1 });
    for (const b of placed) {
      const zone = zones.find((z) =>
        b.origin.x >= z.origin.x &&
        b.origin.x + b.size.width - 1 <= z.end.x &&
        b.origin.y >= z.origin.y &&
        b.origin.y + b.size.height - 1 <= z.end.y,
      );
      expect(zone).toBeDefined();
      expect(zone!.kind).not.toBe('park');
    }
  });

  it('keeps every building footprint within world bounds', () => {
    const { world, rng, names, zones } = setup({ width: 80, height: 80 });
    const placer = new BuildingPlacer(world, rng, names);
    const placed = placer.placeInZones(zones, { density: 1 });
    for (const b of placed) {
      expect(b.origin.x).toBeGreaterThanOrEqual(0);
      expect(b.origin.y).toBeGreaterThanOrEqual(0);
      expect(b.origin.x + b.size.width).toBeLessThanOrEqual(80);
      expect(b.origin.y + b.size.height).toBeLessThanOrEqual(80);
    }
  });

  it('honours the density parameter (density 0 places nothing)', () => {
    const { world, rng, names, zones } = setup({ width: 80, height: 80 });
    const placer = new BuildingPlacer(world, rng, names);
    const placed = placer.placeInZones(zones, { density: 0 });
    expect(placed).toHaveLength(0);
    expect(world.buildingCount).toBe(0);
  });

  it('is deterministic for a given seed and density', () => {
    const a = setup({ width: 80, height: 80 });
    const b = setup({ width: 80, height: 80 });
    const aPlacer = new BuildingPlacer(a.world, a.rng, a.names);
    const bPlacer = new BuildingPlacer(b.world, b.rng, b.names);
    const aPlaced = aPlacer.placeInZones(a.zones, { density: 0.7 });
    const bPlaced = bPlacer.placeInZones(b.zones, { density: 0.7 });
    expect(aPlaced.map((x) => x.id)).toEqual(bPlaced.map((x) => x.id));
    expect(aPlaced).toHaveLength(bPlaced.length);
  });
});
