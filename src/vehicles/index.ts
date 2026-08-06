/**
 * Vehicles module barrel.
 *
 * Exposes the self-contained era-variant vehicles layer. Downstream integration
 * (Phase 4) imports `Vehicles` from here and drops it into the scene canvas.
 */
export { Vehicles } from './Vehicles';
export type { VehiclesProps } from './Vehicles';
export { ERA_VEHICLE_CONFIG, generateInstances } from './vehicleEras';
export type { EraVehicleConfig } from './vehicleEras';
export { VEHICLE_TYPES, resolvePartColor } from './vehicleTypes';
export type { VehiclePart, VehicleInstance, VehicleTypeId, PartRole, Primitive } from './vehicleTypes';
export { ROAD_LOOPS, pointOnLoop } from './paths';
export type { RectLoop, LoopParams } from './paths';
