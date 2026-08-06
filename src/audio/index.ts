import { WebAudioManager } from './WebAudioManager';

/**
 * Shared audio manager singleton used across the app.
 *
 * The rest of the app depends only on the foundation {@link AudioManager}
 * interface; this module owns the concrete Web Audio wiring.
 */
export const audioManager = new WebAudioManager();

export { WebAudioManager };
export type { AudioManager } from '../contracts/audio';
