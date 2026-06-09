/**
 * Public barrel for the systems layer.
 *
 * All exports are pure-TS; downstream consumers can import the runtime
 * + types from `@/systems` without dragging in React or the DOM.
 */
export { TimeSystem, type TimeProvider } from './TimeSystem';
export {
  NeedSystem,
  DEFAULT_ACTIVITY_DELTAS,
  advanceSchedule,
  advanceNeeds,
  applyActivityDeltas,
} from './NeedSystem';
export {
  generateCity,
  type CityGeneratorOptions,
  type GeneratedCity,
  type WorkplaceBuilding,
} from './CityGenerator';
