/**
 * Composition suite: the city renderer driven by the real simulation.
 *
 * This is the end-to-end render path the app composition will wire up: the
 * seeded `CityWorld` (terrain, 141 buildings, 142 road segments, nine districts),
 * the fixture `SimulationEngine` with its fixed-step `SimClock`, the live
 * `CitizensSystem` (72 citizens on daily schedules), the live `VehiclesSystem`
 * (>=10 vehicles on the road at all times), `DayNightLighting` reading the same
 * clock, and `ViewportCamera` over the same world - all feeding one
 * `CityRenderer` bound to a recording canvas.
 *
 * The camera viewport (1280x960) has exactly the world's aspect ratio, so the
 * whole 160x120 city fits at the camera's fit zoom and a single recorded frame
 * can be checked against the README's simultaneous-scale requirement: >=20
 * buildings, >=50 citizens and >=10 vehicles visible at once, with the day/night
 * cycle visible in the same frames.
 */

import { describe, expect, it } from 'vitest';

import { createViewportCamera } from '../../src/render/camera';
import { DayNightLighting, LIGHTING_PHASES, sampleLighting } from '../../src/render/daynight';
import type { LightingSample, RgbColor } from '../../src/render/daynight';
import { CityRenderer, FRAME_BUDGET_MS, RENDER_LAYERS } from '../../src/render/renderer';
import type {
  CitizenSource,
  FrameStats,
  LightingSource,
  VehicleSource,
} from '../../src/render/renderer';
import { CitizensSystem } from '../../src/sim/citizens';
import { MINUTES_PER_HOUR } from '../../src/sim/clock';
import { MIN_ACTIVE_VEHICLES, VEHICLES_SYSTEM_NAME, VehiclesSystem } from '../../src/sim/vehicles';
import { createCityWorld } from '../../src/sim/world';
import type { CityWorld } from '../../src/sim/world';
import { createFakeCanvas } from '../helpers/fake-canvas';
import type { FakeCanvasHandle } from '../helpers/fake-canvas';
import { SIM_DAY_MINUTES, createSimFixture } from '../helpers/sim-fixtures';
import type { SimFixture } from '../helpers/sim-fixtures';
import type { Building, TileRect } from '../../src/sim/types';

/** Viewport with the world's own 4:3 aspect, so the whole city fits at zoom 0.25. */
const VIEWPORT = { width: 1280, height: 960 };
/**
 * Zoom that puts the whole shipped 160x120 city on screen: it is both the
 * camera's absolute floor (`MIN_ZOOM`) and the fit zoom of {@link VIEWPORT}.
 */
const CITY_FIT_ZOOM = 0.25;
/** Hours sampled in detail: dawn, morning, noon, dusk and deep night. */
const SAMPLED_HOURS: readonly number[] = [5, 8, 12, 18, 22];
/** Frames the composed day is rendered at (one per half sim-hour). */
const DAY_FRAMES = SIM_DAY_MINUTES / 30;
/** Whole-city frames the benchmark measures, after a warm-up of the same size. */
const BENCHMARK_FRAMES = 30;

interface Composition {
  readonly fixture: SimFixture;
  readonly world: CityWorld;
  readonly citizens: CitizensSystem;
  readonly vehicles: VehiclesSystem;
  readonly lighting: DayNightLighting;
  readonly camera: ReturnType<typeof createViewportCamera>;
  readonly handle: FakeCanvasHandle;
  readonly renderer: CityRenderer;
}

function createComposition(seed = 'renderer-composition'): Composition {
  const fixture = createSimFixture({ seed, startHour: 0, minutesPerTick: 1 });
  const world = createCityWorld({ seed: fixture.rng.seed });
  const citizens = new CitizensSystem({ world, count: 72, seed: fixture.rng.seed });
  const vehicles = new VehiclesSystem({ world, citizens });
  // The integration owner path: the engine attaches citizens, then traffic.
  fixture.engine.attach(citizens);
  fixture.engine.attach(vehicles);

  const lighting = new DayNightLighting(fixture.clock);
  const camera = createViewportCamera(world, VIEWPORT, { zoom: CITY_FIT_ZOOM });
  // The whole-city frames below rely on nothing being culled by default.
  expect(camera.zoom).toBe(CITY_FIT_ZOOM);
  expect(camera.visibleWorldBounds()).toEqual({
    x: 0,
    y: 0,
    width: world.widthInTiles,
    height: world.heightInTiles,
  });
  expect(camera.fitZoom).toBeLessThanOrEqual(CITY_FIT_ZOOM);
  expect(CITY_FIT_ZOOM * world.tileSize * world.widthInTiles).toBe(VIEWPORT.width);
  expect(CITY_FIT_ZOOM * world.tileSize * world.heightInTiles).toBe(VIEWPORT.height);
  const handle = createFakeCanvas({ width: VIEWPORT.width, height: VIEWPORT.height });
  const renderer = new CityRenderer({
    world,
    camera,
    context: handle.context.toContext2D(),
    citizens,
    vehicles,
    lighting,
  });
  renderer.attach();

  return { fixture, world, citizens, vehicles, lighting, camera, handle, renderer };
}

/** Advances the engine forward to `hour` and draws the frame for that sim time. */
function frameAt(composition: Composition, hour: number, cursor: { minute: number }): FrameStats {
  const target = hour * MINUTES_PER_HOUR;
  expect(target, `frameAt(${hour}) must move forward`).toBeGreaterThanOrEqual(cursor.minute);
  composition.fixture.advanceMinutes(Math.round(target - cursor.minute));
  cursor.minute = target;
  return composition.renderer.frame();
}

function halfOpenIntersects(left: TileRect, right: TileRect): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

function visibleBuildings(buildings: readonly Building[], bounds: TileRect): number {
  let total = 0;
  for (const building of buildings) {
    if (halfOpenIntersects(building.footprint, bounds)) {
      total += 1;
    }
  }
  return total;
}

function luminance(colour: RgbColor): number {
  return 0.299 * colour[0] + 0.587 * colour[1] + 0.114 * colour[2];
}

/** Whether a frame's shadow offset follows the sample's direction and factor. */
function shadowMatchesSample(stats: FrameStats, sample: LightingSample): boolean {
  const cross =
    stats.shadowOffset.x * sample.shadowDirection.y -
    stats.shadowOffset.y * sample.shadowDirection.x;
  const alongX = stats.shadowOffset.x * sample.shadowDirection.x;
  const alongY = stats.shadowOffset.y * sample.shadowDirection.y;
  return Math.abs(cross) < 1e-9 && alongX >= 0 && alongY >= 0;
}

describe('renderer composition: city + agents + lighting on the engine clock', () => {
  it('renders one composed day at the README scale', () => {
    const composition = createComposition();
    const { fixture, world, citizens, vehicles, renderer } = composition;
    let minBuildings = Number.POSITIVE_INFINITY;
    let minCitizens = Number.POSITIVE_INFINITY;
    let minVehicles = Number.POSITIVE_INFINITY;
    let maxTravelling = 0;
    let maxWindows = 0;
    let maxStreetlights = 0;
    let nightFrames = 0;
    let litFrames = 0;
    let litWindowFrames = 0;
    let streetlightFrames = 0;
    let darkFrames = 0;
    let frames = 0;
    const phases = new Set<string>();
    const layersSeen = new Set<string>();

    try {
      // One simulated day in half-hour slices: the engine steps first, so every
      // frame is drawn from live systems rather than from a cold start.
      for (let slice = 0; slice < DAY_FRAMES; slice += 1) {
        fixture.advanceMinutes(30);
        const stats = renderer.frame();
        frames += 1;

        minBuildings = Math.min(minBuildings, stats.buildings);
        minCitizens = Math.min(minCitizens, stats.citizens);
        minVehicles = Math.min(minVehicles, stats.vehicles);
        maxTravelling = Math.max(maxTravelling, stats.citizensTravelling);
        maxWindows = Math.max(maxWindows, stats.windowsLit);
        maxStreetlights = Math.max(maxStreetlights, stats.streetlights);
        phases.add(stats.phase);
        for (const layer of stats.layers) {
          layersSeen.add(layer);
        }

        // Every frame is a complete, coherent city frame: the whole world is on
        // screen, so the live systems are the source of what was drawn.
        expect(stats.bounds).toEqual({
          x: 0,
          y: 0,
          width: world.widthInTiles,
          height: world.heightInTiles,
        });
        expect(stats.buildings).toBe(world.buildings.length);
        expect(stats.culled.buildings).toBe(0);
        expect(stats.culled.citizens).toBe(0);
        expect(stats.culled.vehicles).toBe(0);
        expect(stats.citizens).toBeGreaterThanOrEqual(50);
        expect(stats.citizens).toBeLessThanOrEqual(citizens.citizens.length);
        expect(stats.vehicles).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
        expect(stats.vehicles).toBeLessThanOrEqual(vehicles.activeVehicles().length);
        expect(stats.layers[0]).toBe('sky');
        expect(stats.layers[stats.layers.length - 1]).toBe('haze');
        expect(stats.ambientTint).toBe(1);
        expect(stats.entitiesDrawn).toBeGreaterThan(0);

        // The sample the frame drew is exactly the sample of the engine clock.
        const sample = sampleLighting(fixture.clock.time);
        expect(stats.hour).toBeCloseTo(sample.hour, 10);
        expect(stats.windowGlow).toBeCloseTo(sample.windowGlow, 10);
        expect(stats.streetlightIntensity).toBeCloseTo(sample.streetlightIntensity, 10);
        expect(stats.shadowLengthFactor).toBeCloseTo(sample.shadowLengthFactor, 10);
        expect(stats.ambient).toEqual(sample.ambient);
        expect(stats.phase).toBe(sample.phase);

        // Daylight frames draw no window glow and no street lamps at all.
        if (sample.windowGlow <= 0.02 && sample.streetlightIntensity <= 0.05) {
          darkFrames += 1;
          expect(stats.windowsLit).toBe(0);
          expect(stats.streetlights).toBe(0);
          expect(stats.layers).not.toContain('windows');
          expect(stats.layers).not.toContain('streetlights');
        } else {
          litFrames += 1;
        }
        if (stats.windowsLit > 0) {
          litWindowFrames += 1;
        }
        if (stats.streetlights > 0) {
          streetlightFrames += 1;
        }
        if (stats.phase === 'night') {
          nightFrames += 1;
        }
      }

      // The frame followed the clock across the whole cycle.
      expect(frames).toBe(DAY_FRAMES);
      expect(fixture.clock.totalMinutes).toBe(SIM_DAY_MINUTES);
      // A composed day shows every slice of the lighting palette.
      expect([...phases].sort()).toEqual([
        'afternoon',
        'dawn',
        'dusk',
        'morning',
        'night',
        'noon',
      ]);
      expect([...phases].sort()).toEqual([...LIGHTING_PHASES].sort());

      // The README scale held at every instant of the day.
      expect(minBuildings).toBeGreaterThanOrEqual(24);
      expect(minCitizens).toBeGreaterThanOrEqual(50);
      expect(minVehicles).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      expect(maxTravelling).toBeGreaterThan(0);
      expect(nightFrames).toBeGreaterThan(0);

      // Day/night is visible in the drawn layers, not just in the model.
      expect(maxWindows).toBeGreaterThan(0);
      expect(maxStreetlights).toBeGreaterThan(0);
      expect(litWindowFrames).toBeGreaterThan(0);
      expect(streetlightFrames).toBeGreaterThan(0);
      expect(darkFrames).toBeGreaterThan(0);
      expect(litFrames + darkFrames).toBe(frames);
      for (const layer of RENDER_LAYERS) {
        expect(layersSeen.has(layer), `layer ${layer} was drawn during the day`).toBe(true);
      }
      expect(fixture.engine.getSystem(VEHICLES_SYSTEM_NAME)).toBe(vehicles);
    } finally {
      renderer.dispose();
      fixture.dispose();
    }
  });

  it('draws the lighting of each sampled hour into its own layers', () => {
    const composition = createComposition('renderer-composition-hours');
    const { fixture, world, renderer } = composition;
    const cursor = { minute: 0 };
    const frames = new Map<number, FrameStats>();

    try {
      for (const hour of SAMPLED_HOURS) {
        const stats = frameAt(composition, hour, cursor);
        frames.set(hour, stats);
        expect(stats.hour).toBe(hour);

        // The world and its agents are in every frame, whatever the light.
        expect(stats.buildings).toBe(world.buildings.length);
        expect(stats.citizens).toBeGreaterThanOrEqual(50);
        expect(stats.vehicles).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
        expect(stats.districts).toBe(world.districts.length);
        expect(stats.districtLabels).toBeGreaterThan(0);
        expect(stats.roadSegments).toBe(world.segments.length);
        expect(stats.laneMarkings).toBeGreaterThan(0);
        expect(stats.crossings).toBeGreaterThan(0);
        expect(stats.buildingDoors).toBeGreaterThan(0);
        expect(stats.shadows).toBeGreaterThan(0);
        expect(stats.moodIndicators).toBe(stats.citizens);
        expect(stats.activityIndicators).toBe(stats.citizens);
      }

      const dawn = frames.get(5)!;
      const morning = frames.get(8)!;
      const noon = frames.get(12)!;
      const dusk = frames.get(18)!;
      const night = frames.get(22)!;

      // Noon: bright ambient, short shadows, lamps and windows dark.
      expect(noon.windowsLit).toBe(0);
      expect(noon.streetlights).toBe(0);
      expect(noon.layers).not.toContain('windows');
      expect(noon.layers).not.toContain('streetlights');
      expect(Math.hypot(noon.shadowOffset.x, noon.shadowOffset.y)).toBeLessThan(
        Math.hypot(dawn.shadowOffset.x, dawn.shadowOffset.y),
      );
      expect(night.ambient.strength).toBeGreaterThan(noon.ambient.strength);
      expect(luminance(night.ambient.color)).toBeLessThan(luminance(noon.ambient.color));

      // Night: window glow and street lamps are drawn, driven by the sample.
      expect(night.windowsLit).toBeGreaterThan(0);
      expect(night.streetlights).toBeGreaterThan(0);
      expect(night.layers).toContain('windows');
      expect(night.layers).toContain('streetlights');
      expect(night.windowGlow).toBe(1);
      expect(night.layers.indexOf('buildings')).toBeLessThan(night.layers.indexOf('windows'));
      expect(night.layers.indexOf('streetlights')).toBeLessThan(night.layers.indexOf('citizens'));
      expect(night.layers.indexOf('citizens')).toBeLessThan(night.layers.indexOf('vehicles'));

      // Around dawn and dusk the city sits between the two extremes.
      expect(dawn.windowGlow).toBeGreaterThan(0);
      expect(dawn.windowGlow).toBeLessThan(1);
      expect(dusk.streetlightIntensity).toBeGreaterThan(0);
      expect(dusk.streetlightIntensity).toBeLessThan(1);
      expect(morning.windowsLit).toBe(0);
      expect(dusk.windowsLit).toBeGreaterThan(0);

      // The order of the whole pipeline is stable regardless of the hour.
      expect(night.layers).toEqual(RENDER_LAYERS.filter((layer) => night.layers.includes(layer)));

      // Shadows follow the sample in direction, and their length ratio follows
      // the sample's own shadow length factor.
      expect(shadowMatchesSample(night, sampleLighting(22))).toBe(true);
      expect(shadowMatchesSample(noon, sampleLighting(12))).toBe(true);
      expect(
        Math.hypot(night.shadowOffset.x, night.shadowOffset.y) /
          Math.hypot(noon.shadowOffset.x, noon.shadowOffset.y),
      ).toBeCloseTo(night.shadowLengthFactor / noon.shadowLengthFactor, 6);
    } finally {
      renderer.dispose();
      fixture.dispose();
    }
  });

  it('reflects moving citizens and driving vehicles in the frame', () => {
    const composition = createComposition('renderer-composition-motion');
    const { fixture, vehicles, renderer } = composition;
    const cursor = { minute: 0 };

    try {
      // Morning rush: commuters are on the move and traffic is on the road.
      const morning = frameAt(composition, 8, cursor);
      const morningFleet = new Map(
        vehicles.activeVehicles().map((vehicle) => [vehicle.id, { ...vehicle.position }]),
      );
      expect(morning.vehicles).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      expect(morningFleet.size).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);

      // Noon: the same city, later in the day, with different traffic.
      const noon = frameAt(composition, 12, cursor);
      let shared = 0;
      let moved = 0;
      for (const vehicle of vehicles.activeVehicles()) {
        const before = morningFleet.get(vehicle.id);
        if (!before) {
          continue;
        }
        shared += 1;
        if (Math.hypot(vehicle.position.x - before.x, vehicle.position.y - before.y) > 0.1) {
          moved += 1;
        }
      }
      expect(shared, 'the same vehicles are still on the road at noon').toBeGreaterThan(0);
      expect(moved, 'vehicles have driven somewhere by noon').toBeGreaterThan(0);
      expect(noon.citizens).toBeGreaterThanOrEqual(50);

      // The commute puts citizens on the street, which the frame draws with the
      // travelling ring; occupied vehicles carry their occupancy cue.
      let maxTravelling = 0;
      for (let hour = 13; hour <= 20; hour += 1) {
        const stats = frameAt(composition, hour, cursor);
        maxTravelling = Math.max(maxTravelling, stats.citizensTravelling);
        expect(stats.citizensTravelling).toBeLessThanOrEqual(stats.citizens);
        expect(stats.occupantCues).toBeGreaterThan(0);
        expect(stats.vehicles).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      }
      expect(maxTravelling).toBeGreaterThan(0);

      // Rendering never mutates the simulation: the fleet keeps running.
      expect(vehicles.activeVehicles().length).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      expect(cursor.minute).toBe(20 * MINUTES_PER_HOUR);
      expect(renderer.frameCount).toBeGreaterThan(0);
    } finally {
      renderer.dispose();
      fixture.dispose();
    }
  });

  it('culls the real city to the camera viewport', () => {
    const composition = createComposition('renderer-composition-culling');
    const { fixture, camera, world, handle, renderer } = composition;

    try {
      // Advance into the day so the agents are spread over the city.
      fixture.advanceMinutes(8 * MINUTES_PER_HOUR);

      handle.reset();
      const wholeCity = renderer.frame();
      expect(wholeCity.buildings).toBe(world.buildings.length);
      expect(wholeCity.culled.buildings).toBe(0);
      const wholeCityCalls = wholeCity.contextCalls;

      for (const zoom of [1, 2, 4]) {
        camera.zoomTo(zoom);
        camera.centerOn(world.widthInTiles * 0.35, world.heightInTiles * 0.35);
        const bounds = camera.visibleWorldBounds();
        handle.reset();
        const zoomed = renderer.frame();

        const expected = visibleBuildings(world.buildings, bounds);
        expect(zoomed.buildings, `zoom ${zoom}`).toBe(expected);
        expect(zoomed.buildings).toBeLessThan(world.buildings.length);
        expect(zoomed.culled.buildings).toBe(world.buildings.length - expected);
        expect(zoomed.culled.citizens + zoomed.citizens).toBe(world.citizens.length);
        expect(zoomed.culled.roadNodes + zoomed.streetlights).toBeLessThanOrEqual(world.nodes.length);
        expect(zoomed.contextCalls).toBeLessThan(wholeCityCalls);
        expect(zoomed.culled.tiles).toBeGreaterThan(0);
      }

      // Panning right across the city always keeps the drawn set equal to the
      // buildings whose footprint overlaps the reported bounds.
      for (let step = 0; step <= 4; step += 1) {
        camera.zoomTo(2);
        camera.centerOn((world.widthInTiles * step) / 4, (world.heightInTiles * (4 - step)) / 4);
        const bounds = camera.visibleWorldBounds();
        const stats = renderer.frame();
        expect(stats.bounds).toEqual(bounds);
        expect(stats.buildings).toBe(visibleBuildings(world.buildings, bounds));
        expect(stats.culled.buildings + stats.buildings).toBe(world.buildings.length);
        expect(stats.culled.roadSegments + stats.roadSegments).toBe(world.segments.length);
      }
    } finally {
      renderer.dispose();
      fixture.dispose();
    }
  });

  it(`renders the full generated city inside the ${FRAME_BUDGET_MS.toFixed(2)} ms frame budget`, () => {
    // FRAME_BUDGET_MS is one 60 fps frame. The browser also composites, so this
    // headless measurement is the same budget with the whole margin spare.
    const composition = createComposition('renderer-composition-budget');
    const { fixture, renderer, handle, world, citizens, vehicles } = composition;
    const hours = [5, 12, 18, 23];

    try {
      fixture.advanceMinutes(6 * MINUTES_PER_HOUR);
      let maxCommands = 0;
      let buildings = 0;
      let drawnCitizens = 0;
      let drawnVehicles = 0;
      let windows = 0;

      const renderHour = (hour: number): FrameStats => {
        // Jumping the clock keeps the benchmark on the drawing cost: the sim
        // state is already settled after the six hours advanced above.
        fixture.clock.setTime({ hour });
        return renderer.frame();
      };

      for (let index = 0; index < BENCHMARK_FRAMES; index += 1) {
        renderHour(hours[index % hours.length]);
        handle.reset();
      }

      const started = performance.now();
      for (let index = 0; index < BENCHMARK_FRAMES; index += 1) {
        const stats = renderHour(hours[index % hours.length]);
        maxCommands = Math.max(maxCommands, stats.contextCalls);
        buildings = stats.buildings;
        drawnCitizens = stats.citizens;
        drawnVehicles = stats.vehicles;
        windows = Math.max(windows, stats.windowsLit);
        handle.reset();
      }
      const meanFrameMs = (performance.now() - started) / BENCHMARK_FRAMES;

      // The benchmark really drew the whole live city: every building, every
      // citizen and the live fleet, with the night windows lit.
      expect(buildings).toBe(world.buildings.length);
      expect(buildings).toBeGreaterThanOrEqual(24);
      expect(drawnCitizens).toBe(citizens.citizens.length);
      expect(drawnCitizens).toBeGreaterThanOrEqual(50);
      expect(drawnVehicles).toBe(vehicles.activeVehicles().length);
      expect(drawnVehicles).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      expect(windows).toBeGreaterThan(0);
      // A full city frame is a few thousand canvas calls, not tens of thousands:
      // terrain runs, lane classes and window paths are all batched.
      expect(maxCommands).toBeGreaterThan(500);
      expect(maxCommands).toBeLessThan(40_000);
      expect(meanFrameMs).toBeLessThan(FRAME_BUDGET_MS);
      // The measured budget is part of the evidence: print it so a run shows
      // how much margin the browser lane inherits.
      console.info(
        `[renderer benchmark] ${meanFrameMs.toFixed(2)} ms mean per full-city frame ` +
          `(${buildings} buildings, ${drawnCitizens} citizens, ${drawnVehicles} vehicles, ` +
          `<= ${maxCommands} canvas calls), budget ${FRAME_BUDGET_MS.toFixed(2)} ms`,
      );
    } finally {
      renderer.dispose();
      fixture.dispose();
    }
  });

  it('consumes the live systems through the documented interfaces', () => {
    const composition = createComposition('renderer-composition-contracts');
    const { fixture, world, citizens, vehicles, lighting, camera, renderer } = composition;

    try {
      // Compile-time proof that the real systems satisfy the renderer's views:
      // a change to either side breaks this test at type-check time.
      const citizenSource: CitizenSource = citizens;
      const vehicleSource: VehicleSource = vehicles;
      const lightingSource: LightingSource = lighting;
      expect(citizenSource.citizens).toBe(citizens.citizens);
      expect(lightingSource.sample).toBe(lighting.sample);
      expect(vehicleSource.activeVehicles().map((vehicle) => vehicle.id)).toEqual(
        vehicles.activeVehicles().map((vehicle) => vehicle.id),
      );

      fixture.advanceMinutes(7 * MINUTES_PER_HOUR);
      const stats = renderer.frame();
      expect(renderer.camera).toBe(camera);
      expect(stats.hour).toBe(7);
      expect(stats.buildings).toBe(world.buildings.length);
      expect(stats.districts).toBe(world.districts.length);
      expect(stats.citizens).toBeGreaterThanOrEqual(50);
      expect(stats.vehicles).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      // The renderer sampled the bound lighting component, not a private clock.
      expect(stats.windowGlow).toBe(lighting.sample.windowGlow);
      expect(stats.streetlightIntensity).toBe(lighting.sample.streetlightIntensity);
      expect(stats.phase).toBe(lighting.phase);

      // Resizing the camera (what the app does on a window resize) re-sizes the
      // surface on the next frame with no extra wiring.
      camera.resize({ width: 800, height: 600 });
      const resized = renderer.frame();
      expect(resized.surface).toEqual({ width: 800, height: 600 });
      expect(resized.buildings).toBeGreaterThan(0);

      // Disposal is idempotent, and the simulation keeps running untouched.
      renderer.dispose();
      renderer.dispose();
      expect(renderer.isDisposed).toBe(true);
      expect(() => renderer.frame()).toThrow(/dispose/);
      fixture.advanceMinutes(MINUTES_PER_HOUR);
      expect(vehicles.activeVehicles().length).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
    } finally {
      fixture.dispose();
    }
  });
});
