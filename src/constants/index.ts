/**
 * Public surface of the constants layer.
 *
 * Constants are pure data: no React, no DOM, no engine runtime. They
 * may import engine *types* (structural, erased at runtime).
 *
 * Downstream consumers (Dashboard, CityLog, EconomySystem, Renderer)
 * should import from `@/constants` rather than reaching into the
 * individual files.
 */

export {
  BUILDING_DEFS,
  COMPANY_BUILDING_DEFS,
  RESIDENTIAL_DEF,
} from './building-types';
export type { BuildingDef } from '@/engine/types';
