/**
 * Pedestrians module barrel.
 *
 * Exposes the self-contained era-variant sidewalk crowd layer. Downstream
 * integration (Phase 4) imports `Pedestrians` from here and drops it into the
 * scene canvas.
 */
export { Pedestrians } from './Pedestrians';
export type { PedestriansProps } from './Pedestrians';
export {
  ERA_PEDESTRIAN_CONFIG,
  SIDEWALK_LOOPS,
  generatePedestrians,
  getPedestrianConfig,
} from './pedestrianConfig';
export type { PedestrianEraConfig, PedestrianInstance } from './pedestrianConfig';
