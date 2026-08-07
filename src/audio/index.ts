/**
 * Audio module — a Web Audio API implementation of the {@link AudioManager}
 * contract with procedural per-era ambience and transition SFX.
 */
export { WebAudioManager, createWebAudioManager } from './WebAudioManager';
export type { WebAudioManagerOptions } from './WebAudioManager';
export { buildEraAmbience, ERA_AMBIENCE_SPECS } from './ambience';
export type { AmbienceLayer, LoopSpec } from './ambience';
export { playTransitionSfx } from './transitionSfx';

import { WebAudioManager } from './WebAudioManager';

/** Shared application-wide audio manager instance. */
export const audioManager = new WebAudioManager();
