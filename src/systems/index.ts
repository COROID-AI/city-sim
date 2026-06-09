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
export { TrafficSystem, type TrafficSystemOptions } from './TrafficSystem';
export {
  CommuteManager,
  COMMUTE_MIN_PATH_LENGTH,
  COMMUTE_VEHICLE_TIMEOUT_TICKS,
  type CommuteManagerOptions,
  type CommuteTickResult,
  type IdFactory,
} from './CommuteManager';
export {
  EventBus,
  cityBus,
  type CityEventMap,
  type CityEventName,
  type CityEventListener,
  type Unsubscribe,
  type EventBusErrorHandler,
} from './EventBus';
export {
  EconomySystem,
  DEFAULT_TAX_RATE,
  DEFAULT_DAILY_UPKEEP,
  DEFAULT_MAX_COMPANIES,
  type EconomySystemOptions,
  type DailyLedger,
  type OpenCompanyResult,
} from './EconomySystem';
