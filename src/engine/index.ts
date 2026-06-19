/**
 * Engine module barrel.
 *
 * This directory hosts the core simulation engine (GameLoop, Grid, Renderer,
 * CityGenerator, BuildingPlacer, ...). Downstream tasks implement each module
 * here with a colocated `.test.ts` per spec 9.1.
 */
export { GameLoop } from './GameLoop';
export type {
  GameLoopOptions,
  Speed,
  UpdateCallback,
  RenderCallback,
  CityBenchmark,
} from './GameLoop';
export {
  STEP_MS,
  MAX_ACCUMULATOR_MS,
  FPS_LOG_INTERVAL,
} from './GameLoop';

// Placeholder kept for backward compatibility with the scaffold test.
export const ENGINE_READY = true;
