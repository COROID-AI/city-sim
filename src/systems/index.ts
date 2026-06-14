/**
 * Public surface of the systems layer.
 *
 * The systems layer is framework-agnostic: no React, no DOM, no
 * engine runtime imports. It may import engine *types* (re-exported
 * via `@/engine` as structural shapes, which are erased at runtime).
 *
 * Currently exposes the in-world clock. Additional systems
 * (Economy, Traffic, Commute) will be added in later tasks.
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
