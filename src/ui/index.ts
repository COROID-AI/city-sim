/**
 * Public barrel for the UI layer.
 *
 * Re-exports the presentational components + the snapshot helper so
 * consumers (CityView, tests) only need a single import path.
 */
export { Dashboard, type DashboardProps } from './Dashboard';
export {
  CityLog,
  CITY_LOG_RING_CAPACITY,
  type CityLogEntry,
  type CityLogProps,
  type CityLogTone,
} from './CityLog';
export { MiniMap, type MiniMapProps } from './MiniMap';
export { Tooltip, clampTooltipPosition, type TooltipProps } from './Tooltip';
export {
  buildCitySnapshot,
  emptyCitySnapshot,
  CITIZEN_COLOR,
  VEHICLE_COLOR,
  BUILDING_COLOR_FALLBACK,
  type BuildCitySnapshotInput,
  type CitySnapshot,
  type NeedKey,
} from './CitySnapshot';
