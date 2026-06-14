/**
 * Public surface of the procedural generation layer.
 *
 * Consumers should import from `@/generation` (this barrel) rather than
 * reaching into individual files. Engine internals are NOT re-exported.
 */

export { CityGenerator, generateCity, readCityBenchmark, DEFAULT_WORLD_WIDTH, DEFAULT_WORLD_HEIGHT } from './CityGenerator';
export type { CityGeneratorOptions, GeneratedCity, CityBenchmark } from './CityGenerator';
export { BuildingPlacer } from './BuildingPlacer';
export type { BuildingPlacerOptions } from './BuildingPlacer';
export { NameGenerator } from './NameGenerator';
export { buildRoadNetwork, collectRoadTiles } from './RoadNetwork';
export type { RoadNetworkOptions } from './RoadNetwork';
export { computeZoneLayout, isZoneBorder } from './zones';
export type { Zone, ZoneKind, LayoutOptions } from './zones';
export { createRng } from './random';
export type { Rng } from './random';
