/**
 * Public surface of the engine layer. The engine is framework-agnostic:
 *  - No React imports
 *  - No DOM access (the only DOM-touching surface is the rAF handle used by
 *    `GameLoop`, which falls back to a noop outside the browser so SSR is
 *    safe).
 */

export type {
  Building,
  BuildingDef,
  BuildingType,
  CameraState,
  Citizen,
  CitizenState,
  CityTime,
  Tile,
  TileCoord,
  TileKind,
  Vehicle,
  VehicleState,
  Vector2,
  WorldBounds,
} from './types';

export { Pathfinder } from './Pathfinder';
export type { PathfinderOptions, PathfinderStats } from './Pathfinder';

export { World } from './World';
export { Camera, DEFAULT_MIN_ZOOM, DEFAULT_MAX_ZOOM, DEFAULT_SMOOTHING_RATE, MAX_DT } from './Camera';
export {
  GameLoop,
  TICK_HZ,
  FIXED_DT,
  MAX_FRAME_DT,
  DEFAULT_MAX_STEPS_PER_FRAME,
} from './GameLoop';
export type { GameLoopOptions, LoopPhase, FixedStepCallback, FrameCallback, RafHandle } from './GameLoop';
export {
  Renderer,
  TILE_PIXELS,
  compareBuildingsByDepth,
  DEFAULT_PALETTE,
  colorForTile,
} from './Renderer';
export type {
  RendererContext,
  RendererOptions,
  CanvasGradientLike,
  RadialGradientStop,
} from './Renderer';
export type { CityPalette } from './palette';
export {
  tryLoadSprites,
  spriteUrl,
  SPRITE_BASE,
} from './sprites';
export type { SpriteAtlas, SpriteKey } from './sprites';
