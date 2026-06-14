/**
 * Public surface of the systems layer.
 *
 * The systems layer is framework-agnostic: no React, no DOM, no
 * engine runtime imports. It may import engine *types* (re-exported
 * via `@/engine` as structural shapes, which are erased at runtime)
 * and entity helpers from `@/entities`.
 *
 * Exposes:
 *  - The in-world clock (TimeSystem).
 *  - The schedule generator for citizen daily routines.
 *  - The need system that decays / replenishes needs.
 *  - The traffic light controller.
 *  - The commute dispatcher (sends citizens to their workplace).
 *  - The movement system (moves citizens along a path).
 *  - The event bus + concrete sim event map.
 *  - The economy system (revenue, wages, tax, infra).
 */

export { TimeSystem } from './TimeSystem';
export type {
  TimeSystemOptions,
  DayChangeListener,
  Unsubscribe,
} from './TimeSystem';
export {
  HOURS_PER_DAY,
  MINUTES_PER_HOUR,
  DEFAULT_REAL_TO_SIM_RATIO,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_NIGHT_START_HOUR,
} from './TimeSystem';

export {
  generateSchedule,
  DEFAULT_WORK_START_HOUR,
  DEFAULT_WORK_END_HOUR,
  WORK_JITTER_HOURS,
} from './ScheduleGenerator';
export type {
  Schedule,
  ScheduleBlock,
  GenerateScheduleOptions,
} from './ScheduleGenerator';

export { NeedSystem } from './NeedSystem';
export type {
  NeedSystemOptions,
  NeedSystemWorldView,
  ScheduleMap,
} from './NeedSystem';
export {
  NEED_DECAY_PER_HOUR,
  NEED_REPLENISH_PER_HOUR,
  NEED_DELTAS,
  computeNeed,
} from './NeedSystem';

export { TrafficSystem } from './TrafficSystem';
export type {
  TrafficSystemOptions,
  TrafficSystemWorldView,
  TrafficPhase,
} from './TrafficSystem';

export {
  shouldDrive,
  planCommute,
  createCommuteVehicle,
  manhattan,
  COMMUTE_DRIVE_THRESHOLD_TILES,
} from './CommuteDispatcher';
export type {
  CommuteDecision,
} from './CommuteDispatcher';

export { MovementSystem } from './MovementSystem';
export type {
  MovementSystemOptions,
  MovementSystemWorldView,
  TargetMap,
} from './MovementSystem';
export {
  MOVEMENT_TILES_PER_SECOND,
  MOVEMENT_ARRIVAL_TOLERANCE,
} from './MovementSystem';

export { EventBus, setEventBusLogger } from './EventBus';
export type { EventMap, Listener } from './EventBus';

export type {
  SimEventMap,
  SimEventName,
  ArrivalEvent,
  ArrivalKind,
  CompanyOpenCloseEvent,
  TrafficJamEvent,
  NewDayEvent,
  CitizenHiredEvent,
  CitizenFiredEvent,
} from './SimEvents';
export { SIM_EVENT_NAMES } from './SimEvents';

export {
  EconomySystem,
  isOpen,
  TAX_RATE,
  INFRA_DAILY_COST,
  WAGE_PER_EMPLOYEE,
} from './EconomySystem';
export type {
  EconomySystemOptions,
  EconomySystemWorldView,
} from './EconomySystem';
