/**
 * Entity detail panel rendering.
 *
 * `drawDetailPanel` paints a side panel listing all detailed fields for
 * the currently selected building, citizen, or vehicle.  It is driven by
 * a {@link Selection} produced by {@link pickEntityAt} (see `picking.ts`).
 *
 * The panel is drawn entirely in **screen space** (identity transform),
 * anchored to the left side of the viewport so it does not overlap the
 * minimap (bottom-right) or the HUD (top).  Like `drawMinimap`, the
 * transform is reset defensively via `save` / `setTransform` / `restore`.
 *
 * Field builders (`buildBuildingDetails`, `buildCitizenDetails`,
 * `buildVehicleDetails`) are exported separately so tests can verify the
 * exact label/value pairs without a canvas context.
 */

import type {
  Building,
  Citizen,
  Company,
  Vehicle,
  World,
} from '../sim/types';
import { citizenName } from '../sim/companies';
import { determineScheduleState, type ScheduleState } from '../sim/citizens';
import type { Selection } from './picking';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A single labelled value displayed in the detail panel.
 *
 * Each row has a bold label on the left and a value on the right.
 */
export interface DetailRow {
  /** Human-readable field label (e.g. `"Name"`, `"Fuel"`). */
  readonly label: string;
  /** Formatted field value (e.g. `"Oak Apartments"`, `"87 %"`). */
  readonly value: string;
}

/**
 * Aggregated detail content for a selected entity.
 *
 * `title` is the panel header (entity name or ID); `kind` is the entity
 * category displayed as a sub-header; `rows` are the label/value pairs.
 */
export interface DetailContent {
  /** Panel header text. */
  readonly title: string;
  /** Entity category sub-header (e.g. `"Building — HOME"`). */
  readonly subtitle: string;
  /** Ordered list of detail rows. */
  readonly rows: DetailRow[];
}

// ─── Layout constants ────────────────────────────────────────────────────────

/** Panel width in screen pixels. */
export const PANEL_WIDTH = 300;

/** Panel left/right padding in pixels. */
export const PANEL_PADDING = 14;

/** Panel gap from the left screen edge. */
export const PANEL_MARGIN = 12;

/** Vertical position of the panel's top edge. */
export const PANEL_TOP = 48;

/** Title row height in pixels. */
export const TITLE_HEIGHT = 30;

/** Subtitle row height in pixels. */
export const SUBTITLE_HEIGHT = 22;

/** Each detail row's height in pixels. */
export const ROW_HEIGHT = 20;

// ─── Colours ─────────────────────────────────────────────────────────────────

/** Panel background colour (semi-transparent dark). */
export const PANEL_FILL = 'rgba(0, 0, 0, 0.7)';

/** Panel outline colour. */
export const PANEL_STROKE = 'rgba(255, 255, 255, 0.25)';

/** Title text colour. */
export const TITLE_COLOR = '#ffffff';

/** Subtitle text colour. */
export const SUBTITLE_COLOR = 'rgba(255, 255, 255, 0.65)';

/** Label text colour. */
export const LABEL_COLOR = 'rgba(255, 255, 255, 0.55)';

/** Value text colour. */
export const VALUE_COLOR = '#e0e0e0';

// ─── Derived citizen attributes ──────────────────────────────────────────────

/**
 * Derive a citizen's age deterministically from their ID.
 *
 * Ages range from 18 to 64.  The numeric suffix of the citizen ID is
 * used so the same citizen always shows the same age.
 */
export function citizenAge(citizenId: string): number {
  const match = citizenId.match(/\d+$/);
  const n = match ? Number.parseInt(match[0], 10) : 0;
  return 18 + (n % 47); // 18–64
}

/**
 * Derive a citizen's happiness score (0–100) from employment and money.
 *
 * Formula: 40 base + 30 if employed + up to 30 from money, clamped to
 * `[0, 100]`.
 *
 * @param citizen The citizen whose happiness to compute.
 */
export function citizenHappiness(citizen: Citizen): number {
  const employed = citizen.work !== null;
  const moneyFactor = Math.min(30, Math.max(0, citizen.money) / 33.33);
  const score = 40 + (employed ? 30 : 0) + moneyFactor;
  return Math.round(Math.min(100, Math.max(0, score)));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return the company whose workplace building is `buildingId`, or
 * `undefined` if none.
 */
function companyForBuilding(
  world: World,
  buildingId: string,
): Company | undefined {
  for (const company of world.companies.values()) {
    if (company.buildingId === buildingId) return company;
  }
  return undefined;
}

/**
 * Count citizens currently occupying a building (their FSM state's
 * buildingId matches the given id).
 */
function countOccupants(world: World, buildingId: string): number {
  let count = 0;
  for (const c of world.citizens.values()) {
    switch (c.state.kind) {
      case 'HOME':
      case 'WORKING':
      case 'ENTERTAINMENT':
        if (c.state.buildingId === buildingId) count++;
        break;
      default:
        break;
    }
  }
  return count;
}

/**
 * Return a building's display name, or its ID if the building doesn't
 * exist.
 */
function buildingLabel(world: World, id: string | null): string {
  if (id === null) return '—';
  const b = world.buildings.get(id);
  return b ? b.name : id;
}

/**
 * Format a citizen's schedule state for display.
 */
function scheduleStateLabel(state: ScheduleState): string {
  switch (state) {
    case 'home':
      return 'Home';
    case 'commutingToWork':
      return 'Commuting → Work';
    case 'atWork':
      return 'At Work';
    case 'commutingToEntertainment':
      return 'Commuting → Leisure';
    case 'atEntertainment':
      return 'At Leisure';
  }
}

/**
 * Format a citizen's current FSM activity for display.
 */
function activityLabel(citizen: Citizen): string {
  switch (citizen.state.kind) {
    case 'HOME':
      return `Home (${citizen.state.buildingId})`;
    case 'WORKING':
      return `Working (${citizen.state.buildingId})`;
    case 'ENTERTAINMENT':
      return `Leisure (${citizen.state.buildingId})`;
    case 'COMMUTING':
      return `Travelling: ${citizen.state.fromId} → ${citizen.state.toId} (${Math.round(citizen.state.progress * 100)}%)`;
    case 'RETURNING':
      return `Returning: ${citizen.state.fromId} → ${citizen.state.toId} (${Math.round(citizen.state.progress * 100)}%)`;
  }
}

/**
 * Format a citizen ID as a display name (or `"None"` for null).
 */
function citizenIdLabel(id: string | null): string {
  if (id === null) return 'None';
  return citizenName(id);
}

// ─── Field builders ──────────────────────────────────────────────────────────

/**
 * Build the detail rows for a building.
 *
 * Fields: name, kind, position, size, capacity, occupants, and (when a
 * company is associated) revenue, expenses, employees, and profit.
 *
 * @param world    The world (for occupant/company lookups).
 * @param building The selected building.
 */
export function buildBuildingDetails(
  world: World,
  building: Building,
): DetailContent {
  const rows: DetailRow[] = [
    { label: 'Name', value: building.name },
    { label: 'Kind', value: building.kind },
    {
      label: 'Position',
      value: `(${building.position.x}, ${building.position.y})`,
    },
    {
      label: 'Size',
      value: `${building.size.width} × ${building.size.height}`,
    },
    { label: 'Capacity', value: String(building.capacity) },
    {
      label: 'Occupants',
      value: String(countOccupants(world, building.id)),
    },
  ];

  // Associated company stats (for WORK buildings with a company).
  const company = companyForBuilding(world, building.id);
  if (company) {
    rows.push(
      { label: 'Company', value: company.name },
      { label: 'Product', value: company.productKind },
      { label: 'Employees', value: String(company.employeeIds.length) },
      {
        label: 'Revenue',
        value: `$${company.revenue.toLocaleString('en-US')}`,
      },
      {
        label: 'Expenses',
        value: `$${company.expenses.toLocaleString('en-US')}`,
      },
      {
        label: 'Profit',
        value: `$${company.profit.toLocaleString('en-US')}`,
      },
    );
  }

  return {
    title: building.name,
    subtitle: `Building — ${building.kind}`,
    rows,
  };
}

/**
 * Build the detail rows for a citizen.
 *
 * Fields: name, age, happiness, money, home, work, current activity,
 * schedule state, and position.
 *
 * @param world    The world (for building name lookups).
 * @param citizen  The selected citizen.
 */
export function buildCitizenDetails(
  world: World,
  citizen: Citizen,
): DetailContent {
  const schedule = determineScheduleState(citizen, world.simTime);

  const rows: DetailRow[] = [
    { label: 'Name', value: citizenName(citizen.id) },
    { label: 'Age', value: String(citizenAge(citizen.id)) },
    { label: 'Happiness', value: `${citizenHappiness(citizen)}%` },
    {
      label: 'Money',
      value: `$${citizen.money.toLocaleString('en-US')}`,
    },
    { label: 'Home', value: buildingLabel(world, citizen.home) },
    {
      label: 'Work',
      value:
        citizen.work !== null
          ? buildingLabel(world, citizen.work)
          : 'Unemployed',
    },
    { label: 'Activity', value: activityLabel(citizen) },
    { label: 'Schedule', value: scheduleStateLabel(schedule) },
    {
      label: 'Position',
      value: `(${citizen.position.x.toFixed(1)}, ${citizen.position.y.toFixed(1)})`,
    },
  ];

  return {
    title: citizenName(citizen.id),
    subtitle: `Citizen — ${citizen.id}`,
    rows,
  };
}

/**
 * Build the detail rows for a vehicle.
 *
 * Fields: ID, kind, driver, passengers, path index, speed, and fuel.
 *
 * @param world   The world (for driver/passenger name lookups).
 * @param vehicle The selected vehicle.
 */
export function buildVehicleDetails(
  world: World,
  vehicle: Vehicle,
): DetailContent {
  const passengerNames = vehicle.passengers.map((id) => citizenName(id));

  const rows: DetailRow[] = [
    { label: 'ID', value: vehicle.id },
    { label: 'Kind', value: vehicle.kind },
    { label: 'Driver', value: citizenIdLabel(vehicle.driver) },
    {
      label: 'Passengers',
      value:
        passengerNames.length > 0
          ? `${passengerNames.length} (${passengerNames.join(', ')})`
          : '0',
    },
    {
      label: 'Path Index',
      value: `${vehicle.pathIndex} / ${vehicle.currentRoadPath.length}`,
    },
    {
      label: 'Speed',
      value: `${vehicle.speed.toFixed(1)} cells/hr`,
    },
    { label: 'Fuel', value: `${vehicle.fuel.toFixed(1)}%` },
    {
      label: 'Position',
      value: `(${vehicle.position.x.toFixed(1)}, ${vehicle.position.y.toFixed(1)})`,
    },
  ];

  // Suppress unused-parameter lint in case world is only needed for
  // passenger/driver name lookups (it is used via citizenName which only
  // needs the ID, so we reference world to keep the signature stable).
  void world;

  return {
    title: `${vehicle.kind} ${vehicle.id}`,
    subtitle: `Vehicle — ${vehicle.kind}`,
    rows,
  };
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Resolve the {@link DetailContent} for a given selection, or `null` if
 * the selected entity no longer exists in the world.
 *
 * @param world     The simulation world.
 * @param selection The current selection (from {@link pickEntityAt}).
 */
export function detailForSelection(
  world: World,
  selection: Selection | null,
): DetailContent | null {
  if (!selection) return null;

  switch (selection.kind) {
    case 'building': {
      const building = world.buildings.get(selection.id);
      return building ? buildBuildingDetails(world, building) : null;
    }
    case 'citizen': {
      const citizen = world.citizens.get(selection.id);
      return citizen ? buildCitizenDetails(world, citizen) : null;
    }
    case 'vehicle': {
      const vehicle = world.vehicles.get(selection.id);
      return vehicle ? buildVehicleDetails(world, vehicle) : null;
    }
  }
}

// ─── Canvas rendering ────────────────────────────────────────────────────────

/**
 * Draw the detail panel onto `ctx` for the currently selected entity.
 *
 * If no entity is selected (or the selected entity no longer exists),
 * the function is a no-op.
 *
 * @param ctx       Canvas 2D context.
 * @param world     Simulation world.
 * @param selection Currently selected entity (from {@link pickEntityAt}),
 *                  or `null`.
 * @param viewportHeight Canvas height in pixels (for panel height calc).
 */
export function drawDetailPanel(
  ctx: CanvasRenderingContext2D,
  world: World,
  selection: Selection | null,
  viewportHeight: number,
): void {
  const content = detailForSelection(world, selection);
  if (!content) return;

  const x = PANEL_MARGIN;
  const y = PANEL_TOP;
  const w = PANEL_WIDTH;

  // Panel height: title + subtitle + rows, padded.
  const innerHeight =
    TITLE_HEIGHT + SUBTITLE_HEIGHT + content.rows.length * ROW_HEIGHT;
  const panelHeight = innerHeight + PANEL_PADDING * 2;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // screen space

  // ── Panel background ─────────────────────────────────────────────────────
  ctx.fillStyle = PANEL_FILL;
  ctx.fillRect(x, y, w, panelHeight);
  ctx.strokeStyle = PANEL_STROKE;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, panelHeight);

  // ── Text ─────────────────────────────────────────────────────────────────
  const textX = x + PANEL_PADDING;
  let cursorY = y + PANEL_PADDING;

  // Title
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = TITLE_COLOR;
  ctx.fillText(content.title, textX, cursorY);
  cursorY += TITLE_HEIGHT;

  // Subtitle
  ctx.font = '12px monospace';
  ctx.fillStyle = SUBTITLE_COLOR;
  ctx.fillText(content.subtitle, textX, cursorY);
  cursorY += SUBTITLE_HEIGHT;

  // Detail rows: label (left, dim) + value (right-aligned, bright)
  ctx.font = '13px monospace';
  const valueX = x + w - PANEL_PADDING;
  for (const row of content.rows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${row.label}:`, textX, cursorY);

    ctx.textAlign = 'right';
    ctx.fillStyle = VALUE_COLOR;
    ctx.fillText(row.value, valueX, cursorY);

    cursorY += ROW_HEIGHT;
  }

  ctx.restore();
}
