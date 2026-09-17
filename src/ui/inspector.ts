/**
 * The entity detail inspector: a DOM panel that renders the **full record** of
 * whichever citizen, company, vehicle or building is selected, and keeps every
 * field live while the selection stays.
 *
 * The product requirement is explicit — *"the details of all entities should be
 * in great detail"* — so this panel is the user-facing surface for everything
 * the simulation tracks: a citizen's identity, job, income, mood, needs and
 * daily schedule timeline (past / current / next stops); a company's sector,
 * state, cash, revenue and cost ledger and staff roster; a vehicle's kind,
 * plate, capacity, occupancy, fuel, route and passengers; a building's kind,
 * address, occupants, resident/employee counts and owner company.
 *
 * ## Design
 *
 * - **Purely a reader.** The inspector never writes to the simulation. Every
 *   field is a getter re-evaluated on refresh, resolving the entity by id
 *   through the injected {@link InspectorSources}, so it works with raw
 *   `WorldMap` records and gets richer automatically when the live systems are
 *   available (`CitizensSystem.detailsFor`, `VehiclesSystem.detailsFor`,
 *   `CompaniesSystem.companyById/ledgerFor`).
 * - **Follow by id.** The selection is `{ kind, id }`, never an object
 *   reference. A moving citizen, an en-route vehicle or a changing occupant
 *   list therefore needs no re-selection: {@link EntityInspector.update}
 *   refreshes the values in place on the throttled cadence
 *   ({@link DEFAULT_REFRESH_INTERVAL_MS} by default) without recreating the
 *   panel, its sections or its field nodes.
 * - **Explicit clearing.** Clicking empty ground (through
 *   {@link EntityInspector.bindPicking}) or pressing `Esc`
 *   ({@link EntityInspector.handleKeyDown}) clears the selection and hides the
 *   panel; the DOM is emptied so no stale field survives a swap or a clear.
 * - **DOM contract.** Every value node carries `data-field="<key>"`, sections
 *   carry `data-section`, lists carry `data-list` and rows `data-item-key` /
 *   `data-item-index` / `data-state`, so hosts and tests can address the record
 *   by name. The panel exposes `data-kind` and `data-entity-id` for the current
 *   selection.
 *
 * The module is import-safe outside a browser: nothing touches `document` until
 * {@link EntityInspector.attach} is handed a host element.
 */

import './inspector.css';

import { MINUTES_PER_DAY } from '../sim/clock';
import type { CitizenDetails } from '../sim/citizens';
import type { CompanyLedgerEntry, CompanyRecord } from '../sim/companies';
import type {
  Building,
  Citizen,
  Company,
  EntityId,
  Need,
  ScheduleSlot,
  Vec2,
  Vehicle,
  VehicleRoute,
  WorldMap,
} from '../sim/types';
import { VEHICLE_KIND_SPECS } from '../sim/vehicles';
import type { VehicleDetails } from '../sim/vehicles';
import type { WorldBuilding } from '../sim/world';
import type { EntityPick, PickedEntityKind } from '../render/picking';

/* --------------------------------------------------------------- constants -- */

/** Cadence of the live refresh while an entity stays selected. */
export const DEFAULT_REFRESH_INTERVAL_MS = 250;
/** Need level at (or above) which a need is rendered as critical. */
export const NEED_CRITICAL_LEVEL = 60;
/** Most recent company ledger hours rendered in the panel. */
export const LEDGER_ROWS = 12;
/** Row cap for long lists (occupants, staff); counts stay complete. */
export const MAX_LIST_ROWS = 40;

/* ------------------------------------------------------------------ types -- */

/** Entity classes the inspector can render. */
export type InspectorEntityKind = 'citizen' | 'company' | 'vehicle' | 'building';

/** The kind of an entity, in the inspector's vocabulary. */
export type InspectionKind = InspectorEntityKind;

/** One selected entity: kind plus stable id. */
export interface InspectorSelection {
  readonly kind: InspectorEntityKind;
  readonly id: EntityId;
}

/** Minimal clock surface the inspector reads for schedule positions. */
export interface InspectorClock {
  /** Sim minutes since the clock origin (see `SimClock.totalMinutes`). */
  readonly totalMinutes: number;
}

/** District lookup entry (e.g. `CityWorld.districts`). */
export interface DistrictSummary {
  readonly id: EntityId;
  readonly name: string;
}

/** A world building record, including the optional world-level metadata. */
export type BuildingRecord = Building &
  Partial<Pick<WorldBuilding, 'address' | 'jobSlots' | 'leisure' | 'landmark' | 'districtId'>>;

/** A company record, including the optional ledger metadata. */
export type CompanyInspectionRecord = Company &
  Partial<
    Pick<
      CompanyRecord,
      | 'address'
      | 'districtId'
      | 'siteKind'
      | 'wageLevel'
      | 'wagePerHour'
      | 'capacity'
      | 'revenueHistory'
      | 'revenuePerHour'
      | 'wageCostsPerHour'
      | 'otherCostsPerHour'
      | 'costsPerHour'
      | 'totalRevenue'
      | 'totalCosts'
      | 'postCount'
      | 'demand'
      | 'targetEmployees'
      | 'state'
      | 'troubledSinceDay'
    >
  >;

/** Citizens source: `CitizensSystem` structurally satisfies it. */
export interface CitizenInspectionSource {
  readonly minuteOfDay?: number;
  /** The full roster, when the source exposes it (`CitizensSystem.citizens`). */
  readonly citizens?: readonly Citizen[];
  citizenById(citizenId: EntityId): Citizen | null;
  detailsFor?(citizenId: EntityId): CitizenDetails | null;
}

/** Companies source: `CompaniesSystem` structurally satisfies it. */
export interface CompanyInspectionSource {
  companyById(companyId: EntityId): CompanyInspectionRecord | null;
  ledgerFor?(companyId: EntityId): readonly CompanyLedgerEntry[];
}

/** Vehicles source: `VehiclesSystem` structurally satisfies it. */
export interface VehicleInspectionSource {
  vehicleById(vehicleId: EntityId): Vehicle | null;
  detailsFor?(vehicleId: EntityId): VehicleDetails | null;
}

/** Buildings source: `CityWorld` structurally satisfies it. */
export interface BuildingInspectionSource {
  readonly districts?: readonly DistrictSummary[];
  buildingById(buildingId: EntityId): BuildingRecord | null;
}

/**
 * Everything the inspector reads. Only `world` is strictly required when the
 * raw `WorldMap` is available; naming the live systems enriches the records
 * (routine stage, route stops, ledgers) without changing the panel contract.
 */
export interface InspectorSources {
  readonly world?: WorldMap | null;
  readonly citizens?: CitizenInspectionSource | null;
  readonly companies?: CompanyInspectionSource | null;
  readonly vehicles?: VehicleInspectionSource | null;
  readonly buildings?: BuildingInspectionSource | null;
  readonly clock?: InspectorClock | null;
}

/** Constructor options for {@link EntityInspector}. */
export interface EntityInspectorOptions {
  /** Where entity records are read from. */
  readonly sources: InspectorSources;
  /** Refresh cadence while selected, in milliseconds. Defaults to 250. */
  readonly refreshIntervalMs?: number;
  /** Bind an `Escape` key listener on attach. Defaults to true. */
  readonly escapeToClear?: boolean;
  /** Time source for throttling; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Accessible label of the panel. */
  readonly label?: string;
}

/** Selection change listener. */
export type SelectionListener = (selection: InspectorSelection | null) => void;

/** A minimal picker surface, satisfied by `EntityPicker`. */
export interface InspectorPicker {
  pickScreen(point: Vec2): EntityPick;
}

/** Options for {@link EntityInspector.bindPicking}. */
export interface InspectorPickingOptions {
  /** Picker resolving screen clicks to entities. */
  readonly picker: InspectorPicker;
  /** Element that receives the clicks (the canvas, usually). */
  readonly element: HTMLElement;
  /** DOM event to listen for. Defaults to `'pointerdown'`. */
  readonly event?: 'pointerdown' | 'click';
}

/** A removable input binding owned by the inspector. */
export interface InspectorBinding {
  readonly element: HTMLElement | null;
  dispose(): void;
}

/* ------------------------------------------------------------- formatting -- */

/** Money in sim currency, e.g. `$12,500.00`. */
export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  const negative = value < 0;
  const [whole, cents] = Math.abs(value).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${cents}`;
}

/** Ratio (0..1) as a percentage, e.g. `72%`. */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) {
    return '—';
  }
  return `${formatNumber(ratio * 100, 1)}%`;
}

/** Compact number with a bounded number of decimals, e.g. `10.4`. */
export function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  const fixed = value.toFixed(digits);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** Hour-of-day as `HH:MM`, keeping `24:00` for a schedule ending at midnight. */
export function formatHourLabel(hour: number): string {
  if (!Number.isFinite(hour)) {
    return '—';
  }
  const totalMinutes = Math.round(hour * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Minute-of-day as `HH:MM`, wrapping past midnight. */
export function formatMinuteOfDay(minutes: number): string {
  if (!Number.isFinite(minutes)) {
    return '—';
  }
  const wrapped = normaliseMinuteOfDay(minutes);
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/** World position as `x, y` with two decimals. */
export function formatPosition(point: Vec2): string {
  if (!point) {
    return '—';
  }
  return `${point.x.toFixed(2)}, ${point.y.toFixed(2)}`;
}

/** A tile distance as `1.25 tiles`. */
export function formatTiles(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(2)} tiles` : '—';
}

/** Minute-of-day for an absolute sim-minute count. */
export function normaliseMinuteOfDay(totalMinutes: number): number {
  const wrapped = Math.round(totalMinutes) % MINUTES_PER_DAY;
  return wrapped < 0 ? wrapped + MINUTES_PER_DAY : wrapped;
}

/* -------------------------------------------------------------- schedules -- */

/** Position of a schedule block relative to the current sim minute. */
export type ScheduleSlotState = 'past' | 'current' | 'next' | 'upcoming';

/** `[start, end)` window of a slot, in minutes-of-day. */
export function scheduleSlotWindow(slot: ScheduleSlot): { startMinute: number; endMinute: number } {
  return { startMinute: slot.startHour * 60, endMinute: slot.endHour * 60 };
}

/** Whether a slot is running at the supplied minute-of-day (wraps midnight). */
export function scheduleSlotContains(slot: ScheduleSlot, minuteOfDay: number): boolean {
  const { startMinute, endMinute } = scheduleSlotWindow(slot);
  if (startMinute === endMinute) {
    return false;
  }
  if (startMinute < endMinute) {
    return minuteOfDay >= startMinute && minuteOfDay < endMinute;
  }
  return minuteOfDay >= startMinute || minuteOfDay < endMinute;
}

/**
 * Classifies every block of a daily routine for the given sim minute: the
 * running block is `'current'`, its successor `'next'`, everything before it
 * `'past'` and everything after `'upcoming'`. Without a clock reading every
 * block is reported as `'upcoming'`.
 */
export function scheduleSlotStates(
  schedule: readonly ScheduleSlot[],
  minuteOfDay: number | null,
): ScheduleSlotState[] {
  if (schedule.length === 0) {
    return [];
  }
  if (minuteOfDay === null) {
    return schedule.map(() => 'upcoming' as ScheduleSlotState);
  }
  const minute = normaliseMinuteOfDay(minuteOfDay);
  const running = schedule.findIndex((slot) => scheduleSlotContains(slot, minute));
  if (running >= 0) {
    return schedule.map((_slot, index) => {
      if (index < running) {
        return 'past';
      }
      if (index === running) {
        return 'current';
      }
      return index === running + 1 ? 'next' : 'upcoming';
    });
  }
  const upcoming = schedule.findIndex((slot) => slot.startHour * 60 > minute);
  if (upcoming >= 0) {
    return schedule.map((_slot, index) => {
      if (index < upcoming) {
        return 'past';
      }
      return index === upcoming ? 'next' : 'upcoming';
    });
  }
  // Every block has started: the routine wrapped, so the first block is
  // tomorrow's and everything else is behind us.
  return schedule.map((_slot, index) => (index === 0 ? 'next' : 'past'));
}

/** `08:00–16:00` label of a schedule block. */
export function scheduleSlotWindowLabel(slot: ScheduleSlot): string {
  return `${formatHourLabel(slot.startHour)}–${formatHourLabel(slot.endHour)}`;
}

/* ------------------------------------------------------------ view specs -- */

/** A button rendered beside a field value that jumps to another entity. */
export interface FieldLink {
  readonly kind: InspectorEntityKind;
  readonly id: EntityId;
  readonly label?: string;
}

/** One labelled field of a record. */
export interface FieldSpec {
  readonly key: string;
  readonly label: string;
  value(): string;
  /** Tone applied to the value node (`data-tone`), e.g. `'critical'`. */
  tone?(): string | null;
  /** Entity this field links to; rendered as a button. */
  link?(): FieldLink | null;
}

/** One row of a collection (needs, schedule, staff, occupants, ...). */
export interface ListItemSpec {
  readonly key: string;
  readonly fields: readonly FieldSpec[];
  /** Row state applied as `data-state`, e.g. `'current'`. */
  state?(): string | null;
}

/** A collection rendered under a section. */
export interface ListSpec {
  readonly key: string;
  readonly label: string;
  readonly empty?: string;
  items(): readonly ListItemSpec[];
}

/** A titled group of fields and collections. */
export interface SectionSpec {
  readonly key: string;
  readonly label: string;
  readonly fields?: readonly FieldSpec[];
  readonly lists?: readonly ListSpec[];
}

/** Everything one entity renders. */
export interface EntityView {
  readonly kindLabel: string;
  readonly title: string;
  readonly sections: readonly SectionSpec[];
}

/** Spec builders, kept terse so the record definitions read like a form. */
function field(
  key: string,
  label: string,
  value: () => string,
  extra: { tone?: () => string | null; link?: () => FieldLink | null } = {},
): FieldSpec {
  return { key, label, value, tone: extra.tone, link: extra.link };
}

function list(key: string, label: string, items: () => readonly ListItemSpec[], empty?: string): ListSpec {
  return { key, label, items, empty };
}

function section(
  key: string,
  label: string,
  fields: readonly FieldSpec[],
  lists: readonly ListSpec[] = [],
): SectionSpec {
  return { key, label, fields, lists };
}

/* ------------------------------------------------------------ DOM widgets -- */

interface FieldRow {
  readonly element: HTMLElement;
  readonly key: string;
  readonly value: HTMLElement;
  readonly link: HTMLButtonElement;
  sync(next: FieldSpec): void;
}

function createFieldRow(doc: Document, spec: FieldSpec): FieldRow {
  const element = doc.createElement('div');
  element.className = 'inspector__row';
  const label = doc.createElement('span');
  label.className = 'inspector__label';
  const value = doc.createElement('span');
  value.className = 'inspector__value';
  value.dataset.field = spec.key;
  const link = doc.createElement('button');
  link.type = 'button';
  link.className = 'inspector__link';
  link.dataset.action = 'inspect';
  link.hidden = true;
  element.append(label, value, link);

  const row: FieldRow = {
    element,
    key: spec.key,
    value,
    link,
    sync(next: FieldSpec): void {
      label.textContent = next.label;
      const text = next.value();
      if (value.textContent !== text) {
        value.textContent = text;
      }
      const tone = next.tone?.() ?? null;
      if (tone === null) {
        delete value.dataset.tone;
      } else {
        value.dataset.tone = tone;
      }
      const target = next.link?.() ?? null;
      if (target === null) {
        link.hidden = true;
        link.textContent = '';
        delete link.dataset.entityKind;
        delete link.dataset.entityId;
        return;
      }
      link.hidden = false;
      link.textContent = target.label ?? `Inspect ${target.kind}`;
      link.dataset.entityKind = target.kind;
      link.dataset.entityId = target.id;
      link.setAttribute('aria-label', `Inspect ${target.kind} ${target.id}`);
    },
  };
  row.sync(spec);
  return row;
}

/** Renders a field set, reusing row nodes as long as the key set is stable. */
class FieldListView {
  private readonly rows: FieldRow[] = [];

  constructor(private readonly doc: Document, private readonly container: HTMLElement) {}

  sync(fields: readonly FieldSpec[]): void {
    const needsRebuild =
      fields.length !== this.rows.length || fields.some((spec, index) => spec.key !== this.rows[index].key);
    if (needsRebuild) {
      this.container.replaceChildren();
      this.rows.length = 0;
      for (const spec of fields) {
        const row = createFieldRow(this.doc, spec);
        this.container.append(row.element);
        this.rows.push(row);
      }
    }
    fields.forEach((spec, index) => this.rows[index].sync(spec));
  }

  get rowCount(): number {
    return this.rows.length;
  }
}

interface ListRow {
  readonly element: HTMLElement;
  readonly key: string;
  readonly fields: FieldListView;
}

/** Renders a collection, reusing row nodes and their fields across refreshes. */
class ListView {
  private readonly rows: ListRow[] = [];
  private emptyElement: HTMLElement | null = null;

  constructor(private readonly doc: Document, private readonly container: HTMLElement, private readonly spec: ListSpec) {}

  sync(): void {
    const items = this.spec.items().slice(0, MAX_LIST_ROWS);
    if (items.length === 0) {
      this.clearRows();
      if (this.spec.empty) {
        if (!this.emptyElement) {
          this.emptyElement = this.doc.createElement('p');
          this.emptyElement.className = 'inspector__empty';
          this.container.append(this.emptyElement);
        }
        this.emptyElement.textContent = this.spec.empty;
      }
      return;
    }
    if (this.emptyElement) {
      this.emptyElement.remove();
      this.emptyElement = null;
    }

    const needsRebuild =
      items.length !== this.rows.length || items.some((item, index) => item.key !== this.rows[index].key);
    if (needsRebuild) {
      this.clearRows();
      for (const item of items) {
        this.rows.push(this.createRow(item));
      }
    }
    items.forEach((item, index) => {
      const row = this.rows[index];
      const state = item.state?.() ?? null;
      if (state === null) {
        delete row.element.dataset.state;
      } else {
        row.element.dataset.state = state;
      }
      row.element.dataset.itemIndex = String(index);
      row.fields.sync(item.fields);
    });
  }

  private createRow(item: ListItemSpec): ListRow {
    const element = this.doc.createElement('li');
    element.className = 'inspector__item';
    element.dataset.itemKey = item.key;
    this.container.append(element);
    return { element, key: item.key, fields: new FieldListView(this.doc, element) };
  }

  private clearRows(): void {
    for (const row of this.rows) {
      row.element.remove();
    }
    this.rows.length = 0;
  }
}

/* ---------------------------------------------------------- view context -- */

interface ViewContext {
  citizenById(id: EntityId): Citizen | null;
  buildingById(id: EntityId): BuildingRecord | null;
  companyById(id: EntityId): CompanyInspectionRecord | null;
  vehicleById(id: EntityId): Vehicle | null;
  citizenDetails(id: EntityId): CitizenDetails | null;
  vehicleDetails(id: EntityId): VehicleDetails | null;
  companyLedger(id: EntityId): readonly CompanyLedgerEntry[];
  districtName(id: EntityId | null | undefined): string | null;
  minuteOfDay(): number | null;
  /** Citizens who call the building home. */
  residentsOfBuilding(id: EntityId): readonly { id: EntityId; citizen: Citizen | null }[];
  /** Citizens whose occupation places them at the building. */
  employeesOfBuilding(id: EntityId): readonly { id: EntityId; citizen: Citizen | null }[];
}

/** One citizen entry of a building roster. */
interface CitizenEntry {
  readonly id: EntityId;
  readonly citizen: Citizen | null;
}

function describeBuilding(id: EntityId | null, building: BuildingRecord | null): string {
  if (!id) {
    return '—';
  }
  return building ? `${building.name} (${id})` : id;
}

function describeCompany(id: EntityId | null, company: CompanyInspectionRecord | null): string {
  if (!id) {
    return 'unemployed';
  }
  return company ? `${company.name} (${id})` : id;
}

function describeVehicle(id: EntityId | null, vehicle: Vehicle | null): string {
  if (!id) {
    return 'on foot';
  }
  return vehicle ? `${VEHICLE_KIND_SPECS[vehicle.kind].label} ${vehicle.plate} (${id})` : id;
}

function describeRoute(route: VehicleRoute | null): string {
  if (!route) {
    return '—';
  }
  return `${route.kind} · ${route.loop ? 'loops' : 'one way'} · ${route.stopNodeIds.length} stops`;
}

/* ------------------------------------------------------------ view builder -- */

function buildCitizenView(citizenId: EntityId, ctx: ViewContext): EntityView | null {
  const first = ctx.citizenById(citizenId);
  if (!first) {
    return null;
  }
  const citizen = (): Citizen => ctx.citizenById(citizenId) ?? first;
  const details = (): CitizenDetails | null => ctx.citizenDetails(citizenId);
  const live = () => details()?.live ?? null;
  const home = (): BuildingRecord | null => ctx.buildingById(citizen().homeBuildingId);
  const workplace = (): BuildingRecord | null => {
    const id = citizen().occupation.workplaceBuildingId;
    return id ? ctx.buildingById(id) : null;
  };
  const employer = (): CompanyInspectionRecord | null => {
    const id = citizen().occupation.companyId;
    return id ? ctx.companyById(id) : null;
  };
  const slots = (): readonly ScheduleSlot[] => citizen().schedule;
  const states = (): ScheduleSlotState[] => scheduleSlotStates(slots(), ctx.minuteOfDay());
  const slotState = (index: number): ScheduleSlotState => states()[index] ?? 'upcoming';
  const slotAt = (state: ScheduleSlotState): ScheduleSlot | null => {
    const index = states().indexOf(state);
    return index >= 0 ? slots()[index] ?? null : null;
  };
  const describeSlot = (slot: ScheduleSlot | null): string => {
    if (!slot) {
      return '—';
    }
    return `${slot.activity} · ${scheduleSlotWindowLabel(slot)} · ${describeBuilding(
      slot.destinationId,
      slot.destinationId ? ctx.buildingById(slot.destinationId) : null,
    )}`;
  };
  const needs = (): readonly Need[] => citizen().needs;
  const averageNeed = (): number => {
    const list = needs();
    return list.length === 0 ? 0 : list.reduce((sum, need) => sum + need.level, 0) / list.length;
  };
  const criticalNeeds = (): number => needs().filter((need) => need.level >= NEED_CRITICAL_LEVEL).length;
  const shiftHours = (): string => {
    const detail = details();
    if (detail) {
      return detail.shiftHours;
    }
    const occupation = citizen().occupation;
    return `${formatHourLabel(occupation.shiftStartHour)}–${formatHourLabel(occupation.shiftEndHour)}`;
  };

  return {
    kindLabel: 'Citizen',
    title: first.name,
    sections: [
      section('citizen.identity', 'Identity', [
        field('citizen.name', 'Name', () => citizen().name),
        field('citizen.age', 'Age', () => formatNumber(citizen().age, 0)),
        field('citizen.id', 'Id', () => citizen().id),
        field('citizen.household', 'Household', () => citizen().householdId),
        field('citizen.household.size', 'Household size', () =>
          formatNumber(citizen().household.memberIds.length, 0),
        ),
        field('citizen.household.funds', 'Household funds', () => formatMoney(citizen().household.funds)),
        field('citizen.home', 'Home', () => describeBuilding(citizen().homeBuildingId, home())),
        field('citizen.home.address', 'Home address', () => home()?.address ?? details()?.homeAddress ?? '—'),
      ]),
      section('citizen.work', 'Work', [
        field('citizen.occupation', 'Occupation', () => citizen().occupation.title),
        field('citizen.sector', 'Sector', () => citizen().occupation.sector),
        field('citizen.employer', 'Employer', () => describeCompany(citizen().occupation.companyId, employer()), {
          link: () => {
            const company = employer();
            return company ? { kind: 'company', id: company.id, label: 'Inspect company' } : null;
          },
        }),
        field('citizen.workplace', 'Workplace', () =>
          describeBuilding(citizen().occupation.workplaceBuildingId, workplace()),
        ),
        field('citizen.workplace.address', 'Workplace address', () => workplace()?.address ?? '—'),
        field('citizen.shift', 'Shift', shiftHours),
        field('citizen.shift.label', 'Shift pattern', () => details()?.shiftLabel ?? '—'),
        field('citizen.wage', 'Wage / hour', () => formatMoney(citizen().occupation.wagePerHour)),
        field('citizen.income', 'Daily income', () => formatMoney(citizen().income)),
        field('citizen.commute', 'Commute', () => details()?.commuteMode ?? '—'),
      ]),
      section('citizen.live', 'Right now', [
        field('citizen.activity', 'Activity', () => live()?.activity ?? citizen().currentActivity),
        field('citizen.stage', 'Routine stage', () => live()?.stage ?? '—'),
        field('citizen.mood', 'Mood', () => formatPercent(citizen().mood), {
          tone: () => (citizen().mood < 0.4 ? 'critical' : null),
        }),
        field('citizen.position', 'Position', () => formatPosition(live()?.position ?? citizen().position)),
        field('citizen.inside', 'Inside', () =>
          describeBuilding(live()?.insideBuildingId ?? citizen().insideBuildingId, ((): BuildingRecord | null => {
            const id = live()?.insideBuildingId ?? citizen().insideBuildingId;
            return id ? ctx.buildingById(id) : null;
          })()),
        ),
        field('citizen.travelling', 'Travelling', () => {
          if (live()) {
            return live()?.travelling ? 'yes' : 'no';
          }
          return citizen().vehicleId ? 'yes' : 'no';
        }),
        field('citizen.vehicle', 'Vehicle', () => {
          const id = citizen().vehicleId;
          return describeVehicle(id, id ? ctx.vehicleById(id) : null);
        }, {
          link: () => {
            const id = citizen().vehicleId;
            return id ? { kind: 'vehicle', id, label: 'Inspect vehicle' } : null;
          },
        }),
        field('citizen.destination', 'Destination', () =>
          describeBuilding(live()?.destinationId ?? null, ((): BuildingRecord | null => {
            const id = live()?.destinationId ?? null;
            return id ? ctx.buildingById(id) : null;
          })()),
        ),
        field('citizen.entertainment', 'Entertainment', () => {
          const detail = details();
          return detail ? `${detail.entertainmentVenueName} (${detail.entertainmentVenueType})` : '—';
        }),
        field('citizen.lunch', 'Lunch', () => {
          const detail = details();
          if (!detail) {
            return '—';
          }
          return `${detail.lunchVenueId}${detail.lunchOffSite ? ' (off site)' : ' (on site)'}`;
        }),
      ]),
      section(
        'citizen.needs',
        'Needs',
        [
          field('citizen.needs.average', 'Average level', () => formatNumber(averageNeed(), 1), {
            tone: () => (averageNeed() >= NEED_CRITICAL_LEVEL ? 'critical' : null),
          }),
          field('citizen.needs.critical', 'Critical needs', () => formatNumber(criticalNeeds(), 0), {
            tone: () => (criticalNeeds() > 0 ? 'critical' : null),
          }),
        ],
        [
          list(
            'citizen.needs',
            'Need levels',
            () =>
              needs().map((need) => ({
                key: need.kind,
                state: (): string => (need.level >= NEED_CRITICAL_LEVEL ? 'critical' : 'ok'),
                fields: [
                  field('need.kind', 'Need', () => need.kind),
                  field('need.level', 'Level', () => formatNumber(need.level, 1), {
                    tone: () => (need.level >= NEED_CRITICAL_LEVEL ? 'critical' : null),
                  }),
                  field('need.growth', 'Growth / hour', () => formatNumber(need.growthPerHour, 2)),
                ],
              })),
            'No needs tracked.',
          ),
        ],
      ),
      section(
        'citizen.schedule',
        'Daily schedule',
        [
          field('citizen.schedule.current', 'Current stop', () => describeSlot(slotAt('current'))),
          field('citizen.schedule.next', 'Next stop', () => describeSlot(slotAt('next'))),
          field('citizen.schedule.past', 'Past stops', () =>
            formatNumber(states().filter((state) => state === 'past').length, 0),
          ),
        ],
        [
          list(
            'citizen.schedule',
            'Timeline',
            () =>
              slots().map((slot, index) => ({
                key: `${index}-${slot.activity}`,
                state: (): string => slotState(index),
                fields: [
                  field('slot.activity', 'Activity', () => slot.activity),
                  field('slot.window', 'Window', () => scheduleSlotWindowLabel(slot)),
                  field('slot.destination', 'Destination', () =>
                    describeBuilding(slot.destinationId, slot.destinationId ? ctx.buildingById(slot.destinationId) : null),
                  ),
                  field('slot.status', 'Status', () => slotState(index)),
                ],
              })),
            'No schedule recorded.',
          ),
        ],
      ),
    ],
  };
}

function buildCompanyView(companyId: EntityId, ctx: ViewContext): EntityView | null {
  const first = ctx.companyById(companyId);
  if (!first) {
    return null;
  }
  const company = (): CompanyInspectionRecord => ctx.companyById(companyId) ?? first;
  const ledger = (): readonly CompanyLedgerEntry[] => ctx.companyLedger(companyId);
  const premises = (): BuildingRecord | null => {
    const id = company().buildingId;
    return id ? ctx.buildingById(id) : null;
  };
  const staff = (): readonly { id: EntityId; citizen: Citizen | null }[] =>
    company().employees.map((id) => ({ id, citizen: ctx.citizenById(id) }));
  const averageWage = (): number | null => {
    const wages = staff()
      .map((entry) => entry.citizen?.occupation.wagePerHour)
      .filter((wage): wage is number => typeof wage === 'number');
    if (wages.length === 0) {
      return null;
    }
    return wages.reduce((sum, wage) => sum + wage, 0) / wages.length;
  };
  const wagePerHour = (): string => {
    const record = company().wagePerHour;
    if (typeof record === 'number') {
      return formatMoney(record);
    }
    const average = averageWage();
    return average === null ? '—' : `${formatMoney(average)} (mean)`;
  };
  const hourlyRevenue = (): string => {
    const record = company().revenuePerHour;
    if (typeof record === 'number') {
      return formatMoney(record);
    }
    const history = ledger();
    return history.length > 0 ? formatMoney(history[history.length - 1].revenue) : '—';
  };
  const hourlyCosts = (): string => {
    if (typeof company().costsPerHour === 'number') {
      return formatMoney(company().costsPerHour as number);
    }
    const history = ledger();
    return history.length > 0 ? formatMoney(history[history.length - 1].totalCosts) : '—';
  };
  const hourProfit = (): number | null => {
    const record = company();
    if (typeof record.revenuePerHour === 'number' && typeof record.costsPerHour === 'number') {
      return record.revenuePerHour - record.costsPerHour;
    }
    const history = ledger();
    if (history.length === 0) {
      return null;
    }
    const last = history[history.length - 1];
    return last.revenue - last.totalCosts;
  };
  const stateTone = (): string | null => {
    const state = company().state;
    if (state === 'insolvent') {
      return 'critical';
    }
    return state === 'troubled' ? 'warn' : null;
  };

  return {
    kindLabel: 'Company',
    title: first.name,
    sections: [
      section('company.identity', 'Identity', [
        field('company.name', 'Name', () => company().name),
        field('company.id', 'Id', () => company().id),
        field('company.sector', 'Sector', () => company().sector),
        field('company.state', 'State', () => company().state ?? '—', { tone: stateTone }),
        field('company.address', 'Address', () => company().address ?? premises()?.address ?? '—'),
        field('company.district', 'District', () => ctx.districtName(company().districtId ?? premises()?.districtId) ?? '—'),
        field('company.building', 'Premises', () => describeBuilding(company().buildingId, premises()), {
          link: () => {
            const id = company().buildingId;
            return id ? { kind: 'building', id, label: 'Inspect building' } : null;
          },
        }),
        field('company.open', 'Opening hours', () =>
          `${formatHourLabel(company().openHour)}–${formatHourLabel(company().closeHour)}`,
        ),
        field('company.wage.level', 'Wage tier', () => company().wageLevel ?? '—'),
        field('company.wage.hourly', 'Wage / hour', wagePerHour),
      ]),
      section('company.finance', 'Ledger', [
        field('company.cash', 'Cash', () => formatMoney(company().cash), {
          tone: () => (company().cash <= 0 ? 'critical' : null),
        }),
        field('company.revenue.today', 'Revenue today', () => formatMoney(company().revenue)),
        field('company.costs.today', 'Costs today', () => formatMoney(company().costs)),
        field('company.profit.today', 'Profit today', () => formatMoney(company().revenue - company().costs)),
        field('company.revenue.hour', 'Revenue last hour', hourlyRevenue),
        field('company.costs.hour', 'Costs last hour', hourlyCosts),
        field('company.profit.hour', 'Profit last hour', () => {
          const profit = hourProfit();
          return profit === null ? '—' : formatMoney(profit);
        }),
        field('company.revenue.total', 'Lifetime revenue', () =>
          typeof company().totalRevenue === 'number' ? formatMoney(company().totalRevenue as number) : '—',
        ),
        field('company.costs.total', 'Lifetime costs', () =>
          typeof company().totalCosts === 'number' ? formatMoney(company().totalCosts as number) : '—',
        ),
        field('company.demand', 'Demand', () =>
          typeof company().demand === 'number' ? formatNumber(company().demand as number, 2) : '—',
        ),
        field('company.posts', 'Hours settled', () =>
          typeof company().postCount === 'number' ? formatNumber(company().postCount as number, 0) : '—',
        ),
      ]),
      section(
        'company.staff',
        'Staff',
        [
          field('company.staff.count', 'Employees', () => formatNumber(staff().length, 0)),
          field('company.capacity', 'Capacity', () =>
            typeof company().capacity === 'number' ? formatNumber(company().capacity as number, 0) : '—',
          ),
          field('company.staff.openings', 'Open posts', () => {
            const capacity = company().capacity;
            return typeof capacity === 'number' ? formatNumber(Math.max(0, capacity - staff().length), 0) : '—';
          }),
          field('company.employeeCount', 'Reported headcount', () => formatNumber(company().employeeCount, 0)),
        ],
        [
          list(
            'company.staff',
            'Roster',
            () =>
              staff().map((entry) => ({
                key: entry.id,
                fields: [
                  field('staff.name', 'Employee', () => entry.citizen?.name ?? entry.id, {
                    link: () => ({ kind: 'citizen', id: entry.id, label: 'Inspect' }),
                  }),
                  field('staff.title', 'Role', () => entry.citizen?.occupation.title ?? '—'),
                  field('staff.wage', 'Wage / hour', () =>
                    entry.citizen ? formatMoney(entry.citizen.occupation.wagePerHour) : '—',
                  ),
                  field('staff.id', 'Id', () => entry.id),
                ],
              })),
            'No staff on the payroll.',
          ),
        ],
      ),
      section(
        'company.ledger',
        'Hourly history',
        [
          field('company.ledger.hours', 'Hours on record', () => formatNumber(ledger().length, 0)),
          field('company.ledger.newest', 'Newest hour', () => {
            const history = ledger();
            if (history.length === 0) {
              return '—';
            }
            const last = history[history.length - 1];
            return `Day ${last.day}, ${formatHourLabel(last.hour)}`;
          }),
        ],
        [
          list(
            'company.ledger',
            `Last ${LEDGER_ROWS} hours`,
            () =>
              ledger()
                .slice(-LEDGER_ROWS)
                .map((entry) => ({
                  key: `${entry.day}-${entry.hour}`,
                  state: (): string => (entry.open ? 'open' : 'closed'),
                  fields: [
                    field('ledger.time', 'Hour', () => `Day ${entry.day}, ${formatHourLabel(entry.hour)}`),
                    field('ledger.revenue', 'Revenue', () => formatMoney(entry.revenue)),
                    field('ledger.costs', 'Costs', () => formatMoney(entry.totalCosts)),
                    field('ledger.net', 'Net cash', () => formatMoney(entry.netCash), {
                      tone: () => (entry.netCash < 0 ? 'critical' : null),
                    }),
                    field('ledger.cash', 'Cash after', () => formatMoney(entry.cashAfter)),
                    field('ledger.employees', 'Employees', () => formatNumber(entry.employees, 0)),
                    field('ledger.demand', 'Demand', () => formatNumber(entry.demand, 2)),
                    field('ledger.state', 'State', () => entry.state),
                  ],
                })),
            'No hours settled yet.',
          ),
        ],
      ),
    ],
  };
}

function buildVehicleView(vehicleId: EntityId, ctx: ViewContext): EntityView | null {
  const first = ctx.vehicleById(vehicleId);
  if (!first) {
    return null;
  }
  const vehicle = (): Vehicle => ctx.vehicleById(vehicleId) ?? first;
  const details = (): VehicleDetails | null => ctx.vehicleDetails(vehicleId);
  const spec = () => VEHICLE_KIND_SPECS[vehicle().kind];
  const route = (): VehicleRoute => details()?.route ?? vehicle().route;
  const stopNodeIds = (): readonly EntityId[] => details()?.stops.map((stop) => stop.nodeId) ?? route().stopNodeIds;
  const stopFor = (index: number): { nodeId: EntityId; buildingId: EntityId | null; action: string; dwell: number } | null => {
    const stops = details()?.stops;
    if (stops && stops[index]) {
      const stop = stops[index];
      return { nodeId: stop.nodeId, buildingId: stop.buildingId, action: stop.action, dwell: stop.dwellMinutes };
    }
    const nodeId = route().stopNodeIds[index];
    return nodeId ? { nodeId, buildingId: null, action: 'service', dwell: 0 } : null;
  };
  const owner = (): CompanyInspectionRecord | null => {
    const id = vehicle().ownerCompanyId;
    return id ? ctx.companyById(id) : null;
  };

  return {
    kindLabel: 'Vehicle',
    title: `${spec().label} ${first.plate}`,
    sections: [
      section('vehicle.identity', 'Identity', [
        field('vehicle.kind', 'Kind', () => `${spec().label} (${vehicle().kind})`),
        field('vehicle.plate', 'Plate', () => vehicle().plate),
        field('vehicle.id', 'Id', () => vehicle().id),
        field('vehicle.role', 'Role', () => details()?.role ?? spec().role),
        field('vehicle.activity', 'Activity', () => details()?.activity ?? '—'),
        field(
          'vehicle.owner',
          'Owner',
          () => (vehicle().ownerCompanyId ? describeCompany(vehicle().ownerCompanyId, owner()) : '—'),
          {
            link: () => {
              const company = owner();
              return company ? { kind: 'company', id: company.id, label: 'Inspect company' } : null;
            },
          },
        ),
        field('vehicle.color', 'Colour', () => vehicle().color),
      ]),
      section('vehicle.state', 'State', [
        field('vehicle.capacity', 'Capacity', () => formatNumber(vehicle().capacity, 0)),
        field('vehicle.occupancy', 'Occupancy', () => `${formatNumber(vehicle().occupancy, 0)} / ${formatNumber(vehicle().capacity, 0)}`),
        field('vehicle.fuel', 'Fuel', () =>
          `${formatNumber(vehicle().fuel, 2)} / ${formatNumber(vehicle().fuelCapacity, 2)}`,
        ),
        field('vehicle.fuel.percent', 'Fuel level', () => {
          const current = vehicle();
          return current.fuelCapacity > 0 ? formatPercent(current.fuel / current.fuelCapacity) : '—';
        }, {
          tone: () => {
            const current = vehicle();
            return current.fuelCapacity > 0 && current.fuel / current.fuelCapacity < 0.15 ? 'critical' : null;
          },
        }),
        field('vehicle.speed', 'Speed', () => `${formatNumber(vehicle().speed, 2)} tiles / min`),
        field('vehicle.position', 'Position', () => formatPosition(vehicle().position)),
        field('vehicle.heading', 'Heading', () => `${formatNumber(vehicle().headingRadians, 2)} rad`),
        field('vehicle.distance', 'Distance driven', () => formatTiles(details()?.distanceTiles ?? 0)),
        field('vehicle.trips', 'Completed trips', () => formatNumber(details()?.completedTrips ?? 0, 0)),
      ]),
      section(
        'vehicle.route',
        'Route',
        [
          field('vehicle.route.id', 'Route', () => route().id),
          field('vehicle.route.kind', 'Route kind', () => route().kind),
          field('vehicle.route.loop', 'Loop', () => (route().loop ? 'yes' : 'no')),
          field('vehicle.route.summary', 'Summary', () => describeRoute(route())),
          field('vehicle.route.stops', 'Stops', () => formatNumber(stopNodeIds().length, 0)),
          field('vehicle.route.current', 'Current stop', () => {
            const current = vehicle().currentNodeId;
            return current ? describeBuilding(current, null) : '—';
          }),
          field('vehicle.route.next', 'Next stop', () => {
            const next = details()?.nextStopNodeId ?? vehicle().targetNodeId;
            return next ?? '—';
          }),
          field('vehicle.route.next.building', 'Next building', () => {
            const detail = details();
            if (!detail) {
              return '—';
            }
            const id = detail.nextStopBuildingId;
            return id ? `${detail.nextStopBuildingName ?? id} (${id})` : '—';
          }),
        ],
        [
          list(
            'vehicle.stops',
            'Stop list',
            () =>
              stopNodeIds().map((nodeId, index) => {
                const stop = stopFor(index);
                return {
                  key: `${index}-${nodeId}`,
                  state: (): string => (index === 0 ? 'next' : 'later'),
                  fields: [
                    field('stop.index', 'Stop', () => formatNumber(index + 1, 0)),
                    field('stop.node', 'Node', () => nodeId),
                    field('stop.building', 'Building', () =>
                      describeBuilding(stop?.buildingId ?? null, stop?.buildingId ? ctx.buildingById(stop.buildingId) : null),
                    ),
                    field('stop.action', 'Action', () => stop?.action ?? '—'),
                    field('stop.dwell', 'Dwell', () => formatNumber(stop?.dwell ?? 0, 0)),
                  ],
                };
              }),
            'No stops on this route.',
          ),
        ],
      ),
      section(
        'vehicle.occupants',
        'Occupants',
        [
          field('vehicle.riders.count', 'Riders', () => formatNumber(vehicle().occupantIds.length, 0)),
          field('vehicle.passengers.count', 'Passengers on board', () => formatNumber(details()?.passengers.length ?? 0, 0)),
        ],
        [
          list(
            'vehicle.occupants',
            'Who is on board',
            () => {
              const passengers = details()?.passengers;
              if (passengers && passengers.length > 0) {
                return passengers.map((passenger) => ({
                  key: passenger.citizenId,
                  fields: [
                    field('occupant.name', 'Rider', () =>
                      ctx.citizenById(passenger.citizenId)?.name ?? passenger.citizenId, {
                        link: () => ({ kind: 'citizen', id: passenger.citizenId, label: 'Inspect' }),
                      },
                    ),
                    field('occupant.id', 'Id', () => passenger.citizenId),
                    field('occupant.origin', 'From', () =>
                      describeBuilding(passenger.originBuildingId, ctx.buildingById(passenger.originBuildingId)),
                    ),
                    field('occupant.destination', 'To', () =>
                      describeBuilding(passenger.destinationBuildingId, ctx.buildingById(passenger.destinationBuildingId)),
                    ),
                    field('occupant.boarded', 'Boarded', () => formatMinuteOfDay(passenger.boardedAtMinute)),
                  ],
                }));
              }
              return vehicle().occupantIds.map((citizenId) => ({
                key: citizenId,
                fields: [
                  field('occupant.name', 'Rider', () => ctx.citizenById(citizenId)?.name ?? citizenId, {
                    link: () => ({ kind: 'citizen', id: citizenId, label: 'Inspect' }),
                  }),
                  field('occupant.id', 'Id', () => citizenId),
                ],
              }));
            },
            'Nobody on board.',
          ),
        ],
      ),
    ],
  };
}

function buildBuildingView(buildingId: EntityId, ctx: ViewContext): EntityView | null {
  const first = ctx.buildingById(buildingId);
  if (!first) {
    return null;
  }
  const building = (): BuildingRecord => ctx.buildingById(buildingId) ?? first;
  const company = (): CompanyInspectionRecord | null => {
    const id = building().companyId;
    return id ? ctx.companyById(id) : null;
  };
  const occupants = (): { id: EntityId; citizen: Citizen | null }[] =>
    building().occupantIds.map((id) => ({ id, citizen: ctx.citizenById(id) }));
  const households = (): readonly EntityId[] => building().residentHouseholdIds;
  const residents = (): readonly CitizenEntry[] => ctx.residentsOfBuilding(buildingId);
  const employees = (): readonly CitizenEntry[] => ctx.employeesOfBuilding(buildingId);
  const footprintLabel = (): string => {
    const rect = building().footprint;
    return `${rect.x}, ${rect.y} · ${rect.width}×${rect.height}`;
  };

  return {
    kindLabel: 'Building',
    title: first.name,
    sections: [
      section('building.identity', 'Identity', [
        field('building.name', 'Name', () => building().name),
        field('building.id', 'Id', () => building().id),
        field('building.kind', 'Kind', () => building().kind),
        field('building.address', 'Address', () => building().address ?? '—'),
        field('building.district', 'District', () => ctx.districtName(building().districtId) ?? '—'),
        field('building.floors', 'Floors', () => formatNumber(building().floors, 0)),
        field('building.footprint', 'Footprint', footprintLabel),
        field('building.entrance', 'Entrance node', () => building().entranceNodeId ?? '—'),
      ]),
      section('building.capacity', 'Capacity', [
        field('building.capacity', 'Capacity', () => formatNumber(building().capacity, 0)),
        field('building.jobslots', 'Job slots', () =>
          typeof building().jobSlots === 'number' ? formatNumber(building().jobSlots as number, 0) : '—',
        ),
        field('building.capacity.used', 'Capacity used', () => {
          const current = building();
          return current.capacity > 0 ? formatPercent(current.occupantIds.length / current.capacity) : '—';
        }),
      ]),
      section(
        'building.occupancy',
        'Occupancy',
        [
          field('building.occupants.count', 'Occupants inside', () => formatNumber(occupants().length, 0)),
          field('building.residents.count', 'Residents', () => formatNumber(residents().length, 0)),
          field('building.residents.households', 'Households', () => formatNumber(households().length, 0)),
          field('building.employees.count', 'Workers', () => formatNumber(employees().length, 0)),
        ],
        [
          list(
            'building.occupants',
            'Inside right now',
            () =>
              occupants().map((entry) => ({
                key: entry.id,
                state: (): string => entry.citizen?.currentActivity ?? 'unknown',
                fields: [
                  field('occupant.name', 'Citizen', () => entry.citizen?.name ?? entry.id, {
                    link: () => ({ kind: 'citizen', id: entry.id, label: 'Inspect' }),
                  }),
                  field('occupant.id', 'Id', () => entry.id),
                  field('occupant.activity', 'Activity', () => entry.citizen?.currentActivity ?? '—'),
                ],
              })),
            'Nobody is inside.',
          ),
          list(
            'building.residents',
            'Residents',
            () =>
              residents().map((entry) => ({
                key: entry.id,
                fields: [
                  field('resident.name', 'Resident', () => entry.citizen?.name ?? entry.id, {
                    link: () => ({ kind: 'citizen', id: entry.id, label: 'Inspect' }),
                  }),
                  field('resident.age', 'Age', () =>
                    entry.citizen ? formatNumber(entry.citizen.age, 0) : '—',
                  ),
                  field('resident.household', 'Household', () => entry.citizen?.householdId ?? '—'),
                ],
              })),
            'No residents registered.',
          ),
          list(
            'building.employees',
            'Workers',
            () =>
              employees().map((entry) => ({
                key: entry.id,
                state: (): string => (entry.citizen?.insideBuildingId === buildingId ? 'present' : 'away'),
                fields: [
                  field('employee.name', 'Worker', () => entry.citizen?.name ?? entry.id, {
                    link: () => ({ kind: 'citizen', id: entry.id, label: 'Inspect' }),
                  }),
                  field('employee.title', 'Role', () => entry.citizen?.occupation.title ?? '—'),
                  field('employee.present', 'Present', () =>
                    entry.citizen?.insideBuildingId === buildingId ? 'yes' : 'no',
                  ),
                ],
              })),
            'No workers registered.',
          ),
        ],
      ),
      section('building.company', 'Operator', [
        field(
          'building.company',
          'Company',
          () => (building().companyId ? describeCompany(building().companyId, company()) : '—'),
          {
            link: () => {
              const record = company();
              return record ? { kind: 'company', id: record.id, label: 'Inspect company' } : null;
            },
          },
        ),
        field('building.company.sector', 'Sector', () => company()?.sector ?? '—'),
        field('building.company.employees', 'Staff', () => formatNumber(company()?.employeeCount ?? 0, 0)),
        field('building.company.cash', 'Cash', () => {
          const record = company();
          return record ? formatMoney(record.cash) : '—';
        }),
      ]),
    ],
  };
}

function buildEntityView(kind: InspectorEntityKind, id: EntityId, ctx: ViewContext): EntityView | null {
  switch (kind) {
    case 'citizen':
      return buildCitizenView(id, ctx);
    case 'company':
      return buildCompanyView(id, ctx);
    case 'vehicle':
      return buildVehicleView(id, ctx);
    case 'building':
      return buildBuildingView(id, ctx);
  }
}

/* --------------------------------------------------------------- inspector -- */

/** Whether an arbitrary string names an inspector entity kind. */
export function isInspectorEntityKind(value: string): value is InspectorEntityKind {
  return value === 'citizen' || value === 'company' || value === 'vehicle' || value === 'building';
}

/**
 * The detail panel itself.
 *
 * ```ts
 * const inspector = new EntityInspector({
 *   sources: { world, citizens, companies, vehicles, buildings: world, clock },
 * });
 * inspector.attach(document.querySelector('.hud')!);
 * inspector.bindPicking({ picker, element: canvas });
 * // every frame:
 * inspector.update();
 * ```
 */
export class EntityInspector {
  /** Refresh cadence while selected, in milliseconds. */
  readonly refreshIntervalMs: number;
  /** Whether attach() binds the `Escape` shortcut. */
  readonly escapeToClear: boolean;

  private readonly sources: InspectorSources;
  private readonly nowMs: () => number;
  private readonly label: string;
  private readonly listeners = new Set<SelectionListener>();
  private readonly bindings = new Set<InspectorBinding>();
  private sectionSyncs: (() => void)[] = [];
  private panelElement: HTMLElement | null = null;
  private bodyElement: HTMLElement | null = null;
  private kindElement: HTMLElement | null = null;
  private titleElement: HTMLElement | null = null;
  private selectionValue: InspectorSelection | null = null;
  private lastRefreshAt: number | null = null;
  private unavailableState = false;
  private refreshCountValue = 0;
  private skippedRefreshCountValue = 0;
  private disposedFlag = false;

  constructor(options: EntityInspectorOptions) {
    if (!options || !options.sources) {
      throw new TypeError('EntityInspector requires sources to read entity records from');
    }
    const refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs <= 0) {
      throw new RangeError(
        `refreshIntervalMs must be a finite number greater than 0, received ${refreshIntervalMs}`,
      );
    }
    this.sources = options.sources;
    this.refreshIntervalMs = refreshIntervalMs;
    this.escapeToClear = options.escapeToClear ?? true;
    this.nowMs = options.now ?? (() => Date.now());
    this.label = options.label ?? 'Entity details';
  }

  /* -------------------------------------------------------------- reading -- */

  /** The panel root, or `null` before {@link attach}. */
  get element(): HTMLElement | null {
    return this.panelElement;
  }

  /** The current selection, or `null` when cleared. */
  get selection(): InspectorSelection | null {
    return this.selectionValue ? { ...this.selectionValue } : null;
  }

  /** Kind of the selected entity, or `null`. */
  get selectedKind(): InspectorEntityKind | null {
    return this.selectionValue?.kind ?? null;
  }

  /** Id of the selected entity, or `null`. */
  get selectedId(): EntityId | null {
    return this.selectionValue?.id ?? null;
  }

  /** Whether a selection is currently displayed. */
  get isOpen(): boolean {
    return this.selectionValue !== null;
  }

  /** True once {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.disposedFlag;
  }

  /** Successful value syncs (initial renders included). */
  get refreshCount(): number {
    return this.refreshCountValue;
  }

  /** `update()` calls skipped by the refresh cadence. */
  get skippedRefreshCount(): number {
    return this.skippedRefreshCountValue;
  }

  /* ------------------------------------------------------------ lifecycle -- */

  /**
   * Creates the panel inside `container` (the app overlay) and binds the
   * `Escape` shortcut. Idempotent for the same container, and safe to call
   * before or after a selection.
   */
  attach(container: HTMLElement): HTMLElement {
    this.assertUsable('attach');
    if (!container) {
      throw new TypeError('attach() requires a container element');
    }
    if (this.panelElement) {
      // Re-attaching only moves the panel: the DOM, its listeners and the
      // rendered record survive, so a host can relocate the overlay (or mount
      // it into a freshly created root) without recreating anything.
      if (this.panelElement.parentElement !== container) {
        container.append(this.panelElement);
      }
      return this.panelElement;
    }
    const doc = container.ownerDocument;
    const shell = this.createShell(doc);
    this.panelElement = shell.root;
    this.bodyElement = shell.body;
    this.kindElement = shell.kind;
    this.titleElement = shell.title;
    container.append(shell.root);

    const root = shell.root;
    const onClick = (event: Event): void => this.handlePanelClick(event);
    root.addEventListener('click', onClick);
    this.bindings.add({
      element: root,
      dispose: () => root.removeEventListener('click', onClick),
    });
    if (this.escapeToClear) {
      this.bindings.add(
        this.bindKeyDown(doc, (event) => {
          if (this.handleKeyDown(event)) {
            event.preventDefault();
          }
        }),
      );
    }
    if (this.selectionValue) {
      this.renderSelection();
    } else {
      this.applyEmptyState();
    }
    return root;
  }

  /**
   * Re-renders the selected entity's live values when the refresh cadence is
   * due. Returns `true` when values were synced. `nowMs` defaults to the
   * injected clock, so tests can drive the cadence deterministically.
   */
  update(nowMs: number = this.nowMs()): boolean {
    if (this.disposedFlag || !this.selectionValue || !this.panelElement) {
      return false;
    }
    const last = this.lastRefreshAt;
    // A caller whose clock moved backwards (or handed us a fresh epoch) always
    // gets a refresh; otherwise the cadence throttles the DOM work.
    if (last !== null && nowMs >= last && nowMs - last < this.refreshIntervalMs) {
      this.skippedRefreshCountValue += 1;
      return false;
    }
    this.lastRefreshAt = nowMs;
    this.syncDom();
    return true;
  }

  /** Removes the panel, its listeners and every input binding. Idempotent. */
  dispose(): void {
    if (this.disposedFlag) {
      return;
    }
    this.disposedFlag = true;
    for (const binding of this.bindings) {
      binding.dispose();
    }
    this.bindings.clear();
    this.detachDom();
    this.listeners.clear();
    this.sectionSyncs = [];
    this.selectionValue = null;
  }

  /* ------------------------------------------------------------ selection -- */

  /**
   * Selects an entity by kind and id and renders its full record immediately.
   * Re-selecting the same entity only re-syncs values, so the panel node is
   * never rebuilt needlessly. Throws on an unknown kind or an empty id.
   */
  select(kind: InspectorEntityKind, id: EntityId): boolean {
    this.assertUsable('select');
    if (!isInspectorEntityKind(kind)) {
      throw new TypeError(`select() received an unknown entity kind "${String(kind)}"`);
    }
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('select() requires a non-empty entity id');
    }
    const previous = this.selectionValue;
    const changed = previous === null || previous.kind !== kind || previous.id !== id;
    this.selectionValue = { kind, id };
    this.lastRefreshAt = this.nowMs();
    if (changed) {
      this.renderSelection();
      this.notify();
    } else {
      this.syncDom();
    }
    return true;
  }

  /** Selects an entity from a pick result; ground picks clear the panel. */
  applyPick(pick: EntityPick): InspectorSelection | null {
    this.assertUsable('applyPick');
    if (pick.kind === 'ground' || pick.id === null) {
      this.clearSelection();
      return null;
    }
    const kind: PickedEntityKind = pick.kind;
    this.select(kind, pick.id);
    return this.selection;
  }

  /**
   * Clears the selection, empties the panel and hides it. Returns `true` when a
   * selection was actually dropped.
   */
  clearSelection(): boolean {
    if (!this.selectionValue) {
      return false;
    }
    this.selectionValue = null;
    this.lastRefreshAt = null;
    this.applyEmptyState();
    this.notify();
    return true;
  }

  /** Alias of {@link clearSelection}, for terse host code. */
  clear(): boolean {
    return this.clearSelection();
  }

  /** Subscribes to selection changes; returns an unsubscribe function. */
  onSelectionChange(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /* -------------------------------------------------------------- input -- */

  /**
   * Handles an `Escape` key press: clears the selection and returns `true` when
   * it did, so hosts that own their keyboard input get the same behaviour as
   * the listener {@link attach} installs.
   */
  handleKeyDown(event: { readonly key?: string }): boolean {
    if (this.disposedFlag) {
      return false;
    }
    if (event?.key !== 'Escape' && event?.key !== 'Esc') {
      return false;
    }
    return this.clearSelection();
  }

  /**
   * Wires click-to-inspect: the element (the canvas, usually) receives the
   * pointer event, the picker resolves it against the camera, and the panel
   * selects the entity or clears on a ground click. The returned binding is
   * disposed with the inspector.
   */
  bindPicking(options: InspectorPickingOptions): InspectorBinding {
    this.assertUsable('bindPicking');
    const element = options?.element;
    if (!element) {
      throw new TypeError('bindPicking() requires the element that receives the clicks');
    }
    const type = options.event ?? 'pointerdown';
    const handler = (event: Event): void => {
      const mouse = event as MouseEvent;
      if (typeof mouse.clientX !== 'number' || typeof mouse.clientY !== 'number') {
        return;
      }
      const rect = element.getBoundingClientRect();
      this.applyPick(options.picker.pickScreen({ x: mouse.clientX - rect.left, y: mouse.clientY - rect.top }));
    };
    element.addEventListener(type, handler);
    const binding: InspectorBinding = {
      element,
      dispose: () => element.removeEventListener(type, handler),
    };
    this.bindings.add(binding);
    return binding;
  }

  /* -------------------------------------------------------------- private -- */

  /** Panel shell: header (kind, title, close) plus an empty body. */
  private createShell(doc: Document): {
    root: HTMLElement;
    body: HTMLElement;
    kind: HTMLElement;
    title: HTMLElement;
  } {
    const root = doc.createElement('section');
    root.className = 'inspector';
    root.dataset.open = 'false';
    root.hidden = true;
    root.setAttribute('role', 'complementary');
    root.setAttribute('aria-label', this.label);

    const header = doc.createElement('header');
    header.className = 'inspector__header';
    const kind = doc.createElement('span');
    kind.className = 'inspector__kind';
    const title = doc.createElement('h2');
    title.className = 'inspector__title';
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'inspector__close';
    close.dataset.action = 'clear';
    close.setAttribute('aria-label', 'Close details');
    close.textContent = '×';
    header.append(kind, title, close);

    const body = doc.createElement('div');
    body.className = 'inspector__body';
    root.append(header, body);
    return { root, body, kind, title };
  }

  private bindKeyDown(doc: Document, handler: (event: KeyboardEvent) => void): InspectorBinding {
    const listener = (event: Event): void => handler(event as KeyboardEvent);
    doc.addEventListener('keydown', listener);
    return {
      element: null,
      dispose: () => doc.removeEventListener('keydown', listener),
    };
  }

  private handlePanelClick(event: Event): void {
    const target = event.target as Element | null;
    const action = target?.closest?.('[data-action]') as HTMLElement | null;
    if (!action) {
      return;
    }
    const name = action.dataset.action;
    if (name === 'clear') {
      this.clearSelection();
      return;
    }
    if (name !== 'inspect') {
      return;
    }
    const kind = action.dataset.entityKind ?? '';
    const id = action.dataset.entityId ?? '';
    if (isInspectorEntityKind(kind) && id.length > 0) {
      this.select(kind, id);
    }
  }

  private detachDom(): void {
    this.panelElement?.remove();
    this.panelElement = null;
    this.bodyElement = null;
    this.kindElement = null;
    this.titleElement = null;
    this.sectionSyncs = [];
  }

  private applyEmptyState(): void {
    const panel = this.panelElement;
    if (panel) {
      panel.hidden = true;
      panel.dataset.open = 'false';
      delete panel.dataset.kind;
      delete panel.dataset.entityId;
    }
    if (this.titleElement) {
      this.titleElement.textContent = '';
    }
    if (this.kindElement) {
      this.kindElement.textContent = '';
    }
    this.bodyElement?.replaceChildren();
    this.sectionSyncs = [];
    this.unavailableState = false;
  }

  private renderSelection(): void {
    const selection = this.selectionValue;
    const panel = this.panelElement;
    const body = this.bodyElement;
    if (!selection || !panel || !body) {
      this.applyEmptyState();
      return;
    }
    const doc = panel.ownerDocument;
    body.replaceChildren();
    this.sectionSyncs = [];
    this.unavailableState = false;
    panel.hidden = false;
    panel.dataset.open = 'true';
    panel.dataset.kind = selection.kind;
    panel.dataset.entityId = selection.id;

    const view = buildEntityView(selection.kind, selection.id, this.buildContext());
    if (!view) {
      this.unavailableState = true;
      if (this.kindElement) {
        this.kindElement.textContent = selection.kind;
      }
      if (this.titleElement) {
        this.titleElement.textContent = `Unknown ${selection.kind}`;
      }
      const note = doc.createElement('p');
      note.className = 'inspector__empty';
      note.dataset.section = 'inspector.unavailable';
      note.textContent = `No ${selection.kind} record matches “${selection.id}”.`;
      body.append(note);
      return;
    }
    if (this.kindElement) {
      this.kindElement.textContent = view.kindLabel;
    }
    if (this.titleElement) {
      this.titleElement.textContent = view.title;
    }
    for (const spec of view.sections) {
      this.sectionSyncs.push(this.renderSection(doc, body, spec));
    }
    this.syncDom();
  }

  private renderSection(doc: Document, parent: HTMLElement, spec: SectionSpec): () => void {
    const element = doc.createElement('section');
    element.className = 'inspector__section';
    element.dataset.section = spec.key;
    const heading = doc.createElement('h3');
    heading.className = 'inspector__section-title';
    heading.textContent = spec.label;
    element.append(heading);

    const syncs: (() => void)[] = [];
    const fields = spec.fields ?? [];
    if (fields.length > 0) {
      const container = doc.createElement('div');
      container.className = 'inspector__fields';
      element.append(container);
      const view = new FieldListView(doc, container);
      syncs.push(() => view.sync(spec.fields ?? []));
    }
    for (const listSpec of spec.lists ?? []) {
      const listHeading = doc.createElement('h4');
      listHeading.className = 'inspector__list-title';
      listHeading.textContent = listSpec.label;
      const container = doc.createElement('ol');
      container.className = 'inspector__list';
      container.dataset.list = listSpec.key;
      element.append(listHeading, container);
      const view = new ListView(doc, container, listSpec);
      syncs.push(() => view.sync());
    }
    parent.append(element);
    return () => {
      for (const sync of syncs) {
        sync();
      }
    };
  }

  /** Re-reads every value getter in place, without touching the panel nodes. */
  private syncDom(): void {
    const selection = this.selectionValue;
    if (!selection || !this.panelElement) {
      return;
    }
    const ctx = this.buildContext();
    const exists = this.hasEntity(selection, ctx);
    if (!exists) {
      // The record vanished (a recycled vehicle, a removed citizen): fall back
      // to the explicit empty state instead of showing stale values.
      if (!this.unavailableState) {
        this.renderSelection();
      }
      return;
    }
    if (this.unavailableState) {
      // A record for the selection exists again: render the live record.
      this.renderSelection();
      return;
    }
    for (const sync of this.sectionSyncs) {
      sync();
    }
    this.refreshCountValue += 1;
  }

  private hasEntity(selection: InspectorSelection, ctx: ViewContext): boolean {
    switch (selection.kind) {
      case 'citizen':
        return ctx.citizenById(selection.id) !== null;
      case 'company':
        return ctx.companyById(selection.id) !== null;
      case 'vehicle':
        return ctx.vehicleById(selection.id) !== null;
      case 'building':
        return ctx.buildingById(selection.id) !== null;
    }
  }

  private buildContext(): ViewContext {
    const world = this.sources.world ?? null;
    const citizens = this.sources.citizens ?? null;
    const companies = this.sources.companies ?? null;
    const vehicles = this.sources.vehicles ?? null;
    const buildings = this.sources.buildings ?? null;
    const clock = this.sources.clock ?? null;

    const citizenById = (id: EntityId): Citizen | null =>
      citizens?.citizenById(id) ?? world?.citizens.find((citizen) => citizen.id === id) ?? null;
    const buildingById = (id: EntityId): BuildingRecord | null => {
      const direct = buildings?.buildingById(id);
      if (direct) {
        return direct;
      }
      return world?.buildings.find((building) => building.id === id) ?? null;
    };
    const companyById = (id: EntityId): CompanyInspectionRecord | null => {
      const direct = companies?.companyById(id);
      if (direct) {
        return direct;
      }
      return world?.companies.find((company) => company.id === id) ?? null;
    };
    const vehicleById = (id: EntityId): Vehicle | null =>
      vehicles?.vehicleById(id) ?? world?.vehicles.find((vehicle) => vehicle.id === id) ?? null;
    const roster = (): readonly Citizen[] => citizens?.citizens ?? world?.citizens ?? [];
    const toEntry = (citizen: Citizen): CitizenEntry => ({ id: citizen.id, citizen });

    return {
      citizenById,
      buildingById,
      companyById,
      vehicleById,
      residentsOfBuilding: (id) => {
        const households = new Set(buildingById(id)?.residentHouseholdIds ?? []);
        return roster()
          .filter((citizen) => citizen.homeBuildingId === id || households.has(citizen.householdId))
          .map(toEntry);
      },
      employeesOfBuilding: (id) =>
        roster()
          .filter((citizen) => citizen.occupation.workplaceBuildingId === id)
          .map(toEntry),
      citizenDetails: (id) => citizens?.detailsFor?.(id) ?? null,
      vehicleDetails: (id) => vehicles?.detailsFor?.(id) ?? null,
      companyLedger: (id) => {
        const ledger = companies?.ledgerFor?.(id);
        if (ledger) {
          return ledger;
        }
        return companyById(id)?.revenueHistory ?? [];
      },
      districtName: (id) => {
        if (!id) {
          return null;
        }
        return buildings?.districts?.find((district) => district.id === id)?.name ?? null;
      },
      minuteOfDay: () => {
        if (clock) {
          return normaliseMinuteOfDay(clock.totalMinutes);
        }
        const citizenMinute = citizens?.minuteOfDay;
        return typeof citizenMinute === 'number' ? normaliseMinuteOfDay(citizenMinute) : null;
      },
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.selection);
    }
  }

  private assertUsable(operation: string): void {
    if (this.disposedFlag) {
      throw new Error(`EntityInspector.${operation}() called after dispose()`);
    }
  }
}
