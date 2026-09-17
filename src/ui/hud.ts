/**
 * Top HUD overlay: a DOM-only status bar pinned to the top of the city canvas.
 *
 * The overlay shows the four readouts the product requires — city time with a
 * day/night indicator, population, employment rate and the city budget with its
 * hourly delta — plus a compact set of secondary economy figures (sim day,
 * aggregate company revenue, active vehicles). It never touches the renderer or
 * a canvas: every value it shows comes from the published economy snapshot
 * (`EconomySystem.hudStats()`), from the aggregate company ledger, or from the
 * sim clock when nothing else is bound.
 *
 * ## Cadence
 *
 * The bar refreshes on two paths:
 *
 * 1. **Settlements.** While an economy is bound the overlay subscribes to
 *    `onSettlement`, so every sim-hour boundary publishes a fresh snapshot and
 *    the bar is repainted immediately (population, employment, budget and the
 *    hourly budget delta all change together).
 * 2. **Ticks.** `update()` runs once per fixed step like any other engine
 *    system, but only repaints when the throttle window has elapsed (250 ms by
 *    default). Per-frame DOM writes are therefore rare, and the value is
 *    recomputed at most four times a second even at 60 fps.
 *
 * Both paths funnel through {@link HudOverlay.write}, which skips any write
 * whose text is unchanged. Together with the tabular figures and fixed minimum
 * widths in `hud.css`, an update can never reflow or shift the row.
 *
 * ## Lifecycle
 *
 * ```ts
 * const hud = new HudOverlay({ document, economy, companies }); // instantiate
 * engine.attach(hud);                                         // attach
 * // engine calls hud.update(context) each fixed step; economy calls back each hour
 * hud.dispose();                                              // dispose
 * ```
 *
 * The module is DOM-only and has no import-time side effects beyond pulling in
 * its own stylesheet.
 */

import './hud.css';

import type { EngineContext, SimSystem, SimulationEngine } from '../sim/engine';
import type { SimClock } from '../sim/clock';
import type { CompaniesSystem } from '../sim/companies';
import type { EconomySystem } from '../sim/economy';
import { DAY_PHASES } from '../sim/types';
import type { DayPhase, HudStats } from '../sim/types';

/* ------------------------------------------------------------- constants -- */

/** System name registered with the engine unless the caller overrides it. */
export const HUD_SYSTEM_NAME = 'hud';

/** Default throttle window between tick-driven repaints, in milliseconds. */
export const DEFAULT_HUD_THROTTLE_MS = 250;

/** Marker shown next to a budget that grew over the last settlement. */
export const DELTA_UP = '▲';
/** Marker shown next to a budget that shrank over the last settlement. */
export const DELTA_DOWN = '▼';
/** Marker shown when the budget did not move over the last settlement. */
export const DELTA_FLAT = '■';

/** Icon half of the day/night indicator, per day phase. */
export const DAY_PHASE_ICONS: Readonly<Record<DayPhase, string>> = {
  night: '☾',
  dawn: '☀',
  morning: '☀',
  day: '☀',
  evening: '☀',
};

/** Word half of the day/night indicator, per day phase. */
export const DAY_PHASE_LABELS: Readonly<Record<DayPhase, string>> = {
  night: 'Night',
  dawn: 'Dawn',
  morning: 'Morning',
  day: 'Day',
  evening: 'Evening',
};

/** Every value the overlay can paint, keyed by its `data-readout` attribute. */
export const HUD_READOUTS = [
  'time',
  'phase',
  'population',
  'employment',
  'budget',
  'budget-delta',
  'day',
  'revenue',
  'vehicles',
] as const;

export type HudReadoutKey = (typeof HUD_READOUTS)[number];

/** The four readouts the product requires, before the secondary figures. */
export const REQUIRED_HUD_READOUTS: readonly HudReadoutKey[] = [
  'time',
  'phase',
  'population',
  'employment',
  'budget',
  'budget-delta',
];

/** Secondary economy readouts appended after the required four. */
export const SECONDARY_HUD_READOUTS: readonly HudReadoutKey[] = ['day', 'revenue', 'vehicles'];

/* ------------------------------------------------------------------ types -- */

/**
 * Values one repaint renders.
 *
 * It is the shared {@link HudStats} contract plus the two economy flow fields
 * the overlay decorates it with; `EconomyHudStats` satisfies it structurally,
 * so `economy.hudStats()` can be rendered as-is.
 */
export interface HudSnapshot extends HudStats {
  /** Movement of the city budget over the hour that just settled. */
  readonly budgetDelta?: number;
  /** Aggregate company revenue for the current sim-day. */
  readonly totalRevenue?: number;
}

/** Constructor options for {@link HudOverlay}. */
export interface HudOverlayOptions {
  /** Document used to create the bar. Defaults to the global `document`. */
  document?: Document;
  /** Element the bar is appended to. Defaults to `#app`, then `document.body`. */
  container?: HTMLElement | null;
  /** Economy system backing the live stats and the hourly settlement events. */
  economy?: EconomySystem | null;
  /** Company system supplying the secondary aggregate-revenue readout. */
  companies?: CompaniesSystem | null;
  /** Clock used for the time readout when no economy is bound. */
  clock?: SimClock | null;
  /** Override stats source; takes precedence over `economy` when supplied. */
  stats?: (() => HudSnapshot) | null;
  /** Minimum real milliseconds between tick-driven repaints. Defaults to 250. */
  throttleMs?: number;
  /** Monotonic clock used for throttling. Defaults to `performance.now`. */
  now?: () => number;
  /** System name registered with the engine. Defaults to `hud`. */
  name?: string;
}

/* -------------------------------------------------------------- formatting -- */

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function finite(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampInteger(value: number | undefined, min: number, max: number): number {
  const safe = Math.trunc(finite(value));
  if (safe < min) {
    return min;
  }
  return safe > max ? max : safe;
}

/** Inserts thousands separators into a decimal integer string. */
function groupDigits(digits: string): string {
  const negative = digits.startsWith('-');
  const body = negative ? digits.slice(1) : digits;
  let grouped = '';
  for (let index = 0; index < body.length; index += 1) {
    if (index > 0 && (body.length - index) % 3 === 0) {
      grouped += ',';
    }
    grouped += body[index];
  }
  return negative ? `-${grouped}` : grouped;
}

/** `1234` -> `"1,234"`; non-finite values read as `0`. */
export function formatInteger(value: number): string {
  return groupDigits(String(Math.trunc(finite(value))));
}

/** `250000` -> `"$250,000.00"`; `-12.5` -> `"-$12.50"`. */
export function formatMoney(value: number): string {
  const safe = finite(value);
  const negative = safe < 0;
  const cents = Math.round(Math.abs(safe) * 100);
  const whole = Math.trunc(cents / 100);
  const fraction = cents % 100;
  return `${negative ? '-' : ''}$${groupDigits(String(whole))}.${pad2(fraction)}`;
}

/** `0.8` -> `"80%"`; rounds to the nearest whole percent. */
export function formatPercent(rate: number): string {
  return `${Math.round(finite(rate) * 100)}%`;
}

/** `(7, 5)` -> `"07:05"`; always two digits per field so the width is stable. */
export function formatClock(hour: number, minute: number): string {
  return `${pad2(clampInteger(hour, 0, 23))}:${pad2(clampInteger(minute, 0, 59))}`;
}

/** Direction of a budget movement, used for styling and for the delta glyph. */
export function budgetTrend(delta: number): 'up' | 'down' | 'flat' {
  const safe = finite(delta);
  if (safe === 0) {
    return 'flat';
  }
  return safe > 0 ? 'up' : 'down';
}

/** `1234.56` -> `"▲ $1,234.56"`; `-12.5` -> `"▼ $12.50"`; `0` -> `"■ $0.00"`. */
export function formatBudgetDelta(delta: number): string {
  const trend = budgetTrend(delta);
  const glyph = trend === 'up' ? DELTA_UP : trend === 'down' ? DELTA_DOWN : DELTA_FLAT;
  return `${glyph} ${formatMoney(Math.abs(finite(delta)))}`;
}

function isDayPhase(value: unknown): value is DayPhase {
  return typeof value === 'string' && (DAY_PHASES as readonly string[]).includes(value);
}

function defaultNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/** Stats used before any source has published anything. */
function emptySnapshot(): HudSnapshot {
  return {
    population: 0,
    employedCitizens: 0,
    employmentRate: 0,
    cityTimeLabel: 'Day 1, 00:00',
    cityBudget: 0,
    day: 0,
    hour: 0,
    minute: 0,
    phase: 'night',
    citizenCount: 0,
    vehicleCount: 0,
    companyCount: 0,
    buildingCount: 0,
    averageMood: 0,
    budgetDelta: 0,
    totalRevenue: 0,
  };
}

/* --------------------------------------------------------------- overlay -- */

/**
 * The top overlay. Attach it to the engine exactly like any other system; it
 * paints the published economy snapshot into the DOM bar and throttles the
 * per-tick repaints so frame time is never dominated by layout work.
 */
export class HudOverlay implements SimSystem {
  readonly name: string;

  /** Root `.hud` element, absolutely positioned over the canvas. */
  readonly root: HTMLElement;
  /** The single `.hud__bar` row that holds every readout. */
  readonly bar: HTMLElement;

  private readonly doc: Document;
  private readonly throttleMs: number;
  private readonly nowFn: () => number;
  private readonly readouts = new Map<HudReadoutKey, HTMLElement>();
  private readonly textCache = new Map<HudReadoutKey, string>();

  private economyRef: EconomySystem | null;
  private companiesRef: CompaniesSystem | null;
  private clockRef: SimClock | null;
  private statsRef: (() => HudSnapshot) | null;
  private unsubscribeSettlement: (() => void) | null = null;
  private engineRef: SimulationEngine | null = null;
  private snapshotValue: HudSnapshot | null = null;
  private lastRenderMs: number | null = null;
  private renderCountValue = 0;
  private disposedFlag = false;

  constructor(options: HudOverlayOptions = {}) {
    const doc = options.document ?? (typeof document === 'undefined' ? undefined : document);
    if (!doc) {
      throw new Error('new HudOverlay() needs a Document; pass options.document outside a browser.');
    }
    this.doc = doc;
    this.name = options.name ?? HUD_SYSTEM_NAME;

    const throttleMs = options.throttleMs ?? DEFAULT_HUD_THROTTLE_MS;
    if (!Number.isFinite(throttleMs) || throttleMs < 0) {
      throw new RangeError(`HudOverlay throttleMs must be a non-negative number, received ${throttleMs}`);
    }
    this.throttleMs = throttleMs;
    this.nowFn = options.now ?? defaultNow;

    this.economyRef = options.economy ?? null;
    this.companiesRef = options.companies ?? null;
    this.clockRef = options.clock ?? null;
    this.statsRef = options.stats ?? null;

    this.root = doc.createElement('div');
    this.root.className = 'hud';
    this.root.setAttribute('data-hud', '');
    this.bar = doc.createElement('div');
    this.bar.className = 'hud__bar';
    this.bar.setAttribute('role', 'status');
    this.bar.setAttribute('aria-live', 'polite');
    this.bar.setAttribute('aria-label', 'City dashboard');
    this.root.appendChild(this.bar);
    this.buildReadouts();

    const container = options.container ?? doc.getElementById('app') ?? doc.body;
    container?.appendChild(this.root);

    // A source is available (or not): paint the initial row immediately, so the
    // bar never shows placeholders once it is on screen.
    this.write(this.readSnapshot());
    this.subscribeSettlement();
  }

  /* ------------------------------------------------------------ lifecycle -- */

  /** Whether the overlay is currently attached to an engine. */
  get attached(): boolean {
    return this.engineRef !== null;
  }

  /** Last snapshot painted into the DOM, or `null` after `dispose()`. */
  get snapshot(): HudSnapshot | null {
    return this.snapshotValue;
  }

  /** Number of repaints performed since construction (tests and diagnostics). */
  get renderCount(): number {
    return this.renderCountValue;
  }

  /**
   * Registers the overlay with the engine so it receives the fixed-step tick.
   * Returns the engine's detach function. Idempotent per engine.
   */
  attach(engine: SimulationEngine): () => boolean {
    this.assertUsable('attach');
    return engine.attach(this);
  }

  /** Called once when the engine attaches the overlay; paints the first row. */
  onAttach(context: EngineContext): void {
    this.engineRef = context.engine;
    this.subscribeSettlement();
    this.refresh(true);
  }

  /** Called once when the engine detaches the overlay or is disposed. */
  onDetach(): void {
    this.engineRef = null;
    this.unsubscribeSettlement?.();
    this.unsubscribeSettlement = null;
  }

  /**
   * Called once per fixed step. Repaints only when the throttle window has
   * elapsed; settlement updates bypass this path entirely.
   */
  update(_context: EngineContext): void {
    this.refresh(false);
  }

  /** Detaches, unsubscribes and removes the bar. Safe to call more than once. */
  dispose(): void {
    if (this.disposedFlag) {
      return;
    }
    this.disposedFlag = true;
    this.unsubscribeSettlement?.();
    this.unsubscribeSettlement = null;
    const engine = this.engineRef;
    this.engineRef = null;
    engine?.detach(this);
    this.root.remove();
    this.readouts.clear();
    this.textCache.clear();
    this.snapshotValue = null;
  }

  /* ---------------------------------------------------------- composition -- */

  /** Binds (or clears) the economy supplying live stats and settlements. */
  bindEconomy(economy: EconomySystem | null): void {
    if (this.economyRef === economy) {
      return;
    }
    this.unsubscribeSettlement?.();
    this.unsubscribeSettlement = null;
    this.economyRef = economy;
    this.subscribeSettlement();
  }

  /** Binds (or clears) the company system behind the aggregate-revenue field. */
  bindCompanies(companies: CompaniesSystem | null): void {
    this.companiesRef = companies;
  }

  /** Binds (or clears) the clock used when no economy is available. */
  bindClock(clock: SimClock | null): void {
    this.clockRef = clock;
  }

  /* -------------------------------------------------------------- reading -- */

  /** The element painting one readout, or `null` after disposal. */
  readout(key: HudReadoutKey): HTMLElement | null {
    return this.readouts.get(key) ?? null;
  }

  /** Paints a snapshot immediately. Throws after `dispose()`. */
  render(snapshot: HudSnapshot): void {
    this.assertUsable('render');
    this.write(snapshot);
  }

  /**
   * Pulls the latest stats and repaints.
   * Without `force` the throttle window must have elapsed.
   */
  refresh(force = false): void {
    if (this.disposedFlag) {
      return;
    }
    if (!force && !this.throttleElapsed()) {
      return;
    }
    this.write(this.readSnapshot());
  }

  /* ------------------------------------------------------------ internals -- */

  private buildReadouts(): void {
    // Required: city time with its day/night indicator, in one item.
    const timeItem = this.createItem('time', 'City time');
    const timeValue = this.createValue();
    timeValue.append(
      this.createReadout('time', 'hud__clock'),
      this.createReadout('phase', 'hud__phase', { 'data-phase': 'night', 'data-night': 'true' }),
    );
    timeItem.appendChild(timeValue);

    // Required: population and employment rate.
    this.addValueItem('population', 'Population', 'population', 'hud__num');
    this.addValueItem('employment', 'Employment', 'employment', 'hud__num');

    // Required: city budget with the hourly delta of the last settlement.
    const budgetItem = this.createItem('budget', 'City budget');
    const budgetValue = this.createValue();
    budgetValue.append(
      this.createReadout('budget', 'hud__num hud__money'),
      this.createReadout('budget-delta', 'hud__delta', { 'data-trend': 'flat' }),
    );
    budgetItem.appendChild(budgetValue);

    // Secondary economy readouts, pushed to the right but on the same row.
    const spacer = this.doc.createElement('span');
    spacer.className = 'hud__spacer';
    spacer.setAttribute('aria-hidden', 'true');
    this.bar.appendChild(spacer);

    this.addValueItem('day', 'Sim day', 'day', 'hud__num', 'secondary');
    this.addValueItem('revenue', 'Company revenue', 'revenue', 'hud__num hud__money', 'secondary');
    this.addValueItem('vehicles', 'Vehicles', 'vehicles', 'hud__num', 'secondary');
  }

  private createItem(modifier: string, label: string, group = ''): HTMLElement {
    const item = this.doc.createElement('div');
    item.className = `hud__item hud__item--${modifier}${group ? ` hud__item--${group}` : ''}`;
    const labelElement = this.doc.createElement('span');
    labelElement.className = 'hud__label';
    labelElement.textContent = label;
    item.appendChild(labelElement);
    this.bar.appendChild(item);
    return item;
  }

  private createValue(): HTMLSpanElement {
    const value = this.doc.createElement('span');
    value.className = 'hud__value';
    return value;
  }

  private createReadout(
    key: HudReadoutKey,
    className: string,
    attributes: Record<string, string> = {},
  ): HTMLSpanElement {
    const element = this.doc.createElement('span');
    element.className = className;
    element.setAttribute('data-readout', key);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    element.textContent = '—';
    this.readouts.set(key, element);
    return element;
  }

  private addValueItem(
    modifier: string,
    label: string,
    key: HudReadoutKey,
    className: string,
    group = '',
  ): HTMLElement {
    const item = this.createItem(modifier, label, group);
    const value = this.createValue();
    value.appendChild(this.createReadout(key, className));
    item.appendChild(value);
    return item;
  }

  private subscribeSettlement(): void {
    const economy = this.economyRef;
    if (!economy || this.unsubscribeSettlement || this.disposedFlag) {
      return;
    }
    this.unsubscribeSettlement = economy.onSettlement(() => {
      // A settlement is the authoritative snapshot: bypass the throttle.
      this.refresh(true);
    });
  }

  private readSnapshot(): HudSnapshot {
    const provider = this.statsRef;
    if (provider) {
      return provider();
    }
    const economy = this.economyRef;
    if (economy) {
      return economy.hudStats();
    }
    const clock = this.clockRef;
    if (!clock) {
      return emptySnapshot();
    }
    const time = clock.time;
    return {
      population: 0,
      employedCitizens: 0,
      employmentRate: 0,
      cityTimeLabel: clock.formatDayTime(),
      cityBudget: 0,
      day: time.day,
      hour: time.hour,
      minute: time.minute,
      phase: clock.phase,
      citizenCount: 0,
      vehicleCount: 0,
      companyCount: 0,
      buildingCount: 0,
      averageMood: 0,
      budgetDelta: 0,
      totalRevenue: 0,
    };
  }

  private revenueOf(snapshot: HudSnapshot): number {
    const companies = this.companiesRef;
    if (companies) {
      return companies.totals().revenue;
    }
    return finite(snapshot.totalRevenue);
  }

  private write(snapshot: HudSnapshot): void {
    if (this.disposedFlag) {
      return;
    }
    this.snapshotValue = snapshot;

    const day = clampInteger(snapshot.day, 0, Number.MAX_SAFE_INTEGER);
    const hour = clampInteger(snapshot.hour, 0, 23);
    const minute = clampInteger(snapshot.minute, 0, 59);
    const phase: DayPhase = isDayPhase(snapshot.phase) ? snapshot.phase : 'night';
    const delta = finite(snapshot.budgetDelta);

    this.setText('time', formatClock(hour, minute));
    this.setText('phase', `${DAY_PHASE_ICONS[phase]} ${DAY_PHASE_LABELS[phase]}`);
    this.setReadoutAttribute('phase', 'data-phase', phase);
    this.setReadoutAttribute('phase', 'data-night', phase === 'night' ? 'true' : 'false');

    this.setText('population', formatInteger(snapshot.population));
    this.setText('employment', formatPercent(snapshot.employmentRate));
    this.setText('budget', formatMoney(snapshot.cityBudget));
    this.setText('budget-delta', formatBudgetDelta(delta));
    this.setReadoutAttribute('budget-delta', 'data-trend', budgetTrend(delta));

    this.setText('day', `Day ${day + 1}`);
    this.setText('revenue', formatMoney(this.revenueOf(snapshot)));
    this.setText('vehicles', formatInteger(snapshot.vehicleCount));

    this.lastRenderMs = this.nowFn();
    this.renderCountValue += 1;
  }

  private setText(key: HudReadoutKey, text: string): void {
    if (this.textCache.get(key) === text) {
      return;
    }
    this.textCache.set(key, text);
    const element = this.readouts.get(key);
    if (element) {
      element.textContent = text;
    }
  }

  private setReadoutAttribute(key: HudReadoutKey, name: string, value: string): void {
    const element = this.readouts.get(key);
    if (element && element.getAttribute(name) !== value) {
      element.setAttribute(name, value);
    }
  }

  private throttleElapsed(): boolean {
    if (this.lastRenderMs === null) {
      return true;
    }
    return this.nowFn() - this.lastRenderMs >= this.throttleMs;
  }

  private assertUsable(action: string): void {
    if (this.disposedFlag) {
      throw new Error(`HudOverlay.${action}() cannot be used after dispose()`);
    }
  }
}
