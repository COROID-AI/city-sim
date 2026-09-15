/**
 * `cafe-audio-engine` — the public audio interface of the café scene.
 *
 * This barrel is the single import surface for everyone else in the application:
 *
 *  - **app-composition** creates an engine ({@link createAudioEngine}), calls
 *    {@link AudioEngine.unlock} from a user gesture, pumps {@link AudioEngine.update}
 *    each frame, and {@link AudioEngine.dispose}s it on teardown,
 *  - **period-registry / period-transition** crossfades eras through
 *    {@link AudioEngine.transitionTo} (or drives the {@link createAudioSceneModule}
 *    adapter like any other `SceneModule`),
 *  - **domain-music-sources** authors the five era programs, murmur specs, machine
 *    characters and mix values as data using the descriptor types below, which are
 *    all keyed by the shared `YearId` from `src/contracts/period.ts`.
 *
 * Everything audible is synthesised: no audio files, no network access and no
 * media element playback. The engine is written against an injected
 * {@link AudioContextLike}, so the whole graph is testable headlessly.
 */

/* The engine and its composition adapter. */
export {
  AudioEngine,
  CAFE_AUDIO_ENGINE_ID,
  createAudioEngine,
  createAudioSceneModule,
  isCafeAudioEngine,
  MACHINE_SFX_KINDS,
} from './AudioEngine';
export type {
  AudioEngineEvent,
  AudioEngineEventKind,
  AudioEngineOptions,
  AudioEngineState,
  AudioMixState,
  AudioSceneModule,
  AudioSceneModuleOptions,
  AudioSceneSpec,
  AudioTransitionPlan,
  CafeAudioEngine,
} from './AudioEngine';
export { AudioEngineError } from './types';
export type { AudioEngineErrorCode, AudioContextLike, AudioContextLikeFactory } from './types';

/* Descriptor vocabulary owned by this task (era data is injected through it). */
export {
  AudioDescriptorError,
  CLATTER_MATERIALS,
  CLATTER_PROFILE_DEFAULTS,
  DEVICE_KINDS,
  DEVICE_PROFILE_DEFAULTS,
  EXTRACTION_PROFILE_DEFAULTS,
  GRINDER_PROFILE_DEFAULTS,
  INSTRUMENT_KINDS,
  INSTRUMENT_PROFILES,
  INSTRUMENT_WAVEFORMS,
  MACHINE_ARCHETYPES,
  MIDDLE_C_MIDI,
  MILK_PROFILE_DEFAULTS,
  MURMUR_PROFILE_DEFAULTS,
  REVERB_MIX_DEFAULTS,
  SCALE_INTERVALS,
  SCALE_MODES,
  STEAM_PROFILE_DEFAULTS,
  TILL_PROFILE_DEFAULTS,
  midiToFrequency,
  normalizeAmbienceSpec,
  normalizeEraMix,
  normalizeMachineCharacter,
  normalizeMusicProgram,
  noteToMidi,
  resolvePitch,
  scaleDegreeToMidi,
} from './program';
export type {
  AmbienceMix,
  AmbienceMixInput,
  AmbienceSpecDescriptor,
  AmbienceSpecInput,
  AudioYearProvider,
  ClatterMaterial,
  ClatterProfile,
  ClatterProfileInput,
  DeviceKind,
  DeviceProfile,
  DeviceProfileInput,
  EraMixDescriptor,
  EraMixInput,
  ExtractionProfile,
  ExtractionProfileInput,
  GrinderProfile,
  GrinderProfileInput,
  InstrumentKind,
  InstrumentSpec,
  InstrumentSpecInput,
  InstrumentWaveform,
  MachineArchetype,
  MachineCharacterDescriptor,
  MachineCharacterInput,
  MachineMix,
  MachineMixInput,
  MilkProfile,
  MilkProfileInput,
  MusicMix,
  MusicMixInput,
  MurmurProfile,
  MurmurProfileInput,
  MusicProgramDescriptor,
  MusicProgramInput,
  MusicalKey,
  PatternStep,
  PatternStepInput,
  ProgramVoice,
  ProgramVoiceInput,
  ReverbMix,
  ReverbMixInput,
  ScaleMode,
  SteamProfile,
  SteamProfileInput,
  TillProfile,
  TillProfileInput,
} from './program';

/* Mixer, limiter and reverb pieces (also useful to tests and tooling). */
export {
  BUS_IDS,
  brightnessToToneHz,
  createBusStrip,
  createLimiterStage,
  createMasterOutput,
} from './buses';
export type {
  BusDestinations,
  BusId,
  BusOptions,
  BusStrip,
  LimiterOptions,
  LimiterStage,
  MasterOutput,
  MasterOutputOptions,
} from './buses';
export { createImpulseResponse, createRoomReverb, resolveImpulseOptions, safeDisconnect } from './reverb';
export type { ImpulseResponseOptions, ResolvedImpulseOptions, RoomReverb, RoomReverbOptions } from './reverb';

/* Synthesis units. */
export {
  INSTRUMENT_SHAPES,
  createMusicScheduler,
  createNoiseBuffer,
  renderInstrumentNote,
} from './music';
export type {
  InstrumentRenderRequest,
  InstrumentShape,
  InstrumentVoice,
  MusicScheduler,
  MusicSchedulerOptions,
  ScheduledMusicEvent,
} from './music';
export { createMurmurBed } from './ambience';
export type { MurmurBed, MurmurBedOptions, MurmurBlip } from './ambience';
export {
  ARCHETYPE_BEHAVIOUR,
  CLATTER_TONALITY,
  createMachineSfx,
} from './machineSfx';
export type {
  ArchetypeBehaviour,
  MachineSfx,
  MachineSfxKind,
  MachineSfxOptions,
  MachineTriggerOptions,
  MachineTriggerRecord,
  RoutedMachineCharacter,
} from './machineSfx';
