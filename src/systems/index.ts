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
 *  - The need system that decays / replenishes citizen needs.
 */

export {
  TimeSystem,
  HOURS_PER_DAY,
  MINUTES_PER_HOUR,
  DEFAULT_REAL_TO_SIM_RATIO,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_NIGHT_START_HOUR,
} from './TimeSystem';
export type {
  DayChangeListener,
  TimeSystemOptions,
  Unsubscribe,
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

export {
  NeedSystem,
  NEED_DECAY_PER_HOUR,
  NEED_REPLENISH_PER_HOUR,
  NEED_DELTAS,
  computeNeed,
} from './NeedSystem';
export type {
  NeedSystemOptions,
  NeedSystemWorldView,
  ScheduleMap,
} from './NeedSystem';
