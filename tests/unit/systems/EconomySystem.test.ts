/**
 * Unit tests for src/systems/EconomySystem.ts.
 *
 * Verifies per-day accounting (revenue, wages, tax, infra), the
 * treasury floor semantics, the idempotent day-rollover, the
 * open/close event emission, and the EventBus integration via the
 * `recordArrival` / `recordTrafficJam` hooks.
 *
 * Tests use a tiny in-memory world stub that satisfies
 * `EconomySystemWorldView` — no engine runtime import.
 */

import { EventBus } from '@/systems/EventBus';
import {
  EconomySystem,
  INFRA_DAILY_COST,
  TAX_RATE,
  WAGE_PER_EMPLOYEE,
  isOpen,
  type EconomySystemWorldView,
} from '@/systems/EconomySystem';
import type { SimEventMap } from '@/systems/SimEvents';
import { BUILDING_DEFS } from '@/constants/building-types';
import type { Building, BuildingDef } from '@/engine/types';

class StubWorld implements EconomySystemWorldView {
  private readonly buildings: Building[] = [];
  private readonly defs = new Map<string, BuildingDef>();
  constructor(seedDefs: readonly BuildingDef[] = BUILDING_DEFS) {
    for (const d of seedDefs) this.defs.set(d.id, d);
  }
  addBuilding(b: Building): void {
    this.buildings.push(b);
  }
  setDef(id: string, def: BuildingDef): void {
    this.defs.set(id, def);
  }
  *buildings_(): IterableIterator<Building> {
    for (const b of this.buildings) yield b;
  }
  getBuildingDef(id: string): BuildingDef | null {
    return this.defs.get(id) ?? null;
  }
}

function makeBuilding(defId: string, employees: readonly string[] = [], treasury = 0): Building {
  return {
    id: `b-${defId}-${employees.length}-${treasury}`,
    defId,
    origin: { x: 0, y: 0 },
    size: { width: 1, height: 1 },
    employees,
    treasury,
  };
}

describe('EconomySystem constants', () => {
  it('exposes the documented tunables', () => {
    expect(TAX_RATE).toBeGreaterThan(0);
    expect(INFRA_DAILY_COST).toBeGreaterThan(0);
    expect(WAGE_PER_EMPLOYEE).toBeGreaterThan(0);
  });
});

describe('isOpen', () => {
  it('handles the daytime window', () => {
    const def: BuildingDef = {
      id: 'd1', name: 'D1', type: 'shop', color: '#000',
      revenue: 100, maxEmployees: 5, openHour: 9, closeHour: 17,
      size: { width: 1, height: 1 },
    };
    expect(isOpen(def, 8.5)).toBe(false);
    expect(isOpen(def, 9)).toBe(true);
    expect(isOpen(def, 12)).toBe(true);
    expect(isOpen(def, 16.99)).toBe(true);
    expect(isOpen(def, 17)).toBe(false);
  });

  it('handles the overnight wrap window (close < open)', () => {
    const def: BuildingDef = {
      id: 'd1', name: 'Night', type: 'restaurant', color: '#000',
      revenue: 200, maxEmployees: 10, openHour: 17, closeHour: 2,
      size: { width: 1, height: 1 },
    };
    expect(isOpen(def, 1.5)).toBe(true);
    expect(isOpen(def, 2)).toBe(false);
    expect(isOpen(def, 16.99)).toBe(false);
    expect(isOpen(def, 17)).toBe(true);
    expect(isOpen(def, 23)).toBe(true);
  });

  it('handles 24h operation (0..24)', () => {
    const def: BuildingDef = {
      id: 'd1', name: '24h', type: 'hospital', color: '#000',
      revenue: 100, maxEmployees: 5, openHour: 0, closeHour: 24,
      size: { width: 1, height: 1 },
    };
    expect(isOpen(def, 0)).toBe(true);
    expect(isOpen(def, 12)).toBe(true);
    expect(isOpen(def, 23.99)).toBe(true);
  });

  it('returns false for out-of-range hours or invalid def hours', () => {
    const def: BuildingDef = {
      id: 'd1', name: 'X', type: 'shop', color: '#000',
      revenue: 100, maxEmployees: 5, openHour: 9, closeHour: 17,
      size: { width: 1, height: 1 },
    };
    expect(isOpen(def, NaN)).toBe(false);
    expect(isOpen(def, Number.POSITIVE_INFINITY)).toBe(false);
    const bad: BuildingDef = { ...def, openHour: -1 };
    expect(isOpen(bad, 12)).toBe(false);
  });

  it('returns false when openHour == closeHour', () => {
    const def: BuildingDef = {
      id: 'd1', name: 'X', type: 'shop', color: '#000',
      revenue: 100, maxEmployees: 5, openHour: 12, closeHour: 12,
      size: { width: 1, height: 1 },
    };
    expect(isOpen(def, 12)).toBe(false);
  });

  it('normalises out-of-range hour input via modulo', () => {
    const def: BuildingDef = {
      id: 'd1', name: 'X', type: 'shop', color: '#000',
      revenue: 100, maxEmployees: 5, openHour: 9, closeHour: 17,
      size: { width: 1, height: 1 },
    };
    expect(isOpen(def, 25)).toBe(isOpen(def, 1));
    expect(isOpen(def, 48)).toBe(isOpen(def, 0));
  });
});

describe('EconomySystem constructor', () => {
  it('rejects missing bus or world', () => {
    const bus = new EventBus<SimEventMap>();
    // @ts-expect-error testing runtime guard
    expect(() => new EconomySystem(null, new StubWorld())).toThrow(TypeError);
    // @ts-expect-error testing runtime guard
    expect(() => new EconomySystem(bus, null)).toThrow(TypeError);
  });

  it('rejects negative tunables', () => {
    const bus = new EventBus<SimEventMap>();
    const world = new StubWorld();
    expect(() => new EconomySystem(bus, world, { taxRate: -0.1 })).toThrow(RangeError);
    expect(() => new EconomySystem(bus, world, { infraDailyCost: -1 })).toThrow(RangeError);
    expect(() => new EconomySystem(bus, world, { wagePerEmployee: -5 })).toThrow(RangeError);
  });
});

describe('EconomySystem.onNewDay accounting', () => {
  it('credits revenue and pays wages, taxes, infrastructure for a day', () => {
    const bus = new EventBus<SimEventMap>();
    const world = new StubWorld();
    const shop = makeBuilding('def-shop', ['c1', 'c2'], 0);
    world.addBuilding(shop);
    const sys = new EconomySystem(bus, world, { initialTreasury: 0 });

    const treasury = sys.onNewDay(1, 9);
    expect(treasury).not.toBeNull();
    // Per-day math:
    //  revenue = 320 * min(1, 2/6) = 320 * 1/3 ≈ 106.666...
    //  tax     = 0.1 * 106.666...   ≈ 10.666...
    //  wages   = 35 * 2 = 70 (paid by the building treasury, not the city)
    //  infra   = 100
    //  net     = tax - infra ≈ -89.33
    const revenue = (320 * 2) / 6;
    const expectedTax = TAX_RATE * revenue;
    const expectedNet = expectedTax - INFRA_DAILY_COST;
    expect(sys.getTreasury()).toBeCloseTo(expectedNet, 4);
    // Building treasury loses wages:
    expect(shop.treasury).toBeCloseTo(revenue - WAGE_PER_EMPLOYEE * 2, 4);
  });

  it('emits a new_day event with the post-accounting treasury', () => {
    const bus = new EventBus<SimEventMap>();
    const world = new StubWorld();
    const sys = new EconomySystem(bus, world, { initialTreasury: 500 });
    const seen: Array<SimEventMap['new_day']> = [];
    bus.on('new_day', (p) => seen.push(p));
    sys.onNewDay(1, 8);
    expect(seen.length).toBe(1);
    expect(seen[0]?.day).toBe(1);
    expect(seen[0]?.hour).toBe(8);
    // Treasury == 500 + taxRevenue (0) - INFRA_DAILY_COST (100) = 400.
    expect(seen[0]?.treasury).toBe(400);
  });

  it('is idempotent for the same day — no double credit on re-tick', () => {
    const bus = new EventBus<SimEventMap>();
    const world = new StubWorld();
    const sys = new EconomySystem(bus, world, { initialTreasury: 0 });
    const first = sys.onNewDay(2, 10);
    const second = sys.onNewDay(2, 11);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    // Treasury only debited once.
    expect(sys.getTreasury()).toBe(-INFRA_DAILY_COST);
  });

  it('accrues treasury floor for an empty city (no buildings)', () => {
    const bus = new EventBus<SimEventMap>();
    const world = new StubWorld([]);
    const sys = new EconomySystem(bus, world, { initialTreasury: 0 });
    sys.onNewDay(1, 0);
    // No revenue → no tax → treasury only loses infra cost.
    expect(sys.getTreasury()).toBe(-INFRA_DAILY_COST);
  });

  it('rejects invalid day values', () => {
    const bus = new EventBus<SimEventMap>();
    const world = new StubWorld();
    const sys = new EconomySystem(bus, world);
    expect(() => sys.onNewDay(0, 0)).toThrow(RangeError);
    expect(() => sys.onNewDay(1.5, 0)).toThrow(RangeError);
    expect(() => sys.onNewDay(-3, 0)).toThrow(RangeError);
  });
});

describe('EconomySystem.open/close events', () => {
  it('emits company_open on closed→open and company_close on open→closed', () => {
    const bus = new EventBus<SimEventMap>();
    const world = new StubWorld();
    const shop = makeBuilding('def-shop');
    world.addBuilding(shop);
    const sys = new EconomySystem(bus, world);
    const openEvents: SimEventMap['company_open'][] = [];
    const closeEvents: SimEventMap['company_close'][] = [];
    bus.on('company_open', (p) => openEvents.push(p));
    bus.on('company_close', (p) => closeEvents.push(p));

    // Shop opens at 9, closes at 21.
    sys.updateOpenClose(1, 8);
    expect(openEvents.length).toBe(0);
    sys.updateOpenClose(1, 10);
    expect(openEvents.length).toBe(1);
    expect(openEvents[0]?.name).toBe('Shop');
    sys.updateOpenClose(1, 20);
    expect(closeEvents.length).toBe(0);
    sys.updateOpenClose(1, 22);
    expect(closeEvents.length).toBe(1);
  });

  it('does not re-fire open while the building is still open', () => {
    const bus = new EventBus<SimEventMap>();
    const world = new StubWorld();
    world.addBuilding(makeBuilding('def-shop'));
    const sys = new EconomySystem(bus, world);
    const seen: SimEventMap['company_open'][] = [];
    bus.on('company_open', (p) => seen.push(p));
    sys.updateOpenClose(1, 10);
    sys.updateOpenClose(1, 11);
    sys.updateOpenClose(1, 12);
    expect(seen.length).toBe(1);
  });
});

describe('EconomySystem recordArrival / recordTrafficJam', () => {
  it('recordArrival publishes the arrival event', () => {
    const bus = new EventBus<SimEventMap>();
    const world = new StubWorld();
    const sys = new EconomySystem(bus, world);
    const seen: SimEventMap['arrival'][] = [];
    bus.on('arrival', (p) => seen.push(p));
    sys.recordArrival({ citizenId: 'c1', buildingId: 'b1', kind: 'work' });
    expect(seen).toEqual([{ citizenId: 'c1', buildingId: 'b1', kind: 'work' }]);
  });

  it('recordTrafficJam publishes the traffic_jam event', () => {
    const bus = new EventBus<SimEventMap>();
    const world = new StubWorld();
    const sys = new EconomySystem(bus, world);
    const seen: SimEventMap['traffic_jam'][] = [];
    bus.on('traffic_jam', (p) => seen.push(p));
    sys.recordTrafficJam({
      tiles: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      vehicles: ['v1', 'v2', 'v3'],
    });
    expect(seen.length).toBe(1);
    expect(seen[0]?.severity).toBe(3);
    expect(seen[0]?.vehicles.length).toBe(3);
  });
});
