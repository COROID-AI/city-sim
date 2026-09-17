// @vitest-environment jsdom
/**
 * Composition test: pick-and-inspect against the *running* fixture simulation.
 *
 * Where `inspector.test.ts` pins the panel against fixture records, this suite
 * wires the real thing exactly the way the app composition will: the seeded
 * `CityWorld`, the fixture `SimulationEngine` with its fixed-step clock,
 * `CitizensSystem`, `CompaniesSystem`, `EconomySystem` and `VehiclesSystem`, the
 * `ViewportCamera` used for drawing, an `EntityPicker` over that camera and an
 * `EntityInspector` bound to canvas pointer events.
 *
 * It then advances real simulated time, clicks seeded screen positions and
 * asserts the end-to-end behaviour the product requires: a click resolves
 * through the camera transform to the citizen, vehicle or building the user
 * aimed at; the panel shows that entity's live record (schedule and needs for a
 * citizen, route and occupancy for a vehicle, occupants and operator for a
 * building, ledger and staff for a company); the fields keep tracking the
 * simulation as it runs; and a ground click or `Esc` clears the panel.
 */

import { describe, expect, it } from 'vitest';

import { CitizensSystem } from '../../src/sim/citizens';
import { MINUTES_PER_HOUR } from '../../src/sim/clock';
import { CompaniesSystem } from '../../src/sim/companies';
import { EconomySystem } from '../../src/sim/economy';
import type { Citizen, Vehicle, Vec2 } from '../../src/sim/types';
import { VehiclesSystem } from '../../src/sim/vehicles';
import { createCityWorld } from '../../src/sim/world';
import type { CityWorld, WorldBuilding } from '../../src/sim/world';
import { createViewportCamera } from '../../src/render/camera';
import type { ViewportCamera } from '../../src/render/camera';
import { EntityPicker } from '../../src/render/picking';
import {
  EntityInspector,
  formatMoney,
  formatPosition,
  LEDGER_ROWS,
  MAX_LIST_ROWS,
  scheduleSlotWindowLabel,
} from '../../src/ui/inspector';
import { createSimFixture } from '../helpers/sim-fixtures';
import type { SimFixture } from '../helpers/sim-fixtures';

const VIEWPORT = { width: 1024, height: 768 } as const;
const CAMERA_ZOOM = 2;
const INITIAL_BUDGET = 250_000;
/** Sim minutes advanced before the first pick: the morning commute. */
const MORNING_MINUTES = 8 * MINUTES_PER_HOUR;

interface Composition {
  readonly fixture: SimFixture;
  readonly world: CityWorld;
  readonly citizens: CitizensSystem;
  readonly companies: CompaniesSystem;
  readonly vehicles: VehiclesSystem;
  readonly camera: ViewportCamera;
  readonly picker: EntityPicker;
  readonly inspector: EntityInspector;
  readonly panel: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** Advances sim time and the inspector's clock together. */
  advance(minutes: number): void;
  dispose(): void;
}

/** Builds the full app-shaped composition on a shared engine. */
function buildComposition(seed: string): Composition {
  const fixture = createSimFixture({ seed, startHour: 0 });
  const world = createCityWorld({ seed: fixture.rng.seed });
  const citizens = new CitizensSystem({ world });
  const economy = new EconomySystem(world, { citizens, initialBudget: INITIAL_BUDGET });
  const companies = new CompaniesSystem(world, {
    labourMarket: economy.createLabourMarket(),
    demandModel: economy.createDemandModel(),
    startHour: 0,
  });
  economy.bindCompanies(companies);
  const vehicles = new VehiclesSystem({ world, citizens });
  fixture.engine.attach(citizens);
  fixture.engine.attach(companies);
  fixture.engine.attach(economy);
  fixture.engine.attach(vehicles);

  const camera = createViewportCamera(world, VIEWPORT, { zoom: CAMERA_ZOOM });
  const picker = new EntityPicker({ camera, world });
  const clock = { value: 0 };
  const inspector = new EntityInspector({
    sources: { world, citizens, companies, vehicles, buildings: world, clock: fixture.clock },
    refreshIntervalMs: 200,
    now: () => clock.value,
  });

  const overlay = document.createElement('div');
  overlay.className = 'hud';
  const canvas = document.createElement('canvas');
  overlay.append(canvas);
  document.body.append(overlay);
  const panel = inspector.attach(overlay);
  inspector.bindPicking({ picker, element: canvas });

  return {
    fixture,
    world,
    citizens,
    companies,
    vehicles,
    camera,
    picker,
    inspector,
    panel,
    canvas,
    advance(minutes: number) {
      fixture.advanceMinutes(minutes);
      clock.value += minutes * 1_000;
    },
    dispose() {
      inspector.dispose();
      fixture.dispose();
      overlay.remove();
    },
  };
}

/** Runs a body against a fresh composition and always tears it down. */
function withComposition(seed: string, body: (composition: Composition) => void): void {
  const composition = buildComposition(seed);
  try {
    body(composition);
  } finally {
    composition.dispose();
  }
}

/** Text of one `data-field` value node; fails loudly when the field is absent. */
function field(panel: HTMLElement, key: string): string {
  const node = panel.querySelector<HTMLElement>(`[data-field="${key}"]`);
  if (!node) {
    throw new Error(`field "${key}" is not rendered; panel text: ${panel.textContent ?? ''}`);
  }
  return node.textContent ?? '';
}

function listItems(panel: HTMLElement, listKey: string): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(`[data-list="${listKey}"] > [data-item-key]`)];
}

function listValues(panel: HTMLElement, listKey: string, fieldKey: string): (string | null)[] {
  return listItems(panel, listKey).map((item) => item.querySelector(`[data-field="${fieldKey}"]`)?.textContent ?? null);
}

/** Centres the camera on a world point and returns its screen position. */
function projectPoint(composition: Composition, point: Vec2): Vec2 {
  composition.camera.centerOn(point.x, point.y);
  return composition.camera.worldToScreen(point);
}

/** Dispatches the same pointer event a user click produces on the canvas. */
function clickScreen(composition: Composition, screen: Vec2): void {
  composition.canvas.dispatchEvent(
    new MouseEvent('pointerdown', { clientX: screen.x, clientY: screen.y, bubbles: true }),
  );
}

interface PickTarget {
  readonly id: string;
  readonly screen: Vec2;
}

/** Finds a citizen the user can actually click, scanning the running roster. */
function findPickableCitizen(composition: Composition, travelling: boolean): PickTarget | null {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    for (const citizen of composition.citizens.activeCitizens()) {
      const live = composition.citizens.liveStateFor(citizen.id);
      if (travelling && !live?.travelling) {
        continue;
      }
      const screen = projectPoint(composition, citizen.position);
      const pick = composition.picker.pickScreen(screen);
      if (pick.kind === 'citizen' && pick.id === citizen.id) {
        return { id: citizen.id, screen };
      }
    }
    composition.advance(5);
  }
  return null;
}

/** Finds an en-route vehicle the user can click, preferring one with riders. */
function findPickableVehicle(composition: Composition, requireRiders: boolean): PickTarget | null {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    for (const vehicle of composition.vehicles.activeVehicles()) {
      if (requireRiders && vehicle.occupantIds.length === 0) {
        continue;
      }
      const screen = projectPoint(composition, vehicle.position);
      const pick = composition.picker.pickScreen(screen);
      if (pick.kind === 'vehicle' && pick.id === vehicle.id) {
        return { id: vehicle.id, screen };
      }
    }
    composition.advance(5);
  }
  return null;
}

/** Finds a building the user can click, preferring an occupied one. */
function findPickableBuilding(composition: Composition, requireOccupants: boolean): PickTarget | null {
  const ordered = [...composition.world.buildings].sort(
    (left, right) => right.occupantIds.length - left.occupantIds.length,
  );
  for (const building of ordered) {
    if (requireOccupants && building.occupantIds.length === 0) {
      continue;
    }
    const centre = {
      x: building.footprint.x + building.footprint.width / 2,
      y: building.footprint.y + building.footprint.height / 2,
    };
    const screen = projectPoint(composition, centre);
    const pick = composition.picker.pickScreen(screen);
    if (pick.kind === 'building' && pick.id === building.id) {
      return { id: building.id, screen };
    }
  }
  return null;
}

/** A world point inside the current view where nothing is pickable. */
function findGroundPoint(composition: Composition): Vec2 {
  const bounds = composition.camera.visibleWorldBounds();
  for (let y = bounds.y + 0.25; y < bounds.y + bounds.height; y += 0.5) {
    for (let x = bounds.x + 0.25; x < bounds.x + bounds.width; x += 0.5) {
      if (composition.picker.pickWorld({ x, y }).kind === 'ground') {
        return { x, y };
      }
    }
  }
  throw new Error('no ground point is visible');
}

function citizenById(composition: Composition, id: string): Citizen {
  const citizen = composition.citizens.citizenById(id);
  if (!citizen) {
    throw new Error(`missing citizen ${id}`);
  }
  return citizen;
}

function vehicleById(composition: Composition, id: string): Vehicle {
  const vehicle = composition.vehicles.vehicleById(id);
  if (!vehicle) {
    throw new Error(`missing vehicle ${id}`);
  }
  return vehicle;
}

function buildingById(composition: Composition, id: string): WorldBuilding {
  const building = composition.world.buildingById(id);
  if (!building) {
    throw new Error(`missing building ${id}`);
  }
  return building;
}

describe('pick and inspect against the running fixture sim', () => {
  it('picks a moving citizen and shows its live schedule, needs and activity', () => {
    withComposition('inspector-citizen', (composition) => {
      const { inspector, panel, citizens } = composition;
      composition.advance(MORNING_MINUTES);

      // The camera/picker pair resolves a real click to a real walker.
      const target = findPickableCitizen(composition, true) ?? findPickableCitizen(composition, false);
      expect(target).not.toBeNull();
      const citizenId = (target as PickTarget).id;

      clickScreen(composition, (target as PickTarget).screen);

      expect(inspector.selectedKind).toBe('citizen');
      expect(inspector.selectedId).toBe(citizenId);
      expect(panel.hidden).toBe(false);

      const details = citizens.detailsFor(citizenId);
      expect(details).not.toBeNull();
      const record = citizenById(composition, citizenId);

      expect(field(panel, 'citizen.name')).toBe(record.name);
      expect(field(panel, 'citizen.age')).toBe(String(record.age));
      expect(field(panel, 'citizen.id')).toBe(citizenId);
      expect(field(panel, 'citizen.occupation')).toBe(record.occupation.title);
      expect(field(panel, 'citizen.wage')).toBe(formatMoney(record.occupation.wagePerHour));
      expect(field(panel, 'citizen.income')).toBe(formatMoney(record.income));
      expect(field(panel, 'citizen.mood')).toBe(`${Math.round(record.mood * 1000) / 10}%`);
      expect(field(panel, 'citizen.home')).toContain(composition.world.buildingById(record.homeBuildingId)?.name ?? '');
      expect(field(panel, 'citizen.home.address')).toBe(
        composition.world.buildingById(record.homeBuildingId)?.address ?? '—',
      );

      // Routine detail only the live citizens system can supply.
      expect(field(panel, 'citizen.stage')).toBe(details?.live?.stage);
      expect(field(panel, 'citizen.activity')).toBe(details?.live?.activity);
      expect(field(panel, 'citizen.shift')).toBe(details?.shiftHours);
      expect(field(panel, 'citizen.commute')).toBe(details?.commuteMode);
      expect(field(panel, 'citizen.entertainment')).toContain(details?.entertainmentVenueName ?? '');

      // Needs and the full schedule timeline.
      expect(listItems(panel, 'citizen.needs')).toHaveLength(record.needs.length);
      const scheduleRows = listItems(panel, 'citizen.schedule');
      expect(scheduleRows).toHaveLength(record.schedule.length);
      expect(listValues(panel, 'citizen.schedule', 'slot.window')).toEqual(
        record.schedule.map((slot) => scheduleSlotWindowLabel(slot)),
      );
      const states = scheduleRows.map((row) => row.dataset.state);
      expect(states.filter((state) => state === 'current')).toHaveLength(1);
      expect(states).toContain('next');

      // The panel follows the walker as the simulation keeps running.
      const panelNode = inspector.element;
      const positionNode = panel.querySelector('[data-field="citizen.position"]');
      let previous = field(panel, 'citizen.position');
      let changes = 0;
      for (let step = 0; step < 45; step += 1) {
        composition.advance(1);
        expect(inspector.update()).toBe(true);
        const live = citizens.liveStateFor(citizenId);
        const current = field(panel, 'citizen.position');
        expect(current).toBe(formatPosition(live?.position ?? record.position));
        if (current !== previous) {
          changes += 1;
        }
        previous = current;
        expect(panel.dataset.entityId).toBe(citizenId);
      }
      expect(changes).toBeGreaterThan(0);
      expect(inspector.element).toBe(panelNode);
      expect(panel.querySelector('[data-field="citizen.position"]')).toBe(positionNode);
      expect(field(panel, 'citizen.activity')).toBe(citizens.liveStateFor(citizenId)?.activity);
    });
  });

  it('picks an en-route vehicle and shows its route, occupancy and fuel', () => {
    withComposition('inspector-vehicle', (composition) => {
      const { inspector, panel, vehicles } = composition;
      composition.advance(MORNING_MINUTES);

      const target = findPickableVehicle(composition, true) ?? findPickableVehicle(composition, false);
      expect(target).not.toBeNull();
      const vehicleId = (target as PickTarget).id;

      clickScreen(composition, (target as PickTarget).screen);

      expect(inspector.selectedKind).toBe('vehicle');
      expect(panel.dataset.entityId).toBe(vehicleId);

      const details = vehicles.detailsFor(vehicleId);
      const record = vehicleById(composition, vehicleId);
      expect(details).not.toBeNull();

      expect(field(panel, 'vehicle.plate')).toBe(record.plate);
      expect(field(panel, 'vehicle.role')).toBe(details?.role);
      expect(field(panel, 'vehicle.activity')).toBe(details?.activity);
      expect(field(panel, 'vehicle.capacity')).toBe(String(record.capacity));
      expect(field(panel, 'vehicle.occupancy')).toBe(`${record.occupancy} / ${record.capacity}`);
      expect(field(panel, 'vehicle.speed')).toBe(`${Number(record.speed.toFixed(2))} tiles / min`);
      expect(field(panel, 'vehicle.route.id')).toBe(record.route.id);
      expect(field(panel, 'vehicle.route.kind')).toBe(record.route.kind);
      expect(field(panel, 'vehicle.route.loop')).toBe(record.route.loop ? 'yes' : 'no');

      const stops = listItems(panel, 'vehicle.stops');
      expect(stops.length).toBeGreaterThan(0);
      expect(listValues(panel, 'vehicle.stops', 'stop.node')).toEqual(
        (details?.stops ?? []).slice(0, MAX_LIST_ROWS).map((stop) => stop.nodeId),
      );
      expect(field(panel, 'vehicle.riders.count')).toBe(String(record.occupantIds.length));
      expect(listValues(panel, 'vehicle.occupants', 'occupant.id')).toEqual(
        record.occupantIds.slice(0, MAX_LIST_ROWS),
      );

      // The readings keep tracking the moving vehicle.
      const fuelNode = panel.querySelector('[data-field="vehicle.fuel"]');
      const positionNode = panel.querySelector('[data-field="vehicle.position"]');
      let moved = 0;
      let previous = field(panel, 'vehicle.position');
      for (let step = 0; step < 20; step += 1) {
        composition.advance(1);
        expect(inspector.update()).toBe(true);
        const live = vehicleById(composition, vehicleId);
        expect(field(panel, 'vehicle.fuel')).toBe(
          `${Number(live.fuel.toFixed(2))} / ${Number(live.fuelCapacity.toFixed(2))}`,
        );
        const current = field(panel, 'vehicle.position');
        expect(current).toBe(formatPosition(live.position));
        expect(field(panel, 'vehicle.occupancy')).toBe(`${live.occupancy} / ${live.capacity}`);
        if (current !== previous) {
          moved += 1;
        }
        previous = current;
      }
      expect(moved).toBeGreaterThan(0);
      expect(panel.querySelector('[data-field="vehicle.fuel"]')).toBe(fuelNode);
      expect(panel.querySelector('[data-field="vehicle.position"]')).toBe(positionNode);
    });
  });

  it('picks an occupied building and shows its occupants and operator', () => {
    withComposition('inspector-building', (composition) => {
      const { inspector, panel, citizens, world } = composition;
      composition.advance(MORNING_MINUTES);

      const target = findPickableBuilding(composition, true) ?? findPickableBuilding(composition, false);
      expect(target).not.toBeNull();
      const buildingId = (target as PickTarget).id;

      clickScreen(composition, (target as PickTarget).screen);

      expect(inspector.selectedKind).toBe('building');
      expect(panel.dataset.entityId).toBe(buildingId);

      const building = buildingById(composition, buildingId);
      expect(field(panel, 'building.name')).toBe(building.name);
      expect(field(panel, 'building.kind')).toBe(building.kind);
      expect(field(panel, 'building.address')).toBe(building.address);
      expect(field(panel, 'building.capacity')).toBe(String(building.capacity));
      expect(field(panel, 'building.jobslots')).toBe(String(building.jobSlots));
      expect(field(panel, 'building.occupants.count')).toBe(String(building.occupantIds.length));

      const expectedOccupants = building.occupantIds.slice(0, MAX_LIST_ROWS);
      expect(listValues(panel, 'building.occupants', 'occupant.id')).toEqual(expectedOccupants);
      expect(listValues(panel, 'building.occupants', 'occupant.name')).toEqual(
        expectedOccupants.map((id) => citizens.citizenById(id)?.name ?? id),
      );

      const households = new Set(building.residentHouseholdIds);
      const residents = world.citizens.filter(
        (citizen) => citizen.homeBuildingId === buildingId || households.has(citizen.householdId),
      );
      const workers = world.citizens.filter((citizen) => citizen.occupation.workplaceBuildingId === buildingId);
      expect(field(panel, 'building.residents.count')).toBe(String(residents.length));
      expect(field(panel, 'building.residents.households')).toBe(String(building.residentHouseholdIds.length));
      expect(field(panel, 'building.employees.count')).toBe(String(workers.length));
      expect(listValues(panel, 'building.employees', 'employee.id')).toEqual(
        workers.slice(0, MAX_LIST_ROWS).map((citizen) => citizen.id),
      );

      if (building.companyId) {
        const company = composition.companies.companyById(building.companyId);
        expect(field(panel, 'building.company')).toBe(`${company?.name} (${building.companyId})`);
      } else {
        expect(field(panel, 'building.company')).toBe('—');
      }

      // Occupancy stays live as citizens move in and out.
      const panelNode = inspector.element;
      for (let step = 0; step < 4; step += 1) {
        composition.advance(15);
        expect(inspector.update()).toBe(true);
        const live = buildingById(composition, buildingId);
        expect(field(panel, 'building.occupants.count')).toBe(String(live.occupantIds.length));
        expect(listItems(panel, 'building.occupants')).toHaveLength(Math.min(live.occupantIds.length, MAX_LIST_ROWS));
        expect(panel.dataset.entityId).toBe(buildingId);
      }
      expect(inspector.element).toBe(panelNode);
    });
  });

  it('inspects the company behind a picked building, ledger and staff included', () => {
    withComposition('inspector-company', (composition) => {
      const { inspector, panel, companies, citizens, world } = composition;
      composition.advance(MORNING_MINUTES);

      const staffed = [...world.buildings]
        .filter((building) => building.companyId !== null && building.occupantIds.length >= 0)
        .sort((left, right) => right.occupantIds.length - left.occupantIds.length);

      let picked: PickTarget | null = null;
      for (const building of staffed) {
        const centre = {
          x: building.footprint.x + building.footprint.width / 2,
          y: building.footprint.y + building.footprint.height / 2,
        };
        const screen = projectPoint(composition, centre);
        const pick = composition.picker.pickScreen(screen);
        if (pick.kind === 'building' && pick.id === building.id) {
          picked = { id: building.id, screen };
          break;
        }
      }
      expect(picked).not.toBeNull();

      clickScreen(composition, (picked as PickTarget).screen);
      const building = buildingById(composition, (picked as PickTarget).id);
      expect(inspector.selectedKind).toBe('building');

      // Follow the operator link the panel renders for an occupied premises.
      const link = panel.querySelector<HTMLButtonElement>(
        'button[data-action="inspect"][data-entity-kind="company"]',
      );
      expect(link).not.toBeNull();
      expect(link?.hidden).toBe(false);
      (link as HTMLButtonElement).click();

      expect(inspector.selectedKind).toBe('company');
      const companyId = inspector.selectedId as string;
      expect(companyId).toBe(building.companyId);
      const company = companies.companyById(companyId);
      expect(company).not.toBeNull();

      expect(field(panel, 'company.name')).toBe(company?.name);
      expect(field(panel, 'company.sector')).toBe(company?.sector);
      expect(field(panel, 'company.cash')).toBe(formatMoney(company?.cash ?? 0));
      expect(field(panel, 'company.state')).toBe(company?.state);
      expect(field(panel, 'company.address')).toBe(company?.address);
      expect(field(panel, 'company.building')).toBe(`${building.name} (${building.id})`);
      expect(field(panel, 'company.wage.hourly')).toBe(formatMoney(company?.wagePerHour ?? 0));
      expect(field(panel, 'company.employeeCount')).toBe(String(company?.employeeCount));

      // The roster is the company's own employee list, resolved to citizens.
      const employees = company?.employees ?? [];
      expect(field(panel, 'company.staff.count')).toBe(String(employees.length));
      expect(listValues(panel, 'company.staff', 'staff.id')).toEqual(employees.slice(0, MAX_LIST_ROWS));
      expect(listValues(panel, 'company.staff', 'staff.name')).toEqual(
        employees.slice(0, MAX_LIST_ROWS).map((id) => citizens.citizenById(id)?.name ?? id),
      );
      for (const id of employees.slice(0, MAX_LIST_ROWS)) {
        expect(citizens.citizenById(id)?.occupation.companyId).toBe(companyId);
      }

      // The hourly ledger mirrors the company's own revenue history.
      const history = company?.revenueHistory ?? [];
      expect(field(panel, 'company.ledger.hours')).toBe(String(history.length));
      expect(listItems(panel, 'company.ledger')).toHaveLength(Math.min(history.length, LEDGER_ROWS));
      const newest = history[history.length - 1];
      expect(listValues(panel, 'company.ledger', 'ledger.time').at(-1)).toBe(
        `Day ${newest.day}, ${String(newest.hour).padStart(2, '0')}:00`,
      );
      expect(listValues(panel, 'company.ledger', 'ledger.cash').at(-1)).toBe(formatMoney(newest.cashAfter));

      // Cash keeps following the hourly settlement.
      const cashNode = panel.querySelector('[data-field="company.cash"]');
      for (let step = 0; step < 3; step += 1) {
        composition.advance(MINUTES_PER_HOUR);
        expect(inspector.update()).toBe(true);
        expect(field(panel, 'company.cash')).toBe(formatMoney(companies.companyById(companyId)?.cash ?? 0));
      }
      expect(panel.querySelector('[data-field="company.cash"]')).toBe(cashNode);
    });
  });

  it('clears the selection on a ground click and on Escape', () => {
    withComposition('inspector-clear', (composition) => {
      const { inspector, panel } = composition;
      composition.advance(MORNING_MINUTES);

      const target = findPickableBuilding(composition, false);
      expect(target).not.toBeNull();
      clickScreen(composition, (target as PickTarget).screen);
      expect(inspector.isOpen).toBe(true);
      expect(panel.hidden).toBe(false);

      // Empty ground: the picker reports ground and the panel closes.
      const ground = findGroundPoint(composition);
      const groundScreen = projectPoint(composition, ground);
      const pick = composition.picker.pickScreen(groundScreen);
      expect(pick.kind).toBe('ground');
      clickScreen(composition, groundScreen);

      expect(inspector.isOpen).toBe(false);
      expect(panel.hidden).toBe(true);
      expect(panel.textContent).not.toContain(
        composition.world.buildingById((target as PickTarget).id)?.name ?? '',
      );

      // Escape clears the next selection just as well.
      const reselected = buildingById(composition, (target as PickTarget).id);
      clickScreen(
        composition,
        projectPoint(composition, {
          x: reselected.footprint.x + reselected.footprint.width / 2,
          y: reselected.footprint.y + reselected.footprint.height / 2,
        }),
      );
      expect(inspector.isOpen).toBe(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(inspector.isOpen).toBe(false);
      expect(panel.hidden).toBe(true);

      // Inspecting never perturbs the running simulation.
      const settlements = composition.companies.hoursSettledCount;
      const ticks = composition.fixture.engine.tickCount;
      composition.advance(30);
      expect(composition.companies.hoursSettledCount).toBeGreaterThanOrEqual(settlements);
      expect(composition.fixture.engine.tickCount).toBeGreaterThan(ticks);
      expect(composition.fixture.engine.getSystem('citizens')).toBe(composition.citizens);
      expect(composition.fixture.engine.getSystem('vehicles')).toBe(composition.vehicles);
    });
  });
});
