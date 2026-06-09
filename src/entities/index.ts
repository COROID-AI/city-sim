/**
 * Public barrel for the entities layer.
 *
 * Downstream tasks (renderer, pathfinder, vehicle handoff) MUST import
 * `Citizen`, `Needs`, `Schedule`, `Road`, `Vehicle`, and related types
 * from `@/entities` so we have a single stable contract.
 */

// Citizen (people + their needs/schedules)
export {
  type Citizen,
  type Needs,
  type Schedule,
  createCitizen,
  activityAtHour,
  applyNeedDeltas,
  isCitizen,
  DEFAULT_NEEDS,
} from './Citizen';

// Road network (graph builder + cost strategy)
export {
  type RoadKind,
  type RoadGrid,
  type Intersection,
  type RoadGraph,
  type TrafficSnapshot,
  type TrafficPhase,
  type BuildRoadGraphOptions,
  buildRoadGraph,
  defaultNeighborCost,
  CARDINAL_DIRECTIONS,
  tileKey,
  parseTileKey,
  isDriveable,
} from './Road';

// Re-export the A* pathfinder through the entities barrel so consumers
// (citizen-vehicle handoff, renderer route preview) only need to
// import from `@/entities`. The pathfinder lives in `src/engine` to
// satisfy the layer-convention rule, but the entity layer is its
// stable public surface.
export { findPath, heuristic, type FindPathOptions } from '@/engine/Pathfinder';

// Vehicles (movement + red-light stop)
export {
  type Vehicle,
  type VehicleStatus,
  type CreateVehicleParams,
  type AdvanceVehicleParams,
  createVehicle,
  advanceVehicle,
} from './Vehicle';

// Companies (economy entities)
export {
  type Company,
  type CompanyId,
  type CompanyStatus,
  type LedgerEntry,
  type CreateCompanyParams,
  createCompany,
  getCompanyDefinition,
  openCompany,
  closeCompany,
  hireEmployee,
  fireEmployee,
  appendLedger,
  recordTransaction,
  isCompany,
} from './Company';
