/**
 * Buildings & architecture module.
 *
 * Self-contained R3F layer keyed off the shared era registry (EraId). It
 * renders the era-correct block composition: procedural building geometry with
 * era-appropriate form, height, materials, and window patterns, using
 * instancing for repeated windows/facade units and shared PBR materials per
 * era. Expose <Buildings era={...} /> to place it in any canvas (integration
 * happens in Phase 4).
 */
export { Buildings } from './Buildings';
export {
  BUILDINGS_ERA_CONFIG,
  getBuildingsConfig,
  generateBuildings,
  type BuildingsEraConfig,
  type MaterialPalette,
  type BuildingStyle,
  type PlacedBuilding,
  type WindowStyle,
  type RoofStyle,
} from './buildingsConfig';
