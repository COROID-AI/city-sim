// @vitest-environment jsdom
/**
 * Composition suite: the live app, booted and driven end to end.
 *
 * This is the integration owner's proof that the composition root really wires
 * the whole product together. Every surface is the real one — the seeded
 * `CityWorld`, `SimClock`, `SimulationEngine`, `CitizensSystem`,
 * `CompaniesSystem`, `VehiclesSystem`, `EconomySystem`, `DayNightLighting`,
 * `ViewportCamera`, `CityRenderer`, `HudOverlay`, `Minimap`, `EntityPicker` and
 * `EntityInspector` — bound to a recording canvas through the same page shell the
 * browser gets (`#app`, `#city-canvas`, `#minimap`).
 *
 * Four things are asserted here and nowhere else:
 *
 * 1. **Boot and drive** — importing the module boots the app, starts it with no
 *    user gesture and advances sim time by itself; a headless drive then runs
 *    more than one simulated day with every subsystem reporting progress.
 * 2. **One source of truth** — the HUD's clock, the minimap's viewport rectangle
 *    and the inspector's "snapshot" all read the same engine clock and the same
 *    camera.
 * 3. **Input wiring** — real DOM events pan, zoom (clamped), select an entity,
 *    clear on a ground click, jump the camera from the minimap, and drive pause
 *    plus the `1`/`2`/`3` speed keys.
 * 4. **Lifecycle** — `dispose()` removes the rAF loop and every listener, and a
 *    re-boot leaves exactly one of every surface and no duplicated sim time.
 *
 * jsdom has no canvas backend, so `getContext('2d')` is served by the shared
 * recording context double; the composition itself is untouched by that.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRecordingContext } from './helpers/fake-canvas';
import type { RecordingContext2D } from './helpers/fake-canvas';
import { SIM_DAY_MINUTES } from './helpers/sim-fixtures';
import { MINUTES_PER_HOUR } from '../src/sim/clock';
import type { Citizen, Vec2 } from '../src/sim/types';
import { scheduleSlotStates, scheduleSlotWindowLabel } from '../src/ui/inspector';
import { minimapPointToWorld, worldRectToMinimapRect } from '../src/ui/minimap';
import type { CityAppOptions, LiveCityApp } from '../src/main';

/* --------------------------------------------------------------- harness -- */

/** Host viewport the shell reports; the whole city is 5120x3840 logical pixels. */
const VIEWPORT = { width: 1280, height: 800 };
/** Real-time slice per pumped frame; the engine's own cap is 250 ms. */
const PUMP_MS = 250;
/** Fixed steps the engine executes per pump at speed 60 (`maxStepsPerUpdate`). */
const TICKS_PER_PUMP = 240;
/** Pumps that cover more than one simulated day at {@link PUMP_MS} and speed 60. */
const DAY_PUMPS = Math.ceil(SIM_DAY_MINUTES / TICKS_PER_PUMP) + 1;

const contexts = new Map<HTMLCanvasElement, RecordingContext2D>();
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext =
  HTMLCanvasElement.prototype.getContext;

/** Every app this suite created, disposed in {@link afterEach}. */
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
  // canvas backing store and pointer mapping then all agree deterministically.
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
 * A monotonic millisecond clock for the UI cadences. It only ever moves
 * forward, so the HUD/minimap/inspector throttles are due on every tick and
 * their DOM therefore reflects the frame that was just drawn.
 */
function uiClock(): () => number {
  let cursor = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return () => {
    cursor += 1_000;
    return cursor;
  };
}

/** Boots the app through the module's own boot path, replacing any previous app. */
async function boot(options: Partial<CityAppOptions> = {}): Promise<LiveCityApp> {
  const module = await import('../src/main');
  const auto = module.getActiveCityApp();
  if (auto) {
    track(auto);
  }
  return track(
    module.bootCityApp({
      document,
      speed: 60,
      autoStart: false,
      now: uiClock(),
      ...options,
    }),
  );
}

function dispatchPointer(
  target: EventTarget,
  type: string,
  point: { clientX?: number; clientY?: number; button?: number },
): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...point }));
}

function dispatchWheel(target: EventTarget, deltaY: number): void {
  target.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
}

function dispatchKey(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Live positions of every citizen, keyed by id. */
function citizenPositions(app: LiveCityApp): Map<string, Vec2> {
  const positions = new Map<string, Vec2>();
  for (const citizen of app.citizens.citizens) {
    const live = app.citizens.liveStateFor(citizen.id);
    positions.set(citizen.id, { ...(live ? live.position : citizen.position) });
  }
  return positions;
}

/** Positions of the vehicles on the road right now, keyed by id. */
function vehiclePositions(app: LiveCityApp): Map<string, Vec2> {
  const positions = new Map<string, Vec2>();
  for (const vehicle of app.vehicles.activeVehicles()) {
    positions.set(vehicle.id, { ...vehicle.position });
  }
  return positions;
}

/** Ids whose position changed by more than a hair between two readings. */
function movedCount(before: Map<string, Vec2>, after: Map<string, Vec2>): number {
  let moved = 0;
  for (const [id, position] of before) {
    const next = after.get(id);
    if (!next || Math.hypot(next.x - position.x, next.y - position.y) > 0.01) {
      moved += 1;
    }
  }
  return moved;
}

/** The schedule slot a citizen is in at `minuteOfDay`, or `null`. */
function currentSlot(citizen: Citizen, minuteOfDay: number) {
  const index = scheduleSlotStates(citizen.schedule, minuteOfDay).indexOf('current');
  return index >= 0 ? citizen.schedule[index] : null;
}

function minuteOfDayOf(app: LiveCityApp): number {
  return app.clock.hourOfDay * MINUTES_PER_HOUR + app.clock.minuteOfHour;
}

function assertBooted(app: LiveCityApp): void {
  expect(app).toBeInstanceOf(Object);
  expect(app.isDisposed).toBe(false);
  expect(app.input.isAttached).toBe(true);
}

/* --------------------------------------------------------------- fixtures -- */

beforeEach(() => {
  // A fresh module registry, a fresh shell and a fresh set of recording
  // contexts: each test really does "load the page" again.
  vi.resetModules();
  created.length = 0;
  installRecordingContexts();
  buildShell();
});

afterEach(async () => {
  for (const app of [...created].reverse()) {
    app.dispose();
  }
  created.length = 0;
  // Also stop whatever the module's own auto boot created this test.
  const module = await import('../src/main');
  module.stopCitySimulation();
  document.body.innerHTML = '';
  delete window.__citySim;
  contexts.clear();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

/* ------------------------------------------------------------ composition -- */

describe('live app composition', () => {
  it('boots the whole city on module load and starts it without a start button', async () => {
    // Importing the entry module is exactly what the browser does on page load.
    const module = await import('../src/main');
    const app = module.getActiveCityApp();
    expect(app).not.toBeNull();
    if (!app) {
      return;
    }
    track(app);
    assertBooted(app);

    // The shell is the app's: one canvas, the minimap slot, no start button.
    expect(app.canvas).toBe(document.getElementById('city-canvas'));
    expect(document.querySelectorAll('#city-canvas')).toHaveLength(1);
    expect(document.querySelector('#start, #start-button, [data-action="start"]')).toBeNull();
    const launchButton = Array.from(document.querySelectorAll('button, [role="button"]')).find(
      (element) => /\b(start|launch|begin|resume|play)\b/i.test(element.textContent ?? ''),
    );
    expect(launchButton).toBeUndefined();
    // The only control the shell owns is the inspector's own close button.
    for (const button of Array.from(document.querySelectorAll('button'))) {
      expect(button.dataset.action).toBe('clear');
    }
    expect(window.__citySim).toBe(app);

    // Every subsystem is instantiated, attached and driven by one engine.
    expect(app.systemNames).toEqual(['world', 'citizens', 'companies', 'vehicles', 'economy', 'hud']);
    expect(app.engine.systems).toHaveLength(6);
    expect(app.citizens.citizens.length).toBeGreaterThanOrEqual(50);
    expect(app.world.buildings.length).toBeGreaterThanOrEqual(24);
    expect(app.minimap).not.toBeNull();
    expect(app.minimap?.isAttached).toBe(true);
    expect(document.querySelector('#minimap > canvas')).not.toBeNull();
    expect(app.inspector.element).not.toBeNull();
    expect(app.inspector.element?.isConnected).toBe(true);
    expect(app.hud.root.isConnected).toBe(true);
    expect(app.renderer.attached).toBe(true);
    expect(app.picker.world).toBe(app.world);

    // The clock starts where the boot documented it and the engine is running.
    expect(app.engine.state).toBe('running');
    expect(app.engine.isPaused).toBe(false);
    expect(app.clock.hourOfDay).toBe(6);
    const startMinutes = app.clock.totalMinutes;

    // No test code drives the loop: rAF must advance sim time and draw frames.
    const advancing = await waitFor(
      () => app.clock.totalMinutes > startMinutes && app.frames > 0,
      4_000,
    );
    expect(advancing).toBe(true);
    expect(app.engine.tickCount).toBeGreaterThan(0);
    expect(app.renderer.lastFrame?.entitiesDrawn ?? 0).toBeGreaterThan(0);
    expect(app.renderer.lastFrame?.buildings ?? 0).toBeGreaterThan(0);
    expect(contexts.get(app.canvas)?.countOf('fillRect') ?? 0).toBeGreaterThan(0);

    // The opening frame is the built-up core, not empty space: the middle of the
    // screen holds an entity, and a plain click there selects it — the same
    // gesture the browser lane performs.
    const middle = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const middlePick = app.picker.pickScreen(middle);
    expect(middlePick.kind).not.toBe('ground');
    expect(middlePick.id).not.toBeNull();
    const upType = app.input.downEventType === 'pointerdown' ? 'pointerup' : 'mouseup';
    dispatchPointer(app.canvas, app.input.downEventType, {
      clientX: middle.x,
      clientY: middle.y,
      button: 0,
    });
    dispatchPointer(document, upType, { clientX: middle.x, clientY: middle.y });
    expect(app.inspector.isOpen).toBe(true);
    expect(app.inspector.selectedId).toBe(middlePick.id);
  });

  it('drives every surface for more than one simulated day', async () => {
    const app = await boot({ speed: 60 });
    assertBooted(app);
    const startMinutes = app.clock.totalMinutes;

    // Warm up one frame so the traffic and the schedules are live, then read
    // every moving surface twice: morning against late evening.
    app.pump(PUMP_MS);
    const morningCitizens = citizenPositions(app);
    const morningVehicles = vehiclePositions(app);
    const hudRendersBefore = app.hud.renderCount;
    const minimapDrawsBefore = app.minimap?.drawCount ?? 0;

    for (let index = 0; index < 4; index += 1) {
      app.pump(PUMP_MS);
    }
    const eveningCitizens = citizenPositions(app);
    const eveningVehicles = vehiclePositions(app);

    for (let index = 0; index < DAY_PUMPS - 5; index += 1) {
      app.pump(PUMP_MS);
    }

    // One fixed step per sim-minute, in the engine, the world and the roster.
    const advanced = app.clock.totalMinutes - startMinutes;
    expect(advanced).toBeGreaterThanOrEqual(SIM_DAY_MINUTES);
    expect(app.engine.tickCount).toBe(advanced);
    expect(app.world.elapsedMinutes).toBe(advanced);
    expect(app.citizens.updateCount).toBe(app.engine.tickCount);
    expect(app.worldStats.buildingCount).toBe(app.world.buildings.length);

    // Render: exactly one frame per pump, whatever the speed multiplier is.
    expect(app.frames).toBe(DAY_PUMPS);
    expect(app.renderer.frameCount).toBe(DAY_PUMPS);
    expect(app.renderer.lastFrame?.entitiesDrawn ?? 0).toBeGreaterThan(0);

    // Day/night lighting follows the clock it samples.
    const sampleHour = app.lighting.sample.hour;
    expect(sampleHour).toBeCloseTo(app.clock.hourOfDay + app.clock.minuteOfHour / 60, 5);

    // Overlays: the HUD repaints on the tick, the minimap on its cadence.
    expect(app.hud.renderCount).toBeGreaterThan(hudRendersBefore + 24);
    expect(app.hud.snapshot?.population).toBeGreaterThanOrEqual(50);
    expect(app.hud.snapshot?.employmentRate ?? 0).toBeGreaterThan(0);
    expect(app.hud.snapshot?.vehicleCount ?? 0).toBeGreaterThanOrEqual(10);
    expect(app.minimap?.drawCount ?? 0).toBeGreaterThan(minimapDrawsBefore);
    const minimapContext = app.minimap ? contexts.get(app.minimap.canvas) : undefined;
    expect(minimapContext?.countOf('fillRect') ?? 0).toBeGreaterThan(0);

    // Hourly systems settled every hour of the day, aligned to the hour.
    expect(app.economy.settlementCount).toBeGreaterThanOrEqual(24);
    expect(app.companies.hoursSettledCount).toBeGreaterThanOrEqual(24);
    expect(app.economy.lastSettlement?.minute).toBe(0);
    expect(app.companies.totals().employeeCount).toBeGreaterThan(0);

    // Agents really moved: citizens between morning and evening, vehicles too.
    expect(movedCount(morningCitizens, eveningCitizens)).toBeGreaterThanOrEqual(10);
    expect(movedCount(morningVehicles, eveningVehicles)).toBeGreaterThanOrEqual(5);
    expect(app.vehicles.activeCount).toBeGreaterThanOrEqual(10);
    expect(app.vehicles.peakActiveCount).toBeGreaterThanOrEqual(10);
  });

  it('keeps the HUD, the minimap rectangle and the inspector on the same state', async () => {
    const app = await boot({ speed: 60 });
    for (let index = 0; index < 3; index += 1) {
      app.pump(PUMP_MS);
    }

    // HUD city time is the engine clock, painted from the same snapshot.
    const timeReadout = app.hud.root.querySelector('[data-readout="time"]');
    expect(timeReadout?.textContent).toBe(app.clock.formatTime());
    const snapshot = app.hud.snapshot;
    expect(snapshot).not.toBeNull();
    expect((snapshot?.hour ?? -1) * 60 + (snapshot?.minute ?? -1)).toBe(minuteOfDayOf(app));
    expect(snapshot?.cityTimeLabel.startsWith(`Day ${app.clock.day + 1}, `)).toBe(true);

    // The minimap rectangle is the camera's visible bounds, re-derived live.
    const minimap = app.minimap;
    expect(minimap).not.toBeNull();
    if (!minimap) {
      return;
    }
    expect(minimap.camera).toBe(app.camera);
    expect(minimap.viewportRect()).toEqual(worldRectToMinimapRect(app.camera.viewport, minimap.view));

    app.camera.centerOn(24, 96);
    app.pump(PUMP_MS);
    expect(minimap.viewportRect()).toEqual(worldRectToMinimapRect(app.camera.viewport, minimap.view));
    expect(minimap.viewportRect().x).toBeCloseTo(
      (app.camera.viewport.x / app.world.widthInTiles) * minimap.width,
      9,
    );

    // The inspector's record is the citizen's record *at the current sim time*:
    // the "Current stop" field is derived from the engine clock.
    const citizen = app.citizens.citizens[0];
    expect(app.inspector.select('citizen', citizen.id)).toBe(true);
    app.pump(PUMP_MS);
    expect(app.inspector.element?.dataset.kind).toBe('citizen');
    expect(app.inspector.element?.dataset.entityId).toBe(citizen.id);
    expect(app.inspector.element?.hidden).toBe(false);

    const currentStop = (): string =>
      app.inspector.element?.querySelector('[data-field="citizen.schedule.current"]')?.textContent ??
      '';
    const slotNow = currentSlot(citizen, minuteOfDayOf(app));
    expect(slotNow).not.toBeNull();
    const slotNowLabel = slotNow ? scheduleSlotWindowLabel(slotNow) : '';
    expect(currentStop()).toContain(slotNowLabel);

    // Move the clock on: the same panel now reports the slot of the new time.
    for (let index = 0; index < 3; index += 1) {
      app.pump(PUMP_MS);
    }
    const laterSlot = currentSlot(citizen, minuteOfDayOf(app));
    if (laterSlot && scheduleSlotWindowLabel(laterSlot) !== slotNowLabel) {
      expect(currentStop()).toContain(scheduleSlotWindowLabel(laterSlot));
    }
    expect(app.inspector.refreshCount).toBeGreaterThan(0);
  });

  it('pans, zooms, selects, jumps from the minimap and honours pause/speed keys', async () => {
    const app = await boot({ speed: 1 });
    const { canvas, input } = app;
    const moveType = input.downEventType === 'pointerdown' ? 'pointermove' : 'mousemove';
    const upType = input.downEventType === 'pointerdown' ? 'pointerup' : 'mouseup';

    /* Pan: a drag on the canvas moves the camera by the opposite delta. */
    const centreBefore = app.camera.center;
    const scale = app.camera.scale;
    dispatchPointer(canvas, input.downEventType, { clientX: 400, clientY: 300, button: 0 });
    expect(input.isDragging).toBe(true);
    dispatchPointer(document, moveType, { clientX: 460, clientY: 340 });
    dispatchPointer(document, upType, { clientX: 460, clientY: 340 });
    expect(input.isDragging).toBe(false);
    expect(input.panCount).toBe(1);
    expect(app.camera.center.x).toBeCloseTo(centreBefore.x - 60 / scale, 9);
    expect(app.camera.center.y).toBeCloseTo(centreBefore.y - 40 / scale, 9);
    // A drag is not a click: the selection is untouched.
    expect(app.inspector.selection).toBeNull();

    /* Zoom: the wheel zooms around the pointer and clamps at the camera's floor. */
    const zoomBefore = app.camera.zoom;
    dispatchWheel(canvas, -240);
    expect(input.zoomCount).toBe(1);
    expect(app.camera.zoom).toBeGreaterThan(zoomBefore);
    expect(app.camera.zoom).toBeLessThanOrEqual(app.camera.maxAllowedZoom);
    for (let index = 0; index < 40; index += 1) {
      dispatchWheel(canvas, 400);
    }
    expect(app.camera.zoom).toBeCloseTo(app.camera.minAllowedZoom, 9);
    app.camera.zoomTo(1);

    /* Click: an entity under the pointer is selected in the inspector. */
    const citizen = app.citizens.citizens[0];
    const live = app.citizens.liveStateFor(citizen.id);
    const target: Vec2 = live ? live.position : citizen.position;
    app.camera.centerOn(target.x, target.y);
    const screen = app.camera.worldToScreen(target);
    const expected = app.picker.pickScreen(screen);
    expect(expected.kind).not.toBe('ground');
    dispatchPointer(canvas, input.downEventType, {
      clientX: screen.x,
      clientY: screen.y,
      button: 0,
    });
    dispatchPointer(document, upType, { clientX: screen.x, clientY: screen.y });
    expect(input.lastPick?.id).toBe(expected.id);
    expect(input.selectionCount).toBe(1);
    expect(app.inspector.selectedKind).toBe(expected.kind);
    expect(app.inspector.selectedId).toBe(expected.id);
    expect(app.inspector.isOpen).toBe(true);
    expect(app.inspector.element?.hidden).toBe(false);

    /* A click on empty ground clears the panel again. */
    let ground: Vec2 | null = null;
    for (const candidate of [
      { x: 4, y: 4 },
      { x: VIEWPORT.width - 4, y: 4 },
      { x: 4, y: VIEWPORT.height - 4 },
      { x: VIEWPORT.width - 4, y: VIEWPORT.height - 4 },
      { x: VIEWPORT.width / 2, y: VIEWPORT.height - 6 },
    ]) {
      if (app.picker.pickScreen(candidate).kind === 'ground') {
        ground = candidate;
        break;
      }
    }
    expect(ground).not.toBeNull();
    if (ground) {
      dispatchPointer(canvas, input.downEventType, { clientX: ground.x, clientY: ground.y });
      dispatchPointer(document, upType, { clientX: ground.x, clientY: ground.y });
      expect(app.inspector.selection).toBeNull();
      expect(input.groundClickCount).toBe(1);
    }

    /* Minimap: a click (and a drag) jumps the main camera. */
    const minimap = app.minimap;
    expect(minimap).not.toBeNull();
    if (minimap) {
      app.camera.zoomTo(2);
      const clickPoint = { x: minimap.width / 2, y: minimap.height / 2 };
      const expectedCentre = minimapPointToWorld(clickPoint, minimap.view);
      dispatchPointer(minimap.canvas, input.downEventType, {
        clientX: clickPoint.x,
        clientY: clickPoint.y,
      });
      dispatchPointer(document, upType, { clientX: clickPoint.x, clientY: clickPoint.y });
      expect(app.camera.center.x).toBeCloseTo(expectedCentre.x, 6);
      expect(app.camera.center.y).toBeCloseTo(expectedCentre.y, 6);
      expect(minimap.viewportRect()).toEqual(
        worldRectToMinimapRect(app.camera.viewport, minimap.view),
      );

      const dragPoint = { x: minimap.width * 0.75, y: minimap.height * 0.75 };
      const dragWorld = minimapPointToWorld(dragPoint, minimap.view);
      dispatchPointer(minimap.canvas, input.downEventType, {
        clientX: clickPoint.x,
        clientY: clickPoint.y,
      });
      dispatchPointer(document, moveType, { clientX: dragPoint.x, clientY: dragPoint.y });
      dispatchPointer(document, upType, { clientX: dragPoint.x, clientY: dragPoint.y });
      expect(app.camera.center.x).toBeCloseTo(dragWorld.x, 6);
      expect(minimap.isDragging).toBe(false);
    }

    /* Pause: space freezes sim time while the frame loop keeps rendering. */
    const framesBeforePause = app.frames;
    dispatchKey(' ');
    expect(app.engine.isPaused).toBe(true);
    expect(input.pauseToggleCount).toBe(1);
    const pausedMinutes = app.clock.totalMinutes;
    const pausedFrame = app.pump(PUMP_MS);
    expect(pausedFrame.ticks).toBe(0);
    expect(app.clock.totalMinutes).toBe(pausedMinutes);
    expect(app.frames).toBe(framesBeforePause + 1);
    expect(pausedFrame.stats?.entitiesDrawn ?? 0).toBeGreaterThan(0);

    dispatchKey(' ');
    expect(app.engine.isPaused).toBe(false);
    expect(input.pauseToggleCount).toBe(2);

    /* Speed: `1`/`2`/`3` scale sim minutes per real second, not the frame rate. */
    expect(app.pump(PUMP_MS).ticks).toBe(15);
    expect(app.engine.speed).toBe(1);

    dispatchKey('2');
    expect(input.speedChangeCount).toBe(1);
    expect(input.lastSpeed).toBe(2);
    expect(app.engine.speed).toBe(2);
    expect(app.pump(PUMP_MS).ticks).toBe(30);

    dispatchKey('3');
    expect(app.engine.speed).toBe(3);
    expect(app.pump(PUMP_MS).ticks).toBe(45);

    dispatchKey('1');
    expect(app.engine.speed).toBe(1);
    expect(app.pump(PUMP_MS).ticks).toBe(15);
    // ...and never the render rate: still exactly one frame per pump.
    expect(app.frames).toBe(framesBeforePause + 5);

    /* Keyboard pan/zoom round out the same camera authority. */
    const centreBeforeKeys = app.camera.center;
    const zoomBeforeKeys = app.camera.zoom;
    dispatchKey('+');
    expect(app.camera.zoom).toBeGreaterThan(zoomBeforeKeys);
    dispatchKey('ArrowRight');
    expect(app.camera.center.x).toBeGreaterThan(centreBeforeKeys.x);
    expect(input.panCount).toBe(2);
    expect(input.zoomCount).toBe(42);
  });

  it('disposes the loop and every listener, and re-boots without duplicates', async () => {
    const module = await import('../src/main');
    const app = module.getActiveCityApp();
    expect(app).not.toBeNull();
    if (!app) {
      return;
    }
    track(app);

    // The auto-started loop advances on its own first.
    const running = await waitFor(() => app.engine.tickCount > 0 && app.frames > 0, 4_000);
    expect(running).toBe(true);

    const zoomsBefore = app.input.zoomCount;
    const pausesBefore = app.input.pauseToggleCount;
    app.dispose();

    // Every surface and subsystem let go.
    expect(app.isDisposed).toBe(true);
    expect(app.engine.state).toBe('disposed');
    expect(app.engine.systemCount).toBe(0);
    expect(app.camera.isDisposed).toBe(true);
    expect(app.renderer.isDisposed).toBe(true);
    expect(app.picker.isDisposed).toBe(true);
    expect(app.input.isAttached).toBe(false);
    expect(app.inspector.isDisposed).toBe(true);
    expect(app.inspector.element).toBeNull();
    expect(app.hud.root.isConnected).toBe(false);
    expect(app.minimap?.isDisposed).toBe(true);
    expect(app.minimap?.canvas.parentElement).toBeNull();
    expect(document.querySelector('.hud')).toBeNull();
    expect(document.querySelector('.inspector')).toBeNull();
    expect(window.__citySim).toBeUndefined();

    // The rAF loop is gone: nothing advances the clock any more.
    const frozenTicks = app.engine.tickCount;
    await sleep(150);
    expect(app.engine.tickCount).toBe(frozenTicks);

    // ...and so are the listeners: a live handler would touch disposed
    // subsystems (the camera throws once disposed) and be visible in the
    // counters, both of which must stay untouched.
    dispatchWheel(app.canvas, -200);
    dispatchPointer(app.canvas, app.input.downEventType, { clientX: 10, clientY: 10 });
    dispatchKey(' ');
    dispatchKey('2');
    expect(app.input.zoomCount).toBe(zoomsBefore);
    expect(app.input.pauseToggleCount).toBe(pausesBefore);
    expect(app.input.isDragging).toBe(false);

    // Re-boot in the same shell: one of every surface, and no inflated clock.
    const second = track(module.bootCityApp({ document }));
    expect(second).not.toBe(app);
    expect(document.querySelectorAll('#city-canvas')).toHaveLength(1);
    expect(document.querySelectorAll('.hud')).toHaveLength(1);
    expect(document.querySelectorAll('.inspector')).toHaveLength(1);
    expect(document.querySelectorAll('#minimap-canvas')).toHaveLength(1);
    expect(document.getElementById('minimap')?.children).toHaveLength(1);
    expect(second.clock.day).toBe(0);
    expect(second.clock.hourOfDay).toBe(module.DEFAULT_START_HOUR);
    expect(second.clock.totalMinutes).toBe(module.DEFAULT_START_HOUR * MINUTES_PER_HOUR);
    expect(second.engine.tickCount).toBe(0);

    const restarted = await waitFor(() => second.engine.tickCount > 0, 4_000);
    expect(restarted).toBe(true);
    // Paced by the animation frame, not a burst catching up on frozen time.
    expect(second.engine.tickCount).toBeLessThan(200);
    // The first app's clock never moved again, so nothing double-advances.
    expect(app.engine.tickCount).toBe(frozenTicks);
  });
});
