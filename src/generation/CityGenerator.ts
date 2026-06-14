/**
 * Top-level procedural city generator. Produces a fully populated `World`
 * with:
 *  - An 80x80 tile grid (configurable).
 *  - Five rectangular zones: residential, commercial, industrial,
 *    entertainment, park.
 *  - A 2-tile-wide road grid around and between zones.
 *  - Non-overlapping building footprints placed inside each non-park zone.
 *
 * Determinism: a given seed always produces the same layout, building
 * count, and building IDs. Tests assert this.
 *
 * Benchmark: after `generate()` completes, the function writes a
 * `__CITY_BENCHMARK__` object onto `window` (when `window` is defined) so
 * downstream renderers and Playwright e2e tests can read entity counts.
 */

import { World } from '@/engine/World';
import type { Building, WorldBounds } from '@/engine/types';
import { BuildingPlacer } from './BuildingPlacer';
import { NameGenerator } from './NameGenerator';
import { buildRoadNetwork, collectRoadTiles } from './RoadNetwork';
import { createRng, type Rng } from './random';
import { computeZoneLayout, type Zone, type ZoneKind } from './zones';

export const DEFAULT_WORLD_WIDTH = 80;
export const DEFAULT_WORLD_HEIGHT = 80;

export interface CityGeneratorOptions {
  readonly seed: number;
  readonly width?: number;
  readonly height?: number;
  /** Building density 0..1. */
  readonly density?: number;
  /** Inject a custom rng; defaults to a mulberry32 seeded with `options.seed`. */
  readonly rng?: Rng;
}

export interface GeneratedCity {
  readonly world: World;
  readonly zones: readonly Zone[];
  readonly buildings: readonly Building[];
  readonly roads: readonly { x: number; y: number }[];
  readonly seed: number;
  readonly generatedAtMs: number;
  readonly bounds: WorldBounds;
  readonly zoneKinds: readonly ZoneKind[];
}

export interface CityBenchmark {
  readonly tiles: number;
  readonly buildings: number;
  readonly zones: number;
  readonly roads: number;
  readonly citizens: number;
  readonly seed: number;
  readonly generatedAtMs: number;
  readonly bounds: WorldBounds;
}

declare global {
  interface Window {
    __CITY_BENCHMARK__?: CityBenchmark;
  }
}

export class CityGenerator {
  /**
   * Generate a city. Returns the populated world plus the metadata needed
   * for the benchmark object. Safe to call repeatedly with the same seed.
   */
  generate(options: CityGeneratorOptions): GeneratedCity {
    const width = options.width ?? DEFAULT_WORLD_WIDTH;
    const height = options.height ?? DEFAULT_WORLD_HEIGHT;
    if (!Number.isInteger(width) || width <= 0) {
      throw new RangeError(`CityGenerator: width must be a positive integer (got ${width})`);
    }
    if (!Number.isInteger(height) || height <= 0) {
      throw new RangeError(`CityGenerator: height must be a positive integer (got ${height})`);
    }
    const bounds: WorldBounds = { width, height };
    const rng = options.rng ?? createRng(options.seed);

    const world = new World(bounds);
    const zones = computeZoneLayout(bounds);
    const roads = buildRoadNetwork(world, zones);
    const names = new NameGenerator(rng);
    const placer = new BuildingPlacer(world, rng, names);
    const buildings = placer.placeInZones(zones, { density: options.density });

    const generatedAtMs = Date.now();
    const result: GeneratedCity = {
      world,
      zones,
      buildings,
      roads,
      seed: options.seed,
      generatedAtMs,
      bounds,
      zoneKinds: zones.map((z) => z.kind),
    };

    this.publishBenchmark(result);
    return result;
  }

  private publishBenchmark(city: GeneratedCity): void {
    if (typeof window === 'undefined') return;
    const benchmark: CityBenchmark = {
      tiles: city.bounds.width * city.bounds.height,
      buildings: city.buildings.length,
      zones: city.zones.length,
      roads: city.roads.length,
      citizens: city.world.citizenCount,
      seed: city.seed,
      generatedAtMs: city.generatedAtMs,
      bounds: city.bounds,
    };
    window.__CITY_BENCHMARK__ = benchmark;
  }
}

/**
 * Convenience wrapper: build and return a city with default bounds.
 * Equivalent to `new CityGenerator().generate({ seed })`.
 */
export function generateCity(seed: number): GeneratedCity {
  return new CityGenerator().generate({ seed });
}

/**
 * Read the current benchmark object (if any). Returns `null` when
 * `window` is undefined or no benchmark has been published yet.
 */
export function readCityBenchmark(): CityBenchmark | null {
  if (typeof window === 'undefined') return null;
  return window.__CITY_BENCHMARK__ ?? null;
}

// Re-export the road collector so callers can re-derive the road set
// after the fact (e.g. when a system paints more roads at runtime).
export { collectRoadTiles };
