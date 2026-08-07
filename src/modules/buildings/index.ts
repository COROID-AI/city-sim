/**
 * Buildings module barrel.
 *
 * The module is self-contained and keyed off the foundation era registry.
 * Integration into the main scene happens in a later phase.
 */
export { Buildings } from './Buildings';
export type { BuildingsProps } from './Buildings';
export { BUILDINGS_BY_ERA } from './eraConfig';
export type {
  EraBuildingsConfig,
  EraBuildingFeatures,
  EraSignage,
  EraWallMaterial,
  EraWindowMaterial,
  RoofStyle,
} from './eraConfig';
export {
  BuildingShell,
  BuildingSign,
  CladdingPanels,
  FireEscape,
  Greenery,
  LedFacade,
  Mullions,
  RoofCap,
  StorefrontGlazing,
  WindowGrid,
} from './parts';
export type { WindowGridProps } from './parts';
export { makeGrid } from './grid';
export type { GridOpts } from './grid';
