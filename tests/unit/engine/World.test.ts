import { World } from '@/engine/World';
import type { Building, Citizen, BuildingDef } from '@/engine/types';

function makeBuilding(overrides: Partial<Building> = {}): Building {
  return {
    id: overrides.id ?? 'b1',
    defId: overrides.defId ?? 'def-office',
    origin: overrides.origin ?? { x: 0, y: 0 },
    size: overrides.size ?? { width: 1, height: 1 },
    employees: overrides.employees ?? [],
    treasury: overrides.treasury ?? 0,
  };
}

function makeCitizen(overrides: Partial<Citizen> = {}): Citizen {
  return {
    id: overrides.id ?? 'c1',
    name: overrides.name ?? 'Alex',
    homeId: overrides.homeId ?? null,
    workId: overrides.workId ?? null,
    position: overrides.position ?? { x: 0, y: 0 },
    velocity: overrides.velocity ?? { x: 0, y: 0 },
    state: overrides.state ?? 'idle',
    hunger: overrides.hunger ?? 1,
    energy: overrides.energy ?? 1,
    fun: overrides.fun ?? 1,
  };
}

function makeDef(overrides: Partial<BuildingDef> = {}): BuildingDef {
  return {
    id: overrides.id ?? 'def-office',
    name: overrides.name ?? 'Office',
    type: overrides.type ?? 'office',
    color: overrides.color ?? '#3aa0ff',
    revenue: overrides.revenue ?? 100,
    maxEmployees: overrides.maxEmployees ?? 10,
    openHour: overrides.openHour ?? 9,
    closeHour: overrides.closeHour ?? 17,
    size: overrides.size ?? { width: 1, height: 1 },
  };
}

describe('World', () => {
  it('initialises with a default ground tile grid', () => {
    const w = new World({ width: 10, height: 5 });
    expect(w.bounds).toEqual({ width: 10, height: 5 });
    for (const t of w.tiles_()) {
      expect(t.kind).toBe('ground');
      expect(t.elevation).toBe(0);
    }
  });

  it('rejects non-positive bounds', () => {
    expect(() => new World({ width: 0, height: 5 })).toThrow(RangeError);
    expect(() => new World({ width: 5, height: -1 })).toThrow(RangeError);
    expect(() => new World({ width: 1.5, height: 5 })).toThrow(RangeError);
  });

  it('inBounds / getTile / setTile round-trip', () => {
    const w = new World({ width: 4, height: 4 });
    expect(w.inBounds({ x: 0, y: 0 })).toBe(true);
    expect(w.inBounds({ x: 3, y: 3 })).toBe(true);
    expect(w.inBounds({ x: 4, y: 0 })).toBe(false);
    expect(w.inBounds({ x: -1, y: 0 })).toBe(false);
    expect(w.inBounds({ x: 1.5, y: 0 })).toBe(false);

    const tile = w.getTile({ x: 1, y: 2 });
    expect(tile).not.toBeNull();
    expect(tile!.coord).toEqual({ x: 1, y: 2 });
    expect(tile!.kind).toBe('ground');

    expect(w.setTile({ x: 1, y: 2 }, 'road', 1)).toBe(true);
    const updated = w.getTile({ x: 1, y: 2 });
    expect(updated!.kind).toBe('road');
    expect(updated!.elevation).toBe(1);
  });

  it('setTile / getTile return false / null for out-of-bounds', () => {
    const w = new World({ width: 4, height: 4 });
    expect(w.setTile({ x: -1, y: 0 }, 'road')).toBe(false);
    expect(w.setTile({ x: 4, y: 0 }, 'road')).toBe(false);
    expect(w.getTile({ x: 0, y: -1 })).toBeNull();
    expect(w.getTile({ x: 0, y: 4 })).toBeNull();
  });

  it('addBuilding / getBuilding / getBuildingAt round-trip', () => {
    const w = new World({ width: 10, height: 10 });
    const b = makeBuilding({ id: 'b1', origin: { x: 2, y: 3 } });
    expect(w.addBuilding(b)).toBe(true);
    expect(w.getBuilding('b1')).toEqual(b);
    expect(w.getBuildingAt({ x: 2, y: 3 })).toEqual(b);
    expect(w.buildingCount).toBe(1);
  });

  it('addBuilding rejects duplicate id', () => {
    const w = new World({ width: 10, height: 10 });
    expect(w.addBuilding(makeBuilding({ id: 'b1' }))).toBe(true);
    expect(w.addBuilding(makeBuilding({ id: 'b1' }))).toBe(false);
  });

  it('addBuilding rejects out-of-bounds origin', () => {
    const w = new World({ width: 10, height: 10 });
    expect(w.addBuilding(makeBuilding({ origin: { x: -1, y: 0 } }))).toBe(false);
    expect(w.addBuilding(makeBuilding({ origin: { x: 10, y: 0 } }))).toBe(false);
  });

  it('addBuilding rejects footprints that do not fit', () => {
    const w = new World({ width: 10, height: 10 });
    expect(
      w.addBuilding(makeBuilding({ id: 'big', size: { width: 5, height: 5 }, origin: { x: 8, y: 8 } })),
    ).toBe(false);
  });

  it('addBuilding rejects overlapping footprints', () => {
    const w = new World({ width: 10, height: 10 });
    expect(
      w.addBuilding(makeBuilding({ id: 'a', size: { width: 2, height: 2 }, origin: { x: 0, y: 0 } })),
    ).toBe(true);
    // Overlapping footprint at (1,1) within the 2x2 block above must be rejected.
    expect(
      w.addBuilding(makeBuilding({ id: 'b', origin: { x: 1, y: 1 } })),
    ).toBe(false);
    // A non-overlapping placement should succeed.
    expect(
      w.addBuilding(makeBuilding({ id: 'c', origin: { x: 5, y: 5 } })),
    ).toBe(true);
    expect(w.buildingCount).toBe(2);
  });

  it('removeBuilding clears the spatial index', () => {
    const w = new World({ width: 10, height: 10 });
    const b = makeBuilding({ id: 'b1', origin: { x: 2, y: 3 } });
    w.addBuilding(b);
    expect(w.removeBuilding('b1')).toBe(true);
    expect(w.getBuildingAt({ x: 2, y: 3 })).toBeNull();
    // After removal, the slot is free for a new placement.
    expect(w.addBuilding(makeBuilding({ id: 'b2', origin: { x: 2, y: 3 } }))).toBe(true);
  });

  it('addCitizen / removeCitizen / getCitizen round-trip', () => {
    const w = new World({ width: 10, height: 10 });
    const c = makeCitizen({ id: 'c1' });
    expect(w.addCitizen(c)).toBe(true);
    expect(w.addCitizen(c)).toBe(false);
    expect(w.getCitizen('c1')).toEqual(c);
    expect(w.citizenCount).toBe(1);
    expect(w.removeCitizen('c1')).toBe(true);
    expect(w.getCitizen('c1')).toBeNull();
  });

  it('registers and retrieves building defs', () => {
    const w = new World({ width: 10, height: 10 });
    const def = makeDef({ id: 'def-1' });
    w.registerBuildingDef(def);
    expect(w.getBuildingDef('def-1')).toEqual(def);
    expect(w.getBuildingDef('nope')).toBeNull();
  });
});
