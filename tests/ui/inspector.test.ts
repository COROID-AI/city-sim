// @vitest-environment jsdom
/**
 * Inspector tests: the detail panel rendering every entity class in full, live
 * refreshes without rebuilding the panel, clean swaps and explicit clearing.
 *
 * The suite drives the panel the way the app does — `attach()` into the overlay,
 * `select()` per entity, `update()` per frame — over the shared fixture world
 * plus enriched sources that stand in for the live citizen/company/vehicle
 * systems, and it asserts the DOM contract (`data-field`, `data-section`,
 * `data-list`, `data-item-key`) that hosts and QA address.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { SimClock } from '../../src/sim/clock';
import type { Citizen, TileRect, Vec2, Vehicle, WorldMap } from '../../src/sim/types';
import type { VehicleDetails } from '../../src/sim/vehicles';
import { createViewportCamera } from '../../src/render/camera';
import { EntityPicker } from '../../src/render/picking';
import {
  DEFAULT_REFRESH_INTERVAL_MS,
  EntityInspector,
  NEED_CRITICAL_LEVEL,
  formatHourLabel,
  formatMinuteOfDay,
  formatMoney,
  formatNumber,
  formatPercent,
  formatPosition,
  isInspectorEntityKind,
  normaliseMinuteOfDay,
  scheduleSlotContains,
  scheduleSlotStates,
  scheduleSlotWindowLabel,
} from '../../src/ui/inspector';
import type { BuildingRecord, CompanyInspectionRecord, InspectorSources } from '../../src/ui/inspector';
import { createTestWorldMap } from '../helpers/sim-fixtures';

/* ----------------------------------------------------------------- setup -- */

const createdInspectors: EntityInspector[] = [];

afterEach(() => {
  for (const inspector of createdInspectors.splice(0)) {
    if (!inspector.isDisposed) {
      inspector.dispose();
    }
  }
  document.body.replaceChildren();
});

/**
 * Adds the record metadata `CityWorld` and the live systems carry, in place:
 * the panel (like the app) always reads the world's own objects, so mutating a
 * record here is exactly what a running simulation does between refreshes.
 */
function enrichWorld(world: WorldMap): void {
  world.buildings.forEach((building, index) => {
    Object.assign(building, {
      address: `${10 + index * 4} Alder Way`,
      jobSlots: building.kind === 'house' ? 0 : 8,
      districtId: 'district-old-town',
    });
  });
  for (const company of world.companies) {
    Object.assign(company, {
      address: '18 Alder Way',
      districtId: 'district-old-town',
      siteKind: 'shop',
      wageLevel: 'standard',
      wagePerHour: 14,
      capacity: 6,
      revenuePerHour: 96,
      wageCostsPerHour: 42,
      otherCostsPerHour: 12,
      costsPerHour: 54,
      totalRevenue: 4_800,
      totalCosts: 3_100,
      postCount: 24,
      demand: 1.1,
      targetEmployees: 2,
      state: 'healthy',
      troubledSinceDay: null,
      revenueHistory: [
        { day: 0, hour: 6, revenue: 40, wageCosts: 28, otherCosts: 8, totalCosts: 36, netCash: 4, cashAfter: 12_400, employees: 1, demand: 0.8, open: false, state: 'healthy' },
        { day: 0, hour: 7, revenue: 80, wageCosts: 28, otherCosts: 10, totalCosts: 38, netCash: 42, cashAfter: 12_442, employees: 1, demand: 1.0, open: true, state: 'healthy' },
        { day: 0, hour: 8, revenue: 96, wageCosts: 42, otherCosts: 12, totalCosts: 54, netCash: 42, cashAfter: 12_484, employees: 1, demand: 1.2, open: true, state: 'healthy' },
      ],
    });
  }
}

/** Building source standing in for `CityWorld` (records plus district lookup). */
function createBuildingSource(world: WorldMap): NonNullable<InspectorSources['buildings']> {
  return {
    buildingById: (id) =>
      (world.buildings.find((building) => building.id === id) as BuildingRecord | undefined) ?? null,
    districts: [{ id: 'district-old-town', name: 'Old Town' }],
  };
}

/** Company source standing in for `CompaniesSystem` (records plus ledger). */
function createCompanySource(world: WorldMap): NonNullable<InspectorSources['companies']> {
  const record = (id: string): CompanyInspectionRecord | null =>
    (world.companies.find((company) => company.id === id) as CompanyInspectionRecord | undefined) ?? null;
  return {
    companyById: record,
    ledgerFor: (id) => record(id)?.revenueHistory ?? [],
  };
}

/** One vehicle's detail record, recomputed from live state like the fleet does. */
function vehicleDetailsFor(vehicle: Vehicle): VehicleDetails {
  return {
    id: vehicle.id,
    kind: vehicle.kind,
    kindLabel: vehicle.kind === 'car' ? 'car' : vehicle.kind,
    plate: vehicle.plate,
    capacity: vehicle.capacity,
    occupancy: vehicle.occupancy,
    occupantIds: [...vehicle.occupantIds],
    fuel: vehicle.fuel,
    fuelCapacity: vehicle.fuelCapacity,
    speed: vehicle.speed,
    headingRadians: vehicle.headingRadians,
    position: { ...vehicle.position },
    currentNodeId: vehicle.currentNodeId,
    targetNodeId: vehicle.targetNodeId,
    ownerCompanyId: vehicle.ownerCompanyId,
    color: vehicle.color,
    role: 'commute',
    activity: vehicle.speed > 0 ? 'driving' : 'dwelling',
    route: vehicle.route,
    stops: [
      { nodeId: 'node-1', buildingId: 'building-shop', action: 'board', dwellMinutes: 1 },
      { nodeId: 'node-2', buildingId: null, action: 'service', dwellMinutes: 1 },
    ],
    nextStopNodeId: 'node-1',
    nextStopBuildingId: 'building-shop',
    nextStopBuildingName: 'Bean & Barrel',
    passengers: vehicle.occupantIds.map((citizenId) => ({
      citizenId,
      originBuildingId: 'building-home',
      destinationBuildingId: 'building-shop',
      destinationNodeId: 'node-1',
      boardedAtMinute: 480,
    })),
    corridorKey: 'home->work',
    distanceTiles: 12.5,
    completedTrips: 3,
  };
}

/** Vehicle source standing in for `VehiclesSystem` (records plus live details). */
function createVehicleSource(world: WorldMap): NonNullable<InspectorSources['vehicles']> {
  return {
    vehicleById: (id) => world.vehicles.find((vehicle) => vehicle.id === id) ?? null,
    detailsFor: (id) => {
      const vehicle = world.vehicles.find((entry) => entry.id === id);
      return vehicle ? vehicleDetailsFor(vehicle) : null;
    },
  };
}

interface Harness {
  readonly inspector: EntityInspector;
  readonly panel: HTMLElement;
  readonly container: HTMLElement;
  readonly world: WorldMap;
  readonly clock: SimClock;
  readonly now: { value: number };
  /** Advance the injected clock by `ms` and run one throttled update. */
  tick(ms: number): boolean;
}

function createHarness(options: { startHour?: number; enriched?: boolean } = {}): Harness {
  const world = createTestWorldMap();
  const clock = new SimClock({ startHour: options.startHour ?? 10 });
  const now = { value: 1_000 };
  const enriched = options.enriched !== false;
  if (enriched) {
    enrichWorld(world);
  }
  const sources: InspectorSources = enriched
    ? {
        world,
        clock,
        buildings: createBuildingSource(world),
        companies: createCompanySource(world),
        vehicles: createVehicleSource(world),
      }
    : { world, clock };
  const inspector = new EntityInspector({ sources, now: () => now.value });
  createdInspectors.push(inspector);
  const container = document.createElement('div');
  container.className = 'hud';
  document.body.append(container);
  const panel = inspector.attach(container);
  return {
    inspector,
    panel,
    container,
    world,
    clock,
    now,
    tick(ms: number) {
      now.value += ms;
      return inspector.update();
    },
  };
}

/** Text of one `data-field` value node; fails loudly when the field is absent. */
function field(panel: HTMLElement, key: string): string {
  const node = panel.querySelector<HTMLElement>(`[data-field="${key}"]`);
  if (!node) {
    throw new Error(`field "${key}" is not rendered; panel text: ${panel.textContent ?? ''}`);
  }
  return node.textContent ?? '';
}

/** Text of one list cell inside a `data-list` collection. */
function cell(panel: HTMLElement, listKey: string, index: number, fieldKey: string): string {
  const item = panel.querySelector<HTMLElement>(`[data-list="${listKey}"] > [data-item-index="${index}"]`);
  if (!item) {
    throw new Error(`list "${listKey}" has no item at index ${index}`);
  }
  const node = item.querySelector<HTMLElement>(`[data-field="${fieldKey}"]`);
  if (!node) {
    throw new Error(`list "${listKey}[${index}]" does not render field "${fieldKey}"`);
  }
  return node.textContent ?? '';
}

function listItems(panel: HTMLElement, listKey: string): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(`[data-list="${listKey}"] > [data-item-key]`)];
}

function citizen(world: WorldMap, id = 'citizen-1'): Citizen {
  const found = world.citizens.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`missing citizen ${id}`);
  }
  return found;
}

/** First world point inside the camera view where nothing is pickable. */
function findGroundPoint(picker: EntityPicker, camera: ReturnType<typeof createViewportCamera>): Vec2 {
  const bounds: TileRect = camera.visibleWorldBounds();
  for (let y = bounds.y + 0.5; y < bounds.y + bounds.height; y += 0.5) {
    for (let x = bounds.x + 0.5; x < bounds.x + bounds.width; x += 0.5) {
      if (picker.pickWorld({ x, y }).kind === 'ground') {
        return { x, y };
      }
    }
  }
  throw new Error('the fixture world has no ground point on screen');
}

/* ------------------------------------------------------------ formatting -- */

describe('inspector formatting helpers', () => {
  it('formats money, percentages and numbers', () => {
    expect(formatMoney(12_500)).toBe('$12,500.00');
    expect(formatMoney(-3.5)).toBe('-$3.50');
    expect(formatMoney(Number.NaN)).toBe('—');
    expect(formatPercent(0.72)).toBe('72%');
    expect(formatNumber(10.44, 1)).toBe('10.4');
    expect(formatNumber(3, 0)).toBe('3');
  });

  it('formats clock values and positions', () => {
    expect(formatHourLabel(8)).toBe('08:00');
    expect(formatHourLabel(24)).toBe('24:00');
    expect(formatMinuteOfDay(1_439)).toBe('23:59');
    expect(formatPosition({ x: 3, y: 4.5 })).toBe('3.00, 4.50');
    expect(normaliseMinuteOfDay(-30)).toBe(1_410);
  });

  it('classifies schedule slots for the running minute', () => {
    const schedule = [
      { activity: 'home' as const, startHour: 0, endHour: 8, destinationId: 'building-home' },
      { activity: 'work' as const, startHour: 8, endHour: 16, destinationId: 'building-shop' },
      { activity: 'entertainment' as const, startHour: 16, endHour: 19, destinationId: 'building-park' },
      { activity: 'home' as const, startHour: 19, endHour: 24, destinationId: 'building-home' },
    ];

    expect(scheduleSlotStates(schedule, 10 * 60)).toEqual(['past', 'current', 'next', 'upcoming']);
    expect(scheduleSlotStates(schedule, 30)).toEqual(['current', 'next', 'upcoming', 'upcoming']);
    expect(scheduleSlotStates(schedule, 23 * 60)).toEqual(['past', 'past', 'past', 'current']);
    expect(scheduleSlotStates(schedule, null)).toEqual(['upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(scheduleSlotStates([], 600)).toEqual([]);
    expect(scheduleSlotWindowLabel(schedule[1])).toBe('08:00–16:00');

    // A block wrapping midnight covers the small hours.
    const night = { activity: 'work' as const, startHour: 22, endHour: 6, destinationId: 'building-shop' };
    expect(scheduleSlotContains(night, 60)).toBe(true);
    expect(scheduleSlotContains(night, 600)).toBe(false);
    expect(scheduleSlotStates([night], 60)).toEqual(['current']);

    // All blocks already started but none running: the routine wrapped.
    const early = [
      { activity: 'home' as const, startHour: 1, endHour: 2, destinationId: null },
      { activity: 'work' as const, startHour: 3, endHour: 4, destinationId: null },
    ];
    expect(scheduleSlotStates(early, 600)).toEqual(['next', 'past']);
    // A block still ahead: everything before it is past.
    expect(scheduleSlotStates(early, 30)).toEqual(['next', 'upcoming']);
  });

  it('recognises entity kinds', () => {
    expect(isInspectorEntityKind('citizen')).toBe(true);
    expect(isInspectorEntityKind('company')).toBe(true);
    expect(isInspectorEntityKind('ground')).toBe(false);
  });
});

/* ------------------------------------------------------ citizen records -- */

describe('citizen detail', () => {
  it('renders the full citizen record', () => {
    const { inspector, panel } = createHarness();
    inspector.select('citizen', 'citizen-1');

    expect(panel.hidden).toBe(false);
    expect(panel.dataset.kind).toBe('citizen');
    expect(panel.dataset.entityId).toBe('citizen-1');
    expect(panel.dataset.open).toBe('true');

    // Identity, household and addresses.
    expect(field(panel, 'citizen.name')).toBe('Ada Moss');
    expect(field(panel, 'citizen.age')).toBe('34');
    expect(field(panel, 'citizen.id')).toBe('citizen-1');
    expect(field(panel, 'citizen.household')).toBe('household-1');
    expect(field(panel, 'citizen.household.size')).toBe('2');
    expect(field(panel, 'citizen.household.funds')).toBe(formatMoney(4_800));
    expect(field(panel, 'citizen.home')).toBe('Home (building-home)');
    expect(field(panel, 'citizen.home.address')).toBe('10 Alder Way');

    // Work: occupation, employer, workplace and income.
    expect(field(panel, 'citizen.occupation')).toBe('Barista');
    expect(field(panel, 'citizen.sector')).toBe('hospitality');
    expect(field(panel, 'citizen.employer')).toBe('Bean & Barrel (company-1)');
    expect(field(panel, 'citizen.workplace')).toBe('Bean & Barrel (building-shop)');
    expect(field(panel, 'citizen.workplace.address')).toBe('14 Alder Way');
    expect(field(panel, 'citizen.shift')).toBe('08:00–16:00');
    expect(field(panel, 'citizen.wage')).toBe(formatMoney(14));
    expect(field(panel, 'citizen.income')).toBe(formatMoney(112));

    // Live detail from the plain record (no citizens system wired in).
    expect(field(panel, 'citizen.activity')).toBe('work');
    expect(field(panel, 'citizen.mood')).toBe('72%');
    expect(field(panel, 'citizen.position')).toBe('3.00, 4.00');
    expect(field(panel, 'citizen.inside')).toBe('Bean & Barrel (building-shop)');
    expect(field(panel, 'citizen.travelling')).toBe('no');
    expect(field(panel, 'citizen.vehicle')).toBe('on foot');

    // Needs: one row per kind, with level and growth.
    const needs = listItems(panel, 'citizen.needs');
    expect(needs).toHaveLength(5);
    expect(cell(panel, 'citizen.needs', 0, 'need.kind')).toBe('hunger');
    expect(cell(panel, 'citizen.needs', 0, 'need.level')).toBe('10');
    expect(cell(panel, 'citizen.needs', 4, 'need.kind')).toBe('hygiene');
    expect(field(panel, 'citizen.needs.average')).toBe('20');

    // Schedule timeline: every stop with past / current / next / upcoming.
    const schedule = listItems(panel, 'citizen.schedule');
    expect(schedule).toHaveLength(4);
    expect(cell(panel, 'citizen.schedule', 0, 'slot.activity')).toBe('home');
    expect(cell(panel, 'citizen.schedule', 0, 'slot.window')).toBe('00:00–08:00');
    expect(cell(panel, 'citizen.schedule', 0, 'slot.destination')).toBe('Home (building-home)');
    expect(cell(panel, 'citizen.schedule', 0, 'slot.status')).toBe('past');
    expect(cell(panel, 'citizen.schedule', 1, 'slot.status')).toBe('current');
    expect(cell(panel, 'citizen.schedule', 2, 'slot.status')).toBe('next');
    expect(cell(panel, 'citizen.schedule', 3, 'slot.status')).toBe('upcoming');
    expect(schedule[2].dataset.state).toBe('next');
    expect(field(panel, 'citizen.schedule.current')).toContain('work');
    expect(field(panel, 'citizen.schedule.next')).toContain('entertainment');
    expect(field(panel, 'citizen.schedule.past')).toBe('1');
  });

  it('marks critical needs', () => {
    const { inspector, panel, world } = createHarness();
    const ada = citizen(world);
    ada.needs[0].level = NEED_CRITICAL_LEVEL + 5;
    inspector.select('citizen', 'citizen-1');

    const node = panel.querySelector<HTMLElement>('[data-field="need.level"][data-tone="critical"]');
    expect(node?.textContent).toBe('65');
    expect(field(panel, 'citizen.needs.critical')).toBe('1');
  });

  it('renders the same core record from the raw world only', () => {
    const { inspector, panel } = createHarness({ enriched: false });
    inspector.select('citizen', 'citizen-1');

    expect(field(panel, 'citizen.name')).toBe('Ada Moss');
    expect(field(panel, 'citizen.activity')).toBe('work');
    expect(field(panel, 'citizen.schedule.current')).toContain('work');
    expect(listItems(panel, 'citizen.schedule')).toHaveLength(4);
    // No citizen system: routine-specific detail degrades to a placeholder.
    expect(field(panel, 'citizen.stage')).toBe('—');
  });
});

/* ------------------------------------------------------ company records -- */

describe('company detail', () => {
  it('renders the full company record', () => {
    const { inspector, panel } = createHarness();
    inspector.select('company', 'company-1');

    expect(panel.dataset.kind).toBe('company');
    expect(field(panel, 'company.name')).toBe('Bean & Barrel');
    expect(field(panel, 'company.id')).toBe('company-1');
    expect(field(panel, 'company.sector')).toBe('hospitality');
    expect(field(panel, 'company.state')).toBe('healthy');
    expect(field(panel, 'company.address')).toBe('18 Alder Way');
    expect(field(panel, 'company.district')).toBe('Old Town');
    expect(field(panel, 'company.building')).toBe('Bean & Barrel (building-shop)');
    expect(field(panel, 'company.open')).toBe('08:00–20:00');
    expect(field(panel, 'company.wage.level')).toBe('standard');
    expect(field(panel, 'company.wage.hourly')).toBe(formatMoney(14));

    // Ledger: cash, daily and hourly figures, lifetime totals.
    expect(field(panel, 'company.cash')).toBe(formatMoney(12_500));
    expect(field(panel, 'company.revenue.today')).toBe(formatMoney(640));
    expect(field(panel, 'company.costs.today')).toBe(formatMoney(410));
    expect(field(panel, 'company.profit.today')).toBe(formatMoney(230));
    expect(field(panel, 'company.revenue.hour')).toBe(formatMoney(96));
    expect(field(panel, 'company.costs.hour')).toBe(formatMoney(54));
    expect(field(panel, 'company.profit.hour')).toBe(formatMoney(42));
    expect(field(panel, 'company.revenue.total')).toBe(formatMoney(4_800));
    expect(field(panel, 'company.demand')).toBe('1.1');
    expect(field(panel, 'company.posts')).toBe('24');

    // Staff roster resolves ids to citizens.
    expect(listItems(panel, 'company.staff')).toHaveLength(1);
    expect(cell(panel, 'company.staff', 0, 'staff.name')).toBe('Ada Moss');
    expect(cell(panel, 'company.staff', 0, 'staff.title')).toBe('Barista');
    expect(cell(panel, 'company.staff', 0, 'staff.wage')).toBe(formatMoney(14));
    expect(field(panel, 'company.staff.count')).toBe('1');
    expect(field(panel, 'company.capacity')).toBe('6');
    expect(field(panel, 'company.staff.openings')).toBe('5');

    // Rolling hourly ledger.
    expect(field(panel, 'company.ledger.hours')).toBe('3');
    expect(listItems(panel, 'company.ledger')).toHaveLength(3);
    expect(cell(panel, 'company.ledger', 2, 'ledger.time')).toBe('Day 0, 08:00');
    expect(cell(panel, 'company.ledger', 2, 'ledger.revenue')).toBe(formatMoney(96));
    expect(cell(panel, 'company.ledger', 2, 'ledger.costs')).toBe(formatMoney(54));
    expect(cell(panel, 'company.ledger', 2, 'ledger.net')).toBe(formatMoney(42));
    expect(cell(panel, 'company.ledger', 2, 'ledger.cash')).toBe(formatMoney(12_484));
    expect(listItems(panel, 'company.ledger')[0].dataset.state).toBe('closed');
  });

  it('degrades gracefully without a company system', () => {
    const { inspector, panel } = createHarness({ enriched: false });
    inspector.select('company', 'company-1');

    expect(field(panel, 'company.name')).toBe('Bean & Barrel');
    expect(field(panel, 'company.sector')).toBe('hospitality');
    expect(field(panel, 'company.cash')).toBe(formatMoney(12_500));
    expect(field(panel, 'company.employeeCount')).toBe('1');
    expect(listItems(panel, 'company.staff')).toHaveLength(1);
    expect(field(panel, 'company.state')).toBe('—');
    expect(listItems(panel, 'company.ledger')).toHaveLength(0);
  });
});

/* ------------------------------------------------------ vehicle records -- */

describe('vehicle detail', () => {
  it('renders the full vehicle record', () => {
    const { inspector, panel } = createHarness();
    inspector.select('vehicle', 'vehicle-1');

    expect(panel.dataset.kind).toBe('vehicle');
    expect(field(panel, 'vehicle.kind')).toBe('car (car)');
    expect(field(panel, 'vehicle.plate')).toBe('CITY-001');
    expect(field(panel, 'vehicle.id')).toBe('vehicle-1');
    expect(field(panel, 'vehicle.role')).toBe('commute');
    expect(field(panel, 'vehicle.activity')).toBe('driving');

    expect(field(panel, 'vehicle.capacity')).toBe('4');
    expect(field(panel, 'vehicle.occupancy')).toBe('1 / 4');
    expect(field(panel, 'vehicle.fuel')).toBe(`${formatNumber(32, 2)} / ${formatNumber(45, 2)}`);
    expect(field(panel, 'vehicle.fuel.percent')).toBe('71.1%');
    expect(field(panel, 'vehicle.speed')).toBe('0.25 tiles / min');
    expect(field(panel, 'vehicle.position')).toBe('2.00, 2.00');
    expect(field(panel, 'vehicle.distance')).toBe('12.50 tiles');
    expect(field(panel, 'vehicle.trips')).toBe('3');

    // Route and stops.
    expect(field(panel, 'vehicle.route.id')).toBe('route-1');
    expect(field(panel, 'vehicle.route.kind')).toBe('loop');
    expect(field(panel, 'vehicle.route.loop')).toBe('yes');
    expect(field(panel, 'vehicle.route.stops')).toBe('2');
    expect(field(panel, 'vehicle.route.next')).toBe('node-1');
    expect(field(panel, 'vehicle.route.next.building')).toBe('Bean & Barrel (building-shop)');
    expect(listItems(panel, 'vehicle.stops')).toHaveLength(2);
    expect(cell(panel, 'vehicle.stops', 0, 'stop.node')).toBe('node-1');
    expect(cell(panel, 'vehicle.stops', 0, 'stop.building')).toBe('Bean & Barrel (building-shop)');
    expect(cell(panel, 'vehicle.stops', 0, 'stop.action')).toBe('board');
    expect(listItems(panel, 'vehicle.stops')[0].dataset.state).toBe('next');

    // Occupancy resolves rider ids to citizens with their trip.
    expect(field(panel, 'vehicle.riders.count')).toBe('1');
    expect(listItems(panel, 'vehicle.occupants')).toHaveLength(1);
    expect(cell(panel, 'vehicle.occupants', 0, 'occupant.name')).toBe('Ada Moss');
    expect(cell(panel, 'vehicle.occupants', 0, 'occupant.origin')).toBe('Home (building-home)');
    expect(cell(panel, 'vehicle.occupants', 0, 'occupant.destination')).toBe('Bean & Barrel (building-shop)');
    expect(cell(panel, 'vehicle.occupants', 0, 'occupant.boarded')).toBe(formatMinuteOfDay(480));
  });

  it('renders a route from the raw record without a fleet system', () => {
    const { inspector, panel } = createHarness({ enriched: false });
    inspector.select('vehicle', 'vehicle-1');

    expect(field(panel, 'vehicle.plate')).toBe('CITY-001');
    expect(field(panel, 'vehicle.kind')).toBe('car (car)');
    expect(listItems(panel, 'vehicle.stops')).toHaveLength(2);
    expect(cell(panel, 'vehicle.stops', 1, 'stop.node')).toBe('node-2');
    expect(field(panel, 'vehicle.activity')).toBe('—');
  });
});

/* ----------------------------------------------------- building records -- */

describe('building detail', () => {
  it('renders the full building record for a home', () => {
    const { inspector, panel } = createHarness();
    inspector.select('building', 'building-home');

    expect(panel.dataset.kind).toBe('building');
    expect(field(panel, 'building.name')).toBe('Home');
    expect(field(panel, 'building.kind')).toBe('house');
    expect(field(panel, 'building.address')).toBe('10 Alder Way');
    expect(field(panel, 'building.district')).toBe('Old Town');
    expect(field(panel, 'building.floors')).toBe('2');
    expect(field(panel, 'building.footprint')).toBe('2, 3 · 2×2');
    expect(field(panel, 'building.capacity')).toBe('4');
    expect(field(panel, 'building.jobslots')).toBe('0');
    expect(field(panel, 'building.company')).toBe('—');

    expect(field(panel, 'building.occupants.count')).toBe('1');
    expect(field(panel, 'building.residents.count')).toBe('1');
    expect(field(panel, 'building.residents.households')).toBe('1');
    expect(field(panel, 'building.employees.count')).toBe('0');
    expect(listItems(panel, 'building.occupants')).toHaveLength(1);
    expect(cell(panel, 'building.occupants', 0, 'occupant.name')).toBe('Ada Moss');
    expect(listItems(panel, 'building.residents')).toHaveLength(1);
    expect(cell(panel, 'building.residents', 0, 'resident.name')).toBe('Ada Moss');
  });

  it('renders a workplace with its operator company and workers', () => {
    const { inspector, panel } = createHarness();
    inspector.select('building', 'building-shop');

    expect(field(panel, 'building.name')).toBe('Bean & Barrel');
    expect(field(panel, 'building.kind')).toBe('shop');
    expect(field(panel, 'building.jobslots')).toBe('8');
    expect(field(panel, 'building.company')).toBe('Bean & Barrel (company-1)');
    expect(field(panel, 'building.company.sector')).toBe('hospitality');
    expect(field(panel, 'building.company.employees')).toBe('1');
    expect(field(panel, 'building.company.cash')).toBe(formatMoney(12_500));

    expect(field(panel, 'building.employees.count')).toBe('1');
    expect(field(panel, 'building.residents.count')).toBe('0');
    expect(listItems(panel, 'building.employees')).toHaveLength(1);
    expect(cell(panel, 'building.employees', 0, 'employee.name')).toBe('Ada Moss');
    expect(cell(panel, 'building.employees', 0, 'employee.title')).toBe('Barista');
    expect(cell(panel, 'building.employees', 0, 'employee.present')).toBe('yes');
  });
});

/* ------------------------------------------------------------ live panel -- */

describe('live refresh', () => {
  it('refreshes live fields on the throttled cadence without rebuilding the panel', () => {
    const harness = createHarness();
    const { inspector, panel, world } = harness;
    inspector.select('citizen', 'citizen-1');

    const panelBefore = inspector.element;
    const activityNode = panel.querySelector('[data-field="citizen.activity"]');
    expect(activityNode?.textContent).toBe('work');
    const refreshesBefore = inspector.refreshCount;

    // The entity changes in the simulation (or in the record store).
    citizen(world).currentActivity = 'errand';

    // Inside the cadence window nothing is re-synced.
    expect(harness.tick(DEFAULT_REFRESH_INTERVAL_MS - 50)).toBe(false);
    expect(activityNode?.textContent).toBe('work');
    expect(inspector.refreshCount).toBe(refreshesBefore);
    expect(inspector.skippedRefreshCount).toBe(1);

    // Past the cadence the value follows the record, on the same nodes.
    expect(harness.tick(100)).toBe(true);
    expect(activityNode?.textContent).toBe('errand');
    expect(inspector.refreshCount).toBe(refreshesBefore + 1);
    expect(inspector.element).toBe(panelBefore);
    expect(panel.querySelector('[data-field="citizen.activity"]')).toBe(activityNode);
    expect(panel.querySelectorAll('[data-section]')).toHaveLength(5);
  });

  it('follows a moving entity by id', () => {
    const harness = createHarness();
    const { inspector, panel, world } = harness;
    inspector.select('citizen', 'citizen-1');

    const positionNode = panel.querySelector('[data-field="citizen.position"]');
    const insideNode = panel.querySelector('[data-field="citizen.inside"]');
    expect(positionNode?.textContent).toBe('3.00, 4.00');

    const ada = citizen(world);
    ada.position = { x: 9.5, y: 2.25 };
    ada.insideBuildingId = null;
    ada.currentActivity = 'errand';

    expect(harness.tick(DEFAULT_REFRESH_INTERVAL_MS + 10)).toBe(true);

    expect(inspector.selectedId).toBe('citizen-1');
    expect(panel.dataset.entityId).toBe('citizen-1');
    expect(positionNode?.textContent).toBe('9.50, 2.25');
    expect(insideNode?.textContent).toBe('—');
    expect(panel.querySelector('[data-field="citizen.activity"]')?.textContent).toBe('errand');
    expect(panel.querySelector('[data-field="citizen.position"]')).toBe(positionNode);
  });

  it('updates occupancy, cash and roster fields live', () => {
    const harness = createHarness();
    const { inspector, panel, world } = harness;

    inspector.select('building', 'building-home');
    const occupantsNode = panel.querySelector('[data-field="building.occupants.count"]');
    expect(occupantsNode?.textContent).toBe('1');
    world.buildings.find((building) => building.id === 'building-home')?.occupantIds.push('citizen-2');
    expect(harness.tick(DEFAULT_REFRESH_INTERVAL_MS + 1)).toBe(true);
    expect(occupantsNode?.textContent).toBe('2');
    expect(listItems(panel, 'building.occupants')).toHaveLength(2);

    inspector.select('company', 'company-1');
    const cashNode = panel.querySelector('[data-field="company.cash"]');
    world.companies[0].cash = 999;
    expect(harness.tick(DEFAULT_REFRESH_INTERVAL_MS + 1)).toBe(true);
    expect(cashNode?.textContent).toBe(formatMoney(999));
  });

  it('falls back to the unavailable state when the record disappears', () => {
    const harness = createHarness();
    const { inspector, panel, world } = harness;
    inspector.select('vehicle', 'vehicle-1');

    const removed: Vehicle[] = world.vehicles.splice(0, world.vehicles.length);
    expect(harness.tick(DEFAULT_REFRESH_INTERVAL_MS + 1)).toBe(true);
    expect(panel.querySelector('[data-section="inspector.unavailable"]')).not.toBeNull();
    expect(panel.textContent).toContain('Unknown vehicle');

    world.vehicles.push(...removed);
    expect(harness.tick(DEFAULT_REFRESH_INTERVAL_MS + 1)).toBe(true);
    expect(field(panel, 'vehicle.plate')).toBe('CITY-001');
  });

  it('never mutates the simulation', () => {
    const harness = createHarness();
    const { inspector, world } = harness;
    const before = JSON.stringify(world);

    inspector.select('citizen', 'citizen-1');
    harness.tick(DEFAULT_REFRESH_INTERVAL_MS + 1);
    inspector.select('company', 'company-1');
    harness.tick(DEFAULT_REFRESH_INTERVAL_MS + 1);
    inspector.select('vehicle', 'vehicle-1');
    harness.tick(DEFAULT_REFRESH_INTERVAL_MS + 1);
    inspector.select('building', 'building-shop');
    harness.tick(DEFAULT_REFRESH_INTERVAL_MS + 1);
    inspector.clear();

    expect(JSON.stringify(world)).toBe(before);
  });
});

/* --------------------------------------------------------- swaps, clears -- */

describe('selection changes', () => {
  it('swaps content without leaving stale fields', () => {
    const { inspector, panel } = createHarness();
    inspector.select('citizen', 'citizen-1');
    expect(field(panel, 'citizen.name')).toBe('Ada Moss');

    const panelNode = inspector.element;
    inspector.select('vehicle', 'vehicle-1');

    expect(panel.dataset.kind).toBe('vehicle');
    expect(panel.dataset.entityId).toBe('vehicle-1');
    expect(panel.querySelector('[data-field="citizen.name"]')).toBeNull();
    expect(panel.querySelector('[data-field="citizen.schedule"]')).toBeNull();
    expect(field(panel, 'vehicle.plate')).toBe('CITY-001');
    // No citizen-only field survives the swap (the panel legitimately names
    // Ada Moss again as the rider on board).
    expect(panel.querySelectorAll('[data-field^="citizen."]')).toHaveLength(0);
    expect(panel.textContent).not.toContain('household-1');
    expect(inspector.element).toBe(panelNode);

    inspector.select('building', 'building-home');
    expect(panel.dataset.kind).toBe('building');
    expect(panel.querySelectorAll('[data-field^="vehicle."]')).toHaveLength(0);
    expect(panel.textContent).not.toContain('CITY-001');
    expect(field(panel, 'building.name')).toBe('Home');
  });

  it('clears the selection and hides the panel', () => {
    const { inspector, panel } = createHarness();
    const changes: (string | null)[] = [];
    const unsubscribe = inspector.onSelectionChange((selection) =>
      changes.push(selection ? `${selection.kind}:${selection.id}` : null),
    );

    inspector.select('citizen', 'citizen-1');
    expect(inspector.isOpen).toBe(true);
    expect(inspector.clear()).toBe(true);

    expect(inspector.isOpen).toBe(false);
    expect(inspector.selectedId).toBeNull();
    expect(panel.hidden).toBe(true);
    expect(panel.dataset.open).toBe('false');
    expect(panel.dataset.kind).toBeUndefined();
    expect(panel.querySelectorAll('[data-field]')).toHaveLength(0);
    expect(panel.textContent).not.toContain('Ada Moss');
    expect(changes).toEqual(['citizen:citizen-1', null]);
    // Clearing twice is a no-op.
    expect(inspector.clearSelection()).toBe(false);
    unsubscribe();
    inspector.select('citizen', 'citizen-1');
    inspector.clear();
    expect(changes).toHaveLength(2);
  });

  it('clears on Escape and ignores other keys', () => {
    const { inspector, panel } = createHarness();
    inspector.select('citizen', 'citizen-1');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(inspector.isOpen).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(inspector.isOpen).toBe(false);
    expect(panel.hidden).toBe(true);

    // The same behaviour is available to hosts that own their input.
    inspector.select('vehicle', 'vehicle-1');
    expect(inspector.handleKeyDown({ key: 'Escape' })).toBe(true);
    expect(inspector.isOpen).toBe(false);
    expect(inspector.handleKeyDown({ key: 'Escape' })).toBe(false);
    expect(inspector.handleKeyDown({ key: 'Enter' })).toBe(false);
  });

  it('shows an explicit empty state for an unknown entity', () => {
    const { inspector, panel } = createHarness();
    inspector.select('citizen', 'citizen-does-not-exist');

    expect(panel.hidden).toBe(false);
    expect(panel.dataset.kind).toBe('citizen');
    const note = panel.querySelector('[data-section="inspector.unavailable"]');
    expect(note?.textContent).toContain('citizen-does-not-exist');
    expect(panel.textContent).toContain('Unknown citizen');
  });

  it('navigates to linked entities from the panel', () => {
    const { inspector, panel } = createHarness();
    inspector.select('citizen', 'citizen-1');

    const companyLink = panel.querySelector<HTMLButtonElement>(
      'button[data-action="inspect"][data-entity-kind="company"]',
    );
    expect(companyLink?.hidden).toBe(false);
    companyLink?.click();
    expect(inspector.selectedKind).toBe('company');
    expect(field(panel, 'company.name')).toBe('Bean & Barrel');

    // The company's premises link back to the building.
    panel.querySelector<HTMLButtonElement>('button[data-action="inspect"][data-entity-kind="building"]')?.click();
    expect(inspector.selectedKind).toBe('building');
    expect(field(panel, 'building.name')).toBe('Bean & Barrel');

    // The building's operator links to the company again.
    panel.querySelector<HTMLButtonElement>('button[data-action="inspect"][data-entity-kind="company"]')?.click();
    expect(inspector.selectedKind).toBe('company');

    // The close button clears.
    panel.querySelector<HTMLButtonElement>('button[data-action="clear"]')?.click();
    expect(inspector.isOpen).toBe(false);
    expect(panel.hidden).toBe(true);
  });

  it('hides links that have no target', () => {
    const { inspector, panel } = createHarness();
    inspector.select('building', 'building-home');

    // A house with no operator: the company link stays hidden.
    const operatorSection = panel.querySelector<HTMLElement>('[data-section="building.company"]');
    const visibleOperatorLinks = operatorSection?.querySelectorAll(
      'button[data-action="inspect"]:not([hidden])',
    );
    expect(visibleOperatorLinks).toHaveLength(0);

    // A vehicle with no owner company: same contract.
    inspector.select('vehicle', 'vehicle-1');
    const identitySection = panel.querySelector<HTMLElement>('[data-section="vehicle.identity"]');
    expect(
      identitySection?.querySelectorAll('button[data-action="inspect"]:not([hidden])'),
    ).toHaveLength(0);

    // Rider links with a real target stay visible.
    const riderLinks = panel.querySelectorAll<HTMLButtonElement>(
      'button[data-action="inspect"][data-entity-kind="citizen"]:not([hidden])',
    );
    expect(riderLinks.length).toBeGreaterThan(0);
  });
});

/* --------------------------------------------------- picking integration -- */

describe('pick-to-inspect wiring', () => {
  it('selects the picked entity and clears on a ground click', () => {
    const harness = createHarness();
    const { inspector, panel, world } = harness;
    const camera = createViewportCamera(world, { width: 192, height: 192 }, { zoom: 1 });
    const picker = new EntityPicker({ camera, world });
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    inspector.bindPicking({ picker, element: canvas });

    const ada = citizen(world);
    ada.position = { x: 6.25, y: 5.75 };
    const screen = camera.worldToScreen(ada.position);
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: screen.x, clientY: screen.y, bubbles: true }));

    expect(inspector.selectedKind).toBe('citizen');
    expect(inspector.selectedId).toBe('citizen-1');
    expect(field(panel, 'citizen.name')).toBe('Ada Moss');

    // A ground click clears the selection and hides the panel.
    const ground = findGroundPoint(picker, camera);
    const groundScreen = camera.worldToScreen(ground);
    canvas.dispatchEvent(
      new MouseEvent('pointerdown', { clientX: groundScreen.x, clientY: groundScreen.y, bubbles: true }),
    );

    expect(inspector.isOpen).toBe(false);
    expect(panel.hidden).toBe(true);
  });

  it('unbinds picking on request and on dispose', () => {
    const harness = createHarness();
    const { inspector, world } = harness;
    const camera = createViewportCamera(world, { width: 192, height: 192 }, { zoom: 1 });
    const picker = new EntityPicker({ camera, world });
    const canvas = document.createElement('canvas');
    document.body.append(canvas);

    const binding = inspector.bindPicking({ picker, element: canvas, event: 'click' });
    const screen = camera.worldToScreen(citizen(world).position);
    canvas.dispatchEvent(new MouseEvent('click', { clientX: screen.x, clientY: screen.y, bubbles: true }));
    expect(inspector.isOpen).toBe(true);

    binding.dispose();
    inspector.clear();
    canvas.dispatchEvent(new MouseEvent('click', { clientX: screen.x, clientY: screen.y, bubbles: true }));
    expect(inspector.isOpen).toBe(false);

    expect(() => inspector.bindPicking({ picker, element: undefined as unknown as HTMLElement })).toThrow(TypeError);
  });
});

/* -------------------------------------------------------------- lifecycle -- */

describe('inspector lifecycle', () => {
  it('renders a selection made before attach', () => {
    const world = createTestWorldMap();
    const inspector = new EntityInspector({ sources: { world } });
    createdInspectors.push(inspector);
    expect(inspector.element).toBeNull();

    inspector.select('citizen', 'citizen-1');
    const container = document.createElement('div');
    document.body.append(container);
    const panel = inspector.attach(container);

    expect(panel.parentElement).toBe(container);
    expect(panel.hidden).toBe(false);
    expect(field(panel, 'citizen.name')).toBe('Ada Moss');
  });

  it('moves the panel between containers and is idempotent per container', () => {
    const { inspector, panel } = createHarness();
    expect(inspector.attach(panel.parentElement as HTMLElement)).toBe(panel);

    const other = document.createElement('div');
    document.body.append(other);
    expect(inspector.attach(other)).toBe(panel);
    expect(panel.parentElement).toBe(other);
    expect(document.querySelectorAll('.inspector')).toHaveLength(1);
  });

  it('disposes the panel, its listeners and its bindings', () => {
    const { inspector, panel, container } = createHarness();
    inspector.select('citizen', 'citizen-1');

    inspector.dispose();

    expect(inspector.isDisposed).toBe(true);
    expect(panel.isConnected).toBe(false);
    expect(container.querySelectorAll('.inspector')).toHaveLength(0);
    expect(inspector.update()).toBe(false);
    expect(inspector.isOpen).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(() => inspector.dispose()).not.toThrow();
    expect(() => inspector.select('citizen', 'citizen-1')).toThrow(/after dispose/);
    expect(() => inspector.attach(container)).toThrow(/after dispose/);
  });

  it('validates its arguments', () => {
    expect(() => new EntityInspector(undefined as never)).toThrow(TypeError);
    expect(
      () => new EntityInspector({ sources: {}, refreshIntervalMs: 0 }),
    ).toThrow(RangeError);

    const { inspector } = createHarness();
    expect(() => inspector.select('citizen', '')).toThrow(TypeError);
    expect(() => inspector.select('ground' as never, 'x')).toThrow(TypeError);
    expect(inspector.select).toBeTypeOf('function');
  });
});
