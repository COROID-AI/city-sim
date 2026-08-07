/**
 * Post-processing & effects module barrel.
 *
 * The module is self-contained and keyed off the foundation era registry.
 * It is mounted inside the 3D canvas by the main scene.
 */
export { EffectsModule } from './EffectsModule';
export { Temperature, TemperatureEffect } from './TemperatureEffect';
export type { TemperatureOptions } from './TemperatureEffect';
export { interpolateEffects } from './effectsConfig';
