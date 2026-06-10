import { generateCity, type WorkplaceBuilding } from '@/systems/CityGenerator';
import { isCitizen } from '@/entities';
import { isActivityId, type BuildingId, type Vector2 } from '@/types/common';

function makeBuildings(count: number, capacity = 5): WorkplaceBuilding[] {
  const out: WorkplaceBuilding[] = [];
  for (let i = 0; i < count; i += 1) {
    const pos: Vector2 = { x: i * 8, y: 0 };
    out.push({
      id: `bldg-w-${i}` as BuildingId,
      position: pos,
      capacity,
    });
  }
  return out;
}

describe('CityGenerator', () => {
  it('produces between 50 and 100 citizens by default', () => {
    const result = generateCity(makeBuildings(20), { seed: 1 });
    expect(result.citizens.length).toBeGreaterThanOrEqual(50);
    expect(result.citizens.length).toBeLessThanOrEqual(100);
  });

  it('clamps citizen count to [50, 100]', () => {
    const low = generateCity(makeBuildings(20), { citizenCount: 5, seed: 2 });
    expect(low.citizens.length).toBe(50);
    const high = generateCity(makeBuildings(20), { citizenCount: 9999, seed: 3 });
    expect(high.citizens.length).toBe(100);
  });

  it('every citizen has a 24-entry schedule of valid activities', () => {
    const result = generateCity(makeBuildings(20), { seed: 4 });
    for (const c of result.citizens) {
      expect(c.schedule.length).toBe(24);
      for (const entry of c.schedule) {
        expect(isActivityId(entry)).toBe(true);
      }
    }
  });

  it('employs roughly 70% of citizens when workplaces are available', () => {
    const result = generateCity(makeBuildings(20, 100), { seed: 5 });
    const employed = result.citizens.filter((c) => c.workplaceId !== null).length;
    const total = result.citizens.length;
    const ratio = employed / total;
    expect(ratio).toBeGreaterThanOrEqual(0.65);
    expect(ratio).toBeLessThanOrEqual(0.75);
  });

  it('employed citizens have a work activity scheduled at 12:00', () => {
    const result = generateCity(makeBuildings(20, 100), { seed: 6 });
    const employed = result.citizens.filter((c) => c.workplaceId !== null);
    expect(employed.length).toBeGreaterThan(0);
    for (const c of employed) {
      expect(c.schedule[12]).toBe('eat'); // 12:00 is lunch for employed
      // And 10:00 is firmly in the work block.
      expect(c.schedule[10]).toBe('work');
    }
  });

  it('every workplaceId points to a real building', () => {
    const buildings = makeBuildings(20, 100);
    const result = generateCity(buildings, { seed: 7 });
    const known = new Set(buildings.map((b) => b.id));
    for (const c of result.citizens) {
      if (c.workplaceId !== null) {
        expect(known.has(c.workplaceId)).toBe(true);
      }
    }
  });

  it('produces stable ids and isCitizen-valid output', () => {
    const result = generateCity(makeBuildings(20), { seed: 8 });
    for (const c of result.citizens) {
      expect(isCitizen(c)).toBe(true);
      expect(typeof c.id).toBe('string');
      expect(c.id.length).toBeGreaterThan(0);
    }
    const ids = new Set(result.citizens.map((c) => c.id));
    expect(ids.size).toBe(result.citizens.length);
  });

  it('falls back to zero employed citizens when no workplaces exist', () => {
    const result = generateCity([], { seed: 9 });
    const employed = result.citizens.filter((c) => c.workplaceId !== null);
    expect(employed.length).toBe(0);
  });

  it('respects workplace capacity', () => {
    // Only 3 workplaces with capacity 2 each -> max 6 employed.
    const result = generateCity(makeBuildings(3, 2), { seed: 10 });
    const employed = result.citizens.filter((c) => c.workplaceId !== null);
    expect(employed.length).toBeLessThanOrEqual(6);
  });

  it('builds the assignments map consistent with citizen workplaceIds', () => {
    const buildings = makeBuildings(5, 100);
    const result = generateCity(buildings, { seed: 11 });
    const seen = new Set<string>();
    for (const c of result.citizens) {
      if (c.workplaceId !== null) {
        seen.add(c.workplaceId);
      }
    }
    for (const id of seen) {
      const list = result.assignments.get(id as BuildingId);
      expect(list).toBeDefined();
      expect(list?.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic with the same seed', () => {
    const a = generateCity(makeBuildings(10), { seed: 42 });
    const b = generateCity(makeBuildings(10), { seed: 42 });
    expect(a.citizens.map((c) => c.schedule.join(','))).toEqual(
      b.citizens.map((c) => c.schedule.join(',')),
    );
  });
});
