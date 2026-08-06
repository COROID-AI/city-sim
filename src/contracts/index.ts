/**
 * Shared contracts barrel.
 *
 * Downstream modules import from here so they never depend on the internal
 * layout of the contracts directory.
 */
export type { EraId } from './era';
export { ERA_IDS, ERA_REGISTRY } from './era';
export type { EraDescriptor } from './era';

export type { TransitionContext } from './transition';

export type { AudioManager } from './audio';

export type { EffectsConfig, EffectsConfigByEra } from './effects';
