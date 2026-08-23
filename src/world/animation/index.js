/** Public animation surface. Era modules may optionally provide `styleTokens`; no
 * changes are required for modules that use the original EraModule contract. */
export {
  timelapse,
  transitionTo,
  updateTransitions,
  setReducedMotion,
  getStyleTokens,
  TRANSITION_DURATION,
} from './timelapse.js';
export {
  audio,
  setAudioMuted,
  setAudioVolume,
  toggleAudioMuted,
  isAudioMuted,
  getAudioVolume,
} from './audio.js';