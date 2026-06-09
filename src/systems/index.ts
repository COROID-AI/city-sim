/**
 * Public re-exports for the systems layer.
 *
 * The systems layer is framework-agnostic: no React, no DOM, no
 * engine-side imports. This keeps the modules unit-testable in node
 * and lets future tasks lift them into a Web Worker if profiling
 * demands it.
 */
export { EventBus, type EventName, type Envelope, type EventHandler, type WildcardHandler } from './EventBus';
export {
  TimeSystem,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  FADE_SECONDS,
  SPEED_PRESETS,
  DEFAULT_PHASE_COLORS,
  type Lighting,
  type LightingPhase,
  type Rgb,
  type TimeState,
  type TimeSystemOptions,
} from './TimeSystem';
