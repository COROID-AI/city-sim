/**
 * Public surface of the entities layer.
 *
 * The entities layer is pure TypeScript: it has no React, no DOM, and
 * no runtime dependency on the engine. It re-exports engine *types*
 * (which are erased at runtime) and adds activity / factory helpers
 * that systems and the generator can call.
 */

export { createCitizen, setState, pickActivityFor, activityToState } from './Citizen';
export type { CreateCitizenOptions } from './Citizen';
export {
  SLEEP_START_HOUR,
  SLEEP_END_HOUR,
  MORNING_COMMUTE_START,
  MORNING_COMMUTE_END,
  EVENING_COMMUTE_START,
  EVENING_COMMUTE_END,
  EVENING_LEISURE_START,
  UNEMPLOYED_ERRAND_START,
  UNEMPLOYED_ERRAND_END,
  UNEMPLOYED_LEISURE_START,
  UNEMPLOYED_LEISURE_END,
} from './Citizen';

export {
  buildRoadGraph,
  indexOfCoord,
  findNearestRoadNode,
  getOrphanRoads,
  isRoadTile,
} from './Road';
export type { RoadGraph, OrphanReport, RoadWorldView } from './Road';

export {
  createVehicle,
  advanceVehicle,
  vehicleBlocksTile,
  currentTile,
  projectedOccupiedTiles,
  shouldRenderHeadlight,
} from './Vehicle';
export type {
  CreateVehicleOptions,
  TrafficSnapshot,
  OccupancySet,
} from './Vehicle';
