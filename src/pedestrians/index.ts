/**
 * Era-variant pedestrians module.
 *
 * Self-contained R3F module keyed off the foundation era registry. Exposes the
 * `Pedestrians` component, which renders era-appropriate, procedurally-authored
 * pedestrian figures (outfits, silhouettes, crowd) that loop along the block's
 * sidewalks. Integration with the shared scene is owned by Phase 4.
 */
export { Pedestrians } from './Pedestrians';
export { ERA_PEDESTRIAN_CONFIG, PEDESTRIAN_ERA_PALETTES } from './eraConfig';
export type { EraPedestrianConfig } from './eraConfig';
export { buildFigureGeometry, FIGURE_DIMS, HEAD_CENTER_Y } from './geometry';
export type { FigureStyle, FigureDims, OutfitScheme } from './geometry';
export { SIDEWALK_LOOPS, sampleSidewalk } from './sidewalkPaths';
export type { SidewalkLoop, SidewalkSample } from './sidewalkPaths';