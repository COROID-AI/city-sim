// @vitest-environment jsdom
/**
 * Acceptance soak: the composed live city, driven headlessly through the
 * composition root for two full simulated days.
 *
 * This suite proves the request's explicit acceptance bars on the *assembled*
 * application, not on isolated units. It imports `src/main` (the same entry the
 * browser loads), boots the real `LiveCityApp` — seeded `CityWorld`, `SimClock`,
 * `SimulationEngine`, `CitizensSystem`, `CompaniesSystem`, `VehiclesSystem`,
 * `EconomySystem`, `DayNightLighting`, `ViewportCamera`, `CityRenderer`,
 * `HudOverlay`, `Minimap`, `EntityPicker` and `EntityInspector` — and then
 * advances more than two simulated days through the engine that the page itself
 * drives (`app.engine.step`, the fixed-step path `pump()` feeds).
 *
 * What is asserted here:
 *
 * 1. **Auto-start** — loading the entry module boots and runs the app with no
 *    start button and no user gesture.
 * 2. **Simultaneous scale** — >= 20 buildings, >= 50 citizens and >= 10
 *    vehicles are live at the same instant, including through a commuter peak
 *    (`src/sim/vehicles.ts` names the peaks).
 * 3. **Daily schedules** — every citizen completes a full
 *    home -> work -> entertainment -> home cycle on each simulated day, with the
 *    entertainment outing inside that citizen's own scheduled evening window.
 * 4. **Hourly economy** — exactly one settlement per sim-hour (48 over two
 *    days), with companies settling the same cadence.
 * 5. **Day/night visibility** — the lighting palette the renderer consumes
 *    changes materially between midnight and noon (sun elevation, window glow,
 *    street lights, sky luminance, ambient veil).
 * 6. **HUD** — population, employment, city time and budget are painted on load
 *    and change as sim time advances.
 * 7. **Minimap** — the viewport rectangle tracks the camera exactly through pan
 *    and zoom, and the minimap really paints it.
 *
 * jsdom has no canvas backend, so `getContext('2d')` is served by the shared
 * recording double; the composition itself is untouched by that. The browser /
 * visual scenarios (`daynight-noon`, `daynight-night`, `minimap-tracks-viewport`,
 * `hud-live-updates`) run against the served app outside this headless suite.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CityAppOptions, LiveCityApp } from '../../src/main';
import type { LightingSample } from '../../src/render/daynight';
import { skyLuminance } from '../../src/render/daynight';
import { MINUTES_PER_DAY, MINUTES_PER_HOUR } from '../../src/sim/clock';
import { DEFAULT_INITIAL_BUDGET } from '../../src/sim/economy';
import type { ActivityKind } from '../../src/sim/types';
import { isCommutePeak } from '../../src/sim/vehicles';
import { formatInteger, formatMoney, formatPercent } from '../../src/ui/hud';
import { worldRectToMinimapRect } from '../../src/ui/minimap';
import { createRecordingContext } from '../helpers/fake-canvas';
import type { RecordingContext2D } from '../helpers/fake-canvas';

/* ------------------------------------------------------------- expectation -- */

/** Buildings the running city must hold simultaneously. */
const REQUIRED_BUILDINGS = 20;
/** Citizens the running city must hold simultaneously. */
const REQUIRED_CITIZENS = 50;
/** Vehicles the running city must hold simultaneously. */
const REQUIRED_VEHICLES = 10;
/** Simulated days the soak covers. */
const SOAK_DAYS = 2;
/** Sim-minutes of the soak: exactly two full schedule rings per citizen. */
const SOAK_MINUTES = SOAK_DAYS * MINUTES_PER_DAY;
/** Settlement count two full days must produce: one per sim-hour. */
const REQUIRED_SETTLEMENTS = SOAK_DAYS * 24;
/** Sim-minute of the day the scale sample is taken at (morning commuter peak). */
const MORNING_PEAK_MINUTE_OF_DAY = 8 * MINUTES_PER_HOUR;
/** Midday checkpoint (day 1, 12:00): employment is staffed and the sun is up. */
const MIDDAY_MINUTES = MINUTES_PER_DAY + 12 * MINUTES_PER_HOUR;
/** Night checkpoint (day 1, 21:00): deep night palette. */
const NIGHT_MINUTES = MINUTES_PER_DAY + 21 * MINUTES_PER_HOUR;
/** Host viewport the shell reports; the city is 160x120 tiles. */
const VIEWPORT = { width: 1280, height: 800 };

/* ---------------------------------------------------------------- harness -- */

const contexts = new Map<HTMLCanvasElement, RecordingContext2D>();
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext =
  HTMLCanvasElement.prototype.getContext;
/** Every app this file created, disposed by the active suite's cleanup hook. */
const created: LiveCityApp[] = [];

function track(app: LiveCityApp): LiveCityApp {
  created.push(app);
  return app;
}

function installRecordingContexts(): void {
  contexts.clear();
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
  ): CanvasRenderingContext2D | null {
    if (type !== '2d') {
      return null;
    }
    let context = contexts.get(this);
    if (!context) {
      context = createRecordingContext(this);
      contexts.set(this, context);
    }
    return context.toContext2D();
  } as unknown as HTMLCanvasElement['getContext'];
}

function restoreRecordingContexts(): void {
  for (const app of [...created].reverse()) {
    app.dispose();
  }
  created.length = 0;
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  contexts.clear();
  document.body.innerHTML = '';
  delete window.__citySim;
}

/** Builds the page shell the composition root mounts into. */
function buildShell(): void {
  document.body.innerHTML = `
    <div id="app">
      <canvas id="city-canvas" aria-label="Live city simulation"></canvas>
      <div id="minimap" class="minimap"></div>
      <p class="city-controls">Drag to pan · Space pauses</p>
    </div>`;
  const canvas = document.getElementById('city-canvas') as HTMLCanvasElement;
  // jsdom lays nothing out, so pin the canvas box: the camera viewport, the
  // canvas backing store and the minimap rectangle then agree deterministically.
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: VIEWPORT.width,
      bottom: VIEWPORT.height,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      toJSON: () => ({}),
    }),
  });
}

/**
 * Monotonic millisecond clock for the overlay cadences. It advances a
 * frame-sized step per read, so the HUD repaints on its own throttle and the
 * minimap/inspector throttles behave like they do in a browser.
 */
function uiClock(stepMs = 16): () => number {
  let cursor = 0;
  return () => {
    cursor += stepMs;
    return cursor;
  };
}

/** Boots the app the way the page does, but with the frame loop held for the test. */
async function bootApp(options: Partial<CityAppOptions> = {}): Promise<LiveCityApp> {
  const module = await import('../../src/main');
  const auto = module.getActiveCityApp();
  if (auto) {
    track(auto);
  }
  return track(
    module.bootCityApp({
      document,
      autoStart: false,
      startDay: 0,
      startHour: 0,
      startMinute: 0,
      speed: 60,
      now: uiClock(),
      ...options,
    }),
  );
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

/* ------------------------------------------------------------ observation -- */

/** The four HUD readouts plus the day/night indicator, as painted. */
interface HudReadoutSample {
  readonly population: string;
  readonly employment: string;
  readonly time: string;
  readonly day: string;
  readonly budget: string;
  readonly phase: string;
  readonly isNight: boolean;
}

/** One citizen's day of observed behaviour. */
interface CitizenTrace {
  /** Canonical activities in observed order, with `errand` runs dropped. */
  readonly chain: ActivityKind[];
  /** Activities as observed each minute, `errand` included. */
  rawLast: ActivityKind | null;
  /** Last canonical activity pushed onto `chain`. */
  lastCanonical: ActivityKind | null;
  /** Minute-of-day the current entertainment stay began, or `null`. */
  entStart: number | null;
  entDay: number | null;
  /** Every observed entertainment stay. */
  readonly stays: EntertainmentStay[];
}

interface EntertainmentStay {
  readonly day: number;
  readonly startMinuteOfDay: number;
  readonly endMinuteOfDay: number;
}

/** Scheduled evening-outing window of one citizen, in minutes from midnight. */
interface EveningWindow {
  readonly startMinute: number;
  readonly durationMinutes: number;
}

/** Scale sample taken at the morning commuter peak of day 2. */
interface PeakSample {
  readonly minuteOfDay: number;
  readonly buildings: number;
  readonly citizens: number;
  readonly vehicles: number;
  readonly employedCitizens: number;
  readonly employmentRate: number;
}

interface SoakResult {
  readonly totalMinutes: number;
  readonly buildings: number;
  readonly citizens: number;
  readonly minBuildings: number;
  readonly minCitizens: number;
  readonly minVehicles: number;
  readonly maxVehicles: number;
  readonly minVehiclesInPeak: number;
  readonly peakVehiclesInPeak: number;
  readonly peakVehicleActive: number;
  readonly peakSample: PeakSample | null;
  readonly traces: ReadonlyMap<string, CitizenTrace>;
  readonly eveningWindows: ReadonlyMap<string, EveningWindow>;
  readonly totalStays: number;
  readonly calendarEveningStays: number;
  readonly settlementCount: number;
  readonly settlementMinutes: readonly number[];
  readonly companyHoursSettled: number;
  readonly loadHud: HudReadoutSample;
  readonly middayHud: HudReadoutSample | null;
  readonly finalHud: HudReadoutSample;
  readonly middayEmployment: number;
  readonly middayEmploymentRate: number;
  readonly loadRenderCount: number;
  readonly finalRenderCount: number;
  readonly startSample: LightingSample;
  readonly noonSample: LightingSample | null;
  readonly nightSample: LightingSample | null;
}

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function readHud(app: LiveCityApp): HudReadoutSample {
  const read = (key: string): string => app.hud.readout(key as never)?.textContent ?? '';
  const phaseElement = app.hud.readout('phase');
  return {
    population: read('population'),
    employment: read('employment'),
    time: read('time'),
    day: read('day'),
    budget: read('budget'),
    phase: phaseElement?.textContent ?? '',
    isNight: phaseElement?.getAttribute('data-night') === 'true',
  };
}

/** The citizen's scheduled entertainment slot, in minutes from midnight. */
function eveningWindowOf(
  schedule: readonly { activity: ActivityKind; startHour: number; endHour: number }[],
): EveningWindow {
  const slot = schedule.find((entry) => entry.activity === 'entertainment');
  if (!slot) {
    throw new Error('a citizen without an entertainment slot cannot be accepted');
  }
  const startMinute = mod(Math.round(slot.startHour * MINUTES_PER_HOUR), MINUTES_PER_DAY);
  const endMinute = mod(Math.round(slot.endHour * MINUTES_PER_HOUR), MINUTES_PER_DAY);
  return { startMinute, durationMinutes: Math.max(1, mod(endMinute - startMinute, MINUTES_PER_DAY)) };
}

/** Whether a minute-of-day lies inside a (possibly midnight-wrapping) window. */
function withinWindow(minuteOfDay: number, window: EveningWindow): boolean {
  return mod(minuteOfDay - window.startMinute, MINUTES_PER_DAY) < window.durationMinutes;
}

/**
 * Drives the composed app for two full simulated days, recording the scale,
 * schedule, economy, lighting and HUD evidence the acceptance bars need.
 */
function runSoak(app: LiveCityApp, totalMinutes = SOAK_MINUTES): SoakResult {
  const traces = new Map<string, CitizenTrace>();
  const eveningWindows = new Map<string, EveningWindow>();
  for (const citizen of app.citizens.citizens) {
    traces.set(citizen.id, {
      chain: [],
      rawLast: null,
      lastCanonical: null,
      entStart: null,
      entDay: null,
      stays: [],
    });
    eveningWindows.set(citizen.id, eveningWindowOf(citizen.schedule));
  }

  const loadHud = readHud(app);
  const loadRenderCount = app.hud.renderCount;
  const startSample = app.lighting.update();

  let minBuildings = Number.POSITIVE_INFINITY;
  let minCitizens = Number.POSITIVE_INFINITY;
  let minVehicles = Number.POSITIVE_INFINITY;
  let maxVehicles = 0;
  let minVehiclesInPeak = Number.POSITIVE_INFINITY;
  let peakVehiclesInPeak = 0;
  let middayHud: HudReadoutSample | null = null;
  let middayEmployment = 0;
  let middayEmploymentRate = 0;
  let noonSample: LightingSample | null = null;
  let nightSample: LightingSample | null = null;
  let peakSample: PeakSample | null = null;

  for (let minute = 0; minute < totalMinutes; minute += 1) {
    app.engine.step(1);
    const clock = app.clock;
    const minuteOfDay = clock.hourOfDay * MINUTES_PER_HOUR + clock.minuteOfHour;

    const buildings = app.world.buildings.length;
    const citizens = app.citizens.citizens.length;
    const active = app.vehicles.activeCount;
    if (buildings < minBuildings) {
      minBuildings = buildings;
    }
    if (citizens < minCitizens) {
      minCitizens = citizens;
    }
    if (active < minVehicles) {
      minVehicles = active;
    }
    if (active > maxVehicles) {
      maxVehicles = active;
    }
    if (isCommutePeak(minuteOfDay)) {
      if (active < minVehiclesInPeak) {
        minVehiclesInPeak = active;
      }
      if (active > peakVehiclesInPeak) {
        peakVehiclesInPeak = active;
      }
      if (clock.day === 1 && minuteOfDay === MORNING_PEAK_MINUTE_OF_DAY) {
        const stats = app.economy.hudStats();
        peakSample = {
          minuteOfDay,
          buildings,
          citizens,
          vehicles: active,
          employedCitizens: stats.employedCitizens,
          employmentRate: stats.employmentRate,
        };
      }
    }

    for (const citizen of app.citizens.citizens) {
      const live = app.citizens.liveStateFor(citizen.id);
      const trace = traces.get(citizen.id);
      if (!live || !trace) {
        continue;
      }
      const activity = live.activity;
      if (activity === 'entertainment' && trace.rawLast !== 'entertainment') {
        trace.entStart = minuteOfDay;
        trace.entDay = clock.day;
      } else if (
        activity !== 'entertainment' &&
        trace.rawLast === 'entertainment' &&
        trace.entStart !== null
      ) {
        trace.stays.push({
          day: trace.entDay ?? clock.day,
          startMinuteOfDay: trace.entStart,
          endMinuteOfDay: minuteOfDay,
        });
        trace.entStart = null;
      }
      trace.rawLast = activity;
      if (activity === 'errand') {
        continue;
      }
      if (activity !== trace.lastCanonical) {
        trace.chain.push(activity);
        trace.lastCanonical = activity;
      }
    }

    if (clock.totalMinutes === MIDDAY_MINUTES) {
      app.hud.refresh(true);
      middayHud = readHud(app);
      const stats = app.economy.hudStats();
      middayEmployment = stats.employedCitizens;
      middayEmploymentRate = stats.employmentRate;
      noonSample = app.lighting.update();
    }
    if (clock.totalMinutes === NIGHT_MINUTES) {
      nightSample = app.lighting.update();
    }
  }

  // Close whatever entertainment stay was still open when the soak ended.
  for (const trace of traces.values()) {
    if (trace.entStart !== null) {
      trace.stays.push({
        day: trace.entDay ?? 0,
        startMinuteOfDay: trace.entStart,
        endMinuteOfDay: totalMinutes % MINUTES_PER_DAY,
      });
      trace.entStart = null;
    }
  }

  let totalStays = 0;
  let calendarEveningStays = 0;
  for (const trace of traces.values()) {
    for (const stay of trace.stays) {
      totalStays += 1;
      if (stay.startMinuteOfDay >= 16 * MINUTES_PER_HOUR) {
        calendarEveningStays += 1;
      }
    }
  }

  const settlementMinutes = app.economy.settlements.map((record) => record.totalMinutes);
  return {
    totalMinutes: app.clock.totalMinutes,
    buildings: app.world.buildings.length,
    citizens: app.citizens.citizens.length,
    minBuildings,
    minCitizens,
    minVehicles,
    maxVehicles,
    minVehiclesInPeak,
    peakVehiclesInPeak,
    peakVehicleActive: app.vehicles.peakActiveCount,
    peakSample,
    traces,
    eveningWindows,
    totalStays,
    calendarEveningStays,
    settlementCount: app.economy.settlementCount,
    settlementMinutes,
    companyHoursSettled: app.companies.hoursSettledCount,
    loadHud,
    middayHud,
    finalHud: readHud(app),
    middayEmployment,
    middayEmploymentRate,
    loadRenderCount,
    finalRenderCount: app.hud.renderCount,
    startSample,
    noonSample,
    nightSample,
  };
}

/* ------------------------------------------------------------- auto-start -- */

describe('live acceptance: the app starts itself on load', () => {
  beforeEach(() => {
    vi.resetModules();
    installRecordingContexts();
    buildShell();
  });

  afterEach(() => {
    restoreRecordingContexts();
  });

  it('boots and runs the whole city from a page load, with no start control', async () => {
    // Importing the entry module is exactly what index.html does on page load.
    const module = await import('../../src/main');
    const app = module.getActiveCityApp();
    expect(app).not.toBeNull();
    if (!app) {
      return;
    }
    track(app);

    expect(app.autoStart).toBe(true);
    expect(app.isRunning).toBe(true);
    expect(app.engine.state).toBe('running');
    expect(app.engine.isPaused).toBe(false);
    expect(document.querySelector('#start, #start-button, [data-action="start"]')).toBeNull();
    const launchButton = Array.from(document.querySelectorAll('button, [role="button"]')).find(
      (element) => /\b(start|launch|begin|resume|play)\b/i.test(element.textContent ?? ''),
    );
    expect(launchButton).toBeUndefined();

    // No test code drives the loop: the animation frame advances sim time.
    const advanced = await waitFor(() => app.engine.tickCount > 0 && app.frames > 0, 4_000);
    expect(advanced).toBe(true);
    expect(app.clock.totalMinutes).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------------- the soak -- */

describe('live acceptance: two-day composition soak', () => {
  let app: LiveCityApp;
  let soak: SoakResult;

  beforeAll(async () => {
    vi.resetModules();
    installRecordingContexts();
    buildShell();
    app = await bootApp();
    soak = runSoak(app);
  });

  afterAll(() => {
    restoreRecordingContexts();
  });

  it('holds the simultaneous scale bars through a commuter peak', () => {
    // Final and worst-case readings: the floor never dips below the bars.
    expect(soak.buildings).toBeGreaterThanOrEqual(REQUIRED_BUILDINGS);
    expect(soak.minBuildings).toBeGreaterThanOrEqual(REQUIRED_BUILDINGS);
    expect(soak.citizens).toBeGreaterThanOrEqual(REQUIRED_CITIZENS);
    expect(soak.minCitizens).toBeGreaterThanOrEqual(REQUIRED_CITIZENS);
    expect(soak.minVehicles).toBeGreaterThanOrEqual(REQUIRED_VEHICLES);
    expect(soak.peakVehicleActive).toBeGreaterThanOrEqual(REQUIRED_VEHICLES);
    // ...and never below the traffic floor while a commuter peak is running.
    expect(soak.minVehiclesInPeak).toBeGreaterThanOrEqual(REQUIRED_VEHICLES);
    expect(soak.peakVehiclesInPeak).toBeGreaterThanOrEqual(REQUIRED_VEHICLES);

    // The three numbers hold *at the same instant*, on the morning peak of day 2.
    const peak = soak.peakSample;
    expect(peak).not.toBeNull();
    expect(peak?.buildings ?? 0).toBeGreaterThanOrEqual(REQUIRED_BUILDINGS);
    expect(peak?.citizens ?? 0).toBeGreaterThanOrEqual(REQUIRED_CITIZENS);
    expect(peak?.vehicles ?? 0).toBeGreaterThanOrEqual(REQUIRED_VEHICLES);
    expect(peak?.employedCitizens ?? 0).toBeGreaterThan(0);
    expect(peak?.employmentRate ?? 0).toBeGreaterThan(0);

    // The live world stats agree with the world the app is running.
    expect(app.worldStats.buildingCount).toBe(soak.buildings);
    expect(app.vehicles.stats().activeVehicles).toBeGreaterThanOrEqual(REQUIRED_VEHICLES);
    expect(app.vehicles.stats().peakActiveVehicles).toBe(soak.peakVehicleActive);
  });

  it('renders a live city frame with the composed renderer', () => {
    const frame = app.pump(0);
    expect(frame.stats).not.toBeNull();
    expect(frame.stats?.buildings ?? 0).toBeGreaterThan(0);
    expect(frame.stats?.entitiesDrawn ?? 0).toBeGreaterThan(0);
  });

  it('walks every citizen through home -> work -> entertainment -> home each day', () => {
    expect(soak.traces.size).toBeGreaterThanOrEqual(REQUIRED_CITIZENS);
    for (const [citizenId, trace] of soak.traces) {
      const chain = trace.chain;
      const homeRuns = chain.filter((activity) => activity === 'home').length;
      const workRuns = chain.filter((activity) => activity === 'work').length;
      const outingRuns = chain.filter((activity) => activity === 'entertainment').length;

      // A ring is 1440 sim-minutes, so the 2880-minute soak covers exactly two
      // rings per citizen: at least one home stay, one work stay and one evening
      // outing per simulated day shows up as at least two observed runs each.
      expect(homeRuns, `home runs for ${citizenId}`).toBeGreaterThanOrEqual(SOAK_DAYS);
      expect(workRuns, `work runs for ${citizenId}`).toBeGreaterThanOrEqual(SOAK_DAYS);
      expect(outingRuns, `outing runs for ${citizenId}`).toBeGreaterThanOrEqual(SOAK_DAYS);

      // ...and the runs are in the required cyclic order: every work stay is
      // reached from home and followed by the evening outing; every outing is
      // reached from work and followed by home.
      for (let index = 0; index < chain.length; index += 1) {
        const activity = chain[index];
        if (activity === 'work') {
          if (index > 0) {
            expect(chain[index - 1], `home before work for ${citizenId}`).toBe('home');
          }
          if (index < chain.length - 1) {
            expect(chain[index + 1], `outing after work for ${citizenId}`).toBe('entertainment');
          }
        }
        if (activity === 'entertainment') {
          if (index > 0) {
            expect(chain[index - 1], `work before outing for ${citizenId}`).toBe('work');
          }
          if (index < chain.length - 1) {
            expect(chain[index + 1], `home after outing for ${citizenId}`).toBe('home');
          }
        }
      }

      // The outing happens in the citizen's own scheduled evening window: the
      // post-shift entertainment slot every generated routine carries.
      const window = soak.eveningWindows.get(citizenId);
      expect(window, `evening window for ${citizenId}`).toBeDefined();
      expect(trace.stays.length, `entertainment stays for ${citizenId}`).toBeGreaterThanOrEqual(
        SOAK_DAYS,
      );
      for (const stay of trace.stays) {
        expect(
          window ? withinWindow(stay.startMinuteOfDay, window) : false,
          `stay at ${stay.startMinuteOfDay} for ${citizenId}`,
        ).toBe(true);
      }
    }

    // Most outings also land in the calendar evening (>= 16:00); citizens on
    // night and early shifts take theirs right after their own shift ends.
    expect(soak.totalStays).toBeGreaterThanOrEqual(REQUIRED_CITIZENS * SOAK_DAYS);
    expect(soak.calendarEveningStays * 2).toBeGreaterThanOrEqual(soak.totalStays);
  });

  it('settles exactly one economy hour per sim-hour over the two days', () => {
    expect(soak.totalMinutes).toBe(SOAK_MINUTES);
    expect(soak.settlementCount).toBe(REQUIRED_SETTLEMENTS);
    expect(soak.settlementMinutes).toHaveLength(REQUIRED_SETTLEMENTS);
    expect(new Set(soak.settlementMinutes).size).toBe(REQUIRED_SETTLEMENTS);
    for (let index = 0; index < soak.settlementMinutes.length; index += 1) {
      // One settlement per hour, aligned to the hour boundary, in order.
      expect(soak.settlementMinutes[index]).toBe((index + 1) * MINUTES_PER_HOUR);
    }
    expect(soak.companyHoursSettled).toBe(REQUIRED_SETTLEMENTS);
  });

  it('advances the city clock and keeps the HUD readouts live', () => {
    // On load the overlay already shows all four required readouts.
    expect(soak.loadHud.population).toBe(formatInteger(soak.citizens));
    expect(Number(soak.loadHud.population.replace(/,/g, ''))).toBeGreaterThanOrEqual(
      REQUIRED_CITIZENS,
    );
    expect(soak.loadHud.employment).toMatch(/^\d+%$/);
    expect(soak.loadHud.time).toMatch(/^\d{2}:\d{2}$/);
    expect(soak.loadHud.budget).toBe(formatMoney(DEFAULT_INITIAL_BUDGET));
    expect(soak.loadHud.phase.length).toBeGreaterThan(0);
    expect(app.hud.root.isConnected).toBe(true);

    // Sim time advances continuously and the readouts follow it.
    expect(soak.middayHud).not.toBeNull();
    const midday = soak.middayHud;
    expect(soak.loadHud.time).toBe('00:00');
    expect(soak.loadHud.day).toBe('Day 1');
    expect(midday?.time).toBe('12:00');
    expect(midday?.time).not.toBe(soak.loadHud.time);
    expect(midday?.budget).not.toBe(soak.loadHud.budget);
    // Two days later the wall clock has wrapped back to midnight, but the day
    // readout — and the hourly budget — have moved on.
    expect(soak.finalHud.time).toBe('00:00');
    expect(soak.finalHud.day).toBe('Day 3');
    expect(soak.finalHud.day).not.toBe(soak.loadHud.day);
    expect(soak.finalHud.budget).not.toBe(soak.loadHud.budget);

    // Employment is staffed once the day starts and the rate matches the join.
    expect(soak.middayEmployment).toBeGreaterThan(0);
    expect(soak.middayEmploymentRate).toBeGreaterThan(0);
    expect(midday?.employment).toBe(formatPercent(soak.middayEmploymentRate));
    expect(midday?.employment).not.toBe(soak.loadHud.employment);

    // The overlay really repainted while the city ran.
    expect(soak.finalRenderCount).toBeGreaterThan(soak.loadRenderCount);
  });

  it('shows a materially different day and night look', () => {
    const noon = soak.noonSample;
    const night = soak.nightSample;
    expect(soak.startSample.phase).toBe('night');
    expect(noon).not.toBeNull();
    expect(night).not.toBeNull();
    if (!noon || !night) {
      return;
    }
    expect(noon.phase).toBe('noon');
    expect(night.phase).toBe('night');
    // Higher sun, darker sky, lit windows and lamps after dark: the change the
    // renderer composites into every frame is the change the clock drives.
    expect(noon.sunElevation).toBeGreaterThan(night.sunElevation);
    expect(night.windowGlow).toBeGreaterThan(noon.windowGlow);
    expect(night.streetlightIntensity).toBeGreaterThan(noon.streetlightIntensity);
    expect(skyLuminance(noon)).toBeGreaterThan(skyLuminance(night) * 2);
    expect(noon.ambient.color).not.toEqual(night.ambient.color);
    // ...and the frame the renderer draws agrees with the palette.
    const frame = app.pump(0);
    expect(frame.stats?.phase).toBe('night');
    const glow = frame.stats?.windowGlow ?? 0;
    const sun = frame.stats?.sunElevation ?? 1;
    expect(glow).toBeGreaterThan(sun);
  });

  it('tracks the viewport with the minimap rectangle through pan and zoom', () => {
    const minimap = app.minimap;
    expect(minimap).not.toBeNull();
    if (!minimap || !app.camera) {
      return;
    }
    expect(minimap.camera).toBe(app.camera);

    const before = minimap.viewportRect();
    expect(before).toEqual(worldRectToMinimapRect(app.camera.viewport, minimap.view));

    // Pan the main view: the rectangle moves with the camera, exactly.
    app.camera.panByWorld(40, 25);
    app.camera.update();
    const panned = minimap.viewportRect();
    expect(panned).toEqual(worldRectToMinimapRect(app.camera.viewport, minimap.view));
    expect(panned.x).toBeGreaterThan(before.x);
    expect(panned.y).toBeGreaterThan(before.y);

    // Zoom in: the rectangle shrinks about the same centre, exactly.
    app.camera.zoomTo(2);
    app.camera.update();
    const zoomed = minimap.viewportRect();
    expect(zoomed).toEqual(worldRectToMinimapRect(app.camera.viewport, minimap.view));
    expect(zoomed.width).toBeCloseTo(panned.width / 2, 6);
    expect(zoomed.height).toBeCloseTo(panned.height / 2, 6);
    expect(zoomed.x).toBeGreaterThan(panned.x);
    expect(zoomed.y).toBeGreaterThan(panned.y);

    // The minimap really paints that rectangle, not just computes it.
    const context = contexts.get(minimap.canvas);
    expect(context).toBeDefined();
    if (!context) {
      return;
    }
    context.reset();
    const drawsBefore = minimap.drawCount;
    minimap.draw();
    expect(minimap.drawCount).toBe(drawsBefore + 1);
    const strokes = context.calls.filter((call) => call.method === 'strokeRect');
    expect(strokes.length).toBeGreaterThan(0);
    const painted = strokes[strokes.length - 1].args;
    const expected = minimap.viewportRect();
    expect(painted[0]).toBeCloseTo(expected.x, 6);
    expect(painted[1]).toBeCloseTo(expected.y, 6);
    expect(painted[2]).toBeCloseTo(expected.width, 6);
    expect(painted[3]).toBeCloseTo(expected.height, 6);
    expect(expected.x).toBeGreaterThanOrEqual(0);
    expect(expected.x + expected.width).toBeLessThanOrEqual(minimap.width + 1e-9);
  });
});
