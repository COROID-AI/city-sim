/**
 * Street & environment module.
 *
 * Self-contained R3F layer keyed off the shared era registry (EraId). It
 * renders the road surface, street furniture, procedural sky, and lighting
 * mood for every era. Expose <StreetEnvironment era={...} /> to place it in
 * any canvas (integration happens in Phase 4).
 */
export { StreetEnvironment } from './StreetEnvironment';
export { StreetSky } from './StreetSky';
export { StreetLighting } from './StreetLighting';
export { Road, ROAD_GEOMETRY } from './Road';
export { StreetFurniture } from './StreetFurniture';
export {
  STREET_ERA_CONFIG,
  getStreetConfig,
  type StreetEraConfig,
  type SkyConfig,
  type LightingConfig,
  type RoadConfig,
  type FurnitureConfig,
  type LampStyle,
  type SignalStyle,
} from './streetConfig';
