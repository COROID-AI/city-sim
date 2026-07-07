import {
  drawDetailPanel,
  buildBuildingDetails,
  buildCitizenDetails,
  buildVehicleDetails,
  detailForSelection,
  citizenAge,
  citizenHappiness,
  PANEL_FILL,
  PANEL_STROKE,
  PANEL_WIDTH,
  PANEL_MARGIN,
  PANEL_TOP,
  TITLE_COLOR,
} from './detailPanel';
import type { Selection } from './picking';
import type {
  Building,
  Citizen,
  Company,
  Tile,
  Vehicle,
  World,
} from '../sim/types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Build a minimal valid {@link World} with optional entities. */
function makeWorld(opts: {
  width?: number;
  height?: number;
  tiles?: Tile[];
  buildings?: Building[];
  citizens?: Citizen[];
  vehicles?: Vehicle[];
  companies?: Company[];
  elapsedHours?: number;
}): World {
  const width = opts.width ?? 1;
  const height = opts.height ?? 1;
  return {
    width,
    height,
    tiles: opts.tiles ?? [],
    buildings: new Map((opts.buildings ?? []).map((b) => [b.id, b])),
    citizens: new Map((opts.citizens ?? []).map((c) => [c.id, c])),
    vehicles: new Map((opts.vehicles ?? []).map((v) => [v.id, v])),
    companies: new Map((opts.companies ?? []).map((c) => [c.id, c])),
    simTime: { elapsedHours: opts.elapsedHours ?? 0 },
    budget: 0,
    derivedStats: {
      population: 0,
      employmentRate: 0,
      lastHourTaxIncome: 0,
      lastHourExpenses: 0,
    },
    lastEconomyHour: -1,
    lastRevenueBaseline: 0,
  };
}

/** Build a sample building. */
function makeBuilding(overrides: Partial<Building> = {}): Building {
  return {
    id: 'b0',
    kind: 'WORK',
    position: { x: 5, y: 5 },
    size: { width: 3, height: 3 },
    capacity: 10,
    name: 'Tech Hub',
    owner: null,
    ...overrides,
  };
}

/** Build a sample citizen. */
function makeCitizen(overrides: Partial<Citizen> = {}): Citizen {
  return {
    id: 'c0',
    home: 'b0',
    work: 'b1',
    entertainment: 'b2',
    state: { kind: 'HOME', buildingId: 'b0' },
    position: { x: 6, y: 6 },
    money: 500,
    path: [],
    pathIndex: 0,
    ...overrides,
  };
}

/** Build a sample vehicle. */
function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v0',
    kind: 'CAR',
    position: { x: 3, y: 3 },
    velocity: { x: 0, y: 0 },
    driver: 'c0',
    target: null,
    currentRoadPath: [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ],
    pathIndex: 2,
    pathProgress: 0.5,
    passengers: ['c1', 'c2'],
    speed: 30,
    fuel: 75.5,
    ...overrides,
  };
}

/** Build a sample company. */
function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'co0',
    name: 'Tech Hub',
    buildingId: 'b0',
    productKind: 'TECHNOLOGY',
    productivity: 1.0,
    employeeIds: ['c0', 'c1'],
    employees: [],
    revenue: 5000,
    expenses: 1500,
    dailyRevenue: 100,
    dailyExpenses: 30,
    profit: 3500,
    lastResetDay: 0,
    ...overrides,
  };
}

// ─── Mock canvas context ─────────────────────────────────────────────────────

type MockFn = jest.Mock;

interface MockCtx {
  ctx: CanvasRenderingContext2D;
  fillStyles: string[];
  strokeStyles: string[];
  lineWidths: number[];
  fonts: string[];
  texts: Array<{ text: string; x: number; y: number }>;
  fns: {
    save: MockFn;
    restore: MockFn;
    setTransform: MockFn;
    fillRect: MockFn;
    strokeRect: MockFn;
    fillText: MockFn;
  };
}

/** Recording mock for `CanvasRenderingContext2D`. */
function createMockCtx(): MockCtx {
  const fillStyles: string[] = [];
  const strokeStyles: string[] = [];
  const lineWidths: number[] = [];
  const fonts: string[] = [];
  const texts: Array<{ text: string; x: number; y: number }> = [];
  let currentFillStyle = '';
  let currentStrokeStyle = '';
  let currentLineWidth = 1;
  let currentFont = '';

  const save = jest.fn();
  const restore = jest.fn();
  const setTransform = jest.fn();
  const fillRect = jest.fn();
  const strokeRect = jest.fn();
  const fillText = jest.fn(
    (text: string, x: number, y: number) => void texts.push({ text, x, y }),
  );

  const ctx = {
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(value: string) {
      currentFillStyle = value;
      fillStyles.push(value);
    },
    get strokeStyle() {
      return currentStrokeStyle;
    },
    set strokeStyle(value: string) {
      currentStrokeStyle = value;
      strokeStyles.push(value);
    },
    get lineWidth() {
      return currentLineWidth;
    },
    set lineWidth(value: number) {
      currentLineWidth = value;
      lineWidths.push(value);
    },
    get font() {
      return currentFont;
    },
    set font(value: string) {
      currentFont = value;
      fonts.push(value);
    },
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save,
    restore,
    setTransform,
    fillRect,
    strokeRect,
    fillText,
  };

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    fillStyles,
    strokeStyles,
    lineWidths,
    fonts,
    texts,
    fns: { save, restore, setTransform, fillRect, strokeRect, fillText },
  };
}

const VIEW_H = 800;

/** Helper: find a row value by its label from drawn text. */
function findRowValue(texts: Array<{ text: string }>, label: string): string | undefined {
  // Values are right-aligned text that don't contain a colon.
  const entry = texts.find((t) => t.text === label);
  void entry;
  return undefined;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

describe('detailPanel exports', () => {
  it('exports drawDetailPanel as a function', () => {
    expect(typeof drawDetailPanel).toBe('function');
  });

  it('exports field builders', () => {
    expect(typeof buildBuildingDetails).toBe('function');
    expect(typeof buildCitizenDetails).toBe('function');
    expect(typeof buildVehicleDetails).toBe('function');
    expect(typeof detailForSelection).toBe('function');
  });
});

// ─── Building details ────────────────────────────────────────────────────────

describe('buildBuildingDetails', () => {
  it('includes name, kind, position, capacity, and occupants', () => {
    const building = makeBuilding();
    const world = makeWorld({ buildings: [building] });
    const content = buildBuildingDetails(world, building);
    const labels = content.rows.map((r) => r.label);
    expect(labels).toContain('Name');
    expect(labels).toContain('Kind');
    expect(labels).toContain('Position');
    expect(labels).toContain('Capacity');
    expect(labels).toContain('Occupants');
  });

  it('shows the building name as the title', () => {
    const building = makeBuilding({ name: 'Oak Apartments' });
    const world = makeWorld({ buildings: [building] });
    const content = buildBuildingDetails(world, building);
    expect(content.title).toBe('Oak Apartments');
  });

  it('includes company revenue and expenses when a company is associated', () => {
    const building = makeBuilding({ id: 'b0' });
    const company = makeCompany({ buildingId: 'b0' });
    const world = makeWorld({ buildings: [building], companies: [company] });
    const content = buildBuildingDetails(world, building);
    const labels = content.rows.map((r) => r.label);
    expect(labels).toContain('Company');
    expect(labels).toContain('Revenue');
    expect(labels).toContain('Expenses');
    expect(labels).toContain('Profit');
  });

  it('omits company stats when no company is associated', () => {
    const building = makeBuilding({ id: 'b0', kind: 'HOME' });
    const world = makeWorld({ buildings: [building] });
    const content = buildBuildingDetails(world, building);
    const labels = content.rows.map((r) => r.label);
    expect(labels).not.toContain('Company');
  });

  it('counts occupants currently in the building', () => {
    const building = makeBuilding({ id: 'b0' });
    const citizenAtBuilding = makeCitizen({
      id: 'c0',
      state: { kind: 'WORKING', buildingId: 'b0' },
    });
    const citizenElsewhere = makeCitizen({
      id: 'c1',
      state: { kind: 'HOME', buildingId: 'b9' },
    });
    const world = makeWorld({
      buildings: [building],
      citizens: [citizenAtBuilding, citizenElsewhere],
    });
    const content = buildBuildingDetails(world, building);
    const occupants = content.rows.find((r) => r.label === 'Occupants');
    expect(occupants?.value).toBe('1');
  });

  it('formats the position as (x, y)', () => {
    const building = makeBuilding({ position: { x: 12, y: 34 } });
    const world = makeWorld({ buildings: [building] });
    const content = buildBuildingDetails(world, building);
    const pos = content.rows.find((r) => r.label === 'Position');
    expect(pos?.value).toBe('(12, 34)');
  });
});

// ─── Citizen details ─────────────────────────────────────────────────────────

describe('buildCitizenDetails', () => {
  it('includes name, age, happiness, money, home, work, schedule state, and position', () => {
    const citizen = makeCitizen();
    const world = makeWorld({ citizens: [citizen] });
    const content = buildCitizenDetails(world, citizen);
    const labels = content.rows.map((r) => r.label);
    expect(labels).toContain('Name');
    expect(labels).toContain('Age');
    expect(labels).toContain('Happiness');
    expect(labels).toContain('Money');
    expect(labels).toContain('Home');
    expect(labels).toContain('Work');
    expect(labels).toContain('Schedule');
    expect(labels).toContain('Position');
  });

  it('includes the current activity field', () => {
    const citizen = makeCitizen();
    const world = makeWorld({ citizens: [citizen] });
    const content = buildCitizenDetails(world, citizen);
    const labels = content.rows.map((r) => r.label);
    expect(labels).toContain('Activity');
  });

  it('shows the citizen name as the title', () => {
    const citizen = makeCitizen({ id: 'c5' });
    const world = makeWorld({ citizens: [citizen] });
    const content = buildCitizenDetails(world, citizen);
    // citizenName is deterministic; c5 → firstNames[5%24], lastNames[(5*7+3)%24]
    expect(content.title).not.toBe('');
    expect(content.subtitle).toContain('Citizen');
  });

  it('marks unemployed citizens', () => {
    const citizen = makeCitizen({ work: null });
    const world = makeWorld({ citizens: [citizen] });
    const content = buildCitizenDetails(world, citizen);
    const work = content.rows.find((r) => r.label === 'Work');
    expect(work?.value).toBe('Unemployed');
  });

  it('shows a home building name when assigned', () => {
    const building = makeBuilding({ id: 'b0', name: 'Home Sweet Home' });
    const citizen = makeCitizen({ home: 'b0' });
    const world = makeWorld({ buildings: [building], citizens: [citizen] });
    const content = buildCitizenDetails(world, citizen);
    const home = content.rows.find((r) => r.label === 'Home');
    expect(home?.value).toBe('Home Sweet Home');
  });

  it('formats the position with one decimal place', () => {
    const citizen = makeCitizen({ position: { x: 6.5, y: 7.25 } });
    const world = makeWorld({ citizens: [citizen] });
    const content = buildCitizenDetails(world, citizen);
    const pos = content.rows.find((r) => r.label === 'Position');
    expect(pos?.value).toBe('(6.5, 7.3)');
  });

  it('reflects the schedule state from the simulation clock', () => {
    const citizen = makeCitizen();
    // At 12:00 (noon) the schedule state is 'atWork'.
    const world = makeWorld({ citizens: [citizen], elapsedHours: 12 });
    const content = buildCitizenDetails(world, citizen);
    const schedule = content.rows.find((r) => r.label === 'Schedule');
    expect(schedule?.value).toBe('At Work');
  });

  it('shows the night schedule state at midnight', () => {
    const citizen = makeCitizen();
    const world = makeWorld({ citizens: [citizen], elapsedHours: 0 });
    const content = buildCitizenDetails(world, citizen);
    const schedule = content.rows.find((r) => r.label === 'Schedule');
    expect(schedule?.value).toBe('Home');
  });
});

// ─── Vehicle details ─────────────────────────────────────────────────────────

describe('buildVehicleDetails', () => {
  it('includes id, kind, driver, passengers, path index, speed, and fuel', () => {
    const vehicle = makeVehicle();
    const world = makeWorld({ vehicles: [vehicle] });
    const content = buildVehicleDetails(world, vehicle);
    const labels = content.rows.map((r) => r.label);
    expect(labels).toContain('ID');
    expect(labels).toContain('Kind');
    expect(labels).toContain('Driver');
    expect(labels).toContain('Passengers');
    expect(labels).toContain('Path Index');
    expect(labels).toContain('Speed');
    expect(labels).toContain('Fuel');
  });

  it('shows the vehicle id and kind as the title', () => {
    const vehicle = makeVehicle({ id: 'v3', kind: 'TRUCK' });
    const world = makeWorld({ vehicles: [vehicle] });
    const content = buildVehicleDetails(world, vehicle);
    expect(content.title).toContain('v3');
    expect(content.title).toContain('TRUCK');
  });

  it('formats fuel as a percentage', () => {
    const vehicle = makeVehicle({ fuel: 42.3 });
    const world = makeWorld({ vehicles: [vehicle] });
    const content = buildVehicleDetails(world, vehicle);
    const fuel = content.rows.find((r) => r.label === 'Fuel');
    expect(fuel?.value).toContain('42.3');
    expect(fuel?.value).toContain('%');
  });

  it('formats speed with units', () => {
    const vehicle = makeVehicle({ speed: 30 });
    const world = makeWorld({ vehicles: [vehicle] });
    const content = buildVehicleDetails(world, vehicle);
    const speed = content.rows.find((r) => r.label === 'Speed');
    expect(speed?.value).toContain('30');
    expect(speed?.value).toContain('cells/hr');
  });

  it('shows passenger count and names', () => {
    const vehicle = makeVehicle({ passengers: ['c1', 'c2'] });
    const world = makeWorld({ vehicles: [vehicle] });
    const content = buildVehicleDetails(world, vehicle);
    const passengers = content.rows.find((r) => r.label === 'Passengers');
    expect(passengers?.value).toContain('2');
  });

  it('shows 0 passengers when none', () => {
    const vehicle = makeVehicle({ passengers: [] });
    const world = makeWorld({ vehicles: [vehicle] });
    const content = buildVehicleDetails(world, vehicle);
    const passengers = content.rows.find((r) => r.label === 'Passengers');
    expect(passengers?.value).toBe('0');
  });

  it('shows the current path index relative to the path length', () => {
    const vehicle = makeVehicle();
    const world = makeWorld({ vehicles: [vehicle] });
    const content = buildVehicleDetails(world, vehicle);
    const pathIdx = content.rows.find((r) => r.label === 'Path Index');
    // pathIndex=2, path length=3
    expect(pathIdx?.value).toContain('2');
    expect(pathIdx?.value).toContain('3');
  });

  it('shows None for driver when null', () => {
    const vehicle = makeVehicle({ driver: null });
    const world = makeWorld({ vehicles: [vehicle] });
    const content = buildVehicleDetails(world, vehicle);
    const driver = content.rows.find((r) => r.label === 'Driver');
    expect(driver?.value).toBe('None');
  });
});

// ─── Derived attributes ──────────────────────────────────────────────────────

describe('citizenAge', () => {
  it('returns a deterministic age between 18 and 64', () => {
    const age0 = citizenAge('c0');
    const age0Again = citizenAge('c0');
    expect(age0).toBe(age0Again); // deterministic
    expect(age0).toBeGreaterThanOrEqual(18);
    expect(age0).toBeLessThanOrEqual(64);
  });

  it('produces different ages for different citizens', () => {
    // Not guaranteed for every pair, but c0 and c1 differ.
    const age0 = citizenAge('c0');
    const age1 = citizenAge('c1');
    // c0: 0%47=0 → 18; c1: 1%47=1 → 19
    expect(age0).toBe(18);
    expect(age1).toBe(19);
  });
});

describe('citizenHappiness', () => {
  it('is higher for employed citizens than unemployed (same money)', () => {
    const employed = makeCitizen({ work: 'b1', money: 500 });
    const unemployed = makeCitizen({ work: null, money: 500 });
    const happyE = citizenHappiness(employed);
    const happyU = citizenHappiness(unemployed);
    expect(happyE).toBeGreaterThan(happyU);
  });

  it('is clamped to [0, 100]', () => {
    const rich = makeCitizen({ work: 'b1', money: 99999 });
    const poor = makeCitizen({ work: null, money: 0 });
    expect(citizenHappiness(rich)).toBeLessThanOrEqual(100);
    expect(citizenHappiness(poor)).toBeGreaterThanOrEqual(0);
  });
});

// ─── detailForSelection dispatch ─────────────────────────────────────────────

describe('detailForSelection', () => {
  it('returns null for a null selection', () => {
    const world = makeWorld({});
    expect(detailForSelection(world, null)).toBeNull();
  });

  it('returns building details for a building selection', () => {
    const building = makeBuilding({ id: 'b0', name: 'Test' });
    const world = makeWorld({ buildings: [building] });
    const sel: Selection = { kind: 'building', id: 'b0' };
    const content = detailForSelection(world, sel);
    expect(content).not.toBeNull();
    expect(content!.title).toBe('Test');
  });

  it('returns citizen details for a citizen selection', () => {
    const citizen = makeCitizen({ id: 'c0' });
    const world = makeWorld({ citizens: [citizen] });
    const sel: Selection = { kind: 'citizen', id: 'c0' };
    const content = detailForSelection(world, sel);
    expect(content).not.toBeNull();
    expect(content!.subtitle).toContain('Citizen');
  });

  it('returns vehicle details for a vehicle selection', () => {
    const vehicle = makeVehicle({ id: 'v0' });
    const world = makeWorld({ vehicles: [vehicle] });
    const sel: Selection = { kind: 'vehicle', id: 'v0' };
    const content = detailForSelection(world, sel);
    expect(content).not.toBeNull();
    expect(content!.subtitle).toContain('Vehicle');
  });

  it('returns null when the selected building no longer exists', () => {
    const world = makeWorld({});
    const sel: Selection = { kind: 'building', id: 'b999' };
    expect(detailForSelection(world, sel)).toBeNull();
  });

  it('returns null when the selected citizen no longer exists', () => {
    const world = makeWorld({});
    const sel: Selection = { kind: 'citizen', id: 'c999' };
    expect(detailForSelection(world, sel)).toBeNull();
  });

  it('returns null when the selected vehicle no longer exists', () => {
    const world = makeWorld({});
    const sel: Selection = { kind: 'vehicle', id: 'v999' };
    expect(detailForSelection(world, sel)).toBeNull();
  });
});

// ─── Canvas rendering ────────────────────────────────────────────────────────

describe('drawDetailPanel rendering', () => {
  it('does nothing when no selection', () => {
    const { ctx, fns } = createMockCtx();
    const world = makeWorld({});
    drawDetailPanel(ctx, world, null, VIEW_H);
    expect(fns.fillRect).not.toHaveBeenCalled();
    expect(fns.fillText).not.toHaveBeenCalled();
  });

  it('draws a background panel for a building selection', () => {
    const { ctx, fns, fillStyles } = createMockCtx();
    const building = makeBuilding();
    const world = makeWorld({ buildings: [building] });
    const sel: Selection = { kind: 'building', id: 'b0' };
    drawDetailPanel(ctx, world, sel, VIEW_H);
    expect(fns.fillRect).toHaveBeenCalled();
    expect(fillStyles).toContain(PANEL_FILL);
  });

  it('draws a stroke outline for the panel', () => {
    const { ctx, fns, strokeStyles } = createMockCtx();
    const building = makeBuilding();
    const world = makeWorld({ buildings: [building] });
    const sel: Selection = { kind: 'building', id: 'b0' };
    drawDetailPanel(ctx, world, sel, VIEW_H);
    expect(fns.strokeRect).toHaveBeenCalled();
    expect(strokeStyles).toContain(PANEL_STROKE);
  });

  it('draws text for each detail row', () => {
    const { ctx, texts } = createMockCtx();
    const building = makeBuilding({ name: 'My Building' });
    const world = makeWorld({ buildings: [building] });
    const sel: Selection = { kind: 'building', id: 'b0' };
    drawDetailPanel(ctx, world, sel, VIEW_H);
    // The title should appear in the drawn text.
    const titleText = texts.find((t) => t.text === 'My Building');
    expect(titleText).toBeDefined();
    // At least one row label should appear.
    const labelText = texts.find((t) => t.text === 'Name:');
    expect(labelText).toBeDefined();
  });

  it('uses the title colour for the title', () => {
    const { ctx, fillStyles } = createMockCtx();
    const building = makeBuilding();
    const world = makeWorld({ buildings: [building] });
    const sel: Selection = { kind: 'building', id: 'b0' };
    drawDetailPanel(ctx, world, sel, VIEW_H);
    expect(fillStyles).toContain(TITLE_COLOR);
  });

  it('draws a citizen panel with citizen details', () => {
    const { ctx, texts } = createMockCtx();
    const citizen = makeCitizen({ id: 'c0' });
    const world = makeWorld({ citizens: [citizen] });
    const sel: Selection = { kind: 'citizen', id: 'c0' };
    drawDetailPanel(ctx, world, sel, VIEW_H);
    const happiness = texts.find((t) => t.text === 'Happiness:');
    expect(happiness).toBeDefined();
  });

  it('draws a vehicle panel with vehicle details', () => {
    const { ctx, texts } = createMockCtx();
    const vehicle = makeVehicle({ id: 'v0' });
    const world = makeWorld({ vehicles: [vehicle] });
    const sel: Selection = { kind: 'vehicle', id: 'v0' };
    drawDetailPanel(ctx, world, sel, VIEW_H);
    const fuel = texts.find((t) => t.text === 'Fuel:');
    expect(fuel).toBeDefined();
  });

  it('positions the panel at the left margin with correct width', () => {
    const { ctx, fns } = createMockCtx();
    const building = makeBuilding();
    const world = makeWorld({ buildings: [building] });
    const sel: Selection = { kind: 'building', id: 'b0' };
    drawDetailPanel(ctx, world, sel, VIEW_H);
    const fillCalls = fns.fillRect.mock.calls as Array<
      [number, number, number, number]
    >;
    // The first fillRect is the panel background.
    const panel = fillCalls[0]!;
    expect(panel[0]).toBe(PANEL_MARGIN);
    expect(panel[1]).toBe(PANEL_TOP);
    expect(panel[2]).toBe(PANEL_WIDTH);
  });

  it('is a no-op when the selected entity has been removed', () => {
    const { ctx, fns } = createMockCtx();
    const world = makeWorld({});
    const sel: Selection = { kind: 'building', id: 'b-gone' };
    drawDetailPanel(ctx, world, sel, VIEW_H);
    expect(fns.fillRect).not.toHaveBeenCalled();
  });

  it('saves and restores the canvas state', () => {
    const { ctx, fns } = createMockCtx();
    const building = makeBuilding();
    const world = makeWorld({ buildings: [building] });
    const sel: Selection = { kind: 'building', id: 'b0' };
    drawDetailPanel(ctx, world, sel, VIEW_H);
    expect(fns.save).toHaveBeenCalledTimes(1);
    expect(fns.restore).toHaveBeenCalledTimes(1);
  });
});
