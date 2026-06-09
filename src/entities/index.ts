/**
 * Public barrel for the entities layer.
 *
 * Downstream tasks (renderer, pathfinder, vehicle handoff) MUST import
 * `Citizen`, `Needs`, `Schedule`, and related types from `@/entities`
 * so we have a single stable contract.
 */
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
