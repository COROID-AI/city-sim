/**
 * Era-variant vehicles module.
 *
 * Self-contained R3F module keyed off the foundation era registry. Exposes the
 * `Vehicles` component, which renders era-appropriate, procedurally-authored
 * vehicle traffic that loops along the block's roads. Integration with the
 * shared scene is owned by Phase 4.
 */
export { Vehicles } from './Vehicles';
export { ERA_VEHICLE_CONFIG, VEHICLE_ERA_PALETTES } from './eraConfig';
export type { EraVehicleConfig } from './eraConfig';
export { buildVehicleGeometry } from './geometry';
export type { VehicleStyle, VehicleDims } from './geometry';
export { ROAD_LOOPS, sampleLoop } from './roadPaths';
export type { RoadLoop, LoopSample } from './roadPaths';
